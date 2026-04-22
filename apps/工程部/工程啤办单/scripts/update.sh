#!/bin/bash
# ============================================================
# update.sh — 一键更新（每次发布新版本后在服务器执行）
# 用法：bash update.sh
# ============================================================

set -e

APP_DIR="/var/www/production-system"
APP_NAME="production-system"

echo "========================================"
echo " 更新生产订单管理系统..."
echo "========================================"

cd "$APP_DIR"

# 1. 备份数据
echo "[1/4] 备份数据..."
BACKUP_FILE="/root/backup/data_$(date +%Y%m%d_%H%M%S).json"
mkdir -p /root/backup
cp "$APP_DIR/data/data.json" "$BACKUP_FILE"
echo "数据已备份到：$BACKUP_FILE"

# 只保留最近 30 个备份
ls -t /root/backup/data_*.json 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true

# 2. 拉取最新代码（不覆盖数据文件）
echo "[2/4] 拉取最新代码..."
git pull

# 3. 更新依赖（如有新增包）
echo "[3/4] 更新依赖..."
npm install --production

# 4. 重启服务
echo "[4/4] 重启服务..."
pm2 restart "$APP_NAME"

echo ""
echo "========================================"
echo " 更新完成！当前版本：$(git log --oneline -1)"
echo " 查看日志：pm2 logs ${APP_NAME}"
echo "========================================"
