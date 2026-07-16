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
    if [[ ${FAIL_STOP_SIGNAL:-0} == 1 && " $* " == *' stop factory-review' && ! -e ${SIGNAL_MARKER:?} ]]; then
      while [[ ! -e $SIGNAL_MARKER ]]; do /usr/bin/sleep 0.01; done
    fi
    ;;
  inspect)
    if [[ " $* " == *'{{.Image}}'* ]]; then
      printf 'sha256:factory-review-image\n'
    else
      printf '%s\n' "${MOCK_HEALTH_STATUS:-healthy}"
    fi
    ;;
  image)
    [[ ${2:-} == inspect ]] || exit 2
    printf '%s\n' "${MOCK_IMAGE_REVISION:-${EXPECTED_COMMIT:?}}"
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
    if [[ ${FAIL_TAR_PARTIAL:-0} == 1 ]]; then
      /usr/bin/mkdir -p "$(dirname -- "$archive")"
      printf '%s\n' partial > "$archive"
      exit 71
    fi
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

cat > "$MOCK_BIN/rm" <<'MOCK'
#!/usr/bin/env bash
printf 'rm %s\n' "$*" >> "$CALL_LOG"
[[ ${FAIL_CLEANUP:-0} != 1 ]] || exit 76
/usr/bin/rm "$@"
MOCK

