#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")/.."
if ! curl -sf -o /dev/null http://127.0.0.1:5173/; then
  echo "Starting Vite on 127.0.0.1:5173 …"
  npm run dev -- --host 127.0.0.1 --port 5173 >/tmp/askme-vite-proto.log 2>&1 &
  for i in {1..60}; do
    curl -sf -o /dev/null http://127.0.0.1:5173/ && break
    sleep 0.25
  done
fi
# Prefer HTTP so layout CSS is not cached from file://
if ! curl -sf -o /dev/null http://127.0.0.1:8765/askme-current-1to1.html; then
  python3 -m http.server 8765 --bind 127.0.0.1 --directory prototypes >/tmp/askme-proto-static.log 2>&1 &
  sleep 0.4
fi
open "http://127.0.0.1:8765/askme-current-1to1.html?v=$(date +%s)"

