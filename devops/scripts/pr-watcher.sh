#!/usr/bin/env bash
# ============================================================
# PR Watcher — Polling loop for PR detection and dispatch
# ============================================================
# Polls GitHub every 60 seconds for new/updated PRs targeting
# main. Dispatches pr-processor.sh for each new or updated PR.
# Tracks processed PRs in pr-state.json to avoid re-processing.
#
# Usage: pr-watcher.sh  (no arguments, runs as daemon)
#
# Environment:
#   POLL_INTERVAL    — Seconds between polls (default: 60)
#   GITHUB_REPO      — Owner/repo (auto-detected if not set)
#   AGENT_GITHUB_USER — Bot GitHub username to skip own PRs
# ============================================================

set -euo pipefail

# --- Resolve paths ---
REPO_ROOT="$(git rev-parse --show-toplevel)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="${REPO_ROOT}/devops/config/pr-state.json"
POLL_INTERVAL="${POLL_INTERVAL:-60}"

# --- Detect GitHub repo if not set ---
if [ -z "${GITHUB_REPO:-}" ]; then
  GITHUB_REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")
fi

if [ -z "$GITHUB_REPO" ]; then
  echo "=== PR-WATCHER: ERROR — Cannot detect GitHub repo. Set GITHUB_REPO env var. ==="
  exit 1
fi

# --- Ensure state file exists ---
if [ ! -f "$STATE_FILE" ]; then
  echo "{}" > "$STATE_FILE"
fi

# --- Graceful shutdown ---
shutdown() {
  echo "=== PR-WATCHER: Shutting down gracefully ==="
  exit 0
}
trap shutdown SIGTERM SIGINT

echo "=== PR-WATCHER: Starting. Polling every ${POLL_INTERVAL}s ==="
echo "=== PR-WATCHER: Repo: ${GITHUB_REPO} ==="
echo "=== PR-WATCHER: State file: ${STATE_FILE} ==="

# ============================================================
# State file helpers (all use python3 for JSON)
# ============================================================

# Read the full state JSON from file
read_pr_state() {
  python3 -c "
import json
with open('${STATE_FILE}') as f:
    print(json.dumps(json.load(f)))
"
}

# Get status for a specific PR number (empty string if not found)
get_pr_status() {
  local pr_num="$1"
  python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    state = json.load(f)
entry = state.get(sys.argv[2], {})
print(entry.get('status', ''))
" "$STATE_FILE" "$pr_num"
}

# Get headSha for a specific PR number (empty string if not found)
get_pr_sha() {
  local pr_num="$1"
  python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    state = json.load(f)
entry = state.get(sys.argv[2], {})
print(entry.get('headSha', ''))
" "$STATE_FILE" "$pr_num"
}

# Update a single PR entry in the state file
update_pr_state() {
  local pr_num="$1"
  local status="$2"
  local head_sha="$3"
  local result="${4:-}"

  python3 -c "
import json, sys
from datetime import datetime, timezone

state_file = sys.argv[1]
with open(state_file) as f:
    state = json.load(f)

state[sys.argv[2]] = {
    'status': sys.argv[3],
    'headSha': sys.argv[4],
    'processedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'result': sys.argv[5] if len(sys.argv) > 5 else ''
}

with open(state_file, 'w') as f:
    json.dump(state, f, indent=2)
    f.write('\n')
" "$STATE_FILE" "$pr_num" "$status" "$head_sha" "$result"
}

