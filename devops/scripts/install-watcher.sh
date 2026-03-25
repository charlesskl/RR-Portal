#!/usr/bin/env bash
# ============================================================
# Install RR-Portal Daemons — One-command launchd setup
# ============================================================
# Sets up both RR-Portal daemons as macOS launchd agents:
#   1. PR watcher  — long-running daemon that polls for PRs (every 60s)
#   2. Health monitor — periodic task that checks app health (every 5min)
#
# Usage: ./devops/scripts/install-watcher.sh
# ============================================================

set -euo pipefail

# --- Resolve paths ---
REPO_ROOT="$(git rev-parse --show-toplevel)"
PLIST_SOURCE="${REPO_ROOT}/devops/launchd/com.rr-portal.pr-watcher.plist"
PLIST_DEST="${HOME}/Library/LaunchAgents/com.rr-portal.pr-watcher.plist"
LOG_DIR="${REPO_ROOT}/devops/logs"

echo "=== PR-WATCHER INSTALLER ==="
echo "Repo root: ${REPO_ROOT}"

# --- Validate prerequisites ---
echo ""
echo "Checking prerequisites..."

if ! command -v gh >/dev/null; then
  echo "ERROR: GitHub CLI (gh) not installed. Install: brew install gh"
  exit 1
fi
echo "  [OK] gh CLI found"

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh not authenticated. Run: gh auth login"
  exit 1
fi
echo "  [OK] gh authenticated"

if ! command -v docker >/dev/null; then
  echo "ERROR: Docker not installed. Install Docker Desktop or: brew install --cask docker"
  exit 1
fi
echo "  [OK] Docker found"

if [ ! -x "${REPO_ROOT}/devops/scripts/pr-watcher.sh" ]; then
  echo "ERROR: pr-watcher.sh not found or not executable at ${REPO_ROOT}/devops/scripts/pr-watcher.sh"
  exit 1
fi
echo "  [OK] pr-watcher.sh found and executable"

if [ ! -x "${REPO_ROOT}/devops/scripts/health-check.sh" ]; then
  echo "ERROR: health-check.sh not found or not executable at ${REPO_ROOT}/devops/scripts/health-check.sh"
  exit 1
fi
echo "  [OK] health-check.sh found and executable"

# --- Create log directory ---
mkdir -p "$LOG_DIR"
echo ""
echo "Log directory: ${LOG_DIR}"

# --- Validate DEPLOY_SERVER (required for health monitoring) ---
echo ""
if [ -z "${DEPLOY_SERVER:-}" ]; then
  echo "DEPLOY_SERVER not set."
  echo "Enter deploy target (e.g., charles@192.168.1.50):"
  read -r DEPLOY_SERVER
  if [ -z "${DEPLOY_SERVER}" ]; then
    echo "ERROR: DEPLOY_SERVER is required for health monitoring"
    exit 1
  fi
fi
echo "Deploy server: ${DEPLOY_SERVER}"

# --- Validate Telegram credentials ---
echo ""
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "TELEGRAM_BOT_TOKEN not set."
  echo "Enter Telegram Bot Token (from @BotFather):"
  read -r TELEGRAM_BOT_TOKEN
  if [ -z "${TELEGRAM_BOT_TOKEN}" ]; then
    echo "WARNING: TELEGRAM_BOT_TOKEN not set. Telegram notifications will be disabled."
  fi
fi

