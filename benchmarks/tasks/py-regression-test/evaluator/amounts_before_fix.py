from decimal import ROUND_HALF_UP, Decimal


def parse_amount(text: str) -> int:
    """Parse an amount as printed on a bank statement into integer cents.

    Accepts "1234.50", "1,234.50", "-12.00", accounting negatives like "(12.00)",
    and a leading "$".
    """
    cleaned = text.strip().replace("$", "")
    negative = cleaned.startswith("(") and cleaned.endswith(")")
    if negative:
        cleaned = cleaned[1:-1]
    cents = int((Decimal(cleaned) * 100).to_integral_value(rounding=ROUND_HALF_UP))
    return -cents if negative else cents
