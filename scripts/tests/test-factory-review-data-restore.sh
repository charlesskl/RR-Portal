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
printf 'tar %s\n' "$*" >> "$CALL_LOG"
case " $* " in
  *-x*|*--extract*)
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
export CALL_LOG RESTORE_MARKER

[[ -f "$RESTORE_SCRIPT" ]] || fail "restore script is missing: $RESTORE_SCRIPT"

set +e
missing_output=$(
  PATH="$MOCK_BIN:$PATH" \
  RESTORE_FACTORY_REVIEW_SOURCE_ONLY=1 \
  FACTORY_REVIEW_DATA_PART_1_B64=first \
  FACTORY_REVIEW_DATA_PART_3_B64=last \
  bash -c 'set -euo pipefail; source "$1"; require_payload_parts' _ "$RESTORE_SCRIPT" 2>&1
)
missing_status=$?
set -e
[[ $missing_status -ne 0 ]] || fail 'missing payload parts must fail'
[[ ! -s "$CALL_LOG" ]] || fail 'missing payload parts must fail before external commands'

PAYLOAD_GZ="$TEST_ROOT/payload.gz"
printf '%s\n' 'const SNAPSHOT = {}; migrate((app) => {});' | gzip -c > "$PAYLOAD_GZ"
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
set +e
restore_output=$(
  PATH="$MOCK_BIN:$PATH" \
  RESTORE_FACTORY_REVIEW_SOURCE_ONLY=1 \
  INSTALL_DIR="$INSTALL_DIR" \
  FACTORY_REVIEW_DATA_PART_1_B64="$PART_1" \
  FACTORY_REVIEW_DATA_PART_2_B64="$PART_2" \
  FACTORY_REVIEW_DATA_PART_3_B64="$PART_3" \
  FACTORY_REVIEW_DATA_SHA256="$PAYLOAD_SHA" \
  bash -c 'set -euo pipefail; source "$1"; main' _ "$RESTORE_SCRIPT" 2>&1
)
restore_status=$?
set -e
[[ $restore_status -ne 0 ]] || fail 'verification failure must fail the restore command'
[[ -f "$RESTORE_MARKER" ]] || fail 'verification failure must restore the backup tar'
assert_contains "$CALL_LOG" '^docker ' 'verification scenario must invoke Docker before verification fails'
assert_contains "$CALL_LOG" '^tar .*(-[xc]|--(create|extract))' 'verification scenario must create or extract a tar backup'

backup_line=$(grep -nE '^tar .*(-[cC]|--create)' "$CALL_LOG" | head -n 1 | cut -d: -f1)
migration_line=$(grep -n '^docker ' "$CALL_LOG" | head -n 1 | cut -d: -f1)
restore_line=$(grep -nE '^tar .*(-[xX]|--extract)' "$CALL_LOG" | head -n 1 | cut -d: -f1)
[[ -n "$backup_line" && -n "$migration_line" && -n "$restore_line" ]] || fail 'rollback ordering events were not logged'
(( backup_line < migration_line )) || fail 'backup must be created before migration'
(( migration_line < restore_line )) || fail 'backup restoration must occur after migration/verification failure'

printf 'PASS: missing-parts, SHA ordering, and rollback behavior contracts\n'
