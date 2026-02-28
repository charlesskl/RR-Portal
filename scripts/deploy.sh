#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────
# Enterprise Platform — Deploy Script
# Usage:
#   ./scripts/deploy.sh              # Deploy all services
#   ./scripts/deploy.sh core         # Rebuild & deploy core only
#   ./scripts/deploy.sh plugin-hr    # Rebuild & deploy a single plugin
# ──────────────────────────────────────

cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[deploy]${NC} $*"; }
err()  { echo -e "${RED}[deploy]${NC} $*" >&2; }

# Check prerequisites
if ! command -v docker &>/dev/null; then
    err "Docker is not installed"
    exit 1
fi

if [ ! -f .env ]; then
    warn ".env file not found, copying from .env.example"
    cp .env.example .env
    warn "Please review .env and re-run this script"
    exit 1
fi

SERVICE="${1:-}"

if [ -z "$SERVICE" ]; then
    log "Building all services..."
    docker compose build

    log "Starting infrastructure (db, redis)..."
    docker compose up -d db redis
    sleep 3

    log "Starting core system..."
    docker compose up -d core
    sleep 5

    log "Starting plugins..."
    docker compose up -d
    sleep 3

    log "Starting nginx..."
    docker compose up -d nginx

    log "All services started!"
else
    log "Rebuilding and restarting: $SERVICE"
    docker compose build "$SERVICE"
    docker compose up -d "$SERVICE"
    log "$SERVICE restarted"
fi

echo ""
log "Service status:"
docker compose ps

echo ""
log "Platform is running at http://localhost:${NGINX_PORT:-80}"
log "API docs: http://localhost:${NGINX_PORT:-80}/docs (via core)"
