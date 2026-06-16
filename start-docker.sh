#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "[ERROR] Docker not found. Please install Docker Desktop: https://www.docker.com/products/docker-desktop/"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "[ERROR] Docker is not running. Please start Docker Desktop and retry."
  exit 1
fi

echo "[INFO] Building and starting container (first run may take a few minutes)..."
docker compose up -d --build

echo "[OK] Started. URL: http://localhost:18765"
if command -v open >/dev/null 2>&1; then
  open http://localhost:18765
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open http://localhost:18765
fi
