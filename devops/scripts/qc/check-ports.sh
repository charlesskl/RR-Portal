#!/usr/bin/env bash
# ============================================================
# QC-07: Port Conflict Detection & Resolution
# ============================================================
# Verifies the app's port against ports.json registry and
# resolves conflicts by assigning a new port.
#
# Usage: check-ports.sh <app-directory>
# Exit 0: No port conflict (or no port assigned yet)
# Exit 1: Conflict found and resolved (re-run to verify)
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-ports.sh <app-directory>}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[QC-07] ERROR: Directory not found: $APP_DIR"
  exit 1
fi

APP_NAME="$(basename "$APP_DIR")"

# --- Locate ports.json (relative to repo root) ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PORTS_FILE="${REPO_ROOT}/devops/config/ports.json"

if [[ ! -f "$PORTS_FILE" ]]; then
  echo "[QC-07] ERROR: ports.json not found at $PORTS_FILE"
  exit 1
fi

# --- Read current port assignment ---
ASSIGNED_PORT=$(python3 -c "
import json
d = json.load(open('$PORTS_FILE'))
app = d.get('$APP_NAME', {})
if isinstance(app, dict):
    print(app.get('port', ''))
else:
    print('')
" 2>/dev/null || echo "")

if [[ -z "$ASSIGNED_PORT" ]]; then
  echo "[QC-07] SKIP: no port assigned yet for $APP_NAME"
  exit 0
fi

echo "[QC-07] Checking port $ASSIGNED_PORT for app $APP_NAME"

# --- Check for conflicts ---
# Get all assigned ports and count how many times our port appears
CONFLICT_COUNT=$(python3 -c "
import json
d = json.load(open('$PORTS_FILE'))
ports = []
for k, v in d.items():
    if k != '_nextPort' and isinstance(v, dict) and 'port' in v:
        ports.append(v['port'])
# Count occurrences of our port
count = ports.count($ASSIGNED_PORT)
print(count)
" 2>/dev/null || echo "0")

# Check if port is in valid range (3001+)
VALID_RANGE=true
if [[ "$ASSIGNED_PORT" -lt 3001 ]]; then
  VALID_RANGE=false
  echo "[QC-07] WARNING: port $ASSIGNED_PORT is below reserved range (3001+)"
fi

# --- Resolve conflict if needed ---
if [[ "$CONFLICT_COUNT" -gt 1 ]] || [[ "$VALID_RANGE" == "false" ]]; then
  if [[ "$CONFLICT_COUNT" -gt 1 ]]; then
    echo "[QC-07] CONFLICT: port $ASSIGNED_PORT is used by multiple apps"
  fi

  # Read _nextPort and assign new port
  NEW_PORT=$(python3 -c "
import json
d = json.load(open('$PORTS_FILE'))
print(d.get('_nextPort', 3001))
" 2>/dev/null)

  echo "[QC-07] Assigning new port: $NEW_PORT"

  # Update ports.json
  python3 -c "
import json
d = json.load(open('$PORTS_FILE'))
d['$APP_NAME']['port'] = $NEW_PORT
d['_nextPort'] = $NEW_PORT + 1
json.dump(d, open('$PORTS_FILE', 'w'), indent=2)
print('ports.json updated')
"

  # Update docker-compose.yml port mapping for this app
  COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"
  if [[ -f "$COMPOSE_FILE" ]]; then
    # Replace the host port in the ports mapping line for this app's service
    # Pattern: "OLD_PORT:CONTAINER_PORT" -> "NEW_PORT:CONTAINER_PORT"
    if grep -A 10 "^  ${APP_NAME}:" "$COMPOSE_FILE" | grep -qE "\"[0-9]+:[0-9]+\""; then
      # Find the internal port from the existing mapping
      INTERNAL_PORT=$(grep -A 10 "^  ${APP_NAME}:" "$COMPOSE_FILE" | grep -oE "\"[0-9]+:[0-9]+\"" | head -1 | cut -d: -f2 | tr -d '"')
      if [[ -n "$INTERNAL_PORT" ]]; then
        sed -i '' "s|\"${ASSIGNED_PORT}:${INTERNAL_PORT}\"|\"${NEW_PORT}:${INTERNAL_PORT}\"|" "$COMPOSE_FILE" 2>/dev/null || true
        echo "[QC-07] Updated docker-compose.yml port mapping to ${NEW_PORT}:${INTERNAL_PORT}"
      fi
    fi
  fi

  echo "[QC-07] FIXED: resolved port conflict, assigned port ${NEW_PORT}"
  exit 1
fi

echo "[QC-07] PASS: port ${ASSIGNED_PORT} has no conflicts"
exit 0
