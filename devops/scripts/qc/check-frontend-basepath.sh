#!/usr/bin/env bash
# ============================================================
# QC-19: Frontend Build-Time Base Path Check
# ============================================================
# Ensures that frontend apps built inside Docker get the correct
# sub-path base injected at BUILD TIME (not just in config files).
#
# Problem: Vite/Webpack/CRA bake asset paths into the JS bundle
# at build time. If the Dockerfile doesn't accept BASE_PATH as
# a build arg, the frontend serves from '/' and all assets 404
# when accessed through nginx at /<app-name>/.
#
# This check:
# 1. Detects if app has a frontend build step in Dockerfile
# 2. Checks if Dockerfile accepts BASE_PATH or VITE_BASE_PATH arg
# 3. Injects the ARG if missing
# 4. Ensures vite.config uses the env var (not hardcoded path)
#
# Usage: check-frontend-basepath.sh <app-directory>
# Exit 0: No frontend build, or already configured
# Exit 1: Issues found and fixed
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-frontend-basepath.sh <app-directory>}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[QC-19] ERROR: Directory not found: $APP_DIR"
  exit 1
fi

APP_NAME="$(basename "$APP_DIR")"
FIXES_MADE=0

echo "[QC-19] Checking frontend build-time base path for: $APP_DIR"

DOCKERFILE="${APP_DIR}/Dockerfile"
if [[ ! -f "$DOCKERFILE" ]]; then
  echo "[QC-19] PASS: No Dockerfile — check-dockerfile.sh will generate one"
  exit 0
fi

# --- Detect if Dockerfile has a frontend build step ---
HAS_FRONTEND_BUILD=false

# Vite build
if grep -qE "vite build|npx vite build|npm run build" "$DOCKERFILE"; then
  HAS_FRONTEND_BUILD=true
fi
# Webpack build
if grep -qE "webpack|npm run build:client" "$DOCKERFILE"; then
  HAS_FRONTEND_BUILD=true
fi
# Next.js build
if grep -qE "next build" "$DOCKERFILE"; then
  HAS_FRONTEND_BUILD=true
fi
# CRA build
if grep -qE "react-scripts build" "$DOCKERFILE"; then
  HAS_FRONTEND_BUILD=true
fi
# Generic npm run build with frontend detected
if grep -qE "npm run build" "$DOCKERFILE"; then
  # Check if there's a frontend (vite.config, webpack.config, etc.)
  FRONTEND_ROOT="$APP_DIR"
  [[ -d "$APP_DIR/client" ]] && FRONTEND_ROOT="$APP_DIR/client"
  if ls "$FRONTEND_ROOT"/vite.config.* "$FRONTEND_ROOT"/webpack.config.* "$FRONTEND_ROOT"/next.config.* 2>/dev/null | head -1 | grep -q .; then
    HAS_FRONTEND_BUILD=true
  fi
fi

if [[ "$HAS_FRONTEND_BUILD" != "true" ]]; then
  echo "[QC-19] PASS: No frontend build step detected in Dockerfile"
  exit 0
fi

echo "[QC-19] Frontend build detected in Dockerfile"

# --- Check if Dockerfile accepts BASE_PATH build arg ---
HAS_BASE_ARG=false
if grep -qE "^ARG (BASE_PATH|VITE_BASE_PATH)" "$DOCKERFILE"; then
  HAS_BASE_ARG=true
  echo "[QC-19] PASS: Dockerfile already accepts BASE_PATH arg"
fi

if [[ "$HAS_BASE_ARG" != "true" ]]; then
  echo "[QC-19] WARN: Dockerfile has frontend build but no BASE_PATH arg"

  # Detect which bundler to determine the env var name
  FRONTEND_ROOT="$APP_DIR"
  [[ -d "$APP_DIR/client" ]] && FRONTEND_ROOT="$APP_DIR/client"

  if ls "$FRONTEND_ROOT"/vite.config.* 2>/dev/null | head -1 | grep -q .; then
    # Vite: uses VITE_BASE_PATH or --base flag
    # Find the RUN line with vite build
    BUILD_LINE=$(grep -n "vite build\|npm run build" "$DOCKERFILE" | head -1 | cut -d: -f1)
    if [[ -n "$BUILD_LINE" ]]; then
      # Insert ARG before the build command, and ENV to make it available
      # Find a good insertion point (after the last COPY before build)
      LAST_COPY=$(grep -n "^COPY" "$DOCKERFILE" | tail -1 | cut -d: -f1)
      INSERT_AT=${LAST_COPY:-1}

      # Use sed to insert after the COPY line
      sed -i '' "${INSERT_AT}a\\
