# Askme

[English](README.md) | [中文](README.zh-CN.md)

Askme continuously collects articles from the sites you follow and turns them into readable digests—so you can make sense of a flood of information in minutes.

## Requirements

- Python **3.11+** (3.12 recommended)
- Node.js **18+**
- An LLM API Key (any OpenAI-compatible API)
- A Cursor API Key (required when onboarding unknown sites)

## Install & Run

```bash
git clone https://github.com/paxionfull/askme.git
cd askme

# 1. Start the backend (creates venv and installs deps; port 8001)
./scripts/dev.sh
```

In another terminal, start the frontend:

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

## License

[MIT](LICENSE)
