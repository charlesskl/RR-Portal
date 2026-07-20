#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Database Backup — Automated PostgreSQL backup via pg_dump
# ============================================================
# Creates timestamped SQL dumps of the portal database.
# Keeps last 7 daily backups. Run daily via cron/launchd.
#
# Usage: backup-db.sh  (no arguments)
#
# Required environment variables:
#   DEPLOY_SERVER  — SSH target
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${SCRIPT_DIR}/utils/telegram.sh"

mkdir -p "${REPO_ROOT}/devops/logs"
LOG_FILE="${REPO_ROOT}/devops/logs/backup.log"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_FILE}"; }

if [[ -z "${DEPLOY_SERVER:-}" ]]; then
  log "ERROR: DEPLOY_SERVER not set"
  exit 0
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/opt/rr-portal/backups"
BACKUP_FILE="portal-db-${TIMESTAMP}.sql.gz"
RETENTION_DAYS=7
SQL_BACKUP_DIR="/var/opt/mssql/backup"
SQL_BACKUP_FILE="indo-shipping-${TIMESTAMP}.bak"
SQL_ENV_FILE="/opt/rr-portal/.env.cloud.production"

log "=== BACKUP: Starting database backup ==="

# Create backup directory on server
ssh "${DEPLOY_SERVER}" "mkdir -p ${BACKUP_DIR}" 2>/dev/null || true

# Get the database container name
DB_CONTAINER=$(ssh "${DEPLOY_SERVER}" "docker ps --format '{{.Names}}' | grep db" 2>/dev/null || true)

if [[ -z "$DB_CONTAINER" ]]; then
  log "ERROR: No database container found"
  send_telegram "Database backup FAILED — no db container found"
  exit 0
fi

log "Database container: ${DB_CONTAINER}"

