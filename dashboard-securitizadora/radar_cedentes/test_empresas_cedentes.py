import csv
import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path

from radar_cedentes.empresas_cedentes import (
    classify, export_companies, fund_register, validate_response,
)


FUND = "05754060000113"
SELLER = "61064911000177"


class CompanyExportTest(unittest.TestCase):
    def test_lookup_must_be_for_the_exact_seller_not_fund_or_another_branch(self):
        for other in (FUND, "61064911001734"):
            with self.subTest(cnpj=other), self.assertRaises(ValueError):
                validate_response(SELLER, {"cnpj": other, "razao_social": "Nome incorreto"}, "url")
        good = validate_response(SELLER, {"cnpj": SELLER, "razao_social": "Empresa cedente",
                                         "codigo_natureza_juridica": 2054}, "url")
        self.assertEqual(good["razao_social"], "Empresa cedente")

    def test_register_layout_excludes_class_but_keeps_its_administrator(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "cad_fi.csv").write_text(
                "CNPJ_FUNDO;DENOM_SOCIAL;CNPJ_ADMIN\n05.754.060/0001-13;Fundo antigo;61.064.911/0001-77\n",
                encoding="latin1")
            with zipfile.ZipFile(root / "registro_fundo_classe.zip", "w") as archive:
                archive.writestr("registro_classe.csv",
                                 "CNPJ_Classe;Denominacao_Social;CNPJ_Administrador\n"
                                 "02879250000179;Classe nova;61064911000177\n")
            funds = fund_register(root, download=False)
            self.assertIn(FUND, funds)
            self.assertIn("02879250000179", funds)
            self.assertNotIn(SELLER, funds)

    def test_business_with_fidc_in_its_name_is_not_excluded_by_keyword(self):
        business = {"status": "ok", "codigo_natureza_juridica": 2062,
                    "razao_social": "FIDC SERVICOS LTDA"}
        self.assertEqual(classify(SELLER, business, {}), "empresa")
        self.assertEqual(classify(SELLER, {**business, "codigo_natureza_juridica": 2224}, {}),
                         "fundo_ou_classe_cadastral")
        self.assertEqual(classify(SELLER, business, {SELLER: {}}), "fundo_ou_classe_cvm")

    def test_export_contains_only_two_columns_and_keeps_unresolved_out(self):
        with tempfile.TemporaryDirectory() as folder, sqlite3.connect(":memory:") as db:
            db.execute("CREATE TABLE evidencias(cnpj TEXT, vigente_na_fonte INTEGER)")
            db.executemany("INSERT INTO evidencias VALUES (?,1)",
                           [(SELLER,), (SELLER,), (FUND,), ("02879250000179",)])
            records = {SELLER: {"cnpj": SELLER, "razao_social": "Empresa cedente", "status": "ok",
                                "codigo_natureza_juridica": 2054}}
            report = export_companies(db, Path(folder), records, {FUND: {"nome": "Nome do fundo"}})
            with (Path(folder) / "empresas_cedentes.csv").open(encoding="utf-8-sig") as stream:
                reader = csv.DictReader(stream, delimiter=";")
                self.assertEqual(reader.fieldnames, ["cnpj", "razao_social"])
                self.assertEqual(list(reader), [{"cnpj": SELLER, "razao_social": "Empresa cedente"}])
            self.assertEqual(report["empresas"], 1)
            self.assertEqual(report["fundos_classes_excluidos"], 1)
            self.assertEqual(report["cadastros_pendentes"], 1)
            pending = json.loads((Path(folder) / "cadastros_pendentes.json").read_text())
            self.assertEqual(pending[0]["cnpj"], "02879250000179")


if __name__ == "__main__":
    unittest.main()
