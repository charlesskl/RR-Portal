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
$workflowPath = Join-Path $repoRoot '.github\workflows\restore-factory-review-data.yml'

Assert-True (Test-Path -LiteralPath $workflowPath -PathType Leaf) "restore workflow is missing: $workflowPath"
$workflowText = Get-Content -LiteralPath $workflowPath -Raw
$workflowCodeText = [regex]::Replace($workflowText, '(?m)^\s*#.*$', '')

Assert-Match $workflowCodeText '(?im)^\s*workflow_dispatch\s*:' 'restore workflow must be manually dispatched'
Assert-True ($workflowCodeText -notmatch '(?im)^\s*push\s*:') 'restore workflow must not run on push'
Assert-True ($workflowCodeText -notmatch '(?im)^\s*pull_request(?:_target)?\s*:') 'restore workflow must not run on pull requests'
Assert-Match $workflowCodeText '(?im)^\s*timeout-minutes\s*:\s*20\s*$' 'restore workflow must have a 20-minute job timeout'
Assert-Match $workflowCodeText 'appleboy/ssh-action@0ff4204d59e8e51228ff73bce53f80d53301dee2' 'restore workflow must pin appleboy SSH action by commit SHA'
Assert-Match $workflowCodeText '(?im)^\s*command_timeout\s*:\s*20m\s*$' 'restore workflow must have a 20-minute SSH timeout'

$payloadSecrets = @(
    'FACTORY_REVIEW_DATA_PART_1_B64',
    'FACTORY_REVIEW_DATA_PART_2_B64',
    'FACTORY_REVIEW_DATA_PART_3_B64',
    'FACTORY_REVIEW_DATA_SHA256'
)
foreach ($payloadSecret in $payloadSecrets) {
    Assert-Match $workflowCodeText "(?im)^\s*$payloadSecret\s*:\s*\$\{\{\s*secrets\.$payloadSecret\s*\}\}\s*$" "restore workflow must map $payloadSecret from its repository secret"
    Assert-Match $workflowCodeText "(?im)^\s*envs\s*:\s*[^\r\n]*\b$payloadSecret\b" "restore workflow must pass $payloadSecret to SSH through envs"
}

Assert-Match $workflowCodeText '(?im)^\s*set\s+-euo\s+pipefail\s*$' 'restore workflow must enable strict shell mode'
Assert-Match $workflowCodeText '(?im)^\s*cd\s+/opt/rr-portal\s*$' 'restore workflow must operate in the production repository'
Assert-Match $workflowCodeText '(?im)^\s*git\s+checkout\s+main\s*$' 'restore workflow must check out main on the server'
Assert-Match $workflowCodeText '(?im)^\s*git\s+pull\s+--ff-only\s+origin\s+main\s*$' 'restore workflow must fast-forward server main before restoring'
Assert-Match $workflowCodeText '(?im)^\s*git\s+ls-files\s+--error-unmatch\s+deploy/restore-factory-review-data\.sh\s*$' 'restore workflow must confirm main contains the restore script'
Assert-Match $workflowCodeText '(?im)^\s*bash\s+deploy/restore-factory-review-data\.sh\s*$' 'restore workflow must invoke the restore script'

$payloadVariablePattern = '(?:\bFACTORY_REVIEW_DATA_PART_[123]_B64\b|\bFACTORY_REVIEW_DATA_SHA256\b)'
$payloadSinkPattern = "(?im)^\s*(?:echo|printf|tee|cat|logger|systemd-cat)\b[^\r\n]*$payloadVariablePattern"
Assert-True ($workflowCodeText -notmatch $payloadSinkPattern) 'restore workflow must not print payload variables'
Assert-True ($workflowCodeText -notmatch '(?im)^\s*(?:export\s+)?FACTORY_REVIEW_DATA_(?:PART_[123]_B64|SHA256)\s*=') 'restore workflow must not persist payload variables through shell assignments'

Assert-True (Test-Path -LiteralPath $restorePath -PathType Leaf) "restore script is missing: $restorePath"
$scriptText = Get-Content -LiteralPath $restorePath -Raw
$codeText = [regex]::Replace($scriptText, '(?m)^\s*#.*$', '')

