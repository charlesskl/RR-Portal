#!/usr/bin/env bash
# ============================================================
# Deployment Trigger — Autonomous Agent Orchestrator
# ============================================================
# Receives an app name and deployment context, then launches
# separate Claude Code sessions for each deployment phase:
# UNDERSTAND → PREPARE → DEPLOY → VERIFY
#
# Each phase runs in an independent claude -p session with
# tool restrictions. Phases communicate via JSON state files
# in /tmp/devops-state/<app>/.
#
# Usage: trigger.sh <app-name> [--context "PR description or commit msg"]
#
# Environment:
#   DEPLOY_SERVER      — SSH target (required for non-dry-run)
#   DEPLOY_DRY_RUN     — "true" to skip actual server commands
#   DEPLOY_COMPOSE_PATH — Remote compose path (default: /opt/rr-portal/docker-compose.cloud.yml)
#   PHASE_TIMEOUT      — Max seconds per phase (default: 3600 = 60 min)
# ============================================================

set -euo pipefail

# --- Resolve paths ---
REPO_ROOT="$(git rev-parse --show-toplevel)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="${REPO_ROOT}/devops/agent"

source "${SCRIPT_DIR}/utils/telegram.sh"

# --- Arguments ---
APP_NAME="${1:?Usage: trigger.sh <app-name> [--context \"...\"]}"
CONTEXT=""
shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    --context)
      CONTEXT="$2"
      shift 2
      ;;
    *)
      echo "WARNING: Unknown argument: $1" >&2
      shift
      ;;
  esac
done

# --- Configuration ---
LOCK_DIR="/tmp/devops-agent.lock"   # directory — mkdir is atomic
LOCK_FILE="${LOCK_DIR}/info"        # metadata file inside the lock dir
LOCK_TTL=3600  # 60 minutes
STATE_DIR="/tmp/devops-state/${APP_NAME}"
PHASE_TIMEOUT="${PHASE_TIMEOUT:-3600}"
TOTAL_TIMEOUT=10800  # 3 hours
DRY_RUN="${DEPLOY_DRY_RUN:-false}"

# --- Logging ---
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "${REPO_ROOT}/devops/logs"
LOG_FILE="${REPO_ROOT}/devops/logs/trigger-${APP_NAME}-${TIMESTAMP}.log"
exec > >(tee -a "${LOG_FILE}") 2>&1

echo "=========================================="
echo "  TRIGGER: Autonomous Deploy — ${APP_NAME}"
echo "  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  Dry run: ${DRY_RUN}"
echo "=========================================="

# ============================================================
# Pre-flight checks
# ============================================================
preflight_check() {
  local name="$1"
  local cmd="$2"
  if eval "$cmd" > /dev/null 2>&1; then
    echo "  [OK] ${name}"
    return 0
  else
    echo "  [FAIL] ${name}"
    return 1
  fi
}

echo ""
echo "--- Pre-flight checks ---"
PREFLIGHT_PASS=true

preflight_check "claude CLI" "command -v claude" || PREFLIGHT_PASS=false
preflight_check "docker" "command -v docker" || PREFLIGHT_PASS=false
preflight_check "docker buildx" "docker buildx version" || PREFLIGHT_PASS=false
preflight_check "git" "command -v git" || PREFLIGHT_PASS=false
preflight_check "python3" "command -v python3" || PREFLIGHT_PASS=false

# SSH check (skip in dry-run mode)
if [[ "$DRY_RUN" != "true" ]]; then
  if [[ -z "${DEPLOY_SERVER:-}" ]]; then
    echo "  [FAIL] DEPLOY_SERVER not set"
    PREFLIGHT_PASS=false
  else
    preflight_check "SSH to ${DEPLOY_SERVER}" "ssh -o ConnectTimeout=5 -o BatchMode=yes ${DEPLOY_SERVER} 'echo ok'" || PREFLIGHT_PASS=false
  fi
fi

