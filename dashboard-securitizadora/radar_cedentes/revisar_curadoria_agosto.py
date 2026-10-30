import json
from pathlib import Path
ROOT=Path(__file__).parent/'data'/'curadoria_industrias'
rows=json.loads((ROOT/'classificacao.json').read_text(encoding='utf8'))
exceptions=json.loads((ROOT/'excecoes_verificadas.json').read_text(encoding='utf8'))
for d in rows:
    cad=d['cadastro']
    if d['cnpj'] in exceptions:
        sec=[str(c) for c in cad['cnaes_secundarios'] if 10<=int(str(c)[:2])<=32]
        assert sec
        d.update(incluir=True,motivo='CNAE secundário de fabricação e atividade industrial confirmada em fonte pública',cnae_industrial=sec[0],fonte_classificacao=exceptions[d['cnpj']])
    elif d['incluir']:
        d.update(cnae_industrial=str(cad['cnae_principal']),fonte_classificacao=cad['url_cadastro'])
assert set(exceptions).issubset({r['cnpj'] for r in rows})
(ROOT/'classificacao.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'selecionadas':sum(d['incluir'] for d in rows),'excluidas':sum(not d['incluir'] for d in rows),'excecoes':len(exceptions)},ensure_ascii=True))
