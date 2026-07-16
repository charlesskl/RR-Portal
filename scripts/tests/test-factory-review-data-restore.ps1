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

function Get-TopLevelYamlBlock {
    param(
        [string]$Text,
        [string]$Key
    )

    $escapedKey = [regex]::Escape($Key)
    $block = [regex]::Match($Text, "(?m)^${escapedKey}:\s*\r?\n(?<body>(?:^[ ]{2}[^\r\n]*(?:\r?\n|$))*)")
    Assert-True $block.Success "workflow must declare a top-level $Key block"
    return $block.Groups['body'].Value
}

function Assert-ContentsReadOnlyPermissions {
    param([string]$Text)

    $permissionsBlock = Get-TopLevelYamlBlock $Text 'permissions'
    $entries = @()
    foreach ($line in $permissionsBlock -split '\r?\n') {
        if ($line.Trim().Length -eq 0) {
            continue
        }

        if ($line -notmatch '^[ ]{2}(?<content>[^\r\n]*)$') {
            Assert-True $false 'every permissions block line must have the expected indentation'
        }

        $content = $Matches['content'].Trim()
        if ($content.Length -eq 0 -or $content.StartsWith('#')) {
            continue
        }

        $entry = [regex]::Match($content, '^(?<name>[A-Za-z][A-Za-z_-]*)\s*:\s*(?<value>[^#\r\n]*?)(?:\s+#.*)?$')
        Assert-True $entry.Success 'every non-comment permissions line must be parsed as a permission mapping'
        $entries += [PSCustomObject]@{
            Name = $entry.Groups['name'].Value
            Value = $entry.Groups['value'].Value.Trim()
        }
    }

    Assert-True ($entries.Count -eq 1 -and $entries[0].Name -eq 'contents' -and $entries[0].Value -eq 'read') 'restore workflow permissions must contain only contents: read'
}

function Get-RemoteRestoreScript {
    param([string]$Text)

    $scriptBlock = [regex]::Match($Text, '(?m)^[ ]{10}script:\s*\|\s*\r?\n(?<body>(?:^[ ]{12}[^\r\n]*(?:\r?\n|$))*)')
    Assert-True $scriptBlock.Success 'restore workflow must define an SSH script block'
    return [regex]::Replace($scriptBlock.Groups['body'].Value, '(?m)^[ ]{12}', '')
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
$deployWorkflowPath = Join-Path $repoRoot '.github\workflows\deploy.yml'
$contractWorkflowPath = Join-Path $repoRoot '.github\workflows\factory-review-restore-contract.yml'
$planPath = Join-Path $repoRoot 'docs\superpowers\plans\2026-07-16-factory-review-private-data-restore.md'
$factoryReviewDockerfiles = @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'apps') -Filter Dockerfile -File -Recurse | Where-Object {
    (Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8) -match 'ARG\s+PB_VERSION=0\.39\.6'
})
Assert-True ($factoryReviewDockerfiles.Count -eq 1) 'exactly one PocketBase 0.39.6 factory-review Dockerfile must exist'
$dockerfilePath = $factoryReviewDockerfiles[0].FullName
$composePath = Join-Path $repoRoot 'docker-compose.cloud.yml'

Assert-True (Test-Path -LiteralPath $workflowPath -PathType Leaf) "restore workflow is missing: $workflowPath"
$workflowText = Get-Content -LiteralPath $workflowPath -Raw
$workflowCodeText = [regex]::Replace($workflowText, '(?m)^\s*#.*$', '')
$deployWorkflowText = Get-Content -LiteralPath $deployWorkflowPath -Raw

