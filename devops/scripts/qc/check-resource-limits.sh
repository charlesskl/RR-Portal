#!/usr/bin/env bash
# ============================================================
# QC-13: Container Resource Limits Check
# ============================================================
# Ensures docker-compose services have memory limits set.
# Without limits, a single misbehaving container can OOM the
# entire server (only 4GB RAM on the cloud server).
#
# Usage: check-resource-limits.sh <app-directory>
# Exit 0: Limits already set or no compose file
# Exit 1: Issues found and fixed
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-resource-limits.sh <app-directory>}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[QC-13] ERROR: Directory not found: $APP_DIR"
  exit 1
fi

APP_NAME="$(basename "$APP_DIR")"
FIXES_MADE=0

# Find docker-compose file
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(cd "$APP_DIR/../.." && pwd)")"
COMPOSE_FILE=""

for candidate in docker-compose.yml docker-compose.yaml docker-compose.cloud.yml; do
  if [[ -f "$REPO_ROOT/$candidate" ]]; then
    COMPOSE_FILE="$REPO_ROOT/$candidate"
    break
  fi
done

if [[ -z "$COMPOSE_FILE" ]]; then
  echo "[QC-13] SKIP: No docker-compose file found"
  exit 0
fi

echo "[QC-13] Checking resource limits for: $APP_NAME"

# Check if the service has deploy.resources.limits
HAS_LIMITS=$(python3 -c "
with open('${COMPOSE_FILE}') as f:
    content = f.read()

lines = content.split('\n')
in_service = False
has_mem_limit = False
has_deploy = False

for line in lines:
    stripped = line.strip()
    if stripped == '${APP_NAME}:' and line.startswith('  '):
        in_service = True
        continue
    if in_service:
        if stripped and not line.startswith('    ') and not line.startswith('  '):
            break
        if line.startswith('  ') and not line.startswith('    ') and stripped and stripped != '${APP_NAME}:':
            if not stripped.startswith('#'):
                break
        if 'mem_limit' in stripped or 'memory' in stripped:
            has_mem_limit = True
        if 'deploy:' in stripped:
            has_deploy = True

if has_mem_limit:
    print('has-limits')
elif has_deploy:
    print('has-deploy-no-limits')
else:
    print('no-limits')
" 2>/dev/null || echo "error")

case "$HAS_LIMITS" in
  has-limits)
    echo "[QC-13] PASS: ${APP_NAME} has memory limits configured"
    ;;
  no-limits|has-deploy-no-limits)
    echo "[QC-13] FOUND: ${APP_NAME} missing memory limits"

    # Add mem_limit to the service (simpler than deploy.resources)
    python3 -c "
with open('${COMPOSE_FILE}') as f:
    content = f.read()

lines = content.split('\n')
in_service = False
insert_idx = -1

for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped == '${APP_NAME}:' and line.startswith('  '):
        in_service = True
        continue
    if in_service:
        if stripped and not line.startswith('    ') and not line.startswith('  '):
            insert_idx = i
            break
        if line.startswith('  ') and not line.startswith('    ') and stripped and stripped != '${APP_NAME}:':
            if not stripped.startswith('#'):
                insert_idx = i
                break
        insert_idx = i + 1

if insert_idx > 0:
    lines.insert(insert_idx, '    mem_limit: 512m')
    lines.insert(insert_idx + 1, '    memswap_limit: 512m')

with open('${COMPOSE_FILE}', 'w') as f:
    f.write('\n'.join(lines))
print('done')
" 2>/dev/null || echo "error"

    echo "[QC-13] FIXED: added mem_limit: 512m to ${APP_NAME}"
    FIXES_MADE=$((FIXES_MADE + 1))
    ;;
  *)
    echo "[QC-13] WARN: could not parse compose file"
    ;;
esac

if [[ "$FIXES_MADE" -gt 0 ]]; then
  echo "[QC-13] RESULT: Fixed ${FIXES_MADE} resource limit issue(s)"
  exit 1
else
  echo "[QC-13] PASS: resource limits configured"
  exit 0
fi
