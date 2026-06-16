@echo off
title Codex Manager - Stop
cd /d "%~dp0"
echo [INFO] Stopping container...
docker compose down
echo [OK] Stopped.
pause
