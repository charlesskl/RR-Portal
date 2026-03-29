#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Health Check — Periodic monitoring for all active RR-Portal apps
# ============================================================
# Features:
#   - Basic /health endpoint check + deep API endpoint verification
#   - Circuit breaker: stops restarting after N consecutive failures
#   - Exponential backoff: 15s, 30s, 60s between restart attempts
#   - File locking: prevents concurrent state file corruption
#   - Escalation: Telegram alert when circuit breaker trips
#   - Audit logging: records restart/escalation events
#
# Usage: health-check.sh  (no arguments, called by cron/launchd)
#
# Required environment variables:
#   DEPLOY_SERVER        — SSH target (e.g., charles@192.168.1.50)
#   DEPLOY_COMPOSE_PATH  — Path to docker-compose.yml on server
#                          (default: /opt/rr-portal/docker-compose.yml)
# ============================================================

# --- Resolve paths ---
REPO_ROOT="$(git rev-parse --show-toplevel)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Source utilities ---
source "${SCRIPT_DIR}/utils/telegram.sh"
source "${SCRIPT_DIR}/utils/audit.sh"

# --- Logging setup ---
mkdir -p "${REPO_ROOT}/devops/logs"
LOG_FILE="${REPO_ROOT}/devops/logs/health-check.log"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_FILE}"; }

# --- Script-level lock (prevent concurrent runs) ---
LOCK_DIR="${REPO_ROOT}/devops/logs/.health-check.lock"
cleanup_lock() {
  rmdir "${LOCK_DIR}" 2>/dev/null || true
}
if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  # Check if lock is stale (older than 10 minutes)
  if [[ -d "${LOCK_DIR}" ]]; then
    lock_age=$(( $(date +%s) - $(stat -f%m "${LOCK_DIR}" 2>/dev/null || stat -c%Y "${LOCK_DIR}" 2>/dev/null || echo "0") ))
    if [[ "${lock_age}" -gt 600 ]]; then
      log "WARNING: Stale lock detected (${lock_age}s old), removing"
      rmdir "${LOCK_DIR}" 2>/dev/null || true
      mkdir "${LOCK_DIR}" 2>/dev/null || { log "ERROR: Could not acquire lock"; exit 0; }
    else
      exit 0  # Another instance is running — skip silently
    fi
  fi
fi
trap cleanup_lock EXIT

# --- Circuit breaker configuration ---
MAX_CONSECUTIVE_FAILURES=3

# --- Validate environment ---
if [ -z "${DEPLOY_SERVER:-}" ]; then
  log "ERROR: DEPLOY_SERVER environment variable is required (e.g., charles@192.168.1.50)"
  exit 0  # Exit cleanly — do not crash cron scheduler
fi

DEPLOY_SERVER_HOST="${DEPLOY_SERVER#*@}"

# Default compose path if not set
DEPLOY_COMPOSE_PATH="${DEPLOY_COMPOSE_PATH:-/opt/rr-portal/docker-compose.yml}"
DEPLOY_COMPOSE_DIR="$(dirname "${DEPLOY_COMPOSE_PATH}")"

# --- Adaptive interval: intensive (every 60s) within 30min of last deploy ---
DEPLOYMENTS_JSONL="${REPO_ROOT}/devops/logs/deployments.jsonl"
INTENSIVE_WINDOW_SECONDS=1800  # 30 minutes

