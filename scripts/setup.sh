#!/usr/bin/env bash
set -euo pipefail
TD_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$TD_ROOT"
mkdir -p .cache/pip .cache/npm .cache/tmp data/projects data/assets
export PIP_CACHE_DIR="$TD_ROOT/.cache/pip"
export npm_config_cache="$TD_ROOT/.cache/npm"
export TMPDIR="$TD_ROOT/.cache/tmp"
export PYTHONDONTWRITEBYTECODE=1
if [[ -x "$TD_ROOT/.tools/node-v22.21.1-linux-x64/bin/node" ]]; then
  export PATH="$TD_ROOT/.tools/node-v22.21.1-linux-x64/bin:$PATH"
fi
if [[ -f frontend/package.json ]]; then
  if ! command -v node >/dev/null 2>&1 || ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 19) ? 0 : 1)'; then
    echo "前端构建需要 Node.js 20.19 或更新版本（建议 Node.js 22 LTS）。"
    echo "请更新 Node.js 后重试；项目内 .tools/node-v22.21.1-linux-x64/bin 会被优先使用。"
    exit 1
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "未找到 npm。请安装包含 npm 的 Node.js 发行版后重试。"
    exit 1
  fi
fi
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock -e '.[dev]'
if [[ -f frontend/package.json ]]; then
  cd frontend
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
  npm run build
fi
echo "安装完成。运行 ./scripts/start.sh，然后打开 http://127.0.0.1:8765"
