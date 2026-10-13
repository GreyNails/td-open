#!/usr/bin/env bash
set -euo pipefail
TD_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$TD_ROOT"
if [[ ! -x .venv/bin/python ]]; then
  echo "请先运行 ./scripts/setup.sh"
  exit 1
fi
export PYTHONDONTWRITEBYTECODE=1
export TMPDIR="$TD_ROOT/.cache/tmp"
mkdir -p "$TMPDIR"
exec .venv/bin/python -m backend.main
