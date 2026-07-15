#!/bin/bash
# 加工厂月度评审系统 一键启动脚本
# 注意：必须用绝对路径指定 pb_data/pb_migrations/pb_hooks，
# 否则 PocketBase 会把 bin/ 当工作目录，新建空库 + 找不到迁移 = "没数据"。

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "==> 启动 PocketBase (后端, 端口 8091)"
# 绑定 0.0.0.0：允许同一局域网(Wi-Fi)内的其他电脑访问
"$ROOT/bin/pocketbase" serve --http=0.0.0.0:8091 \
  --dir="$ROOT/pb_data" \
  --migrationsDir="$ROOT/pb_migrations" \
  --hooksDir="$ROOT/pb_hooks" > /tmp/factory-pb.log 2>&1 &
PB_PID=$!

echo "==> 启动 Vite (前端, 端口 5173)"
# --host 0.0.0.0：允许局域网内其他电脑访问前端
npm run dev -- --host 0.0.0.0 > /tmp/factory-vite.log 2>&1 &
VITE_PID=$!

# 取本机局域网 IP，方便提示其他电脑用的网址
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '本机IP')"

sleep 3
echo ""
echo "已启动："
echo "  本机访问:       http://localhost:5173/factories"
echo "  其他电脑访问:   http://$LAN_IP:5173/factories   (需连同一 Wi-Fi)"
echo "  后端管理:       http://localhost:8091/_/"
echo ""
echo "日志: tail -f /tmp/factory-pb.log  /tmp/factory-vite.log"
echo "停止: 按 Ctrl+C"
echo ""

# Ctrl+C 时一起关掉两个进程
trap "echo '正在停止...'; kill $PB_PID $VITE_PID 2>/dev/null; exit 0" INT TERM
wait
