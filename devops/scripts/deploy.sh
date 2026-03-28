#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Deploy Script — Full deployment pipeline for RR-Portal apps
# ============================================================
# Builds Docker images, transfers to Local Server via SSH,
# updates docker-compose on the remote, health-checks the new
# container, and rolls back on failure.
#
# Usage: deploy.sh <app-name>
#
# Required environment variables:
#   DEPLOY_SERVER        — SSH target (e.g., charles@192.168.1.50)
#
# Optional environment variables:
#   DEPLOY_COMPOSE_PATH  — Remote docker-compose.yml path
#                          (default: /opt/rr-portal/docker-compose.yml)
# ============================================================

# --- Resolve paths ---
REPO_ROOT="$(git rev-parse --show-toplevel)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Source utilities ---
source "${SCRIPT_DIR}/utils/telegram.sh"
source "${SCRIPT_DIR}/utils/registry.sh"
source "${SCRIPT_DIR}/utils/nginx-gen.sh"
source "${SCRIPT_DIR}/utils/detect-stack.sh"
source "${SCRIPT_DIR}/utils/audit.sh"

# --- Logging setup ---
APP_NAME="${1:-}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "${REPO_ROOT}/devops/logs"
LOG_FILE="${REPO_ROOT}/devops/logs/deploy-${APP_NAME}-${TIMESTAMP}.log"

# Tee all output to log file
exec > >(tee -a "${LOG_FILE}") 2>&1

# ============================================================
# Step 1: Argument parsing and validation
# ============================================================
echo "=== DEPLOY: validating arguments ==="

if [ -z "${APP_NAME}" ]; then
  echo "ERROR: Usage: deploy.sh <app-name>"
  exit 1
fi