cat > "$MOCK_BIN/mv" <<'MOCK'
#!/usr/bin/env bash
printf 'mv %s\n' "$*" >> "$CALL_LOG"
last=${!#}
/usr/bin/mv "$@"
if [[ $last == *.tar.gz ]]; then
  printf '%s\n' "$last" > "$BACKUP_PATH_FILE"
fi
if [[ ${FAIL_BACKUP_SIGNAL:-0} == 1 && $last == *.tar.gz && ! -e ${SIGNAL_MARKER:?} ]]; then
  while [[ ! -e $SIGNAL_MARKER ]]; do /usr/bin/sleep 0.01; done
fi
MOCK

chmod +x "$MOCK_BIN"/*
export BACKUP_PATH_FILE BACKUP_MARKER CALL_LOG RESTORE_MARKER

[[ -f "$RESTORE_SCRIPT" ]] || fail "restore script is missing: $RESTORE_SCRIPT"

PAYLOAD_GZ="$TEST_ROOT/payload.gz"
PAYLOAD_TEXT=$(printf 'const %s%s = {}; migrate((app) => {});\n' 'SN' 'APSHOT')
printf '%s' "$PAYLOAD_TEXT" | gzip -c > "$PAYLOAD_GZ"
PAYLOAD_SHA=$(sha256sum "$PAYLOAD_GZ" | awk '{print $1}')
PAYLOAD_B64=$(base64 < "$PAYLOAD_GZ" | tr -d '\r\n')
base_size=$(( ${#PAYLOAD_B64} / 3 ))
remainder=$(( ${#PAYLOAD_B64} % 3 ))
part_1_size=$(( base_size + (remainder > 0 ? 1 : 0) ))
part_2_size=$(( base_size + (remainder > 1 ? 1 : 0) ))
PART_1=${PAYLOAD_B64:0:part_1_size}
PART_2=${PAYLOAD_B64:part_1_size:part_2_size}
PART_3=${PAYLOAD_B64:part_1_size+part_2_size}
[[ -n $PART_1 && -n $PART_2 && -n $PART_3 ]] || fail 'payload fixture must be evenly split into three non-empty parts'
largest_size=$part_1_size
(( part_2_size > largest_size )) && largest_size=$part_2_size
smallest_size=${#PART_3}
(( part_1_size < smallest_size )) && smallest_size=$part_1_size
(( part_2_size < smallest_size )) && smallest_size=$part_2_size
(( largest_size - smallest_size <= 1 )) || fail 'three payload parts must differ in length by at most one character'
EXPECTED_COMMIT=0123456789abcdef0123456789abcdef01234567
export EXPECTED_COMMIT

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
  EXPECTED_COMMIT="$EXPECTED_COMMIT" \
  PB_DATA_DIR="$INSTALL_DIR/apps/PMC跟仓管/加工厂月度评审管理制度/pb_data" \
  SIGNAL_MARKER="$TEST_ROOT/signal.marker" \
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
invalid_commit_output=$(run_main 'source "$1"; main' EXPECTED_COMMIT=not-a-full-commit 2>&1)
invalid_commit_status=$?
set -e
[[ $invalid_commit_status -ne 0 ]] || fail 'invalid EXPECTED_COMMIT must fail'
[[ $invalid_commit_output == *'40'* ]] || fail 'invalid EXPECTED_COMMIT must report the exact commit shape'
if grep -q '^docker ' "$CALL_LOG"; then fail 'invalid EXPECTED_COMMIT must fail before Docker inspection'; fi

: > "$CALL_LOG"
set +e
old_image_output=$(run_main 'source "$1"; main' MOCK_IMAGE_REVISION=1111111111111111111111111111111111111111 2>&1)
old_image_status=$?
set -e
[[ $old_image_status -ne 0 ]] || fail 'an old running image must be rejected'
[[ $old_image_output == *'revision'* || $old_image_output == *'commit'* ]] || fail 'old image rejection must identify the revision mismatch'
assert_contains "$CALL_LOG" '^docker compose .* ps -q factory-review$' 'old image check must inspect the current Compose container'
assert_contains "$CALL_LOG" '^docker inspect .*\{\{\.Image\}\}' 'old image check must inspect the current container image ID'
assert_contains "$CALL_LOG" '^docker image inspect .*org.opencontainers.image.revision' 'old image check must inspect the OCI revision label'
if grep -Eq '^docker compose .* stop factory-review$|^docker run ' "$CALL_LOG"; then fail 'old image rejection must not stop or migrate the service'; fi
if grep -q '^tar ' "$CALL_LOG"; then fail 'old image rejection must not touch production data backups'; fi

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
rm -f "$TEST_ROOT/signal.marker"
set +e
stop_signal_output=$(run_main 'source "$1"; (until grep -q "docker compose .* stop factory-review" "$CALL_LOG"; do /usr/bin/sleep 0.01; done; : > "$SIGNAL_MARKER"; kill -TERM $$) & main' FAIL_STOP_SIGNAL=1 2>&1)
stop_signal_status=$?
set -e
[[ $stop_signal_status -ne 0 ]] || fail 'TERM during compose stop must fail the restore'
assert_restarted_healthy

: > "$CALL_LOG"
rm -f "$TEST_ROOT/signal.marker" "$RESTORE_MARKER"
set +e
backup_signal_output=$(run_main 'source "$1"; (until compgen -G "$INSTALL_DIR/backups/factory-review-data-restore/*.tar.gz" >/dev/null; do /usr/bin/sleep 0.01; done; : > "$SIGNAL_MARKER"; kill -TERM $$) & main' FAIL_BACKUP_SIGNAL=1 2>&1)
backup_signal_status=$?
set -e
[[ $backup_signal_status -ne 0 ]] || fail 'TERM after backup creation must fail the restore'
[[ -f $RESTORE_MARKER ]] || fail 'TERM after backup creation must restore the same backup'
assert_restarted_healthy

: > "$CALL_LOG"
set +e
cleanup_output=$(run_main 'source "$1"; verify_snapshot_counts() { return 0; }; main' FAIL_CLEANUP=1 2>&1)
cleanup_status=$?
set -e
[[ $cleanup_status -ne 0 ]] || fail 'temporary plaintext cleanup failure must make the restore fail'
[[ $cleanup_output == *'temporary restore files'* ]] || fail 'cleanup failure must report a non-payload error'
[[ -f $RESTORE_MARKER ]] || fail 'temporary plaintext cleanup failure must restore the same backup'
assert_restarted_healthy

: > "$CALL_LOG"
/usr/bin/rm -rf "$INSTALL_DIR/backups"
set +e
partial_output=$(run_main 'source "$1"; verify_snapshot_counts() { return 0; }; main' FAIL_TAR_PARTIAL=1 2>&1)
partial_status=$?
set -e
[[ $partial_status -ne 0 ]] || fail 'partial backup write must fail'
if compgen -G "$INSTALL_DIR/backups/factory-review-data-restore/*.tar.gz" >/dev/null; then
  fail 'partial backup failure must not leave a formal tar.gz backup'
fi
if compgen -G "$INSTALL_DIR/backups/factory-review-data-restore/*.partial" >/dev/null; then
  fail 'partial backup failure must clean the unfinished archive'
fi
assert_restarted_healthy

: > "$CALL_LOG"
rm -f "$RESTORE_MARKER"
set +e
rollback_health_output=$(run_main 'source "$1"; verify_snapshot_counts() { return 73; }; main' MOCK_HEALTH_STATUS=unhealthy 2>&1)
rollback_health_status=$?
set -e
[[ $rollback_health_status -ne 0 ]] || fail 'permanently unhealthy rollback data must fail'
[[ -f $RESTORE_MARKER ]] || fail 'unhealthy rollback must still extract the same backup before health verification'
last_service_action=$(grep -E '^docker compose .* (start|stop) factory-review$' "$CALL_LOG" | tail -n 1)
[[ $last_service_action == *' stop factory-review' ]] || fail 'rollback health failure must leave factory-review stopped'

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
