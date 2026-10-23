import argparse
import sys

from .config import ConfigError, load_config


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python3 -m beacon")
    commands = parser.add_subparsers(dest="command", required=True)
    check = commands.add_parser("check", help="validate the configuration and exit")
    check.add_argument("--config", help="path to an INI file")
    args = parser.parse_args(argv)

    try:
        config = load_config(args.config)
    except ConfigError as error:
        print(f"config error: {error}", file=sys.stderr)
        return 2
    settings = " ".join(f"{key}={value}" for key, value in config.items())
    print(f"config ok: {settings}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
