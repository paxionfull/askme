#!/usr/bin/env bash
# 本地 debug：FastAPI 在宿主机热重载
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

cd "$ROOT/backend"
if [[ ! -d .venv ]]; then
  echo ">>> 创建 Python 虚拟环境..."
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -r requirements.txt

echo ">>> API 热重载: http://localhost:8001"
echo ">>> 前端开发: cd frontend && npm run dev  →  http://localhost:5173"
exec uvicorn main:app --reload --host 0.0.0.0 --port 8001
