#!/usr/bin/env bash
# ============================================================
# Audit Log Utility — Track deployment history
# ============================================================
# Records every deployment action to a persistent audit log.
# Supports: deploy, rollback, onboard, restart, cleanup events.
#
# Usage: source this file, then call:
#   audit_log <event-type> <app-name> <details>
# ============================================================

AUDIT_FILE="${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || echo '.')}/devops/logs/audit.tsv"

# Initialize audit log if needed
init_audit_log() {
  if [[ ! -f "$AUDIT_FILE" ]]; then
    mkdir -p "$(dirname "$AUDIT_FILE")"
    printf "timestamp\tevent\tapp\tcommit\tuser\tdetails\n" > "$AUDIT_FILE"
  fi
}

# Log an event
# audit_log <event> <app> <details>
audit_log() {
  local event="${1:-unknown}"
  local app="${2:-unknown}"
  local details="${3:-}"

  init_audit_log

  local timestamp
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  local commit_hash
  commit_hash="$(git rev-parse --short HEAD 2>/dev/null || echo 'n/a')"

  local user
  user="$(whoami 2>/dev/null || echo 'agent')"

  printf "%s\t%s\t%s\t%s\t%s\t%s\n" \
    "$timestamp" "$event" "$app" "$commit_hash" "$user" "$details" >> "$AUDIT_FILE"
}

# Convenience functions
audit_deploy() { audit_log "deploy" "$1" "${2:-deployed successfully}"; }
audit_rollback() { audit_log "rollback" "$1" "${2:-rolled back to previous}"; }
audit_onboard() { audit_log "onboard" "$1" "${2:-onboarded to portal}"; }
audit_restart() { audit_log "restart" "$1" "${2:-auto-restarted by health check}"; }
audit_cleanup() { audit_log "cleanup" "-" "${1:-routine maintenance}"; }
audit_backup() { audit_log "backup" "db" "${1:-database backup}"; }
