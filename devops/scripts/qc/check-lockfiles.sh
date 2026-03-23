#!/usr/bin/env bash
# ============================================================
# QC-03: Lock File Verification & Generation
# ============================================================
# Ensures dependency lock files exist for reproducible builds.
# Generates them if missing.
#
# Usage: check-lockfiles.sh <app-directory>
# Exit 0: Lock files already present
# Exit 1: Lock files generated
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-lockfiles.sh <app-directory>}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[QC-03] ERROR: Directory not found: $APP_DIR"
  exit 1
fi

FIXES_MADE=0

# --- Node.js: Check for package-lock.json ---
if [[ -f "$APP_DIR/package.json" ]]; then
  if [[ -f "$APP_DIR/package-lock.json" && -s "$APP_DIR/package-lock.json" ]]; then
    echo "[QC-03] PASS: package-lock.json present"
  elif [[ -f "$APP_DIR/yarn.lock" && -s "$APP_DIR/yarn.lock" ]]; then
    echo "[QC-03] PASS: yarn.lock present (using yarn)"
  elif [[ -f "$APP_DIR/pnpm-lock.yaml" && -s "$APP_DIR/pnpm-lock.yaml" ]]; then
    echo "[QC-03] PASS: pnpm-lock.yaml present (using pnpm)"
  else
    echo "[QC-03] FOUND: missing lock file for Node.js project"

    # Check if npm is available
    if command -v npm &>/dev/null; then
      echo "[QC-03] Generating package-lock.json..."
      (cd "$APP_DIR" && npm install --package-lock-only --ignore-scripts 2>&1) || {
        echo "[QC-03] WARN: npm install --package-lock-only failed"
        echo "[QC-03] Attempting npm install..."
        (cd "$APP_DIR" && npm install --ignore-scripts 2>&1) || {
          echo "[QC-03] ERROR: failed to generate package-lock.json"
        }
      }

      if [[ -f "$APP_DIR/package-lock.json" ]]; then
        echo "[QC-03] FIXED: generated package-lock.json"
        FIXES_MADE=$((FIXES_MADE + 1))
      else
        echo "[QC-03] ERROR: package-lock.json was not generated"
      fi
    else
      echo "[QC-03] ERROR: npm not available, cannot generate lock file"
    fi
  fi
fi

# --- Python: Check for requirements.txt with pinned versions ---
if [[ -f "$APP_DIR/requirements.txt" ]]; then
  if [[ ! -s "$APP_DIR/requirements.txt" ]]; then
    echo "[QC-03] WARN: requirements.txt is empty"
  elif grep -q "==" "$APP_DIR/requirements.txt"; then
    echo "[QC-03] PASS: requirements.txt has pinned versions"
  else
    echo "[QC-03] FOUND: requirements.txt lacks pinned versions"

    # Check if pip is available and we're in a venv or can use pip-compile
    if command -v pip-compile &>/dev/null; then
      echo "[QC-03] Pinning versions with pip-compile..."
      # Rename unpinned file and compile
      cp "$APP_DIR/requirements.txt" "$APP_DIR/requirements.in"
      (cd "$APP_DIR" && pip-compile requirements.in -o requirements.txt 2>&1) || {
        echo "[QC-03] WARN: pip-compile failed, restoring original"
        mv "$APP_DIR/requirements.in" "$APP_DIR/requirements.txt"
      }
      if [[ -f "$APP_DIR/requirements.in" && -f "$APP_DIR/requirements.txt" ]] && grep -q "==" "$APP_DIR/requirements.txt"; then
        echo "[QC-03] FIXED: pinned versions in requirements.txt"
        FIXES_MADE=$((FIXES_MADE + 1))
      fi
    elif command -v pip &>/dev/null; then
      # Only use pip freeze if we're in a virtual environment
      if [[ -n "${VIRTUAL_ENV:-}" ]]; then
        echo "[QC-03] Pinning versions with pip freeze..."
        pip freeze > "$APP_DIR/requirements.txt"
        echo "[QC-03] FIXED: pinned versions in requirements.txt via pip freeze"
        FIXES_MADE=$((FIXES_MADE + 1))
      else
        echo "[QC-03] WARN: requirements.txt has unpinned versions but no virtual environment active"
        echo "[QC-03] WARN: activate a venv and re-run, or use pip-compile"
      fi
    else
      echo "[QC-03] WARN: neither pip-compile nor pip available"
    fi
  fi
elif [[ -f "$APP_DIR/pyproject.toml" && ! -f "$APP_DIR/requirements.txt" ]]; then
  echo "[QC-03] FOUND: pyproject.toml exists but no requirements.txt"

  # Try pip-compile first
  if command -v pip-compile &>/dev/null; then
    echo "[QC-03] Generating requirements.txt from pyproject.toml..."
    (cd "$APP_DIR" && pip-compile pyproject.toml -o requirements.txt 2>&1) || {
      echo "[QC-03] WARN: pip-compile failed for pyproject.toml"
    }
    if [[ -f "$APP_DIR/requirements.txt" && -s "$APP_DIR/requirements.txt" ]]; then
      echo "[QC-03] FIXED: generated requirements.txt from pyproject.toml"
      FIXES_MADE=$((FIXES_MADE + 1))
    fi
  else
    # Manual extraction of dependencies from pyproject.toml
    echo "[QC-03] Extracting dependencies from pyproject.toml..."
    local_deps=""
    in_deps=false
    while IFS= read -r line; do
      if echo "$line" | grep -qE '^\s*dependencies\s*=\s*\['; then
        in_deps=true
        continue
      fi
      if [[ "$in_deps" == "true" ]]; then
        if echo "$line" | grep -q ']'; then
          in_deps=false
          continue
        fi
        # Extract package name from quoted string
        local dep
        dep="$(echo "$line" | sed 's/.*"\(.*\)".*/\1/' | tr -d ',')"
        if [[ -n "$dep" && "$dep" != "$line" ]]; then
          echo "$dep" >> "$APP_DIR/requirements.txt"
        fi
      fi
    done < "$APP_DIR/pyproject.toml"

    if [[ -f "$APP_DIR/requirements.txt" && -s "$APP_DIR/requirements.txt" ]]; then
      echo "[QC-03] FIXED: generated requirements.txt from pyproject.toml (unpinned — consider using pip-compile)"
      FIXES_MADE=$((FIXES_MADE + 1))
    else
      echo "[QC-03] WARN: could not extract dependencies from pyproject.toml"
    fi
  fi
fi

# --- Result ---
if [[ "$FIXES_MADE" -gt 0 ]]; then
  echo "[QC-03] RESULT: Fixed ${FIXES_MADE} lock file issue(s)"
  exit 1
else
  echo "[QC-03] PASS: lock files present"
  exit 0
fi
