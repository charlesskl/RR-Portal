#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Post-Deploy Verification — Endpoint Testing Loop
# ============================================================
# Tests all discovered API endpoints through nginx reverse proxy.
# If endpoints return 404 through nginx but 200 directly,
# diagnoses routing issues and reports recommendations.
#
# REPORT-ONLY: This script never modifies production source files.
# Fix routing issues in source code and redeploy.
#
# Usage: verify-deploy.sh <app-name> <server-host> <host-port> <compose-path>
# Exit 0: All endpoints verified OK
# Exit 1: Verification failed after max attempts (escalation)
# ============================================================

APP_NAME="${1:?Usage: verify-deploy.sh <app-name> <server-host> <host-port> <compose-path>}"
SERVER_HOST="${2:?Missing server-host}"
HOST_PORT="${3:?Missing host-port}"
COMPOSE_PATH="${4:?Missing compose-path}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Source utilities
source "${SCRIPT_DIR}/utils/telegram.sh"

# --- Logging setup ---
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "${REPO_ROOT}/devops/logs"
VERIFY_LOG="${REPO_ROOT}/devops/logs/verify-${APP_NAME}-${TIMESTAMP}.log"
VERIFY_TSV="${REPO_ROOT}/devops/logs/verification.tsv"

# Create TSV header if file doesn't exist
if [[ ! -f "$VERIFY_TSV" ]]; then
  printf "timestamp\tapp\tendpoint\tnginx_status\tdirect_status\tresult\tfix_applied\n" > "$VERIFY_TSV"
fi

# Log to both stdout and file
exec > >(tee -a "${VERIFY_LOG}") 2>&1

MAX_ROUNDS=3
ROUND=0
ALL_PASS=false

echo "=========================================="
echo "  Endpoint Verification — ${APP_NAME}"
echo "=========================================="
echo ""
echo "Server: ${SERVER_HOST}"
echo "Port: ${HOST_PORT}"
echo "Compose: ${COMPOSE_PATH}"
echo ""

