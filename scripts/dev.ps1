# Windows 原生启动脚本（PowerShell），与 scripts/dev.sh 行为对齐。
# Askme 不依赖 .env：LLM Key / Cursor API Key 等均在启动后于「设置」页配置并持久化到 data/integrations.json。
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $Root "backend")

if (-not (Test-Path ".venv")) {
    Write-Host ">>> 创建 Python 虚拟环境..."
    python -m venv .venv
}

& ".\.venv\Scripts\Activate.ps1"

pip install -q -r requirements.txt

Write-Host ">>> 检查 Playwright 浏览器内核（首次运行会下载 Chromium，可能需要几分钟）..."
python -m playwright install chromium

Write-Host ">>> API 热重载: http://localhost:8001"
Write-Host ">>> 前端开发: cd frontend; npm run dev  →  http://localhost:5173"
Write-Host ">>> 首次使用请在浏览器打开设置页配置 LLM API Key（无需 .env）: http://localhost:5173/settings"

uvicorn main:app --reload --host 0.0.0.0 --port 8001
