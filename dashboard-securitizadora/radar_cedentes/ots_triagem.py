from collections import Counter
import json
from pathlib import Path
from .cvm_fidc import normalize_cnpj

root=Path('radar_cedentes/data/ots')
general=json.loads((root/'inf_mensal_ots_geral_2026.csv.json').read_text(encoding='utf8'))
cedentes=json.loads((root/'inf_mensal_ots_cedente_devedor_2026.csv.json').read_text(encoding='utf8'))
latest={}
for row in general:
    key=row['CNPJ_Securitizadora'],row['Codigo_Identificacao_Certificado']
    if key not in latest or (row['Data_Referencia'],int(row['Versao']))>(latest[key]['Data_Referencia'],int(latest[key]['Versao'])):
        latest[key]=row
ids={}
for row in cedentes:
    if row['Tipo']!='Cedente':
        continue
    try:
        cnpj=normalize_cnpj(row['CNPJ'])
    except ValueError:
        continue
    key=row['CNPJ_Securitizadora'],row['Codigo_Identificacao_Certificado']
    ids.setdefault(key,set()).add(cnpj)
rows=[]
for key,row in latest.items():
    rows.append({k:row[k] for k in ('Companhia_Securitizadora','Codigo_Identificacao_Certificado','Nome_Emissao','Tipo_Lastro','Detalhamento_Lastro','Segmento_Economico_Lastro','Principais_Caracteristicas_Lastro')}|{'cedentes':sorted(ids.get(key,[]))})
(root/'operacoes_triagem.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'operacoes':len(rows),'cnpjs':len({c for cs in ids.values() for c in cs}),
                  'lastros':Counter(r['Detalhamento_Lastro'] for r in rows)},ensure_ascii=False),flush=True)
for row in rows:
    if row['cedentes']:
        print(json.dumps(row,ensure_ascii=False),flush=True)