# ============================================================
# Phase 1: Discover API endpoints
# ============================================================
discover_endpoints() {
  local endpoints=()

  echo "=== VERIFY: discovering API endpoints ==="

  # Fetch the app's HTML through nginx (with basic auth from .htpasswd)
  # We test without auth first, then with common auth
  local html=""
  html=$(curl -sf "http://${SERVER_HOST}:${HOST_PORT}/" 2>/dev/null || true)

  if [[ -z "$html" ]]; then
    # Try through nginx sub-path (without auth — we test direct port)
    html=$(curl -sf "http://${SERVER_HOST}:${HOST_PORT}/" 2>/dev/null || true)
  fi

  if [[ -z "$html" ]]; then
    echo "[VERIFY] WARN: Could not fetch app HTML, trying to discover from source"
  fi

  # Extract JS bundle paths from HTML
  local js_urls=()
  if [[ -n "$html" ]]; then
    while IFS= read -r line; do
      [[ -n "$line" ]] && js_urls+=("$line")
    done < <(echo "$html" | grep -oE 'src="[^"]*\.js"' | sed 's/src="//;s/"//' || true)
  fi

  # Fetch each JS bundle and extract API paths
  for js_url in "${js_urls[@]}"; do
    local full_url=""
    if [[ "$js_url" == http* ]]; then
      full_url="$js_url"
    elif [[ "$js_url" == /* ]]; then
      full_url="http://${SERVER_HOST}:${HOST_PORT}${js_url}"
    else
      full_url="http://${SERVER_HOST}:${HOST_PORT}/${js_url}"
    fi

    local js_content=""
    js_content=$(curl -sf "$full_url" 2>/dev/null || true)

    if [[ -n "$js_content" ]]; then
      # Extract /api/ patterns from the bundle
      while IFS= read -r api_path; do
        [[ -n "$api_path" ]] && endpoints+=("$api_path")
      done < <(echo "$js_content" | grep -oE '"/api/[a-zA-Z0-9_/-]*"' | tr -d '"' | sort -u || true)

      while IFS= read -r api_path; do
        [[ -n "$api_path" ]] && endpoints+=("$api_path")
      done < <(echo "$js_content" | grep -oE "'/api/[a-zA-Z0-9_/-]*'" | tr -d "'" | sort -u || true)
    fi
  done

  # Also try to discover from the app source on the server
  local remote_endpoints=""
  remote_endpoints=$(ssh "root@${SERVER_HOST}" "
    APP_DIR=\$(dirname '${COMPOSE_PATH}')/apps/${APP_NAME}
    if [[ -d \"\$APP_DIR\" ]]; then
      grep -rhoE '\"/api/[a-zA-Z0-9_/-]*\"' \"\$APP_DIR\" --include='*.js' --include='*.jsx' --include='*.ts' --include='*.tsx' --include='*.vue' 2>/dev/null | tr -d '\"' | sort -u
      grep -rhoE \"'/api/[a-zA-Z0-9_/-]*'\" \"\$APP_DIR\" --include='*.js' --include='*.jsx' --include='*.ts' --include='*.tsx' --include='*.vue' 2>/dev/null | tr -d \"'\" | sort -u
    fi
  " 2>/dev/null || true)

  if [[ -n "$remote_endpoints" ]]; then
    while IFS= read -r ep; do
      [[ -n "$ep" ]] && endpoints+=("$ep")
    done <<< "$remote_endpoints"
  fi

  # Deduplicate
  local unique_endpoints=()
  local seen=""
  for ep in "${endpoints[@]}"; do
    if [[ "$seen" != *"|${ep}|"* ]]; then
      seen="${seen}|${ep}|"
      unique_endpoints+=("$ep")
    fi
  done

  if [[ ${#unique_endpoints[@]} -eq 0 ]]; then
    echo "[VERIFY] No API endpoints discovered — skipping verification"
    return 1
  fi

  echo "[VERIFY] Discovered ${#unique_endpoints[@]} endpoint(s):"
  for ep in "${unique_endpoints[@]}"; do
    echo "  - $ep"
  done

  # Write to temp file for the caller
  printf '%s\n' "${unique_endpoints[@]}" > /tmp/verify-endpoints-${APP_NAME}.txt
  return 0
}

# ============================================================
# Phase 2: Test endpoints through nginx vs direct
# ============================================================
test_endpoints() {
  local endpoints_file="/tmp/verify-endpoints-${APP_NAME}.txt"
  local all_pass=true
  local failures=()

  echo ""
  echo "=== VERIFY: testing endpoints ==="

  while IFS= read -r endpoint; do
    [[ -z "$endpoint" ]] && continue

    # Strip dynamic segments like :id for testing
    local test_endpoint="$endpoint"
    # Replace :param with a test value
    test_endpoint=$(echo "$test_endpoint" | sed 's/:[a-zA-Z_]*/test-id/g')

    # Test through nginx (sub-path routing)
    local nginx_url="http://${SERVER_HOST}/${APP_NAME}${test_endpoint}"
    local nginx_status
    nginx_status=$(curl -sf -o /dev/null -w '%{http_code}' "$nginx_url" 2>/dev/null || echo "000")

    # Test directly on container port
    local direct_url="http://${SERVER_HOST}:${HOST_PORT}${test_endpoint}"
    local direct_status
    direct_status=$(curl -sf -o /dev/null -w '%{http_code}' "$direct_url" 2>/dev/null || echo "000")

    local result="pass"
    local fix=""

    # nginx 401 means auth is blocking — that's expected, not a routing issue
    if [[ "$nginx_status" == "401" ]]; then
      result="pass (auth-gated)"
    elif [[ "$nginx_status" == "404" && "$direct_status" != "404" ]]; then
      result="FAIL (routing)"
      all_pass=false
      failures+=("$endpoint")
    elif [[ "$nginx_status" == "404" && "$direct_status" == "404" ]]; then
      result="pass (endpoint not implemented)"
    elif [[ "$nginx_status" == "000" ]]; then
      result="FAIL (unreachable)"
      all_pass=false
      failures+=("$endpoint")
    else
      result="pass"
    fi

    echo "  ${test_endpoint}: nginx=${nginx_status} direct=${direct_status} → ${result}"

    # Log to TSV
    printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      "$APP_NAME" \
      "$test_endpoint" \
      "$nginx_status" \
      "$direct_status" \
      "$result" \
      "$fix" >> "$VERIFY_TSV"

  done < "$endpoints_file"

  if [[ "$all_pass" == "true" ]]; then
    return 0
  else
    echo ""
    echo "[VERIFY] ${#failures[@]} endpoint(s) failed routing check"
    return 1
  fi
}

# ============================================================
# Phase 3: Diagnose routing issues (report-only, no auto-fix)
# ============================================================
diagnose_routing() {
  local round="$1"
  echo ""
  echo "=== VERIFY: diagnosing routing issues (round ${round}) ==="

  local compose_dir
  compose_dir=$(dirname "$COMPOSE_PATH")
  local app_dir="${compose_dir}/apps/${APP_NAME}"

  # Check 1: Does the app have axios baseURL configured?
  echo "[VERIFY] Checking for axios baseURL..."
  local has_baseurl
  has_baseurl=$(ssh "root@${SERVER_HOST}" "
    grep -r 'baseURL.*/${APP_NAME}' '${app_dir}/client/src/' '${app_dir}/frontend/src/' '${app_dir}/src/' 2>/dev/null | head -1
  " 2>/dev/null || true)

  if [[ -z "$has_baseurl" ]]; then
    echo "[VERIFY] ISSUE: No axios baseURL set for /${APP_NAME}"
    echo "[VERIFY] RECOMMENDATION: Add axios.defaults.baseURL = '/${APP_NAME}' to the app source"
  else
    echo "[VERIFY] OK: axios baseURL is configured"
  fi

  # Check 2: Does nginx have the right location block?
  echo "[VERIFY] Checking nginx config..."
  local nginx_has_route
  nginx_has_route=$(ssh "root@${SERVER_HOST}" "
    grep -c 'location.*/${APP_NAME}/' /opt/rr-portal/nginx/nginx.cloud.conf 2>/dev/null || echo 0
  " 2>/dev/null || echo "0")

  if [[ "$nginx_has_route" == "0" ]]; then
    echo "[VERIFY] ISSUE: nginx missing location block for /${APP_NAME}/"
    echo "[VERIFY] RECOMMENDATION: Add location /${APP_NAME}/ to nginx.cloud.conf"
  else
    echo "[VERIFY] OK: nginx has location block for /${APP_NAME}/"
  fi

  # Check 3: Vite base path
  echo "[VERIFY] Checking Vite base path..."
  local vite_base
  vite_base=$(ssh "root@${SERVER_HOST}" "
    VITE_CONFIG=\$(find '${app_dir}/client/' '${app_dir}/frontend/' '${app_dir}/' -maxdepth 2 -name 'vite.config.*' 2>/dev/null | head -1)
    if [[ -n \"\$VITE_CONFIG\" ]]; then
      grep 'base:' \"\$VITE_CONFIG\" 2>/dev/null || echo 'NO_BASE'
    else
      echo 'NO_VITE'
    fi
  " 2>/dev/null || echo "SKIP")

  case "$vite_base" in
    *NO_VITE*) echo "[VERIFY] INFO: No vite.config found (not a Vite app)" ;;
    *NO_BASE*) echo "[VERIFY] ISSUE: vite.config missing base path — should be '/${APP_NAME}/'" ;;
    *"/${APP_NAME}/"*) echo "[VERIFY] OK: Vite base path is set correctly" ;;
    *) echo "[VERIFY] WARN: Vite base path may be incorrect: $vite_base" ;;
  esac

  # Report-only: never modify production source files
  echo ""
  echo "[VERIFY] NOTE: This script is report-only. Fix routing issues in source code and redeploy."
  return 1
}

# ============================================================
# Main verification loop (autoresearch-style)
# ============================================================

# Phase 1: Discover
if ! discover_endpoints; then
  echo ""
  echo "[VERIFY] PASS: No API endpoints to verify"
  exit 0
fi

# Phase 2-3: Test + Fix loop
while [[ $ROUND -lt $MAX_ROUNDS ]]; do
  ROUND=$((ROUND + 1))
  echo ""
  echo "=== VERIFY: Round ${ROUND}/${MAX_ROUNDS} ==="

  if test_endpoints; then
    ALL_PASS=true
    break
  fi

  if [[ $ROUND -lt $MAX_ROUNDS ]]; then
    diagnose_routing "$ROUND"
    echo "[VERIFY] Routing issues reported — re-testing in case of transient failure"
    sleep 5  # Give container time to stabilize
  fi
done

# ============================================================
# Phase 4: Deep container health checks
# ============================================================
verify_container_health() {
  echo ""
  echo "=== VERIFY: deep container health checks ==="

  local compose_dir
  compose_dir=$(dirname "$COMPOSE_PATH")
  local failures=0

  # --- 4a: Container log error scan ---
  echo "[VERIFY] Scanning container logs for errors..."
  local error_lines
  error_lines=$(ssh "root@${SERVER_HOST}" \
    "docker logs ${APP_NAME} 2>&1 | tail -50 | grep -iE 'error|ENOENT|EACCES|refused|fatal|cannot find|MODULE_NOT_FOUND|ECONNREFUSED' | head -10" \
    2>/dev/null || true)

  if [[ -n "$error_lines" ]]; then
    echo "[VERIFY] WARN: Found error patterns in container logs:"
    echo "$error_lines" | while IFS= read -r line; do echo "  ! $line"; done

    # Classify severity: some errors are expected (e.g., "connection refused" during startup)
    if echo "$error_lines" | grep -qiE 'ENOENT.*data|MODULE_NOT_FOUND|Cannot find module|EACCES'; then
      echo "[VERIFY] FAIL: Critical errors detected (missing files or permissions)"
      failures=$((failures + 1))
    else
      echo "[VERIFY] INFO: Errors appear non-critical (may be startup transients)"
    fi
  else
    echo "[VERIFY] OK: No error patterns in recent container logs"
  fi

  # --- 4b: Volume mount verification ---
  echo "[VERIFY] Checking volume mounts..."
  local volume_check
  volume_check=$(ssh "root@${SERVER_HOST}" \
    "docker exec ${APP_NAME} sh -c 'ls -la /app/data/ 2>/dev/null && echo VOLUME_OK || echo VOLUME_MISSING'" \
    2>/dev/null || echo "CONTAINER_UNREACHABLE")

  if echo "$volume_check" | grep -q "VOLUME_OK"; then
    local file_count
    file_count=$(ssh "root@${SERVER_HOST}" \
      "docker exec ${APP_NAME} sh -c 'find /app/data -maxdepth 1 -type f 2>/dev/null | wc -l'" \
      2>/dev/null || echo "0")
    echo "[VERIFY] OK: /app/data mounted (${file_count} file(s))"
  elif echo "$volume_check" | grep -q "VOLUME_MISSING"; then
    echo "[VERIFY] INFO: /app/data does not exist (may be expected for this app)"
  else
    echo "[VERIFY] WARN: Could not check volume mount (container may not be running)"
  fi

  # --- 4c: Write test (can the app write to its data directory?) ---
  echo "[VERIFY] Testing data directory write access..."
  local write_test
  write_test=$(ssh "root@${SERVER_HOST}" \
    "docker exec ${APP_NAME} sh -c 'echo test > /app/data/.write-test 2>/dev/null && rm /app/data/.write-test && echo WRITE_OK || echo WRITE_FAIL'" \
    2>/dev/null || echo "SKIP")

  case "$write_test" in
    *WRITE_OK*) echo "[VERIFY] OK: Data directory is writable" ;;
    *WRITE_FAIL*) echo "[VERIFY] WARN: Data directory is NOT writable (permission issue?)"
                  failures=$((failures + 1)) ;;
    *) echo "[VERIFY] INFO: Write test skipped (no /app/data or container not running)" ;;
  esac

  # --- 4d: SQLite WAL check (for better-sqlite3 / sqlite3 apps) ---
  local has_sqlite
  has_sqlite=$(ssh "root@${SERVER_HOST}" \
    "docker exec ${APP_NAME} sh -c 'ls /app/data/*.db /app/data/*.sqlite 2>/dev/null | head -1'" \
    2>/dev/null || true)

  if [[ -n "$has_sqlite" ]]; then
    echo "[VERIFY] SQLite database found: $has_sqlite"
    # Check if WAL mode files exist (indicates healthy SQLite with WAL)
    local wal_file="${has_sqlite}-wal"
    local wal_exists
    wal_exists=$(ssh "root@${SERVER_HOST}" \
      "docker exec ${APP_NAME} sh -c 'test -f \"${wal_file}\" && echo YES || echo NO'" \
      2>/dev/null || echo "SKIP")
    if [[ "$wal_exists" == "YES" ]]; then
      echo "[VERIFY] OK: SQLite WAL file exists (WAL mode active)"
    else
      echo "[VERIFY] INFO: No WAL file — SQLite may use default journal mode"
    fi

    # Try a simple integrity check
    local integrity
    integrity=$(ssh "root@${SERVER_HOST}" \
      "docker exec ${APP_NAME} sh -c 'test -f /usr/bin/sqlite3 && sqlite3 \"${has_sqlite}\" \"PRAGMA integrity_check\" 2>/dev/null || echo SKIP'" \
      2>/dev/null || echo "SKIP")
    if [[ "$integrity" == "ok" ]]; then
      echo "[VERIFY] OK: SQLite integrity check passed"
    elif [[ "$integrity" != "SKIP" ]]; then
      echo "[VERIFY] WARN: SQLite integrity: $integrity"
    fi
  fi

  # --- 4e: Seed data / critical file check ---
  # Check if known critical files exist (from QC-21 volume hints)
  local app_source="${REPO_ROOT}/apps/${APP_NAME}"
  [[ ! -d "$app_source" ]] && app_source="${REPO_ROOT}/plugins/${APP_NAME}"
  local hints_file=""
  [[ -f "$app_source/.volume-hints" ]] && hints_file="$app_source/.volume-hints"
  [[ -z "$hints_file" && -f "$app_source/server/.volume-hints" ]] && hints_file="$app_source/server/.volume-hints"

  if [[ -n "$hints_file" ]]; then
    echo "[VERIFY] Checking seed files from volume hints..."
    while IFS= read -r line; do
      [[ "$line" != SEED=* ]] && continue
      local seed_path="${line#SEED=}"
      local container_path="/app/$seed_path"
      local seed_check
      seed_check=$(ssh "root@${SERVER_HOST}" \
        "docker exec ${APP_NAME} sh -c 'test -f \"${container_path}\" && echo EXISTS || echo MISSING'" \
        2>/dev/null || echo "SKIP")
      if [[ "$seed_check" == "EXISTS" ]]; then
        echo "  [OK] ${seed_path}"
      elif [[ "$seed_check" == "MISSING" ]]; then
        echo "  [WARN] ${seed_path} — MISSING in container"
      fi
    done < "$hints_file"
  fi

  # --- Summary ---
  if [[ "$failures" -gt 0 ]]; then
    echo "[VERIFY] Deep health: ${failures} issue(s) found"
    return 1
  fi
  echo "[VERIFY] Deep health checks passed"
  return 0
}

