# 开发态镜像：与 `npm run dev` 行为一致，带热更新，适合快速试用/自托管 demo。
#
# 默认走 DaoCloud 拉取官方库镜像，规避国内失效的 registry-mirrors。
# 海外环境可覆盖：docker compose build --build-arg NODE_IMAGE=node:20-slim
ARG NODE_IMAGE=docker.m.daocloud.io/library/node:20-slim
FROM ${NODE_IMAGE}

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
