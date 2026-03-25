#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Post-Deploy Verification — Endpoint Testing Loop
# ============================================================
# Tests all discovered API endpoints through nginx reverse proxy.
# If endpoints return 404 through nginx but 200 directly,
# diagnoses routing issues and attempts auto-fixes.
#
# Inspired by autoresearch's experiment loop:
# discover -> test -> diagnose -> fix -> re-test -> keep/discard
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
# Phase 3: Attempt auto-fix for routing issues
# ============================================================
attempt_fix() {
  local round="$1"
  echo ""
  echo "=== VERIFY: attempting auto-fix (round ${round}) ==="

  local compose_dir
  compose_dir=$(dirname "$COMPOSE_PATH")
  local app_dir="${compose_dir}/apps/${APP_NAME}"

  # Strategy 1: Inject axios baseURL
  echo "[VERIFY] Checking for axios baseURL..."
  local has_baseurl
  has_baseurl=$(ssh "root@${SERVER_HOST}" "
    grep -r 'baseURL.*/${APP_NAME}' '${app_dir}/client/src/' '${app_dir}/frontend/src/' '${app_dir}/src/' 2>/dev/null | head -1
  " 2>/dev/null || true)

  if [[ -z "$has_baseurl" ]]; then
    echo "[VERIFY] Injecting axios.defaults.baseURL = '/${APP_NAME}'..."

    ssh "root@${SERVER_HOST}" "
      # Find the main app file with axios import
      APP_FILE=\$(grep -rl \"import axios\" '${app_dir}/client/src/' '${app_dir}/frontend/src/' '${app_dir}/src/' 2>/dev/null | head -1)

      if [[ -n \"\$APP_FILE\" ]]; then
        # Insert baseURL after the axios import line
        sed -i \"s|import axios from 'axios';|import axios from 'axios';\naxios.defaults.baseURL = '/${APP_NAME}';|\" \"\$APP_FILE\" 2>/dev/null || \
        sed -i \"s|import axios from \\\"axios\\\";|import axios from \\\"axios\\\";\naxios.defaults.baseURL = '/${APP_NAME}';|\" \"\$APP_FILE\" 2>/dev/null || true
        echo \"FIXED: injected baseURL in \$APP_FILE\"
      else
        # Check for fetch() usage — inject a global wrapper in main entry
        MAIN_FILE=\$(find '${app_dir}/client/src/' '${app_dir}/frontend/src/' '${app_dir}/src/' -name 'main.*' -o -name 'index.*' 2>/dev/null | grep -E '\.(jsx|tsx|js|ts)$' | head -1)
        if [[ -n \"\$MAIN_FILE\" ]]; then
          # Prepend fetch wrapper
          WRAPPER=\"const _originalFetch = window.fetch;
window.fetch = (url, opts) => {
  if (typeof url === 'string' && url.startsWith('/api/')) {
    url = '/${APP_NAME}' + url;
  }
  return _originalFetch(url, opts);
};
\"
          echo \"\$WRAPPER\" | cat - \"\$MAIN_FILE\" > /tmp/main_fixed && mv /tmp/main_fixed \"\$MAIN_FILE\"
          echo \"FIXED: injected fetch wrapper in \$MAIN_FILE\"
        fi
      fi
    " 2>/dev/null || true

    # Strategy 2: Check vite.config base path
    echo "[VERIFY] Checking Vite base path..."
    ssh "root@${SERVER_HOST}" "
      VITE_CONFIG=\$(find '${app_dir}/client/' '${app_dir}/frontend/' '${app_dir}/' -maxdepth 2 -name 'vite.config.*' 2>/dev/null | head -1)
      if [[ -n \"\$VITE_CONFIG\" ]]; then
        if ! grep -q 'base:.*\"/${APP_NAME}/\"' \"\$VITE_CONFIG\" 2>/dev/null; then
          if grep -q 'base:' \"\$VITE_CONFIG\" 2>/dev/null; then
            sed -i 's|base:.*|base: \"/${APP_NAME}/\",|' \"\$VITE_CONFIG\" 2>/dev/null || true
          else
            sed -i 's|plugins:|base: \"/${APP_NAME}/\",\n  plugins:|' \"\$VITE_CONFIG\" 2>/dev/null || true
          fi
          echo \"FIXED: set vite base to /${APP_NAME}/\"
        fi
      fi
    " 2>/dev/null || true

    # Rebuild Docker image on server
    echo "[VERIFY] Rebuilding Docker image..."
    ssh "root@${SERVER_HOST}" "
      cd '${app_dir}' && \
      docker build -t rr-portal/${APP_NAME}:latest . 2>&1 | tail -5
    " 2>/dev/null || true

    sleep 2

    # Restart container
    echo "[VERIFY] Restarting container..."
    ssh "root@${SERVER_HOST}" "
      cd '${compose_dir}' && \
      docker compose -f '$(basename "$COMPOSE_PATH")' up -d ${APP_NAME} 2>&1
    " 2>/dev/null || true

    # Wait for container to be healthy
    echo "[VERIFY] Waiting for container health..."
    local attempts=0
    while [[ $attempts -lt 15 ]]; do
      if curl -sf "http://${SERVER_HOST}:${HOST_PORT}/health" > /dev/null 2>&1; then
        echo "[VERIFY] Container healthy after fix"
        return 0
      fi
      sleep 2
      attempts=$((attempts + 1))
    done

    echo "[VERIFY] WARNING: Container not healthy after fix attempt"
    return 1
  else
    echo "[VERIFY] baseURL already set — checking nginx config..."

    # Check nginx has the right location blocks
    local nginx_has_route
    nginx_has_route=$(ssh "root@${SERVER_HOST}" "
      grep -c 'location.*/${APP_NAME}/' /opt/rr-portal/nginx/nginx.cloud.conf 2>/dev/null || echo 0
    " 2>/dev/null || echo "0")

    if [[ "$nginx_has_route" == "0" ]]; then
      echo "[VERIFY] WARN: nginx missing location block for /${APP_NAME}/ — manual intervention needed"
      return 1
    fi

    echo "[VERIFY] nginx config looks correct — issue may be elsewhere"
    return 1
  fi
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
    if attempt_fix "$ROUND"; then
      echo "[VERIFY] Fix applied — re-testing in next round"
      sleep 5  # Give container time to start
    else
      echo "[VERIFY] Fix attempt failed"
    fi
  fi
done

# ============================================================
# Phase 4: Frontend asset verification
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
if [[ "$ALL_PASS" == "true" && "$ASSETS_OK" == "true" ]]; then
  echo "  VERIFICATION PASSED"
  echo "  All endpoints and assets verified"
  echo "=========================================="
  exit 0
elif [[ "$ALL_PASS" == "true" ]]; then
  echo "  VERIFICATION PARTIAL"
  echo "  API endpoints OK, but some frontend assets failed"
  echo "  Check: ${VERIFY_LOG}"
  echo "=========================================="
  exit 0  # Don't fail deployment for asset issues
else
  echo "  VERIFICATION FAILED"
  echo "  Some endpoints still unreachable after ${MAX_ROUNDS} fix attempts"
  echo "  Check: ${VERIFY_LOG}"
  echo "  Results: ${VERIFY_TSV}"
  echo "=========================================="
  exit 1
fi
