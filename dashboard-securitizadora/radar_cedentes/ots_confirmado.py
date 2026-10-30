"""Exporta somente o cedente confirmado de duplicatas comerciais em OTS."""
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import urllib.request

from .capital_social import validate_capital
from .localizacao import validate_location
from .securitizadoras import save

root=Path('radar_cedentes/data/ots')
cnpj='31008318000142'
url='https://api.opencnpj.org/'+cnpj
cache=root/'cadastro_guerra.json'
if cache.exists():
    record=json.loads(cache.read_text(encoding='utf8'))
else:
    raw=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=25).read()
    p=json.loads(raw)
    cap=validate_capital(cnpj,p,url)
    loc=validate_location(cnpj,p,url)
    record={'cnpj':cnpj,'razao_social':p['razao_social'].strip(),'capital_social':cap['capital_social'],
            'cidade':loc['cidade'],'estado':loc['uf'],'cnae_principal':p.get('cnae_principal'),
            'url_cadastro':url,'sha256_cadastro':hashlib.sha256(raw).hexdigest(),
            'data_consulta':datetime.now(timezone.utc).isoformat()}
    save(cache,record)
evidence=json.loads((root/'evidencias_comerciais.json').read_text(encoding='utf8'))
latest=max((r for r in evidence if r['cnpj']==cnpj),key=lambda r:r['data_evidencia'])
assert latest['registro_original']['Tipo']=='Cedente' and latest['tipo_credito']=='Duplicata'
assert Decimal(latest['percentual_fracao'])>0
latest.update(razao_social=record['razao_social'],papel='cedente / endossante',
              url_documento='https://fnet.bmfbovespa.com.br/fnet/publico/exibirDocumento?id=1071579',
              pagina=15,data_documento='2025-09-30',
              trecho_evidencia='correspondem a duplicatas comerciais endossadas pela Guerra Implementos Rodoviários S.A.',
              url_cadastro=record['url_cadastro'],data_consulta=record['data_consulta'],
              data_coleta=datetime.now(timezone.utc).isoformat())
save(root/'empresas_confirmadas.json',[record])
save(root/'provas_confirmadas.json',[latest])
save(root/'relatorio_confirmado.json',{'periodo_pesquisado':'2023 a 2026','informes_ots':5173,
      'cnpjs_cedentes_ots':24,'empresas_comerciais_confirmadas':1,
      'criterio':'CNPJ explicitamente declarado como cedente e lastro de duplicatas comerciais, corroborado por relatório de operação realizada. Não incluir CRI, CRA, notas comerciais ou empréstimos apenas por a devedora ser industrial.'})
print(json.dumps(record,ensure_ascii=False),flush=True)
