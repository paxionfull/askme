# Askme

个人资讯库：从多个网站 / 平台抓取文章，生成日报概览，并基于原文做带引用的问答。

- **库**：浏览数据源与文章，按主题生成 Markdown 概览
- **对话**：对选定范围做 RAG 问答（带原文引用）
- **设置**：LLM、Cookie 授权、定时同步、Skill 管理；支持接入新站点

数据存在本地 `data/` 目录。默认无登录鉴权，适合本机或内网使用，**不要直接暴露到公网**。

## 环境要求

- Python **3.11+**（推荐 3.12；macOS 请用原生架构 Python，避免 Rosetta 导致 `cursor-sdk` 装不上）
- Node.js **18+**
- 可用的 LLM API Key（OpenAI 兼容接口均可，经 LiteLLM 调用）

可选：

- Embedding 模型（对话检索效果更好；也可在设置页配置）
- [Playwright Chromium](https://playwright.dev/)（设置页「打开登录窗口」抓 Cookie 时需要）
- Cursor API Key（自动接入未知站点时需要）

## 快速开始

```bash
git clone <你的仓库地址> askme
cd askme

# 1. 环境变量（也可稍后在设置页配置 LLM）
cp .env.example .env
# 编辑 .env，至少填入 LLM_API_KEY

# 2. 启动后端（自动创建 venv、安装依赖；端口 8001）
chmod +x scripts/dev.sh
./scripts/dev.sh
```

另开一个终端启动前端：

```bash
cd frontend
npm install
npm run dev
```

浏览器打开：**http://localhost:5173**  
（前端通过 Vite 把 `/api` 代理到 `http://localhost:8001`）

### 手动启动后端（等价于 `dev.sh`）

在仓库根目录加载 `.env` 后，进入 `backend/` 启动（模块导入依赖该工作目录）：

```bash
# 仓库根目录
set -a && source .env && set +a   # 若使用 .env；Windows 请手动设置环境变量

cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# 可选：需要「打开登录窗口」时
# python -m playwright install chromium

uvicorn main:app --reload --host 0.0.0.0 --port 8001
```

## 首次使用

1. 打开 **设置 → 模型**，确认 LLM（及可选的 Embedding）已配置并可用。
2. 打开 **源**，点击添加：粘贴网站 URL 或平台账号页；内置 skill（机器之心、量子位，以及 Reddit / X / 知乎平台能力）已在技能库中，匹配到时会直接复用，**不会在安装时自动写入源列表**（初始源数为 0）。
3. 刷新数据源，拉取近期文章。
4. 回到 **简报** 生成概览；需要问答时，先对相关文章 **建立索引**，再提问。
5. 部分需登录的源：在 **设置 → 数据源授权** 配置 Cookie，或添加源时按引导操作。

## 环境变量

复制 `.env.example` 为 `.env`。密钥也可在 Web 设置页保存到本地 `data/integrations.json`（勿提交真实密钥）。

| 变量 | 说明 |
|------|------|
| `LLM_API_KEY` | LLM API Key（必填之一：环境变量或设置页） |
| `LLM_MODEL` | 默认 `openai/gpt-4o-mini` |
| `LLM_API_BASE` | 自定义 API Base（兼容网关 / 自建） |
| `LLM_MAX_TOKENS` / `LLM_TIMEOUT` | 生成上限与超时 |
| `CURSOR_API_KEY` | 未知站点自动接入（Cursor Agent） |
| `ASKME_COOKIE_*` / 设置页凭证 | 需登录站点的 Cookie（也可设置页配置） |
| `FEED_PAGE_DELAY` 等 | 抓取限速，见 `.env.example` |
| `DATA_RETENTION_DAYS` | 本地文章/正文/索引保留自然日数（默认 3；每日定时清理） |

## 内置数据源

安装后出现在 **技能库**，不会自动加入用户源：

- 网站类：`jiqizhixin-discovery`（机器之心）、`qbitai-discovery`（量子位）
- 平台类：`reddit-platform-discovery`、`x-platform-discovery`、`zhihu-platform-discovery`（按账号接入，写入 `feed_registry.platform_accounts`）

Digest 风格示例：`tech-longform-digest`；对话角色：`chat-rag`。

## 目录结构

```
askme/
├── backend/                 # FastAPI（端口 8001）
│   ├── main.py              # 入口：app / lifespan / 挂载路由
│   ├── paths.py             # 仓库根 / data / skills 路径
│   ├── schemas.py           # 通用 API 请求模型
│   ├── api/                 # HTTP 路由（按域拆分的 APIRouter）
│   ├── core/                # LLM、时间范围、HTML 工具
│   ├── auth/                # Cookie / 登录会话 / 凭证
│   ├── feed/                # 数据源、抓取、文章、调度、平台适配
│   ├── digest/              # 简报流水线与缓存
│   ├── chat/                # 对话、RAG、分块与 embedding
│   ├── skills/              # skill 注册 / 配置 / 校验
│   └── onboarding/          # 新站点接入（Cursor / 平台脚手架）
├── frontend/                # React + Vite（开发端口 5173）
├── skills/                  # 内置 skill 包（discovery / chat / digest / onboarding）
├── data/                    # 本地数据与密钥（gitignore，首次运行自动创建）
├── scripts/dev.sh           # 本机启动后端
└── .env.example
```

## 常见问题

**对话检索不准 / 无结果**  
先确认已建立索引，并在设置中配置可用的 Embedding 模型。

**需登录的源刷新报未授权**  
到设置页完成 Cookie 登录或粘贴。

**「打开登录窗口」失败**  
在后端虚拟环境中执行：`python -m playwright install chromium`。

**`cursor-sdk` 安装失败（尤其是 macOS）**  
用官方或 Homebrew 的原生 Python 3.11+ 重建 `backend/.venv`。该包仅「自动接入未知站点」需要；只用内置源可不依赖它。

**改后端代码不生效**  
确认用的是 `./scripts/dev.sh`（带 `--reload`），且没有旧进程占用 8001。

## 安全说明

- 应用默认**无用户认证**；Cookie、API Key 落在本机 `data/` 与浏览器 localStorage。
- `.env`、`data/` 已在 `.gitignore` 中，请勿把真实密钥提交到仓库。

## 开发提示

- API 文档（后端起来后）：http://localhost:8001/docs
- 新网站接入：在应用内「添加源」，或参考 `skills/onboarding/source-onboarding/SKILL.md`
- 贡献新 discovery skill：在 `skills/discovery/<slug>-discovery/` 实现 `scripts/discover.py`，并用 `_lib/discovery_validate.py` 校验
