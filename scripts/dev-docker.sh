#!/usr/bin/env bash
# Docker debug：挂载代码 + uvicorn --reload，首次需 build，之后改代码无需 rebuild
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo ">>> 启动 api (Docker 热重载)..."
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build api
