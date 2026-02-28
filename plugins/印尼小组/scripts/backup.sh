#!/usr/bin/env bash
# ============================================
# 备份脚本 - 备份 Nginx 日志和配置
# 用法: ./scripts/backup.sh [--remote user@host]
# ============================================
set -e

BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="backup_${TIMESTAMP}.tar.gz"
REMOTE=""

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --remote) REMOTE="$2"; shift 2 ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
done

mkdir -p "${BACKUP_DIR}"

echo "[INFO] 开始备份... (${TIMESTAMP})"

# 备份 Nginx 日志（从 Docker named volume）
echo "[INFO] 导出 Nginx 日志..."
docker run --rm \
    -v shipment-checker-logs:/logs:ro \
    -v "$(pwd)/${BACKUP_DIR}":/backup \
    alpine:3.19 \
    tar czf "/backup/${BACKUP_FILE}" -C /logs .

echo "[INFO] 备份完成: ${BACKUP_DIR}/${BACKUP_FILE}"
ls -lh "${BACKUP_DIR}/${BACKUP_FILE}"

# 可选：SCP 到远端备份服务器
if [ -n "${REMOTE}" ]; then
    echo "[INFO] 上传备份到 ${REMOTE}..."
    scp "${BACKUP_DIR}/${BACKUP_FILE}" "${REMOTE}:~/backups/"
    echo "[INFO] 远端备份完成"
fi

# 清理 30 天前的旧备份
find "${BACKUP_DIR}" -name "backup_*.tar.gz" -mtime +30 -delete 2>/dev/null || true
echo "[INFO] 已清理 30 天前的旧备份"
