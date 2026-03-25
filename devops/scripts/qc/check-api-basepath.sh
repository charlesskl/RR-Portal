#!/usr/bin/env bash
# ============================================================
# QC-08: Sub-path API Routing Check
# ============================================================
# Ensures frontend apps behind a reverse proxy have correct
# base paths configured so API calls route through the
# sub-path (e.g., /zouhuo/api/... instead of /api/...).
#
# Usage: check-api-basepath.sh <app-directory>
# Exit 0: No frontend found, or paths already correct
# Exit 1: Issues found and fixed
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-api-basepath.sh <app-directory>}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[QC-08] ERROR: Directory not found: $APP_DIR"
  exit 1
fi

# --- Determine app name from directory path ---
APP_NAME="$(basename "$APP_DIR")"
echo "[QC-08] Scanning sub-path routing for: $APP_DIR (app: $APP_NAME)"

# --- Tracking ---
FIXES_MADE=0

# --- Exclusion patterns ---
EXCLUDE_DIRS="node_modules|dist|build|\.git|\.next|\.nuxt|coverage|__pycache__"

# --- Detect frontend presence ---
has_frontend() {
  local search_dirs=("client" "frontend" "src" ".")

  for dir in "${search_dirs[@]}"; do
    local target="$APP_DIR/$dir"
    [[ "$dir" == "." ]] && target="$APP_DIR"
    [[ ! -d "$target" ]] && continue

    # Check for bundler configs
    if ls "$target"/vite.config.* "$target"/next.config.* "$target"/webpack.config.* 2>/dev/null | head -1 | grep -q .; then
      return 0
    fi

    # Check for JSX/TSX/Vue files (excluding node_modules etc.)
    if find "$target" -type f \( -name "*.jsx" -o -name "*.tsx" -o -name "*.vue" \) \
      | grep -vE "$EXCLUDE_DIRS" | head -1 | grep -q .; then
      return 0
    fi
  done

  return 1
}

if ! has_frontend; then
  echo "[QC-08] PASS: no frontend detected in $APP_DIR"
  exit 0
fi

echo "[QC-08] Frontend detected, checking sub-path configuration..."

# --- Find the frontend root (directory containing the bundler config or component files) ---
FRONTEND_ROOT="$APP_DIR"
for subdir in "client" "frontend"; do
  if [[ -d "$APP_DIR/$subdir" ]]; then
    FRONTEND_ROOT="$APP_DIR/$subdir"
    break
  fi
done

# --- Check and fix Vite base path ---
fix_vite_base() {
  local vite_config=""

  for ext in js ts mjs mts; do
    if [[ -f "$FRONTEND_ROOT/vite.config.${ext}" ]]; then
      vite_config="$FRONTEND_ROOT/vite.config.${ext}"
      break
    fi
  done

  [[ -z "$vite_config" ]] && return 0

  echo "[QC-08] Found Vite config: $vite_config"

  local expected_base="/${APP_NAME}/"

  # Check if base is already correctly set
  if grep -qE "base\s*:\s*['\"]${expected_base}['\"]" "$vite_config"; then
    echo "[QC-08] PASS: Vite base already set to '${expected_base}'"
    return 0
  fi

  # Check if base is set to something else
  if grep -qE "base\s*:" "$vite_config"; then
    # Replace existing base value
    sed -i '' "s|base\s*:\s*['\"][^'\"]*['\"]|base: '${expected_base}'|" "$vite_config"
    echo "[QC-08] FIXED: updated Vite base to '${expected_base}' in ${vite_config}"
    FIXES_MADE=$((FIXES_MADE + 1))
    return 0
  fi

  # base not present at all — insert it after defineConfig({
  if grep -qE "defineConfig\s*\(\s*\{" "$vite_config"; then
    sed -i '' "/defineConfig\s*(\s*{/a\\
\\  base: '${expected_base}',
" "$vite_config"
    echo "[QC-08] FIXED: added Vite base: '${expected_base}' to ${vite_config}"
    FIXES_MADE=$((FIXES_MADE + 1))
    return 0
  fi

  # Fallback: insert after first export default {
  if grep -qE "export\s+default\s+\{" "$vite_config"; then
    sed -i '' "/export\s*default\s*{/a\\
\\  base: '${expected_base}',
" "$vite_config"
    echo "[QC-08] FIXED: added Vite base: '${expected_base}' to ${vite_config}"
    FIXES_MADE=$((FIXES_MADE + 1))
    return 0
  fi

  echo "[QC-08] WARN: could not determine where to insert base in ${vite_config}"
}

