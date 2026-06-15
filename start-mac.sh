#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       Docker 管理中心  —  启动中...       ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# 检查 Node.js
if ! command -v node &>/dev/null; then
  echo "[错误] 未找到 Node.js，请先安装 Node.js 20+"
  echo "macOS: brew install node"
  echo "Linux: https://nodejs.org/"
  exit 1
fi

# 检查 pnpm
if ! command -v pnpm &>/dev/null; then
  echo "[信息] 未找到 pnpm，正在安装..."
  npm install -g pnpm
fi

# 安装依赖
echo "[1/3] 检查依赖..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# 停止旧进程（如有）
pkill -f "api-server" 2>/dev/null || true
pkill -f "docker-manager" 2>/dev/null || true
sleep 1

# 启动 API 服务器（必须设置 PORT；后端构建后启动）
echo "[2/3] 启动 API 服务器 (端口 8080)..."
PORT=8080 NODE_ENV=development pnpm --filter @workspace/api-server run dev &
API_PID=$!

# 等待 API 构建并就绪
sleep 8

# 启动前端（BASE_PATH=/ 根路径运行；API_PROXY_TARGET 让 /api 转发到后端）
echo "[3/3] 启动前端界面 (端口 18765)..."
PORT=18765 BASE_PATH=/ API_PROXY_TARGET=http://localhost:8080 pnpm --filter @workspace/docker-manager run dev &
UI_PID=$!

# 等待前端启动
sleep 5

echo ""
echo "✅ 启动完成！"
echo "   前端: http://localhost:18765"
echo "   API:  http://localhost:8080/api/healthz"
echo ""

# 尝试打开浏览器
if command -v open &>/dev/null; then
  open http://localhost:18765
elif command -v xdg-open &>/dev/null; then
  xdg-open http://localhost:18765
fi

echo "按 Ctrl+C 停止所有服务"
wait $API_PID $UI_PID
