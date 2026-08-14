# Askme

[English](README.md) | [中文](README.zh-CN.md)

Askme 从你关注的网站持续收集文章，整理成可读的简报，让你几分钟内消化海量信息。

## 环境要求

- Python **3.11+**（推荐 3.12）
- Node.js **18+**
- 一个可用的 LLM API Key（OpenAI 兼容接口均可）；接入未知站点时另需 Cursor API Key
- 或者：直接用 Docker（见下）

> 无需 `.env`：以上 Key 都在启动后打开设置页填写，保存在本地 `data/integrations.json`，随时可改。

## 方式一：Docker 一键启动（推荐）

```bash
git clone https://github.com/paxionfull/askme.git
cd askme
docker compose up --build
```

打开 **http://localhost:5173**，进入「设置」页配置 LLM API Key 即可开始使用。
数据（数据源、简报缓存等）保存在宿主机的 `./data` 目录，接入的技能保存在 `./skills`，容器重建不会丢失。

> 首次构建大约需要 10–15 分钟（pip 依赖 + Playwright Chromium），之后会快很多。
> 基础镜像默认经 DaoCloud 拉取，避免国内失效的 Docker Hub 镜像源报 EOF。海外环境可覆盖：
> `PYTHON_IMAGE=python:3.12-slim NODE_IMAGE=node:20-slim docker compose build`

## 方式二：本地运行

### macOS / Linux

```bash
git clone https://github.com/paxionfull/askme.git
cd askme

# 1. 启动后端（自动创建 venv、安装依赖、下载 Playwright 内核；端口 8001）
./scripts/dev.sh
```

### Windows（PowerShell）

```powershell
git clone https://github.com/paxionfull/askme.git
cd askme
.\scripts\dev.ps1
```

在另一个终端启动前端：

```bash
cd frontend
npm install
npm run dev
```

打开浏览器：**http://localhost:5173**，首次进入会引导你在「设置」页配置 LLM API Key。

## 配置说明

| 配置项 | 在哪里配置 | 是否必需 |
| --- | --- | --- |
| LLM API Key / 模型 | 设置 → API Key | 是，用于对话与生成简报 |
| Embedding 模型 | 设置 → API Key（可选） | 否，仅用于检索问答 |
| Cursor API Key | 设置 → API Key | 仅接入未知网站时需要；内置站点（知乎、机器之心、量子位、X、Reddit 等）无需配置 |
| 数据源 Cookie | 设置 → Cookie | 仅接入需要登录态的站点时需要 |

## License

[MIT](LICENSE)
