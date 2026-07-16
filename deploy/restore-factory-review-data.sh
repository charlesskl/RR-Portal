#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME=factory-review
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
INSTALL_DIR=${INSTALL_DIR:-/opt/rr-portal}
COMPOSE_FILE=${COMPOSE_FILE:-"$INSTALL_DIR/docker-compose.cloud.yml"}
if [[ -z ${PB_DATA_DIR+x} ]]; then
  if [[ -d "$INSTALL_DIR/pb_data" ]]; then
    PB_DATA_DIR="$INSTALL_DIR/pb_data"
  else
    PB_DATA_DIR="$INSTALL_DIR/apps/PMC跟仓管/加工厂月度评审管理制度/pb_data"
  fi
fi
BACKUP_DIR=${BACKUP_DIR:-"$INSTALL_DIR/backups/factory-review-data-restore"}
HEALTH_URL=${FACTORY_REVIEW_HEALTH_URL:-http://127.0.0.1:8090/api/factory-review/health}
MIGRATION_NAME=1790000000_restore_factory_data.js

BACKUP_FILE=
MIGRATION_FILE=
PAYLOAD_FILE=
TEMP_DIR=
FACTORY_REVIEW_IMAGE=${FACTORY_REVIEW_IMAGE:-}
BACKUP_CREATED=0

log() {
  printf '%s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  return 1
}

require_payload_parts() {
  local name
  for name in FACTORY_REVIEW_DATA_PART_1_B64 FACTORY_REVIEW_DATA_PART_2_B64 FACTORY_REVIEW_DATA_PART_3_B64 FACTORY_REVIEW_DATA_SHA256; do
    if [[ -z ${!name:-} ]]; then
      die "missing payload value: $name"
    fi
  done

  [[ $FACTORY_REVIEW_DATA_SHA256 =~ ^[0-9a-f]{64}$ ]] || die 'payload SHA-256 must be a lowercase hexadecimal digest'
}

cleanup_temp_files() {
  if [[ -n ${TEMP_DIR:-} && -d $TEMP_DIR ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
}

reconstruct_payload() {
  local encoded_migration

  require_payload_parts

  TEMP_DIR=$(mktemp -d)
  PAYLOAD_FILE="$TEMP_DIR/restore-data-migration.js.gz"
  MIGRATION_FILE="$TEMP_DIR/$MIGRATION_NAME"
  umask 077
  encoded_migration="${FACTORY_REVIEW_DATA_PART_1_B64}${FACTORY_REVIEW_DATA_PART_2_B64}${FACTORY_REVIEW_DATA_PART_3_B64}"
  base64 --decode <<<"$encoded_migration" > "$PAYLOAD_FILE"
  unset encoded_migration
  printf '%s  %s\n' "$FACTORY_REVIEW_DATA_SHA256" "$PAYLOAD_FILE" | sha256sum -c - >/dev/null
  gzip --decompress --stdout "$PAYLOAD_FILE" > "$MIGRATION_FILE"
  chmod 600 "$MIGRATION_FILE"

  grep -Fq 'const SNAPSHOT =' "$MIGRATION_FILE" || die 'migration payload has no snapshot declaration'
  grep -Fq 'migrate((app) =>' "$MIGRATION_FILE" || die 'migration payload has no migrate callback'
}

resolve_factory_review_image() {
  if [[ -z $FACTORY_REVIEW_IMAGE ]]; then
    FACTORY_REVIEW_IMAGE=$(docker compose -f "$COMPOSE_FILE" images -q "$SERVICE_NAME")
    if [[ -z $FACTORY_REVIEW_IMAGE ]]; then
      FACTORY_REVIEW_IMAGE="${COMPOSE_PROJECT_NAME:-$(basename -- "$INSTALL_DIR")}-${SERVICE_NAME}"
    fi
  fi
}

verify_snapshot_counts() {
  local database_file="$PB_DATA_DIR/data.db"
  python3 - "$database_file" <<'PY'
import sqlite3
import sys

database_file = sys.argv[1]
required_counts = {
    'users': 19,
    'factories': 186,
    'orders': 92,
    'quality_inspections': 479,
    'score_templates': 10,
    'monthly_scores': 1,
}

try:
    connection = sqlite3.connect(f'file:{database_file}?mode=ro', uri=True)
    for table, minimum in required_counts.items():
        count = connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        if count < minimum:
            raise RuntimeError(f'{table} count {count} is below required minimum {minimum}')
except (sqlite3.Error, RuntimeError) as error:
    print(f'ERROR: snapshot verification failed: {error}', file=sys.stderr)
    sys.exit(1)
finally:
    if 'connection' in locals():
        connection.close()
PY
}

wait_for_health() {
  local attempt
  for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error "$HEALTH_URL" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  die 'factory-review did not become healthy after rollback'
}

rollback() {
  local failed_data_dir
  local rollback_status=0

  trap - ERR
  set +e
  if (( BACKUP_CREATED )); then
    log 'Restore failed; rolling back factory-review data from the transaction backup.'
    docker compose -f "$COMPOSE_FILE" stop "$SERVICE_NAME" || rollback_status=1
    if [[ -e $PB_DATA_DIR ]]; then
      failed_data_dir="${PB_DATA_DIR}.failed-$(date +%Y%m%d_%H%M%S)"
      mv -- "$PB_DATA_DIR" "$failed_data_dir" || rollback_status=1
    fi
    mkdir -p -- "$(dirname -- "$PB_DATA_DIR")" || rollback_status=1
    tar -xzf "$BACKUP_FILE" -C "$(dirname -- "$PB_DATA_DIR")" || rollback_status=1
    docker compose -f "$COMPOSE_FILE" start "$SERVICE_NAME" || rollback_status=1
    wait_for_health || rollback_status=1
  fi
  cleanup_temp_files

  if (( rollback_status )); then
    log 'ERROR: rollback did not complete cleanly.'
  fi
}

handle_error() {
  local status=$1
  rollback
  exit "$status"
}

main() {
  trap 'handle_error "$?"' ERR
  reconstruct_payload

  [[ -d $PB_DATA_DIR ]] || die "PocketBase data directory does not exist: $PB_DATA_DIR"
  docker compose -f "$COMPOSE_FILE" stop "$SERVICE_NAME"

  mkdir -p -- "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/pb_data-$(date +%Y%m%d_%H%M%S).tar.gz"
  tar -czf "$BACKUP_FILE" -C "$(dirname -- "$PB_DATA_DIR")" "$(basename -- "$PB_DATA_DIR")"
  BACKUP_CREATED=1

  resolve_factory_review_image
  docker run --rm -v "$PB_DATA_DIR:/pb/pb_data" -v "$MIGRATION_FILE:/pb/private-migrations/$MIGRATION_NAME:ro" "$FACTORY_REVIEW_IMAGE" /pb/pocketbase migrate up --dir=/pb/pb_data --migrationsDir=/pb/private-migrations
  verify_snapshot_counts

  docker compose -f "$COMPOSE_FILE" start "$SERVICE_NAME"
  wait_for_health
  cleanup_temp_files
  log 'Factory-review data restore completed successfully.'
}

if [[ ${RESTORE_FACTORY_REVIEW_SOURCE_ONLY:-0} != 1 ]]; then
  main "$@"
fi
