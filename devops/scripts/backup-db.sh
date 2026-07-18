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
  exit 0
fi

BACKUP_SIZE="${BACKUP_RESULT#OK:}"
log "Backup created: ${BACKUP_FILE} (${BACKUP_SIZE})"

# Verify backup is not empty
BYTE_SIZE=$(ssh "${DEPLOY_SERVER}" "stat -c %s ${BACKUP_DIR}/${BACKUP_FILE} 2>/dev/null || echo 0" 2>/dev/null || echo "0")

if [[ "$BYTE_SIZE" -lt 100 ]]; then
  log "WARNING: Backup file suspiciously small (${BYTE_SIZE} bytes)"
  send_telegram "Database backup WARNING — file is only ${BYTE_SIZE} bytes. May be empty."
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

# List current backups
log "Current backups:"
ssh "${DEPLOY_SERVER}" "ls -lh ${BACKUP_DIR}/portal-db-*.sql.gz 2>/dev/null | awk '{print \"  \" \$5 \" \" \$9}'" 2>/dev/null || true

log "=== BACKUP: Complete ==="
send_telegram "Database backup OK: ${BACKUP_FILE} (${BACKUP_SIZE})"
exit 0
