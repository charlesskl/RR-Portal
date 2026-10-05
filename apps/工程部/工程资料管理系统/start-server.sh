#!/bin/bash
# 工程资料管理系统 — 常驻服务启动脚本（launchd 调用）
NODE="/Applications/Kimi.app/Contents/Resources/resources/runtime/node"
APP_DIR="/Users/duanlei/Documents/Kimi/Workspaces/工程资料/工程资料管理系统"

cd "$APP_DIR" || exit 1
# 生产模式：服务 dist/ 打包产物（/api/* 由 vite-plugin-docs-api 中间件提供）
exec "$NODE" node_modules/vite/bin/vite.js preview --host --port 3100
