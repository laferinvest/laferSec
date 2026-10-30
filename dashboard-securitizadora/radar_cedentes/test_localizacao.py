import unittest

from radar_cedentes.localizacao import validate_location


class LocationTest(unittest.TestCase):
    def test_another_branch_response_is_rejected_even_with_same_company_root(self):
        with self.assertRaises(ValueError):
            validate_location("61064911001734", {"cnpj": "61064911000177", "municipio": "SAO PAULO", "uf": "SP"}, "url")

    def test_brazilian_city_and_state_are_preserved(self):
        result = validate_location("61064911000177", {"cnpj": "61064911000177", "municipio": "PIRACICABA", "uf": "SP"}, "url")
        self.assertEqual((result["cidade"], result["uf"], result["status"]), ("PIRACICABA", "SP", "ok"))

    def test_foreign_domicile_does_not_get_a_brazilian_state(self):
        result = validate_location("26755245000112", {"cnpj": "26755245000112", "municipio": "EXTERIOR", "uf": "EX", "nome_cidade_exterior": "NUEVO LEON"}, "url")
        self.assertEqual(result["cidade"], "NUEVO LEON")
        self.assertEqual(result["uf"], "EX")
        self.assertEqual(result["status"], "exterior")


if __name__ == "__main__":
    unittest.main()
