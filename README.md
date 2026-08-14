# Askme

[English](README.md) | [中文](README.zh-CN.md)

Askme continuously collects articles from the sites you follow and turns them into readable digests—so you can make sense of a flood of information in minutes.

## Requirements

- Python **3.11+** (3.12 recommended)
- Node.js **18+**
- An LLM API Key (any OpenAI-compatible API); a Cursor API Key is only needed when onboarding unknown sites
- Or: just use Docker (see below)

> No `.env` required: all keys above are entered in the in-app Settings page after startup, and are stored locally in `data/integrations.json`. You can change them anytime.

## Option 1: Docker (recommended)

```bash
git clone https://github.com/paxionfull/askme.git
cd askme
docker compose up --build
```

Open **http://localhost:5173**, then go to Settings to configure your LLM API Key.
Your data (feeds, digest cache, etc.) lives on the host in `./data`, and onboarded skills in `./skills`, so nothing is lost when the containers are rebuilt.

> First build may take 10–15 minutes (pip + Playwright Chromium). Subsequent builds are much faster.
> Base images are pulled via DaoCloud by default to avoid broken Docker Hub mirrors in China. Outside China you can override:
> `PYTHON_IMAGE=python:3.12-slim NODE_IMAGE=node:20-slim docker compose build`

## Option 2: Run locally

### macOS / Linux

```bash
git clone https://github.com/paxionfull/askme.git
cd askme

# 1. Start the backend (creates venv, installs deps, downloads the Playwright browser; port 8001)
./scripts/dev.sh
```

### Windows (PowerShell)

```powershell
git clone https://github.com/paxionfull/askme.git
cd askme
.\scripts\dev.ps1
```

In another terminal, start the frontend:

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. On first run you'll be guided to configure your LLM API Key in Settings.

## Configuration

| Setting | Where | Required? |
| --- | --- | --- |
| LLM API Key / model | Settings → API Key | Yes, used for chat and digest generation |
| Embedding model | Settings → API Key (optional) | No, only used for retrieval-based Q&A |
| Cursor API Key | Settings → API Key | Only needed when onboarding unknown sites; built-in sites (Zhihu, JiQiZhiXin, QbitAI, X, Reddit, etc.) don't need it |
| Source cookies | Settings → Cookie | Only needed for sites that require login |

## License

[MIT](LICENSE)
