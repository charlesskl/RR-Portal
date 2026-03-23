#!/usr/bin/env bash
# ============================================================
# QC-17: Automated Test Runner
# ============================================================
# If the app has a test script/suite, run it.
# Advisory only — test failures are reported but don't block.
#
# Usage: check-tests.sh <app-directory>
# Exit 0: Always (advisory — tests are informational)
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-tests.sh <app-directory>}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[QC-17] ERROR: Directory not found: $APP_DIR"
  exit 1
fi

APP_NAME="$(basename "$APP_DIR")"

# Find package.json in app root or server/ subdirectory
PKG_DIR="$APP_DIR"
if [[ -f "$APP_DIR/server/package.json" ]]; then
  PKG_DIR="$APP_DIR/server"
elif [[ ! -f "$APP_DIR/package.json" ]]; then
  PKG_DIR=""
fi

echo "[QC-17] Checking for tests in: $APP_NAME"

# --- Node.js tests ---
if [[ -n "$PKG_DIR" && -f "$PKG_DIR/package.json" ]]; then
  HAS_TEST=$(python3 -c "
import json
try:
    d = json.load(open('${PKG_DIR}/package.json'))
    test_script = d.get('scripts', {}).get('test', '')
    if test_script and 'no test specified' not in test_script:
        print('yes')
    else:
        print('no')
except:
    print('no')
" 2>/dev/null || echo "no")

  if [[ "$HAS_TEST" == "yes" ]]; then
    echo "[QC-17] Found npm test script, running..."

    # Only run if node_modules exists (don't install deps just for tests)
    if [[ -d "$PKG_DIR/node_modules" ]]; then
      TEST_OUTPUT=$(cd "$PKG_DIR" && npm test 2>&1 || true)
      TEST_EXIT=$?

      if echo "$TEST_OUTPUT" | grep -qiE 'pass|✓|✔|succeeded'; then
        echo "[QC-17] PASS: tests passed"
      elif echo "$TEST_OUTPUT" | grep -qiE 'fail|✗|✘|error'; then
        echo "[QC-17] WARN: some tests failed (advisory)"
        echo "$TEST_OUTPUT" | tail -10 | sed 's/^/  /'
      else
        echo "[QC-17] INFO: test output unclear — check manually"
      fi
    else
      echo "[QC-17] SKIP: node_modules not installed (run npm ci first)"
    fi
  else
    echo "[QC-17] INFO: no test script in package.json"
  fi
fi

# --- Python tests ---
if [[ -f "$APP_DIR/requirements.txt" || -f "$APP_DIR/server/requirements.txt" ]]; then
  PYTHON_PKG_DIR="$APP_DIR"
  [[ -f "$APP_DIR/server/requirements.txt" ]] && PYTHON_PKG_DIR="$APP_DIR/server"

  # Check for pytest or unittest files
  TEST_FILES=$(find "$PYTHON_PKG_DIR" -name "test_*.py" -o -name "*_test.py" 2>/dev/null \
    | grep -vE "__pycache__|\.venv|venv" | head -5 || true)

  if [[ -n "$TEST_FILES" ]]; then
    echo "[QC-17] Found Python test files:"
    echo "$TEST_FILES" | head -3 | sed 's/^/  /'

    if command -v pytest &>/dev/null; then
      echo "[QC-17] Running pytest..."
      PYTEST_OUTPUT=$(cd "$PYTHON_PKG_DIR" && pytest --tb=short -q 2>&1 || true)
      if echo "$PYTEST_OUTPUT" | grep -qE 'passed'; then
        echo "[QC-17] PASS: pytest passed"
      else
        echo "[QC-17] WARN: pytest had failures (advisory)"
        echo "$PYTEST_OUTPUT" | tail -5 | sed 's/^/  /'
      fi
    else
      echo "[QC-17] SKIP: pytest not installed"
    fi
  else
    echo "[QC-17] INFO: no Python test files found"
  fi
fi

echo "[QC-17] PASS: test check complete"
exit 0
