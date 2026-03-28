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

# --- Server-side pre-flight (skip in dry-run) ---
if [[ "$DRY_RUN" != "true" && -n "${DEPLOY_SERVER:-}" ]]; then
  echo ""
  echo "--- Server readiness checks ---"

  # Docker daemon running on server
  preflight_check "Server Docker" "ssh -o ConnectTimeout=5 ${DEPLOY_SERVER} 'docker info > /dev/null 2>&1'" || PREFLIGHT_PASS=false

  # Disk space (at least 2 GB free)
  SERVER_DISK_FREE=$(ssh -o ConnectTimeout=5 "${DEPLOY_SERVER}" "df -k /opt/rr-portal 2>/dev/null | tail -1 | awk '{print \$4}'" 2>/dev/null || echo "0")
  SERVER_DISK_GB=$(( SERVER_DISK_FREE / 1048576 ))
  if [[ "$SERVER_DISK_FREE" -lt 2097152 ]]; then
    echo "  [FAIL] Server disk: ${SERVER_DISK_GB} GB free (need 2 GB)"
    PREFLIGHT_PASS=false
  else
    echo "  [OK] Server disk: ${SERVER_DISK_GB} GB free"
  fi

  # nginx running
  preflight_check "Server nginx" "ssh -o ConnectTimeout=5 ${DEPLOY_SERVER} 'docker ps --format {{.Names}} | grep -q nginx'" || {
    echo "  [WARN] nginx not running — deployment will succeed but app won't be reachable"
  }

  # PostgreSQL running (if any app uses it)
  DB_RUNNING=$(ssh -o ConnectTimeout=5 "${DEPLOY_SERVER}" "docker ps --format '{{.Names}}' | grep -q 'db\|postgres' && echo yes || echo no" 2>/dev/null || echo "unknown")
  if [[ "$DB_RUNNING" == "yes" ]]; then
    echo "  [OK] Server PostgreSQL: running"
  elif [[ "$DB_RUNNING" == "no" ]]; then
    echo "  [WARN] Server PostgreSQL: not running — DB-dependent apps will fail"
  fi

  # Available memory (at least 256 MB)
  SERVER_MEM_FREE=$(ssh -o ConnectTimeout=5 "${DEPLOY_SERVER}" "free -m 2>/dev/null | awk '/Mem:/ {print \$7}'" 2>/dev/null || echo "0")
  if [[ "$SERVER_MEM_FREE" -lt 256 ]]; then
    echo "  [WARN] Server memory: ${SERVER_MEM_FREE} MB free (low — builds may OOM)"
  else
    echo "  [OK] Server memory: ${SERVER_MEM_FREE} MB free"
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

# ============================================================
# Self-healing retry loop — DEPLOY + VERIFY with diagnosis
# ============================================================
MAX_HEAL_ATTEMPTS=2
HEAL_ATTEMPT=0
DEPLOY_SUCCESS=false