\\
# Sub-path base for nginx reverse proxy (injected by QC-19)\\
ARG BASE_PATH=/${APP_NAME}/\\
ENV VITE_BASE_PATH=\${BASE_PATH}
" "$DOCKERFILE" 2>/dev/null || \
      sed -i "${INSERT_AT}a\\
\\
# Sub-path base for nginx reverse proxy (injected by QC-19)\\
ARG BASE_PATH=/${APP_NAME}/\\
ENV VITE_BASE_PATH=\${BASE_PATH}
" "$DOCKERFILE"

      # If vite build doesn't use --base flag, add it
      if ! grep -qE "vite build.*--base" "$DOCKERFILE"; then
        sed -i '' "s|npx vite build|npx vite build --base \${BASE_PATH}|" "$DOCKERFILE" 2>/dev/null || \
        sed -i "s|npx vite build|npx vite build --base \${BASE_PATH}|" "$DOCKERFILE"
        # Also try the npm run build pattern — can't easily modify, so just note
      fi

      echo "[QC-19] FIXED: Added BASE_PATH/VITE_BASE_PATH build args to Dockerfile"
      FIXES_MADE=$((FIXES_MADE + 1))
    fi

  elif ls "$FRONTEND_ROOT"/next.config.* 2>/dev/null | head -1 | grep -q .; then
    # Next.js: uses basePath in next.config.js (handled by QC-08)
    echo "[QC-19] INFO: Next.js detected — basePath handled by QC-08 (check-api-basepath.sh)"

  elif grep -q "react-scripts" "$FRONTEND_ROOT/package.json" 2>/dev/null; then
    # CRA: uses PUBLIC_URL env var and homepage in package.json
    BUILD_LINE=$(grep -n "react-scripts build\|npm run build" "$DOCKERFILE" | head -1 | cut -d: -f1)
    if [[ -n "$BUILD_LINE" ]]; then
      LAST_COPY=$(grep -n "^COPY" "$DOCKERFILE" | tail -1 | cut -d: -f1)
      INSERT_AT=${LAST_COPY:-1}

      sed -i '' "${INSERT_AT}a\\
\\
# Sub-path base for nginx reverse proxy (injected by QC-19)\\
ARG BASE_PATH=/${APP_NAME}/\\
ENV PUBLIC_URL=\${BASE_PATH}
" "$DOCKERFILE" 2>/dev/null || \
      sed -i "${INSERT_AT}a\\
\\
# Sub-path base for nginx reverse proxy (injected by QC-19)\\
ARG BASE_PATH=/${APP_NAME}/\\
ENV PUBLIC_URL=\${BASE_PATH}
" "$DOCKERFILE"

      echo "[QC-19] FIXED: Added BASE_PATH/PUBLIC_URL build args to Dockerfile (CRA)"
      FIXES_MADE=$((FIXES_MADE + 1))
    fi
  fi
fi

# --- Verify vite.config uses env var for base, not hardcoded value ---
FRONTEND_ROOT="$APP_DIR"
[[ -d "$APP_DIR/client" ]] && FRONTEND_ROOT="$APP_DIR/client"

for ext in js ts mjs mts; do
  VITE_CONFIG="$FRONTEND_ROOT/vite.config.${ext}"
  [[ ! -f "$VITE_CONFIG" ]] && continue

  # Check if base uses process.env.VITE_BASE_PATH (good) vs hardcoded string (fragile)
  if grep -qE "base\s*:\s*process\.env" "$VITE_CONFIG"; then
    echo "[QC-19] PASS: vite.config uses env var for base path (resilient)"
  elif grep -qE "base\s*:\s*['\"]/" "$VITE_CONFIG"; then
    CURRENT_BASE=$(grep -oE "base\s*:\s*['\"][^'\"]*['\"]" "$VITE_CONFIG" | head -1)
    echo "[QC-19] INFO: vite.config has hardcoded base ($CURRENT_BASE) — works but fragile"
    echo "[QC-19] INFO: Consider using: base: process.env.VITE_BASE_PATH || '/${APP_NAME}/'"
  fi
  break
done

# --- Result ---
if [[ "$FIXES_MADE" -gt 0 ]]; then
  echo "[QC-19] RESULT: Fixed ${FIXES_MADE} frontend build-time base path issue(s)"
  exit 1
else
  echo "[QC-19] PASS: Frontend build-time base path configured correctly"
  exit 0
fi
