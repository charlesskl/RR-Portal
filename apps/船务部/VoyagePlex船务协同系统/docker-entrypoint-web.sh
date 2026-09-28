#!/bin/sh
set -eu
# voyageplex-web 容器启动入口：初始化数据目录后启动 Next.js 生产服务。
mkdir -p /app/data
if [ ! -s /app/data/inspection-mappings.json ]; then
  cp /app/seed/inspection-mappings.json /app/data/inspection-mappings.json
fi
exec npm run start -- --hostname 0.0.0.0 --port 3000
