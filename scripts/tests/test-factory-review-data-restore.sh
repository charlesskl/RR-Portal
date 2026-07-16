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
BACKUP_TOKEN='factory-review-backup-token'
mkdir -p "$MOCK_BIN" "$INSTALL_DIR/pb_data"
: > "$CALL_LOG"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_contains() {
  local file=$1
  local pattern=$2
  local message=$3
  grep -Eq "$pattern" "$file" || fail "$message"
}

cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "$CALL_LOG"
exit 0
MOCK

cat > "$MOCK_BIN/tar" <<'MOCK'
#!/usr/bin/env bash
archive_arg() {
  local expect_file=0
  local arg
  for arg in "$@"; do
    if (( expect_file )); then
      printf '%s' "$arg"
      return 0
    fi
    case "$arg" in
      -f|--file)
        expect_file=1
        ;;
      --file=*)
        printf '%s' "${arg#--file=}"
        return 0
        ;;
      -*f*)
        expect_file=1
        ;;
    esac
  done
  return 1
}

printf 'tar %s\n' "$*" >> "$CALL_LOG"
archive=$(archive_arg "$@") || exit 2
case " $* " in
  *-c*|*--create*)
    mkdir -p "$(dirname "$archive")"
    printf '%s\n' "$BACKUP_TOKEN" > "$archive"
    printf '%s\n' "$archive" > "$BACKUP_PATH_FILE"
    ;;
  *-x*|*--extract*)
    [[ -s "$BACKUP_PATH_FILE" ]] || exit 3
    [[ "$archive" == "$(<"$BACKUP_PATH_FILE")" ]] || exit 4
    grep -Fqx "$BACKUP_TOKEN" "$archive" || exit 5
    : > "$RESTORE_MARKER"
    ;;
esac
exit 0
MOCK

cat > "$MOCK_BIN/curl" <<'MOCK'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "$CALL_LOG"
exit 0
MOCK

cat > "$MOCK_BIN/systemctl" <<'MOCK'
#!/usr/bin/env bash
printf 'systemctl %s\n' "$*" >> "$CALL_LOG"
exit 0
MOCK

chmod +x "$MOCK_BIN/docker" "$MOCK_BIN/tar" "$MOCK_BIN/curl" "$MOCK_BIN/systemctl"
export BACKUP_PATH_FILE BACKUP_TOKEN CALL_LOG RESTORE_MARKER

[[ -f "$RESTORE_SCRIPT" ]] || fail "restore script is missing: $RESTORE_SCRIPT"

set +e
missing_output=$(
  PATH="$MOCK_BIN:$PATH" \
  RESTORE_FACTORY_REVIEW_SOURCE_ONLY=1 \
  FACTORY_REVIEW_DATA_PART_1_B64=first \
  FACTORY_REVIEW_DATA_PART_3_B64=last \
  bash -c 'set -euo pipefail; source "$1"; declare -F require_payload_parts >/dev/null || { printf "%s\n" "missing payload validation function" >&2; exit 127; }; require_payload_parts' _ "$RESTORE_SCRIPT" 2>&1
)
missing_status=$?
set -e
[[ $missing_status -ne 0 ]] || fail 'missing payload parts must fail'
if ! printf '%s' "$missing_output" | grep -Eqi 'missing[^[:alnum:]]+payload|payload[^[:alnum:]]+missing'; then
  fail 'missing payload parts must be named in the error output'
fi
if printf '%s' "$missing_output" | grep -qi 'command not found'; then
  fail 'missing payload parts must not fail with command not found'
fi
[[ ! -s "$CALL_LOG" ]] || fail 'missing payload parts must fail before external commands'

