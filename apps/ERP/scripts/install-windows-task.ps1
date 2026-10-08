param(
  [string]$TaskName = "WebpageERP",
  [string]$Urls = "http://localhost:5000"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$runScript = Join-Path $repoRoot "scripts\run-published.cmd"
$publishedExe = Join-Path $repoRoot "publish\erpapi\ErpApi.exe"

if (-not (Test-Path $publishedExe)) {
  throw "Published app not found. Run scripts\publish-windows.ps1 first."
}

foreach ($name in @("ERP_DB", "ERP_JWT_KEY")) {
  $processValue = [Environment]::GetEnvironmentVariable($name, "Process")
  $userValue = [Environment]::GetEnvironmentVariable($name, "User")
  $machineValue = [Environment]::GetEnvironmentVariable($name, "Machine")

  if ([string]::IsNullOrWhiteSpace($userValue) -and [string]::IsNullOrWhiteSpace($machineValue)) {
    if ([string]::IsNullOrWhiteSpace($processValue)) {
      throw "Missing required environment variable: $name"
    }

    [Environment]::SetEnvironmentVariable($name, $processValue, "User")
  }
}

[Environment]::SetEnvironmentVariable("ERP_URLS", $Urls, "User")

$action = New-ScheduledTaskAction -Execute $runScript
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Scheduled task '$TaskName' installed and started."
