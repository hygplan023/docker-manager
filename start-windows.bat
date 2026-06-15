@echo off
chcp 65001 >nul
title Docker 管理中心 — 启动器
color 0B
cd /d "%~dp0"
echo.
echo  ============================================
echo        Docker 管理中心  —  启动中...
echo  ============================================
echo.

:: 检查 Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo  [错误] 未找到 Node.js，请先安装 Node.js 20+
  echo  下载地址: https://nodejs.org/
  pause
  exit /B 1
)

:: 检查 pnpm
where pnpm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo  [信息] 未找到 pnpm，正在安装...
  call npm install -g pnpm
)

:: 安装依赖（首次较慢，请耐心等待）
echo  [1/3] 检查依赖...
call pnpm install --frozen-lockfile 2>nul || call pnpm install
if %ERRORLEVEL% NEQ 0 (
  echo  [错误] 依赖安装失败，请检查网络后重试。
  pause
  exit /B 1
)

:: 启动 API 服务器（独立窗口，端口 8080）
:: 注意：必须为每个进程设置各自的 PORT；后端构建后启动，首次需等待数秒
echo  [2/3] 启动 API 服务器 (端口 8080)...
start "Docker管理中心-API" cmd /K "set PORT=8080&& set NODE_ENV=development&& pnpm --filter @workspace/api-server run dev"

:: 等待 API 构建并启动
timeout /T 10 /NOBREAK >nul

:: 启动前端（独立窗口，端口 18765）
:: BASE_PATH=/ 让前端在根路径运行；API_PROXY_TARGET 让 /api 转发到后端
echo  [3/3] 启动前端界面 (端口 18765)...
start "Docker管理中心-UI" cmd /K "set PORT=18765&& set BASE_PATH=/&& set API_PROXY_TARGET=http://localhost:8080&& pnpm --filter @workspace/docker-manager run dev"

:: 等待前端启动后打开浏览器
timeout /T 8 /NOBREAK >nul
echo.
echo  启动完成！正在打开浏览器...
start http://localhost:18765

echo.
echo  前端: http://localhost:18765
echo  API:  http://localhost:8080/api/healthz
echo.
echo  提示：已弹出两个窗口分别运行【API】和【前端】，关闭它们即可停止服务。
echo  若页面打不开，请查看那两个窗口里的报错信息（窗口不会自动关闭）。
echo  另外请确保 Docker Desktop 已经启动。
echo.
pause