$restoreConcurrency = Get-TopLevelYamlBlock $workflowCodeText 'concurrency'
$deployConcurrency = Get-TopLevelYamlBlock $deployWorkflowText 'concurrency'
$restoreConcurrencyGroup = [regex]::Match($restoreConcurrency, '(?im)^\s*group\s*:\s*(?<value>[^#\r\n]+)')
$deployConcurrencyGroup = [regex]::Match($deployConcurrency, '(?im)^\s*group\s*:\s*(?<value>[^#\r\n]+)')
Assert-True ($restoreConcurrencyGroup.Success -and $deployConcurrencyGroup.Success) 'restore and deploy workflows must declare concurrency groups'
Assert-True ($restoreConcurrencyGroup.Groups['value'].Value.Trim() -eq $deployConcurrencyGroup.Groups['value'].Value.Trim()) 'restore workflow must use the exact deploy workflow concurrency group'
Assert-True ($restoreConcurrencyGroup.Groups['value'].Value.Trim() -eq 'deploy-cloud') 'production workflow concurrency group must remain deploy-cloud'
Assert-Match $restoreConcurrency '(?im)^\s*cancel-in-progress\s*:\s*false\s*$' 'restore workflow must queue behind production deploys without cancelling in-progress work'

$triggerBlock = [regex]::Match($workflowCodeText, '(?m)^on:\s*\r?\n(?<body>(?:^[ \t]+[^\r\n]*(?:\r?\n|$))*)')
Assert-True $triggerBlock.Success 'restore workflow must declare an on block'
$triggerNames = @([regex]::Matches($triggerBlock.Groups['body'].Value, '(?m)^[ \t]+(?<name>[A-Za-z_][A-Za-z0-9_-]*)\s*:') | ForEach-Object { $_.Groups['name'].Value })
Assert-True ($triggerNames.Count -eq 1 -and $triggerNames[0] -eq 'workflow_dispatch') 'workflow_dispatch must be the only restore workflow trigger'
Assert-Match $workflowCodeText '(?im)^\s*timeout-minutes\s*:\s*20\s*$' 'restore workflow must have a 20-minute job timeout'
Assert-ContentsReadOnlyPermissions $workflowCodeText
$unsafePermissionsRejected = $false
try {
    Assert-ContentsReadOnlyPermissions "permissions:`n  contents: read`n  actions: write`n"
} catch {
    $unsafePermissionsRejected = $true
}
Assert-True $unsafePermissionsRejected 'permissions parser must reject actions: write'
$inlineCommentPermissionsRejected = $false
try {
    Assert-ContentsReadOnlyPermissions "permissions:`n  contents: read`n  actions: write # comment`n"
} catch {
    $inlineCommentPermissionsRejected = $true
}
Assert-True $inlineCommentPermissionsRejected 'permissions parser must reject actions: write with an inline comment'

$checkoutActionSha = '11bd71901bbe5b1630ceea73d27597364c9af683'
Assert-Match $workflowCodeText "(?ms)^\s*-\s*name:\s*Checkout selected ref\s*\r?\n\s*uses:\s*actions/checkout@$checkoutActionSha\s*\r?\n\s*with:\s*\r?\n\s*ref:\s*\$\{\{\s*github\.ref\s*\}\}\s*\r?\n\s*persist-credentials:\s*false\s*$" 'restore workflow must use a pinned selected-ref checkout without persisted credentials'
Assert-Match $workflowCodeText 'appleboy/ssh-action@0ff4204d59e8e51228ff73bce53f80d53301dee2' 'restore workflow must pin appleboy SSH action by commit SHA'
Assert-Match $workflowCodeText '(?im)^\s*command_timeout\s*:\s*20m\s*$' 'restore workflow must have a 20-minute SSH timeout'
Assert-True ($workflowCodeText -notmatch '(?m)^\s{4}env:\s*$') 'restore workflow must not expose secrets through job-level env'