while [[ "$HEAL_ATTEMPT" -lt "$MAX_HEAL_ATTEMPTS" ]]; do
  HEAL_ATTEMPT=$((HEAL_ATTEMPT + 1))

  # --- Collect failure context from previous attempt ---
  FAILURE_CONTEXT=""
  if [[ "$HEAL_ATTEMPT" -gt 1 ]]; then
    # Read previous failure for diagnosis
    for prev_phase in deploy verify; do
      PREV_STATE="${STATE_DIR}/${prev_phase}.json"
      if [[ -f "$PREV_STATE" ]]; then
        PREV_STATUS=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('status','unknown'))" "$PREV_STATE" 2>/dev/null || echo "unknown")
        if [[ "$PREV_STATUS" == "failed" ]]; then
          PREV_ERROR=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('error','unknown'))" "$PREV_STATE" 2>/dev/null || echo "unknown")
          FAILURE_CONTEXT="PREVIOUS ATTEMPT FAILED at ${prev_phase}: ${PREV_ERROR}. This is retry ${HEAL_ATTEMPT}/${MAX_HEAL_ATTEMPTS}. Read the failure pattern registry in CLAUDE.md and learned-patterns.md. Diagnose the root cause BEFORE retrying. If you applied a fix, describe it in the fixes[] array."
          # Read last 30 lines of phase log for more context
          PREV_LOG="${REPO_ROOT}/devops/logs/phase-${APP_NAME}-${prev_phase}-${TIMESTAMP}.log"
          if [[ -f "$PREV_LOG" ]]; then
            LOG_TAIL=$(tail -30 "$PREV_LOG" 2>/dev/null | head -20)
            FAILURE_CONTEXT="${FAILURE_CONTEXT}\n\nLast 20 lines of ${prev_phase} log:\n${LOG_TAIL}"
          fi
          break
        fi
      fi
    done

    if [[ -n "$FAILURE_CONTEXT" ]]; then
      echo ""
      echo "=== TRIGGER: Self-healing attempt ${HEAL_ATTEMPT}/${MAX_HEAL_ATTEMPTS} ==="
      echo "  Previous failure context provided to agent for diagnosis"
    fi
  fi

  # --- Phase 3: DEPLOY ---
  DEPLOY_PROMPT="Read ${STATE_DIR}/prepare.json for context. Build the Docker image with buildx, transfer to server, update compose, and start the container. Write results to ${STATE_DIR}/deploy.json."
  if [[ -n "$FAILURE_CONTEXT" ]]; then
    DEPLOY_PROMPT="${DEPLOY_PROMPT}\n\n${FAILURE_CONTEXT}"
  fi

  run_phase "deploy" "$DEPLOY_PROMPT" 3

  if ! "${AGENT_DIR}/validate-state.sh" "${STATE_DIR}/deploy.json" "deploy" --require-success; then
    DEPLOY_ERROR=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('error','unknown'))" "${STATE_DIR}/deploy.json" 2>/dev/null || echo "unknown")
    echo "=== TRIGGER: DEPLOY phase failed (attempt ${HEAL_ATTEMPT}): ${DEPLOY_ERROR} ==="

    if [[ "$HEAL_ATTEMPT" -lt "$MAX_HEAL_ATTEMPTS" ]]; then
      echo "=== TRIGGER: Will retry with failure diagnosis ==="
      continue
    else
      # Final attempt failed — rollback and escalate
      echo "=== TRIGGER: All ${MAX_HEAL_ATTEMPTS} attempts exhausted. Rolling back. ==="
      if [[ "$DRY_RUN" != "true" ]]; then
        "${SCRIPT_DIR}/rollback.sh" "$APP_NAME" 2>&1 || true
      fi
      send_telegram "Deployment of ${APP_NAME} failed after ${MAX_HEAL_ATTEMPTS} attempts and was rolled back. Last error: ${DEPLOY_ERROR}"
      exit 1
    fi
  fi

  # --- Phase 4: VERIFY ---
  VERIFY_PROMPT="Read ${STATE_DIR}/deploy.json for context. Verify the deployment works: health check, frontend loads, API endpoints respond. Take screenshots if Playwright is available (PLAYWRIGHT_AVAILABLE=${PLAYWRIGHT_AVAILABLE}). Send Telegram notification with results. Write results to ${STATE_DIR}/verify.json."
  if [[ -n "$FAILURE_CONTEXT" ]]; then
    VERIFY_PROMPT="${VERIFY_PROMPT}\n\nPrevious attempt context: ${FAILURE_CONTEXT}"
  fi

  run_phase "verify" "$VERIFY_PROMPT" 4

  if ! "${AGENT_DIR}/validate-state.sh" "${STATE_DIR}/verify.json" "verify" --require-success; then
    VERIFY_ERROR=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('error','unknown'))" "${STATE_DIR}/verify.json" 2>/dev/null || echo "unknown")
    echo "=== TRIGGER: VERIFY phase failed (attempt ${HEAL_ATTEMPT}): ${VERIFY_ERROR} ==="

    if [[ "$HEAL_ATTEMPT" -lt "$MAX_HEAL_ATTEMPTS" ]]; then
      echo "=== TRIGGER: Will retry DEPLOY+VERIFY with failure diagnosis ==="
      continue
    else
      # Final attempt — app is deployed but broken
      echo "=== TRIGGER: Verification failed after ${MAX_HEAL_ATTEMPTS} attempts. Rolling back. ==="
      if [[ "$DRY_RUN" != "true" ]]; then
        "${SCRIPT_DIR}/rollback.sh" "$APP_NAME" 2>&1 || true
      fi
      send_telegram "Deployment of ${APP_NAME} failed verification after ${MAX_HEAL_ATTEMPTS} attempts and was rolled back. Last error: ${VERIFY_ERROR}"
      exit 1
    fi
  fi

  # Both DEPLOY and VERIFY passed
  DEPLOY_SUCCESS=true
  if [[ "$HEAL_ATTEMPT" -gt 1 ]]; then
    echo "=== TRIGGER: Self-healed on attempt ${HEAL_ATTEMPT} ==="
    send_telegram "Deployment of ${APP_NAME} self-healed after ${HEAL_ATTEMPT} attempts. The first attempt failed but the agent diagnosed and fixed the issue."
  fi
  break