# Validate app name format — prevent shell injection in SSH commands
if [[ ! "${APP_NAME}" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "ERROR: Invalid app name '${APP_NAME}' — must be lowercase alphanumeric with hyphens/underscores"
  exit 1
fi

# Validate app exists in apps.json
if ! registry_app_exists "${APP_NAME}"; then
  echo "ERROR: App '${APP_NAME}' not found in apps.json"
  exit 1
fi

# Read app metadata
HOST_PORT=$(registry_get_port "${APP_NAME}")
STACK=$(registry_get_stack "${APP_NAME}")

# Read deploy target from env
if [ -z "${DEPLOY_SERVER:-}" ]; then
  echo "ERROR: DEPLOY_SERVER environment variable is required (e.g., charles@192.168.1.50)"
  exit 1
fi

DEPLOY_COMPOSE_PATH="${DEPLOY_COMPOSE_PATH:-/opt/rr-portal/docker-compose.yml}"

# Extract host from DEPLOY_SERVER (strip user@ prefix)
DEPLOY_SERVER_HOST="${DEPLOY_SERVER#*@}"

echo "App: ${APP_NAME} (${STACK})"
echo "Host port: ${HOST_PORT}"
echo "Deploy target: ${DEPLOY_SERVER}"
echo "Remote compose: ${DEPLOY_COMPOSE_PATH}"

# --- SSH connection multiplexing ---
# Reuse a single TCP connection for all SSH commands to avoid rate limiting
SSH_CONTROL_PATH="/tmp/deploy-ssh-${APP_NAME}-$$"
ssh -fNM -o ControlPath="${SSH_CONTROL_PATH}" -o ControlPersist=300 "${DEPLOY_SERVER}" 2>/dev/null || true
SSH_OPTS="-o ControlPath=${SSH_CONTROL_PATH}"

# Helper: SSH with connection reuse
deploy_ssh() {
  ssh "${SSH_OPTS}" "${DEPLOY_SERVER}" "$@"
}

# Cleanup SSH multiplexer on exit
cleanup_ssh() {
  ssh -O exit -o ControlPath="${SSH_CONTROL_PATH}" "${DEPLOY_SERVER}" 2>/dev/null || true
}
trap cleanup_ssh EXIT

echo "SSH connection multiplexing enabled"

# ============================================================
# Step 2: Image build and tagging (DEPL-01)
# ============================================================
echo "=== DEPLOY: building Docker image ==="

GIT_HASH="$(git rev-parse --short HEAD)"

# Before overwriting :latest, re-tag current :latest as :previous (for rollback)
echo "=== DEPLOY: preserving previous image for rollback ==="
docker tag "rr-portal/${APP_NAME}:latest" "rr-portal/${APP_NAME}:previous" 2>/dev/null || true

# Detect build args needed for frontend sub-path routing
BUILD_ARGS=""
APP_DOCKERFILE="${REPO_ROOT}/apps/${APP_NAME}/Dockerfile"
if [[ -f "$APP_DOCKERFILE" ]]; then
  # If Dockerfile declares ARG BASE_PATH, pass the app name as the base path
  if grep -q "ARG BASE_PATH" "$APP_DOCKERFILE"; then
    BUILD_ARGS="${BUILD_ARGS} --build-arg BASE_PATH=/${APP_NAME}/"
    echo "  Passing --build-arg BASE_PATH=/${APP_NAME}/"
  fi
  # If Dockerfile declares ARG VITE_BASE_PATH (direct, without ARG BASE_PATH alias)
  if grep -q "ARG VITE_BASE_PATH" "$APP_DOCKERFILE" && ! grep -q "ARG BASE_PATH" "$APP_DOCKERFILE"; then
    BUILD_ARGS="${BUILD_ARGS} --build-arg VITE_BASE_PATH=/${APP_NAME}/"
    echo "  Passing --build-arg VITE_BASE_PATH=/${APP_NAME}/"
  fi
fi

# Build image with git hash tag (cross-compile for linux/amd64 since Mac is ARM)
docker buildx build --platform linux/amd64 --load \
  ${BUILD_ARGS} \
  -t "rr-portal/${APP_NAME}:${GIT_HASH}" "${REPO_ROOT}/apps/${APP_NAME}"

# Tag as latest
docker tag "rr-portal/${APP_NAME}:${GIT_HASH}" "rr-portal/${APP_NAME}:latest"

echo "Built: rr-portal/${APP_NAME}:${GIT_HASH}"
echo "Tagged: rr-portal/${APP_NAME}:latest"

# ============================================================
# Step 3: Image transfer via SSH (DEPL-02)
# ============================================================
echo "=== DEPLOY: checking server disk space ==="

# Pre-deploy disk check — abort if less than 2GB free
DISK_FREE_KB=$(deploy_ssh "df -k /opt/rr-portal | tail -1 | awk '{print \$4}'" 2>/dev/null || echo "0")
DISK_FREE_GB=$(( DISK_FREE_KB / 1048576 ))
echo "Server disk free: ~${DISK_FREE_GB} GB"
if [[ "$DISK_FREE_KB" -lt 2097152 ]]; then
  echo "ERROR: Server has less than 2 GB free disk space. Aborting transfer."
  send_telegram "$(format_deploy_failure "${APP_NAME}" "Server disk full — only ${DISK_FREE_GB} GB free")"
  exit 1
fi

echo "=== DEPLOY: transferring image to ${DEPLOY_SERVER} ==="

# Preserve previous image on server for rollback (tag before overwriting)
deploy_ssh "docker tag rr-portal/${APP_NAME}:latest rr-portal/${APP_NAME}:previous 2>/dev/null || true"

# Transfer only the :hash image (single transfer — saves bandwidth)
docker save "rr-portal/${APP_NAME}:${GIT_HASH}" | deploy_ssh "docker load"

# Tag on server: hash → latest (no re-transfer needed)
deploy_ssh "docker tag rr-portal/${APP_NAME}:${GIT_HASH} rr-portal/${APP_NAME}:latest"

# Verify image loaded correctly
LOADED_ID=$(deploy_ssh "docker images -q rr-portal/${APP_NAME}:${GIT_HASH}" 2>/dev/null || echo "")
if [[ -z "$LOADED_ID" ]]; then
  echo "ERROR: Image transfer may have failed — image ID not found on server"
  send_telegram "$(format_deploy_failure "${APP_NAME}" "Image transfer failed — incomplete load on server")"
  exit 1
fi

echo "Image transferred and tagged on ${DEPLOY_SERVER} (ID: ${LOADED_ID})"

# ============================================================
# Step 4: Remote compose update (DEPL-03)
# ============================================================
echo "=== DEPLOY: updating remote docker-compose.yml ==="

# Read internal port from Dockerfile EXPOSE line
INTERNAL_PORT=$(grep "^EXPOSE" "${REPO_ROOT}/apps/${APP_NAME}/Dockerfile" | awk '{print $2}')
if [ -z "${INTERNAL_PORT}" ]; then
  echo "WARNING: No EXPOSE found in Dockerfile, defaulting to 8080"
  INTERNAL_PORT="8080"
fi

# Ensure pyyaml is available on remote
deploy_ssh "pip3 install --quiet pyyaml 2>/dev/null || true"

# Update remote docker-compose.yml — only this app's service section
deploy_ssh python3 - "${APP_NAME}" "${HOST_PORT}" "${INTERNAL_PORT}" "${DEPLOY_COMPOSE_PATH}" << 'PYEOF'
import sys
import yaml

app_name = sys.argv[1]
host_port = sys.argv[2]
container_port = sys.argv[3]
compose_path = sys.argv[4]

with open(compose_path, 'r') as f:
    compose = yaml.safe_load(f)

if compose is None:
    compose = {}

# Ensure top-level 'services' key exists
if 'services' not in compose:
    compose['services'] = {}

# Build the new service definition
service_def = {
    'image': f'rr-portal/{app_name}:latest',
    'ports': [f'{host_port}:{container_port}'],
    'env_file': [f'./apps/{app_name}/.env'],
    'volumes': [
        f'./apps/{app_name}/data:/app/data',
        f'./apps/{app_name}/uploads:/app/uploads',
    ],
    'restart': 'unless-stopped',
    'networks': ['platform-net'],
    'healthcheck': {
        'test': ['CMD', 'curl', '-sf', f'http://localhost:{container_port}/health'],
        'interval': '30s',
        'timeout': '10s',
        'retries': 3,
    },
}

# Preserve existing service config (don't overwrite custom volumes/env on update)
existing = compose.get('services', {}).get(app_name)
if existing:
    # Update image but keep existing volumes, env, and networks
    existing['image'] = service_def['image']
    existing['ports'] = service_def['ports']
    existing.setdefault('networks', service_def['networks'])
    existing.setdefault('volumes', service_def['volumes'])
    existing.setdefault('healthcheck', service_def['healthcheck'])
    compose['services'][app_name] = existing
else:
    compose['services'][app_name] = service_def

# Ensure platform-net network is defined at top level
if 'networks' not in compose:
    compose['networks'] = {}
if 'platform-net' not in compose.get('networks', {}):
    compose['networks']['platform-net'] = {'driver': 'bridge'}

with open(compose_path, 'w') as f:
    yaml.dump(compose, f, default_flow_style=False, sort_keys=False)

print("Updated " + compose_path + " for service " + app_name)
PYEOF

echo "Remote docker-compose.yml updated for ${APP_NAME}"

# ============================================================
# Step 4b: Remote nginx config update (DEPL-03b)
# ============================================================
echo "=== DEPLOY: checking nginx config for ${APP_NAME} ==="

REMOTE_NGINX_CONF="$(dirname "${DEPLOY_COMPOSE_PATH}")/nginx/nginx.cloud.conf"

# Check if nginx config already has this app's location blocks
NGINX_HAS_APP=$(deploy_ssh "grep -c 'location /${APP_NAME}/' '${REMOTE_NGINX_CONF}' 2>/dev/null || echo 0")

if [[ "$NGINX_HAS_APP" == "0" ]]; then
  echo "=== DEPLOY: generating nginx config for /${APP_NAME}/ ==="

  # Generate upstream and location blocks
  UPSTREAM_BLOCK="$(generate_nginx_upstream "${APP_NAME}" "${INTERNAL_PORT}")"
  LOCATION_BLOCK="$(generate_nginx_locations "${APP_NAME}")"

  # Inject upstream block before server { on remote
  deploy_ssh python3 - "${APP_NAME}" "${INTERNAL_PORT}" "${REMOTE_NGINX_CONF}" << 'NGINX_PY'
import sys

app_name = sys.argv[1]
container_port = sys.argv[2]
nginx_conf = sys.argv[3]
upstream_name = app_name.replace('-', '_') + '_backend'

with open(nginx_conf) as f:
    content = f.read()

# Check if upstream already exists
if f'upstream {upstream_name}' in content:
    print(f'[NGINX] SKIP: upstream {upstream_name} already exists')
else:
    upstream = f'''upstream {upstream_name} {{
        server {app_name}:{container_port};
    }}

'''
    idx = content.find('    server {')
    if idx == -1:
        idx = content.find('server {')
    if idx > 0:
        content = content[:idx] + upstream + content[idx:]
        print(f'[NGINX] ADDED: upstream {upstream_name}')

# Check if location blocks already exist
if f'location /{app_name}/' in content:
    print(f'[NGINX] SKIP: location /{app_name}/ already exists')
else:
    locations = f'''
        # --- Standalone: {app_name} ---
        location = /{app_name} {{
            return 301 /{app_name}/;
        }}
        location = /{app_name}/health {{
            auth_basic off;
            proxy_pass http://{upstream_name}/health;
            proxy_set_header Host $host;
        }}
        location /{app_name}/api/ {{
            auth_basic off;
            proxy_pass http://{upstream_name}/api/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_no_cache 1;
            proxy_cache_bypass 1;
        }}
        location /{app_name}/ {{
            proxy_pass http://{upstream_name}/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }}
'''
    # Insert before the last server block closing brace
    lines = content.split('\n')
    closing_indices = [i for i, l in enumerate(lines) if l.strip() == '}']
    if len(closing_indices) >= 2:
        insert_idx = closing_indices[-2]
        lines.insert(insert_idx, locations)
        content = '\n'.join(lines)
        print(f'[NGINX] ADDED: location blocks for /{app_name}/')

with open(nginx_conf, 'w') as f:
    f.write(content)
NGINX_PY

  # Reload nginx
  # Validate config before reloading
  if safe_nginx_reload "${DEPLOY_SERVER_HOST}"; then
    echo "Nginx config updated and reloaded for ${APP_NAME}"
  else
    echo "WARNING: Nginx config validation failed — reverting changes"
    # Config error — the deploy can continue but routing won't work
  fi
else
  echo "Nginx config already has /${APP_NAME}/ routes — skipping"
fi

# ============================================================
# Step 4c: Create volume directories with correct permissions
# ============================================================
echo "=== DEPLOY: ensuring volume directories exist with correct permissions ==="

COMPOSE_DIR="$(dirname "${DEPLOY_COMPOSE_PATH}")"

# Extract volume mounts for this app from the remote compose file
VOLUME_DIRS=$(deploy_ssh python3 - "${APP_NAME}" "${DEPLOY_COMPOSE_PATH}" << 'VOLPY'
import sys, re

app_name = sys.argv[1]
compose_path = sys.argv[2]

with open(compose_path) as f:
    content = f.read()

lines = content.split('\n')
in_service = False
in_volumes = False
dirs = []

for line in lines:
    stripped = line.strip()
    if stripped == f'{app_name}:' and line.startswith('  '):
        in_service = True
        continue
    if in_service:
        if stripped and not line.startswith('    ') and stripped != '':
            if not line.startswith('  '):
                break
            if not line.startswith('    '):
                break
        if stripped == 'volumes:':
            in_volumes = True
            continue
        if in_volumes:
            if stripped.startswith('-'):
                # Parse volume mount: ./path:/container/path
                mount = stripped.lstrip('- ').strip('"').strip("'")
                host_path = mount.split(':')[0] if ':' in mount else ''
                if host_path and host_path.startswith('./'):
                    dirs.append(host_path)
            elif stripped and not stripped.startswith('-'):
                in_volumes = False

for d in dirs:
    print(d)
VOLPY
) 2>/dev/null || true

if [[ -n "$VOLUME_DIRS" ]]; then
  while IFS= read -r vol_dir; do
    [[ -z "$vol_dir" ]] && continue
    FULL_DIR="${COMPOSE_DIR}/${vol_dir#./}"
    echo "  Creating volume dir: ${FULL_DIR}"
    deploy_ssh "mkdir -p '${FULL_DIR}' && chown -R 100:101 '${FULL_DIR}'" 2>/dev/null || true
  done <<< "$VOLUME_DIRS"
  echo "Volume directories created with appuser ownership (100:101)"
else
  echo "No volume mounts found for ${APP_NAME}"
fi

# ============================================================
# Step 5-7: Deploy with health verification, retry, rollback
# (DEPL-04, DEPL-05, DEPL-06)
# ============================================================

# --- Health check function ---
check_health() {
  local max_attempts=20
  local delay=3
  local attempt=1

  echo "=== DEPLOY: health checking http://${DEPLOY_SERVER_HOST}:${HOST_PORT}/health ==="

  while [ "${attempt}" -le "${max_attempts}" ]; do
    if curl -sf "http://${DEPLOY_SERVER_HOST}:${HOST_PORT}/health" > /dev/null 2>&1; then
      echo "Health check passed (attempt ${attempt}/${max_attempts})"
      return 0
    fi
    echo "Health check attempt ${attempt}/${max_attempts} — waiting ${delay}s..."
    sleep "${delay}"
    attempt=$((attempt + 1))
  done

  echo "Health check failed after ${max_attempts} attempts (60 seconds)"
  return 1
}

# --- Deploy + retry loop (DEPL-05) ---
deploy_attempt=1
max_deploy_attempts=3
deploy_success=false

while [ "${deploy_attempt}" -le "${max_deploy_attempts}" ]; do
  echo "=== DEPLOY: attempt ${deploy_attempt}/${max_deploy_attempts} ==="

  if [ "${deploy_attempt}" -eq 1 ]; then
    # Round 1: initial deploy
    deploy_ssh "cd $(dirname "${DEPLOY_COMPOSE_PATH}") && docker compose up -d ${APP_NAME}"
  elif [ "${deploy_attempt}" -eq 2 ]; then
    # Round 2: restart container, re-check
    echo "=== DEPLOY: restarting container ==="
    deploy_ssh "cd $(dirname "${DEPLOY_COMPOSE_PATH}") && docker compose restart ${APP_NAME}"
  else
    # Round 3: rebuild, re-transfer, redeploy
    echo "=== DEPLOY: full rebuild and redeploy ==="
    docker buildx build --platform linux/amd64 --load \
      -t "rr-portal/${APP_NAME}:${GIT_HASH}" "${REPO_ROOT}/apps/${APP_NAME}"
    docker tag "rr-portal/${APP_NAME}:${GIT_HASH}" "rr-portal/${APP_NAME}:latest"
    docker save "rr-portal/${APP_NAME}:${GIT_HASH}" | deploy_ssh "docker load"
    deploy_ssh "docker tag rr-portal/${APP_NAME}:${GIT_HASH} rr-portal/${APP_NAME}:latest"
    deploy_ssh "cd $(dirname "${DEPLOY_COMPOSE_PATH}") && docker compose up -d ${APP_NAME}"
  fi

  # Health check
  if check_health; then
    deploy_success=true
    break
  fi

  echo "Deploy attempt ${deploy_attempt} failed health check"
  deploy_attempt=$((deploy_attempt + 1))
done

# ============================================================
# Step 7: Rollback on unfixable failure (DEPL-06)
# ============================================================
if [ "${deploy_success}" = "false" ]; then
  echo "=== DEPLOY: all ${max_deploy_attempts} attempts failed — rolling back ==="

  # Restore :previous image as :latest on remote
  deploy_ssh "docker tag rr-portal/${APP_NAME}:previous rr-portal/${APP_NAME}:latest"
  deploy_ssh "cd $(dirname "${DEPLOY_COMPOSE_PATH}") && docker compose up -d ${APP_NAME}"

  # Health-check the rollback
  echo "=== DEPLOY: verifying rollback health ==="
  if check_health; then
    echo "Rollback successful — previous version is healthy"
  else
    echo "CRITICAL: Rollback also failed health check"
  fi

  # Notify failure (DEPL-07)
  send_telegram "$(format_deploy_failure "${APP_NAME}" "Health check failed after ${max_deploy_attempts} attempts. Rolled back to previous version.")"
  audit_rollback "${APP_NAME}" "Health check failed, rolled back"
  exit 1
fi

# ============================================================
# Step 7b: Post-deploy database migration (if needed)
# ============================================================
# Detect and run migration commands inside the running container.
# This runs AFTER the container is healthy but BEFORE endpoint verification,
# because endpoints will fail without tables/schema.

APP_SOURCE="${REPO_ROOT}/apps/${APP_NAME}"
SERVER_DIR="$APP_SOURCE"
[[ -d "$APP_SOURCE/server" ]] && SERVER_DIR="$APP_SOURCE/server"
CONTAINER_NAME="${APP_NAME}"

echo "=== DEPLOY: checking for database migrations ==="

MIGRATION_RAN=false

# Prisma
if [[ -d "$SERVER_DIR/prisma/migrations" ]]; then
  echo "  Prisma migrations detected — running migrate deploy..."
  if deploy_ssh "docker exec ${CONTAINER_NAME} npx prisma migrate deploy 2>&1" 2>/dev/null; then
    echo "  Prisma migrations: SUCCESS"
    MIGRATION_RAN=true
  else
    echo "  Prisma migrations: FAILED (check container logs)"
  fi
# Knex
elif [[ -f "$SERVER_DIR/knexfile.js" ]] || [[ -f "$SERVER_DIR/knexfile.ts" ]]; then
  echo "  Knex migrations detected — running migrate:latest..."
  if deploy_ssh "docker exec ${CONTAINER_NAME} npx knex migrate:latest 2>&1" 2>/dev/null; then
    echo "  Knex migrations: SUCCESS"
    MIGRATION_RAN=true
  else
    echo "  Knex migrations: FAILED (check container logs)"
  fi
# Sequelize
elif [[ -f "$SERVER_DIR/.sequelizerc" ]] || [[ -d "$SERVER_DIR/migrations" ]]; then
  if grep -rq "sequelize" "$SERVER_DIR/package.json" 2>/dev/null; then
    echo "  Sequelize migrations detected — running db:migrate..."
    if deploy_ssh "docker exec ${CONTAINER_NAME} npx sequelize-cli db:migrate 2>&1" 2>/dev/null; then
      echo "  Sequelize migrations: SUCCESS"
      MIGRATION_RAN=true
    else
      echo "  Sequelize migrations: FAILED (check container logs)"
    fi
  fi
# Alembic (Python)
elif [[ -d "$SERVER_DIR/alembic" ]] || [[ -f "$SERVER_DIR/alembic.ini" ]]; then
  echo "  Alembic migrations detected — running upgrade head..."
  if deploy_ssh "docker exec ${CONTAINER_NAME} alembic upgrade head 2>&1" 2>/dev/null; then
    echo "  Alembic migrations: SUCCESS"
    MIGRATION_RAN=true
  else
    echo "  Alembic migrations: FAILED (check container logs)"
  fi
# Django
elif [[ -f "$SERVER_DIR/manage.py" ]]; then
  if grep -q "django" "$SERVER_DIR/requirements.txt" 2>/dev/null || grep -q "django" "$SERVER_DIR/Pipfile" 2>/dev/null; then
    echo "  Django migrations detected — running migrate..."
    if deploy_ssh "docker exec ${CONTAINER_NAME} python manage.py migrate 2>&1" 2>/dev/null; then
      echo "  Django migrations: SUCCESS"
      MIGRATION_RAN=true
    else
      echo "  Django migrations: FAILED (check container logs)"
    fi
  fi
else
  echo "  No explicit migrations detected (app may self-initialize on startup)"
fi

# Seed data (first deploy only — check if app was just registered)
if [[ "$MIGRATION_RAN" == "true" ]]; then
  for seed_file in "seed.js" "seed.ts" "prisma/seed.ts" "prisma/seed.js"; do
    if [[ -f "$SERVER_DIR/$seed_file" ]]; then
      echo "  Seed file found: $seed_file — running..."
      deploy_ssh "docker exec ${CONTAINER_NAME} node /app/${seed_file} 2>&1" 2>/dev/null || \
      deploy_ssh "docker exec ${CONTAINER_NAME} npx ts-node /app/${seed_file} 2>&1" 2>/dev/null || \
        echo "  Seed: FAILED (non-blocking)"
      break
    fi
  done
fi

# ============================================================
# Step 8: Post-deploy endpoint verification (DEPL-08)
# ============================================================
echo "=== DEPLOY: running endpoint verification ==="

VERIFY_SCRIPT="${SCRIPT_DIR}/verify-deploy.sh"
if [[ -f "$VERIFY_SCRIPT" ]]; then
  if "$VERIFY_SCRIPT" "${APP_NAME}" "${DEPLOY_SERVER_HOST}" "${HOST_PORT}" "${DEPLOY_COMPOSE_PATH}"; then
    echo "=== DEPLOY: endpoint verification PASSED ==="
  else
    echo "=== DEPLOY: endpoint verification FAILED — some API routes unreachable ==="
    send_telegram "$(format_deploy_failure "${APP_NAME}" "Endpoint verification failed — some API routes return 404 through nginx. App is running but needs manual review.")"
    # Don't exit 1 here — app is healthy, just routing issues
  fi
else
  echo "=== DEPLOY: verify-deploy.sh not found, skipping endpoint verification ==="
fi

# ============================================================
# Step 9: Dashboard registration (first deploy only)
# ============================================================
# Only runs for new apps (action=onboard). Reads display_name and
# department from apps.json or state JSON, adds app card to the
# portal homepage so users can find it.
REMOTE_HTML="$(dirname "${DEPLOY_COMPOSE_PATH}")/frontend/index.cloud.html"
APP_ON_DASHBOARD=$(deploy_ssh "grep -c '/${APP_NAME}/' '${REMOTE_HTML}' 2>/dev/null || echo 0" 2>/dev/null || echo "0")

if [[ "${APP_ON_DASHBOARD}" == "0" ]]; then
  echo "=== DEPLOY: registering ${APP_NAME} on portal dashboard ==="
  source "${SCRIPT_DIR}/utils/dashboard.sh"

  # Read display_name and department from apps.json
  DISPLAY_NAME=$(python3 -c "
import json, sys
d = json.load(open('${REPO_ROOT}/devops/config/apps.json'))
app = d.get(sys.argv[1], {})
print(app.get('display_name', sys.argv[1]))
" "$APP_NAME" 2>/dev/null || echo "$APP_NAME")

  DEPARTMENT=$(python3 -c "
import json, sys
d = json.load(open('${REPO_ROOT}/devops/config/apps.json'))
app = d.get(sys.argv[1], {})
print(app.get('department', 'Engineering'))
" "$APP_NAME" 2>/dev/null || echo "Engineering")

  DESCRIPTION="${DISPLAY_NAME} (${DEPARTMENT})"

  add_to_dashboard "$APP_NAME" "$DISPLAY_NAME" "$DESCRIPTION" "$DEPARTMENT" "$DEPLOY_SERVER_HOST" "$REMOTE_HTML" 2>&1 || \
    echo "[DASHBOARD] WARN: could not add to dashboard — non-blocking, manual fix possible"
else
  echo "=== DEPLOY: ${APP_NAME} already on dashboard ==="
fi

# ============================================================
# Step 10: Success notification (DEPL-07)
# ============================================================
echo "=== DEPLOY: ${APP_NAME} deployed successfully ==="

send_telegram "$(format_deploy_success "${APP_NAME}" "${GIT_HASH}" "${HOST_PORT}")"
audit_deploy "${APP_NAME}" "Deployed ${GIT_HASH} on port ${HOST_PORT}"

echo "=== DEPLOY: complete ==="
exit 0