# --- Check and fix Next.js basePath ---
fix_nextjs_base() {
  local next_config=""

  for ext in js mjs ts; do
    if [[ -f "$FRONTEND_ROOT/next.config.${ext}" ]]; then
      next_config="$FRONTEND_ROOT/next.config.${ext}"
      break
    fi
  done

  # Also check app root for monorepo
  if [[ -z "$next_config" ]]; then
    for ext in js mjs ts; do
      if [[ -f "$APP_DIR/next.config.${ext}" ]]; then
        next_config="$APP_DIR/next.config.${ext}"
        break
      fi
    done
  fi

  [[ -z "$next_config" ]] && return 0

  echo "[QC-08] Found Next.js config: $next_config"

  local expected_base="/${APP_NAME}"

  # Check if basePath is already correctly set
  if grep -qE "basePath\s*:\s*['\"]${expected_base}['\"]" "$next_config"; then
    echo "[QC-08] PASS: Next.js basePath already set to '${expected_base}'"
    return 0
  fi

  # Check if basePath is set to something else
  if grep -qE "basePath\s*:" "$next_config"; then
    sed -i '' "s|basePath\s*:\s*['\"][^'\"]*['\"]|basePath: '${expected_base}'|" "$next_config"
    echo "[QC-08] FIXED: updated Next.js basePath to '${expected_base}' in ${next_config}"
    FIXES_MADE=$((FIXES_MADE + 1))
    return 0
  fi

  # basePath not present — insert it
  if grep -qE "module\.exports\s*=\s*\{" "$next_config"; then
    sed -i '' "/module\.exports\s*=\s*{/a\\
\\  basePath: '${expected_base}',
" "$next_config"
    echo "[QC-08] FIXED: added Next.js basePath: '${expected_base}' to ${next_config}"
    FIXES_MADE=$((FIXES_MADE + 1))
    return 0
  fi

  # Try nextConfig = { pattern
  if grep -qE "nextConfig\s*=\s*\{" "$next_config"; then
    sed -i '' "/nextConfig\s*=\s*{/a\\
\\  basePath: '${expected_base}',
" "$next_config"
    echo "[QC-08] FIXED: added Next.js basePath: '${expected_base}' to ${next_config}"
    FIXES_MADE=$((FIXES_MADE + 1))
    return 0
  fi

  echo "[QC-08] WARN: could not determine where to insert basePath in ${next_config}"
}

fix_vite_base
fix_nextjs_base

# --- Get all frontend source files ---
get_frontend_files() {
  find "$FRONTEND_ROOT" -type f \( -name "*.js" -o -name "*.ts" -o -name "*.jsx" -o -name "*.tsx" -o -name "*.vue" -o -name "*.mjs" \) \
    | grep -vE "$EXCLUDE_DIRS" || true
}

# --- Check if baseURL already configured ---
check_base_url_configured() {
  local files
  files="$(get_frontend_files)"
  [[ -z "$files" ]] && return 1

  local expected="/${APP_NAME}"

  # Check axios.defaults.baseURL
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue

    if grep -qE "axios\.defaults\.baseURL\s*=\s*['\"]${expected}['\"]" "$file" 2>/dev/null; then
      echo "[QC-08] PASS: axios.defaults.baseURL already set to '${expected}' in ${file}"
      return 0
    fi

    # Check axios.create with baseURL
    if grep -qE "baseURL\s*:\s*['\"]${expected}['\"]" "$file" 2>/dev/null; then
      echo "[QC-08] PASS: axios instance baseURL already set to '${expected}' in ${file}"
      return 0
    fi
  done <<< "$files"

  # Check for fetch wrapper already in place
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue

    if grep -qE "_originalFetch|window\.fetch\s*=" "$file" 2>/dev/null; then
      if grep -qE "/${APP_NAME}" "$file" 2>/dev/null; then
        echo "[QC-08] PASS: fetch wrapper already configured for '${expected}' in ${file}"
        return 0
      fi
    fi
  done <<< "$files"

  return 1
}

