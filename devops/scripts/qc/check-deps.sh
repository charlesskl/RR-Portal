#!/usr/bin/env bash
# ============================================================
# QC-16: Dependency Check
# ============================================================
# Runs npm audit / pip-audit to detect known vulnerabilities.
# Advisory only — does not auto-fix (upgrades can break things).
#
# Usage: check-deps.sh <app-directory>
# Exit 0: Always (advisory check)
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-deps.sh <app-directory>}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[QC-16] ERROR: Directory not found: $APP_DIR"
  exit 1
fi

APP_NAME="$(basename "$APP_DIR")"

# Stack detection
SERVER_DIR="$APP_DIR"
if [[ -f "$APP_DIR/server/package.json" ]]; then
  SERVER_DIR="$APP_DIR/server"
elif [[ -f "$APP_DIR/package.json" ]]; then
  SERVER_DIR="$APP_DIR"
fi

echo "[QC-16] Dependency vulnerability scan for: $APP_NAME"

# --- Node.js: npm audit ---
if [[ -f "$SERVER_DIR/package.json" && -f "$SERVER_DIR/package-lock.json" ]]; then
  echo "[QC-16] Running npm audit..."

  AUDIT_OUTPUT=$(cd "$SERVER_DIR" && npm audit --production 2>&1 || true)
  VULN_COUNT=$(echo "$AUDIT_OUTPUT" | grep -oE '[0-9]+ vulnerabilit' | grep -oE '[0-9]+' | head -1 || echo "0")
  VULN_COUNT="${VULN_COUNT:-0}"

  if [[ "$VULN_COUNT" -gt 0 ]]; then
    # Extract severity breakdown
    CRITICAL=$(echo "$AUDIT_OUTPUT" | grep -oE '[0-9]+ critical' | grep -oE '[0-9]+' || echo "0")
    HIGH=$(echo "$AUDIT_OUTPUT" | grep -oE '[0-9]+ high' | grep -oE '[0-9]+' || echo "0")
    MODERATE=$(echo "$AUDIT_OUTPUT" | grep -oE '[0-9]+ moderate' | grep -oE '[0-9]+' || echo "0")

    echo "[QC-16] WARN: ${VULN_COUNT} known vulnerabilities"
    [[ "${CRITICAL:-0}" -gt 0 ]] && echo "[QC-16]   Critical: ${CRITICAL}"
    [[ "${HIGH:-0}" -gt 0 ]] && echo "[QC-16]   High: ${HIGH}"
    [[ "${MODERATE:-0}" -gt 0 ]] && echo "[QC-16]   Moderate: ${MODERATE}"
    echo "[QC-16] HINT: Run 'npm audit fix' to attempt automatic fixes"
  else
    echo "[QC-16] PASS: no known vulnerabilities in npm dependencies"
  fi

elif [[ -f "$SERVER_DIR/package.json" ]]; then
  echo "[QC-16] SKIP: package-lock.json not found (npm audit requires it)"
fi

# --- Python: check for known bad patterns ---
if [[ -f "$SERVER_DIR/requirements.txt" ]]; then
  echo "[QC-16] Checking Python dependencies..."

  # Check for unpinned dependencies (security risk)
  UNPINNED=$(grep -cvE '==|>=|<=|~=|^#|^$|^-' "$SERVER_DIR/requirements.txt" 2>/dev/null || echo "0")
  if [[ "$UNPINNED" -gt 0 ]]; then
    echo "[QC-16] WARN: ${UNPINNED} unpinned Python dependencies (use == for reproducible builds)"
  fi

  # Check for known problematic packages
  if grep -qi 'pyyaml.*[^=]$\|pyyaml==3\.' "$SERVER_DIR/requirements.txt" 2>/dev/null; then
    echo "[QC-16] WARN: old PyYAML version may have YAML deserialization vulnerabilities"
  fi

  if grep -qi 'django==1\.\|django==2\.' "$SERVER_DIR/requirements.txt" 2>/dev/null; then
    echo "[QC-16] WARN: Django 1.x/2.x is end-of-life — upgrade to 4.x+"
  fi
fi

# --- Check for .npmrc or pip.conf that might point to insecure registries ---
if [[ -f "$SERVER_DIR/.npmrc" ]]; then
  if grep -q "registry=http://" "$SERVER_DIR/.npmrc" 2>/dev/null; then
    echo "[QC-16] WARN: .npmrc uses HTTP registry (should be HTTPS)"
  fi
fi

echo "[QC-16] PASS: dependency check complete"
exit 0
