#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Environment Profile — Switch between dev/staging/production
# ============================================================
# Manages environment-specific configurations.
# Each profile has its own compose file and env overrides.
#
# Usage: env-profile.sh <profile> [command]
#
#   env-profile.sh production status   — show production status
#   env-profile.sh staging deploy app  — deploy to staging
#   env-profile.sh list                — show available profiles
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

PROFILE="${1:?Usage: env-profile.sh <profile|list> [command...]}"
shift || true

PROFILES_DIR="${REPO_ROOT}/devops/config/profiles"

# --- List profiles ---
if [[ "$PROFILE" == "list" ]]; then
  echo "=== Available Profiles ==="
  echo ""
  if [[ -d "$PROFILES_DIR" ]]; then
    for profile_file in "$PROFILES_DIR"/*.env; do
      [[ -f "$profile_file" ]] || continue
      profile_name="$(basename "$profile_file" .env)"
      echo "  ${profile_name}"
      grep -E '^(DEPLOY_SERVER|DEPLOY_COMPOSE_PATH)=' "$profile_file" 2>/dev/null | sed 's/^/    /'
      echo ""
    done
  else
    echo "  No profiles configured."
    echo ""
    echo "  Create profiles at: ${PROFILES_DIR}/<name>.env"
    echo "  Required vars: DEPLOY_SERVER, DEPLOY_COMPOSE_PATH"
  fi
  exit 0
fi

# --- Load profile ---
PROFILE_FILE="${PROFILES_DIR}/${PROFILE}.env"

if [[ ! -f "$PROFILE_FILE" ]]; then
  echo "ERROR: Profile '${PROFILE}' not found at ${PROFILE_FILE}"
  echo ""
  echo "Available profiles:"
  ls "${PROFILES_DIR}"/*.env 2>/dev/null | xargs -I{} basename {} .env | sed 's/^/  /' || echo "  (none)"
  echo ""
  echo "Create one with:"
  echo "  mkdir -p ${PROFILES_DIR}"
  echo "  echo 'DEPLOY_SERVER=root@your-server' > ${PROFILE_FILE}"
  echo "  echo 'DEPLOY_COMPOSE_PATH=/opt/rr-portal/docker-compose.yml' >> ${PROFILE_FILE}"
  exit 1
fi

# Source the profile to set env vars
set -a
source "$PROFILE_FILE"
set +a

echo "=== Profile: ${PROFILE} ==="
echo "  Server: ${DEPLOY_SERVER:-not set}"
echo "  Compose: ${DEPLOY_COMPOSE_PATH:-not set}"
echo ""

# --- Run command with profile ---
COMMAND="${1:-status}"
shift || true

case "$COMMAND" in
  status)   exec "${SCRIPT_DIR}/status.sh" ;;
  deploy)   exec "${SCRIPT_DIR}/deploy.sh" "$@" ;;
  rollback) exec "${SCRIPT_DIR}/rollback.sh" "$@" ;;
  restart)  exec "${SCRIPT_DIR}/restart.sh" "$@" ;;
  logs)     exec "${SCRIPT_DIR}/logs.sh" "$@" ;;
  health)   exec "${SCRIPT_DIR}/health-check.sh" ;;
  backup)   exec "${SCRIPT_DIR}/backup-db.sh" ;;
  cleanup)  exec "${SCRIPT_DIR}/cleanup.sh" ;;
  incident) exec "${SCRIPT_DIR}/incident.sh" "$@" ;;
  *)
    echo "Unknown command: ${COMMAND}"
    echo "Available: status, deploy, rollback, restart, logs, health, backup, cleanup, incident"
    exit 1
    ;;
esac
