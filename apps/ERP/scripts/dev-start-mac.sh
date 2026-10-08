#!/bin/bash
# 本机开发一键启动（macOS）：colima 虚拟机 + Azure SQL Edge 容器 + 后端 + 前端
# 首次环境已装好（~/erp-tools/vm + ~/.dotnet）；电脑重启后用本脚本拉起整套环境。
set -e
export PATH="$HOME/erp-tools/vm/bin:$HOME/.dotnet:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> 启动容器运行时与数据库"
colima start 2>/dev/null || true
docker start erpsql 2>/dev/null || true

export ERP_DB="Server=localhost,1433;User Id=sa;Password=ErpDev2026;Database=erp;TrustServerCertificate=true"
export ERP_JWT_KEY="erp-dev-jwt-key-0123456789abcdef"

echo "==> 启动后端 http://localhost:5050(macOS 5000 会被 AirPlay 接收抢占,开发固定 5050)"
dotnet run --project "$ROOT/src/ErpApi" --urls http://localhost:5050 &
sleep 12

echo "==> 启动前端 http://localhost:5174（账号 admin / admin123）"
cd "$ROOT/web2" && npm run dev
