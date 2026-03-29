#!/usr/bin/env bash
# ============================================================
# QC-20: Native Module & System Dependencies Check
# ============================================================
# Detects native Node.js modules (better-sqlite3, sharp, bcrypt,
# etc.) and Python packages that need system libraries, then
# ensures the Dockerfile installs the required build tools.
#
# For Node.js native modules on Alpine:
#   python3 make g++ (for node-gyp compilation)
# For Python imaging/PDF libs:
#   libglib2.0-0 or equivalent Alpine packages
#
# Also detects if the base image should be -slim instead of
# -alpine when native compilation is too complex for musl.
#
# Usage: check-native-deps.sh <app-directory>
# Exit 0: No native deps or already handled
# Exit 1: Dockerfile was fixed (needs rebuild)
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-native-deps.sh <app-directory>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

log_info()  { echo "[QC-20] INFO: $*"; }
log_fixed() { echo "[QC-20] FIXED: $*"; }
log_warn()  { echo "[QC-20] WARN: $*"; }

FIXES_MADE=0
DOCKERFILE="$APP_DIR/Dockerfile"

if [[ ! -f "$DOCKERFILE" ]]; then
  log_info "No Dockerfile found — skipping native deps check"
  exit 0
fi

# --- Detect stack ---
STACK=""
SERVER_DIR="$APP_DIR"
[[ -d "$APP_DIR/server" ]] && SERVER_DIR="$APP_DIR/server"
[[ -d "$APP_DIR/backend" ]] && SERVER_DIR="$APP_DIR/backend"

PKG_FILE=""
if [[ -f "$SERVER_DIR/package.json" ]]; then
  STACK="node"
  PKG_FILE="$SERVER_DIR/package.json"
elif [[ -f "$APP_DIR/package.json" ]]; then
  STACK="node"
  PKG_FILE="$APP_DIR/package.json"
elif [[ -f "$SERVER_DIR/requirements.txt" ]]; then
  STACK="python"
  PKG_FILE="$SERVER_DIR/requirements.txt"
elif [[ -f "$APP_DIR/requirements.txt" ]]; then
  STACK="python"
  PKG_FILE="$APP_DIR/requirements.txt"
fi

if [[ -z "$STACK" ]]; then
  log_info "Cannot detect stack — skipping"
  exit 0
fi

