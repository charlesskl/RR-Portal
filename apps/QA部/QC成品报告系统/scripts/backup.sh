#!/usr/bin/env sh
set -eu
destination="${1:-./backups}"
stamp="$(date +%Y%m%d-%H%M%S)"
folder="$destination/$stamp"
mkdir -p "$folder"
stopped=1
restart_services() {
  if [ "$stopped" -eq 1 ]; then
    docker compose start worker web
  fi
}
trap restart_services EXIT
docker compose stop web worker
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/qc.dump'
docker compose cp db:/tmp/qc.dump "$folder/database.dump"
docker compose cp web:/app/storage "$folder/storage"
docker compose start worker web
stopped=0
trap - EXIT
printf 'Backup created: %s\n' "$folder"
