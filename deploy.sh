#!/usr/bin/env bash
# 一键部署（Git Bash / Linux / macOS）
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "[deploy] 已生成 .env —— 请先修改 JWT_SECRET 后再对外提供服务"
fi

echo "[deploy] 安装生产依赖…"
npm ci --omit=dev

if command -v pm2 >/dev/null 2>&1; then
  echo "[deploy] 使用 PM2 启动（单实例，PGlite 单写者）"
  pm2 startOrReload ecosystem.config.cjs --update-env
  pm2 save
  pm2 status family-tree
else
  echo "[deploy] 未检测到 PM2，前台启动（生产建议安装 PM2）"
  exec npm start
fi
