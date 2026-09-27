# syntax=docker/dockerfile:1

# ---- 构建阶段：TypeScript → 纯静态文件（含 tsc 类型检查与 vitest 对拍）----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY test ./test
RUN npm test && npm run build

# ---- 运行阶段：nginx 提供静态文件，离线可用，无运行时外部依赖 ----
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
