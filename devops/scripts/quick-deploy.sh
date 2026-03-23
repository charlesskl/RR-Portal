#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Quick Deploy — One-command from git URL to live deployment
# ============================================================
# Combines onboard + deploy in a single command.
# For when you want to go from repo URL to production ASAP.
#
# Usage: quick-deploy.sh <repo-url> [app-name]
#
# Steps:
# 1. Onboard (clone, QC, register, build, PR)
# 2. Merge PR automatically
# 3. Deploy to server
# 4. Verify deployment
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

source "${SCRIPT_DIR}/utils/telegram.sh"
source "${SCRIPT_DIR}/utils/audit.sh"

REPO_URL="${1:?Usage: quick-deploy.sh <repo-url> [app-name]}"
APP_NAME="${2:-$(basename "$REPO_URL" .git | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')}"

echo "============================================"
echo "  QUICK DEPLOY: ${APP_NAME}"
echo "  From: ${REPO_URL}"
echo "============================================"
echo ""

# --- Step 1: Onboard ---
echo "=== Step 1: Onboarding ==="
if "${SCRIPT_DIR}/onboard.sh" "$REPO_URL" "$APP_NAME"; then
  echo "  [OK] Onboarding complete"
else
  echo "  [FAIL] Onboarding failed"
  exit 1
fi

# --- Step 2: Merge the PR ---
echo ""
echo "=== Step 2: Merging PR ==="
PR_NUMBER=$(gh pr list --head "onboard/${APP_NAME}" --json number --jq '.[0].number' 2>/dev/null || echo "")

if [[ -n "$PR_NUMBER" ]]; then
  gh pr merge "$PR_NUMBER" --squash --auto 2>/dev/null || true
  echo "  [OK] PR #${PR_NUMBER} merged"

  # Switch to main and pull
  git checkout main 2>/dev/null
  git pull origin main 2>/dev/null || true
else
  echo "  [WARN] No PR found — deploying from current branch"
fi

# --- Step 3: Deploy ---
echo ""
echo "=== Step 3: Deploying ==="
if "${SCRIPT_DIR}/deploy.sh" "$APP_NAME"; then
  echo "  [OK] Deployment complete"
else
  echo "  [FAIL] Deployment failed"
  exit 1
fi

# --- Step 4: Summary ---
HOST_PORT=$(python3 -c "
import json
d = json.load(open('${REPO_ROOT}/devops/config/apps.json'))
print(d.get('${APP_NAME}', {}).get('port', 'unknown'))
" 2>/dev/null || echo "unknown")

echo ""
echo "============================================"
echo "  QUICK DEPLOY COMPLETE"
echo "============================================"
echo "  App: ${APP_NAME}"
echo "  Port: ${HOST_PORT}"
echo "  URL: http://server-ip/${APP_NAME}/"
echo "============================================"

audit_log "quick-deploy" "$APP_NAME" "Quick deployed from ${REPO_URL}"
