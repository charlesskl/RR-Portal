#!/usr/bin/env bash
# ERP 数据恢复:把全量快照灌入 erp-sqlserver 容器。
# 用法: bash deploy/erp-restore-data.sh <full_data_snapshot.sql.gz 路径>
# 快照幂等(禁外键→清表→重插→恢复外键), 但会覆盖云端现有业务数据——
# 仅用于首次灌库/整体回滚, 云端已有新录入数据时慎用。
set +x
set -Eeuo pipefail

GZ=${1:?用法: erp-restore-data.sh <快照.gz 路径>}
[ -f "$GZ" ] || { echo "ERROR: 文件不存在: $GZ" >&2; exit 1; }

LOCK_FILE=/tmp/erp-data-restore.lock
exec 9>"$LOCK_FILE"
flock -n 9 || { echo "ERROR: 已有恢复任务在跑" >&2; exit 1; }

log() { printf '%s\n' "$*" >&2; }

C=$(docker ps --filter name=erp-sqlserver --format '{{.Names}}' | head -1)
[ -n "$C" ] || { log "ERROR: 找不到运行中的 erp-sqlserver 容器"; exit 1; }
log "目标容器: $C"

PW=$(docker exec "$C" printenv MSSQL_SA_PASSWORD)
[ -n "$PW" ] || { log "ERROR: 取不到容器 MSSQL_SA_PASSWORD"; exit 1; }

SQLCMD=/opt/mssql-tools18/bin/sqlcmd
docker exec "$C" test -x "$SQLCMD" 2>/dev/null || SQLCMD=/opt/mssql-tools/bin/sqlcmd
log "sqlcmd: $SQLCMD"

SQL=/tmp/full_data_snapshot.sql
cleanup() {
  rm -f "$SQL"
  docker exec "$C" rm -f /tmp/erp_restore.sql 2>/dev/null || true
}
trap cleanup EXIT

log "[1/4] 解压快照(约 186MB)..."
gunzip -kc "$GZ" > "$SQL"

log "[2/4] 拷入容器..."
docker cp "$SQL" "$C":/tmp/erp_restore.sql

log "[3/4] 表结构预检(快照中的表必须都已存在)..."
sed -n 's/^DELETE FROM \[dbo\]\.\[\(.*\)\].$/\1/p' "$SQL" | tr -d '\r' | sort -u > /tmp/snap_tables.txt
docker exec "$C" "$SQLCMD" -C -S 127.0.0.1 -U sa -P "$PW" -d erp -h-1 -W \
  -Q "SET NOCOUNT ON; SELECT name FROM sys.tables" | tr -d '\r' | sed '/^$/d' | sort -u > /tmp/db_tables.txt
MISSING=$(comm -23 /tmp/snap_tables.txt /tmp/db_tables.txt)
if [ -n "$MISSING" ]; then
  log "ERROR: 云端库缺少以下表, 中止(请先完成迁移再恢复):"
  log "$MISSING"
  exit 1
fi
SNAP_N=$(wc -l < /tmp/snap_tables.txt | tr -d ' ')
log "预检通过: ${SNAP_N} 张表全部存在"
rm -f /tmp/snap_tables.txt /tmp/db_tables.txt

log "[4/4] 执行恢复(186MB, 需几分钟, 请耐心)..."
docker exec "$C" "$SQLCMD" -C -S 127.0.0.1 -U sa -P "$PW" -d erp -b -i /tmp/erp_restore.sql

ROWS=$(docker exec "$C" "$SQLCMD" -C -S 127.0.0.1 -U sa -P "$PW" -d erp -h-1 -W \
  -Q "SET NOCOUNT ON; SELECT CAST(SUM(row_count) AS bigint) FROM sys.dm_db_partition_stats WHERE index_id IN (0,1) AND OBJECTPROPERTY(object_id,'IsMsShipped')=0" | tr -d '\r ')
log "恢复完成, 用户表总行数: ${ROWS}"