# ============================================================
# Poll function
# ============================================================
poll_for_prs() {
  echo "=== PR-WATCHER: Polling for open PRs ==="

  # List open PRs targeting main
  PR_LIST_JSON=$(gh pr list --base main --state open --json number,headRefName,headRefOid,author,title 2>/dev/null || echo "[]")

  # Parse and process each PR
  PR_COUNT=$(echo "$PR_LIST_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(len(data))
" 2>/dev/null || echo "0")

  if [ "$PR_COUNT" = "0" ]; then
    echo "=== PR-WATCHER: No open PRs found ==="
    return
  fi

  echo "=== PR-WATCHER: Found ${PR_COUNT} open PR(s) ==="

  # Process each PR
  local idx=0
  while [ "$idx" -lt "$PR_COUNT" ]; do
    # Extract PR details using python3
    PR_INFO=$(echo "$PR_LIST_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
pr = data[int(sys.argv[1])]
print(pr['number'])
print(pr.get('headRefOid', ''))
print(pr.get('author', {}).get('login', ''))
print(pr.get('title', ''))
" "$idx" 2>/dev/null)

    PR_NUM=$(echo "$PR_INFO" | sed -n '1p')
    PR_SHA=$(echo "$PR_INFO" | sed -n '2p')
    PR_AUTHOR_LOGIN=$(echo "$PR_INFO" | sed -n '3p')
    PR_TITLE_TEXT=$(echo "$PR_INFO" | sed -n '4p')

    idx=$((idx + 1))

    echo "=== PR-WATCHER: Checking PR #${PR_NUM} (${PR_SHA:0:7}) by ${PR_AUTHOR_LOGIN} ==="

    # Skip bot-authored PRs (check AGENT_GITHUB_USER or [DevOps] in title)
    if [ -n "${AGENT_GITHUB_USER:-}" ] && [ "$PR_AUTHOR_LOGIN" = "$AGENT_GITHUB_USER" ]; then
      echo "=== PR-WATCHER: Skipping PR #${PR_NUM} — authored by agent account ==="
      continue
    fi

    # Also skip if title starts with [DevOps]
    case "$PR_TITLE_TEXT" in
      \[DevOps\]*)
        echo "=== PR-WATCHER: Skipping PR #${PR_NUM} — [DevOps] title prefix ==="
        continue
        ;;
    esac

    # Check state: skip if already merged or escalated
    CURRENT_STATUS=$(get_pr_status "$PR_NUM")
    if [ "$CURRENT_STATUS" = "merged" ] || [ "$CURRENT_STATUS" = "escalated" ]; then
      echo "=== PR-WATCHER: Skipping PR #${PR_NUM} — already ${CURRENT_STATUS} ==="
      continue
    fi

    # Check state: skip if same headSha (no new commits)
    STORED_SHA=$(get_pr_sha "$PR_NUM")
    if [ "$STORED_SHA" = "$PR_SHA" ]; then
      echo "=== PR-WATCHER: Skipping PR #${PR_NUM} — no new commits since last processing ==="
      continue
    fi

    # New or updated PR — extract affected apps and dispatch agent
    echo "=== PR-WATCHER: Processing PR #${PR_NUM} ==="
    update_pr_state "$PR_NUM" "processing" "$PR_SHA" ""

    # Extract affected app names from PR changed files
    AFFECTED_APPS=$(gh pr diff "$PR_NUM" --name-only 2>/dev/null \
      | grep '^apps/' \
      | cut -d'/' -f2 \
      | sort -u \
      || echo "")

    if [[ -z "$AFFECTED_APPS" ]]; then
      echo "=== PR-WATCHER: PR #${PR_NUM} has no changes in apps/ — skipping deployment ==="
      update_pr_state "$PR_NUM" "skipped" "$PR_SHA" "no-apps-changes"
      continue
    fi

    PR_CONTEXT="PR #${PR_NUM}: ${PR_TITLE_TEXT} (by ${PR_AUTHOR_LOGIN})"
    ALL_SUCCEEDED=true

    while IFS= read -r app; do
      [[ -z "$app" ]] && continue
      echo "=== PR-WATCHER: Dispatching trigger.sh for app: ${app} ==="
      if "${SCRIPT_DIR}/trigger.sh" "$app" --context "$PR_CONTEXT"; then
        echo "=== PR-WATCHER: App ${app} deployed successfully ==="
      else
        echo "=== PR-WATCHER: App ${app} deployment failed ==="
        ALL_SUCCEEDED=false
      fi
    done <<< "$AFFECTED_APPS"

    if [[ "$ALL_SUCCEEDED" == "true" ]]; then
      update_pr_state "$PR_NUM" "merged" "$PR_SHA" "success"
      echo "=== PR-WATCHER: PR #${PR_NUM} — all apps deployed successfully ==="
    else
      update_pr_state "$PR_NUM" "escalated" "$PR_SHA" "partial-failure"
      echo "=== PR-WATCHER: PR #${PR_NUM} — some apps failed (escalated) ==="
    fi

  done
}

# ============================================================
# Main polling loop
# ============================================================
while true; do
  poll_for_prs
  echo "=== PR-WATCHER: Sleeping ${POLL_INTERVAL}s ==="
  sleep "$POLL_INTERVAL"
done