PAYLOAD_GZ="$TEST_ROOT/payload.gz"
PAYLOAD_TEXT=$(printf 'const %s%s = {}; migrate((app) => {});\n' 'SN' 'APSHOT')
printf '%s' "$PAYLOAD_TEXT" | gzip -c > "$PAYLOAD_GZ"
PAYLOAD_SHA=$(sha256sum "$PAYLOAD_GZ" | awk '{print $1}')
PAYLOAD_B64=$(base64 < "$PAYLOAD_GZ" | tr -d '\r\n')
PAYLOAD_LENGTH=${#PAYLOAD_B64}
CHUNK_SIZE=$(( (PAYLOAD_LENGTH + 2) / 3 ))
PART_1=${PAYLOAD_B64:0:CHUNK_SIZE}
PART_2=${PAYLOAD_B64:CHUNK_SIZE:CHUNK_SIZE}
PART_3=${PAYLOAD_B64:CHUNK_SIZE*2}
[[ -n "$PART_1" && -n "$PART_2" && -n "$PART_3" ]] || fail 'test payload must have three non-empty parts'

: > "$CALL_LOG"
set +e
wrong_sha_output=$(
  PATH="$MOCK_BIN:$PATH" \
  RESTORE_FACTORY_REVIEW_SOURCE_ONLY=1 \
  INSTALL_DIR="$INSTALL_DIR" \
  FACTORY_REVIEW_DATA_PART_1_B64="$PART_1" \
  FACTORY_REVIEW_DATA_PART_2_B64="$PART_2" \
  FACTORY_REVIEW_DATA_PART_3_B64="$PART_3" \
  FACTORY_REVIEW_DATA_SHA256=0000000000000000000000000000000000000000000000000000000000000000 \
  bash -c 'set -euo pipefail; source "$1"; main' _ "$RESTORE_SCRIPT" 2>&1
)
wrong_sha_status=$?
set -e
[[ $wrong_sha_status -ne 0 ]] || fail 'wrong SHA-256 must fail'
if grep -q '^docker ' "$CALL_LOG"; then
  fail 'wrong SHA-256 must fail before Docker is called'
fi

: > "$CALL_LOG"
rm -f "$RESTORE_MARKER"
rm -f "$BACKUP_PATH_FILE"
set +e
restore_output=$(
  PATH="$MOCK_BIN:$PATH" \
  RESTORE_FACTORY_REVIEW_SOURCE_ONLY=1 \
  INSTALL_DIR="$INSTALL_DIR" \
  FACTORY_REVIEW_DATA_PART_1_B64="$PART_1" \
  FACTORY_REVIEW_DATA_PART_2_B64="$PART_2" \
  FACTORY_REVIEW_DATA_PART_3_B64="$PART_3" \
  FACTORY_REVIEW_DATA_SHA256="$PAYLOAD_SHA" \
  BACKUP_TOKEN="$BACKUP_TOKEN" \
  bash -c 'set -euo pipefail; source "$1"; verify_snapshot_counts() { printf "%s\\n" "forced verification failure" >&2; return 73; }; main' _ "$RESTORE_SCRIPT" 2>&1
)
restore_status=$?
set -e
[[ $restore_status -ne 0 ]] || fail 'injected verification failure must fail the restore command'
[[ "$restore_output" == *'forced verification failure'* ]] || fail 'verification failure was not injected through verify_snapshot_counts'
[[ -f "$RESTORE_MARKER" ]] || fail 'injected verification failure must restore the backup tar'
[[ -s "$BACKUP_PATH_FILE" ]] || fail 'backup creation must record an archive path'
assert_contains "$CALL_LOG" '^docker ' 'verification scenario must invoke Docker before verification fails'
assert_contains "$CALL_LOG" '^tar .*(-[xc]|--(create|extract))' 'verification scenario must create or extract a tar backup'

backup_line=$(grep -nE '^tar .*(-[cC]|--create)' "$CALL_LOG" | head -n 1 | cut -d: -f1)
migration_line=$(grep -n '^docker ' "$CALL_LOG" | head -n 1 | cut -d: -f1)
restore_line=$(grep -nE '^tar .*(-[xX]|--extract)' "$CALL_LOG" | head -n 1 | cut -d: -f1)
[[ -n "$backup_line" && -n "$migration_line" && -n "$restore_line" ]] || fail 'rollback ordering events were not logged'
(( backup_line < migration_line )) || fail 'backup must be created before migration'
(( migration_line < restore_line )) || fail 'backup restoration must occur after migration/verification failure'
assert_contains "$CALL_LOG" '^tar .*(-[xX]|--extract)' 'rollback must extract the backup archive'

printf 'PASS: missing-parts, SHA ordering, and rollback behavior contracts\n'
