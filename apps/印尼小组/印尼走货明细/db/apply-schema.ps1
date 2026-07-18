[CmdletBinding()]
param(
    [string]$Server     = "(localdb)\MSSQLLocalDB",
    [string]$User       = "",
    [string]$Password   = "",
    [string]$ScriptPath = (Join-Path $PSScriptRoot "rebuild_schema.sql")
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $ScriptPath)) { throw "Script not found: $ScriptPath" }

$sqlcmd = Get-Command sqlcmd -ErrorAction SilentlyContinue
if (-not $sqlcmd) {
    $candidates = @(
        "C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE",
        "C:\Program Files\Microsoft SQL Server\160\Tools\Binn\SQLCMD.EXE",
        "C:\Program Files\Microsoft SQL Server\150\Tools\Binn\SQLCMD.EXE"
    )
    $sqlcmdExe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $sqlcmdExe) { throw "sqlcmd not found. Install SQL Server Client Tools or SSMS." }
} else { $sqlcmdExe = $sqlcmd.Source }

Write-Host "sqlcmd: $sqlcmdExe"
Write-Host "Server: $Server"
Write-Host "Script: $ScriptPath"

$args = @("-S", $Server, "-b", "-f", "65001", "-i", $ScriptPath)
if ($User) { $args += @("-U", $User, "-P", $Password) } else { $args += @("-E") }

& $sqlcmdExe @args
if ($LASTEXITCODE -ne 0) { throw "Schema apply failed (exit $LASTEXITCODE)" }

Write-Host ""
Write-Host "Database IndoShipping created/rebuilt" -ForegroundColor Green
Write-Host "Admin remains disabled until IndoShipping.Bootstrap sets INDO_SHIPPING_ADMIN_PASSWORD." -ForegroundColor Yellow
