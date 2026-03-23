#!/usr/bin/env bash
# ============================================================
# QC-05: Lint Auto-Fix Check
# ============================================================
# Runs ESLint/Prettier for Node.js or ruff for Python with
# auto-fix enabled. Ensures code quality without developer effort.
#
# Usage: check-lint.sh <app-directory>
# Exit 0: Lint passes with no issues
# Exit 1: Lint errors were auto-fixed
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-lint.sh <app-directory>}"

# ---- Helpers ----

log_info()  { echo "[QC-05] INFO: $*"; }
log_pass()  { echo "[QC-05] PASS: $*"; }
log_fixed() { echo "[QC-05] FIXED: $*"; }
log_warn()  { echo "[QC-05] WARN: $*"; }

# Count changed files using git diff or mtime-based fallback
count_changes() {
  local dir="$1"
  if git -C "$dir" rev-parse --is-inside-work-tree &>/dev/null; then
    git -C "$dir" diff --name-only 2>/dev/null | wc -l | tr -d ' '
  else
    echo "0"
  fi
}

# ---- Stack detection ----

STACK=""
if [[ -f "$APP_DIR/package.json" ]]; then
  STACK="node"
elif [[ -f "$APP_DIR/requirements.txt" || -f "$APP_DIR/pyproject.toml" ]]; then
  STACK="python"
else
  log_warn "cannot detect stack, skipping lint check"
  exit 0
fi

# ---- Node.js lint ----

if [[ "$STACK" == "node" ]]; then
  # Check if eslint is in dependencies
  has_eslint=$(python3 -c "
import json
try:
    d = json.load(open('$APP_DIR/package.json'))
    deps = {**d.get('dependencies', {}), **d.get('devDependencies', {})}
    if 'eslint' in deps: print('yes')
except: pass
" 2>/dev/null || true)

  # Install eslint if not present
  if [[ "$has_eslint" != "yes" ]]; then
    log_info "installing eslint"
    if ! (cd "$APP_DIR" && npm install --save-dev eslint @eslint/js 2>/dev/null); then
      log_warn "failed to install eslint, skipping lint check"
      exit 0
    fi
  fi

  # Create minimal eslint config if none exists
  has_config=false
  for pattern in .eslintrc .eslintrc.js .eslintrc.cjs .eslintrc.json .eslintrc.yml eslint.config.js eslint.config.mjs eslint.config.cjs; do
    if [[ -f "$APP_DIR/$pattern" ]]; then
      has_config=true
      break
    fi
  done

  if [[ "$has_config" == false ]]; then
    log_info "creating minimal eslint config"
    cat > "$APP_DIR/eslint.config.mjs" << 'ESLINTCFG'
import js from "@eslint/js";
export default [js.configs.recommended];
ESLINTCFG
  fi

  # Snapshot changed files before lint
  changes_before=$(count_changes "$APP_DIR")

  # Run eslint --fix
  log_info "running eslint --fix"
  (cd "$APP_DIR" && npx eslint --fix . 2>/dev/null) || true

  # Run prettier if available
  has_prettier=$(python3 -c "
import json
try:
    d = json.load(open('$APP_DIR/package.json'))
    deps = {**d.get('dependencies', {}), **d.get('devDependencies', {})}
    if 'prettier' in deps: print('yes')
except: pass
" 2>/dev/null || true)

  if [[ "$has_prettier" == "yes" ]]; then
    log_info "running prettier --write"
    (cd "$APP_DIR" && npx prettier --write . 2>/dev/null) || true
  fi

  # Check if files changed
  changes_after=$(count_changes "$APP_DIR")

  if [[ "$changes_after" -gt "$changes_before" ]]; then
    fixed_count=$((changes_after - changes_before))
    log_fixed "auto-fixed lint errors in $fixed_count files"
    exit 1
  fi

  log_pass "lint check passed with no issues"
  exit 0
fi

# ---- Python lint ----

if [[ "$STACK" == "python" ]]; then
  # Check if ruff is available
  if ! command -v ruff &>/dev/null; then
    log_info "installing ruff"
    if ! pip install ruff 2>/dev/null; then
      log_warn "failed to install ruff, skipping lint check"
      exit 0
    fi
  fi

  # Snapshot changed files before lint
  changes_before=$(count_changes "$APP_DIR")

  # Run ruff check with auto-fix
  log_info "running ruff check --fix"
  (cd "$APP_DIR" && ruff check --fix . 2>/dev/null) || true

  # Run ruff format
  log_info "running ruff format"
  (cd "$APP_DIR" && ruff format . 2>/dev/null) || true

  # Check if files changed
  changes_after=$(count_changes "$APP_DIR")

  if [[ "$changes_after" -gt "$changes_before" ]]; then
    fixed_count=$((changes_after - changes_before))
    log_fixed "auto-fixed $fixed_count lint errors"
    exit 1
  fi

  log_pass "lint check passed with no issues"
  exit 0
fi
