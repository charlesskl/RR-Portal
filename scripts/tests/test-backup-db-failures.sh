#!/usr/bin/env bash
set -euo pipefail
export PATH="/usr/bin:/bin:$PATH"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

mkdir -p "$TMP_ROOT/repo/devops/scripts/utils" "$TMP_ROOT/bin"
cp "$ROOT/devops/scripts/backup-db.sh" "$TMP_ROOT/repo/devops/scripts/backup-db.sh"
cp "$ROOT/devops/scripts/utils/telegram.sh" "$TMP_ROOT/repo/devops/scripts/utils/telegram.sh"

cat > "$TMP_ROOT/bin/ssh" <<'MOCK_SSH'
#!/usr/bin/env bash
set -euo pipefail

remote="${!#}"
case "$remote" in
  *"docker ps --format"*)
    printf '%s\n' 'rr-portal-db-1'
    ;;
  *"pg_dumpall"*)
    if [[ "${BACKUP_SCENARIO}" == "postgres-fail" ]]; then
      printf '%s\n' 'FAIL'
    else
      printf '%s\n' 'OK:1K'
    fi
    ;;
  *"stat -c %s"*)
    if [[ "${BACKUP_SCENARIO}" == "postgres-empty" ]]; then
      printf '%s\n' '0'
    else
      printf '%s\n' '1024'
    fi
    ;;
  *"bash -s"*)
    cat >/dev/null
    if [[ "${BACKUP_SCENARIO}" == "sql-fail" ]]; then
      printf '%s\n' 'SQL_FAIL'
    else
      printf '%s\n' 'SQL_SKIP'
    fi
    ;;
  *)
    ;;
esac
MOCK_SSH
chmod +x "$TMP_ROOT/bin/ssh"

run_backup() {
  local scenario="$1"
  local output="$TMP_ROOT/${scenario}.out"
  local status

  set +e
  PATH="$TMP_ROOT/bin:$PATH" \
    BACKUP_SCENARIO="$scenario" \
    DEPLOY_SERVER='mock-server' \
    TELEGRAM_DRY_RUN=true \
    "$TMP_ROOT/repo/devops/scripts/backup-db.sh" >"$output" 2>&1
  status=$?
  set -e

  printf '%s' "$status"
}

assert_nonzero() {
  local scenario="$1"
  local status
  status="$(run_backup "$scenario")"
  if [[ "$status" -eq 0 ]]; then
    echo "Expected $scenario to return nonzero" >&2
    cat "$TMP_ROOT/${scenario}.out" >&2
    exit 1
  fi
}

assert_zero() {
  local scenario="$1"
  local status
  status="$(run_backup "$scenario")"
  if [[ "$status" -ne 0 ]]; then
    echo "Expected $scenario to return zero" >&2
    cat "$TMP_ROOT/${scenario}.out" >&2
    exit 1
  fi
}

assert_nonzero postgres-fail
assert_nonzero postgres-empty
assert_nonzero sql-fail
assert_zero sql-skip

grep -q 'WARNING: indo-sqlserver container is not running' "$TMP_ROOT/sql-skip.out"
echo 'backup-db failure simulations OK'
