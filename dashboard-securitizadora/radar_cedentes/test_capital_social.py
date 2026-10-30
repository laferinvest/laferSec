import unittest
from decimal import Decimal

from radar_cedentes.capital_social import validate_capital, enrich

CNPJ = "61064911000177"
BRANCH = "61064911001734"


class CapitalSocialTest(unittest.TestCase):
    def test_localized_values_preserve_cents_and_zero_is_not_missing(self):
        for raw, expected in (("35000000,00", "35000000.00"),
                              ("1.234,56", "1234.56"), (Decimal("1234.56"), "1234.56"),
                              (0, "0.00")):
            result = validate_capital(CNPJ, {"cnpj": CNPJ, "capital_social": raw}, "url")
            self.assertEqual(result["capital_social"], expected)
            self.assertEqual(result["status"], "ok")
        absent = validate_capital(CNPJ, {"cnpj": CNPJ, "capital_social": None}, "url")
        self.assertIsNone(absent["capital_social"])
        self.assertEqual(absent["status"], "nao_informado")

    def test_wrong_company_response_and_invalid_amounts_are_rejected(self):
        with self.assertRaises(ValueError):
            validate_capital(CNPJ, {"cnpj": "05754060000113", "capital_social": 999}, "url")
        for raw in (True, -1, "NaN", "Infinity", "1.23,45", "123.456"):
            with self.subTest(value=raw), self.assertRaises(ValueError):
                validate_capital(CNPJ, {"cnpj": CNPJ, "capital_social": raw}, "url")

    def test_same_company_branches_share_registered_capital_without_changing_names(self):
        companies = [{"cnpj": CNPJ, "razao_social": "Nome original"},
                     {"cnpj": BRANCH, "razao_social": "Nome da filial"}]
        record = {**validate_capital(CNPJ, {"cnpj": CNPJ, "capital_social": "123,45"}, "url"),
                  "data_consulta": "2026-10-09T12:00:00Z"}
        result = enrich(companies, {CNPJ[:8]: record})
        self.assertEqual([row["capital_social"] for row in result], ["123.45", "123.45"])
        self.assertEqual([row["razao_social"] for row in result], ["Nome original", "Nome da filial"])
        self.assertEqual([row["cnpj"] for row in result], [CNPJ, BRANCH])
        with self.assertRaises(ValueError):
            enrich(companies, {CNPJ[:8]: {**record, "cnpj_basico": "05754060"}})


if __name__ == "__main__":
    unittest.main()
