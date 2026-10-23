import os
import tempfile
import unittest

from ledger.importer import format_cents, read_statement


class ImporterTest(unittest.TestCase):
    def test_reads_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "s.csv")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write("date,description,amount\n2025-01-03,Groceries,(84.12)\n2025-01-09,Refund,$19.99\n")
            rows = read_statement(path)
        self.assertEqual([row.cents for row in rows], [-8412, 1999])

    def test_format_cents(self):
        self.assertEqual(format_cents(-6413), "-64.13")


if __name__ == "__main__":
    unittest.main()
