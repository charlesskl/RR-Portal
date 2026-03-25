#!/usr/bin/env bash
# ============================================================
# QC-02: Health Endpoint Verification & Injection
# ============================================================
# Detects whether GET /health exists in the app. If missing,
# injects a health endpoint using the appropriate framework pattern.
#
# Usage: check-health.sh <app-directory>
# Exit 0: /health endpoint already exists
# Exit 1: /health endpoint was added
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-health.sh <app-directory>}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[QC-02] ERROR: Directory not found: $APP_DIR"
  exit 1
fi

# --- Detection: Check if /health route already exists ---
HEALTH_EXISTS=false

if grep -rq "'/health'" "$APP_DIR" --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" --include="*.py" --include="*.mjs" --include="*.cjs" 2>/dev/null; then
  HEALTH_EXISTS=true
fi

if grep -rq '"/health"' "$APP_DIR" --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" --include="*.py" --include="*.mjs" --include="*.cjs" 2>/dev/null; then
  HEALTH_EXISTS=true
fi

if [[ "$HEALTH_EXISTS" == "true" ]]; then
  echo "[QC-02] PASS: /health endpoint found"
  exit 0
fi

# --- Framework Detection ---
FRAMEWORK="unknown"
MAIN_FILE=""

detect_node_main() {
  local candidates=("index.js" "app.js" "server.js" "src/index.js" "src/app.js" "src/server.js" "index.ts" "app.ts" "server.ts" "src/index.ts" "src/app.ts" "src/server.ts" "src/main.ts" "main.ts")

  # Check package.json main field first
  if [[ -f "$APP_DIR/package.json" ]]; then
    local pkg_main
    pkg_main="$(grep -oE '"main"\s*:\s*"[^"]*"' "$APP_DIR/package.json" | head -1 | sed 's/"main"\s*:\s*"//' | tr -d '"')"
    if [[ -n "$pkg_main" && -f "$APP_DIR/$pkg_main" ]]; then
      MAIN_FILE="$APP_DIR/$pkg_main"
      return 0
    fi

    # Check scripts.start for the entry file
    local start_script
    start_script="$(grep -oE '"start"\s*:\s*"[^"]*"' "$APP_DIR/package.json" | head -1 | sed 's/"start"\s*:\s*"//' | tr -d '"')"
    if [[ -n "$start_script" ]]; then
      local entry
      entry="$(echo "$start_script" | grep -oE '[^ ]+\.(js|ts|mjs)' | head -1)"
      if [[ -n "$entry" && -f "$APP_DIR/$entry" ]]; then
        MAIN_FILE="$APP_DIR/$entry"
        return 0
      fi
    fi
  fi

  # Try common filenames
  for candidate in "${candidates[@]}"; do
    if [[ -f "$APP_DIR/$candidate" ]]; then
      MAIN_FILE="$APP_DIR/$candidate"
      return 0
    fi
  done

  return 1
}

detect_python_main() {
  local candidates=("app.py" "main.py" "wsgi.py" "src/app.py" "src/main.py" "src/wsgi.py")

  for candidate in "${candidates[@]}"; do
    if [[ -f "$APP_DIR/$candidate" ]]; then
      MAIN_FILE="$APP_DIR/$candidate"
      return 0
    fi
  done

  return 1
}

# Detect framework from package.json
if [[ -f "$APP_DIR/package.json" ]]; then
  PKG_CONTENT="$(cat "$APP_DIR/package.json")"

  if echo "$PKG_CONTENT" | grep -q '"@nestjs/core"'; then
    FRAMEWORK="nestjs"
  elif echo "$PKG_CONTENT" | grep -q '"fastify"'; then
    FRAMEWORK="fastify"
  elif echo "$PKG_CONTENT" | grep -q '"express"'; then
    FRAMEWORK="express"
  else
    # Default to express-like if Node.js project
    FRAMEWORK="express"
  fi

  detect_node_main || true
fi

# Detect framework from Python dependencies
if [[ -f "$APP_DIR/requirements.txt" ]]; then
  REQ_CONTENT="$(cat "$APP_DIR/requirements.txt")"

  if echo "$REQ_CONTENT" | grep -qi "fastapi"; then
    FRAMEWORK="fastapi"
  elif echo "$REQ_CONTENT" | grep -qi "django"; then
    FRAMEWORK="django"
  elif echo "$REQ_CONTENT" | grep -qi "flask"; then
    FRAMEWORK="flask"
  fi

  detect_python_main || true
elif [[ -f "$APP_DIR/pyproject.toml" ]]; then
  PYPROJECT_CONTENT="$(cat "$APP_DIR/pyproject.toml")"

  if echo "$PYPROJECT_CONTENT" | grep -qi "fastapi"; then
    FRAMEWORK="fastapi"
  elif echo "$PYPROJECT_CONTENT" | grep -qi "django"; then
    FRAMEWORK="django"
  elif echo "$PYPROJECT_CONTENT" | grep -qi "flask"; then
    FRAMEWORK="flask"
  fi

  detect_python_main || true
fi

if [[ "$FRAMEWORK" == "unknown" || -z "$MAIN_FILE" ]]; then
  echo "[QC-02] WARN: Could not detect framework or main file in $APP_DIR"
  echo "[QC-02] SKIP: unable to inject /health endpoint automatically"
  exit 0
fi

echo "[QC-02] Detected framework: $FRAMEWORK (main file: $MAIN_FILE)"

# --- Injection Patterns ---

inject_express() {
  local file="$1"
  local health_route="app.get('/health', (req, res) => res.json({ status: 'ok' }));"

  # Find the line where app is created: const app = express() or similar
  local app_line
  app_line="$(grep -n "express()" "$file" | head -1 | cut -d: -f1)"

  if [[ -z "$app_line" ]]; then
    # Try require('express')() pattern
    app_line="$(grep -n "require.*express" "$file" | head -1 | cut -d: -f1)"
  fi

  if [[ -n "$app_line" ]]; then
    # Insert health route after the app creation line
    sed -i '' "${app_line}a\\
\\
// Health check endpoint (added by QC-02)\\
${health_route}
" "$file"
    echo "[QC-02] FIXED: added /health endpoint to ${file} (Express detected)"
  else
    # Append to end of file as fallback
    {
      echo ""
      echo "// Health check endpoint (added by QC-02)"
      echo "$health_route"
    } >> "$file"
    echo "[QC-02] FIXED: appended /health endpoint to ${file} (Express detected, app creation line not found)"
  fi
}

inject_fastify() {
  local file="$1"
  local health_route="fastify.get('/health', async () => ({ status: 'ok' }));"

  # Find fastify instance creation
  local fastify_line
  fastify_line="$(grep -n -E "(fastify|Fastify)\s*\(" "$file" | head -1 | cut -d: -f1)"

  if [[ -n "$fastify_line" ]]; then
    sed -i '' "${fastify_line}a\\
\\
// Health check endpoint (added by QC-02)\\
${health_route}
" "$file"
    echo "[QC-02] FIXED: added /health endpoint to ${file} (Fastify detected)"
  else
    {
      echo ""
      echo "// Health check endpoint (added by QC-02)"
      echo "$health_route"
    } >> "$file"
    echo "[QC-02] FIXED: appended /health endpoint to ${file} (Fastify detected)"
  fi
}

inject_flask() {
  local file="$1"

  # Add jsonify import if missing
  if ! grep -q "from flask import" "$file" || ! grep -q "jsonify" "$file"; then
    if grep -q "from flask import" "$file"; then
      # Add jsonify to existing import
      sed -i '' 's/from flask import \(.*\)/from flask import \1, jsonify/' "$file"
    else
      sed -i '' '1s/^/from flask import jsonify\n/' "$file"
    fi
  fi

  # Find Flask app creation
  local flask_line
  flask_line="$(grep -n "Flask(__name__)" "$file" | head -1 | cut -d: -f1)"

  if [[ -n "$flask_line" ]]; then
    # Use a temp file for multi-line Python insertion (indentation matters)
    local after_line=$((flask_line + 1))
    sed -i '' "${flask_line}a\\
\\
\\
# Health check endpoint (added by QC-02)\\
@app.route('/health')\\
def health():\\
    return jsonify(status='ok')
" "$file"
    echo "[QC-02] FIXED: added /health endpoint to ${file} (Flask detected)"
  else
    {
      echo ""
      echo ""
      echo "# Health check endpoint (added by QC-02)"
      echo "@app.route('/health')"
      echo "def health():"
      echo "    return jsonify(status='ok')"
    } >> "$file"
    echo "[QC-02] FIXED: appended /health endpoint to ${file} (Flask detected)"
  fi
}

inject_fastapi() {
  local file="$1"

  # Find FastAPI app creation
  local fastapi_line
  fastapi_line="$(grep -n "FastAPI()" "$file" | head -1 | cut -d: -f1)"

  if [[ -n "$fastapi_line" ]]; then
    sed -i '' "${fastapi_line}a\\
\\
\\
# Health check endpoint (added by QC-02)\\
@app.get('/health')\\
def health():\\
    return {\"status\": \"ok\"}
" "$file"
    echo "[QC-02] FIXED: added /health endpoint to ${file} (FastAPI detected)"
  else
    {
      echo ""
      echo ""
      echo "# Health check endpoint (added by QC-02)"
      echo "@app.get('/health')"
      echo "def health():"
      echo '    return {"status": "ok"}'
    } >> "$file"
    echo "[QC-02] FIXED: appended /health endpoint to ${file} (FastAPI detected)"
  fi
}

inject_django() {
  # For Django, find urls.py and add a health path
  local urls_file=""

  # Look for urls.py in the project
  urls_file="$(find "$APP_DIR" -name "urls.py" -not -path "*/node_modules/*" -not -path "*/.git/*" | head -1)"

  if [[ -z "$urls_file" ]]; then
    echo "[QC-02] WARN: Could not find urls.py in $APP_DIR"
    echo "[QC-02] SKIP: unable to inject /health for Django"
    return
  fi

  # Add JsonResponse import if missing
  if ! grep -q "JsonResponse" "$urls_file"; then
    sed -i '' '1s/^/from django.http import JsonResponse\n/' "$urls_file"
  fi

  # Add health path to urlpatterns
  if grep -q "urlpatterns" "$urls_file"; then
    # Insert health path at beginning of urlpatterns list
    sed -i '' "/urlpatterns/a\\
    path('health/', lambda request: JsonResponse({'status': 'ok'})),
" "$urls_file"
    echo "[QC-02] FIXED: added /health endpoint to ${urls_file} (Django detected)"
  else
    {
      echo ""
      echo "# Health check endpoint (added by QC-02)"
      echo "from django.urls import path"
      echo "urlpatterns = ["
      echo "    path('health/', lambda request: JsonResponse({'status': 'ok'})),"
      echo "]"
    } >> "$urls_file"
    echo "[QC-02] FIXED: appended /health endpoint to ${urls_file} (Django detected)"
  fi
}

inject_nestjs() {
  local src_dir="$APP_DIR/src"
  if [[ ! -d "$src_dir" ]]; then
    src_dir="$APP_DIR"
  fi

  local health_controller="$src_dir/health.controller.ts"
  cat > "$health_controller" << 'NESTEOF'
import { Controller, Get } from '@nestjs/common';

// Health check endpoint (added by QC-02)
@Controller()
export class HealthController {
  @Get('/health')
  health() {
    return { status: 'ok' };
  }
}
NESTEOF

  echo "[QC-02] FIXED: created ${health_controller} with /health endpoint (NestJS detected)"

  # Try to register the controller in the main module
  local module_file
  module_file="$(find "$src_dir" -name "app.module.ts" | head -1)"
  if [[ -n "$module_file" ]]; then
    if ! grep -q "HealthController" "$module_file"; then
      sed -i '' '1s/^/import { HealthController } from ".\/health.controller";\n/' "$module_file"
      # Add to controllers array
      sed -i '' 's/controllers:\s*\[/controllers: [HealthController, /' "$module_file"
      echo "[QC-02] FIXED: registered HealthController in ${module_file}"
    fi
  fi
}

# --- Execute injection ---

case "$FRAMEWORK" in
  express)
    inject_express "$MAIN_FILE"
    ;;
  fastify)
    inject_fastify "$MAIN_FILE"
    ;;
  flask)
    inject_flask "$MAIN_FILE"
    ;;
  fastapi)
    inject_fastapi "$MAIN_FILE"
    ;;
  django)
    inject_django
    ;;
  nestjs)
    inject_nestjs
    ;;
  *)
    echo "[QC-02] WARN: unsupported framework: $FRAMEWORK"
    echo "[QC-02] SKIP: unable to inject /health endpoint"
    exit 0
    ;;
esac

exit 1