done

if [[ "$DEPLOY_SUCCESS" != "true" ]]; then
  echo "=== TRIGGER: Deployment loop exited without success — this should not happen ==="
  exit 1
fi

# ============================================================
# Post-VERIFY: Performance baseline and regression detection
# ============================================================
PERF_AVG_MS=""

if [[ "$DRY_RUN" != "true" ]]; then
  echo ""
  echo "--- Performance check (30s warm-up) ---"
  sleep 30

  if [[ -x "${SCRIPT_DIR}/perf-check.sh" ]]; then
    # Run perf-check and capture output
    PERF_OUTPUT=$("${SCRIPT_DIR}/perf-check.sh" 2>&1 || true)
    echo "$PERF_OUTPUT" | tail -5

    # Extract average response time for this app from the TSV output
    PERF_TSV="${REPO_ROOT}/devops/logs/performance.tsv"
    if [[ -f "$PERF_TSV" ]]; then
      PERF_AVG_MS=$(python3 -c "
import sys, csv
total, count = 0, 0
with open(sys.argv[1]) as f:
    reader = csv.reader(f, delimiter='\t')
    next(reader, None)  # skip header
    for row in reader:
        if len(row) >= 5 and row[1] == sys.argv[2]:
            try:
                total += float(row[4])
                count += 1
            except ValueError:
                pass
# Only use the last run's entries (tail of file)
if count > 0:
    print(int(total / count))
else:
    print('')
" "$PERF_TSV" "$APP_NAME" 2>/dev/null || echo "")
    fi

    if [[ -n "$PERF_AVG_MS" && "$PERF_AVG_MS" != "0" ]]; then
      echo "  Average response time: ${PERF_AVG_MS}ms"

      # Compare with previous deploy baseline
      DEPLOYMENTS_JSONL="${REPO_ROOT}/devops/logs/deployments.jsonl"
      if [[ -f "$DEPLOYMENTS_JSONL" ]]; then
        PREV_PERF=$(python3 -c "
import json, sys
# Read all lines, find last entry for this app with perf data
prev = None
with open(sys.argv[1]) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
            if entry.get('app') == sys.argv[2] and entry.get('perf_avg_ms'):
                prev = entry['perf_avg_ms']
        except (json.JSONDecodeError, KeyError):
            pass
if prev is not None:
    print(prev)
else:
    print('')
" "$DEPLOYMENTS_JSONL" "$APP_NAME" 2>/dev/null || echo "")

        if [[ -n "$PREV_PERF" && "$PREV_PERF" != "0" ]]; then
          # Check for >50% regression
          REGRESSION=$(python3 -c "
import sys
current = int(sys.argv[1])
previous = int(sys.argv[2])
if current > previous * 1.5:
    print(f'REGRESSION: {previous}ms -> {current}ms ({int((current/previous - 1) * 100)}% slower)')
else:
    print('')
" "$PERF_AVG_MS" "$PREV_PERF" 2>/dev/null || echo "")

          if [[ -n "$REGRESSION" ]]; then
            echo "  WARNING: ${REGRESSION}"
            send_telegram "Performance regression detected for ${APP_NAME}: ${REGRESSION}. Previous baseline: ${PREV_PERF}ms, current: ${PERF_AVG_MS}ms."
          else
            echo "  No regression (previous: ${PREV_PERF}ms)"
          fi
        else
          echo "  First deploy with perf data — recording baseline (no comparison)"
        fi
      fi
    else
      echo "  Could not extract perf data — skipping regression check"
    fi
  else
    echo "  perf-check.sh not found — skipping"
  fi
else
  echo ""
  echo "--- Performance check skipped (dry-run) ---"
fi

# ============================================================
# Post-VERIFY: Pattern learning (auto-append novel fixes)
# ============================================================
LEARNED_PATTERNS_FILE="${AGENT_DIR}/learned-patterns.md"
MAX_LEARNED_PATTERNS=50

_learn_patterns_from_phase() {
  local phase_file="$1"
  local phase_name="$2"

  [[ ! -f "$phase_file" ]] && return 0

  # Extract fixes where pattern_known=false
  python3 -c "
import json, sys

phase_file = sys.argv[1]
patterns_file = sys.argv[2]
max_patterns = int(sys.argv[3])
phase_name = sys.argv[4]

try:
    with open(phase_file) as f:
        state = json.load(f)
except (json.JSONDecodeError, FileNotFoundError):
    sys.exit(0)

fixes = state.get('fixes', [])
if not fixes:
    sys.exit(0)

novel_fixes = [f for f in fixes if isinstance(f, dict) and not f.get('pattern_known', True)]
if not novel_fixes:
    sys.exit(0)

# Read existing patterns to check for duplicates
existing_types = set()
existing_lines = []
try:
    with open(patterns_file) as f:
        existing_lines = f.readlines()
        for line in existing_lines:
            if line.startswith('### '):
                existing_types.add(line.strip().lstrip('#').strip().lower())
except FileNotFoundError:
    pass

# Count existing pattern entries (lines starting with ###)
pattern_count = sum(1 for l in existing_lines if l.startswith('### '))

added = 0
for fix in novel_fixes:
    fix_type = fix.get('type', 'unknown')
    fix_desc = fix.get('description', 'No description')

    # Skip duplicates
    if fix_type.lower() in existing_types:
        continue

    # If at cap, remove oldest pattern (first ### block)
    if pattern_count >= max_patterns:
        # Find and remove first pattern block
        new_lines = []
        removed_first = False
        skip_block = False
        for line in existing_lines:
            if line.startswith('### ') and not removed_first:
                skip_block = True
                removed_first = True
                pattern_count -= 1
                continue
            if skip_block and line.startswith('### '):
                skip_block = False
            if skip_block:
                continue
            new_lines.append(line)
        existing_lines = new_lines

    # Append new pattern
    from datetime import datetime, timezone
    ts = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    entry = f'''
### {fix_type}
**Discovered:** {ts} during {phase_name} phase
**Description:** {fix_desc}

'''
    existing_lines.append(entry)
    pattern_count += 1
    existing_types.add(fix_type.lower())
    added += 1

if added > 0:
    # Write header if file was empty
    if not any(l.startswith('# ') for l in existing_lines):
        existing_lines.insert(0, f'# Learned Failure Patterns\n\nAuto-discovered patterns from deployment fixes. Max {max_patterns} entries (FIFO).\n\n')

    with open(patterns_file, 'w') as f:
        f.writelines(existing_lines)
    print(f'Learned {added} new pattern(s) from {phase_name}')
else:
    print(f'No new patterns from {phase_name}')
" "$phase_file" "$LEARNED_PATTERNS_FILE" "$MAX_LEARNED_PATTERNS" "$phase_name" 2>/dev/null || true
}

echo ""
echo "--- Pattern learning ---"
_learn_patterns_from_phase "${STATE_DIR}/understand.json" "UNDERSTAND"
_learn_patterns_from_phase "${STATE_DIR}/prepare.json" "PREPARE"
_learn_patterns_from_phase "${STATE_DIR}/deploy.json" "DEPLOY"
_learn_patterns_from_phase "${STATE_DIR}/verify.json" "VERIFY"

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

# Append to deployment log (includes perf_avg_ms for regression tracking)
python3 -c "
import json, sys
from datetime import datetime, timezone
record = {
    'ts': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'app': sys.argv[1],
    'status': 'success',
    'duration_seconds': int(sys.argv[2]),
    'dry_run': sys.argv[3] == 'true',
    'log_file': sys.argv[4]
}
perf = sys.argv[6]
if perf:
    record['perf_avg_ms'] = int(perf)
with open(sys.argv[5], 'a') as f:
    f.write(json.dumps(record) + '\n')
" "$APP_NAME" "$DEPLOY_DURATION" "$DRY_RUN" "$LOG_FILE" "${REPO_ROOT}/devops/logs/deployments.jsonl" "${PERF_AVG_MS:-}"

echo "=== TRIGGER: Deployment record written to deployments.jsonl ==="
