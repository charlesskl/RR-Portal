#!/usr/bin/env bash
set +x
set -Eeuo pipefail

SERVICE_NAME=factory-review
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
INSTALL_DIR=${INSTALL_DIR:-/opt/rr-portal}
COMPOSE_FILE=${COMPOSE_FILE:-"$INSTALL_DIR/docker-compose.cloud.yml"}
ENV_FILE=${ENV_FILE:-"$INSTALL_DIR/.env.cloud.production"}
PB_DATA_DIR="$INSTALL_DIR/apps/PMC跟仓管/加工厂月度评审管理制度/pb_data"
BACKUP_DIR=${BACKUP_DIR:-"$INSTALL_DIR/backups/factory-review-data-restore"}
LOCK_FILE=${FACTORY_REVIEW_RESTORE_LOCK_FILE:-/tmp/factory-review-data-restore.lock}
MIGRATION_NAME=1790000000_restore_factory_data.js

TEMP_DIR=
PAYLOAD_FILE=
MIGRATION_FILE=
BACKUP_FILE=
BACKUP_PARTIAL_FILE=
FACTORY_REVIEW_IMAGE=${FACTORY_REVIEW_IMAGE:-}
service_stop_attempted=0
service_stopped=0
backup_created=0
migration_started=0
committed=0

log() { printf '%s\n' "$*" >&2; }
die() { log "ERROR: $*"; return 1; }

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

require_payload_parts() {
  local name
  for name in FACTORY_REVIEW_DATA_PART_1_B64 FACTORY_REVIEW_DATA_PART_2_B64 FACTORY_REVIEW_DATA_PART_3_B64 FACTORY_REVIEW_DATA_SHA256; do
    [[ -n ${!name:-} ]] || die "missing payload value: $name"
  done
  [[ $FACTORY_REVIEW_DATA_SHA256 =~ ^[0-9a-f]{64}$ ]] || die 'payload SHA-256 must be a lowercase hexadecimal digest'
  [[ ${EXPECTED_COMMIT:-} =~ ^[0-9a-f]{40}$ ]] || die 'EXPECTED_COMMIT must be exactly 40 lowercase hexadecimal characters'
}

cleanup_temp_files() {
  if [[ -n ${TEMP_DIR:-} && -d $TEMP_DIR ]]; then
    rm -rf -- "$TEMP_DIR" || return 1
  fi
  TEMP_DIR=
}

cleanup_partial_backup() {
  if [[ -n ${BACKUP_PARTIAL_FILE:-} && -e $BACKUP_PARTIAL_FILE ]]; then
    rm -f -- "$BACKUP_PARTIAL_FILE" || return 1
  fi
  BACKUP_PARTIAL_FILE=
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

verify_running_revision() {
  local container_id image_id image_revision
  container_id=$(compose ps -q "$SERVICE_NAME")
  [[ -n $container_id ]] || die 'factory-review container is not running'
  image_id=$(docker inspect -f '{{.Image}}' "$container_id")
  [[ -n $image_id ]] || die 'factory-review container has no image ID'
  image_revision=$(docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image_id")
  [[ $image_revision == "$EXPECTED_COMMIT" ]] || die "factory-review image revision does not match EXPECTED_COMMIT"
  FACTORY_REVIEW_IMAGE=$image_id
}

wait_for_health() {
  local container_id status attempt
  container_id=$(compose ps -q "$SERVICE_NAME")
  [[ -n $container_id ]] || die 'factory-review container was not found after start'
  for attempt in $(seq 1 30); do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}unhealthy{{end}}' "$container_id") || status=unhealthy
    [[ $status == healthy ]] && return 0
    sleep 2
  done
  die 'factory-review container did not become healthy'
}

start_and_verify_service() {
  compose start "$SERVICE_NAME"
  wait_for_health
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

restore_backup() {
  local failed_data_dir
  compose stop "$SERVICE_NAME" || return 1
  failed_data_dir="${PB_DATA_DIR}.failed-$(date +%s%N)-$$"
  mv -- "$PB_DATA_DIR" "$failed_data_dir" || return 1
  tar -xzf "$BACKUP_FILE" -C "$(dirname -- "$PB_DATA_DIR")" || return 1
  if ! start_and_verify_service; then
    compose stop "$SERVICE_NAME" || true
    return 1
  fi
}

on_exit() {
  local original_status=$? final_status
  trap - EXIT INT TERM ERR
  set +e
  final_status=$original_status
  if (( ! backup_created )) && [[ -n ${BACKUP_FILE:-} && -f $BACKUP_FILE ]]; then
    backup_created=1
  fi
  if (( original_status != 0 && service_stop_attempted && ! committed )); then
    if (( backup_created )); then
      restore_backup || final_status=1
    else
      start_and_verify_service || final_status=1
    fi
  fi
  if ! cleanup_partial_backup; then
    log 'ERROR: temporary partial backup cleanup failed.'
    final_status=1
  fi
  if ! cleanup_temp_files; then
    log 'ERROR: temporary restore files cleanup failed.'
    final_status=1
  fi
  exit "$final_status"
}

on_signal() {
  exit "$1"
}

main() {
  trap on_exit EXIT
  trap 'on_signal 130' INT
  trap 'on_signal 143' TERM
  trap 'exit "$?"' ERR

  cd "$INSTALL_DIR"
  exec 9>"$LOCK_FILE"
  flock -n 9 || die 'another factory-review restore is already running'
  require_payload_parts
  reconstruct_payload
  verify_running_revision
  [[ -d $PB_DATA_DIR && -f $PB_DATA_DIR/data.db ]] || die "PocketBase data directory or data.db is missing: $PB_DATA_DIR"

  service_stop_attempted=1
  compose stop "$SERVICE_NAME"
  service_stopped=1
  mkdir -p -- "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/pb_data-$(date +%s%N)-$$.tar.gz"
  BACKUP_PARTIAL_FILE="$BACKUP_FILE.partial"
  tar -czf "$BACKUP_PARTIAL_FILE" -C "$(dirname -- "$PB_DATA_DIR")" "$(basename -- "$PB_DATA_DIR")"
  tar -tzf "$BACKUP_PARTIAL_FILE" >/dev/null
  mv -- "$BACKUP_PARTIAL_FILE" "$BACKUP_FILE"
  BACKUP_PARTIAL_FILE=
  backup_created=1

  migration_started=1
  docker run --rm -v "$PB_DATA_DIR:/pb/pb_data" -v "$MIGRATION_FILE:/pb/private-migrations/$MIGRATION_NAME:ro" "$FACTORY_REVIEW_IMAGE" /pb/pocketbase migrate up --dir=/pb/pb_data --migrationsDir=/pb/private-migrations
  verify_snapshot_counts
  start_and_verify_service
  if ! cleanup_temp_files; then
    die 'temporary restore files cleanup failed'
  fi
  committed=1
  log 'Factory-review data restore completed successfully.'
}

if [[ ${RESTORE_FACTORY_REVIEW_SOURCE_ONLY:-0} != 1 ]]; then
  main "$@"
fi
