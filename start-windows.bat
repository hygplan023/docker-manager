@echo off
chcp 65001 >nul
title Codex Manager - Launcher
color 0B
cd /d "%~dp0"
echo.
echo  ============================================
echo         Codex Manager  -  Starting...
echo  ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo  [ERROR] Node.js not found. Please install Node.js 20+ first.
  echo  Download: https://nodejs.org/
  pause
  exit /B 1
)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo  [INFO] pnpm not found. Enabling via corepack...
  call corepack enable >nul 2>&1
  call corepack prepare pnpm@latest --activate >nul 2>&1
)
where pnpm >nul 2>&1
if errorlevel 1 (
  echo  [INFO] Installing pnpm globally via npm...
  call npm install -g pnpm
)

echo  [1/3] Installing dependencies (first run may take a few minutes)...
call pnpm install --frozen-lockfile
if errorlevel 1 (
  echo  [INFO] Frozen install failed, retrying with a normal install...
  call pnpm install
)
if errorlevel 1 (
  echo.
  echo  [ERROR] Dependency install failed. Check your network and retry.
  pause
  exit /B 1
)

echo  [2/3] Starting API server (port 8080)...
start "Codex Manager - API" cmd /K "set PORT=8080&& set NODE_ENV=development&& pnpm --filter @workspace/api-server run dev"

timeout /T 12 /NOBREAK >nul

echo  [3/3] Starting frontend (port 18765)...
start "Codex Manager - UI" cmd /K "set PORT=18765&& set BASE_PATH=/&& set API_PROXY_TARGET=http://localhost:8080&& pnpm --filter @workspace/docker-manager run dev"

timeout /T 8 /NOBREAK >nul
echo.
echo  Done. Opening browser...
start http://localhost:18765

echo.
echo  Frontend: http://localhost:18765
echo  API:      http://localhost:8080/api/healthz
echo.
echo  Two windows were opened for API and Frontend. Close them to stop the services.
echo  If the page does not load, read the error messages in those two windows.
echo  Also make sure Docker Desktop is running.
echo.
pause