$preflightStep = [regex]::Match($workflowCodeText, '(?ms)^\s{6}-\s*name:\s*Validate SSH host fingerprint\s*$.*?(?=^\s{6}-\s*name:|\z)')
Assert-True $preflightStep.Success 'restore workflow must validate the SSH fingerprint in an independent preflight step'
$preflightText = $preflightStep.Value
$preflightSecretReferences = @([regex]::Matches($preflightText, '\$\{\{\s*secrets\.(?<name>[A-Za-z0-9_]+)\s*\}\}') | ForEach-Object { $_.Groups['name'].Value } | Select-Object -Unique)
Assert-True ($preflightSecretReferences.Count -eq 1 -and $preflightSecretReferences[0] -eq 'CLOUD_HOST_FINGERPRINT') 'SSH preflight must read only CLOUD_HOST_FINGERPRINT'
Assert-Match $preflightText '(?im)^\s*set\s+-euo\s+pipefail\s*$' 'SSH fingerprint preflight must use strict shell mode'
Assert-Match $preflightText '\^SHA256:\[A-Za-z0-9\+/\]\{43\}=\?\$' 'SSH fingerprint preflight must accept only OpenSSH SHA256 fingerprints with an optional trailing equals sign'
$fingerprintPattern = '^SHA256:[A-Za-z0-9+/]{43}=?$'
foreach ($validFingerprint in @(
    ('SHA256:' + ('A' * 43)),
    ('SHA256:' + ('A' * 43) + '=')
)) {
    Assert-True ($validFingerprint -match $fingerprintPattern) 'fingerprint contract must accept padded and unpadded OpenSSH SHA256 forms'
}
foreach ($invalidFingerprint in @(
    '',
    ('SHA256:' + ('A' * 42)),
    ('SHA256:' + ('A' * 43) + '=='),
    ('SHA256:' + ('*' * 43))
)) {
    Assert-True ($invalidFingerprint -notmatch $fingerprintPattern) 'fingerprint contract must fail closed for missing or malformed values before SSH'
}
$preflightIndex = $preflightStep.Index
$sshStep = [regex]::Match($workflowCodeText, '(?ms)^\s{6}-\s*name:\s*Restore production data via SSH\s*$.*?(?=^\s{6}-\s*name:|\z)')
Assert-True $sshStep.Success 'restore workflow must define a dedicated SSH restore step'
$sshActionIndex = First-MatchIndex $workflowCodeText 'appleboy/ssh-action@0ff4204d59e8e51228ff73bce53f80d53301dee2'
Assert-True ($preflightIndex -lt $sshStep.Index) 'SSH fingerprint preflight must run before the SSH action'

$payloadSecrets = @(
    'FACTORY_REVIEW_DATA_PART_1_B64',
    'FACTORY_REVIEW_DATA_PART_2_B64',
    'FACTORY_REVIEW_DATA_PART_3_B64',
    'FACTORY_REVIEW_DATA_SHA256'
)
foreach ($payloadSecret in $payloadSecrets) {
    Assert-Match $workflowCodeText "(?im)^\s{10}$payloadSecret\s*:\s*\$\{\{\s*secrets\.$payloadSecret\s*\}\}\s*$" "restore workflow must map $payloadSecret from its repository secret in the SSH step env"
    Assert-Match $workflowCodeText "(?im)^\s*envs\s*:\s*[^\r\n]*\b$payloadSecret\b" "restore workflow must pass $payloadSecret to SSH through envs"
    $payloadSecretReference = "\$\{\{\s*secrets\.$payloadSecret\s*\}\}"
    Assert-True ([regex]::Matches($workflowCodeText, $payloadSecretReference).Count -eq 1) "$payloadSecret must be read only by the SSH step"
    Assert-True ((First-MatchIndex $workflowCodeText $payloadSecretReference) -gt $sshStep.Index) "$payloadSecret must be scoped to the SSH step"
}
Assert-Match $workflowCodeText '(?im)^\s{10}CLOUD_HOST_FINGERPRINT\s*:\s*\$\{\{\s*secrets\.CLOUD_HOST_FINGERPRINT\s*\}\}\s*$' 'restore workflow must source the SSH fingerprint from a non-empty repository secret'
Assert-Match $workflowCodeText '(?im)^\s{10}EXPECTED_COMMIT\s*:\s*\$\{\{\s*github\.sha\s*\}\}\s*$' 'restore workflow must pass the dispatched commit identity'
Assert-Match $workflowCodeText '(?im)^\s*fingerprint\s*:\s*\$\{\{\s*env\.CLOUD_HOST_FINGERPRINT\s*\}\}\s*$' 'restore workflow must use the configured SSH host fingerprint'
Assert-Match $workflowCodeText '(?im)^\s*envs\s*:\s*[^\r\n]*\bEXPECTED_COMMIT\b' 'restore workflow must pass EXPECTED_COMMIT to SSH through envs'

