#!/usr/bin/env bash
# ============================================================
# Stack Detection Utility — Shared across QC checks and onboard
# ============================================================
# Detects stack, framework, entry point, and directory structure
# for both simple apps and monorepo apps (server/ + client/).
#
# Usage: source this file, then call detect_app_stack <app-dir>
# Sets: STACK, FRAMEWORK, ENTRYPOINT, SERVER_DIR, CLIENT_DIR, IS_MONOREPO
# ============================================================

detect_app_stack() {
  local app_dir="${1:?Usage: detect_app_stack <app-directory>}"

  # Reset all vars
  STACK="unknown"
  FRAMEWORK="unknown"
  ENTRYPOINT=""
  SERVER_DIR=""
  CLIENT_DIR=""
  IS_MONOREPO=false
  HAS_NATIVE_MODULES=false
  NATIVE_MODULES_LIST=""
  STARTUP_SCRIPTS=""
  WSGI_ENTRY=""
  NEEDS_BUILD_TOOLS=false
  DATA_DIRS=""
  UPLOAD_DIRS=""
  CRITICAL_SEED_FILES=""

  # --- Detect monorepo structure ---
  if [[ -d "$app_dir/server" && -d "$app_dir/client" ]]; then
    IS_MONOREPO=true
    SERVER_DIR="$app_dir/server"
    CLIENT_DIR="$app_dir/client"
  elif [[ -d "$app_dir/backend" && -d "$app_dir/frontend" ]]; then
    IS_MONOREPO=true
    SERVER_DIR="$app_dir/backend"
    CLIENT_DIR="$app_dir/frontend"
  elif [[ -d "$app_dir/server" ]]; then
    IS_MONOREPO=true
    SERVER_DIR="$app_dir/server"
    # Client might be at root or in a subdir
    if [[ -d "$app_dir/client" ]]; then
      CLIENT_DIR="$app_dir/client"
    elif [[ -d "$app_dir/frontend" ]]; then
      CLIENT_DIR="$app_dir/frontend"
    fi
  fi

  # --- Detect stack from server directory or root ---
  local pkg_dir="$app_dir"
  if [[ "$IS_MONOREPO" == "true" && -n "$SERVER_DIR" && -f "$SERVER_DIR/package.json" ]]; then
    pkg_dir="$SERVER_DIR"
  fi

  if [[ -f "$pkg_dir/package.json" ]]; then
    STACK="node"

    # Detect framework
    local pkg_content
    pkg_content="$(cat "$pkg_dir/package.json")"
    if echo "$pkg_content" | grep -q '"express"'; then
      FRAMEWORK="Express"
    elif echo "$pkg_content" | grep -q '"fastify"'; then
      FRAMEWORK="Fastify"
    elif echo "$pkg_content" | grep -q '"@nestjs/core"'; then
      FRAMEWORK="NestJS"
    elif echo "$pkg_content" | grep -q '"koa"'; then
      FRAMEWORK="Koa"
    elif echo "$pkg_content" | grep -q '"hapi"'; then
      FRAMEWORK="Hapi"
    elif echo "$pkg_content" | grep -q '"next"'; then
      FRAMEWORK="Next.js"
    fi

    # Detect entry point
    ENTRYPOINT=$(python3 -c "
import json, re
pkg = json.load(open('${pkg_dir}/package.json'))
main = pkg.get('main', '')
if main:
    print(main)
else:
    start = pkg.get('scripts', {}).get('start', '')
    if start:
        m = re.search(r'node\s+(\S+\.(?:js|ts|mjs))', start)
        if m:
            print(m.group(1))
        else:
            parts = start.split()
            print(parts[-1] if parts else 'index.js')
    else:
        print('index.js')
" 2>/dev/null || echo "index.js")

  elif [[ -f "$pkg_dir/requirements.txt" || -f "$pkg_dir/pyproject.toml" ]]; then
    STACK="python"

    # Detect framework
    local req_file=""
    [[ -f "$pkg_dir/requirements.txt" ]] && req_file="$pkg_dir/requirements.txt"
    [[ -f "$pkg_dir/pyproject.toml" ]] && req_file="$pkg_dir/pyproject.toml"

    if [[ -n "$req_file" ]]; then
      if grep -qi 'fastapi' "$req_file"; then
        FRAMEWORK="FastAPI"
      elif grep -qi 'flask' "$req_file"; then
        FRAMEWORK="Flask"
      elif grep -qi 'django' "$req_file"; then
        FRAMEWORK="Django"
      fi
    fi

    # Detect entry point
    for candidate in app.py main.py wsgi.py manage.py; do
      if [[ -f "$pkg_dir/$candidate" ]]; then
        ENTRYPOINT="$candidate"
        break
      fi
    done
    [[ -z "$ENTRYPOINT" ]] && ENTRYPOINT="app.py"
  fi

  # --- Set SERVER_DIR for non-monorepo apps ---
  if [[ "$IS_MONOREPO" == "false" ]]; then
    SERVER_DIR="$app_dir"
  fi

  # --- Detect CLIENT_DIR for non-monorepo apps with frontend ---
  if [[ -z "$CLIENT_DIR" ]]; then
    for subdir in client frontend; do
      if [[ -d "$app_dir/$subdir" ]]; then
        CLIENT_DIR="$app_dir/$subdir"
        break
      fi
    done
  fi

  # --- Detect native Node.js modules requiring build tools ---
  if [[ "$STACK" == "node" ]]; then
    local pkg_file="$pkg_dir/package.json"
    if [[ -f "$pkg_file" ]]; then
      # Known native modules that need python3/make/g++ to compile
      local native_mods=("better-sqlite3" "sqlite3" "bcrypt" "sharp" "canvas" "node-gyp" "grpc" "node-sass" "puppeteer" "re2" "leveldown" "farmhash" "argon2")
      for mod in "${native_mods[@]}"; do
        if grep -q "\"$mod\"" "$pkg_file" 2>/dev/null; then
          HAS_NATIVE_MODULES=true
          NATIVE_MODULES_LIST="${NATIVE_MODULES_LIST:+$NATIVE_MODULES_LIST,}$mod"
        fi
      done
      # Also check for node-gyp in scripts (build/install hooks)
      if grep -q "node-gyp" "$pkg_file" 2>/dev/null; then
        HAS_NATIVE_MODULES=true
      fi
    fi
    if [[ "$HAS_NATIVE_MODULES" == "true" ]]; then
      NEEDS_BUILD_TOOLS=true
    fi
  fi

  # --- Detect Python system dependencies ---
  if [[ "$STACK" == "python" ]]; then
    local req_file="$pkg_dir/requirements.txt"
    if [[ -f "$req_file" ]]; then
      # Packages needing system libs
      if grep -qi 'easyocr\|torch\|tensorflow\|opencv' "$req_file" 2>/dev/null; then
        NEEDS_BUILD_TOOLS=true
      fi
      if grep -qi 'Pillow\|pdfplumber\|camelot' "$req_file" 2>/dev/null; then
        # These need libglib, etc.
        NEEDS_BUILD_TOOLS=true
      fi
    fi
  fi

  # --- Detect startup scripts (scripts that run before main entry) ---
  local search_dir="${SERVER_DIR:-$app_dir}"
  # Check Dockerfile CMD for chained commands (sh -c "script && main")
  if [[ -f "$app_dir/Dockerfile" ]]; then
    local cmd_line
    cmd_line=$(grep -E '^CMD ' "$app_dir/Dockerfile" | tail -1)
    if echo "$cmd_line" | grep -qE 'sh -c.*&&'; then
      # Extract pre-start scripts from "sh -c "node seed.js && node app.js""
      STARTUP_SCRIPTS=$(echo "$cmd_line" | grep -oE 'node [^ &]+' | head -n -1 | sed 's/node //' || true)
    fi
  fi
  # Check for seed-users.js, init.js, setup.js patterns
  for script in "scripts/seed-users.js" "scripts/seed.js" "scripts/init.js" "seed-users.js" "seed.js" "init-db.js"; do
    if [[ -f "$search_dir/$script" ]]; then
      STARTUP_SCRIPTS="${STARTUP_SCRIPTS:+$STARTUP_SCRIPTS,}$script"
    fi
  done

  # --- Detect WSGI entry for Python apps ---
  if [[ "$STACK" == "python" ]]; then
    if [[ -f "$pkg_dir/wsgi.py" ]]; then
      WSGI_ENTRY="wsgi:app"
    fi
  fi

  # --- Detect data and upload directories from source code ---
  if [[ "$STACK" == "node" ]]; then
    # Scan for directory references in code
    local code_dirs
    code_dirs=$(grep -rhoE "(DATA_PATH|__dirname.*data|/app/data|./data)" "$search_dir" \
      --include='*.js' --include='*.ts' 2>/dev/null | sort -u || true)
    if [[ -n "$code_dirs" ]]; then
      DATA_DIRS="data"
    fi
    # Detect upload directories
    if grep -rq "uploads\|upload\|multer" "$search_dir" --include='*.js' --include='*.ts' 2>/dev/null; then
      # Check specific upload paths from code
      if grep -rq "public/uploads" "$search_dir" --include='*.js' --include='*.ts' 2>/dev/null; then
        UPLOAD_DIRS="public/uploads"
      elif grep -rq "/uploads" "$search_dir" --include='*.js' --include='*.ts' 2>/dev/null; then
        UPLOAD_DIRS="uploads"
      fi
    fi
  elif [[ "$STACK" == "python" ]]; then
    if grep -rq "DATA_PATH\|data\.db\|data\.json\|/app/data" "$search_dir" --include='*.py' 2>/dev/null; then
      DATA_DIRS="data"
    fi
    if grep -rq "UPLOAD_FOLDER\|/uploads\|multer" "$search_dir" --include='*.py' 2>/dev/null; then
      UPLOAD_DIRS="uploads"
    fi
  fi

  # --- Detect critical seed files that MUST exist for app to function ---
  for seed_file in "data/default-material-prices.json" "data/data.json" "data/molds.json" "data/machines.json"; do
    if [[ -f "$search_dir/$seed_file" ]]; then
      CRITICAL_SEED_FILES="${CRITICAL_SEED_FILES:+$CRITICAL_SEED_FILES,}$seed_file"
    fi
  done
  # Also check if code references specific data files at startup
  if grep -rq "default-material-prices" "$search_dir" --include='*.js' --include='*.py' 2>/dev/null; then
    if [[ -f "$search_dir/data/default-material-prices.json" ]]; then
      CRITICAL_SEED_FILES="${CRITICAL_SEED_FILES:+$CRITICAL_SEED_FILES,}data/default-material-prices.json"
    fi
  fi
}

# Get the server entry file (full path)
get_server_entry() {
  local app_dir="${1:?}"
  if [[ -n "$SERVER_DIR" && -f "$SERVER_DIR/$ENTRYPOINT" ]]; then
    echo "$SERVER_DIR/$ENTRYPOINT"
  elif [[ -f "$app_dir/$ENTRYPOINT" ]]; then
    echo "$app_dir/$ENTRYPOINT"
  fi
}

# Get all server source files (excluding node_modules, etc.)
get_server_source_files() {
  local search_dir="${SERVER_DIR:-$1}"
  find "$search_dir" -type f \( -name "*.js" -o -name "*.ts" -o -name "*.mjs" -o -name "*.cjs" -o -name "*.py" \) \
    | grep -vE "node_modules|__pycache__|\.git|dist|build|coverage" || true
}

# Get all frontend source files
get_frontend_source_files() {
  local search_dir="${CLIENT_DIR:-}"
  [[ -z "$search_dir" || ! -d "$search_dir" ]] && return
  find "$search_dir" -type f \( -name "*.jsx" -o -name "*.tsx" -o -name "*.js" -o -name "*.ts" -o -name "*.vue" \) \
    | grep -vE "node_modules|dist|build|\.git|\.next|\.nuxt|coverage" || true
}
