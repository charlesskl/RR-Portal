#!/usr/bin/env bash
# ============================================================
# QC-04: Dockerfile Generation Check
# ============================================================
# Ensures every app has a valid Dockerfile built from our
# templates, with all CUSTOMIZE markers replaced.
#
# Usage: check-dockerfile.sh <app-directory>
# Exit 0: Dockerfile already exists and is valid
# Exit 1: Dockerfile was generated/fixed (or error)
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-dockerfile.sh <app-directory>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEVOPS_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEMPLATE_DIR="$DEVOPS_DIR/templates"

# ---- Helpers ----

log_info()  { echo "[QC-04] INFO: $*"; }
log_fixed() { echo "[QC-04] FIXED: $*"; }
log_error() { echo "[QC-04] ERROR: $*"; }

# ---- Check for Dockerfile variants (LP-10: some devs name it Dockerfile.node) ----

if [[ ! -f "$APP_DIR/Dockerfile" ]]; then
  # Look for common naming variants
  for variant in Dockerfile.node Dockerfile.prod Dockerfile.production dockerfile; do
    if [[ -f "$APP_DIR/$variant" ]]; then
      cp "$APP_DIR/$variant" "$APP_DIR/Dockerfile"
      log_fixed "copied $variant → Dockerfile (non-standard name)"
      break
    fi
  done
fi

# ---- Validate existing Dockerfile ----