Assert-Match $workflowCodeText '(?im)^\s*set\s+-euo\s+pipefail\s*$' 'restore workflow must enable strict shell mode'
Assert-Match $workflowCodeText '(?im)^\s*cd\s+/opt/rr-portal\s*$' 'restore workflow must operate in the production repository'
Assert-Match $workflowCodeText '(?im)^\s*git\s+fetch\s+origin\s+main\s*$' 'restore workflow must fetch origin main before restoring'
Assert-Match $workflowCodeText '(?im)^\s*test\s+"\$\(git\s+rev-parse\s+origin/main\)"\s*=\s*"\$EXPECTED_COMMIT"\s*$' 'restore workflow must require origin main to equal the dispatched commit'
Assert-Match $workflowCodeText '(?im)^\s*test\s+"\$\(git\s+rev-parse\s+HEAD\)"\s*=\s*"\$EXPECTED_COMMIT"\s*$' 'restore workflow must require HEAD to equal the dispatched commit'
Assert-Match $workflowCodeText '(?im)^\s*git\s+ls-files\s+--error-unmatch\s+--\s+deploy/restore-factory-review-data\.sh\s*>\s*/dev/null\s*$' 'restore workflow must require the restore script to be tracked in the current checkout'
Assert-Match $workflowCodeText '(?im)^\s*test\s+-z\s+"\$\(git\s+status\s+--porcelain\s+--untracked-files=all\s+--\s+deploy/restore-factory-review-data\.sh\)"\s*$' 'restore workflow must require the restore script to be clean, including untracked replacement files'
Assert-Match $workflowCodeText '(?im)^\s*bash\s+deploy/restore-factory-review-data\.sh\s*$' 'restore workflow must invoke the restore script'
$remoteRestoreScript = Get-RemoteRestoreScript $workflowCodeText
$remoteStepPatterns = [ordered]@{
    fetch = '(?im)^\s*git\s+fetch\s+origin\s+main\s*$'
    originCommit = '(?im)^\s*test\s+"\$\(git\s+rev-parse\s+origin/main\)"\s*=\s*"\$EXPECTED_COMMIT"\s*$'
    headCheck = '(?im)^\s*test\s+"\$\(git\s+rev-parse\s+HEAD\)"\s*=\s*"\$EXPECTED_COMMIT"\s*$'
    trackedScript = '(?im)^\s*git\s+ls-files\s+--error-unmatch\s+--\s+deploy/restore-factory-review-data\.sh\s*>\s*/dev/null\s*$'
    scriptClean = '(?im)^\s*test\s+-z\s+"\$\(git\s+status\s+--porcelain\s+--untracked-files=all\s+--\s+deploy/restore-factory-review-data\.sh\)"\s*$'
    restore = '(?im)^\s*bash\s+deploy/restore-factory-review-data\.sh\s*$'
}
$remoteStepIndices = [ordered]@{}
foreach ($stepName in $remoteStepPatterns.Keys) {
    $remoteStepIndices[$stepName] = First-MatchIndex $remoteRestoreScript $remoteStepPatterns[$stepName]
    Assert-True ($remoteStepIndices[$stepName] -ge 0) "remote restore script must include $stepName"
}
$remoteStepNames = @($remoteStepPatterns.Keys)
for ($index = 1; $index -lt $remoteStepNames.Count; $index++) {
    $previousStep = $remoteStepNames[$index - 1]
    $currentStep = $remoteStepNames[$index]
    Assert-True ($remoteStepIndices[$previousStep] -lt $remoteStepIndices[$currentStep]) "remote restore script must run $previousStep before $currentStep"
}
Assert-True ($workflowCodeText -notmatch '(?im)^\s*git\s+pull\b') 'restore workflow must not use unsafe git pull'
Assert-True ($workflowCodeText -notmatch '(?im)^\s*git\s+checkout\b') 'restore workflow must not use git checkout to replace local state'
Assert-True ($workflowCodeText -notmatch '(?im)^\s*git\s+reset\b') 'restore workflow must not reset or overwrite server state'
Assert-True ($workflowCodeText -notmatch '(?im)^\s*git\s+(?:switch|merge|rebase|cherry-pick)\b') 'restore workflow must never advance or mutate the production checkout'

