#!/usr/bin/env bash
# ============================================================
# Registry Utilities — Shared read/write helpers for app and
# port registries, plus docker-compose service management.
# ============================================================
# This file is sourced by other scripts (not executed directly).
#
# Functions:
#   registry_allocate_port <app_name>      — allocate next port from ports.json
#   registry_register_app <name> <stack> <port> <entrypoint>  — add to apps.json
#   registry_get_port <app_name>           — read allocated port (stdout)
#   registry_app_exists <app_name>         — 0 if exists, 1 if not
#   compose_add_service <name> <host_port> <container_port>   — add to docker-compose.yml
#
# All write operations use fcntl file locking + atomic temp-file
# rename to prevent race conditions on concurrent access.
# ============================================================

# Resolve repo root — works whether sourced from anywhere
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)")"

# --- Registry file paths ---
PORTS_FILE="${REPO_ROOT}/devops/config/ports.json"
APPS_FILE="${REPO_ROOT}/devops/config/apps.json"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"

# --- Lock file paths ---
PORTS_LOCK="${PORTS_FILE}.lock"
APPS_LOCK="${APPS_FILE}.lock"

# ============================================================
# registry_allocate_port — assign next available port to an app
# ============================================================
# Reads _nextPort from ports.json, assigns to app, increments,
# writes back. Prints the allocated port to stdout.
#
# Usage: HOST_PORT=$(registry_allocate_port "my-app")
# ============================================================
registry_allocate_port() {
  local app_name="$1"
  python3 -c "
import json, sys, fcntl, tempfile, os

ports_file = sys.argv[1]
app = sys.argv[2]
lock_file = sys.argv[3]

lock_fd = open(lock_file, 'w')
try:
    fcntl.flock(lock_fd, fcntl.LOCK_EX)
    d = json.load(open(ports_file))
    port = d['_nextPort']
    d[app] = {'port': port}
    d['_nextPort'] = port + 1
    # Atomic write: temp file + rename
    dir_name = os.path.dirname(ports_file)
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix='.json')
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(d, f, indent=2)
        os.rename(tmp_path, ports_file)
    except:
        os.unlink(tmp_path)
        raise
    print(port)
finally:
    fcntl.flock(lock_fd, fcntl.LOCK_UN)
    lock_fd.close()
" "$PORTS_FILE" "$app_name" "$PORTS_LOCK"
}

# ============================================================
# registry_register_app — add app metadata to apps.json
# ============================================================
# Fields: stack, port, status (always "active"), entrypoint,
# addedAt (UTC ISO timestamp).
#
# Usage: registry_register_app "my-app" "node" 3001 "server.js"
# ============================================================
registry_register_app() {
  local app_name="$1" stack="$2" port="$3" entrypoint="$4"
  python3 -c "
import json, datetime, sys, fcntl, tempfile, os

apps_file = sys.argv[1]
app = sys.argv[2]
stack = sys.argv[3]
port = int(sys.argv[4])
entrypoint = sys.argv[5]
lock_file = sys.argv[6]

lock_fd = open(lock_file, 'w')
try:
    fcntl.flock(lock_fd, fcntl.LOCK_EX)
    d = json.load(open(apps_file))
    d[app] = {
      'stack': stack,
      'port': port,
      'status': 'active',
      'entrypoint': entrypoint,
      'addedAt': datetime.datetime.utcnow().isoformat() + 'Z'
    }
    # Atomic write: temp file + rename
    dir_name = os.path.dirname(apps_file)
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix='.json')
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(d, f, indent=2)
        os.rename(tmp_path, apps_file)
    except:
        os.unlink(tmp_path)
        raise
finally:
    fcntl.flock(lock_fd, fcntl.LOCK_UN)
    lock_fd.close()
" "$APPS_FILE" "$app_name" "$stack" "$port" "$entrypoint" "$APPS_LOCK"
}

# ============================================================
# registry_get_port — read the allocated port for an app
# ============================================================
# Prints port number to stdout. Exits 1 if app not found.
# Uses sys.argv for safe argument passing (no string interpolation).
#
# Usage: PORT=$(registry_get_port "my-app")
# ============================================================
registry_get_port() {
  local app_name="$1"
  python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
app = sys.argv[2]
if app not in d:
    sys.exit(1)
print(d[app]['port'])
" "$APPS_FILE" "$app_name"
}

# ============================================================
# registry_get_stack — read the stack type for an app
# ============================================================
# Prints stack name (e.g., "node", "python") to stdout.
# Exits 1 if app not found.
#
# Usage: STACK=$(registry_get_stack "my-app")
# ============================================================
registry_get_stack() {
  local app_name="$1"
  python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
app = sys.argv[2]
if app not in d:
    sys.exit(1)
print(d[app]['stack'])
" "$APPS_FILE" "$app_name"
}

# ============================================================
# registry_get_status — read the status for an app
# ============================================================
# Prints status (e.g., "active") to stdout.
# Exits 1 if app not found.
#
# Usage: STATUS=$(registry_get_status "my-app")
# ============================================================
registry_get_status() {
  local app_name="$1"
  python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
app = sys.argv[2]
if app not in d:
    sys.exit(1)
print(d[app]['status'])
" "$APPS_FILE" "$app_name"
}

# ============================================================
# registry_app_exists — check if app is already onboarded
# ============================================================
# Returns 0 (true) if app exists in apps.json, 1 (false) if not.
#
# Usage: if registry_app_exists "my-app"; then echo "already onboarded"; fi
# ============================================================
registry_app_exists() {
  local app_name="$1"
  python3 -c "
import json, sys
apps_file = sys.argv[1]
app = sys.argv[2]
d = json.load(open(apps_file))
sys.exit(0 if app in d else 1)
" "$APPS_FILE" "$app_name"
}

# ============================================================
# compose_add_service — add a service entry to docker-compose.yml
# ============================================================
# Generates the YAML service block and appends it to the
# services section of docker-compose.yml. Handles the case
# where services is empty ({}).
#
# Usage: compose_add_service "my-app" 3001 3000
# ============================================================
compose_add_service() {
  local app_name="$1" host_port="$2" container_port="$3"

  # Use python3 to safely generate and insert the YAML service block
  python3 -c "
import sys
app_name = sys.argv[1]
host_port = sys.argv[2]
container_port = sys.argv[3]
compose_file = sys.argv[4]

service_block = '  ' + app_name + ':\n'
service_block += '    build:\n'
service_block += '      context: ./apps/' + app_name + '\n'
service_block += '      dockerfile: Dockerfile\n'
service_block += '    ports:\n'
service_block += '      - \"' + host_port + ':' + container_port + '\"\n'
service_block += '    env_file:\n'
service_block += '      - ./apps/' + app_name + '/.env\n'
service_block += '    restart: unless-stopped\n'
service_block += '    healthcheck:\n'
service_block += '      test: [\"CMD\", \"wget\", \"--spider\", \"-q\", \"http://localhost:' + container_port + '/health\"]\n'
service_block += '      interval: 30s\n'
service_block += '      timeout: 10s\n'
service_block += '      retries: 3'

with open(compose_file, 'r') as f:
    content = f.read()

if 'services: {}' in content:
    content = content.replace('services: {}', 'services:\n' + service_block)
else:
    content = content.rstrip() + '\n' + service_block + '\n'

with open(compose_file, 'w') as f:
    f.write(content)
" "$app_name" "$host_port" "$container_port" "$COMPOSE_FILE"
}
