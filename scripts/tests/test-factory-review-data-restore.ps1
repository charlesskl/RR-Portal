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

function Get-BashFunctionBody {
    param(
        [string]$Text,
        [string]$FunctionName
    )

    $escapedName = [regex]::Escape($FunctionName)
    $declaration = [regex]::Match(
        $Text,
        "(?im)^\s*(?:function\s+)?$escapedName\s*(?:\(\s*\))?\s*\{"
    )
    Assert-True $declaration.Success "restore script must define $FunctionName with a parseable function body"

    $openBrace = $Text.IndexOf('{', $declaration.Index)
    $depth = 0
    $singleQuoted = $false
    $doubleQuoted = $false
    $escaped = $false
    $comment = $false

    for ($index = $openBrace; $index -lt $Text.Length; $index++) {
        $character = $Text[$index]

        if ($comment) {
            if ($character -eq "`n") {
                $comment = $false
            }
            continue
        }

        if ($escaped) {
            $escaped = $false
            continue
        }

        if (($singleQuoted -or $doubleQuoted) -and $character -eq '\') {
            $escaped = $true
            continue
        }

        if (-not $doubleQuoted -and $character -eq "'") {
            $singleQuoted = -not $singleQuoted
            continue
        }

        if (-not $singleQuoted -and $character -eq '"') {
            $doubleQuoted = -not $doubleQuoted
            continue
        }

        if (-not $singleQuoted -and -not $doubleQuoted -and $character -eq '#') {
            $comment = $true
            continue
        }

        if ($singleQuoted -or $doubleQuoted) {
            continue
        }

        if ($character -eq '{') {
            $depth++
        } elseif ($character -eq '}') {
            $depth--
            if ($depth -eq 0) {
                return $Text.Substring($declaration.Index, $index - $declaration.Index + 1)
            }
        }
    }

    throw "FAIL: could not find the end of function $FunctionName"
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

$mainBody = Get-BashFunctionBody $codeText 'main'
$reconstructBody = Get-BashFunctionBody $codeText 'reconstruct_payload'
$verifyBody = Get-BashFunctionBody $codeText 'verify_snapshot_counts'
Assert-Match $reconstructBody '(?i)sha-?256|sha256sum' 'reconstruct_payload must verify the payload SHA-256'
Assert-Match $mainBody '(?i)(?:systemctl|docker\s+compose)[^\r\n]*\bstop\b' 'main must stop the factory-review service'
$reconstructCallIndex = First-MatchIndex $mainBody '(?im)^\s*reconstruct_payload\b'
$stopIndex = First-MatchIndex $mainBody '(?i)(?:systemctl|docker\s+compose)[^\r\n]*\bstop\b'
Assert-True ($reconstructCallIndex -ge 0) 'main must call reconstruct_payload'
Assert-True ($reconstructCallIndex -lt $stopIndex) 'main must verify the payload before stopping the service'

$tarIndex = First-MatchIndex $mainBody '(?im)\btar\b[^\r\n]*(?:-c|--create)'
$migrateIndex = First-MatchIndex $mainBody '(?im)\bpocketbase\b[^\r\n]*\bmigrate\s+up\b|\bmigrate\s+up\b'
Assert-True ($tarIndex -ge 0) 'main must create a tar backup'
Assert-True ($migrateIndex -ge 0) 'main must invoke pocketbase migrate up'
Assert-True ($tarIndex -lt $migrateIndex) 'main must create the tar backup before pocketbase migrate up'

$requiredCounts = [ordered]@{
    users = 19
    factories = 186
    orders = 92
    quality_inspections = 479
    score_templates = 10
    monthly_scores = 1
}

$verifyText = $verifyBody
Assert-Match $verifyText '(?i)sqlite3|COUNT\s*\(' 'verify_snapshot_counts must use SQLite row counts'
foreach ($table in $requiredCounts.Keys) {
    Assert-Match $verifyText "(?i)\b$table\b" "verify_snapshot_counts must verify table $table"
    Assert-Match $verifyText "(?i)\b$($requiredCounts[$table])\b" "verify_snapshot_counts must enforce the minimum count for $table"
}

$payloadVariablePattern = '(?:FACTORY_REVIEW_DATA_PART_[123]_B64|PAYLOAD_B64|PAYLOAD_PART_[123]_B64)'
$payloadPrintPattern = "(?im)^\s*(?:(?:echo|logger|cat)\b(?![^\r\n]*>)[^\r\n]*$payloadVariablePattern|printf\b(?![^\r\n]*>)[^\r\n]*$payloadVariablePattern|printf\b[^\r\n]*(?:>&[12]|/dev/stderr)[^\r\n]*$payloadVariablePattern)"
Assert-True ($codeText -notmatch $payloadPrintPattern) 'restore script must not print payload variables'

$dataLiteralPattern = '(?i)SN' + 'APSHOT\s*=\s*\{'
$adminLiteralPattern = '(?im)(?:FACTORY_REVIEW_ADMIN_PASSWORD|ADMIN_PASSWORD|PASSWORD|PASSWD)\s*(?:=|:)\s*["''][^"'']{8,}["'']'
$securityScanPaths = @($PSCommandPath, $bashTestPath, $restorePath)
foreach ($securityPath in $securityScanPaths) {
    $securityText = Get-Content -LiteralPath $securityPath -Raw
    Assert-True ($securityText -notmatch $dataLiteralPattern) "security scan found plaintext private migration data in $securityPath"
    Assert-True ($securityText -notmatch $adminLiteralPattern) "security scan found a hardcoded admin password in $securityPath"
}

Assert-True (Test-Path -LiteralPath $bashTestPath -PathType Leaf) "behavior test is missing: $bashTestPath"
$bash = Get-Command bash -ErrorAction SilentlyContinue
Assert-True ($null -ne $bash) 'bash is required to run the behavior contract test'
& $bash.Source --noprofile --norc $bashTestPath
Assert-True ($LASTEXITCODE -eq 0) "behavior contract test failed with exit code $LASTEXITCODE"

Write-Output 'PASS: factory review restore static and behavior contracts'
