param(
  [Parameter(Mandatory = $true)][string]$BackupFolder,
  [switch]$ConfirmRestore
)
$ErrorActionPreference = "Stop"
function Assert-NativeSuccess([string]$Operation) {
  if ($LASTEXITCODE -ne 0) { throw "$Operation failed with exit code $LASTEXITCODE." }
}
if (-not $ConfirmRestore) {
  throw "Restore replaces the current database and file storage. Re-run with -ConfirmRestore."
}
$dump = Join-Path $BackupFolder "database.dump"
$storage = Join-Path $BackupFolder "storage"
if (-not (Test-Path -LiteralPath $dump) -or -not (Test-Path -LiteralPath $storage)) {
  throw "BackupFolder must contain database.dump and storage."
}
docker compose stop web worker
Assert-NativeSuccess "Stopping web and worker"
docker compose cp $dump db:/tmp/qc-restore.dump
Assert-NativeSuccess "Copying database dump"
docker compose exec -T db sh -c 'dropdb --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB" && pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists /tmp/qc-restore.dump'
Assert-NativeSuccess "Restoring PostgreSQL"
docker compose run --rm --no-deps web sh -c 'find /app/storage -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
Assert-NativeSuccess "Clearing file storage"
docker compose cp (Join-Path $storage ".") web:/app/storage
Assert-NativeSuccess "Restoring file storage"
docker compose start worker web
Assert-NativeSuccess "Restarting web and worker"
Write-Output "Restore completed from: $BackupFolder"