$payloadVariablePattern = '(?:\bFACTORY_REVIEW_DATA_PART_[123]_B64\b|\bFACTORY_REVIEW_DATA_SHA256\b)'
$payloadSinkPattern = "(?im)^\s*(?:echo|printf|tee|cat|env|printenv|logger|systemd-cat|curl|wget)\b[^\r\n]*$payloadVariablePattern"
$payloadRedirectionPattern = "(?im)^\s*[^\r\n]*$payloadVariablePattern[^\r\n]*(?:>>?|<<?)[^\r\n]*$"
Assert-True ($workflowCodeText -notmatch $payloadSinkPattern) 'restore workflow must not disclose payload variables through shell commands'
Assert-True ($workflowCodeText -notmatch $payloadRedirectionPattern) 'restore workflow must not disclose payload variables through redirection'
Assert-True ($workflowCodeText -notmatch '(?im)^\s*(?:export\s+)?FACTORY_REVIEW_DATA_(?:PART_[123]_B64|SHA256)\s*=') 'restore workflow must not persist payload variables through shell assignments'

$workflowUnsafeDisclosurePatterns = @(
    '(?im)^\s*set\s+-[A-Za-z]*x[A-Za-z]*\b',
    '(?im)^\s*set\s+-o\s+xtrace\b',
    '(?im)^\s*bash\b[^\r\n]*\B-x\b',
    '(?im)^\s*declare\s+-p\b',
    '\$\{![A-Za-z_][A-Za-z0-9_]*\}'
)
foreach ($unsafePattern in $workflowUnsafeDisclosurePatterns) {
    Assert-True ($workflowCodeText -notmatch $unsafePattern) 'restore workflow must not enable tracing, enumerate variables, or use indirect expansion'
}
$workflowUnsafeDisclosureFixtures = @(
    @{ Pattern = $workflowUnsafeDisclosurePatterns[0]; Text = 'set -x' },
    @{ Pattern = $workflowUnsafeDisclosurePatterns[0]; Text = 'set -euxo pipefail' },
    @{ Pattern = $workflowUnsafeDisclosurePatterns[1]; Text = 'set -o xtrace' },
    @{ Pattern = $workflowUnsafeDisclosurePatterns[2]; Text = 'bash -x deploy/restore-factory-review-data.sh' },
    @{ Pattern = $workflowUnsafeDisclosurePatterns[3]; Text = 'declare -p FACTORY_REVIEW_DATA_PART_1_B64' },
    @{ Pattern = $workflowUnsafeDisclosurePatterns[4]; Text = 'printf "%s\\n" "${!payload_name}"' }
)
foreach ($fixture in $workflowUnsafeDisclosureFixtures) {
    Assert-True ($fixture.Text -match $fixture.Pattern) 'workflow disclosure fixture must be rejected'
}

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
$revisionBody = Get-BashFunctionBody $codeText 'verify_running_revision'
$restoreBackupBody = Get-BashFunctionBody $codeText 'restore_backup'
$verifyBody = Get-BashFunctionBody $codeText 'verify_snapshot_counts'
Assert-Match $requireBody '(?i)payload|FACTORY_REVIEW_DATA_PART_|part_[123]' 'require_payload_parts must validate payload parts'
Assert-Match $requireBody '(?i)EXPECTED_COMMIT' 'require_payload_parts must require the expected deployed commit'
Assert-Match $requireBody '\^\[0-9a-f\]\{40\}\$' 'EXPECTED_COMMIT must be exactly 40 lowercase hexadecimal characters'
Assert-Match $reconstructBody '(?i)sha-?256|sha256sum' 'reconstruct_payload must verify the payload SHA-256'
Assert-Match $revisionBody '(?i)compose\s+ps\s+-q' 'verify_running_revision must resolve the currently running Compose container'
Assert-Match $revisionBody '(?i)docker\s+inspect' 'verify_running_revision must inspect the current container image ID'
Assert-Match $revisionBody '(?i)docker\s+image\s+inspect' 'verify_running_revision must inspect the current image labels'
Assert-Match $revisionBody 'org\.opencontainers\.image\.revision' 'verify_running_revision must read the OCI revision label'
Assert-Match $revisionBody '(?i)EXPECTED_COMMIT' 'verify_running_revision must compare the OCI revision with EXPECTED_COMMIT'
Assert-Match $mainBody '(?i)compose\s+stop\s+"\$SERVICE_NAME"' 'main must stop the factory-review service through Compose'
$requireCallIndex = First-MatchIndex $mainBody '(?im)^\s*require_payload_parts\b'
$revisionCallIndex = First-MatchIndex $mainBody '(?im)^\s*verify_running_revision\b'
$reconstructCallIndex = First-MatchIndex $mainBody '(?im)^\s*reconstruct_payload\b'
$stopIndex = First-MatchIndex $mainBody '(?i)compose\s+stop\s+"\$SERVICE_NAME"'
$cleanupCallIndex = First-MatchIndex $mainBody '(?im)^\s*(?:if\s+!\s+)?cleanup_temp_files\b'
$commitIndex = First-MatchIndex $mainBody '(?im)^\s*committed=1\s*$'
Assert-True ($requireCallIndex -ge 0) 'main must validate EXPECTED_COMMIT before external operations'
Assert-True ($revisionCallIndex -ge 0) 'main must verify the running image revision'
Assert-True ($reconstructCallIndex -ge 0) 'main must call reconstruct_payload'
Assert-True ($requireCallIndex -lt $reconstructCallIndex) 'main must validate EXPECTED_COMMIT before reconstructing plaintext'
Assert-True ($reconstructCallIndex -lt $revisionCallIndex) 'main must validate payload integrity before Docker inspection'
Assert-True ($revisionCallIndex -lt $stopIndex) 'main must reject a stale image before stopping the service'
Assert-True ($reconstructCallIndex -lt $stopIndex) 'main must verify the payload before stopping the service'
Assert-True ($cleanupCallIndex -ge 0 -and $commitIndex -ge 0 -and $cleanupCallIndex -lt $commitIndex) 'main must strictly clean plaintext temporary files before committing the transaction'
Assert-Match $restoreBackupBody '(?is)start_and_verify_service.*compose\s+stop\s+"\$SERVICE_NAME"' 'rollback must explicitly stop factory-review when restored data never becomes healthy'

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

