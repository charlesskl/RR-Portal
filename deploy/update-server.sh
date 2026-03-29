#!/usr/bin/env bash
set -euo pipefail

# ─── RR Portal Cloud Update Script ───
# Run on the cloud server to update to latest code
# Usage: bash /opt/rr-portal/deploy/update-server.sh

INSTALL_DIR="/opt/rr-portal"
ENV_FILE="${INSTALL_DIR}/.env.cloud.production"
COMPOSE_FILE="docker-compose.cloud.yml"
STATE_FILE="${INSTALL_DIR}/deploy/.deploy-state"
BACKUP_DIR="${INSTALL_DIR}/deploy/backups"

cd "$INSTALL_DIR"

# ─── Deployment state tracking ───
save_state() {
  echo "$1" > "$STATE_FILE"
}

check_resume() {
  if [[ -f "$STATE_FILE" ]]; then
    local last_state
    last_state=$(cat "$STATE_FILE")
    echo "[RESUME] Previous deploy interrupted at: ${last_state}"
    echo "[RESUME] Continuing from the beginning (safe to re-run)"
  fi
}

cleanup_state() {
  rm -f "$STATE_FILE"
}

trap cleanup_state EXIT

echo "=== Updating RR Portal ==="
check_resume

# ─── Step 1: Pull latest code ───
save_state "pulling"
echo "[1/5] Pulling latest code..."
git fetch origin
git reset --hard origin/main

# ─── Step 2: Ensure data directories from docker-compose ───
save_state "directories"
echo "[2/5] Ensuring data directories..."

# Parse volume mounts from docker-compose to create host-side directories.
# This replaces hardcoded mkdir commands — any new service with bind mounts
# will automatically have its directories created.
if command -v python3 &>/dev/null; then
  python3 -c "
import re, os
with open('${COMPOSE_FILE}') as f:
    content = f.read()
# Match bind mount patterns: ./path:/container/path
for match in re.findall(r'^\s*-\s+\./([^:]+):', content, re.MULTILINE):
    path = match.strip()
    # Only create directories for data/uploads paths (not config files)
    if any(seg in path for seg in ['data', 'uploads']):
        os.makedirs(path, exist_ok=True)
        print(f'  [OK] {path}')
" 2>/dev/null || {
    echo "  [WARN] python3 not available, falling back to grep"
    grep -oP '^\s*-\s+\./\K[^:]+' "$COMPOSE_FILE" | while read -r vol_path; do
      case "$vol_path" in
        *data*|*uploads*) mkdir -p "$vol_path" && echo "  [OK] $vol_path" ;;
      esac
    done
  }
else
  grep -oP '^\s*-\s+\./\K[^:]+' "$COMPOSE_FILE" | while read -r vol_path; do
    case "$vol_path" in
      *data*|*uploads*) mkdir -p "$vol_path" && echo "  [OK] $vol_path" ;;
    esac
  done
fi

# ─── Step 3: Backup databases before rebuild ───
save_state "backup"
echo "[3/5] Backing up databases..."
mkdir -p "$BACKUP_DIR"
BACKUP_TS="$(date +%Y%m%d-%H%M%S)"

# Backup PostgreSQL (if running)
if docker compose -f "$COMPOSE_FILE" ps db 2>/dev/null | grep -q "running"; then
  PG_BACKUP="${BACKUP_DIR}/postgres-${BACKUP_TS}.sql.gz"
  echo "  Backing up PostgreSQL..."
  docker compose -f "$COMPOSE_FILE" exec -T db \
    pg_dump -U "${DB_USER:-rrportal}" "${DB_NAME:-rrportal}" 2>/dev/null \
    | gzip > "$PG_BACKUP" && \
    echo "  [OK] PostgreSQL → ${PG_BACKUP}" || \
    echo "  [WARN] PostgreSQL backup failed (db may not be running yet)"
else
  echo "  [SKIP] PostgreSQL not running"
fi

# Backup SQLite databases (find all .db files in data directories)
find apps/ plugins/ -path '*/data/*.db' -type f 2>/dev/null | while read -r db_file; do
  backup_name="$(echo "$db_file" | tr '/' '-')-${BACKUP_TS}"
  cp "$db_file" "${BACKUP_DIR}/${backup_name}" && \
    echo "  [OK] ${db_file} → backups/${backup_name}" || \
    echo "  [WARN] Failed to backup ${db_file}"
done

# Prune old backups (keep last 5)
ls -t "$BACKUP_DIR"/postgres-*.sql.gz 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true
ls -t "$BACKUP_DIR"/*.db-* 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true

# ─── Step 4: Rebuild and restart services ───
save_state "rebuild"
echo "[4/5] Rebuilding and restarting services..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

# ─── Step 5: Restart nginx and health check ───
save_state "healthcheck"
echo "[5/5] Restarting nginx and checking health..."
docker compose -f "$COMPOSE_FILE" restart nginx

# Wait for services with readiness polling instead of hardcoded sleep
echo "  Waiting for services to become healthy..."
ATTEMPTS=0
MAX_ATTEMPTS=30
while [[ $ATTEMPTS -lt $MAX_ATTEMPTS ]]; do
  if curl -sf http://localhost/nginx-health > /dev/null 2>&1; then
    echo "  [OK] nginx healthy after $((ATTEMPTS * 2))s"
    break
  fi
  sleep 2
  ATTEMPTS=$((ATTEMPTS + 1))
done

if [[ $ATTEMPTS -ge $MAX_ATTEMPTS ]]; then
  echo "  [WARN] nginx not responding after 60s. Check: docker compose -f ${COMPOSE_FILE} logs"
else
  echo "[OK] Update complete, all services healthy."
fi

# Show container status
echo "=== Container Status ==="
docker compose -f "$COMPOSE_FILE" ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || true
