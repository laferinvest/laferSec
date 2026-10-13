import csv
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import zipfile

from radar_cedentes.cvm_fidc import (
    DATA_URL, HISTORY_URL, LayoutError, SCHEMA, available_months, export_database,
    extract, file_hash, normalize_cnpj, parse_percent, persist, preserve_archive,
)


FUND = "05.754.060/0001-13"
SELLER = "61064911000177"
SELLER_2 = "02879250000179"
MEMBER = "inf_mensal_fidc_tab_I_202608.csv"
URL = DATA_URL + "inf_mensal_fidc_202608.zip"


def row(**updates):
    record = {
        "TP_FUNDO_CLASSE": "Classe", "CNPJ_FUNDO_CLASSE": FUND,
        "DENOM_SOCIAL": "FIDC de teste – indústria", "DT_COMPTC": "2026-08-31",
        "ADMIN": "Administrador de teste", "CNPJ_ADMIN": "00.066.670/0001-00",
        "CNPJ_CLASSE": "05754060000113", "CLASSE": "Classe única",
        "TAB_I2A12_CPF_CNPJ_CEDENTE_1": SELLER, "TAB_I2A12_PR_CEDENTE_1": "69.48",
        "TAB_I2B12_CPF_CNPJ_CEDENTE_1": "", "TAB_I2B12_PR_CEDENTE_1": "",
        "CPF_CNPJ_SACADO": SELLER_2,
    }
    record.update(updates)
    return record


def create_zip(root, records, name="inf_mensal_fidc_202608.zip", encoding="utf-8", member=MEMBER):
    text = io.StringIO(newline="")
    writer = csv.DictWriter(text, fieldnames=list(records[0]), delimiter=";")
    writer.writeheader()
    writer.writerows(records)
    destination = Path(root) / name
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member, text.getvalue().encode(encoding))
    return destination


