import os
import tempfile
import unittest

from beacon.config import ConfigError, load_config


def ini(text: str) -> str:
    handle = tempfile.NamedTemporaryFile("w", suffix=".ini", delete=False)
    handle.write(text)
    handle.close()
    return handle.name


class LoadConfigTest(unittest.TestCase):
    def test_defaults(self):
        self.assertEqual(load_config(environ={})["port"], 8000)

    def test_ini_values_are_typed(self):
        path = ini("[server]\nport = 7000\ndebug = yes\nworkers = 4\n")
        try:
            config = load_config(path, environ={})
        finally:
            os.unlink(path)
        self.assertEqual((config["port"], config["debug"], config["workers"]), (7000, True, 4))

    def test_bad_port_in_ini(self):
        path = ini("[server]\nport = 70000\n")
        try:
            with self.assertRaises(ConfigError):
                load_config(path, environ={})
        finally:
            os.unlink(path)

    def test_env_overrides_text_setting(self):
        self.assertEqual(load_config(environ={"BEACON_HOST": "0.0.0.0"})["host"], "0.0.0.0")


if __name__ == "__main__":
    unittest.main()
