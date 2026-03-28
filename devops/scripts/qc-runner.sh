#!/usr/bin/env bash
# ============================================================
# QC Runner — Pipeline Orchestrator
# ============================================================
# Runs all 7 QC checks in dependency order with up to 5
# fix rounds. Each fix is committed with [DevOps] fix: prefix.
#
# Usage: qc-runner.sh <app-directory>
# Exit 0: All checks pass
# Exit 1: Checks still failing after 5 rounds (escalation)
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: qc-runner.sh <app-directory>}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "=== QC ERROR: Directory not found: $APP_DIR ==="
  exit 1
fi

APP_NAME="$(basename "$APP_DIR")"

# --- Script location resolution ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QC_DIR="${SCRIPT_DIR}/qc"

# --- Check execution order (dependency-aware) ---
ALL_CHECKS=(
  "check-config"
  "check-health"
  "check-lockfiles"
  "check-dockerfile"
  "check-lint"
  "check-api-basepath"
  "check-auth-bypass"
  "check-app-dirs"
  "check-env-vars"
  "check-docker-build"
  "check-ports"
  "check-compose-network"
  "check-resource-limits"
  "check-image-size"
  "check-security"
  "check-deps"
  "check-tests"
  "check-db-ready"
)

# --- Dependency map ---
# When a check fails, its downstream dependents must be re-run next round.
# Key = upstream check, Value = downstream checks that depend on it.
# Dependency map (bash 3.x)
get_dependents() {
  local check="$1"
  case "$check" in
    check-config)     echo "check-dockerfile" ;;
    check-dockerfile) echo "check-docker-build" ;;
    check-lockfiles)  echo "check-docker-build" ;;
    check-lint)          echo "check-docker-build" ;;
    check-api-basepath)  echo "check-docker-build" ;;
    check-app-dirs)      echo "check-docker-build" ;;
    check-env-vars)      echo "check-docker-build check-db-ready" ;;
    *)                   echo "" ;;
  esac
}

# --- Git availability check ---
GIT_AVAILABLE=false
if [[ -d "$APP_DIR/.git" ]] || git -C "$APP_DIR" rev-parse --git-dir > /dev/null 2>&1; then
  GIT_AVAILABLE=true
fi

# --- Tracking ---
TOTAL_FIXES=0
MAX_ROUNDS=5
FINAL_ROUND=0

# --- Helper: deduplicate and preserve order (bash 3.x) ---
build_rerun_list() {
  local failed_checks="$*"
  local seen_list=""
  for check in $failed_checks; do
    if [[ "$seen_list" != *"|${check}|"* ]]; then
      seen_list="${seen_list}|${check}|"
    fi
    local deps
    deps="$(get_dependents "$check")"
    if [[ -n "$deps" ]]; then
      for dep in $deps; do
        if [[ "$seen_list" != *"|${dep}|"* ]]; then
          seen_list="${seen_list}|${dep}|"
        fi
      done
    fi
  done
  local ordered=""
  for check in "${ALL_CHECKS[@]}"; do
    if [[ "$seen_list" == *"|${check}|"* ]]; then
      ordered="${ordered} ${check}"
    fi
  done
  echo "$ordered"
}

# --- Main execution loop ---
echo "=========================================="
echo "  QC Pipeline — $APP_NAME"
echo "=========================================="
echo ""

CHECKS_TO_RUN=("${ALL_CHECKS[@]}")

for ROUND in $(seq 1 $MAX_ROUNDS); do
  FINAL_ROUND=$ROUND
  FAILED=()
  ROUND_FIXES=0

  echo "=== Round $ROUND: Running ${#CHECKS_TO_RUN[@]} check(s) ==="
  echo ""

  for CHECK in "${CHECKS_TO_RUN[@]}"; do
    CHECK_SCRIPT="${QC_DIR}/${CHECK}.sh"

    # Skip if check script doesn't exist
    if [[ ! -f "$CHECK_SCRIPT" ]]; then
      echo "  [WARN] Skipping $CHECK — script not found at $CHECK_SCRIPT"
      continue
    fi

    echo "--- Running: $CHECK ---"

    if "$CHECK_SCRIPT" "$APP_DIR"; then
      echo "  [OK] $CHECK passed"
    else
      echo "  [FIX] $CHECK found issues and applied fixes"
      FAILED+=("$CHECK")
      ROUND_FIXES=$((ROUND_FIXES + 1))
      TOTAL_FIXES=$((TOTAL_FIXES + 1))

      # Commit the fix if git is available
      if [[ "$GIT_AVAILABLE" == "true" ]]; then
        ORIG_DIR="$(pwd)"
        cd "$APP_DIR"
        git add -A
        if ! git diff --cached --quiet 2>/dev/null; then
          git commit -m "[DevOps] fix: $CHECK auto-fix (round $ROUND)" > /dev/null 2>&1 || true
          echo "  [COMMIT] [DevOps] fix: $CHECK auto-fix (round $ROUND)"
        fi
        cd "$ORIG_DIR"
      fi
    fi

    echo ""
  done

  # All checks passed — success
  if [[ ${#FAILED[@]} -eq 0 ]]; then
    echo "=== ALL CHECKS PASSED (round $ROUND) ==="
    echo ""
    echo "=========================================="
    echo "  QC SUMMARY"
    echo "=========================================="
    echo "  App: $APP_NAME"
    echo "  Rounds: $ROUND"
    echo "  Fixes applied: $TOTAL_FIXES"
    echo "  Status: PASS"
    echo "=========================================="
    exit 0
  fi

  echo "=== Round $ROUND complete: ${#FAILED[@]} check(s) needed fixes ($ROUND_FIXES fix commits) ==="
  echo ""

  # Build re-run list for next round (failed + downstream dependents)
  if [[ $ROUND -lt $MAX_ROUNDS ]]; then
    RERUN_STR="$(build_rerun_list "${FAILED[@]}")"
    read -ra CHECKS_TO_RUN <<< "$RERUN_STR"
    echo "=== Next round will re-run: ${CHECKS_TO_RUN[*]} ==="
    echo ""
  fi
done

# --- Escalation: 5 rounds exhausted ---
echo ""
echo "=========================================="
echo "  QC FAILED after $MAX_ROUNDS rounds"
echo "=========================================="
echo "  Still failing: ${FAILED[*]}"
echo "  Escalation required — manual intervention needed"
echo "=========================================="
echo ""
echo "=========================================="
echo "  QC SUMMARY"
echo "=========================================="
echo "  App: $APP_NAME"
echo "  Rounds: $MAX_ROUNDS"
echo "  Fixes applied: $TOTAL_FIXES"
echo "  Status: FAIL"
echo "=========================================="
exit 1
