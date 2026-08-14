# 构建上下文须为仓库根目录：docker build -f backend/Dockerfile .
# 原因：backend 通过 paths.py 引用上一级的 skills/，镜像内需保持相同的相对目录结构。
#
# 默认走 DaoCloud 拉取官方库镜像，规避国内失效的 registry-mirrors（如 mirror.ccs.tencentyun.com）导致的 EOF。
# 海外环境可覆盖：docker compose build --build-arg PYTHON_IMAGE=python:3.12-slim
ARG PYTHON_IMAGE=docker.m.daocloud.io/library/python:3.12-slim
FROM ${PYTHON_IMAGE}

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Playwright(Chromium) 依赖的系统库
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget ca-certificates gnupg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt \
    && python -m playwright install --with-deps chromium

COPY backend /app/backend
COPY skills /app/skills

WORKDIR /app/backend
EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