Assert-True (Test-Path -LiteralPath $dockerfilePath -PathType Leaf) "factory-review Dockerfile is missing: $dockerfilePath"
$dockerfileText = Get-Content -LiteralPath $dockerfilePath -Raw
$finalStage = [regex]::Match($dockerfileText, '(?ms)^FROM\s+alpine:3\.22\s*$.*\z')
Assert-True $finalStage.Success 'factory-review Dockerfile must retain the Alpine final stage'
Assert-Match $finalStage.Value '(?im)^ARG\s+OCI_REVISION\s*$' 'factory-review final image must accept OCI_REVISION'
Assert-Match $finalStage.Value '(?im)^LABEL\s+org\.opencontainers\.image\.revision="\$OCI_REVISION"\s*$' 'factory-review final image must label its exact source revision'

Assert-True (Test-Path -LiteralPath $composePath -PathType Leaf) "cloud Compose file is missing: $composePath"
$composeText = Get-Content -LiteralPath $composePath -Raw
$factoryReviewCompose = [regex]::Match($composeText, '(?ms)^\s{2}factory-review:\s*$.*?(?=^\s{2}[A-Za-z0-9_-]+:\s*$|\z)')
Assert-True $factoryReviewCompose.Success 'cloud Compose must define factory-review'
Assert-Match $factoryReviewCompose.Value '(?im)^\s{8}OCI_REVISION:\s*\$\{AFTER_COMMIT:-local\}\s*$' 'factory-review build must receive the deployed AFTER_COMMIT with a local fallback'

