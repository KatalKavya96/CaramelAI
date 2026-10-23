"""Runs `python3 -m beacon check` the way the reporter's container does, with BEACON_* variables set."""
import os
import subprocess
import sys
import tempfile

workspace = os.environ["DINNER_WORKSPACE"]
failures = []


def check(env: dict, ini: str | None = None) -> subprocess.CompletedProcess:
    clean = {key: value for key, value in os.environ.items() if not key.startswith("BEACON_")}
    args = [sys.executable, "-m", "beacon", "check"]
    path = None
    if ini is not None:
        handle = tempfile.NamedTemporaryFile("w", suffix=".ini", delete=False)
        handle.write(ini)
        handle.close()
        path = handle.name
        args += ["--config", path]
    try:
        return subprocess.run(args, cwd=workspace, env={**clean, **env}, capture_output=True, text=True, timeout=30)
    finally:
        if path is not None:
            os.unlink(path)


def expect(name: str, condition: bool, result: subprocess.CompletedProcess) -> None:
    if not condition:
        failures.append(f"{name}\n  exit={result.returncode}\n  stdout={result.stdout.strip()}\n  stderr={result.stderr.strip()[-600:]}")


issue_ini = "[server]\nhost = 0.0.0.0\nlog_level = warning\n"
r = check({"BEACON_PORT": "9000", "BEACON_DEBUG": "false"}, issue_ini)
expect("the reporter's setup starts", r.returncode == 0 and "port=9000" in r.stdout and "host=0.0.0.0" in r.stdout, r)
expect("BEACON_DEBUG=false turns debug off", "debug=False" in r.stdout, r)

r = check({"BEACON_DEBUG": "on", "BEACON_WORKERS": "4"})
expect("BEACON_DEBUG=on and BEACON_WORKERS=4 are typed", r.returncode == 0 and "debug=True" in r.stdout and "workers=4" in r.stdout, r)

r = check({"BEACON_PORT": "9000"}, "[server]\nport = 7000\n")
expect("environment still wins over the INI file", r.returncode == 0 and "port=9000" in r.stdout, r)

r = check({"BEACON_WORKERS": "two"})
expect("a bad number is a clean config error, not a traceback", r.returncode == 2 and "workers" in r.stderr and "Traceback" not in r.stderr, r)

r = check({"BEACON_PORT": "70000"})
expect("ports from the environment are still range-checked", r.returncode == 2 and "port" in r.stderr and "Traceback" not in r.stderr, r)

r = check({"BEACON_DEBUG": "maybe"})
expect("a bad true/false is a clean config error", r.returncode == 2 and "debug" in r.stderr and "Traceback" not in r.stderr, r)

if failures:
    sys.exit("\n\n".join(failures))
print("environment overrides behave")
