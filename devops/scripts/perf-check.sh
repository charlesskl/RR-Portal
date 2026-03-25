#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Performance Check — Response time monitoring
# ============================================================
# Measures response times for all active apps and alerts
# when responses are slow. Can run periodically via cron.
#
# Usage: perf-check.sh [--alert-threshold-ms 2000]
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

source "${SCRIPT_DIR}/utils/telegram.sh"

if [[ -z "${DEPLOY_SERVER:-}" ]]; then
  echo "ERROR: DEPLOY_SERVER not set"
  exit 1
fi

DEPLOY_SERVER_HOST="${DEPLOY_SERVER#*@}"
ALERT_THRESHOLD_MS="${1:-2000}"  # Default: alert if response > 2 seconds

mkdir -p "${REPO_ROOT}/devops/logs"
PERF_TSV="${REPO_ROOT}/devops/logs/performance.tsv"

# Create header if needed
if [[ ! -f "$PERF_TSV" ]]; then
  printf "timestamp\tapp\tendpoint\thttp_status\tresponse_ms\tresult\n" > "$PERF_TSV"
fi

echo "=== PERFORMANCE CHECK ==="
echo "Threshold: ${ALERT_THRESHOLD_MS}ms"
echo ""

# Read active apps
APPS_FILE="${REPO_ROOT}/devops/config/apps.json"
if [[ ! -f "$APPS_FILE" ]]; then
  echo "ERROR: apps.json not found"
  exit 0
fi

APPS=$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
for name, info in d.items():
    if info.get('status') == 'active':
        print(f'{name}:{info[\"port\"]}')
" "$APPS_FILE" 2>/dev/null || true)

SLOW_APPS=""

for entry in $APPS; do
  app="${entry%%:*}"
  port="${entry##*:}"

  # Measure health endpoint response time
  RESPONSE=$(curl -sf -o /dev/null -w '%{http_code} %{time_total}' \
    --max-time 10 "http://${DEPLOY_SERVER_HOST}:${port}/health" 2>/dev/null || echo "000 0")

  HTTP_CODE=$(echo "$RESPONSE" | awk '{print $1}')
  TIME_TOTAL=$(echo "$RESPONSE" | awk '{print $2}')
  TIME_MS=$(python3 -c "import sys; print(int(float(sys.argv[1]) * 1000))" "$TIME_TOTAL" 2>/dev/null || echo "0")

  if [[ "$HTTP_CODE" == "200" ]]; then
    if [[ "$TIME_MS" -gt "$ALERT_THRESHOLD_MS" ]]; then
      echo "  [SLOW] ${app}: ${TIME_MS}ms (threshold: ${ALERT_THRESHOLD_MS}ms)"
      SLOW_APPS="${SLOW_APPS}${app} (${TIME_MS}ms), "
      RESULT="slow"
    else
      echo "  [OK]   ${app}: ${TIME_MS}ms"
      RESULT="ok"
    fi
  else
    echo "  [DOWN] ${app}: HTTP ${HTTP_CODE}"
    RESULT="down"
    TIME_MS=0
  fi

  # Log to TSV
  printf "%s\t%s\t/health\t%s\t%s\t%s\n" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$app" "$HTTP_CODE" "$TIME_MS" "$RESULT" >> "$PERF_TSV"
done

# Alert on slow apps
if [[ -n "$SLOW_APPS" ]]; then
  send_telegram "Slow response detected: ${SLOW_APPS%,*}. Threshold: ${ALERT_THRESHOLD_MS}ms."
fi

echo ""
echo "=== PERFORMANCE CHECK COMPLETE ==="
