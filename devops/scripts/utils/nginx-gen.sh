#!/usr/bin/env bash
# ============================================================
# Nginx Config Generator — Generates upstream + location blocks
# ============================================================
# Generates nginx configuration snippets for sub-path routing
# of portal apps. Can be used standalone or by deploy.sh.
#
# Usage: source this file, then call:
#   generate_nginx_upstream <app-name> <container-port>
#   generate_nginx_locations <app-name>
#   inject_nginx_config <app-name> <container-port> <nginx-conf-path>
# ============================================================

generate_nginx_upstream() {
  local app_name="$1"
  local container_port="$2"
  local upstream_name="${app_name//-/_}_backend"

  cat <<EOF
upstream ${upstream_name} {
        server ${app_name}:${container_port};
    }
EOF
}

generate_nginx_locations() {
  local app_name="$1"
  local upstream_name="${app_name//-/_}_backend"

  cat <<EOF

        # --- Standalone: ${app_name} ---
        location = /${app_name} {
            return 301 /${app_name}/;
        }
        location /${app_name}/api/ {
            proxy_pass http://${upstream_name}/api/;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            proxy_no_cache 1;
            proxy_cache_bypass 1;
        }
        location /${app_name}/ {
            proxy_pass http://${upstream_name}/;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            # WebSocket support
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection "upgrade";
        }
EOF
}

# Inject upstream and location blocks into an existing nginx config
# Idempotent — skips if already present
inject_nginx_config() {
  local app_name="$1"
  local container_port="$2"
  local nginx_conf="$3"
  local upstream_name="${app_name//-/_}_backend"

  if [[ ! -f "$nginx_conf" ]]; then
    echo "[NGINX] ERROR: Config file not found: $nginx_conf"
    return 1
  fi

  local changes_made=0

  # Check if upstream already exists
  if grep -q "upstream ${upstream_name}" "$nginx_conf" 2>/dev/null; then
    echo "[NGINX] SKIP: upstream ${upstream_name} already exists"
  else
    # Insert upstream block before the server { block
    local upstream_block
    upstream_block="$(generate_nginx_upstream "$app_name" "$container_port")"

    printf '%s' "$upstream_block" | python3 -c "
import sys
nginx_conf_path = sys.argv[1]
upstream_name = sys.argv[2]
app_name = sys.argv[3]
container_port = sys.argv[4]
upstream_block = sys.stdin.read()
conf = open(nginx_conf_path).read()
# Insert upstream before 'server {' line
upstream = upstream_block + '\n\n'
# Find the 'server {' line
idx = conf.find('    server {')
if idx == -1:
    idx = conf.find('server {')
if idx > 0:
    conf = conf[:idx] + upstream + conf[idx:]
    with open(nginx_conf_path, 'w') as f:
        f.write(conf)
    print(f'[NGINX] ADDED: upstream {upstream_name} -> {app_name}:{container_port}')
else:
    print('[NGINX] WARN: could not find server block to insert upstream')
" "$nginx_conf" "$upstream_name" "$app_name" "$container_port" 2>/dev/null || echo "[NGINX] WARN: could not inject upstream"
    changes_made=1
  fi

  # Check if location blocks already exist
  if grep -q "location /${app_name}/" "$nginx_conf" 2>/dev/null; then
    echo "[NGINX] SKIP: location /${app_name}/ already exists"
  else
    # Insert location blocks before the last closing brace of server block
    local location_block
    location_block="$(generate_nginx_locations "$app_name")"

    printf '%s' "$location_block" | python3 -c "
import sys
nginx_conf_path = sys.argv[1]
app_name = sys.argv[2]
location_block = sys.stdin.read() + '\n'
conf = open(nginx_conf_path).read()
# Insert before the last '}' in the server block (second-to-last '}' in file)
# Find the last '}' on its own line
lines = conf.split('\n')
# Find the line with just '    }' or '}' that closes the server block
insert_idx = -1
brace_count = 0
for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped == '}':
        insert_idx = i
# Insert before the second-to-last '}'
closing_indices = [i for i, l in enumerate(lines) if l.strip() == '}']
if len(closing_indices) >= 2:
    insert_idx = closing_indices[-2]
elif closing_indices:
    insert_idx = closing_indices[-1]

if insert_idx > 0:
    lines.insert(insert_idx, location_block)
    with open(nginx_conf_path, 'w') as f:
        f.write('\n'.join(lines))
    print(f'[NGINX] ADDED: location blocks for /{app_name}/')
else:
    print('[NGINX] WARN: could not find server closing brace')
" "$nginx_conf" "$app_name" 2>/dev/null || echo "[NGINX] WARN: could not inject location blocks"
    changes_made=1
  fi

  return $changes_made
}

# Validate nginx config before reloading
# Returns 0 if valid, 1 if invalid
validate_nginx_config() {
  local server="$1"
  local result
  result=$(ssh "root@${server}" "docker exec \$(docker ps -q -f name=nginx) nginx -t 2>&1" 2>/dev/null || echo "FAIL")

  if echo "$result" | grep -q "syntax is ok"; then
    echo "[NGINX] Config validation: OK"
    return 0
  else
    echo "[NGINX] Config validation: FAILED"
    echo "$result" | sed 's/^/  /'
    return 1
  fi
}

# Safe reload: validate first, then reload
safe_nginx_reload() {
  local server="$1"
  if validate_nginx_config "$server"; then
    ssh "root@${server}" "docker exec \$(docker ps -q -f name=nginx) nginx -s reload" 2>/dev/null
    echo "[NGINX] Reloaded successfully"
    return 0
  else
    echo "[NGINX] ABORT: not reloading due to config error"
    return 1
  fi
}
