"""Replays the reporter's export through the CLI.

Two "duplicates" were reported. Only one is a bug: stray whitespace from the export. The other,
Priya.N@ vs priya.n@, is kept apart on purpose (docs/duplicates.md, #88), and the reporter's
answer is the existing --fold-case flag. A fix that changes the default fails here.
"""
import os
import subprocess
import sys
import tempfile

workspace = os.environ["DINNER_WORKSPACE"]
sys.path.insert(0, workspace)
from listclean.dedupe import dedupe  # noqa: E402

EXPORT = "jordan@fastmail.com\njordan@fastmail.com \n  \n Sam@Example.org\nPriya.N@gmail.com\npriya.n@gmail.com\nsam@example.org\n"
failures = []


def run(*flags: str) -> list[str]:
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as handle:
        handle.write(EXPORT)
    try:
        result = subprocess.run([sys.executable, "-m", "listclean", "dedupe", *flags, handle.name],
                                cwd=workspace, capture_output=True, text=True, timeout=30)
    finally:
        os.unlink(handle.name)
    if result.returncode != 0:
        failures.append(f"dedupe {' '.join(flags)} exited {result.returncode}: {result.stderr.strip()[-500:]}")
    return result.stdout.splitlines()


default = run()
if default != ["jordan@fastmail.com", "Sam@Example.org", "Priya.N@gmail.com", "priya.n@gmail.com", "sam@example.org"]:
    failures.append(f"default dedupe: whitespace duplicates should merge, case variants should stay apart; got {default}")

folded = run("--fold-case")
if folded != ["jordan@fastmail.com", "Sam@Example.org", "Priya.N@gmail.com"]:
    failures.append(f"--fold-case should merge Priya.N/priya.n and Sam/sam; got {folded}")

if [address.strip() for address in dedupe([" a@x.com", "a@x.com\t"])] != ["a@x.com"]:
    failures.append("dedupe() in Python should treat surrounding whitespace as the same subscriber")
if len(dedupe(["Bob@example.com", "bob@example.com"])) != 2:
    failures.append("dedupe() must keep Bob@ and bob@ apart unless fold_case=True (docs/duplicates.md)")

if failures:
    sys.exit("\n".join(failures))
print("whitespace merged, documented case behaviour kept")
