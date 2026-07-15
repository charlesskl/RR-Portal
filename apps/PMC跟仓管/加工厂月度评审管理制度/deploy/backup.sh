#!/usr/bin/env bash
# 每日备份 PocketBase 数据，保留最近 14 天。可选上传对象存储。
set -euo pipefail
BACKUP_DIR=/opt/factory-review/backups
DATA_DIR=/opt/factory-review/pb_data
STAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/pb_$STAMP.tar.gz" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
# 仅保留最近14天
find "$BACKUP_DIR" -name 'pb_*.tar.gz' -mtime +14 -delete
# 可选：上传阿里云 OSS（需先装并配置 ossutil）
# ossutil cp "$BACKUP_DIR/pb_$STAMP.tar.gz" oss://your-bucket/factory-review/
echo "backup done: pb_$STAMP.tar.gz"
