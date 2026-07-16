#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/../.." && pwd)
RESTORE_SCRIPT="$REPO_ROOT/deploy/restore-factory-review-data.sh"
TEST_ROOT=$(mktemp -d)
MOCK_BIN="$TEST_ROOT/bin"
INSTALL_DIR="$TEST_ROOT/install"
CALL_LOG="$TEST_ROOT/calls.log"
RESTORE_MARKER="$TEST_ROOT/restore.marker"
BACKUP_PATH_FILE="$TEST_ROOT/backup.path"
BACKUP_MARKER='factory-review-backup-token'
mkdir -p "$MOCK_BIN" "$INSTALL_DIR/apps/PMC跟仓管/加工厂月度评审管理制度/pb_data"
: > "$INSTALL_DIR/apps/PMC跟仓管/加工厂月度评审管理制度/pb_data/data.db"
: > "$CALL_LOG"

cleanup() { rm -rf "$TEST_ROOT"; }
trap cleanup EXIT

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
assert_contains() { grep -Eq "$2" "$1" || fail "$3"; }
line_of() { grep -nE "$2" "$1" | head -n 1 | cut -d: -f1; }

cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "$CALL_LOG"
case "$1" in
  compose)
    if [[ " $* " == *' ps -q '* ]]; then printf 'factory-review-container\n'; fi
    ;;
  inspect)
    printf '%s\n' "${MOCK_HEALTH_STATUS:-healthy}"
    ;;
  run)
    [[ ${FAIL_DOCKER_RUN:-0} != 1 ]] || exit 75
    ;;
esac
MOCK

cat > "$MOCK_BIN/tar" <<'MOCK'
#!/usr/bin/env bash
printf 'tar %s\n' "$*" >> "$CALL_LOG"
archive=''
for ((index = 1; index <= $#; index++)); do
  argument=${!index}
  if [[ $argument == -*f* ]]; then next=$((index + 1)); archive=${!next}; break; fi
done
[[ -n $archive ]] || exit 2
case " $* " in
  *-c*|*--create*)
    [[ ${FAIL_TAR_CREATE:-0} != 1 ]] || exit 71
    /usr/bin/mkdir -p "$(dirname -- "$archive")"
    printf '%s\n' "$BACKUP_MARKER" > "$archive"
    printf '%s\n' "$archive" > "$BACKUP_PATH_FILE"
    ;;
  *-x*|*--extract*)
    [[ ${FAIL_TAR_EXTRACT:-0} != 1 ]] || exit 72
    [[ "$archive" == "$(<"$BACKUP_PATH_FILE")" ]] || exit 3
    grep -Fqx "$BACKUP_MARKER" "$archive" || exit 4
    /usr/bin/mkdir -p "${PB_DATA_DIR:?}"
    : > "$PB_DATA_DIR/data.db"
    : > "$RESTORE_MARKER"
    ;;
esac
MOCK

cat > "$MOCK_BIN/mkdir" <<'MOCK'
#!/usr/bin/env bash
printf 'mkdir %s\n' "$*" >> "$CALL_LOG"
[[ ${FAIL_MKDIR:-0} != 1 ]] || exit 70
/usr/bin/mkdir "$@"
MOCK

cat > "$MOCK_BIN/python3" <<'MOCK'
#!/usr/bin/env bash
printf 'python3 %s\n' "$*" >> "$CALL_LOG"
[[ ${FAIL_PYTHON:-0} != 1 ]] || { printf '%s\n' 'forced python sqlite failure' >&2; exit 73; }
exit 0
MOCK

cat > "$MOCK_BIN/flock" <<'MOCK'
#!/usr/bin/env bash
printf 'flock %s\n' "$*" >> "$CALL_LOG"
[[ ${FAIL_FLOCK:-0} != 1 ]] || exit 74
exit 0
MOCK

cat > "$MOCK_BIN/sleep" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK

