#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Git Hooks Setup — Install pre-push QC validation
# ============================================================
# Installs a git pre-push hook that runs the QC pipeline
# on any modified app before allowing the push.
#
# Usage: setup-hooks.sh
# ============================================================

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="${REPO_ROOT}/.git/hooks"

echo "=== Installing git hooks ==="

# --- Pre-push hook ---
cat > "${HOOKS_DIR}/pre-push" << 'HOOKEOF'
#!/usr/bin/env bash
# Pre-push hook: Run QC on modified apps
# Installed by devops/scripts/setup-hooks.sh

REPO_ROOT="$(git rev-parse --show-toplevel)"
QC_RUNNER="${REPO_ROOT}/devops/scripts/qc-runner.sh"

if [[ ! -x "$QC_RUNNER" ]]; then
  echo "[hook] QC runner not found, skipping"
  exit 0
fi

# Find which apps were modified in commits being pushed
REMOTE="$1"
URL="$2"

while read local_ref local_oid remote_ref remote_oid; do
  if [[ "$local_oid" == "0000000000000000000000000000000000000000" ]]; then
    continue  # Branch deletion
  fi

  if [[ "$remote_oid" == "0000000000000000000000000000000000000000" ]]; then
    # New branch — compare against main
    RANGE="main..${local_oid}"
  else
    RANGE="${remote_oid}..${local_oid}"
  fi

  # Find modified apps
  MODIFIED_APPS=$(git diff --name-only "$RANGE" 2>/dev/null \
    | grep '^apps/' \
    | cut -d/ -f2 \
    | sort -u || true)

  if [[ -z "$MODIFIED_APPS" ]]; then
    echo "[hook] No app changes detected, skipping QC"
    continue
  fi

  echo "[hook] Running QC on modified apps: $MODIFIED_APPS"

  for app in $MODIFIED_APPS; do
    APP_DIR="apps/$app"
    if [[ -d "$APP_DIR" ]]; then
      echo ""
      echo "[hook] QC: $app"
      if ! "$QC_RUNNER" "$APP_DIR"; then
        echo ""
        echo "[hook] QC FAILED for $app — push blocked"
        echo "[hook] Fix the issues and try again"
        exit 1
      fi
    fi
  done
done

exit 0
HOOKEOF

chmod +x "${HOOKS_DIR}/pre-push"
echo "  [OK] pre-push hook installed"

echo ""
echo "=== Git hooks installed ==="
echo "  Pre-push: runs QC pipeline on modified apps"
echo ""
echo "To bypass (emergency only): git push --no-verify"
