"""Conferência independente de CNPJ, papel, origem, período e dados cadastrais."""
import csv
from decimal import Decimal
import hashlib
import io
import json
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET

from .cvm_fidc import normalize_cnpj
from .securitizadoras import ROOT, read_table

def main():
    companies = json.loads((ROOT/'empresas_planilha.json').read_text(encoding='utf8'))
    proofs = json.loads((ROOT/'evidencias_planilha.json').read_text(encoding='utf8'))
    assert len(companies) == len(proofs) == len({r['cnpj'] for r in companies})
    expected = {r['cnpj']:r for r in companies}
    source_rows = {}
    for kind in ('cri','cra'):
        path = ROOT/f'inf_mensal_{kind}_2026.zip'
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        with zipfile.ZipFile(path) as archive:
            name = f'inf_mensal_{kind}_cedente_devedor_2026.csv'
            for i,row in enumerate(read_table(archive,name),2):
                source_rows[(name,i)] = (row,digest)
    originals = 0
    for proof in proofs:
        company = expected[proof['cnpj']]
        row,digest = source_rows[(proof['arquivo'],proof['linha_csv'])]
        assert row['Tipo'] == 'Cedente'
        assert normalize_cnpj(row['CNPJ']) == company['cnpj'] == proof['cnpj']
        assert row == proof['registro_original'] and digest == proof['sha256_zip']
        assert row['Data_Referencia'] == proof['data_evidencia']
        assert row['Codigo_Identificacao_Certificado'] == proof['codigo_operacao']
        assert Decimal(row['Percentual']) == Decimal(proof['percentual_fracao']) > 0
        assert company['razao_social'] == proof['razao_social']
        assert company['cidade'] and company['estado'] and Decimal(company['capital_social']) >= 0
        if proof['conferencia_original']:
            raw = (ROOT/'originais'/f"{proof['documento_id']}.xml").read_bytes()
            assert hashlib.sha256(raw).hexdigest() == proof['sha256_documento']
            root = ET.fromstring(raw)
            found = []
            for node in root.findall('.//CedentesRepresentamMais20Porcento/Cedente'):
                try:
                    if normalize_cnpj(node.findtext('CNPJ') or '') == proof['cnpj']:
                        found.append(node)
                except ValueError:
                    pass
            assert found
            assert any(abs(Decimal(n.findtext('Percentual'))-Decimal(proof['percentual_fracao']))<=Decimal('1e-10') for n in found)
            originals += 1
    print(json.dumps({'empresas_conferidas':len(companies),'cedente_cnpj_campo_e_linha_csv_conferidos':True,
                      'cnpjs_com_xml_original_conferido':originals,'maior_percentual_fracao':str(max(Decimal(r['percentual_fracao']) for r in proofs)),
                      'percentuais_acima_100_pct':sum(Decimal(r['percentual_fracao'])>1 for r in proofs),
                      'nomes_com_fundo_para_revisao':[(r['cnpj'],r['razao_social']) for r in companies if 'FUNDO' in r['razao_social']],
                      'resultado':'OK'},ensure_ascii=False),flush=True)

if __name__=='__main__':
    main()
