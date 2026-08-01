#!/usr/bin/env sh
set -eu
folder="${1:-}"
confirm="${2:-}"
if [ -z "$folder" ] || [ "$confirm" != "--confirm" ]; then
  printf 'Usage: %s BACKUP_FOLDER --confirm\n' "$0" >&2
  printf 'Warning: restore replaces the current database and file storage.\n' >&2
  exit 2
fi
test -f "$folder/database.dump"
test -d "$folder/storage"
docker compose stop web worker
docker compose cp "$folder/database.dump" db:/tmp/qc-restore.dump
docker compose exec -T db sh -c 'dropdb --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB" && pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists /tmp/qc-restore.dump'
docker compose run --rm --no-deps web sh -c 'find /app/storage -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
docker compose cp "$folder/storage/." web:/app/storage
docker compose start worker web
printf 'Restore completed from: %s\n' "$folder"
