# Docker 管理中心 —— 单容器构建（前端静态文件由 Express 同进程托管）
# 在 Linux 容器内完成依赖安装与构建，彻底规避 Windows 上的 Node/pnpm 安装问题。
FROM node:22-slim

WORKDIR /app

# 启用 corepack 提供的 pnpm（与项目锁文件版本一致）
RUN corepack enable

# 复制全部源码（node_modules / dist 等已由 .dockerignore 排除）
COPY . .

# 安装依赖（容器内为干净的 Linux 环境，pnpm 可正常工作）
RUN pnpm install --frozen-lockfile

# 构建后端（esbuild 自包含打包）与前端（Vite，base=/ 以便从根路径托管）
RUN pnpm --filter @workspace/api-server run build \
 && PORT=8080 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/docker-manager run build

ENV NODE_ENV=production \
    PORT=8080 \
    PUBLIC_DIR=/app/artifacts/docker-manager/dist/public

EXPOSE 8080

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