$disableTraceIndex = First-MatchIndex $codeText '(?m)^\s*set\s+\+x\s*$'
$strictModeIndex = First-MatchIndex $codeText '(?m)^\s*set\s+-Eeuo\s+pipefail\s*$'
Assert-True ($disableTraceIndex -ge 0) 'restore script must disable inherited tracing before reading payload variables'
Assert-True ($strictModeIndex -ge 0) 'restore script must enable set -Eeuo pipefail'
Assert-True ($disableTraceIndex -lt $strictModeIndex) 'restore script must disable tracing before strict mode'
$tracePattern = '(?im)^\s*set\s+-[A-Za-z]*x[A-Za-z]*\b'
Assert-True ($codeText -notmatch $tracePattern) 'restore script must never enable shell tracing through combination flags containing x'
Assert-True ($codeText -notmatch '(?m)^\s*set\s+-o\s+xtrace\b') 'restore script must never enable shell tracing with set -o xtrace'
Assert-True ($codeText -notmatch '(?m)^\s*PS4\s*=') 'restore script must never configure shell tracing through PS4'
Assert-Match $codeText '(?im)^\s*trap\b[^\r\n]*\bERR\b' 'restore script must register an ERR trap'
Assert-Match $codeText '(?im)^\s*trap\b[^\r\n]*\bEXIT\b' 'restore script must register an EXIT transaction handler'
Assert-Match $codeText '(?im)^\s*trap\b[^\r\n]*\bINT\b' 'restore script must handle INT'
Assert-Match $codeText '(?im)^\s*trap\b[^\r\n]*\bTERM\b' 'restore script must handle TERM'
Assert-Match $codeText 'docker\s+compose\s+-f\s+"\$COMPOSE_FILE"\s+--env-file\s+"\$ENV_FILE"' 'Compose calls must use the configured compose and environment files'
Assert-Match $codeText '(?i)flock\s+-n' 'restore script must use a nonblocking flock'
Assert-Match $codeText '(?i)docker\s+inspect' 'restore script must inspect container health'
Assert-Match $codeText '(?i)compose\s+ps\s+-q' 'restore script must resolve the Compose container ID'
Assert-True ($codeText -notmatch '127\.0\.0\.1:8090') 'restore script must not probe a host-local health endpoint'
Assert-Match $codeText '(?i)PB_DATA_DIR=.*apps.*pb_data' 'restore script must use the production app pb_data directory'
Assert-True ($codeText -notmatch '(?im)^\s*PB_DATA_DIR=\$\{PB_DATA_DIR') 'restore script must not guess PB_DATA_DIR layouts'

$requireBody = Get-BashFunctionBody $codeText 'require_payload_parts'
$mainBody = Get-BashFunctionBody $codeText 'main'
$reconstructBody = Get-BashFunctionBody $codeText 'reconstruct_payload'
$verifyBody = Get-BashFunctionBody $codeText 'verify_snapshot_counts'
Assert-Match $requireBody '(?i)payload|FACTORY_REVIEW_DATA_PART_|part_[123]' 'require_payload_parts must validate payload parts'
Assert-Match $reconstructBody '(?i)sha-?256|sha256sum' 'reconstruct_payload must verify the payload SHA-256'
Assert-Match $mainBody '(?i)compose\s+stop\s+"\$SERVICE_NAME"' 'main must stop the factory-review service through Compose'
$reconstructCallIndex = First-MatchIndex $mainBody '(?im)^\s*reconstruct_payload\b'
$stopIndex = First-MatchIndex $mainBody '(?i)compose\s+stop\s+"\$SERVICE_NAME"'
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
$securityScanPaths = @($restorePath)
foreach ($securityPath in $securityScanPaths) {
    $securityText = Get-Content -LiteralPath $securityPath -Raw
    Assert-True ($securityText -notmatch $dataLiteralPattern) "security scan found plaintext private migration data in $securityPath"
    Assert-True ($securityText -notmatch $payloadSinkPattern) "security scan found a payload variable passed to an output command in $securityPath"
    Assert-True ($securityText -notmatch $payloadHeredocPattern) "security scan found a payload variable in an output heredoc in $securityPath"
    Assert-NoHardcodedSensitiveAssignment $securityText $securityPath
}
Assert-True ($codeText -notmatch $alternativeAdminReadPattern) 'restore script must not read alternate ADMIN_PASSWORD or PASSWORD variables'

Assert-True (Test-Path -LiteralPath $bashTestPath -PathType Leaf) "behavior test is missing: $bashTestPath"
$bash = 'C:\Program Files\Git\bin\bash.exe'
Assert-True (Test-Path -LiteralPath $bash -PathType Leaf) 'Git Bash is required to run the behavior contract test'
& $bash -c 'export PATH=/usr/bin:/bin:$PATH; exec bash --noprofile --norc "$1"' _ $bashTestPath
Assert-True ($LASTEXITCODE -eq 0) "behavior contract test failed with exit code $LASTEXITCODE"

Write-Output 'PASS: factory review restore static and behavior contracts'