_should_run() {
  local now_epoch
  now_epoch=$(date +%s)

  if [[ -f "${DEPLOYMENTS_JSONL}" ]]; then
    local last_line
    last_line=$(tail -1 "${DEPLOYMENTS_JSONL}" 2>/dev/null || true)
    if [[ -n "${last_line}" ]]; then
      local last_ts
      last_ts=$(python3 -c "
import json, sys, datetime
try:
    entry = json.loads(sys.argv[1])
    if entry.get('dry_run', False):
        print('0')
        sys.exit(0)
    ts = entry.get('ts', '')
    dt = datetime.datetime.fromisoformat(ts.replace('Z', '+00:00'))
    print(int(dt.timestamp()))
except Exception:
    print('0')
" "$last_line" 2>/dev/null || echo "0")

      local elapsed=$(( now_epoch - last_ts ))
      if [[ "${elapsed}" -lt "${INTENSIVE_WINDOW_SECONDS}" ]]; then
        return 0
      fi
    fi
  fi

  local current_minute
  current_minute=$(date +%M | sed 's/^0//')
  current_minute=${current_minute:-0}
  if (( current_minute % 5 == 0 )); then
    return 0
  fi

  return 1
}

if ! _should_run; then
  exit 0
fi

# --- State tracking (with migration from old format) ---
STATE_FILE="${REPO_ROOT}/devops/logs/health-state.json"
STATE_LOCK="${STATE_FILE}.lock"

# Atomic state file read with locking
read_state() {
  python3 -c "
import json, sys, fcntl, os

state_file = sys.argv[1]
lock_file = sys.argv[2]

# Create lock file if needed
lock_fd = open(lock_file, 'w')
try:
    fcntl.flock(lock_fd, fcntl.LOCK_SH)
    if os.path.exists(state_file):
        with open(state_file) as f:
            state = json.load(f)
    else:
        state = {}

    # Migrate old format (string values) to new format (object values)
    migrated = {}
    for app, val in state.items():
        if isinstance(val, str):
            migrated[app] = {
                'status': val,
                'failures': 0,
                'circuit_open': False
            }
        elif isinstance(val, dict):
            migrated[app] = val
        else:
            migrated[app] = {'status': 'unknown', 'failures': 0, 'circuit_open': False}

    print(json.dumps(migrated))
finally:
    fcntl.flock(lock_fd, fcntl.LOCK_UN)
    lock_fd.close()
" "$STATE_FILE" "$STATE_LOCK"
}

# Atomic state file write with locking
write_state() {
  local state_json="$1"
  python3 -c "
import json, sys, fcntl, tempfile, os

state_json = sys.argv[1]
state_file = sys.argv[2]
lock_file = sys.argv[3]

state = json.loads(state_json)

lock_fd = open(lock_file, 'w')
try:
    fcntl.flock(lock_fd, fcntl.LOCK_EX)
    # Atomic write: write to temp file, then rename
    dir_name = os.path.dirname(state_file)
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix='.json')
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(state, f, indent=2)
            f.write('\n')
        os.rename(tmp_path, state_file)
    except:
        os.unlink(tmp_path)
        raise
finally:
    fcntl.flock(lock_fd, fcntl.LOCK_UN)
    lock_fd.close()
" "$state_json" "$STATE_FILE" "$STATE_LOCK"
}

HEALTH_STATE=$(read_state)

# Helper: get previous state for an app
get_prev_status() {
  local app="$1"
  python3 -c "
import json, sys
state = json.loads(sys.argv[1])
entry = state.get(sys.argv[2], {})
if isinstance(entry, str):
    print(entry)
else:
    print(entry.get('status', 'unknown'))
" "$HEALTH_STATE" "$app"
}

# Helper: get consecutive failure count
get_failure_count() {
  local app="$1"
  python3 -c "
import json, sys
state = json.loads(sys.argv[1])
entry = state.get(sys.argv[2], {})
print(entry.get('failures', 0) if isinstance(entry, dict) else 0)
" "$HEALTH_STATE" "$app"
}

# Helper: check if circuit breaker is open
is_circuit_open() {
  local app="$1"
  python3 -c "
import json, sys
state = json.loads(sys.argv[1])
entry = state.get(sys.argv[2], {})
open_flag = entry.get('circuit_open', False) if isinstance(entry, dict) else False
sys.exit(0 if open_flag else 1)
" "$HEALTH_STATE" "$app"
}

