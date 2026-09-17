#!/bin/zsh

set -u

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="$PROJECT_DIR/.qc-runtime"
FRONTEND_URL="http://127.0.0.1:3100"
BACKEND_URL="http://127.0.0.1:5188"

mkdir -p "$RUNTIME_DIR"

echo "========================================"
echo "       QC验货管理系统 · 一键重启"
echo "========================================"
echo ""

stop_port() {
  local port="$1"
  local pids
  pids=($(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null))
  if (( ${#pids[@]} > 0 )); then
    echo "正在停止端口 $port 的旧服务……"
    kill $pids 2>/dev/null || true
    for _ in {1..20}; do
      if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
        return
      fi
      sleep 0.2
    done
    pids=($(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null))
    (( ${#pids[@]} > 0 )) && kill -9 $pids 2>/dev/null || true
  fi
}

wait_for_url() {
  local url="$1"
  for _ in {1..60}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

stop_port 3100
stop_port 5188

echo "正在清理开发预览缓存……"
rm -rf "$PROJECT_DIR/.next-dev"

if [[ ! -x "$PROJECT_DIR/node_modules/.bin/next" ]]; then
  echo "启动失败：网页依赖尚未安装，请联系系统维护人员。"
  read "?按回车键关闭窗口……"
  exit 1
fi

if ! command -v dotnet >/dev/null 2>&1; then
  echo "启动失败：电脑上未找到 .NET，请联系系统维护人员。"
  read "?按回车键关闭窗口……"
  exit 1
fi

echo "正在启动后端服务……"
(
  cd "$PROJECT_DIR/server/QcInspection.Api"
  export QC_JWT_KEY="qc-local-development-key-2026-change-before-production"
  nohup dotnet run --urls "$BACKEND_URL" >"$RUNTIME_DIR/backend.log" 2>&1 &
  echo $! >"$RUNTIME_DIR/backend.pid"
)

echo "正在启动网页服务……"
(
  cd "$PROJECT_DIR"
  nohup ./node_modules/.bin/next dev -H 127.0.0.1 -p 3100 >"$RUNTIME_DIR/frontend.log" 2>&1 &
  echo $! >"$RUNTIME_DIR/frontend.pid"
)

backend_ok=false
frontend_ok=false
wait_for_url "$BACKEND_URL/api/public/plans?site=%E5%85%B4%E4%BF%A1&page=1" && backend_ok=true
wait_for_url "$FRONTEND_URL" && frontend_ok=true

echo ""
if [[ "$backend_ok" == true && "$frontend_ok" == true ]]; then
  echo "✅ 系统重启成功"
  echo "访问地址：$FRONTEND_URL"
  [[ "${1:-}" != "--no-open" ]] && open "$FRONTEND_URL"
else
  echo "❌ 系统未能正常启动"
  echo "请将以下日志文件交给系统维护人员："
  echo "$RUNTIME_DIR/frontend.log"
  echo "$RUNTIME_DIR/backend.log"
  read "?按回车键关闭窗口……"
  exit 1
fi

echo ""
echo "本窗口可以关闭，系统会继续运行。"
sleep 3
