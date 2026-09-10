param(
  [string]$Destination = ".\backups"
)
$ErrorActionPreference = "Stop"
function Assert-NativeSuccess([string]$Operation) {
  if ($LASTEXITCODE -ne 0) { throw "$Operation failed with exit code $LASTEXITCODE." }
}
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$folder = Join-Path $Destination $stamp
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$stopped = $false
try {
  docker compose stop web worker
  Assert-NativeSuccess "Stopping web and worker"
  $stopped = $true
  docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/qc.dump'
  Assert-NativeSuccess "PostgreSQL dump"
  docker compose cp db:/tmp/qc.dump (Join-Path $folder "database.dump")
  Assert-NativeSuccess "Copying database dump"
  docker compose cp web:/app/storage (Join-Path $folder "storage")
  Assert-NativeSuccess "Copying file storage"
} finally {
  if ($stopped) {
    docker compose start worker web
    Assert-NativeSuccess "Restarting web and worker"
  }
}
Write-Output "Backup created: $folder"
