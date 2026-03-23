#!/usr/bin/env bash
# ============================================================
# QC-14: Docker Image Size Check
# ============================================================
# Warns when Docker images exceed a size threshold.
# Large images slow deployments (SSH transfer) and waste disk.
# Does NOT auto-fix — reports only, since fixes require
# architectural decisions (multi-stage builds, dependency trim).
#
# Usage: check-image-size.sh <app-directory>
# Exit 0: Image within limits or not built yet
# Exit 1: Never (this check is advisory only)
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-image-size.sh <app-directory>}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[QC-14] ERROR: Directory not found: $APP_DIR"
  exit 1
fi

APP_NAME="$(basename "$APP_DIR")"
MAX_SIZE_MB=500  # Warn above 500MB

echo "[QC-14] Checking image size for: $APP_NAME"

# Check if image exists
if ! docker images "rr-portal/${APP_NAME}" --format '{{.Size}}' 2>/dev/null | head -1 | grep -q .; then
  echo "[QC-14] SKIP: image rr-portal/${APP_NAME} not built yet"
  exit 0
fi

# Get image size in MB
IMAGE_SIZE_RAW=$(docker images "rr-portal/${APP_NAME}:latest" --format '{{.Size}}' 2>/dev/null | head -1)
echo "[QC-14] Image size: ${IMAGE_SIZE_RAW}"

# Parse size to MB
IMAGE_SIZE_MB=$(python3 -c "
size_str = '${IMAGE_SIZE_RAW}'.strip()
if 'GB' in size_str:
    print(int(float(size_str.replace('GB', '')) * 1024))
elif 'MB' in size_str:
    print(int(float(size_str.replace('MB', ''))))
elif 'kB' in size_str:
    print(0)
else:
    print(0)
" 2>/dev/null || echo "0")

if [[ "$IMAGE_SIZE_MB" -gt "$MAX_SIZE_MB" ]]; then
  echo "[QC-14] WARN: rr-portal/${APP_NAME} is ${IMAGE_SIZE_RAW} (>${MAX_SIZE_MB}MB)"
  echo "[QC-14] HINT: Consider optimizing:"
  echo "  - Use multi-stage builds (separate build and runtime stages)"
  echo "  - Use alpine-based images instead of full OS images"
  echo "  - Add .dockerignore to exclude test files, docs, .git"
  echo "  - Run 'npm prune --production' or equivalent"
  echo "  - Combine RUN commands to reduce layers"

  # Check for common size issues in Dockerfile
  if [[ -f "$APP_DIR/Dockerfile" ]]; then
    if ! grep -q "AS builder\|as builder\|AS build\|as build" "$APP_DIR/Dockerfile"; then
      echo "[QC-14] HINT: Dockerfile does not use multi-stage build"
    fi
    if grep -q "node:.*-slim\|node:.*-buster\|node:.*-bullseye" "$APP_DIR/Dockerfile" 2>/dev/null; then
      echo "[QC-14] HINT: Consider using node:*-alpine instead of debian-based images"
    fi
  fi

  if [[ ! -f "$APP_DIR/.dockerignore" ]]; then
    echo "[QC-14] HINT: No .dockerignore found — all files are included in build context"
  fi
else
  echo "[QC-14] PASS: image size ${IMAGE_SIZE_RAW} within ${MAX_SIZE_MB}MB limit"
fi

# Advisory only — always exit 0
exit 0
