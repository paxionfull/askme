# Askme

[English](README.md) | [中文](README.zh-CN.md)

Askme 从你关注的网站持续收集文章，整理成可读的简报，让你几分钟内消化海量信息。

## 环境要求

- Python **3.11+**（推荐 3.12）
- Node.js **18+**
- 可用的 LLM API Key（OpenAI 兼容接口均可）
- Cursor API Key（接入未知站点时需要）

## 安装与启动

```bash
git clone https://github.com/paxionfull/askme.git
cd askme

# 1. 启动后端（自动创建 venv、安装依赖；端口 8001）
./scripts/dev.sh
```

另开一个终端启动前端：

```bash
cd frontend
npm install
npm run dev
```

浏览器打开：**http://localhost:5173**

## License

[MIT](LICENSE)
