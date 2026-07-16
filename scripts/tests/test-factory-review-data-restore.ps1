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

function Assert-NoHardcodedSensitiveAssignment {
    param(
        [string]$Text,
        [string]$Path
    )

    $assignmentPattern = '(?im)^\s*(?:export\s+)?(?<name>[A-Za-z_][A-Za-z0-9_]*?(?:PASSWORD|PASSWD|PASSPHRASE|SECRET|TOKEN|PRIVATE_KEY|ADMIN_PASSWORD[A-Za-z0-9_]*))\s*=(?<value>[^\r\n;#]*)'
    $allowedValuePattern = '^(?:["''])?\$\{[^}]+\}(?:["''])?$'
    foreach ($match in [regex]::Matches($Text, $assignmentPattern)) {
        $value = $match.Groups['value'].Value.Trim()
        if ($value -notmatch '^(?:["'']){0,2}$' -and $value -notmatch $allowedValuePattern) {
            throw "FAIL: hardcoded sensitive variable $($match.Groups['name'].Value) in $Path"
        }
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$restorePath = Join-Path $repoRoot 'deploy\restore-factory-review-data.sh'
$bashTestPath = Join-Path $PSScriptRoot 'test-factory-review-data-restore.sh'

Assert-True (Test-Path -LiteralPath $restorePath -PathType Leaf) "restore script is missing: $restorePath"
$scriptText = Get-Content -LiteralPath $restorePath -Raw
$codeText = [regex]::Replace($scriptText, '(?m)^\s*#.*$', '')

Assert-Match $codeText '(?m)^\s*set\s+-euo\s+pipefail\s*$' 'restore script must enable set -euo pipefail'
$tracePattern = '(?im)^\s*set\s+-[A-Za-z]*x[A-Za-z]*\b'
Assert-True ($codeText -notmatch $tracePattern) 'restore script must never enable shell tracing through combination flags containing x'
Assert-True ($codeText -notmatch '(?m)^\s*set\s+-o\s+xtrace\b') 'restore script must never enable shell tracing with set -o xtrace'
Assert-True ($codeText -notmatch '(?m)^\s*PS4\s*=') 'restore script must never configure shell tracing through PS4'
Assert-Match $codeText '(?im)^\s*trap\b[^\r\n]*\bERR\b' 'restore script must register an ERR trap'

$requireBody = Get-BashFunctionBody $codeText 'require_payload_parts'
$mainBody = Get-BashFunctionBody $codeText 'main'
$reconstructBody = Get-BashFunctionBody $codeText 'reconstruct_payload'
$verifyBody = Get-BashFunctionBody $codeText 'verify_snapshot_counts'
Assert-Match $requireBody '(?i)payload|FACTORY_REVIEW_DATA_PART_|part_[123]' 'require_payload_parts must validate payload parts'
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

$payloadVariablePattern = '(?:\bFACTORY_REVIEW_DATA_PART_[123]_B64\b|\bPAYLOAD_B64\b|\bPAYLOAD_PART_[123]_B64\b|\bPART_[123](?:_B64)?\b|\bpart[123](?:_b64)?\b|\bpayload_b64\b)'
$payloadSinkPattern = "(?im)^\s*(?:echo|printf|tee|cat|logger|systemd-cat)\b[^\r\n]*$payloadVariablePattern"
$payloadHeredocPattern = '(?ims)^\s*(?:echo|printf|tee|cat|logger|systemd-cat)\b[^\r\n]*<<-?\s*[''\"]?(?<delimiter>[A-Za-z_][A-Za-z0-9_]*)[''\"]?[^\r\n]*\r?\n(?:(?!^\k<delimiter>\s*$).)*?' + $payloadVariablePattern
$payloadLeakFixtures = @(
    'echo "$PAYLOAD_B64"',
    'printf "%s" "$PART_1" >&2',
    'printf "%s" "$PART_2" > /tmp/output.log',
    'tee /tmp/output.log <<< "$PART_3"',
    'cat "$PART_1"',
    'logger --tag restore "$PAYLOAD_B64"',
    'systemd-cat --identifier=restore "$PART_2"',
    "cat <<'EOF'`n`$PART_2`nEOF"
)
foreach ($fixture in $payloadLeakFixtures) {
    Assert-True (($fixture -match $payloadSinkPattern) -or ($fixture -match $payloadHeredocPattern)) 'payload leak fixture must be rejected'
}
Assert-True ('cat "$internal_file" > /tmp/output.log' -notmatch $payloadSinkPattern) 'ordinary internal file output must not be treated as payload leakage'

$sensitiveLiteralFixtures = @(
    'DB_PASSWORD=abc123',
    'DB_PASSWD=abc123',
    'KEY_PASSPHRASE=abc123',
    'API_SECRET=secret',
    'API_TOKEN=abc123',
    'TLS_PRIVATE_KEY=private-key',
    'SERVICE_ADMIN_PASSWORD_VALUE=admin123',
    'FACTORY_REVIEW_ADMIN_PASSWORD=admin123'
)
foreach ($fixture in $sensitiveLiteralFixtures) {
    $rejected = $false
    try { Assert-NoHardcodedSensitiveAssignment $fixture '<fixture>' } catch { $rejected = $true }
    Assert-True $rejected 'non-empty sensitive assignments must be rejected'
}
$allowedSensitiveFixtures = @(
    'API_TOKEN=',
    'API_TOKEN=""',
    'DB_PASSWORD=${DB_PASSWORD:-}',
    'FACTORY_REVIEW_ADMIN_PASSWORD=${FACTORY_REVIEW_ADMIN_PASSWORD:-}'
)
foreach ($fixture in $allowedSensitiveFixtures) {
    Assert-NoHardcodedSensitiveAssignment $fixture '<fixture>'
}

$traceFixtures = @(
    'set -euxo pipefail',
    'set -x',
    'set -o xtrace'
)
foreach ($fixture in $traceFixtures) {
    Assert-True ($fixture -match $tracePattern -or $fixture -match '(?im)^\s*set\s+-o\s+xtrace\b') 'tracing bypass fixture must be rejected'
}
Assert-True ('set -euo pipefail' -notmatch $tracePattern) 'safe strict-mode flags must remain allowed'

$dataLiteralPattern = '(?i)SN' + 'APSHOT\s*=\s*\{'
$alternativeAdminReadPattern = '(?im)(?<!FACTORY_REVIEW_)\b(?:ADMIN_PASSWORD|PASSWORD)\b'
$securityScanPaths = @($PSCommandPath, $bashTestPath, $restorePath)
foreach ($securityPath in $securityScanPaths) {
    $securityText = Get-Content -LiteralPath $securityPath -Raw
    Assert-True ($securityText -notmatch $dataLiteralPattern) "security scan found plaintext private migration data in $securityPath"
    Assert-True ($securityText -notmatch $payloadSinkPattern) "security scan found a payload variable passed to an output command in $securityPath"
    Assert-True ($securityText -notmatch $payloadHeredocPattern) "security scan found a payload variable in an output heredoc in $securityPath"
    Assert-NoHardcodedSensitiveAssignment $securityText $securityPath
}
Assert-True ($codeText -notmatch $alternativeAdminReadPattern) 'restore script must not read alternate ADMIN_PASSWORD or PASSWORD variables'

Assert-True (Test-Path -LiteralPath $bashTestPath -PathType Leaf) "behavior test is missing: $bashTestPath"
$bash = Get-Command bash -ErrorAction SilentlyContinue
Assert-True ($null -ne $bash) 'bash is required to run the behavior contract test'
& $bash.Source --noprofile --norc $bashTestPath
Assert-True ($LASTEXITCODE -eq 0) "behavior contract test failed with exit code $LASTEXITCODE"

Write-Output 'PASS: factory review restore static and behavior contracts'
