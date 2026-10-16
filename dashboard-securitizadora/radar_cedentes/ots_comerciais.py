"""Triagem estrita de cedentes de duplicatas e créditos comerciais em OTS."""
from collections import Counter
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import unicodedata
from .cvm_fidc import normalize_cnpj

root=Path('radar_cedentes/data/ots')
def folded(s):
    return ''.join(c for c in unicodedata.normalize('NFD',s.lower()) if not unicodedata.combining(c))

evidences=[]
count=Counter()
all_ids=set()
for year in (2023,2024,2025,2026):
    general=json.loads((root/f'inf_mensal_ots_geral_{year}.csv.json').read_text(encoding='utf8'))
    rows=json.loads((root/f'inf_mensal_ots_cedente_devedor_{year}.csv.json').read_text(encoding='utf8'))
    def key(r):
        return tuple(r[k] for k in ('CNPJ_Securitizadora','Codigo_Identificacao_Certificado','Data_Referencia','Versao'))
    contexts={key(r):r for r in general}
    count['informes_gerais']+=len(general)
    for rownum,row in enumerate(rows,2):
        count['linhas_cedente_devedor']+=1
        if row['Tipo']!='Cedente':
            continue
        try:
            cnpj=normalize_cnpj(row['CNPJ'])
        except ValueError:
            continue
        all_ids.add(cnpj)
        if not row['Percentual'] or Decimal(row['Percentual'])<=0:
            continue
        context=contexts.get(key(row))
        if context is None:
            raise ValueError('Sem contexto: '+str(row))
        detail=folded(context['Detalhamento_Lastro'])
        eligible = any(term in detail for term in ('duplicat','mercant','nota fiscal','notas fiscais'))
        if not eligible:
            continue
        evidences.append({'cnpj':cnpj,'fonte_tipo':'Fundos.NET / Outros Títulos de Securitização',
            'data_evidencia':row['Data_Referencia'],'tipo_credito':context['Detalhamento_Lastro'],
            'operacao':context['Nome_Emissao'],'codigo_operacao':row['Codigo_Identificacao_Certificado'],
            'securitizadora':context['Companhia_Securitizadora'],'cnpj_securitizadora':row['CNPJ_Securitizadora'],
            'percentual_fracao':row['Percentual'],'arquivo':f'inf_mensal_ots_cedente_devedor_{year}.csv',
            'linha_csv':rownum,'contexto':context,'registro_original':row,
            'url_fonte':f'https://dados.cvm.gov.br/dados/SECURIT/DOC/INF_MENSAL_OTS/DADOS/inf_mensal_ots_{year}.zip',
            'sha256_zip':hashlib.sha256((root/f'inf_mensal_ots_{year}.zip').read_bytes()).hexdigest()})
(root/'evidencias_comerciais.json').write_text(json.dumps(evidences,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'contagens':count,'cnpjs_declarados_cedentes':len(all_ids),'cnpjs_com_lastro_comercial':sorted({r['cnpj'] for r in evidences}),
                  'evidencias_comerciais':len(evidences),'exemplos':evidences[-1:]},ensure_ascii=False),flush=True)
