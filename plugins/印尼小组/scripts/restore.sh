#!/usr/bin/env bash
# ============================================
# 还原脚本 - 从备份还原 Nginx 日志
# 用法: ./scripts/restore.sh <备份文件>
# ============================================
set -e

BACKUP_DIR="./backups"

if [ -z "$1" ]; then
    echo "[ERROR] 请指定备份文件"
    echo "用法: ./scripts/restore.sh <备份文件>"
    echo ""
    echo "可用备份:"
    ls -lh "${BACKUP_DIR}"/backup_*.tar.gz 2>/dev/null || echo "  (无备份文件)"
    exit 1
fi

BACKUP_FILE="$1"

# 支持只传文件名（自动补全路径）
if [ ! -f "${BACKUP_FILE}" ] && [ -f "${BACKUP_DIR}/${BACKUP_FILE}" ]; then
    BACKUP_FILE="${BACKUP_DIR}/${BACKUP_FILE}"
fi

if [ ! -f "${BACKUP_FILE}" ]; then
    echo "[ERROR] 备份文件不存在: ${BACKUP_FILE}"
    exit 1
fi

echo "[INFO] 即将从以下备份还原:"
ls -lh "${BACKUP_FILE}"
echo ""
read -p "确认还原？这将覆盖现有日志 (y/N): " CONFIRM
if [ "${CONFIRM}" != "y" ] && [ "${CONFIRM}" != "Y" ]; then
    echo "[INFO] 已取消"
    exit 0
fi

echo "[INFO] 开始还原..."

docker run --rm \
    -v shipment-checker-logs:/logs \
    -v "$(cd "$(dirname "${BACKUP_FILE}")" && pwd)":/backup:ro \
    alpine:3.19 \
    sh -c "rm -rf /logs/* && tar xzf /backup/$(basename "${BACKUP_FILE}") -C /logs"

echo "[INFO] 还原完成"
echo "[INFO] 重启服务以应用还原的日志..."
docker compose -f docker-compose.prod.yml restart

echo "[INFO] 还原成功！"
