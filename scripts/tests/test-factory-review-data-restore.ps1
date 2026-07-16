$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw "FAIL: $Message"
    }
}

function Assert-Match {
    param(
        [string]$Text,
        [string]$Pattern,
        [string]$Message
    )

    Assert-True ($Text -match $Pattern) $Message
}

function First-MatchIndex {
    param(
        [string]$Text,
        [string]$Pattern
    )

    $match = [regex]::Match($Text, $Pattern)
    if (-not $match.Success) {
        return -1
    }

    return $match.Index
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$restorePath = Join-Path $repoRoot 'deploy\restore-factory-review-data.sh'
$bashTestPath = Join-Path $PSScriptRoot 'test-factory-review-data-restore.sh'

Assert-True (Test-Path -LiteralPath $restorePath -PathType Leaf) "restore script is missing: $restorePath"
$scriptText = Get-Content -LiteralPath $restorePath -Raw
$codeText = [regex]::Replace($scriptText, '(?m)^\s*#.*$', '')

Assert-Match $codeText '(?m)^\s*set\s+-euo\s+pipefail\s*$' 'restore script must enable set -euo pipefail'
Assert-True ($codeText -notmatch '(?m)^\s*set\s+-x\b') 'restore script must never enable shell tracing with set -x'
Assert-True ($codeText -notmatch '(?m)^\s*set\s+-o\s+xtrace\b') 'restore script must never enable shell tracing with set -o xtrace'
Assert-True ($codeText -notmatch '(?m)^\s*PS4\s*=') 'restore script must never configure shell tracing through PS4'
Assert-Match $codeText '(?im)^\s*trap\b[^\r\n]*\bERR\b' 'restore script must register an ERR trap'
Assert-Match $codeText '(?im)^\s*(?:function\s+)?require_payload_parts\s*\(\)' 'restore script must define require_payload_parts'
Assert-Match $codeText '(?im)^\s*(?:function\s+)?reconstruct_payload\s*\(\)' 'restore script must define reconstruct_payload'

$shaIndex = First-MatchIndex $codeText '(?i)sha-?256|sha256sum'
$stopIndex = First-MatchIndex $codeText '(?i)(?:systemctl|docker\s+compose)[^\r\n]*\bstop\b'
Assert-True ($shaIndex -ge 0) 'restore script must verify the payload SHA-256'
Assert-True ($stopIndex -ge 0) 'restore script must stop the factory-review service'
Assert-True ($shaIndex -lt $stopIndex) 'payload SHA-256 must be checked before stopping the service'

$tarIndex = First-MatchIndex $codeText '(?im)\btar\b[^\r\n]*(?:-c|--create)'
$migrateIndex = First-MatchIndex $codeText '(?im)\bpocketbase\b[^\r\n]*\bmigrate\s+up\b|\bmigrate\s+up\b'
Assert-True ($tarIndex -ge 0) 'restore script must create a tar backup'
Assert-True ($migrateIndex -ge 0) 'restore script must invoke pocketbase migrate up'
Assert-True ($tarIndex -lt $migrateIndex) 'tar backup must be created before pocketbase migrate up'

$requiredCounts = [ordered]@{
    users = 19
    factories = 186
    orders = 92
    quality_inspections = 479
    score_templates = 10
    monthly_scores = 1
}

$verifyIndex = First-MatchIndex $codeText '(?im)\bverify_snapshot_counts\b'
Assert-True ($verifyIndex -ge 0) 'restore script must define verify_snapshot_counts'
$verifyText = $codeText.Substring($verifyIndex)
Assert-Match $verifyText '(?i)sqlite3|COUNT\s*\(' 'verify_snapshot_counts must use SQLite row counts'
foreach ($table in $requiredCounts.Keys) {
    Assert-Match $verifyText "(?i)\b$table\b" "verify_snapshot_counts must verify table $table"
    Assert-Match $verifyText "(?i)\b$($requiredCounts[$table])\b" "verify_snapshot_counts must enforce the minimum count for $table"
}

Assert-True (Test-Path -LiteralPath $bashTestPath -PathType Leaf) "behavior test is missing: $bashTestPath"
$bash = Get-Command bash -ErrorAction SilentlyContinue
Assert-True ($null -ne $bash) 'bash is required to run the behavior contract test'
& $bash.Source --noprofile --norc $bashTestPath
Assert-True ($LASTEXITCODE -eq 0) "behavior contract test failed with exit code $LASTEXITCODE"

Write-Output 'PASS: factory review restore static and behavior contracts'
