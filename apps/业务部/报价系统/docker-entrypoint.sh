#!/bin/sh
# 1) bind-mount 目录通常是 host root 所有，chown 给 node
# 2) 首次启动时把 seed DB 复制到空的 bind-mount 目录
# 3) exec 成 node 用户启动进程
set -e

if [ -d /app/server/data ]; then
  chown -R node:node /app/server/data 2>/dev/null || true
fi

# 首次部署：host 空目录 → 复制 seed DB。已有 DB 时不覆盖（幂等）。
if [ ! -f /app/server/data/quotation.db ] && [ -f /opt/seed/quotation.db ]; then
  echo "[entrypoint] seeding quotation.db from /opt/seed"
  cp /opt/seed/quotation.db /app/server/data/quotation.db
  chown node:node /app/server/data/quotation.db
fi

exec su-exec node "$@"