if check_base_url_configured; then
  # baseURL already set — only report Vite fixes if any
  if [[ "$FIXES_MADE" -gt 0 ]]; then
    echo "[QC-08] RESULT: Fixed ${FIXES_MADE} sub-path routing issue(s)"
    exit 1
  fi
  exit 0
fi

# --- Detect whether app uses axios or fetch ---
USES_AXIOS=false
USES_FETCH=false
AXIOS_IMPORT_FILE=""
FETCH_FILE=""

detect_http_client() {
  local files
  files="$(get_frontend_files)"
  [[ -z "$files" ]] && return

  while IFS= read -r file; do
    [[ -z "$file" ]] && continue

    # Check for axios import/require
    if grep -qE "(import\s+axios|require\s*\(\s*['\"]axios['\"])" "$file" 2>/dev/null; then
      USES_AXIOS=true
      if [[ -z "$AXIOS_IMPORT_FILE" ]]; then
        AXIOS_IMPORT_FILE="$file"
      fi
    fi

    # Check for fetch('/api/ or fetch("/api/ usage
    if grep -qE "fetch\s*\(\s*['\"]/" "$file" 2>/dev/null; then
      USES_FETCH=true
      if [[ -z "$FETCH_FILE" ]]; then
        FETCH_FILE="$file"
      fi
    fi
  done <<< "$files"
}

detect_http_client

# --- Scan for absolute API paths (informational) ---
scan_absolute_api_paths() {
  local files
  files="$(get_frontend_files)"
  [[ -z "$files" ]] && return

  local found=0

  while IFS= read -r file; do
    [[ -z "$file" ]] && continue

    # Check for /api/ patterns in axios or fetch calls
    if grep -nE "(axios\.(get|post|put|delete|patch)|fetch)\s*\(\s*['\"]\/api\/" "$file" 2>/dev/null; then
      found=$((found + 1))
    fi

    # Also check for string assignments like '/api/...'
    if grep -nE "['\"]\/api\/" "$file" 2>/dev/null | grep -vE "baseURL|BASE_URL|base_url" 2>/dev/null | head -5 | grep -q .; then
      found=$((found + 1))
    fi
  done <<< "$files"

  if [[ "$found" -gt 0 ]]; then
    echo "[QC-08] WARN: found absolute /api/ paths in source files — applying baseURL fix"
  fi
}

scan_absolute_api_paths

# --- Find main entry file for injection ---
find_entry_file() {
  # Priority order: main.jsx, main.tsx, index.jsx, index.tsx, App.jsx, App.tsx, src/main.*, src/index.*
  local candidates=(
    "src/main.jsx" "src/main.tsx" "src/main.js" "src/main.ts"
    "src/index.jsx" "src/index.tsx" "src/index.js" "src/index.ts"
    "src/App.jsx" "src/App.tsx" "src/App.js" "src/App.ts"
    "main.jsx" "main.tsx" "main.js" "main.ts"
    "index.jsx" "index.tsx" "index.js" "index.ts"
    "App.jsx" "App.tsx" "App.js" "App.ts"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -f "$FRONTEND_ROOT/$candidate" ]]; then
      echo "$FRONTEND_ROOT/$candidate"
      return 0
    fi
  done

  return 1
}

