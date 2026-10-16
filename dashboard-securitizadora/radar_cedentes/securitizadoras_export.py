"""Prepara as empresas e uma evidência rastreável por CNPJ para o Excel."""
from collections import Counter
from decimal import Decimal
import json

from .empresas_cedentes import fund_register
from .securitizadoras import DATA, ROOT, save

def main():
    records = json.loads((ROOT/'cadastros.json').read_text(encoding='utf8'))
    evidence = json.loads((ROOT/'evidencias.json').read_text(encoding='utf8'))
    verified_path = ROOT/'originais_verificados.json'
    verified = json.loads(verified_path.read_text(encoding='utf8')) if verified_path.exists() else {}
    index_path = ROOT/'indices_vinculados.json'
    linked = json.loads(index_path.read_text(encoding='utf8')) if index_path.exists() else {}
    funds = fund_register(DATA/'raw',download=False)
    by_cnpj = {}
    for ev in evidence:
        by_cnpj.setdefault(ev['cnpj'],[]).append(ev)
    companies, excluded, selected = [], [], []
    for row in records:
        row['razao_social'] = row.get('razao_social','').strip()
        cnpj = row['cnpj']
        nature = str(row.get('natureza_juridica') or '')
        if row['status'] != 'ok':
            reason = 'cadastro_nao_resolvido'
        elif cnpj in funds or nature == '2224':
            reason = 'fundo_ou_classe'
        elif nature != 'empresa_verificada_no_primeiro_coletor' and not (nature.isdigit() and 2000<=int(nature)<3000):
            reason = 'outra_entidade'
        else:
            reason = None
        positive = [e for e in by_cnpj[cnpj] if e['percentual_fracao'] is not None and Decimal(e['percentual_fracao'])>0]
        if not reason and not positive:
            reason = 'somente_percentual_zero_ou_ausente'
        if reason:
            excluded.append({**row,'motivo':reason})
            continue
        company = {**row,'aparece_na_lista_fidc':nature=='empresa_verificada_no_primeiro_coletor'}
        companies.append(company)
        proof = verified.get(cnpj)
        if proof and proof['evidencia'] in positive:
            ev = {**proof['evidencia'],'url_documento':proof['documento']['url'],
                  'url_xml':proof['documento']['url_original'],
                  'documento_id':proof['documento']['id'],
                  'sha256_documento':proof['documento']['sha256'],
                  'campo_xml':'CedentesRepresentamMais20Porcento/Cedente/CNPJ',
                  'conferencia_original':True}
            raw = proof['registro_xml'].get('Percentual')
            if raw is not None and ev['percentual_fracao'] is not None:
                if abs(Decimal(raw) - Decimal(ev['percentual_fracao'])) > Decimal('0.0000000001'):
                    raise ValueError('Percentual divergente do XML: '+cnpj)
        elif cnpj in linked and linked[cnpj]['evidencia'] in positive:
            reference = linked[cnpj]
            ev = {**reference['evidencia'],'url_documento':reference['url_documento'],
                  'documento_id':reference['documento_id'],
                  'conferencia_original':False,'vinculo_indice_fnet':True}
        else:
            ev = {**max(positive,key=lambda e:(e['data_evidencia'],e['versao'])),
                  'url_documento':None,'conferencia_original':False}
        selected.append({**ev,'razao_social':row['razao_social'],'url_cadastro':row['url_cadastro'],
                         'data_consulta_cadastro':row.get('data_consulta') or row.get('data_consulta_localizacao')})
    companies.sort(key=lambda r:(r['razao_social'].casefold(),r['cnpj']))
    selected.sort(key=lambda r:(r['razao_social'].casefold(),r['cnpj']))
    report = {'empresas':len(companies),'excluidos':dict(Counter(r['motivo'] for r in excluded)),
              'novos_em_relacao_fidc':sum(not r['aparece_na_lista_fidc'] for r in companies),
              'ja_na_lista_fidc':sum(r['aparece_na_lista_fidc'] for r in companies),
              'com_original_conferido':sum(r['conferencia_original'] for r in selected),
              'com_link_fundosnet':sum(bool(r.get('url_documento')) for r in selected),
              'demais_com_evidencia_csv_oficial':sum(not r['conferencia_original'] for r in selected),
              'capitais_ausentes':sum(r.get('capital_social') is None for r in companies),
              'cidades_ausentes':sum(not r.get('cidade') for r in companies),
              'estados_ausentes':sum(not r.get('estado') for r in companies),
              'uf_exterior':sum(r.get('estado')=='EX' for r in companies),
              'periodo':json.loads((ROOT/'coleta.json').read_text(encoding='utf8'))}
    save(ROOT/'empresas_planilha.json',companies)
    save(ROOT/'evidencias_planilha.json',selected)
    save(ROOT/'excluidos.json',excluded)
    save(ROOT/'relatorio_final.json',report)
    print(json.dumps(report,ensure_ascii=False),flush=True)

if __name__=='__main__':
    main()
