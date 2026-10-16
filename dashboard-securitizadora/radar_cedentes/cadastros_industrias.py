"""Confere a identidade dos CNPJs candidatos em cadastro público, sem QSA/CPF."""
import concurrent.futures, hashlib, json, re, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path
from .cvm_fidc import normalize_cnpj

ROOT=Path(__file__).parent/'data'/'industrias'
CANDIDATES=['61143632000107','04664805000190','91967067000155','01838723000127',
 '01486546000167','33042730000104','11807230000183','61532198000149','07880049000125',
 '31008318000142','89637490000145','05917486000140','03853896000140','83250084000149',
 '88610191000154','87833737000173','05988913000181','27071778000148','23826083000178',
 '12936637000173','15115504000124','93899359000123','22931823000173']

def lookup(cnpj):
    assert normalize_cnpj(cnpj)==cnpj,cnpj
    path=ROOT/'cadastro'/f'{cnpj}.json'
    if path.exists():return json.loads(path.read_text(encoding='utf-8'))
    url='https://api.opencnpj.org/'+cnpj
    for attempt in range(3):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
            with urllib.request.urlopen(req,timeout=30) as response: raw=response.read()
            p=json.loads(raw)
            assert re.sub(r'\D','',p['cnpj'])==cnpj
            keys=['cnpj','razao_social','capital_social','municipio','uf','cnae_principal','cnaes_secundarios','situacao_cadastral','natureza_juridica']
            out={k:p.get(k) for k in keys}
            out.update(url_cadastro=url,data_consulta=datetime.now(timezone.utc).isoformat(),sha256=hashlib.sha256(raw).hexdigest())
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
            return out
        except Exception as exc:
            if attempt==2:return {'cnpj':cnpj,'erro':str(exc)}
            time.sleep(1+attempt)

if __name__=='__main__':
    old=json.loads((ROOT.parent/'exports'/'empresas_cedentes.json').read_text(encoding='utf-8'))
    prior={re.sub(r'\D','',r['cnpj']) for r in old}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        rows=list(pool.map(lookup,CANDIDATES))
    for r in rows:
        r['ja_constava_base_cvm_agosto']=r['cnpj'] in prior
        print(json.dumps({k:r.get(k) for k in ['cnpj','razao_social','cnae_principal','municipio','uf','ja_constava_base_cvm_agosto','erro']},ensure_ascii=False),flush=True)
    (ROOT/'cadastros.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
