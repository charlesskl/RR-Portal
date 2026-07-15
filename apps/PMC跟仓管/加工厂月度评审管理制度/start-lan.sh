#!/bin/bash
# 局域网共享启动脚本：用 PocketBase 同时托管「已构建的前端 + 后端 API」，
# 绑定 0.0.0.0 让同一 WiFi 的同事也能访问。
# 发给同事的网址 = http://<本机局域网IP>:8091
#
# 更新前端后需重新构建并刷新 pb_public：
#   npm run build && rm -rf pb_public && mkdir pb_public && cp -R dist/* pb_public/
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "本机IP")
echo "==> 局域网启动 PocketBase（前端+后端，端口 8091，对外开放）"
echo "    同事访问:   http://$IP:8091"
echo "    管理后台:   http://$IP:8091/_/"
echo "    （你的 Mac 需保持开机、连同一 WiFi、本窗口不要关）"
echo ""

"$ROOT/bin/pocketbase" serve --http=0.0.0.0:8091 \
  --dir="$ROOT/pb_data" \
  --migrationsDir="$ROOT/pb_migrations" \
  --hooksDir="$ROOT/pb_hooks" \
  --publicDir="$ROOT/pb_public"
