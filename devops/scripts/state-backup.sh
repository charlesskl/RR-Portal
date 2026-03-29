#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# State File Backup — Periodic backup of critical state files
# ============================================================
# Creates timestamped copies of registry and monitoring state
# files. Retains the last N backups and removes older ones.
#
# Backed up files:
#   - devops/config/apps.json          (app registry)
#   - devops/config/ports.json         (port allocations)
#   - devops/logs/health-state.json    (monitoring state)
#
# Usage: state-backup.sh  (no arguments, called by cron/launchd)
# ============================================================

REPO_ROOT="$(git rev-parse --show-toplevel)"
BACKUP_DIR="${REPO_ROOT}/devops/backups"
MAX_BACKUPS=30  # Keep 30 days of backups

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [state-backup] $*"; }

mkdir -p "${BACKUP_DIR}"

TIMESTAMP=$(date '+%Y%m%d-%H%M%S')

# Files to back up
STATE_FILES=(
  "${REPO_ROOT}/devops/config/apps.json"
  "${REPO_ROOT}/devops/config/ports.json"
  "${REPO_ROOT}/devops/logs/health-state.json"
)

backed_up=0
for file in "${STATE_FILES[@]}"; do
  if [[ -f "${file}" ]]; then
    basename=$(basename "${file}" | sed 's/\./-/g')
    backup_path="${BACKUP_DIR}/${basename}-${TIMESTAMP}.bak"
    cp "${file}" "${backup_path}"
    log "Backed up ${file} → ${backup_path}"
    backed_up=$((backed_up + 1))
  else
    log "SKIP: ${file} does not exist"
  fi
done

# --- Prune old backups ---
# Count backups per base name and remove oldest beyond MAX_BACKUPS
for file in "${STATE_FILES[@]}"; do
  basename=$(basename "${file}" | sed 's/\./-/g')
  pattern="${BACKUP_DIR}/${basename}-*.bak"

  # Get all matching backups sorted by name (oldest first)
  backup_count=$(ls -1 ${pattern} 2>/dev/null | wc -l | tr -d ' ')

  if [[ "${backup_count}" -gt "${MAX_BACKUPS}" ]]; then
    remove_count=$((backup_count - MAX_BACKUPS))
    log "Pruning ${remove_count} old backup(s) for ${basename}"
    ls -1 ${pattern} 2>/dev/null | head -n "${remove_count}" | while read -r old_backup; do
      rm -f "${old_backup}"
      log "Removed old backup: ${old_backup}"
    done
  fi
done

log "State backup complete (${backed_up} files backed up)"
