#!/bin/bash
# QC 成品报告系统 - 开发/预览启动脚本
# 支持 Kimi Work 预览卡片传入的 --port / --host 参数
PORT=8000
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port|-p)
      PORT="$2"; shift 2 ;;
    --port=*)
      PORT="${1#*=}"; shift ;;
    --host|--host=*)
      # app.py 固定监听 0.0.0.0，host 参数直接忽略
      shift ;;
    *)
      shift ;;
  esac
done

cd "$(dirname "$0")/.."
export PORT
export AI_MOCK_MODE="${AI_MOCK_MODE:-true}"
export AUTH_DISABLED="${AUTH_DISABLED:-true}"
export SECRET_KEY="${SECRET_KEY:-local-dev-only-not-for-production-9f4b2c7e1a8d}"
exec .venv/bin/python app.py
