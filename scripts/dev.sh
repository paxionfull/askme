#!/usr/bin/env bash
# 本地 debug：FastAPI 在宿主机热重载
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Askme 不依赖 .env：LLM Key / Cursor API Key 等均在启动后于「设置」页配置并持久化到 data/integrations.json。
cd "$ROOT/backend"
if [[ ! -d .venv ]]; then
  echo ">>> 创建 Python 虚拟环境..."
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -r requirements.txt

echo ">>> 检查 Playwright 浏览器内核（首次运行会下载 Chromium，可能需要几分钟）..."
python -m playwright install chromium

echo ">>> API 热重载: http://localhost:8001"
echo ">>> 前端开发: cd frontend && npm run dev  →  http://localhost:5173"
echo ">>> 首次使用请在浏览器打开设置页配置 LLM API Key（无需 .env）: http://localhost:5173/settings"
exec uvicorn main:app --reload --host 0.0.0.0 --port 8001
