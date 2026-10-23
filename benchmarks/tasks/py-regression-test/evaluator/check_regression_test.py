"""Does the new test actually guard #212?

A maintainer would check three things before merging a "regression test" PR:
  1. the parser itself was not touched (the issue says the fix is already in),
  2. the whole suite passes on the fixed code,
  3. the suite FAILS when the 0.4.1 fix is reverted. A test that passes either way guards nothing.
"""
import os
import shutil
import subprocess
import sys
import tempfile

workspace = os.environ["DINNER_WORKSPACE"]
here = os.path.dirname(os.path.abspath(__file__))


def run_suite(root: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-t", "."],
        cwd=root, capture_output=True, text=True, timeout=60,
    )


with open(os.path.join(workspace, "ledger", "amounts.py"), encoding="utf-8") as handle:
    current = handle.read()
with open(os.path.join(here, "amounts_fixed.py"), encoding="utf-8") as handle:
    if handle.read() != current:
        sys.exit("ledger/amounts.py was changed; the issue asked for a test only.")

with tempfile.TemporaryDirectory() as scratch:
    fixed = os.path.join(scratch, "fixed")
    shutil.copytree(workspace, fixed, ignore=shutil.ignore_patterns(".git", "__pycache__"))
    result = run_suite(fixed)
    if result.returncode != 0:
        sys.exit("The suite fails on the fixed code:\n" + result.stderr[-2000:])

    reverted = os.path.join(scratch, "reverted")
    shutil.copytree(fixed, reverted)
    shutil.copyfile(os.path.join(here, "amounts_before_fix.py"), os.path.join(reverted, "ledger", "amounts.py"))
    if run_suite(reverted).returncode == 0:
        sys.exit("With the #212 fix reverted the suite still passes, so no test guards it.")

print("regression test guards #212")