chmod +x "$MOCK_BIN"/*
export BACKUP_PATH_FILE BACKUP_MARKER CALL_LOG RESTORE_MARKER

[[ -f "$RESTORE_SCRIPT" ]] || fail "restore script is missing: $RESTORE_SCRIPT"

PAYLOAD_GZ="$TEST_ROOT/payload.gz"
PAYLOAD_TEXT=$(printf 'const %s%s = {}; migrate((app) => {});\n' 'SN' 'APSHOT')
printf '%s' "$PAYLOAD_TEXT" | gzip -c > "$PAYLOAD_GZ"
PAYLOAD_SHA=$(sha256sum "$PAYLOAD_GZ" | awk '{print $1}')
PAYLOAD_B64=$(base64 < "$PAYLOAD_GZ" | tr -d '\r\n')
chunk_size=$(( (${#PAYLOAD_B64} + 2) / 3 ))
PART_1=${PAYLOAD_B64:0:chunk_size}
PART_2=${PAYLOAD_B64:chunk_size:chunk_size}
PART_3=${PAYLOAD_B64:chunk_size*2}

run_main() {
  local command=$1
  shift
  env \
  PATH="$MOCK_BIN:$PATH" \
  RESTORE_FACTORY_REVIEW_SOURCE_ONLY=1 \
  INSTALL_DIR="$INSTALL_DIR" \
  FACTORY_REVIEW_DATA_PART_1_B64="$PART_1" \
  FACTORY_REVIEW_DATA_PART_2_B64="$PART_2" \
  FACTORY_REVIEW_DATA_PART_3_B64="$PART_3" \
  FACTORY_REVIEW_DATA_SHA256="$PAYLOAD_SHA" \
  PB_DATA_DIR="$INSTALL_DIR/apps/PMC跟仓管/加工厂月度评审管理制度/pb_data" \
  "$@" \
  bash -c "$command" _ "$RESTORE_SCRIPT"
}

assert_restarted_healthy() {
  assert_contains "$CALL_LOG" '^docker compose .* start factory-review$' 'service must restart'
  assert_contains "$CALL_LOG" '^docker compose .* ps -q factory-review$' 'health check must resolve the compose container'
  assert_contains "$CALL_LOG" '^docker inspect .*State.Health.Status' 'health check must inspect container health'
}

: > "$CALL_LOG"
set +e
missing_output=$(PATH="$MOCK_BIN:$PATH" RESTORE_FACTORY_REVIEW_SOURCE_ONLY=1 FACTORY_REVIEW_DATA_PART_1_B64=first FACTORY_REVIEW_DATA_PART_3_B64=last bash -c 'set -euo pipefail; source "$1"; require_payload_parts' _ "$RESTORE_SCRIPT" 2>&1)
missing_status=$?
set -e
[[ $missing_status -ne 0 ]] || fail 'missing payload parts must fail'
[[ $missing_output =~ [Mm]issing.*payload|payload.*[Mm]issing ]] || fail 'missing payload error must name payload'
[[ ! -s $CALL_LOG ]] || fail 'missing payload parts must fail before external commands'

: > "$CALL_LOG"
set +e
wrong_sha_output=$(PATH="$MOCK_BIN:$PATH" RESTORE_FACTORY_REVIEW_SOURCE_ONLY=1 INSTALL_DIR="$INSTALL_DIR" FACTORY_REVIEW_DATA_PART_1_B64="$PART_1" FACTORY_REVIEW_DATA_PART_2_B64="$PART_2" FACTORY_REVIEW_DATA_PART_3_B64="$PART_3" FACTORY_REVIEW_DATA_SHA256=$(printf '0%.0s' {1..64}) bash -c 'source "$1"; main' _ "$RESTORE_SCRIPT" 2>&1)
wrong_sha_status=$?
set -e
[[ $wrong_sha_status -ne 0 ]] || fail 'wrong SHA must fail'
if grep -q '^docker ' "$CALL_LOG"; then fail 'wrong SHA must fail before Docker'; fi

for failure in FAIL_MKDIR FAIL_TAR_CREATE; do
  : > "$CALL_LOG"
  rm -f "$RESTORE_MARKER"
  set +e
  output=$(run_main 'source "$1"; verify_snapshot_counts() { return 0; }; main' "$failure=1" 2>&1 < /dev/null)
  status=$?
  set -e
  [[ $status -ne 0 ]] || fail "$failure must fail"
  assert_restarted_healthy
done

: > "$CALL_LOG"
rm -f "$RESTORE_MARKER"
set +e
python_output=$(run_main 'source "$1"; main' FAIL_PYTHON=1 2>&1)
python_status=$?
set -e
[[ $python_status -ne 0 ]] || fail 'real python sqlite failure must fail'
[[ $python_output == *'forced python sqlite failure'* ]] || fail 'real python sqlite failure must be observed'
[[ -f $RESTORE_MARKER ]] || fail 'python failure must restore backup'
assert_restarted_healthy

: > "$CALL_LOG"
rm -f "$RESTORE_MARKER"
set +e
extract_output=$(run_main 'source "$1"; verify_snapshot_counts() { printf "%s\\n" forced-verification-failure >&2; return 73; }; main' FAIL_TAR_EXTRACT=1 2>&1)
extract_status=$?
set -e
[[ $extract_status -ne 0 ]] || fail 'extract failure must fail'
assert_contains "$CALL_LOG" '^tar .*(-[xX]|--extract)' 'rollback must attempt extraction'
extract_line=$(line_of "$CALL_LOG" '^tar .*(-[xX]|--extract)')
[[ -n $extract_line ]] || fail 'extract failure must log extraction'
if tail -n +$((extract_line + 1)) "$CALL_LOG" | grep -Eq '^docker compose .* start factory-review$'; then
  fail 'failed extraction must not start factory-review'
fi
compgen -G "$INSTALL_DIR/apps/PMC跟仓管/加工厂月度评审管理制度/pb_data.failed-*" >/dev/null || fail 'failed data must be preserved after extraction failure'
/usr/bin/mkdir -p "$INSTALL_DIR/apps/PMC跟仓管/加工厂月度评审管理制度/pb_data"
: > "$INSTALL_DIR/apps/PMC跟仓管/加工厂月度评审管理制度/pb_data/data.db"

: > "$CALL_LOG"
set +e
lock_output=$(run_main 'source "$1"; main' FAIL_FLOCK=1 2>&1)
lock_status=$?
set -e
[[ $lock_status -ne 0 ]] || fail 'contended lock must fail'
assert_contains "$CALL_LOG" '^flock -n ' 'restore must acquire a nonblocking flock'
if grep -q '^docker ' "$CALL_LOG"; then fail 'contended lock must not touch Docker'; fi

: > "$CALL_LOG"
set +e
trace_output=$(PATH="$MOCK_BIN:$PATH" RESTORE_FACTORY_REVIEW_SOURCE_ONLY=1 INSTALL_DIR="$INSTALL_DIR" FACTORY_REVIEW_DATA_PART_1_B64=trace-secret-one FACTORY_REVIEW_DATA_PART_2_B64=trace-secret-two FACTORY_REVIEW_DATA_PART_3_B64=trace-secret-three FACTORY_REVIEW_DATA_SHA256=$(printf '0%.0s' {1..64}) bash -c 'set -x; source "$1"; main' _ "$RESTORE_SCRIPT" 2>&1)
trace_status=$?
set -e
[[ $trace_status -ne 0 ]] || fail 'trace SHA fixture must fail'
[[ $trace_output != *trace-secret-* ]] || fail 'caller xtrace must not leak payload parts'

: > "$CALL_LOG"
success_output=$(run_main 'source "$1"; verify_snapshot_counts() { return 0; }; main' 2>&1) || fail "successful restore failed: $success_output"
backup_line=$(line_of "$CALL_LOG" '^tar .*(-[cC]|--create)')
migration_line=$(line_of "$CALL_LOG" '^docker .*/pb/pocketbase migrate up')
[[ -n $backup_line && -n $migration_line ]] || fail 'backup and migration must be logged'
(( backup_line < migration_line )) || fail 'backup must precede actual migration'
assert_restarted_healthy
if grep -q '^curl ' "$CALL_LOG"; then fail 'health check must not use host curl'; fi

printf 'PASS: transactional restore failure, lock, trace, and health contracts\n'