Assert-True (Test-Path -LiteralPath $contractWorkflowPath -PathType Leaf) "PR contract workflow is missing: $contractWorkflowPath"
$contractWorkflowText = Get-Content -LiteralPath $contractWorkflowPath -Raw
$contractWorkflowCode = [regex]::Replace($contractWorkflowText, '(?m)^\s*#.*$', '')
Assert-ContentsReadOnlyPermissions $contractWorkflowCode
Assert-True ($contractWorkflowCode -match '(?m)^\s{2}pull_request:\s*$') 'PR contract workflow must trigger automatically for pull requests'
Assert-True ($contractWorkflowCode -match '(?m)^\s{2}workflow_dispatch:\s*$') 'PR contract workflow must also support manual dispatch'
Assert-True ($contractWorkflowCode -notmatch '\$\{\{\s*secrets\.') 'PR contract workflow must never read repository Secrets'
Assert-Match $contractWorkflowCode "actions/checkout@$checkoutActionSha" 'PR contract workflow must pin checkout by commit SHA'
Assert-Match $contractWorkflowCode '(?im)^\s*fetch-depth\s*:\s*0\s*$' 'PR contract workflow must fetch branch history for object scanning'
Assert-Match $contractWorkflowCode '(?im)^\s*persist-credentials\s*:\s*false\s*$' 'PR contract workflow must not persist checkout credentials'
$contractPaths = @(
    '.github/workflows/deploy.yml',
    '.github/workflows/restore-factory-review-data.yml',
    '.github/workflows/factory-review-restore-contract.yml',
    'deploy/restore-factory-review-data.sh',
    'scripts/tests/test-factory-review-data-restore.ps1',
    'scripts/tests/test-factory-review-data-restore.sh',
    'apps/PMC跟仓管/加工厂月度评审管理制度/Dockerfile',
    'docker-compose.cloud.yml',
    'docs/superpowers/specs/2026-07-16-factory-review-private-data-restore-design.md',
    'docs/superpowers/plans/2026-07-16-factory-review-private-data-restore.md'
)
foreach ($contractPath in $contractPaths) {
    Assert-True ($contractWorkflowCode.Contains("- '$contractPath'") -or $contractWorkflowCode.Contains("- `"$contractPath`"")) "PR contract workflow paths must cover $contractPath"
}
Assert-Match $contractWorkflowCode '(?im)pwsh\s+-NoProfile\s+-File\s+scripts/tests/test-factory-review-data-restore\.ps1' 'PR contract workflow must run the PowerShell contract'
Assert-Match $contractWorkflowCode '(?im)bash\s+scripts/tests/test-factory-review-data-restore\.sh' 'PR contract workflow must run the Bash behavior contract directly'
Assert-Match $contractWorkflowCode '(?im)git\s+diff\s+--check\s+origin/main\.\.\.HEAD' 'PR contract workflow must check the complete branch diff'
Assert-Match $contractWorkflowCode '(?i)rev-list\s+--objects\s+origin/main\.\.HEAD' 'PR contract workflow must inspect branch-only Git objects'
Assert-Match $contractWorkflowCode '(?i)cat-file' 'PR contract workflow must inspect branch-only blob sizes'
Assert-True ($contractWorkflowCode.Contains('const\s+SNAPSHOT\s*=\s*\{(?!\s*\})')) 'PR contract workflow must scan non-empty snapshot object literals instead of harmless markers or empty test fixtures'

$planText = Get-Content -LiteralPath $planPath -Raw -Encoding UTF8
Assert-Match $planText '(?i)exactly three non-empty contiguous parts' 'restore plan must always require exactly three non-empty payload parts'
Assert-Match $planText '(?i)floor\(length / 3\)' 'restore plan must define true quotient-and-remainder splitting'
Assert-True ($planText -notmatch '(?i)three or fewer') 'restore plan must not permit fewer than three payload parts'

Assert-True (Test-Path -LiteralPath $bashTestPath -PathType Leaf) "behavior test is missing: $bashTestPath"
$gitBash = 'C:\Program Files\Git\bin\bash.exe'
$bash = if (Test-Path -LiteralPath $gitBash -PathType Leaf) { $gitBash } else { (Get-Command bash -ErrorAction Stop).Source }
Assert-True (Test-Path -LiteralPath $bash -PathType Leaf) 'Bash is required to run the behavior contract test'
& $bash -c 'export PATH=/usr/bin:/bin:$PATH; exec bash --noprofile --norc "$1"' _ $bashTestPath
Assert-True ($LASTEXITCODE -eq 0) "behavior contract test failed with exit code $LASTEXITCODE"

Write-Output 'PASS: factory review restore static and behavior contracts'