# Playwright check (non-fatal — falls back to curl)
PLAYWRIGHT_AVAILABLE=false
if command -v npx > /dev/null 2>&1 && npx playwright --version > /dev/null 2>&1; then
  echo "  [OK] Playwright"
  PLAYWRIGHT_AVAILABLE=true
else
  echo "  [WARN] Playwright not available — will use curl-based verification"
fi

if [[ "$PREFLIGHT_PASS" != "true" ]]; then
  echo ""
  echo "=== TRIGGER: Pre-flight FAILED — aborting ==="
  send_telegram "Deployment of ${APP_NAME} aborted: pre-flight checks failed. Check ${LOG_FILE} for details."
  exit 1
fi

echo ""
echo "--- Pre-flight passed ---"

# ============================================================
# Concurrency lock with TTL
# ============================================================
acquire_lock() {
  if [[ -d "$LOCK_DIR" ]]; then
    # Check if lock is stale (older than TTL)
    local lock_age
    # macOS uses stat -f %m, Linux uses stat -c %Y
    local lock_mtime
    lock_mtime=$(stat -f %m "$LOCK_DIR" 2>/dev/null || stat -c %Y "$LOCK_DIR" 2>/dev/null || echo "0")
    lock_age=$(( $(date +%s) - lock_mtime ))

    if [[ $lock_age -gt $LOCK_TTL ]]; then
      echo "=== TRIGGER: Stale lock detected (${lock_age}s old). Removing. ==="
      rm -rf "$LOCK_DIR"
    else
      # Check if PID in lock file is still running
      local lock_pid
      lock_pid=$(head -1 "$LOCK_FILE" 2>/dev/null || echo "0")
      if kill -0 "$lock_pid" 2>/dev/null; then
        echo "=== TRIGGER: Another deployment is running (PID ${lock_pid}, age ${lock_age}s). Skipping. ==="
        exit 0
      else
        echo "=== TRIGGER: Lock held by dead process (PID ${lock_pid}). Removing. ==="
        rm -rf "$LOCK_DIR"
      fi
    fi
  fi

  # Atomic lock acquisition — mkdir fails if dir already exists
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "=== TRIGGER: Lock race lost — another instance acquired the lock. Skipping. ==="
    exit 0
  fi

  # Write metadata into the lock directory
  echo "$$" > "$LOCK_FILE"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOCK_FILE"
  echo "app=${APP_NAME}" >> "$LOCK_FILE"
  echo "=== TRIGGER: Lock acquired (PID $$) ==="
}

release_lock() {
  rm -rf "$LOCK_DIR"
  echo "=== TRIGGER: Lock released ==="
}

# Ensure lock is released on exit (including errors)
cleanup() {
  release_lock
  echo "=== TRIGGER: Cleanup complete ==="
}
trap cleanup EXIT

acquire_lock

# ============================================================
# State directory setup
# ============================================================
mkdir -p "$STATE_DIR"
echo "=== TRIGGER: State directory: ${STATE_DIR} ==="