# Run pg_dump inside the container and compress
log "Running pg_dump..."
BACKUP_RESULT=$(ssh "${DEPLOY_SERVER}" "
  set -o pipefail
  docker exec ${DB_CONTAINER} pg_dumpall -U postgres 2>/dev/null | gzip > ${BACKUP_DIR}/${BACKUP_FILE}
  if [[ \$? -eq 0 ]]; then
    SIZE=\$(du -sh ${BACKUP_DIR}/${BACKUP_FILE} | awk '{print \$1}')
    echo \"OK:\${SIZE}\"
  else
    echo 'FAIL'
  fi
" 2>/dev/null || echo "FAIL")

if [[ "$BACKUP_RESULT" == FAIL ]]; then
  log "ERROR: pg_dump failed"
  send_telegram "Database backup FAILED — pg_dump error. Check ${LOG_FILE}"
  exit 1
fi

BACKUP_SIZE="${BACKUP_RESULT#OK:}"
log "Backup created: ${BACKUP_FILE} (${BACKUP_SIZE})"

# Verify backup is not empty
BYTE_SIZE=$(ssh "${DEPLOY_SERVER}" "stat -c %s ${BACKUP_DIR}/${BACKUP_FILE} 2>/dev/null || echo 0" 2>/dev/null || echo "0")

if [[ "$BYTE_SIZE" -lt 100 ]]; then
  log "WARNING: Backup file suspiciously small (${BYTE_SIZE} bytes)"
  send_telegram "Database backup WARNING — file is only ${BYTE_SIZE} bytes. May be empty."
  exit 1
else
  log "Backup verified: ${BYTE_SIZE} bytes"
fi

# Rotate old backups (keep last N days)
log "Rotating backups (keeping last ${RETENTION_DAYS} days)..."
DELETED=$(ssh "${DEPLOY_SERVER}" "
  find ${BACKUP_DIR} -name 'portal-db-*.sql.gz' -mtime +${RETENTION_DAYS} -delete -print 2>/dev/null | wc -l
" 2>/dev/null || echo "0")
DELETED=$(echo "$DELETED" | tr -d '[:space:]')
log "Deleted ${DELETED} old backup(s)"

# SQL Server is optional until the Indonesia service is deployed. The SA
# credential remains base64-encoded outside the container and is never logged.
log "Checking IndoShipping SQL Server backup..."
SQL_BACKUP_RESULT=$(
  ssh "${DEPLOY_SERVER}" \
    "SQL_ENV_FILE='${SQL_ENV_FILE}' SQL_BACKUP_DIR='${SQL_BACKUP_DIR}' SQL_BACKUP_FILE='${SQL_BACKUP_FILE}' bash -s" \
    2>/dev/null <<'REMOTE' || echo "SQL_FAIL"
set -euo pipefail

sql_container=$(docker ps --format '{{.Names}}' | grep -m1 'indo-sqlserver' || true)
if [[ -z "$sql_container" ]]; then
  echo 'SQL_SKIP'
  exit 0
fi

sa_password_b64=$(grep -m1 '^INDO_SQL_SA_PASSWORD_B64=' "$SQL_ENV_FILE" | cut -d= -f2- || true)
if [[ -z "$sa_password_b64" ]] || ! printf '%s' "$sa_password_b64" | base64 --decode >/dev/null 2>&1; then
  echo 'SQL_FAIL'
  exit 0
fi

docker exec \
  -e INDO_SQL_SA_PASSWORD_B64="$sa_password_b64" \
  -e INDO_SQL_BACKUP_FILE="$SQL_BACKUP_FILE" \
  "$sql_container" /bin/bash -lc '
    set -euo pipefail
    backup_path="/var/opt/mssql/backup/${INDO_SQL_BACKUP_FILE}"
    partial_path="${backup_path}.part"
    cleanup() {
      rm -f "${partial_path}"
      unset SQLCMDPASSWORD
    }
    trap cleanup EXIT
    export SQLCMDPASSWORD="$(printf %s "${INDO_SQL_SA_PASSWORD_B64}" | base64 --decode)"
    /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -Q "BACKUP DATABASE [IndoShipping] TO DISK = N'\''${partial_path}'\'' WITH INIT, CHECKSUM;" -o /dev/null
    /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -Q "RESTORE VERIFYONLY FROM DISK = N'\''${partial_path}'\'';" -o /dev/null
    mv "${partial_path}" "${backup_path}"
    trap - EXIT
    unset SQLCMDPASSWORD
  '

sql_size=$(docker exec "$sql_container" stat -c %s "$SQL_BACKUP_DIR/$SQL_BACKUP_FILE")
ls -1t "$SQL_BACKUP_DIR"/indo-shipping-*.bak 2>/dev/null | tail -n +8 | xargs -r rm -f
echo "SQL_OK:$sql_size"
REMOTE
)
SQL_BACKUP_RESULT=$(echo "$SQL_BACKUP_RESULT" | tail -n 1 | tr -d '[:space:]')

case "$SQL_BACKUP_RESULT" in
  SQL_SKIP)
    log "WARNING: indo-sqlserver container is not running; skipping IndoShipping SQL backup"
    SQL_BACKUP_STATUS="skipped"
    ;;
  SQL_OK:*)
    SQL_BACKUP_SIZE="${SQL_BACKUP_RESULT#SQL_OK:}"
    log "IndoShipping SQL backup verified: ${SQL_BACKUP_FILE} (${SQL_BACKUP_SIZE} bytes)"
    SQL_BACKUP_STATUS="verified"
    ;;
  *)
    log "ERROR: IndoShipping SQL backup or RESTORE VERIFYONLY failed"
    send_telegram "PostgreSQL backup OK: ${BACKUP_FILE}; IndoShipping SQL backup FAILED. Check ${LOG_FILE}"
    exit 1
    ;;
esac

# List current backups
log "Current backups:"
ssh "${DEPLOY_SERVER}" "ls -lh ${BACKUP_DIR}/portal-db-*.sql.gz 2>/dev/null | awk '{print \"  \" \$5 \" \" \$9}'" 2>/dev/null || true

log "=== BACKUP: Complete ==="
if [[ "$SQL_BACKUP_STATUS" == "verified" ]]; then
  send_telegram "PostgreSQL backup OK: ${BACKUP_FILE} (${BACKUP_SIZE}); IndoShipping SQL backup verified: ${SQL_BACKUP_FILE}"
else
  send_telegram "PostgreSQL backup OK: ${BACKUP_FILE} (${BACKUP_SIZE}); IndoShipping SQL backup skipped (container absent)"
fi
exit 0
