from collections.abc import Iterable


def subscriber_key(address: str, fold_case: bool = False) -> str:
    """The key two addresses must share to count as the same subscriber.

    The domain is always lowercased. The local part keeps its case unless fold_case is set:
    see docs/duplicates.md for why.
    """
    local, _, domain = address.rpartition("@")
    if fold_case:
        local = local.lower()
    return f"{local}@{domain.lower()}"


def dedupe(addresses: Iterable[str], fold_case: bool = False) -> list[str]:
    """Each subscriber once, in first-seen order, keeping the first spelling."""
    seen: set[str] = set()
    kept: list[str] = []
    for address in addresses:
        if address == "":
            continue
        key = subscriber_key(address, fold_case)
        if key in seen:
            continue
        seen.add(key)
        kept.append(address)
    return kept