class DocumentValidationTest(unittest.TestCase):
    def test_cnpj_preserves_zeroes_and_validates_digit(self):
        self.assertEqual(normalize_cnpj("02.879.250/0001-79"), SELLER_2)
        self.assertEqual(normalize_cnpj("6084614000185"), "06084614000185")
        for value in ("61064911000178", "99.999.999/9999-99", "00000000000000",
                      "529.982.247-25", "123", "CNPJ: 61064911000177", "61064911000177.0"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_cnpj(value)

    def test_receita_official_alphanumeric_example(self):
        self.assertEqual(normalize_cnpj("12.abc.345/01de-35"), "12ABC34501DE35")
        with self.assertRaises(ValueError):
            normalize_cnpj("12ABC34501DE36")

    def test_percentage_is_not_a_fraction_or_capped_at_100(self):
        self.assertEqual(parse_percent("69.48"), ("69.48", None))
        self.assertEqual(parse_percent("69,48"), ("69.48", None))
        self.assertEqual(parse_percent("1156.65"), ("1156.65", "percentual_acima_100_revisar"))
        self.assertEqual(parse_percent("8.00"), ("8.00", "percentual_ate_10_revisar"))
        for value in ("NaN", "Infinity", "-1", "texto"):
            self.assertEqual(parse_percent(value), (None, "percentual_invalido"))

    def test_discovery_includes_annual_history(self):
        self.assertEqual(available_months({"2024": HISTORY_URL + "inf_mensal_fidc_2024.zip",
                                          "202608": URL})[-2:], ["202412", "202608"])


class ExtractionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def parse(self, records, **kwargs):
        archive = create_zip(self.temp.name, records, **kwargs)
        return extract(archive, {"202608"}, URL, file_hash(archive))

    def test_cedente_is_distinct_from_sacado_and_fund_name(self):
        evidence, stats, rejected, _ = self.parse([row()])
        self.assertEqual(len(evidence), 1)
        self.assertEqual(evidence[0]["cnpj"], SELLER)
        self.assertIsNone(evidence[0]["razao_social"])
        self.assertIsNone(evidence[0]["cnpj_fundo"])
        self.assertEqual(evidence[0]["cnpj_classe"], "05754060000113")
        self.assertEqual(evidence[0]["fundo_ou_operacao"], "FIDC de teste – indústria")
        self.assertIsNone(evidence[0]["tipo_direito_creditorio"])
        self.assertEqual(evidence[0]["campo_identificacao"], "TAB_I2A12_CPF_CNPJ_CEDENTE_1")
        self.assertEqual(evidence[0]["registro_csv"], 1)
        self.assertEqual(evidence[0]["linha_final_csv"], 2)
        self.assertEqual(stats["evidencias_cnpj_validado"], 1)
        self.assertEqual(rejected, [])

    def test_both_risk_blocks_are_separate_evidence(self):
        evidence, _, _, _ = self.parse([row(TAB_I2B12_CPF_CNPJ_CEDENTE_1=SELLER,
                                           TAB_I2B12_PR_CEDENTE_1="12.38")])
        self.assertEqual(len(evidence), 2)
        self.assertNotEqual(evidence[0]["id"], evidence[1]["id"])
        self.assertNotEqual(evidence[0]["bloco_riscos_beneficios"], evidence[1]["bloco_riscos_beneficios"])

    def test_rejects_cpf_without_disclosing_it_in_rejections(self):
        evidence, stats, rejected, _ = self.parse([row(TAB_I2A12_CPF_CNPJ_CEDENTE_1="52998224725")])
        self.assertEqual(evidence, [])
        self.assertEqual(stats["rejeitados_cpf_ou_identificador_ambiguo"], 1)
        self.assertNotIn("52998224725", json.dumps(rejected))

    def test_legacy_fund_identifier_and_latin1(self):
        legacy = row(DENOM_SOCIAL="FIDC indústria")
        legacy["CNPJ_FUNDO"] = legacy.pop("CNPJ_FUNDO_CLASSE")
        legacy.pop("TP_FUNDO_CLASSE")
        evidence, _, _, _ = self.parse([legacy], encoding="latin-1")
        self.assertEqual(evidence[0]["cnpj_fundo"], "05754060000113")
        self.assertEqual(evidence[0]["fundo_ou_operacao"], "FIDC indústria")

    def test_missing_month_or_changed_schema_fails_closed(self):
        records = [row()]
        records[0].pop("TAB_I2A12_PR_CEDENTE_1")
        with self.assertRaises(LayoutError):
            self.parse(records)
        with self.assertRaises(LayoutError):
            self.parse([row(DT_COMPTC="2026-07-31")])
        with self.assertRaises(LayoutError):
            self.parse([row(), row()])
        with self.assertRaises(LayoutError):
            self.parse([row(TAB_I_NOVO_CEDENTE="61064911000177")])

    def test_archive_is_retained_and_verified(self):
        archive = create_zip(self.temp.name, [row()])
        retained, digest = preserve_archive(archive, Path(self.temp.name) / "raw")
        self.assertEqual(retained.read_bytes(), archive.read_bytes())
        self.assertEqual(file_hash(retained), digest)
        retained.write_bytes(b"corrupted")
        with self.assertRaises(LayoutError):
            preserve_archive(archive, Path(self.temp.name) / "raw")


class PersistenceTest(unittest.TestCase):
    def test_reruns_and_retractions_keep_history_without_duplicate_leads(self):
        with tempfile.TemporaryDirectory() as temp, sqlite3.connect(":memory:") as db:
            db.executescript(SCHEMA)
            archive = create_zip(temp, [row(TAB_I2B12_CPF_CNPJ_CEDENTE_1=SELLER_2,
                                            TAB_I2B12_PR_CEDENTE_1="15.00")])
            digest = file_hash(archive)
            evidence, stats, rejected, months = extract(archive, {"202608"}, URL, digest)
            for _ in range(2):
                persist(db, evidence, months, URL, archive, digest, stats, rejected)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM cedentes").fetchone()[0], 2)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM evidencias").fetchone()[0], 2)
            # Uma reapresentação remove todos os cedentes identificados, sem apagar prova anterior.
            revised = create_zip(temp, [row(TAB_I2A12_CPF_CNPJ_CEDENTE_1="")])
            revised_hash = file_hash(revised)
            current, stats, rejected, months = extract(revised, {"202608"}, URL, revised_hash)
            persist(db, current, months, URL, revised, revised_hash, stats, rejected)
            totals = export_database(db, Path(temp) / "exports")
            self.assertEqual(totals, {"cnpjs_unicos": 0, "evidencias_vigentes": 0, "evidencias_historicas": 2})
            # Reimportar a versão original reativa as mesmas evidências.
            persist(db, evidence, months, URL, archive, digest, stats, rejected)
            self.assertEqual(db.execute("SELECT SUM(vigente_na_fonte) FROM evidencias").fetchone()[0], 2)

    def test_two_funds_and_months_produce_one_company_with_all_evidence(self):
        with tempfile.TemporaryDirectory() as temp, sqlite3.connect(":memory:") as db:
            db.executescript(SCHEMA)
            for month, dt, fund in (("202608", "2026-08-31", FUND),
                                    ("202609", "2026-09-30", "06.182.371/0001-18")):
                archive = create_zip(temp, [row(DT_COMPTC=dt, CNPJ_FUNDO_CLASSE=fund)],
                                     name=f"inf_mensal_fidc_{month}.zip", member=f"inf_mensal_fidc_tab_I_{month}.csv")
                url = DATA_URL + archive.name
                digest = file_hash(archive)
                evidence, stats, rejected, months = extract(archive, {month}, url, digest)
                persist(db, evidence, months, url, archive, digest, stats, rejected)
            totals = export_database(db, Path(temp) / "exports")
            self.assertEqual(totals["cnpjs_unicos"], 1)
            self.assertEqual(totals["evidencias_vigentes"], 2)
            with (Path(temp) / "exports/cedentes.csv").open(encoding="utf-8-sig") as stream:
                rows = list(csv.DictReader(stream, delimiter=";"))
            self.assertEqual(rows[0]["quantidade_fundos_classes"], "2")


if __name__ == "__main__":
    unittest.main()