if [[ -f "$APP_DIR/Dockerfile" ]]; then
  has_from=$(grep -c '^FROM ' "$APP_DIR/Dockerfile" 2>/dev/null || true)
  has_expose=$(grep -c '^EXPOSE ' "$APP_DIR/Dockerfile" 2>/dev/null || true)

  if [[ "$has_from" -gt 0 && "$has_expose" -gt 0 ]]; then
    # Verify EXPOSE port matches app listening port
    DOCKERFILE_PORT=$(grep '^EXPOSE ' "$APP_DIR/Dockerfile" | head -1 | grep -oE '[0-9]+' || true)
    ACTUAL_PORT=""
    if [[ -f "$APP_DIR/package.json" ]]; then
      ACTUAL_PORT=$(grep -rh 'listen\s*(' "$APP_DIR"/*.js "$APP_DIR"/src/*.js 2>/dev/null \
        | grep -oE '[0-9]{4,5}' | head -1 || true)
    fi
    if [[ -n "$ACTUAL_PORT" && -n "$DOCKERFILE_PORT" && "$ACTUAL_PORT" != "$DOCKERFILE_PORT" ]]; then
      log_info "EXPOSE port ($DOCKERFILE_PORT) != app port ($ACTUAL_PORT), fixing"
      sed -i '' "s|EXPOSE ${DOCKERFILE_PORT}|EXPOSE ${ACTUAL_PORT}|" "$APP_DIR/Dockerfile"
      sed -i '' "s|localhost:${DOCKERFILE_PORT}|localhost:${ACTUAL_PORT}|" "$APP_DIR/Dockerfile"
      log_fixed "corrected EXPOSE port to $ACTUAL_PORT"
      exit 1
    fi
    # Strip any remaining CUSTOMIZE markers from template
    if grep -q '# CUSTOMIZE:' "$APP_DIR/Dockerfile" 2>/dev/null; then
      sed -i '' '/# CUSTOMIZE:/d' "$APP_DIR/Dockerfile"
      log_fixed "stripped CUSTOMIZE comment markers"
      exit 1
    fi
    log_info "Dockerfile exists and is valid"
    exit 0
  fi
  log_info "Dockerfile is malformed (missing FROM or EXPOSE), regenerating"
fi

# ---- Stack detection (including monorepo) ----

STACK=""
IS_MONOREPO=false
SERVER_SUBDIR=""

# Check monorepo structure first
if [[ -d "$APP_DIR/server" && -d "$APP_DIR/client" ]]; then
  IS_MONOREPO=true
  SERVER_SUBDIR="server"
  if [[ -f "$APP_DIR/server/package.json" ]]; then
    STACK="node"
  elif [[ -f "$APP_DIR/server/requirements.txt" || -f "$APP_DIR/server/pyproject.toml" ]]; then
    STACK="python"
  fi
elif [[ -d "$APP_DIR/backend" && -d "$APP_DIR/frontend" ]]; then
  IS_MONOREPO=true
  SERVER_SUBDIR="backend"
  if [[ -f "$APP_DIR/backend/package.json" ]]; then
    STACK="node"
  elif [[ -f "$APP_DIR/backend/requirements.txt" || -f "$APP_DIR/backend/pyproject.toml" ]]; then
    STACK="python"
  fi
fi

# Fallback to simple app detection
if [[ -z "$STACK" ]]; then
  if [[ -f "$APP_DIR/package.json" ]]; then
    STACK="node"
  elif [[ -f "$APP_DIR/requirements.txt" || -f "$APP_DIR/pyproject.toml" ]]; then
    STACK="python"
  else
    log_error "cannot detect stack (no package.json, requirements.txt, or pyproject.toml)"
    exit 1
  fi
fi

log_info "Stack: $STACK, Monorepo: $IS_MONOREPO"

# ---- Copy template ----

if [[ "$IS_MONOREPO" == "true" && "$STACK" == "node" ]]; then
  TEMPLATE="$TEMPLATE_DIR/Dockerfile.node-monorepo"
elif [[ "$STACK" == "node" ]]; then
  TEMPLATE="$TEMPLATE_DIR/Dockerfile.node"
else
  TEMPLATE="$TEMPLATE_DIR/Dockerfile.python"
fi

if [[ ! -f "$TEMPLATE" ]]; then
  log_error "template not found: $TEMPLATE"
  exit 1
fi

cp "$TEMPLATE" "$APP_DIR/Dockerfile"

# ---- Customize Monorepo Dockerfile ----

if [[ "$IS_MONOREPO" == "true" && "$STACK" == "node" ]]; then
  PKG_DIR="$APP_DIR/$SERVER_SUBDIR"
  CLIENT_DIR="$APP_DIR/client"
  [[ -d "$APP_DIR/frontend" ]] && CLIENT_DIR="$APP_DIR/frontend"
  CLIENT_SUBDIR="$(basename "$CLIENT_DIR")"

  # Detect server entry point
  ENTRY="app.js"
  if [[ -f "$PKG_DIR/package.json" ]]; then
    entry_from_pkg=$(python3 -c "
import json, re
try:
    d = json.load(open('$PKG_DIR/package.json'))
    m = d.get('main', '')
    if m:
        print(m)
    else:
        s = d.get('scripts', {}).get('start', '')
        match = re.search(r'node\s+(\S+\.js)', s)
        if match: print(match.group(1))
except: pass
" 2>/dev/null || true)
    [[ -n "$entry_from_pkg" ]] && ENTRY="$entry_from_pkg"
  fi

  # Detect port from server code
  PORT="3000"
  port_from_src=$(grep -rh 'listen\s*(' "$PKG_DIR"/*.js 2>/dev/null \
    | grep -oE '[0-9]{4,5}' | head -1 || true)
  [[ -n "$port_from_src" ]] && PORT="$port_from_src"

  # Also check for process.env.PORT with default
  port_from_env=$(grep -rhoE 'PORT\s*\|\|\s*[0-9]+' "$PKG_DIR"/*.js 2>/dev/null \
    | grep -oE '[0-9]+' | tail -1 || true)
  [[ -n "$port_from_env" ]] && PORT="$port_from_env"

  # Customize the monorepo Dockerfile
  # Fix client/server directory names
  if [[ "$CLIENT_SUBDIR" != "client" ]]; then
    sed -i '' "s|COPY client/|COPY ${CLIENT_SUBDIR}/|g" "$APP_DIR/Dockerfile"
  fi
  if [[ "$SERVER_SUBDIR" != "server" ]]; then
    sed -i '' "s|COPY server/|COPY ${SERVER_SUBDIR}/|g" "$APP_DIR/Dockerfile"
  fi

  # Set port
  sed -i '' "s|ENV PORT=3000|ENV PORT=$PORT|" "$APP_DIR/Dockerfile"
  sed -i '' "s|EXPOSE 3000|EXPOSE $PORT|" "$APP_DIR/Dockerfile"
  sed -i '' "s|localhost:3000|localhost:$PORT|g" "$APP_DIR/Dockerfile"

  # --- Detect startup scripts that must run before the main entry ---
  STARTUP_CMD=""
  for script in "scripts/seed-users.js" "scripts/seed.js" "scripts/init.js" "seed.js" "seed-users.js"; do
    if [[ -f "$PKG_DIR/$script" ]]; then
      STARTUP_CMD="node $script && "
      log_info "Found startup script: $script"
      break
    fi
  done

  # Set entry point (with or without startup script)
  # Use python to safely replace the CMD line (avoids sed quoting issues)
  python3 -c "
import re
with open('$APP_DIR/Dockerfile') as f:
    content = f.read()
startup = '$STARTUP_CMD'
entry = '$ENTRY'
if startup:
    new_cmd = 'CMD [\"sh\", \"-c\", \"' + startup + 'node ' + entry + '\"]'
else:
    new_cmd = 'CMD [\"node\", \"' + entry + '\"]'
content = re.sub(r'CMD \[\"node\", \"app\.js\"\]', new_cmd, content)
with open('$APP_DIR/Dockerfile', 'w') as f:
    f.write(content)
" 2>/dev/null || true

  # --- Detect where the server expects to find client dist ---
  # Some apps serve from ../client/dist (in-place), others from ./client-dist (copied)
  CLIENT_DIST_PATH=""
  client_ref=$(grep -rhoE "client[/-]dist|client/dist|\.\./(client|frontend)/dist" "$PKG_DIR"/*.js 2>/dev/null | head -1 || true)
  if echo "$client_ref" | grep -q '\.\./client/dist\|path.*client.*dist'; then
    # App references ../client/dist — it expects the dist in the original client/ location
    CLIENT_DIST_PATH="/app/client/dist"
    log_info "Server expects client dist at: ../client/dist"
  fi
  if [[ -n "$CLIENT_DIST_PATH" ]]; then
    sed -i '' "s|COPY --from=client-build /build/dist /app/client-dist|COPY --from=client-build /build/dist ${CLIENT_DIST_PATH}|" "$APP_DIR/Dockerfile"
  fi

  # Detect Vite output directory
  if [[ -f "$CLIENT_DIR/vite.config.js" || -f "$CLIENT_DIR/vite.config.ts" ]]; then
    build_outdir=$(grep -oE "outDir\s*:\s*['\"][^'\"]*['\"]" "$CLIENT_DIR"/vite.config.* 2>/dev/null \
      | head -1 | grep -oE "'[^']*'" | tr -d "'" || echo "dist")
    [[ -z "$build_outdir" ]] && build_outdir="dist"
    if [[ "$build_outdir" != "dist" ]]; then
      sed -i '' "s|/build/dist|/build/${build_outdir}|" "$APP_DIR/Dockerfile"
    fi
  fi

  # Generate .dockerignore for monorepo
  cat > "$APP_DIR/.dockerignore" << 'DOCKERIGNORE'
**/node_modules
.git
.env
*.md
.vscode
.idea
client/node_modules
server/node_modules
DOCKERIGNORE

  log_fixed "generated monorepo Dockerfile (entry: $ENTRY, port: $PORT, client: $CLIENT_SUBDIR, server: $SERVER_SUBDIR)"
  # Strip CUSTOMIZE markers
  sed -i '' '/# CUSTOMIZE:/d' "$APP_DIR/Dockerfile"
  exit 1
fi

# ---- Customize Node.js Dockerfile (simple app) ----

if [[ "$STACK" == "node" ]]; then
  # --- Entry point detection ---
  ENTRY="index.js"

  if [[ -f "$APP_DIR/package.json" ]]; then
    # Try "main" field
    main_field=$(python3 -c "
import json, sys
try:
    d = json.load(open('$APP_DIR/package.json'))
    v = d.get('main', '')
    if v: print(v)
except: pass
" 2>/dev/null || true)

    if [[ -n "$main_field" ]]; then
      ENTRY="$main_field"
    fi

    # Try scripts.start — extract filename from "node xxx.js"
    start_script=$(python3 -c "
import json, re, sys
try:
    d = json.load(open('$APP_DIR/package.json'))
    s = d.get('scripts', {}).get('start', '')
    m = re.search(r'node\s+(\S+\.js)', s)
    if m: print(m.group(1))
except: pass
" 2>/dev/null || true)

    if [[ -n "$start_script" ]]; then
      ENTRY="$start_script"
    fi
  fi

  # Replace CMD entry point
  sed -i '' "s|CMD \\[\"node\", \"index.js\"\\]|CMD [\"node\", \"$ENTRY\"]|" "$APP_DIR/Dockerfile"

  # --- Build step ---
  has_build=$(python3 -c "
import json
try:
    d = json.load(open('$APP_DIR/package.json'))
    if 'build' in d.get('scripts', {}): print('yes')
except: pass
" 2>/dev/null || true)

  if [[ "$has_build" == "yes" ]]; then
    # Uncomment the build line
    sed -i '' 's|^# RUN npm run build|RUN npm run build|' "$APP_DIR/Dockerfile"
  fi

  # --- Port detection ---
  PORT="3000"

  # Check package.json scripts for port references
  port_from_pkg=$(python3 -c "
import json, re
try:
    d = json.load(open('$APP_DIR/package.json'))
    scripts = ' '.join(d.get('scripts', {}).values())
    m = re.search(r'(?:PORT|port)[=:\s]+(\d{4,5})', scripts)
    if m: print(m.group(1))
except: pass
" 2>/dev/null || true)

  if [[ -n "$port_from_pkg" ]]; then
    PORT="$port_from_pkg"
  fi

  # Check source files for listen(PORT)
  if [[ "$PORT" == "3000" ]]; then
    port_from_src=$(grep -rh 'listen\s*(' "$APP_DIR"/*.js "$APP_DIR"/src/*.js 2>/dev/null \
      | grep -oE 'listen\s*\([^)]*[0-9]{4,5}' \
      | head -1 \
      | grep -oE '[0-9]{4,5}' || true)
    if [[ -n "$port_from_src" ]]; then
      PORT="$port_from_src"
    fi
  fi

  # Replace all port references (EXPOSE, HEALTHCHECK)
  if [[ "$PORT" != "3000" ]]; then
    sed -i '' "s|EXPOSE 3000|EXPOSE $PORT|" "$APP_DIR/Dockerfile"
    sed -i '' "s|localhost:3000|localhost:$PORT|" "$APP_DIR/Dockerfile"
  fi

  # --- Lock file handling ---
  if [[ -f "$APP_DIR/yarn.lock" ]]; then
    sed -i '' 's|COPY package.json package-lock.json ./|COPY package.json yarn.lock ./|' "$APP_DIR/Dockerfile"
    sed -i '' 's|RUN npm ci --ignore-scripts|RUN yarn install --frozen-lockfile|' "$APP_DIR/Dockerfile"
  elif [[ ! -f "$APP_DIR/package-lock.json" ]]; then
    # No lock file — just copy package.json
    sed -i '' 's|COPY package.json package-lock.json ./|COPY package.json ./|' "$APP_DIR/Dockerfile"
    sed -i '' 's|RUN npm ci --ignore-scripts|RUN npm install|' "$APP_DIR/Dockerfile"
  fi
  # If package-lock.json exists, keep the default (already correct)

  # --- Generate .dockerignore ---
  cat > "$APP_DIR/.dockerignore" << 'DOCKERIGNORE'
node_modules
.git
.env
*.md
.vscode
.idea
coverage
dist
.next
DOCKERIGNORE

  log_fixed "generated Dockerfile from node template (entry: $ENTRY, port: $PORT)"
fi

# ---- Customize Python Dockerfile ----

if [[ "$STACK" == "python" ]]; then
  # --- Requirements file ---
  if [[ -f "$APP_DIR/pyproject.toml" && ! -f "$APP_DIR/requirements.txt" ]]; then
    sed -i '' 's|COPY requirements.txt ./|COPY pyproject.toml ./|' "$APP_DIR/Dockerfile"
    sed -i '' 's|RUN pip install --no-cache-dir -r requirements.txt gunicorn|RUN pip install --no-cache-dir . gunicorn|' "$APP_DIR/Dockerfile"
  fi

  # --- System library detection ---
  SYS_LIBS=""
  REQ_FILE="$APP_DIR/requirements.txt"
  [[ ! -f "$REQ_FILE" ]] && REQ_FILE="$APP_DIR/pyproject.toml"
  if [[ -f "$REQ_FILE" ]]; then
    if grep -qi 'pdfplumber\|Pillow\|camelot\|reportlab' "$REQ_FILE" 2>/dev/null; then
      SYS_LIBS="${SYS_LIBS} libglib2.0-0"
    fi
    if grep -qi 'opencv\|easyocr' "$REQ_FILE" 2>/dev/null; then
      SYS_LIBS="${SYS_LIBS} libgl1-mesa-glx libglib2.0-0"
    fi
  fi
  if [[ -n "$SYS_LIBS" ]]; then
    # Insert system libs into the apt-get install line (not in comments)
    if ! grep -v '^#' "$APP_DIR/Dockerfile" | grep -q 'libglib' 2>/dev/null; then
      # Insert system libs line after '    curl \' using perl (macOS sed can't do multiline)
      perl -i -pe "s{^(    curl \\\\)\$}{\$1\n    ${SYS_LIBS} \\\\}" "$APP_DIR/Dockerfile"
      log_fixed "added system libraries:${SYS_LIBS}"
    fi
  fi

  # --- Entry point detection ---
  MODULE="app"
  VARIABLE="app"
  USE_UVICORN=false
  USE_WSGI=false

  # Priority 1: Check for wsgi.py (WSGI entry point — use gunicorn)
  if [[ -f "$APP_DIR/wsgi.py" ]]; then
    MODULE="wsgi"
    VARIABLE="app"
    USE_WSGI=true
    # Try to detect the variable name in wsgi.py
    wsgi_var=$(grep -oE '^(app|application)\s*=' "$APP_DIR/wsgi.py" 2>/dev/null | head -1 | cut -d= -f1 | tr -d ' ' || true)
    [[ -n "$wsgi_var" ]] && VARIABLE="$wsgi_var"
    log_info "Found wsgi.py — using gunicorn with $MODULE:$VARIABLE"
  fi

  # Priority 2: Search Python source files for app variable (skip if wsgi.py found)
  if [[ "$USE_WSGI" == "false" ]]; then
    for pyfile in "$APP_DIR"/*.py "$APP_DIR"/src/*.py; do
      [[ -f "$pyfile" ]] || continue
      basename_no_ext=$(basename "$pyfile" .py)

      # FastAPI detection
      if grep -q 'FastAPI()' "$pyfile" 2>/dev/null; then
        var=$(grep -oE '^([a-zA-Z_]+)\s*=\s*FastAPI\(' "$pyfile" | head -1 | cut -d= -f1 | tr -d ' ')
        if [[ -n "$var" ]]; then
          MODULE="$basename_no_ext"
          VARIABLE="$var"
          USE_UVICORN=true
          break
        fi
      fi

      # Flask detection
      if grep -q 'Flask(' "$pyfile" 2>/dev/null; then
        var=$(grep -oE '^([a-zA-Z_]+)\s*=\s*Flask\(' "$pyfile" | head -1 | cut -d= -f1 | tr -d ' ')
        if [[ -n "$var" ]]; then
          MODULE="$basename_no_ext"
          VARIABLE="$var"
          break
        fi
      fi

      # Generic "application = " detection (WSGI)
      if grep -qE '^application\s*=' "$pyfile" 2>/dev/null; then
        MODULE="$basename_no_ext"
        VARIABLE="application"
        break
      fi
    done
  fi

  # --- Port detection ---
  PORT="3000"

  port_from_src=$(grep -rhE '(\.run\(|listen\s*\()' "$APP_DIR"/*.py "$APP_DIR"/src/*.py 2>/dev/null \
    | grep -oE 'port\s*=\s*([0-9]{4,5})' \
    | head -1 \
    | grep -oE '[0-9]{4,5}' || true)
  if [[ -n "$port_from_src" ]]; then
    PORT="$port_from_src"
  fi

  # Replace port references
  if [[ "$PORT" != "3000" ]]; then
    sed -i '' "s|EXPOSE 3000|EXPOSE $PORT|" "$APP_DIR/Dockerfile"
    sed -i '' "s|localhost:3000|localhost:$PORT|g" "$APP_DIR/Dockerfile"
    sed -i '' "s|0.0.0.0:3000|0.0.0.0:$PORT|g" "$APP_DIR/Dockerfile"
  fi

  # Replace CMD based on framework
  if [[ "$USE_UVICORN" == true ]]; then
    sed -i '' "s|CMD \\[\"gunicorn\".*|CMD [\"uvicorn\", \"$MODULE:$VARIABLE\", \"--host\", \"0.0.0.0\", \"--port\", \"$PORT\"]|" "$APP_DIR/Dockerfile"
  elif [[ "$USE_WSGI" == true ]]; then
    # WSGI app: use gunicorn with extended timeout for file upload apps
    sed -i '' "s|CMD \\[\"gunicorn\".*|CMD [\"gunicorn\", \"--bind\", \"0.0.0.0:$PORT\", \"--workers\", \"2\", \"--timeout\", \"120\", \"$MODULE:$VARIABLE\"]|" "$APP_DIR/Dockerfile"
  else
    sed -i '' "s|\"app:app\"|\"$MODULE:$VARIABLE\"|" "$APP_DIR/Dockerfile"
  fi

  # Ensure gunicorn is in requirements.txt (needed for production)
  req_file=""
  [[ -f "$APP_DIR/requirements.txt" ]] && req_file="$APP_DIR/requirements.txt"
  if [[ -n "$req_file" ]] && ! grep -qi 'gunicorn' "$req_file" 2>/dev/null; then
    echo "gunicorn" >> "$req_file"
    log_fixed "added gunicorn to requirements.txt"
  fi

  # --- Generate .dockerignore ---
  cat > "$APP_DIR/.dockerignore" << 'DOCKERIGNORE'
__pycache__
.git
.env
*.md
.vscode
.idea
.venv
venv
*.pyc
DOCKERIGNORE

  log_fixed "generated Dockerfile from python template (module: $MODULE:$VARIABLE, port: $PORT)"
fi

# Strip any remaining CUSTOMIZE markers after generation
if [[ -f "$APP_DIR/Dockerfile" ]]; then
  sed -i '' '/# CUSTOMIZE:/d' "$APP_DIR/Dockerfile"
fi

exit 1
