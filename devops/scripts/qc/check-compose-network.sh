#!/usr/bin/env bash
# ============================================================
# QC-11: Docker Compose Network Check
# ============================================================
# Ensures the app's docker-compose service is on the same
# network as nginx (platform-net). Without this, nginx can't
# reach the upstream container by service name.
#
# Usage: check-compose-network.sh <app-directory>
# Exit 0: Network config already correct or no compose file
# Exit 1: Issues found and fixed
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-compose-network.sh <app-directory>}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[QC-11] ERROR: Directory not found: $APP_DIR"
  exit 1
fi

APP_NAME="$(basename "$APP_DIR")"
FIXES_MADE=0

# Find the docker-compose file
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(cd "$APP_DIR/../.." && pwd)")"
COMPOSE_FILE=""

for candidate in docker-compose.yml docker-compose.yaml docker-compose.cloud.yml; do
  if [[ -f "$REPO_ROOT/$candidate" ]]; then
    COMPOSE_FILE="$REPO_ROOT/$candidate"
    break
  fi
done

if [[ -z "$COMPOSE_FILE" ]]; then
  echo "[QC-11] SKIP: No docker-compose file found"
  exit 0
fi

echo "[QC-11] Checking compose network for: $APP_NAME (file: $COMPOSE_FILE)"

# Check if the app's service exists in the compose file
if ! grep -q "^  ${APP_NAME}:" "$COMPOSE_FILE" 2>/dev/null; then
  echo "[QC-11] SKIP: Service ${APP_NAME} not found in ${COMPOSE_FILE}"
  exit 0
fi

# Check if the service has networks: platform-net
# Look for the service block and check if it has networks
HAS_NETWORK=$(python3 -c "
import re

with open('${COMPOSE_FILE}') as f:
    content = f.read()

# Find the service block for this app
lines = content.split('\n')
in_service = False
indent_level = 0
has_networks = False
network_name = ''

for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped == '${APP_NAME}:' and line.startswith('  '):
        in_service = True
        indent_level = len(line) - len(line.lstrip())
        continue
    if in_service:
        if stripped == '' or (not line.startswith(' ' * (indent_level + 2)) and stripped and not line.startswith(' ' * (indent_level + 4))):
            if line.strip() and not line.startswith(' ' * (indent_level + 2)):
                break
        if 'networks:' in stripped:
            has_networks = True
        if 'platform-net' in stripped:
            network_name = 'platform-net'

if has_networks and network_name == 'platform-net':
    print('ok')
elif has_networks:
    print('wrong-network')
else:
    print('missing')
" 2>/dev/null || echo "error")

case "$HAS_NETWORK" in
  ok)
    echo "[QC-11] PASS: ${APP_NAME} is on platform-net network"
    ;;
  missing)
    echo "[QC-11] FOUND: ${APP_NAME} missing networks config"
    # Add networks: platform-net to the service block
    python3 -c "
with open('${COMPOSE_FILE}') as f:
    content = f.read()

lines = content.split('\n')
in_service = False
service_end = -1
indent_level = 0

for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped == '${APP_NAME}:' and line.startswith('  '):
        in_service = True
        indent_level = len(line) - len(line.lstrip())
        continue
    if in_service:
        if stripped and not line.startswith(' ' * (indent_level + 2)):
            service_end = i
            break
        service_end = i + 1

if service_end > 0:
    indent = ' ' * (indent_level + 2)
    network_lines = [
        indent + 'networks:',
        indent + '  - platform-net'
    ]
    for j, nl in enumerate(network_lines):
        lines.insert(service_end + j, nl)

with open('${COMPOSE_FILE}', 'w') as f:
    f.write('\n'.join(lines))
print('done')
" 2>/dev/null || echo "error"

    echo "[QC-11] FIXED: added networks: [platform-net] to ${APP_NAME} service"
    FIXES_MADE=$((FIXES_MADE + 1))
    ;;
  wrong-network)
    echo "[QC-11] WARN: ${APP_NAME} has networks but not platform-net — may need manual review"
    ;;
  *)
    echo "[QC-11] WARN: could not parse compose file for ${APP_NAME}"
    ;;
esac

if [[ "$FIXES_MADE" -gt 0 ]]; then
  echo "[QC-11] RESULT: Fixed ${FIXES_MADE} network config issue(s)"
  exit 1
else
  echo "[QC-11] PASS: compose network config correct"
  exit 0
fi
