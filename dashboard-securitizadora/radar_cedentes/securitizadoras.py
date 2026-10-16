"""Cedentes de CRI/CRA: informes Fundos.NET consolidados pela CVM, com evidência."""
from __future__ import annotations

import argparse
from collections import Counter
import concurrent.futures
import csv
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import time
import urllib.error
import urllib.request
import zipfile

from .cvm_fidc import normalize_cnpj
from .capital_social import validate_capital
from .empresas_cedentes import HEADERS, RateLimiter
from .localizacao import validate_location

DATA = Path(__file__).resolve().parent/'data'
ROOT = DATA/'fnet'

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix+'.part')
    temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8')
    temporary.replace(path)

def read_table(archive, name):
    raw = archive.read(name)
    try:
        text = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        text = raw.decode('latin1')
    return csv.DictReader(io.StringIO(text),delimiter=';')

def extract(year):
    evidence, summaries, rejected = [], [], []
    for kind in ('cri','cra'):
        path = ROOT/f'inf_mensal_{kind}_{year}.zip'
        url = f'https://dados.cvm.gov.br/dados/SECURIT/DOC/INF_MENSAL_{kind.upper()}/DADOS/{path.name}'
        if not path.exists():
            raw = urllib.request.urlopen(urllib.request.Request(url,headers=HEADERS),timeout=60).read()
            path.write_bytes(raw)
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        with zipfile.ZipFile(path) as archive:
            def key(row):
                return tuple(row[field].strip() for field in ('CNPJ_Emissora','Codigo_Identificacao_Certificado','Data_Referencia'))
            general = {}
            for row in read_table(archive, f'inf_mensal_{kind}_geral_{year}.csv'):
                k = key(row)
                if k not in general or int(row['Versao']) > int(general[k]['Versao']):
                    general[k] = row
            source = f'inf_mensal_{kind}_cedente_devedor_{year}.csv'
            reader = read_table(archive,source)
            required = {'CNPJ_Emissora','Codigo_Identificacao_Certificado','Data_Referencia','Versao','Tipo','CNPJ','Percentual'}
            if set(reader.fieldnames) != required:
                raise ValueError('Layout de cedentes alterado: '+source)
            counts = Counter()
            for row_number, row in enumerate(reader,2):
                counts['linhas_cedente_devedor'] += 1
                if row['Tipo'].strip() != 'Cedente':
                    counts['devedores_nao_usados'] += 1
                    continue
                k = key(row)
                context = general.get(k)
                if context is None:
                    raise ValueError('Informe sem contexto geral: '+str(k))
                if row['Versao'] != context['Versao']:
                    counts['versoes_anteriores'] += 1
                    continue
                try:
                    cnpj = normalize_cnpj(row['CNPJ'])
                except ValueError as exc:
                    counts['cedente_sem_cnpj_valido'] += 1
                    rejected.append({'tipo':kind.upper(),'arquivo':source,'linha':row_number,'motivo':str(exc),'registro':row})
                    continue
                raw_percent = row['Percentual'].strip()
                percent = Decimal(raw_percent) if raw_percent else None
                if percent is not None and (not percent.is_finite() or percent < 0):
                    raise ValueError('Percentual inválido: '+str(row))
                ev = {
                    'cnpj':cnpj, 'fonte_tipo':'Fundos.NET / CRI-CRA (CVM consolidado)',
                    'papel':'cedente','tipo_operacao':kind.upper(),
                    'cnpj_securitizadora':k[0], 'securitizadora':context['Companhia_Emissora'],
                    'codigo_operacao':k[1], 'operacao':context['Nome_Emissao'],
                    'numero_emissao':context['Numero_Emissao'], 'data_evidencia':k[2],
                    'versao':int(row['Versao']), 'data_entrega':context['Data_Entrega'],
                    'percentual_fracao':str(percent) if percent is not None else None,
                    'tipo_credito':context.get('Detalhamento_Lastro') or context.get('Tipo_Lastro'),
                    'url_fonte':url,'arquivo':source,'linha_csv':row_number,'pagina':None,
                    'trecho_evidencia':'; '.join(f'{field}={row[field]}' for field in ('Tipo','CNPJ','Percentual')),
                    'registro_original':row,'sha256_zip':sha,
                    'data_coleta':datetime.now(timezone.utc).isoformat(),
                }
                evidence.append(ev)
                counts['evidencias_cedentes_validos'] += 1
            summaries.append({'tipo':kind.upper(),'url':url,'sha256':sha,'informes':len(general),
                              'competencias':sorted({k[2] for k in general}),**counts})
    # Only exact repeated source rows collapse; all appearances across months/operations remain.
    unique = {(e['tipo_operacao'],e['arquivo'],e['linha_csv'],e['sha256_zip']):e for e in evidence}
    evidence = list(unique.values())
    save(ROOT/'evidencias.json',evidence)
    save(ROOT/'rejeitados.json',rejected)
    save(ROOT/'coleta.json',{'ano':year,'fontes':summaries,'evidencias':len(evidence),'cnpjs':len({e['cnpj'] for e in evidence})})
    with sqlite3.connect(DATA/'radar.sqlite3') as db:
        db.execute('CREATE TABLE IF NOT EXISTS evidencias_securitizadoras (id TEXT PRIMARY KEY, cnpj TEXT NOT NULL, data_evidencia TEXT NOT NULL, dados_json TEXT NOT NULL)')
        for ev in evidence:
            serial = json.dumps(ev,ensure_ascii=False)
            identity = '|'.join(str(ev[k]) for k in ('sha256_zip','arquivo','linha_csv'))
            db.execute('INSERT OR REPLACE INTO evidencias_securitizadoras VALUES (?,?,?,?)',
                       (hashlib.sha256(identity.encode()).hexdigest(),ev['cnpj'],ev['data_evidencia'],serial))
    print(json.dumps({'etapa':'extracao','fontes':summaries,'cnpjs':len({e['cnpj'] for e in evidence})},ensure_ascii=False),flush=True)
    return evidence

