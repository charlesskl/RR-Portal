#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Log Rotation — Rotate and compress health-check and audit logs
# ============================================================
# Rotates logs when they exceed a size threshold. Keeps a
# configurable number of compressed archives. Designed to run
# daily via cron/launchd.
#
# Managed files:
#   - devops/logs/health-check.log   (max 5MB, keep 5 rotations)
#   - devops/logs/audit.tsv          (max 10MB, keep 10 rotations)
#   - devops/logs/telegram-pending.txt (max 1MB, keep 3 rotations)
#
# Usage: log-rotate.sh  (no arguments, called by cron/launchd)
# ============================================================

REPO_ROOT="$(git rev-parse --show-toplevel)"
LOGS_DIR="${REPO_ROOT}/devops/logs"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [log-rotate] $*"; }

# rotate_file <file> <max_size_bytes> <keep_count>
rotate_file() {
  local file="$1"
  local max_size="$2"
  local keep="$3"

  if [[ ! -f "${file}" ]]; then
    return 0
  fi

  local file_size
  file_size=$(stat -f%z "${file}" 2>/dev/null || stat -c%s "${file}" 2>/dev/null || echo "0")

  if [[ "${file_size}" -lt "${max_size}" ]]; then
    return 0
  fi

  log "Rotating ${file} (${file_size} bytes > ${max_size} limit)"

  # Shift existing rotations: .4.gz -> .5.gz, .3.gz -> .4.gz, etc.
  local i="${keep}"
  while [[ "${i}" -gt 1 ]]; do
    local prev=$((i - 1))
    if [[ -f "${file}.${prev}.gz" ]]; then
      mv "${file}.${prev}.gz" "${file}.${i}.gz"
    fi
    i=$((i - 1))
  done

  # Compress current file to .1.gz
  gzip -c "${file}" > "${file}.1.gz"

  # Truncate (not delete) to preserve any concurrent writers' file handles
  : > "${file}"

  # Preserve TSV header for audit.tsv
  if [[ "${file}" == *"audit.tsv" ]]; then
    printf "timestamp\tevent\tapp\tcommit\tuser\tdetails\n" > "${file}"
  fi

  # Remove excess rotations
  local j=$((keep + 1))
  while [[ -f "${file}.${j}.gz" ]]; do
    rm -f "${file}.${j}.gz"
    j=$((j + 1))
  done

  log "Rotated ${file} successfully"
}

# --- Rotate managed log files ---
rotate_file "${LOGS_DIR}/health-check.log"   $((5 * 1024 * 1024))   5
rotate_file "${LOGS_DIR}/audit.tsv"          $((10 * 1024 * 1024))  10
rotate_file "${LOGS_DIR}/telegram-pending.txt" $((1 * 1024 * 1024)) 3

log "Log rotation complete"
