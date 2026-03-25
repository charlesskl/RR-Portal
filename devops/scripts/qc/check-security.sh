#!/usr/bin/env bash
# ============================================================
# QC-15: Security Best Practices Check
# ============================================================
# Scans for common security issues in app code:
# - Missing helmet/security headers (Node.js)
# - Debug mode enabled in production
# - Exposed stack traces
# - Missing rate limiting
# - CORS wildcard in production
#
# Usage: check-security.sh <app-directory>
# Exit 0: No issues found
# Exit 1: Issues found and fixed
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-security.sh <app-directory>}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[QC-15] ERROR: Directory not found: $APP_DIR"
  exit 1
fi

APP_NAME="$(basename "$APP_DIR")"
FIXES_MADE=0
WARNINGS=0

# Stack detection
STACK="unknown"
SERVER_DIR="$APP_DIR"
for subdir in "" "server/"; do
  if [[ -f "$APP_DIR/${subdir}package.json" ]]; then
    STACK="node"
    SERVER_DIR="$APP_DIR/${subdir}"
    break
  fi
  if [[ -f "$APP_DIR/${subdir}requirements.txt" || -f "$APP_DIR/${subdir}pyproject.toml" ]]; then
    STACK="python"
    SERVER_DIR="$APP_DIR/${subdir}"
    break
  fi
done

EXCLUDE_DIRS="node_modules|__pycache__|\.git|dist|build|coverage|\.venv"

echo "[QC-15] Security scan for: $APP_DIR (stack: $STACK)"

# --- Node.js Security ---
if [[ "$STACK" == "node" ]]; then

  # Check 1: helmet middleware
  if [[ -f "$SERVER_DIR/package.json" ]]; then
    if ! grep -q '"helmet"' "$SERVER_DIR/package.json" 2>/dev/null; then
      echo "[QC-15] WARN: helmet not in dependencies — no security headers"
      WARNINGS=$((WARNINGS + 1))
    else
      # Check if helmet is actually used
      if ! grep -rq "helmet" "$SERVER_DIR" --include='*.js' --include='*.ts' \
        --exclude-dir=node_modules 2>/dev/null; then
        echo "[QC-15] WARN: helmet is a dependency but not imported/used"
        WARNINGS=$((WARNINGS + 1))
      else
        echo "[QC-15] PASS: helmet security headers enabled"
      fi
    fi
  fi

  # Check 2: express-rate-limit
  if [[ -f "$SERVER_DIR/package.json" ]]; then
    if ! grep -q '"express-rate-limit"\|"rate-limit"' "$SERVER_DIR/package.json" 2>/dev/null; then
      echo "[QC-15] WARN: no rate limiting package found — API vulnerable to abuse"
      WARNINGS=$((WARNINGS + 1))
    else
      echo "[QC-15] PASS: rate limiting package installed"
    fi
  fi

  # Check 3: error handler exposes stack traces
  if grep -rqE 'err\.stack|error\.stack' "$SERVER_DIR" --include='*.js' --include='*.ts' \
    --exclude-dir=node_modules 2>/dev/null; then
    # Check if it's in a response (not just console.error)
    if grep -rnE 'res\.(json|send)\(.*stack' "$SERVER_DIR" --include='*.js' --include='*.ts' \
      --exclude-dir=node_modules 2>/dev/null | head -1 | grep -q .; then
      echo "[QC-15] WARN: error handler may expose stack traces to clients"
      WARNINGS=$((WARNINGS + 1))
    fi
  fi

  # Check 4: console.log in production code (info leakage)
  CONSOLE_COUNT=$(grep -rc 'console\.log' "$SERVER_DIR" --include='*.js' --include='*.ts' \
    --exclude-dir=node_modules 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
  if [[ "$CONSOLE_COUNT" -gt 20 ]]; then
    echo "[QC-15] WARN: ${CONSOLE_COUNT} console.log statements — consider using a logger"
    WARNINGS=$((WARNINGS + 1))
  fi

  # Check 5: Hardcoded CORS wildcard
  if grep -rqE "cors\(\s*\)" "$SERVER_DIR" --include='*.js' --include='*.ts' \
    --exclude-dir=node_modules 2>/dev/null; then
    echo "[QC-15] INFO: CORS is set to allow all origins (acceptable for portal internal apps)"
  fi

fi

# --- Python Security ---
if [[ "$STACK" == "python" ]]; then

  # Check 1: DEBUG mode
  if grep -rqE 'DEBUG\s*=\s*True' "$SERVER_DIR" --include='*.py' \
    --exclude-dir=__pycache__ 2>/dev/null; then
    echo "[QC-15] WARN: DEBUG=True found in source code"
    WARNINGS=$((WARNINGS + 1))
  fi

  # Check 2: Secret key hardcoded
  if grep -rqE "SECRET_KEY\s*=\s*['\"]" "$SERVER_DIR" --include='*.py' \
    --exclude-dir=__pycache__ 2>/dev/null; then
    echo "[QC-15] WARN: SECRET_KEY appears hardcoded (should be env var)"
    WARNINGS=$((WARNINGS + 1))
  fi
fi

# --- Universal checks ---

# Check: .env file committed (should be in .gitignore)
if [[ -f "$APP_DIR/.gitignore" ]]; then
  if ! grep -q '^\.env$' "$APP_DIR/.gitignore" 2>/dev/null; then
    echo ".env" >> "$APP_DIR/.gitignore"
    echo "[QC-15] FIXED: added .env to .gitignore"
    FIXES_MADE=$((FIXES_MADE + 1))
  fi
elif [[ -d "$APP_DIR/.git" ]] || git -C "$APP_DIR" rev-parse --git-dir > /dev/null 2>&1; then
  echo ".env" > "$APP_DIR/.gitignore"
  echo "node_modules/" >> "$APP_DIR/.gitignore"
  echo "__pycache__/" >> "$APP_DIR/.gitignore"
  echo "dist/" >> "$APP_DIR/.gitignore"
  echo "[QC-15] FIXED: created .gitignore with .env exclusion"
  FIXES_MADE=$((FIXES_MADE + 1))
fi

# Check: Dockerfile runs as non-root
if [[ -f "$APP_DIR/Dockerfile" ]]; then
  if ! grep -q "^USER " "$APP_DIR/Dockerfile" 2>/dev/null; then
    echo "[QC-15] WARN: Dockerfile does not switch to non-root user"
    WARNINGS=$((WARNINGS + 1))
  else
    echo "[QC-15] PASS: Dockerfile uses non-root user"
  fi
fi

# --- Summary ---
if [[ "$FIXES_MADE" -gt 0 ]]; then
  echo "[QC-15] RESULT: Fixed ${FIXES_MADE} security issue(s), ${WARNINGS} warning(s)"
  exit 1
elif [[ "$WARNINGS" -gt 0 ]]; then
  echo "[QC-15] RESULT: ${WARNINGS} security warning(s) (advisory only)"
  exit 0
else
  echo "[QC-15] PASS: no security issues detected"
  exit 0
fi
