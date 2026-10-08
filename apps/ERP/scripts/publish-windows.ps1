param(
  [string]$Configuration = "Release",
  [string]$Output = "publish\erpapi"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$webDir = Join-Path $repoRoot "web2"
$apiProject = Join-Path $repoRoot "src\ErpApi\ErpApi.csproj"
$wwwroot = Join-Path $repoRoot "src\ErpApi\wwwroot"
$webDist = Join-Path $webDir "dist"
$publishDir = Join-Path $repoRoot $Output
$resolvedRepoRoot = [System.IO.Path]::GetFullPath($repoRoot)
$resolvedWwwroot = [System.IO.Path]::GetFullPath($wwwroot)

if (-not $resolvedWwwroot.StartsWith($resolvedRepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to clean a path outside the repository: $resolvedWwwroot"
}

Push-Location $webDir
try {
  npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "Frontend build failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}

if (Test-Path $resolvedWwwroot) {
  Remove-Item -LiteralPath $resolvedWwwroot -Recurse -Force
}
New-Item -ItemType Directory -Path $resolvedWwwroot | Out-Null
Copy-Item (Join-Path $webDist "*") $resolvedWwwroot -Recurse -Force

dotnet publish $apiProject -c $Configuration -o $publishDir --no-restore
if ($LASTEXITCODE -ne 0) {
  throw "Backend publish failed with exit code $LASTEXITCODE"
}

Write-Host "Published to: $publishDir"
