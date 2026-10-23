import argparse
import sys

from .dedupe import dedupe


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python3 -m listclean")
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("dedupe", help="write each subscriber once")
    command.add_argument("file")
    command.add_argument("--fold-case", action="store_true", help="also ignore case before the @")
    args = parser.parse_args(argv)

    with open(args.file, encoding="utf-8") as handle:
        lines = handle.read().splitlines()
    kept = dedupe(lines, fold_case=args.fold_case)
    for address in kept:
        print(address)
    print(f"kept {len(kept)} of {len([line for line in lines if line])} addresses", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
