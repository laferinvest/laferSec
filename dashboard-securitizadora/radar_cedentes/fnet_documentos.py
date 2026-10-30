"""Conferência dos informes originais em XML publicados no Fundos.NET."""
import concurrent.futures
from collections import Counter
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from .empresas_cedentes import RateLimiter
from .cvm_fidc import normalize_cnpj
from .securitizadoras import save

ROOT = Path('radar_cedentes/data/fnet')
BASE = 'https://fnet.bmfbovespa.com.br/fnet/publico/'
headers = {'User-Agent':'Mozilla/5.0','X-Requested-With':'XMLHttpRequest'}
limiter = RateLimiter(0.22)
ROOT.mkdir(parents=True,exist_ok=True)
main_page = ROOT/'gerenciador.html'
if not main_page.exists():
    raw = urllib.request.urlopen(urllib.request.Request(BASE+'abrirGerenciadorDocumentosCVM',headers=headers),timeout=20).read()
    main_page.write_bytes(raw)
text = main_page.read_text(encoding='utf8')
match = re.search(r'csrf_token\s*=\s*[\"\x27]([^\"\x27]+)',text)
if match:
    headers['CSRFToken'] = match[1]

def request(url):
    limiter.wait()
    return urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=18).read()

def index(kind, type_id):
    params = {'d':1,'s':0,'l':200,'idCategoriaDocumento':6,'idTipoDocumento':type_id,
              'paginaCertificados':'true','dataInicial':'01/01/2026','dataFinal':'15/10/2026',
              'o[0][dataEntrega]':'desc'}
    url = BASE+'pesquisarGerenciadorDocumentosDados?'+urllib.parse.urlencode(params)
    try:
        raw = request(url)
        parsed = json.loads(raw)
        (ROOT/f'indice_{kind}.json').write_bytes(raw)
        print('indice',kind,'total',parsed.get('recordsTotal'),'amostra',parsed.get('data',[])[:1],flush=True)
    except Exception as exc:
        print('indice',kind,'erro',str(exc),flush=True)

def original(doc_id, quiet=False):
    url = BASE+f'downloadDocumento?id={doc_id}'
    try:
        path = ROOT/'originais'/f'{doc_id}.xml'
        raw = path.read_bytes() if path.exists() else request(url)
        root = ET.fromstring(raw)
        if root.tag not in ('InformeMensalCRA','InformeMensalCRI'):
            raise ValueError('Raiz XML desconhecida: '+root.tag)
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(raw)
        cedentes = []
        for parent in root.iter():
            if parent.tag == 'CedentesRepresentamMais20Porcento':
                for child in parent:
                    cedentes.append({n.tag:n.text for n in child})
        record = {'id':doc_id,'url':BASE+f'exibirDocumento?id={doc_id}',
                  'url_original':url,'sha256':hashlib.sha256(raw).hexdigest(),
                  'tipo':root.tag,'competencia':root.findtext('./DadosGerais/Competencia'),
                  'emissora':root.findtext('./DadosGerais/CompanhiaEmissora'),
                  'cnpj_emissora':root.findtext('./DadosGerais/CNPJCompanhia'),
                  'codigo':root.findtext('./DadosGerais/Emissao/CodigoIdentificacao'),
                  'cedentes':cedentes}
        (path.with_suffix('.json')).write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf8')
        if not quiet:
            print('original',json.dumps(record,ensure_ascii=False),flush=True)
        return record
    except Exception as exc:
        print('original',doc_id,'erro',str(exc),flush=True)
        return None

def all_index(kind,type_id):
    if not (ROOT/f'indice_{kind}.json').exists():
        index(kind,type_id)
    first = json.loads((ROOT/f'indice_{kind}.json').read_text(encoding='utf8'))
    params = {'d':1,'l':200,'idCategoriaDocumento':6,'idTipoDocumento':type_id,
              'paginaCertificados':'true','dataInicial':'01/01/2026','dataFinal':'15/10/2026',
              'o[0][dataEntrega]':'desc'}
    def page(start):
        path = ROOT/'indices'/f'{kind}_{start}.json'
        if path.exists():
            return json.loads(path.read_text(encoding='utf8'))
        u = BASE+'pesquisarGerenciadorDocumentosDados?'+urllib.parse.urlencode({**params,'s':start})
        for attempt in range(3):
            try:
                j = json.loads(request(u))
                save(path,j)
                return j
            except (OSError,ValueError):
                if attempt==2:
                    raise
                time.sleep(1+attempt)
    pages = [first]
    with concurrent.futures.ThreadPoolExecutor(5) as ex:
        futures = [ex.submit(page,s) for s in range(200,first['recordsTotal'],200)]
        for count,future in enumerate(concurrent.futures.as_completed(futures),1):
            try:
                pages.append(future.result())
            except (OSError,ValueError) as exc:
                print('pagina_indisponivel',kind,str(exc),flush=True)
            if count%25==0:
                print('paginas',kind,count,'/',len(futures),flush=True)
    rows = {r['id']:r for p in pages for r in p['data']}
    save(ROOT/f'indice_completo_{kind}.json',list(rows.values()))
    print('indice_completo',kind,len(rows),flush=True)
    return list(rows.values())