# --- Auto-fix: axios baseURL ---
fix_axios() {
  local target_file=""

  # Prefer the file that imports axios
  if [[ -n "$AXIOS_IMPORT_FILE" ]]; then
    target_file="$AXIOS_IMPORT_FILE"
  else
    target_file="$(find_entry_file)" || true
  fi

  if [[ -z "$target_file" || ! -f "$target_file" ]]; then
    echo "[QC-08] WARN: could not find entry file to inject axios.defaults.baseURL"
    return
  fi

  local base_url="/${APP_NAME}"

  # Find the import axios line and insert after it
  local import_line
  import_line="$(grep -n "import axios" "$target_file" | head -1 | cut -d: -f1)"

  if [[ -n "$import_line" ]]; then
    sed -i '' "${import_line}a\\
\\
// Sub-path base URL for reverse proxy routing (added by QC-08)\\
axios.defaults.baseURL = '${base_url}';
" "$target_file"
    echo "[QC-08] FIXED: added axios.defaults.baseURL = '${base_url}' after import in ${target_file}"
    FIXES_MADE=$((FIXES_MADE + 1))
    return
  fi

  # Try require pattern
  local require_line
  require_line="$(grep -n "require.*axios" "$target_file" | head -1 | cut -d: -f1)"

  if [[ -n "$require_line" ]]; then
    sed -i '' "${require_line}a\\
\\
// Sub-path base URL for reverse proxy routing (added by QC-08)\\
axios.defaults.baseURL = '${base_url}';
" "$target_file"
    echo "[QC-08] FIXED: added axios.defaults.baseURL = '${base_url}' after require in ${target_file}"
    FIXES_MADE=$((FIXES_MADE + 1))
    return
  fi

  # No import line found — prepend to file
  local inject_code
  inject_code="$(printf '\n// Sub-path base URL for reverse proxy routing (added by QC-08)\nimport axios from \"axios\";\naxios.defaults.baseURL = \"%s\";\n' "$base_url")"
  {
    echo "$inject_code"
    cat "$target_file"
  } > "${target_file}.tmp"
  mv "${target_file}.tmp" "$target_file"
  echo "[QC-08] FIXED: prepended axios import + baseURL = '${base_url}' to ${target_file}"
  FIXES_MADE=$((FIXES_MADE + 1))
}

# --- Auto-fix: fetch wrapper ---
fix_fetch() {
  local target_file=""
  target_file="$(find_entry_file)" || true

  if [[ -z "$target_file" || ! -f "$target_file" ]]; then
    echo "[QC-08] WARN: could not find entry file to inject fetch wrapper"
    return
  fi

  local base_url="/${APP_NAME}"

  # Check if wrapper already exists
  if grep -q "_originalFetch" "$target_file" 2>/dev/null; then
    echo "[QC-08] PASS: fetch wrapper already present in ${target_file}"
    return
  fi

  # Inject fetch wrapper at the top of the file (after any imports)
  # Find the last import line
  local last_import_line
  last_import_line="$(grep -n "^import " "$target_file" | tail -1 | cut -d: -f1)"

  local wrapper
  wrapper="$(cat <<WRAPEOF

// Sub-path fetch wrapper for reverse proxy routing (added by QC-08)
const _originalFetch = window.fetch;
window.fetch = (url, opts) => {
  if (typeof url === 'string' && url.startsWith('/api/')) {
    url = '${base_url}' + url;
  }
  return _originalFetch(url, opts);
};
WRAPEOF
)"

  if [[ -n "$last_import_line" ]]; then
    # Create temp file with injection after last import
    local head_count="$last_import_line"
    {
      head -n "$head_count" "$target_file"
      echo "$wrapper"
      tail -n +"$((head_count + 1))" "$target_file"
    } > "${target_file}.tmp"
    mv "${target_file}.tmp" "$target_file"
    echo "[QC-08] FIXED: added fetch wrapper for '${base_url}' after imports in ${target_file}"
  else
    # No imports found — prepend
    {
      echo "$wrapper"
      echo ""
      cat "$target_file"
    } > "${target_file}.tmp"
    mv "${target_file}.tmp" "$target_file"
    echo "[QC-08] FIXED: prepended fetch wrapper for '${base_url}' to ${target_file}"
  fi

  FIXES_MADE=$((FIXES_MADE + 1))
}

# --- Apply fixes based on detected HTTP client ---

if [[ "$USES_AXIOS" == "true" ]]; then
  fix_axios
elif [[ "$USES_FETCH" == "true" ]]; then
  fix_fetch
else
  # Neither detected explicitly — check if there are any /api/ paths at all
  api_path_count="$(get_frontend_files | xargs grep -lE "['\"]\/api\/" 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "$api_path_count" -gt 0 ]]; then
    echo "[QC-08] WARN: found /api/ paths but no axios/fetch detected — attempting fetch wrapper"
    fix_fetch
  else
    echo "[QC-08] PASS: no absolute /api/ paths found in frontend source"
  fi
fi

# --- Result ---

if [[ "$FIXES_MADE" -gt 0 ]]; then
  echo "[QC-08] RESULT: Fixed ${FIXES_MADE} sub-path routing issue(s)"
  exit 1
else
  echo "[QC-08] PASS: sub-path API routing already configured correctly"
  exit 0
fi
