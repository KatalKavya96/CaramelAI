import sys

from .importer import format_cents, read_statement


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: python3 -m ledger <statement.csv>", file=sys.stderr)
        return 1
    rows = read_statement(argv[0])
    print(f"{len(rows)} rows, total {format_cents(sum(row.cents for row in rows))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
