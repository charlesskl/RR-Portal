#!/bin/zsh

set -euo pipefail

PROJECT_DIR="${0:A:h}"

cd "$PROJECT_DIR"

if [[ ! -d node_modules ]]; then
  print "首次运行：正在安装前端依赖…"
  npm install || exit 1
fi

if [[ ! -x services/email-parser/.venv/bin/uvicorn ]]; then
  print "缺少表格解析环境，请先联系开发人员完成一次初始化。"
  read "?按回车键关闭窗口…"
  exit 1
fi

if [[ ! -d .next-build ]]; then
  print "首次运行：正在构建系统页面…"
  npm run build
fi

python3 "$PROJECT_DIR/tools/local_services.py" start "$PROJECT_DIR"
open http://127.0.0.1:3000/shipments