def lookup(cnpj, limiter):
    path = ROOT/'cadastro'/f'{cnpj}.json'
    if path.exists():
        cached = json.loads(path.read_text(encoding='utf8'))
        if cached.get('status') == 'ok' and cached.get('cnpj') == cnpj:
            return cached
    url = 'https://api.opencnpj.org/'+cnpj
    record = {'cnpj':cnpj,'url_cadastro':url,'status':'erro'}
    for attempt in range(3):
        limiter.wait()
        try:
            raw = urllib.request.urlopen(urllib.request.Request(url,headers=HEADERS),timeout=20).read()
            payload = json.loads(raw)
            capital = validate_capital(cnpj,payload,url)
            location = validate_location(cnpj,payload,url)
            if not payload.get('razao_social'):
                raise ValueError('Razão social ausente')
            nature = payload.get('codigo_natureza_juridica') or payload.get('natureza_juridica')
            record.update(razao_social=payload['razao_social'],capital_social=capital['capital_social'],
                          cidade=location['cidade'],estado=location['uf'],natureza_juridica=nature,
                          status='ok',sha256=hashlib.sha256(raw).hexdigest())
            break
        except (OSError,ValueError) as exc:
            record['erro'] = str(exc)
            if isinstance(exc,urllib.error.HTTPError) and exc.code in (401,403,404):
                break
            if attempt < 2:
                time.sleep(2**attempt)
    record['data_consulta'] = datetime.now(timezone.utc).isoformat()
    save(path,record)
    return record

def enrich(evidence,offline):
    ids = sorted({e['cnpj'] for e in evidence})
    old_path = DATA/'exports/empresas_cedentes_localizacao.json'
    previous = {r['cnpj']:r for r in json.loads(old_path.read_text(encoding='utf8'))} if old_path.exists() else {}
    records, missing = {}, []
    for cnpj in ids:
        if cnpj in previous:
            old = previous[cnpj]
            records[cnpj] = {**old,'status':'ok','natureza_juridica':'empresa_verificada_no_primeiro_coletor',
                             'url_cadastro':old.get('url_localizacao')}
        else:
            missing.append(cnpj)
    if offline:
        for cnpj in missing:
            records[cnpj] = json.loads((ROOT/'cadastro'/f'{cnpj}.json').read_text(encoding='utf8'))
    else:
        limiter = RateLimiter(0.22)
        with concurrent.futures.ThreadPoolExecutor(5) as ex:
            futures = [ex.submit(lookup,cnpj,limiter) for cnpj in missing]
            for count,future in enumerate(concurrent.futures.as_completed(futures),1):
                row = future.result()
                records[row['cnpj']] = row
                if count % 50 == 0:
                    print(json.dumps({'cadastros_consultados':count,'total_novos':len(missing)}),flush=True)
    save(ROOT/'cadastros.json',[records[c] for c in ids])
    print(json.dumps({'cadastros':len(records),'reaproveitados_lista_fidc':len(ids)-len(missing),
                      'novos_consultados':len(missing),'status':dict(Counter(r['status'] for r in records.values())),
                      'naturezas':dict(Counter(str(r.get('natureza_juridica')) for r in records.values()))},ensure_ascii=False),flush=True)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--ano',type=int,default=2026)
    p.add_argument('--etapa',choices=('extrair','enriquecer','todas'),default='todas')
    p.add_argument('--offline',action='store_true')
    args = p.parse_args()
    ROOT.mkdir(parents=True,exist_ok=True)
    evidence = extract(args.ano) if args.etapa != 'enriquecer' else json.loads((ROOT/'evidencias.json').read_text(encoding='utf8'))
    if args.etapa != 'extrair':
        enrich(evidence,args.offline)

if __name__ == '__main__':
    main()