# ============================================================
# Node.js: Detect native modules
# ============================================================
if [[ "$STACK" == "node" ]]; then
  # Known modules that require node-gyp / native compilation
  NATIVE_MODS=()
  NEEDS_PYTHON_MAKE=false
  NEEDS_SLIM_IMAGE=false

  for mod in better-sqlite3 sqlite3 bcrypt sharp canvas node-sass grpc re2 leveldown farmhash argon2; do
    if grep -q "\"$mod\"" "$PKG_FILE" 2>/dev/null; then
      NATIVE_MODS+=("$mod")
    fi
  done

  # Puppeteer needs chromium - special case (LP-14)
  NEEDS_CHROMIUM=false
  if grep -q '"puppeteer"' "$PKG_FILE" 2>/dev/null; then
    NATIVE_MODS+=("puppeteer")
    NEEDS_SLIM_IMAGE=true  # Chromium doesn't work well on Alpine
    NEEDS_CHROMIUM=true
  fi

  if [[ ${#NATIVE_MODS[@]} -eq 0 ]]; then
    log_info "No native Node.js modules detected"
  else
    log_info "Native modules found: ${NATIVE_MODS[*]}"
    NEEDS_PYTHON_MAKE=true

    # Check if better-sqlite3 is present — it really needs -slim, not -alpine
    for mod in "${NATIVE_MODS[@]}"; do
      if [[ "$mod" == "better-sqlite3" || "$mod" == "sqlite3" ]]; then
        NEEDS_SLIM_IMAGE=true
        break
      fi
    done

    # --- Fix 1: Switch Alpine to Slim if needed ---
    # Only act if the PRODUCTION stage (the last FROM without " AS ") uses alpine.
    # Build stages (FROM ... AS build) can safely stay on alpine.
    if [[ "$NEEDS_SLIM_IMAGE" == "true" ]]; then
      # Find the last FROM line — that's the production stage
      LAST_FROM=$(grep '^FROM ' "$DOCKERFILE" | tail -1)
      if echo "$LAST_FROM" | grep -q 'alpine'; then
        FROM_COUNT=$(grep -c '^FROM ' "$DOCKERFILE")
        if [[ "$FROM_COUNT" -eq 1 ]]; then
          # Single-stage: switch to slim
          sed -i '' 's|FROM node:20-alpine|FROM node:20-slim|g' "$DOCKERFILE"
          log_fixed "switched base image from node:20-alpine to node:20-slim (native module: ${NATIVE_MODS[*]})"
          FIXES_MADE=$((FIXES_MADE + 1))
        else
          # Multi-stage: only switch the LAST FROM (production stage)
          python3 -c "
import re
with open('$DOCKERFILE') as f:
    content = f.read()
froms = list(re.finditer(r'^FROM node:20-alpine(.*)$', content, re.MULTILINE))
if froms:
    last = froms[-1]
    # Only replace if this is not a build stage (no 'AS' keyword)
    if ' AS ' not in last.group(0) or len(froms) == 1:
        content = content[:last.start()] + 'FROM node:20-slim' + last.group(1) + content[last.end():]
        with open('$DOCKERFILE', 'w') as f:
            f.write(content)
        print('FIXED')
    else:
        # All alpine FROMs are build stages — look for the last FROM without AS
        all_froms = list(re.finditer(r'^FROM (.*)', content, re.MULTILINE))
        for f_match in reversed(all_froms):
            line = f_match.group(0)
            if ' AS ' not in line and 'alpine' in line:
                content = content[:f_match.start()] + line.replace('alpine', 'slim') + content[f_match.end():]
                with open('$DOCKERFILE', 'w') as f:
                    f.write(content)
                print('FIXED')
                break
" 2>/dev/null && {
              log_fixed "switched production stage to node:20-slim for native modules"
              FIXES_MADE=$((FIXES_MADE + 1))
            }
        fi
      else
        log_info "Production stage already uses slim/debian — no base image change needed"
      fi

      # When switching to slim, wget is no longer available — replace with curl
      if grep -q 'wget' "$DOCKERFILE" 2>/dev/null; then
        # wget -qO- → curl -sf
        sed -i '' 's|wget -qO- \(http[^ ]*\)|curl -sf \1|g' "$DOCKERFILE"
        # wget --spider -q → curl -sf
        sed -i '' 's|wget --spider -q \(http[^ ]*\)|curl -sf \1|g' "$DOCKERFILE"
        log_fixed "replaced wget with curl in health checks (not available on slim)"
        FIXES_MADE=$((FIXES_MADE + 1))
      fi
    fi

    # --- Fix 2: Ensure build tools are installed ---
    if [[ "$NEEDS_PYTHON_MAKE" == "true" ]]; then
      # Check if the Dockerfile already has build tools
      if ! grep -qE 'python3.*make.*g\+\+|apt-get.*python3|apk.*python3' "$DOCKERFILE" 2>/dev/null; then
        # Detect if using Alpine or Debian/Slim
        if grep -q 'alpine' "$DOCKERFILE" 2>/dev/null; then
          # Alpine: use apk
          BUILD_TOOLS_CMD="RUN apk add --no-cache python3 make g++"
          # Insert after the FROM line (before npm install)
          if grep -q 'apk add' "$DOCKERFILE" 2>/dev/null; then
            # Already has an apk add — extend it
            sed -i '' 's|apk add --no-cache|apk add --no-cache python3 make g++|' "$DOCKERFILE"
          else
            # Add new RUN line after WORKDIR
            sed -i '' '/^WORKDIR \/app/a\
RUN apk add --no-cache python3 make g++' "$DOCKERFILE"
          fi
          log_fixed "added Alpine build tools (python3 make g++) for native modules"
          FIXES_MADE=$((FIXES_MADE + 1))
        else
          # Debian/Slim: use apt-get
          BUILD_TOOLS_CMD="RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*"
          if ! grep -q 'apt-get.*python3' "$DOCKERFILE" 2>/dev/null; then
            # Insert after first WORKDIR
            sed -i '' '/^WORKDIR \/app/a\
RUN apt-get update \&\& apt-get install -y --no-install-recommends python3 make g++ curl \&\& rm -rf /var/lib/apt/lists/*' "$DOCKERFILE"
            log_fixed "added Debian build tools (python3 make g++ curl) for native modules"
            FIXES_MADE=$((FIXES_MADE + 1))
          fi
        fi
      fi
    fi

    # --- Fix 3: Ensure curl is available for health checks ---
    if grep -q 'slim' "$DOCKERFILE" 2>/dev/null; then
      # Only add if curl is not already mentioned anywhere in the Dockerfile
      if ! grep -q 'curl' "$DOCKERFILE" 2>/dev/null; then
        if grep -q 'apt-get' "$DOCKERFILE" 2>/dev/null; then
          # Check if curl is already in an existing apt-get line
          if ! grep 'apt-get install' "$DOCKERFILE" | grep -q 'curl' 2>/dev/null; then
            sed -i '' 's|apt-get install -y --no-install-recommends|apt-get install -y --no-install-recommends curl|' "$DOCKERFILE"
            log_fixed "added curl for health checks in slim image"
            FIXES_MADE=$((FIXES_MADE + 1))
          fi
        else
          sed -i '' '/^WORKDIR \/app/a\
RUN apt-get update \&\& apt-get install -y --no-install-recommends curl \&\& rm -rf /var/lib/apt/lists/*' "$DOCKERFILE"
          log_fixed "added curl for health checks in slim image"
          FIXES_MADE=$((FIXES_MADE + 1))
        fi
      fi
    fi

    # --- Fix 4: Puppeteer needs Chromium + CJK fonts (LP-14) ---
    if [[ "$NEEDS_CHROMIUM" == "true" ]]; then
      if ! grep -q 'chromium' "$DOCKERFILE" 2>/dev/null; then
        if grep -q 'slim' "$DOCKERFILE" 2>/dev/null; then
          # Add a separate RUN for Chromium + fonts (keeps the layer cache cleaner)
          # Insert after the existing apt-get/build-tools RUN block
          if grep -q 'apt-get' "$DOCKERFILE" 2>/dev/null; then
            # Find the line with 'rm -rf /var/lib/apt' and add a new RUN after that whole block
            perl -i -0pe 's{(rm -rf /var/lib/apt/lists/\*)}{$1\nRUN apt-get update \&\& apt-get install -y --no-install-recommends chromium fonts-noto-cjk fonts-noto-color-emoji \&\& rm -rf /var/lib/apt/lists/*}s' "$DOCKERFILE"
          else
            # No apt-get yet — add a full RUN
            sed -i '' '/^WORKDIR \/app/a\
RUN apt-get update \&\& apt-get install -y --no-install-recommends chromium fonts-noto-cjk fonts-noto-color-emoji \&\& rm -rf /var/lib/apt/lists/*' "$DOCKERFILE"
          fi
          # Set Puppeteer to use system Chromium (skip download + set path)
          # Insert before CMD or EXPOSE, whichever comes first
          if ! grep -q 'PUPPETEER_EXECUTABLE_PATH' "$DOCKERFILE" 2>/dev/null; then
            # macOS sed requires literal newlines after \
            sed -i '' '/^EXPOSE/i\
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
' "$DOCKERFILE"
            sed -i '' '/^EXPOSE/i\
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
' "$DOCKERFILE"
          fi
          log_fixed "added Chromium + CJK fonts for Puppeteer"
          FIXES_MADE=$((FIXES_MADE + 1))
        fi
      fi
    fi
  fi
fi

# ============================================================
# Python: Detect system library requirements
# ============================================================
if [[ "$STACK" == "python" ]]; then
  NEEDS_SYS_LIBS=false
  SYS_PACKAGES=""

  # pdfplumber, Pillow need imaging libs
  if grep -qi 'pdfplumber\|Pillow\|camelot' "$PKG_FILE" 2>/dev/null; then
    NEEDS_SYS_LIBS=true
    SYS_PACKAGES="${SYS_PACKAGES} libglib2.0-0"
  fi

  # pandas with openpyxl is fine, but sometimes needs additional libs
  if grep -qi 'easyocr\|torch\|tensorflow' "$PKG_FILE" 2>/dev/null; then
    NEEDS_SYS_LIBS=true
    SYS_PACKAGES="${SYS_PACKAGES} libgl1-mesa-glx libglib2.0-0"
  fi

  if [[ "$NEEDS_SYS_LIBS" == "true" ]]; then
    if ! grep -q "libglib" "$DOCKERFILE" 2>/dev/null; then
      # Ensure system dependencies are installed
      if grep -q 'apt-get' "$DOCKERFILE" 2>/dev/null; then
        # Already has apt-get — check if our libs are included
        if ! grep -q 'libglib' "$DOCKERFILE" 2>/dev/null; then
          sed -i '' "s|apt-get install -y --no-install-recommends|apt-get install -y --no-install-recommends${SYS_PACKAGES}|" "$DOCKERFILE"
          log_fixed "added system libraries:${SYS_PACKAGES}"
          FIXES_MADE=$((FIXES_MADE + 1))
        fi
      else
        # No apt-get yet — add one
        sed -i '' "/^WORKDIR \/app/a\\
RUN apt-get update \&\& apt-get install -y --no-install-recommends curl${SYS_PACKAGES} \&\& rm -rf /var/lib/apt/lists/*" "$DOCKERFILE"
        log_fixed "added apt-get with system libraries:${SYS_PACKAGES}"
        FIXES_MADE=$((FIXES_MADE + 1))
      fi
    fi
  fi

  # --- Detect gunicorn vs uvicorn entry point ---
  # If app has wsgi.py, ensure Dockerfile uses gunicorn with wsgi:app
  if [[ -f "$SERVER_DIR/wsgi.py" || -f "$APP_DIR/wsgi.py" ]]; then
    if grep -v '^#' "$DOCKERFILE" 2>/dev/null | grep -q 'uvicorn'; then
      # Wrong: using uvicorn for a WSGI app
      log_warn "Found wsgi.py but Dockerfile uses uvicorn — should use gunicorn"
      # Detect the module:variable from wsgi.py
      wsgi_var=$(grep -oE '^(app|application)\s*=' "$APP_DIR/wsgi.py" 2>/dev/null | head -1 | cut -d= -f1 | tr -d ' ' || echo "app")
      [[ -z "$wsgi_var" ]] && wsgi_var="app"
      port=$(grep -oE 'EXPOSE [0-9]+' "$DOCKERFILE" | grep -oE '[0-9]+' || echo "5001")
      sed -i '' "s|CMD \\[\"uvicorn\".*|CMD [\"gunicorn\", \"--bind\", \"0.0.0.0:${port}\", \"--workers\", \"2\", \"--timeout\", \"120\", \"wsgi:${wsgi_var}\"]|" "$DOCKERFILE"
      log_fixed "switched from uvicorn to gunicorn wsgi:${wsgi_var}"
      FIXES_MADE=$((FIXES_MADE + 1))
    fi
    # Also check if gunicorn is in requirements.txt (check both locations)
    req_file=""
    [[ -f "$SERVER_DIR/requirements.txt" ]] && req_file="$SERVER_DIR/requirements.txt"
    [[ -z "$req_file" && -f "$APP_DIR/requirements.txt" ]] && req_file="$APP_DIR/requirements.txt"
    if [[ -n "$req_file" ]] && ! grep -qi 'gunicorn' "$req_file" 2>/dev/null; then
      echo "gunicorn" >> "$req_file"
      log_fixed "added gunicorn to requirements.txt"
      FIXES_MADE=$((FIXES_MADE + 1))
    fi
  fi
fi

# --- Result ---
if [[ "$FIXES_MADE" -gt 0 ]]; then
  echo "[QC-20] RESULT: Fixed ${FIXES_MADE} native dependency issue(s)"
  exit 1
else
  log_info "PASS: No native dependency issues found"
  exit 0
fi
