#!/usr/bin/env bash
# ============================================================
# Telegram Notification Utility — Reusable notification
# functions for deployment and PR processing pipelines.
# ============================================================
# This file is sourced by other scripts (not executed directly).
#
# Functions:
#   send_telegram <message>                         — send notification via Telegram Bot API
#   format_deploy_success <app> <hash> <port>       — format success message
#   format_deploy_failure <app> <error>              — format failure message
#   format_escalation <app> <pr_number> <checks>    — format escalation message
#
# Environment:
#   TELEGRAM_BOT_TOKEN      — Bot token from @BotFather (required for delivery)
#   TELEGRAM_CHAT_ID        — Target chat/group ID (required for delivery)
#   TELEGRAM_DRY_RUN=true   — log to stderr instead of sending
# ============================================================

# ============================================================
# send_telegram — send a Telegram notification
# ============================================================
# Sends a direct HTTP POST to the Telegram Bot API.
# Also appends the message to a pending file for traceability.
#
# Notifications are best-effort: missing credentials or API
# errors produce a warning on stderr but never crash the caller.
#
# In dry-run mode (TELEGRAM_DRY_RUN=true), logs to stderr only.
#
# Usage: send_telegram "Your message here"
# ============================================================
send_telegram() {
  local message="$1"

  if [ "${TELEGRAM_DRY_RUN:-false}" = "true" ]; then
    echo "[TELEGRAM DRY-RUN] ${message}" >&2
    return 0
  fi

  # Resolve repo root for log file path
  local repo_root
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)")"

  # Ensure logs directory exists
  mkdir -p "${repo_root}/devops/logs"

  # Append to pending file for traceability
  echo "${message}" >> "${repo_root}/devops/logs/telegram-pending.txt"

  # Check for required credentials
  if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
    echo "[TELEGRAM WARNING] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping delivery" >&2
    return 0
  fi

  # Send via Telegram Bot API using --data-urlencode (avoids JSON escaping issues)
  local api_url="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage"

  if ! curl -sf --max-time 10 \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=${message}" \
    "${api_url}" > /dev/null 2>&1; then
    echo "[TELEGRAM WARNING] Failed to send message via Bot API" >&2
  fi

  return 0
}

# ============================================================
# format_deploy_success — format a deployment success message
# ============================================================
# Returns a plain-English success notification.
#
# Usage: msg=$(format_deploy_success "task-api" "abc1234" "3001")
# ============================================================
format_deploy_success() {
  local app_name="$1"
  local git_hash="$2"
  local host_port="$3"

  echo "${app_name} deployed successfully. Version: ${git_hash}. Running on port ${host_port}."
}

# ============================================================
# format_deploy_failure — format a deployment failure message
# ============================================================
# Returns a plain-English failure notification with rollback info.
#
# Usage: msg=$(format_deploy_failure "task-api" "Health check timed out")
# ============================================================
format_deploy_failure() {
  local app_name="$1"
  local error_description="$2"

  echo "${app_name} deployment failed. Rolling back to previous version. Error: ${error_description}"
}

# ============================================================
# format_escalation — format a PR escalation message
# ============================================================
# Returns a plain-English escalation notification when QC
# checks cannot be resolved after maximum fix attempts.
#
# Usage: msg=$(format_escalation "task-api" "42" "health, dockerfile")
# ============================================================
format_escalation() {
  local app_name="$1"
  local pr_number="$2"
  local failed_checks="$3"

  echo "${app_name} PR #${pr_number} needs manual attention. QC checks still failing after 5 rounds: ${failed_checks}. I've tried fixing these automatically but couldn't resolve them."
}