# Helper: set state for an app (structured)
set_state() {
  local app="$1" status="$2" failures="$3" circuit_open="$4"
  HEALTH_STATE=$(python3 -c "
import json, sys
state = json.loads(sys.argv[1])
state[sys.argv[2]] = {
    'status': sys.argv[3],
    'failures': int(sys.argv[4]),
    'circuit_open': sys.argv[5] == 'true'
}
print(json.dumps(state))
" "$HEALTH_STATE" "$app" "$status" "$failures" "$circuit_open")
}

# --- Exponential backoff ---
# Returns wait time in seconds: 15, 30, 60 (capped)
backoff_wait() {
  local failures="$1"
  python3 -c "
import sys
failures = int(sys.argv[1])
base = 15
wait = min(base * (2 ** max(0, failures - 1)), 60)
print(wait)
" "$failures"
}

# --- Deep health check ---
DEEP_CHECKS_FILE="${REPO_ROOT}/devops/config/deep-checks.json"

# Get deep check endpoint for an app (returns empty if not configured)
get_deep_endpoint() {
  local app="$1"
  python3 -c "
import json, sys, os
checks_file = sys.argv[1]
app = sys.argv[2]
if not os.path.exists(checks_file):
    print('')
    sys.exit(0)
try:
    with open(checks_file) as f:
        checks = json.load(f)
    entry = checks.get(app, {})
    print(entry.get('deep_endpoint', ''))
except Exception:
    print('')
" "$DEEP_CHECKS_FILE" "$app"
}

# --- Read apps from registry ---
APPS_FILE="${REPO_ROOT}/devops/config/apps.json"
if [ ! -f "${APPS_FILE}" ]; then
  log "ERROR: apps.json not found at ${APPS_FILE}"
  exit 0
fi

APPS=$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
for name, info in d.items():
    if info.get('status') == 'active':
        print(f\"{name}:{info['port']}\")
" "$APPS_FILE")

if [ -z "${APPS}" ]; then
  log "No active apps found in apps.json"
  exit 0
fi

# --- Health-check loop ---
log "=== HEALTH-CHECK: Starting health checks ==="

for entry in ${APPS}; do
  app_name="${entry%%:*}"
  port="${entry##*:}"

  log "Checking ${app_name} on port ${port}..."

  prev_status=$(get_prev_status "${app_name}")
  failure_count=$(get_failure_count "${app_name}")

  # --- Circuit breaker check ---
  if is_circuit_open "${app_name}"; then
    log "${app_name}: CIRCUIT OPEN — skipping restart (${failure_count} consecutive failures). Manual reset required."
    # Still check if the service recovered on its own
    if curl -sf --max-time 5 "http://${DEPLOY_SERVER_HOST}:${port}/health" > /dev/null 2>&1; then
      log "${app_name}: Service recovered on its own! Resetting circuit breaker."
      send_telegram "${app_name} has self-recovered after circuit breaker was tripped (${failure_count} failures). Circuit breaker reset."
      set_state "${app_name}" "up" "0" "false"
      audit_log "recovery" "${app_name}" "self-recovered, circuit breaker reset after ${failure_count} failures"
    fi
    continue
  fi

  # --- Basic health check ---
  basic_ok=false
  if curl -sf --max-time 5 "http://${DEPLOY_SERVER_HOST}:${port}/health" > /dev/null 2>&1; then
    basic_ok=true
  fi

  if ${basic_ok}; then
    # --- Deep health check ---
    deep_endpoint=$(get_deep_endpoint "${app_name}")
    deep_ok=true
    if [[ -n "${deep_endpoint}" ]]; then
      http_status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://${DEPLOY_SERVER_HOST}:${port}${deep_endpoint}" 2>/dev/null || echo "000")
      if [[ "${http_status}" -ge 200 && "${http_status}" -lt 500 ]]; then
        log "${app_name}: Deep check OK (${deep_endpoint} → ${http_status})"
      else
        deep_ok=false
        log "${app_name}: Deep check FAILED (${deep_endpoint} → ${http_status})"
      fi
    fi

    if ${deep_ok}; then
      log "${app_name}: OK"

      # Recovery detection
      if [ "${prev_status}" = "down" ]; then
        log "${app_name}: Recovered — was previously down, now healthy"
        send_telegram "${app_name} has recovered and is back online on port ${port}."
        audit_log "recovery" "${app_name}" "recovered, back online on port ${port}"
      fi

      set_state "${app_name}" "up" "0" "false"
    else
      # Deep check failed but basic health is OK — log warning, don't restart
      log "${app_name}: WARNING — /health OK but deep check failed. Not restarting."
      send_telegram "${app_name} /health is OK but deep API check failed (${deep_endpoint} → ${http_status}). Investigate manually."
      # Don't increment failure count for deep-only failures
      set_state "${app_name}" "degraded" "${failure_count}" "false"
    fi
  else
    log "${app_name}: FAIL — health check failed"

    # Increment failure count
    failure_count=$((failure_count + 1))

    # --- Circuit breaker: check if we should stop restarting ---
    if [[ "${failure_count}" -ge "${MAX_CONSECUTIVE_FAILURES}" ]]; then
      log "${app_name}: CIRCUIT BREAKER TRIPPED — ${failure_count} consecutive failures. Stopping auto-restart."
      send_telegram "CRITICAL: ${app_name} circuit breaker tripped after ${failure_count} consecutive restart failures. Auto-restart DISABLED. Manual intervention required. Port ${port}."
      set_state "${app_name}" "down" "${failure_count}" "true"
      audit_log "circuit_break" "${app_name}" "circuit breaker tripped after ${failure_count} failures, auto-restart disabled"
      continue
    fi

    # --- Exponential backoff restart ---
    wait_time=$(backoff_wait "${failure_count}")
    log "${app_name}: Attempting auto-restart (attempt ${failure_count}/${MAX_CONSECUTIVE_FAILURES}, backoff ${wait_time}s)..."

    if ssh "${DEPLOY_SERVER}" "cd ${DEPLOY_COMPOSE_DIR} && docker compose restart ${app_name}" 2>&1; then
      log "${app_name}: Restart command sent. Waiting ${wait_time} seconds (exponential backoff)..."
      sleep "${wait_time}"

      # Re-check health after restart
      if curl -sf --max-time 5 "http://${DEPLOY_SERVER_HOST}:${port}/health" > /dev/null 2>&1; then
        log "${app_name}: Auto-restart succeeded — app is back online"
        send_telegram "${app_name} was down. Auto-restarted successfully (attempt ${failure_count}). Back online on port ${port}."
        set_state "${app_name}" "up" "0" "false"
        audit_restart "${app_name}" "auto-restarted successfully (attempt ${failure_count})"
      else
        log "${app_name}: Auto-restart FAILED — app still not responding (attempt ${failure_count}/${MAX_CONSECUTIVE_FAILURES})"
        if [[ "${failure_count}" -ge "${MAX_CONSECUTIVE_FAILURES}" ]]; then
          send_telegram "CRITICAL: ${app_name} circuit breaker tripped after ${failure_count} consecutive restart failures. Auto-restart DISABLED. Manual intervention required. Port ${port}."
          set_state "${app_name}" "down" "${failure_count}" "true"
          audit_log "circuit_break" "${app_name}" "circuit breaker tripped after ${failure_count} failures"
        else
          send_telegram "${app_name} auto-restart failed (attempt ${failure_count}/${MAX_CONSECUTIVE_FAILURES}). Will retry with longer backoff. Port ${port}."
          set_state "${app_name}" "down" "${failure_count}" "false"
          audit_restart "${app_name}" "auto-restart failed (attempt ${failure_count}/${MAX_CONSECUTIVE_FAILURES})"
        fi
      fi
    else
      log "${app_name}: SSH restart command failed"
      send_telegram "${app_name} is DOWN and SSH restart failed (attempt ${failure_count}/${MAX_CONSECUTIVE_FAILURES}). Port ${port}."
      set_state "${app_name}" "down" "${failure_count}" "false"
      audit_restart "${app_name}" "SSH restart command failed (attempt ${failure_count}/${MAX_CONSECUTIVE_FAILURES})"
    fi
  fi
done

# --- Save updated state (atomic write with lock) ---
write_state "$HEALTH_STATE"

log "=== HEALTH-CHECK: Complete ==="
exit 0
