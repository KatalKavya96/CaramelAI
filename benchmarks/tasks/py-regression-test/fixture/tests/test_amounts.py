import unittest

from ledger.amounts import parse_amount


class ParseAmountTest(unittest.TestCase):
    def test_plain_amount(self):
        self.assertEqual(parse_amount("12.34"), 1234)

    def test_accounting_negative(self):
        self.assertEqual(parse_amount("(12.00)"), -1200)

    def test_dollar_sign(self):
        self.assertEqual(parse_amount("$19.99"), 1999)


if __name__ == "__main__":
    unittest.main()
