import unittest

from listclean.dedupe import dedupe


class DedupeTest(unittest.TestCase):
    def test_exact_duplicates(self):
        self.assertEqual(dedupe(["a@x.com", "b@x.com", "a@x.com"]), ["a@x.com", "b@x.com"])

    def test_domain_case_is_ignored(self):
        self.assertEqual(dedupe(["bob@Example.COM", "bob@example.com"]), ["bob@Example.COM"])

    def test_local_case_is_kept_by_default(self):
        self.assertEqual(dedupe(["Bob@example.com", "bob@example.com"]), ["Bob@example.com", "bob@example.com"])

    def test_fold_case(self):
        self.assertEqual(dedupe(["Bob@example.com", "bob@example.com"], fold_case=True), ["Bob@example.com"])


if __name__ == "__main__":
    unittest.main()