# ============================================================
# Server state reconciliation
# ============================================================
reconcile_state() {
  echo ""
  echo "--- Reconciling registry vs server state ---"

  local app_in_registry
  app_in_registry=$(python3 -c "
import json, sys
d = json.load(open('${REPO_ROOT}/devops/config/apps.json'))
print('yes' if sys.argv[1] in d else 'no')
" "$APP_NAME" 2>/dev/null || echo "error")

  local app_on_server="unknown"
  if [[ "$DRY_RUN" != "true" && -n "${DEPLOY_SERVER:-}" ]]; then
    app_on_server=$(ssh -o ConnectTimeout=5 "${DEPLOY_SERVER}" \
      "docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^${APP_NAME}$' && echo yes || echo no" \
      2>/dev/null || echo "unknown")
  fi

  echo "  Registry: ${app_in_registry}"
  echo "  Server: ${app_on_server}"

  if [[ "$app_in_registry" == "yes" && "$app_on_server" == "no" && "$DRY_RUN" != "true" ]]; then
    echo "  [WARN] Registry says app exists but server doesn't have it running."
    echo "  This could mean the app was registered but never deployed, or the container stopped."
    echo "  Proceeding with update path (will re-deploy)."
  elif [[ "$app_in_registry" == "no" && "$app_on_server" == "yes" ]]; then
    echo "  [ERROR] App exists on server but NOT in registry. State is inconsistent."
    send_telegram "Deployment of ${APP_NAME} aborted: app exists on server but not in registry. Manual intervention needed."
    exit 1
  fi

  echo "  [OK] State reconciled"
}

reconcile_state

# ============================================================
# Phase execution
# ============================================================
run_phase() {
  local phase_name="$1"
  local prompt="$2"
  local phase_num="$3"

  echo ""
  echo "=========================================="
  echo "  Phase ${phase_num}/4: ${phase_name}"
  echo "  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "=========================================="

  local phase_log="${REPO_ROOT}/devops/logs/phase-${APP_NAME}-${phase_name}-${TIMESTAMP}.log"

  # Build the claude command
  local claude_cmd="claude"
  claude_cmd+=" --print"
  claude_cmd+=" --dangerously-skip-permissions"
  claude_cmd+=" --max-turns 50"

  # Write prompt to temp file to avoid shell injection from user-controlled content
  local prompt_file
  prompt_file=$(mktemp /tmp/devops-prompt-XXXXXXXX)
  cat > "$prompt_file" << PROMPT_EOF
You are the autonomous DevOps agent. Read ${AGENT_DIR}/CLAUDE.md for your full protocol.

Execute Phase: ${phase_name}
App: ${APP_NAME}
State directory: ${STATE_DIR}
Dry run: ${DRY_RUN}
Context: ${CONTEXT:-none provided}

Environment variables available (read from env, do NOT log their values):
  DEPLOY_SERVER (set in environment)
  DEPLOY_DRY_RUN=${DRY_RUN}
  DEPLOY_COMPOSE_PATH=${DEPLOY_COMPOSE_PATH:-/opt/rr-portal/docker-compose.cloud.yml}

${prompt}
PROMPT_EOF

  # Execute with timeout — read prompt from file to avoid shell injection
  local exit_code=0
  if timeout "${PHASE_TIMEOUT}" bash -c "cd '${REPO_ROOT}' && ${claude_cmd} -p \"\$(cat '${prompt_file}')\"" > "$phase_log" 2>&1; then
    echo "=== Phase ${phase_name}: completed ==="
    exit_code=0
  else
    exit_code=$?
    if [[ $exit_code -eq 124 ]]; then
      echo "=== Phase ${phase_name}: TIMEOUT (${PHASE_TIMEOUT}s) ==="
      send_telegram "Deployment of ${APP_NAME} phase ${phase_name} timed out after ${PHASE_TIMEOUT}s."
    else
      echo "=== Phase ${phase_name}: FAILED (exit ${exit_code}) ==="
    fi
  fi

  # Clean up prompt temp file
  rm -f "$prompt_file"

  # Validate output state file exists
  local output_file="${STATE_DIR}/${phase_name}.json"
  if [[ ! -f "$output_file" ]]; then
    echo "=== Phase ${phase_name}: WARNING — no output state file written ==="
    # Create a minimal failure state
    python3 -c "
import json, sys
from datetime import datetime, timezone
state = {
    'schema_version': 1,
    'phase': sys.argv[1],
    'app_name': sys.argv[2],
    'timestamp': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'status': 'failed',
    'error': f'Phase exited with code {sys.argv[3]} and did not write output state'
}
with open(sys.argv[4], 'w') as f:
    json.dump(state, f, indent=2)
" "$phase_name" "$APP_NAME" "$exit_code" "$output_file"
  fi

  return $exit_code
}

# ============================================================
# Phase orchestration
# ============================================================
DEPLOY_START=$(date +%s)

# --- Phase 1: UNDERSTAND ---
run_phase "understand" \
  "Read the app code in apps/${APP_NAME}/, detect its stack and requirements, and decide whether this is a new onboard or an update. Write your findings to ${STATE_DIR}/understand.json." \
  1

# Validate understand output
if ! "${AGENT_DIR}/validate-state.sh" "${STATE_DIR}/understand.json" "understand" --require-success; then
  echo "=== TRIGGER: UNDERSTAND phase failed. Aborting. ==="
  send_telegram "Deployment of ${APP_NAME} failed at UNDERSTAND phase. $(cat "${STATE_DIR}/understand.json" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("error","unknown error"))' 2>/dev/null || echo 'Check logs.')"
  exit 1
fi

# --- Phase 2: PREPARE ---
run_phase "prepare" \
  "Read ${STATE_DIR}/understand.json for context. Run QC checks, apply fixes, and prepare the app for deployment. Write results to ${STATE_DIR}/prepare.json." \
  2

if ! "${AGENT_DIR}/validate-state.sh" "${STATE_DIR}/prepare.json" "prepare" --require-success; then
  echo "=== TRIGGER: PREPARE phase failed. Aborting. ==="
  send_telegram "Deployment of ${APP_NAME} failed at PREPARE phase. QC checks could not be resolved. $(cat "${STATE_DIR}/prepare.json" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("error","unknown error"))' 2>/dev/null || echo 'Check logs.')"
  exit 1
fi

# --- Phase 3: DEPLOY ---
run_phase "deploy" \
  "Read ${STATE_DIR}/prepare.json for context. Build the Docker image with buildx, transfer to server, update compose, and start the container. Write results to ${STATE_DIR}/deploy.json." \
  3

if ! "${AGENT_DIR}/validate-state.sh" "${STATE_DIR}/deploy.json" "deploy" --require-success; then
  echo "=== TRIGGER: DEPLOY phase failed. Running rollback. ==="
  # Attempt rollback
  if [[ "$DRY_RUN" != "true" ]]; then
    "${SCRIPT_DIR}/rollback.sh" "$APP_NAME" 2>&1 || true
  fi
  send_telegram "Deployment of ${APP_NAME} failed at DEPLOY phase and was rolled back. $(cat "${STATE_DIR}/deploy.json" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("error","unknown error"))' 2>/dev/null || echo 'Check logs.')"
  exit 1
fi

# --- Phase 4: VERIFY ---
run_phase "verify" \
  "Read ${STATE_DIR}/deploy.json for context. Verify the deployment works: health check, frontend loads, API endpoints respond. Take screenshots if Playwright is available (PLAYWRIGHT_AVAILABLE=${PLAYWRIGHT_AVAILABLE}). Send Telegram notification with results. Write results to ${STATE_DIR}/verify.json." \
  4

if ! "${AGENT_DIR}/validate-state.sh" "${STATE_DIR}/verify.json" "verify" --require-success; then
  echo "=== TRIGGER: VERIFY phase failed. Deployment may be broken. ==="
  send_telegram "Deployment of ${APP_NAME} completed but verification FAILED. The app may not be working correctly. Manual check recommended."
  exit 1
fi

# ============================================================
# Success — log deployment record
# ============================================================
DEPLOY_END=$(date +%s)
DEPLOY_DURATION=$(( DEPLOY_END - DEPLOY_START ))

echo ""
echo "=========================================="
echo "  TRIGGER: Deployment SUCCESS"
echo "  App: ${APP_NAME}"
echo "  Duration: ${DEPLOY_DURATION}s"
echo "  Log: ${LOG_FILE}"
echo "=========================================="

# Append to deployment log
python3 -c "
import json, sys
from datetime import datetime, timezone
record = {
    'timestamp': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'app': sys.argv[1],
    'status': 'success',
    'duration_seconds': int(sys.argv[2]),
    'dry_run': sys.argv[3] == 'true',
    'log_file': sys.argv[4]
}
with open(sys.argv[5], 'a') as f:
    f.write(json.dumps(record) + '\n')
" "$APP_NAME" "$DEPLOY_DURATION" "$DRY_RUN" "$LOG_FILE" "${REPO_ROOT}/devops/logs/deployments.jsonl"

echo "=== TRIGGER: Deployment record written to deployments.jsonl ==="