def complete(cache_only=False):
    if cache_only:
        rows = json.loads((ROOT/'indice_completo_cri.json').read_text(encoding='utf8')) + json.loads((ROOT/'indice_completo_cra.json').read_text(encoding='utf8'))
    else:
        rows = all_index('cri',86)+all_index('cra',81)
    metadata = {}
    for r in rows:
        if r.get('situacaoDocumento') != 'A':
            continue
        codes = re.findall(r'BR[A-Z0-9]{10}',r.get('descricaoFundo','').upper())
        if not codes:
            continue
        key = (codes[-1],r['dataReferencia'],int(r['versao']))
        if key not in metadata or r['id'] > metadata[key]['id']:
            metadata[key] = r
    evidence = json.loads((ROOT/'evidencias.json').read_text(encoding='utf8'))
    # One original is enough for a CNPJ; select its most recent evidence.
    best = {}
    for e in sorted(evidence,key=lambda e:(e['data_evidencia'],e['versao']),reverse=True):
        if Decimal(e['percentual_fracao'] or '0') <= 0:
            continue
        period = e['data_evidencia'][5:7]+'/'+e['data_evidencia'][:4]
        m = metadata.get((e['codigo_operacao'],period,e['versao']))
        if m and e['cnpj'] not in best:
            best[e['cnpj']] = (e,m)
    save(ROOT/'indices_vinculados.json',{cnpj:{'evidencia':e,'documento_id':m['id'],
          'url_documento':BASE+f"exibirDocumento?id={m['id']}",'metadata':m} for cnpj,(e,m) in best.items()})
    wanted = sorted({m['id'] for e,m in best.values() if not cache_only or (ROOT/'originais'/f"{m['id']}.xml").exists()})
    results = {}
    with concurrent.futures.ThreadPoolExecutor(5) as ex:
        futures = {ex.submit(original,i,True):i for i in wanted}
        for count,future in enumerate(concurrent.futures.as_completed(futures),1):
            results[futures[future]] = future.result()
            if count%50==0:
                print('originais_conferidos',count,'/',len(wanted),flush=True)
    verified = {}
    for cnpj,(ev,m) in best.items():
        doc = results.get(m['id'])
        if not doc:
            continue
        if doc['codigo'].strip() != ev['codigo_operacao'] or doc['competencia'][:7] != ev['data_evidencia'][:7]:
            raise ValueError('Identidade ou competência do original divergente: '+str(m['id']))
        if normalize_cnpj(doc['cnpj_emissora']) != normalize_cnpj(ev['cnpj_securitizadora']):
            raise ValueError('Emissora do original divergente: '+str(m['id']))
        found = []
        for item in doc['cedentes']:
            try:
                if normalize_cnpj(item.get('CNPJ') or '') == cnpj:
                    found.append(item)
            except ValueError:
                pass
        if found:
            verified[cnpj] = {'evidencia':ev,'documento':doc,'registro_xml':found[0]}
    save(ROOT/'originais_verificados.json',verified)
    print(json.dumps({'cnpjs_com_original_conferido':len(verified),'documentos_baixados':len(wanted),
                      'cnpjs_sem_original_vinculado':sorted({e['cnpj'] for e in evidence}-verified.keys())}),flush=True)

if __name__=='__main__':
    import sys
    if '--completo' in sys.argv or '--cache' in sys.argv:
        complete(cache_only='--cache' in sys.argv)
        sys.exit(0)
    with concurrent.futures.ThreadPoolExecutor(4) as ex:
        fs = [ex.submit(index,'cri',86),ex.submit(index,'cra',81)]
        fs += [ex.submit(original,i) for i in (1046685,1205762,931289,869808,154959,995795,1049630)]
        for f in concurrent.futures.as_completed(fs):
            f.result()