if [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  echo "TELEGRAM_CHAT_ID not set."
  echo "Enter Telegram Chat ID:"
  read -r TELEGRAM_CHAT_ID
  if [ -z "${TELEGRAM_CHAT_ID}" ]; then
    echo "WARNING: TELEGRAM_CHAT_ID not set. Telegram notifications will be disabled."
  fi
fi

# --- Validate DEPLOY_COMPOSE_PATH ---
if [ -z "${DEPLOY_COMPOSE_PATH:-}" ]; then
  echo "DEPLOY_COMPOSE_PATH not set."
  echo "Enter path to docker-compose.yml on deploy server (default: /opt/rr-portal/docker-compose.yml):"
  read -r DEPLOY_COMPOSE_PATH
  DEPLOY_COMPOSE_PATH="${DEPLOY_COMPOSE_PATH:-/opt/rr-portal/docker-compose.yml}"
fi
echo "Compose path: ${DEPLOY_COMPOSE_PATH}"

# --- Ensure LaunchAgents directory exists ---
mkdir -p "${HOME}/Library/LaunchAgents"

# --- Generate plist with real paths ---
echo ""
echo "Generating plist with real paths..."
sed -e "s|__REPO_ROOT__|${REPO_ROOT}|g" \
    -e "s|__DEPLOY_SERVER__|${DEPLOY_SERVER}|g" \
    -e "s|__DEPLOY_COMPOSE_PATH__|${DEPLOY_COMPOSE_PATH}|g" \
    -e "s|__TELEGRAM_BOT_TOKEN__|${TELEGRAM_BOT_TOKEN:-}|g" \
    -e "s|__TELEGRAM_CHAT_ID__|${TELEGRAM_CHAT_ID:-}|g" \
    "$PLIST_SOURCE" > "$PLIST_DEST"
echo "  Installed to: ${PLIST_DEST}"

# --- Unload existing (if any) and load new ---
echo ""
echo "Loading launchd agent..."
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

# --- Verify PR watcher running ---
echo ""
echo "Verifying PR watcher..."
if launchctl list | grep -q "com.rr-portal.pr-watcher"; then
  echo "  [OK] PR watcher is running!"
else
  echo "  [WARN] PR watcher may not have started. Check logs:"
  echo "    tail -f ${LOG_DIR}/pr-watcher-stdout.log"
  echo "    tail -f ${LOG_DIR}/pr-watcher-stderr.log"
fi

# --- Install health-check monitor ---
echo ""
echo "Installing health-check monitor..."
HEALTH_PLIST_SRC="${REPO_ROOT}/devops/launchd/com.rr-portal.health-check.plist"
HEALTH_PLIST_DST="${HOME}/Library/LaunchAgents/com.rr-portal.health-check.plist"

# Unload existing if present
launchctl unload "${HEALTH_PLIST_DST}" 2>/dev/null || true

# Copy and replace placeholders
sed -e "s|__REPO_ROOT__|${REPO_ROOT}|g" \
    -e "s|__DEPLOY_SERVER__|${DEPLOY_SERVER}|g" \
    -e "s|__DEPLOY_COMPOSE_PATH__|${DEPLOY_COMPOSE_PATH}|g" \
    -e "s|__TELEGRAM_BOT_TOKEN__|${TELEGRAM_BOT_TOKEN:-}|g" \
    -e "s|__TELEGRAM_CHAT_ID__|${TELEGRAM_CHAT_ID:-}|g" \
    "${HEALTH_PLIST_SRC}" > "${HEALTH_PLIST_DST}"

launchctl load "${HEALTH_PLIST_DST}"
echo "  Installed to: ${HEALTH_PLIST_DST}"
echo "  Health-check monitor installed: runs every 5 minutes"

# --- Verify health-check running ---
echo ""
echo "Verifying health-check monitor..."
if launchctl list | grep -q "com.rr-portal.health-check"; then
  echo "  [OK] Health-check monitor is running!"
else
  echo "  [WARN] Health-check monitor may not have started. Check logs:"
  echo "    tail -f ${LOG_DIR}/health-check-stdout.log"
  echo "    tail -f ${LOG_DIR}/health-check-stderr.log"
fi

# --- Install cleanup daemon ---
echo ""
echo "Installing cleanup daemon..."
CLEANUP_PLIST_SRC="${REPO_ROOT}/devops/launchd/com.rr-portal.cleanup.plist"
CLEANUP_PLIST_DST="${HOME}/Library/LaunchAgents/com.rr-portal.cleanup.plist"

launchctl unload "${CLEANUP_PLIST_DST}" 2>/dev/null || true

sed -e "s|__REPO_ROOT__|${REPO_ROOT}|g" \
    -e "s|__DEPLOY_SERVER__|${DEPLOY_SERVER}|g" \
    -e "s|__TELEGRAM_BOT_TOKEN__|${TELEGRAM_BOT_TOKEN:-}|g" \
    -e "s|__TELEGRAM_CHAT_ID__|${TELEGRAM_CHAT_ID:-}|g" \
    "${CLEANUP_PLIST_SRC}" > "${CLEANUP_PLIST_DST}"

launchctl load "${CLEANUP_PLIST_DST}"
echo "  Installed to: ${CLEANUP_PLIST_DST}"
echo "  Cleanup daemon installed: runs daily at 3:00 AM"

# --- Install backup daemon ---
echo ""
echo "Installing database backup daemon..."
BACKUP_PLIST_SRC="${REPO_ROOT}/devops/launchd/com.rr-portal.backup-db.plist"
BACKUP_PLIST_DST="${HOME}/Library/LaunchAgents/com.rr-portal.backup-db.plist"

launchctl unload "${BACKUP_PLIST_DST}" 2>/dev/null || true

sed -e "s|__REPO_ROOT__|${REPO_ROOT}|g" \
    -e "s|__DEPLOY_SERVER__|${DEPLOY_SERVER}|g" \
    -e "s|__TELEGRAM_BOT_TOKEN__|${TELEGRAM_BOT_TOKEN:-}|g" \
    -e "s|__TELEGRAM_CHAT_ID__|${TELEGRAM_CHAT_ID:-}|g" \
    "${BACKUP_PLIST_SRC}" > "${BACKUP_PLIST_DST}"

launchctl load "${BACKUP_PLIST_DST}"
echo "  Installed to: ${BACKUP_PLIST_DST}"
echo "  Backup daemon installed: runs daily at 2:00 AM"

# --- Print status ---
echo ""
echo "=== Installation complete ==="
echo "  PR watcher:      running (polls every 60s)"
echo "  Health monitor:   running (checks every 5min)"
echo "  Cleanup:          scheduled (daily at 3:00 AM)"
echo "  DB backup:        scheduled (daily at 2:00 AM)"
echo ""
echo "Logs: ${LOG_DIR}/"
echo ""
echo "Commands:"
echo "  Check status:  launchctl list | grep rr-portal"
echo "  View logs:     tail -f ${LOG_DIR}/pr-watcher-stdout.log"
echo "  To stop all:"
echo "    launchctl unload ~/Library/LaunchAgents/com.rr-portal.pr-watcher.plist"
echo "    launchctl unload ~/Library/LaunchAgents/com.rr-portal.health-check.plist"
echo "    launchctl unload ~/Library/LaunchAgents/com.rr-portal.cleanup.plist"
echo "    launchctl unload ~/Library/LaunchAgents/com.rr-portal.backup-db.plist"
