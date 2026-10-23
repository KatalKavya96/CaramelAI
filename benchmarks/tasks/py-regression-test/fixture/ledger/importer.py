import csv
from dataclasses import dataclass

from .amounts import parse_amount


@dataclass
class Row:
    date: str
    description: str
    cents: int


def read_statement(path: str) -> list[Row]:
    with open(path, newline="", encoding="utf-8") as handle:
        return [Row(line["date"], line["description"], parse_amount(line["amount"])) for line in csv.DictReader(handle)]


def format_cents(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    return f"{sign}{abs(cents) // 100:,}.{abs(cents) % 100:02d}"