# Run deep container health (non-blocking — reports warnings but doesn't fail deploy)
DEEP_HEALTH_OK=true
if ! verify_container_health; then
  DEEP_HEALTH_OK=false
fi

# ============================================================
# Phase 5: Frontend asset verification
# ============================================================
verify_frontend_assets() {
  echo ""
  echo "=== VERIFY: checking frontend assets ==="

  # Fetch the HTML page directly from the container
  local html
  html=$(curl -sf "http://${SERVER_HOST}:${HOST_PORT}/" 2>/dev/null || true)

  if [[ -z "$html" ]]; then
    echo "[VERIFY] WARN: could not fetch frontend HTML"
    return 0  # Non-blocking
  fi

  echo "[VERIFY] Frontend HTML loaded ($(echo "$html" | wc -c | tr -d ' ') bytes)"

  # Extract script and CSS URLs
  local asset_urls=()
  while IFS= read -r url; do
    [[ -n "$url" ]] && asset_urls+=("$url")
  done < <(echo "$html" | grep -oE '(src|href)="[^"]*\.(js|css)"' | sed 's/^[^"]*"//;s/"$//' || true)

  if [[ ${#asset_urls[@]} -eq 0 ]]; then
    echo "[VERIFY] No JS/CSS assets found in HTML"
    return 0
  fi

  local asset_failures=0
  for asset_url in "${asset_urls[@]}"; do
    local full_url=""
    if [[ "$asset_url" == http* ]]; then
      full_url="$asset_url"
    elif [[ "$asset_url" == /* ]]; then
      # Asset has absolute path — check if it's correctly prefixed
      full_url="http://${SERVER_HOST}:${HOST_PORT}${asset_url}"
    else
      full_url="http://${SERVER_HOST}:${HOST_PORT}/${asset_url}"
    fi

    local status
    status=$(curl -sf -o /dev/null -w '%{http_code}' "$full_url" 2>/dev/null || echo "000")

    if [[ "$status" == "200" ]]; then
      echo "  [OK] ${asset_url} → ${status}"
    else
      echo "  [FAIL] ${asset_url} → ${status}"
      asset_failures=$((asset_failures + 1))

      printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        "$APP_NAME" \
        "asset:${asset_url}" \
        "$status" \
        "-" \
        "FAIL (asset 404)" \
        "" >> "$VERIFY_TSV"
    fi
  done

  if [[ "$asset_failures" -gt 0 ]]; then
    echo "[VERIFY] ${asset_failures} asset(s) failed to load — likely a base path issue"
    return 1
  fi

  echo "[VERIFY] All ${#asset_urls[@]} frontend assets loaded successfully"
  return 0
}

# Run asset verification (non-blocking — doesn't fail the overall check)
ASSETS_OK=true
if ! verify_frontend_assets; then
  ASSETS_OK=false
fi

echo ""
echo "=========================================="
echo "  VERIFICATION SUMMARY — ${APP_NAME}"
echo "=========================================="
echo "  API endpoints:   $([ "$ALL_PASS" == "true" ] && echo "PASS" || echo "FAIL")"
echo "  Frontend assets: $([ "$ASSETS_OK" == "true" ] && echo "PASS" || echo "WARN")"
echo "  Deep health:     $([ "$DEEP_HEALTH_OK" == "true" ] && echo "PASS" || echo "WARN")"
echo "  Log: ${VERIFY_LOG}"
echo "=========================================="

if [[ "$ALL_PASS" == "true" ]]; then
  exit 0
else
  exit 1
fi
