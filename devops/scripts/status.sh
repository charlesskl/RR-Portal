#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Status — Complete server and app health overview
# ============================================================
# One-command dashboard for the RR-Portal deployment.
# Shows: container status, resource usage, recent deployments,
# disk usage, and last backup status.
#
# Usage: status.sh  (no arguments)
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

if [[ -z "${DEPLOY_SERVER:-}" ]]; then
  echo "ERROR: DEPLOY_SERVER not set"
  exit 1
fi

DEPLOY_SERVER_HOST="${DEPLOY_SERVER#*@}"

echo "========================================"
echo "  RR-Portal Status Dashboard"
echo "  Server: ${DEPLOY_SERVER_HOST}"
echo "  Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

# --- Containers ---
echo ""
echo "--- Containers ---"
ssh "${DEPLOY_SERVER}" "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'" 2>/dev/null || echo "  Could not connect to server"

# --- Resources ---
echo ""
echo "--- Server Resources ---"
ssh "${DEPLOY_SERVER}" "
  echo \"  CPU: \$(top -bn1 | grep 'Cpu(s)' | awk '{print \$2}')% used\"
  echo \"  Memory: \$(free -h | awk '/Mem:/ {printf \"%s / %s (%s available)\", \$3, \$2, \$7}')\"
  echo \"  Disk: \$(df -h / | awk 'NR==2 {printf \"%s / %s (%s used)\", \$3, \$2, \$5}')\"
" 2>/dev/null || true

# --- Docker images ---
echo ""
echo "--- Docker Images ---"
ssh "${DEPLOY_SERVER}" "docker images --format '  {{.Repository}}:{{.Tag}}\t{{.Size}}' | grep rr-portal" 2>/dev/null || true

# --- Health checks ---
echo ""
echo "--- Health Checks ---"
APPS_FILE="${REPO_ROOT}/devops/config/apps.json"
if [[ -f "$APPS_FILE" ]]; then
  APPS=$(python3 -c "
import json
d = json.load(open('${APPS_FILE}'))
for name, info in d.items():
    if info.get('status') == 'active':
        print(f'{name}:{info[\"port\"]}')
" 2>/dev/null || true)

  for entry in $APPS; do
    app="${entry%%:*}"
    port="${entry##*:}"
    if curl -sf --max-time 3 "http://${DEPLOY_SERVER_HOST}:${port}/health" > /dev/null 2>&1; then
      echo "  [OK] ${app} (port ${port})"
    else
      echo "  [FAIL] ${app} (port ${port})"
    fi
  done
fi

# --- Recent audit log ---
echo ""
echo "--- Recent Deployments ---"
AUDIT_FILE="${REPO_ROOT}/devops/logs/audit.tsv"
if [[ -f "$AUDIT_FILE" ]]; then
  tail -5 "$AUDIT_FILE" | column -t -s$'\t' | sed 's/^/  /'
else
  echo "  No deployment history"
fi

# --- Last backup ---
echo ""
echo "--- Last Backup ---"
LAST_BACKUP=$(ssh "${DEPLOY_SERVER}" "ls -lt /opt/rr-portal/backups/portal-db-*.sql.gz 2>/dev/null | head -1 | awk '{print \$6, \$7, \$8, \$9}'" 2>/dev/null || echo "")
if [[ -n "$LAST_BACKUP" ]]; then
  echo "  $LAST_BACKUP"
else
  echo "  No backups found"
fi

# --- Daemon status ---
echo ""
echo "--- Daemon Status ---"
for daemon in pr-watcher health-check cleanup backup-db; do
  if launchctl list 2>/dev/null | grep -q "com.rr-portal.${daemon}"; then
    echo "  [ON]  ${daemon}"
  else
    echo "  [OFF] ${daemon}"
  fi
done

echo ""
echo "========================================"
