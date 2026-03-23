#!/usr/bin/env bash
# ============================================================
# QC-06: Docker Build + Container Health Verification
# ============================================================
# Builds Docker image, starts container, and verifies /health
# returns 200 — retries health check up to 5 times.
#
# Usage: check-docker-build.sh <app-directory>
# Exit 0: Build + run + health all pass
# Exit 1: Issues found (caller should re-run after fixes)
# ============================================================

set -euo pipefail

APP_DIR="${1:?Usage: check-docker-build.sh <app-directory>}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[QC-06] ERROR: Directory not found: $APP_DIR"
  exit 1
fi

APP_NAME="$(basename "$APP_DIR")"
CONTAINER_NAME="qc-test-${APP_NAME}"
IMAGE_TAG="rr-portal/${APP_NAME}:qc-test"

# --- Cleanup trap (always runs) ---
cleanup() {
  docker stop "$CONTAINER_NAME" 2>/dev/null || true
  docker rm "$CONTAINER_NAME" 2>/dev/null || true
}
trap cleanup EXIT

# --- Prerequisite: Dockerfile must exist ---
if [[ ! -f "$APP_DIR/Dockerfile" ]]; then
  echo "[QC-06] ERROR: no Dockerfile found — run check-dockerfile first"
  exit 1
fi

# --- Build image ---
echo "[QC-06] Building Docker image: $IMAGE_TAG"
BUILD_OUTPUT=$(mktemp)

if ! docker build -t "$IMAGE_TAG" "$APP_DIR" > "$BUILD_OUTPUT" 2>&1; then
  echo "[QC-06] FAIL: docker build failed"
  echo "--- Last 20 lines of build output ---"
  tail -20 "$BUILD_OUTPUT"
  rm -f "$BUILD_OUTPUT"
  exit 1
fi
rm -f "$BUILD_OUTPUT"
echo "[QC-06] Docker image built successfully"

# --- Detect internal port from Dockerfile EXPOSE ---
INTERNAL_PORT=$(grep "^EXPOSE" "$APP_DIR/Dockerfile" | awk '{print $2}' | head -1)
INTERNAL_PORT="${INTERNAL_PORT:-3000}"
echo "[QC-06] Internal port: $INTERNAL_PORT"

# --- Start container ---
echo "[QC-06] Starting container: $CONTAINER_NAME"
docker run -d --name "$CONTAINER_NAME" -p "0:${INTERNAL_PORT}" "$IMAGE_TAG" > /dev/null 2>&1

# Wait for container to be running (up to 30 seconds)
for i in $(seq 1 30); do
  RUNNING=$(docker inspect --format='{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || echo "false")
  if [[ "$RUNNING" == "true" ]]; then
    break
  fi
  if [[ "$i" -eq 30 ]]; then
    echo "[QC-06] FAIL: container did not start within 30 seconds"
    echo "--- Container logs ---"
    docker logs "$CONTAINER_NAME" 2>&1 | tail -30
    exit 1
  fi
  sleep 1
done

# --- Get assigned host port ---
HOST_PORT=$(docker port "$CONTAINER_NAME" "$INTERNAL_PORT" 2>/dev/null | head -1 | sed 's/.*://')
if [[ -z "$HOST_PORT" ]]; then
  echo "[QC-06] FAIL: could not determine host port mapping"
  exit 1
fi
echo "[QC-06] Container running on host port: $HOST_PORT"

# --- Health check with retries ---
echo "[QC-06] Checking /health endpoint (up to 5 retries)..."
HEALTH_PASSED=false

for attempt in 1 2 3 4 5; do
  echo "[QC-06] Health check attempt $attempt/5..."
  RESPONSE=$(curl -sf "http://localhost:${HOST_PORT}/health" 2>/dev/null || true)

  if [[ -n "$RESPONSE" ]] && echo "$RESPONSE" | grep -q "status"; then
    HEALTH_PASSED=true
    break
  fi

  if [[ "$attempt" -lt 5 ]]; then
    sleep 5
  fi
done

if [[ "$HEALTH_PASSED" == "true" ]]; then
  echo "[QC-06] PASS: container healthy on port ${HOST_PORT}"
  exit 0
else
  echo "[QC-06] FAIL: /health not responding after 5 retries"
  echo "--- Container logs (last 30 lines) ---"
  docker logs "$CONTAINER_NAME" 2>&1 | tail -30
  exit 1
fi
