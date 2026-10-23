import configparser
import os
from collections.abc import Mapping

DEFAULTS = {
    "host": "127.0.0.1",
    "port": 8000,
    "debug": False,
    "workers": 2,
    "log_level": "info",
}

TRUE_WORDS = {"1", "true", "yes", "on"}
FALSE_WORDS = {"0", "false", "no", "off"}


class ConfigError(Exception):
    pass


def coerce(key: str, raw: str):
    """Turn a text value into the type of the setting's default."""
    default = DEFAULTS[key]
    if isinstance(default, bool):
        word = raw.strip().lower()
        if word in TRUE_WORDS:
            return True
        if word in FALSE_WORDS:
            return False
        raise ConfigError(f"{key} must be true or false, got {raw!r}")
    if isinstance(default, int):
        try:
            return int(raw.strip())
        except ValueError:
            raise ConfigError(f"{key} must be a whole number, got {raw!r}") from None
    return raw.strip()


def validate(config: dict) -> None:
    if not 1 <= config["port"] <= 65535:
        raise ConfigError(f"port must be between 1 and 65535, got {config['port']}")
    if config["workers"] < 1:
        raise ConfigError("workers must be at least 1")


def load_config(path: str | None = None, environ: Mapping[str, str] | None = None) -> dict:
    environ = os.environ if environ is None else environ
    config = dict(DEFAULTS)

    if path is not None:
        parser = configparser.ConfigParser()
        if not parser.read(path):
            raise ConfigError(f"cannot read {path}")
        if parser.has_section("server"):
            for key, raw in parser["server"].items():
                if key not in DEFAULTS:
                    raise ConfigError(f"unknown setting {key!r} in {path}")
                config[key] = coerce(key, raw)

    for key in DEFAULTS:
        name = f"BEACON_{key.upper()}"
        if name in environ:
            config[key] = environ[name]

    validate(config)
    return config
