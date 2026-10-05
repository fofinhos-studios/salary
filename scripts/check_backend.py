"""Run Python tests and enforce separate line and branch coverage floors."""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "coverage.json"
result = subprocess.run(
    [
        sys.executable,
        "-m",
        "pytest",
        "-q",
        "--cov=exchange",
        "--cov=models",
        "--cov=app",
        "--cov=api.index",
        "--cov=br_rate",
        "--cov=tax_rules",
        "--cov-branch",
        "--cov-report=term-missing",
        f"--cov-report=json:{REPORT}",
    ],
    cwd=ROOT,
    check=False,
)
if result.returncode:
    raise SystemExit(result.returncode)

totals = json.loads(REPORT.read_text())["totals"]
for label, covered, total in (
    ("lines", totals["covered_lines"], totals["num_statements"]),
    ("branches", totals["covered_branches"], totals["num_branches"]),
):
    percent = 100 * covered / total
    print(f"Python {label}: {percent:.2f}%")
    if percent < 95:
        raise SystemExit(f"Python {label} coverage below 95%")
