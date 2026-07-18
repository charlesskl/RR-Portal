$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$composeFiles = @('docker-compose.yml', 'docker-compose.cloud.yml')
$requiredSecrets = @(
    'INDO_SQL_SA_PASSWORD',
    'INDO_SQL_APP_PASSWORD',
    'INDO_SHIPPING_JWT_KEY',
    'INDO_SHIPPING_ADMIN_PASSWORD'
)
$requiredTransportSecrets = @(
    'INDO_SQL_SA_PASSWORD_B64',
    'INDO_SQL_APP_PASSWORD_B64',
    'INDO_SHIPPING_JWT_KEY_B64',
    'INDO_SHIPPING_ADMIN_PASSWORD_B64'
)

function Assert-Contract {
    param(
        [Parameter(Mandatory)] [bool] $Condition,
        [Parameter(Mandatory)] [string] $Message
    )

    if (-not $Condition) {
        throw "Compose contract failed: $Message"
    }
}

function Get-ServiceBlock {
    param(
        [Parameter(Mandatory)] [string] $ComposeText,
        [Parameter(Mandatory)] [string] $ServiceName,
        [Parameter(Mandatory)] [string] $ComposeFile
    )

    $escapedName = [Regex]::Escape($ServiceName)
    $match = [Regex]::Match(
        $ComposeText,
        "(?ms)^  ${escapedName}:\r?\n(?<body>.*?)(?=^  [A-Za-z0-9][A-Za-z0-9_-]*:\r?$|^networks:\r?$|\z)"
    )
    Assert-Contract $match.Success "$ComposeFile is missing service $ServiceName"
    return $match.Groups['body'].Value
}

function Assert-StaticComposeContract {
    param(
        [Parameter(Mandatory)] [string] $ComposeFile,
        [Parameter(Mandatory)] [string] $ComposeText
    )

    $sql = Get-ServiceBlock $ComposeText 'indo-sqlserver' $ComposeFile
    $init = Get-ServiceBlock $ComposeText 'indo-shipping-init' $ComposeFile
    $app = Get-ServiceBlock $ComposeText 'indo-shipping' $ComposeFile

    Assert-Contract ($sql -notmatch '(?m)^    ports:\s*$') "$ComposeFile publishes SQL Server ports"
    Assert-Contract ($sql -match '(?m)^      - ["'']?\./data/indo-sqlserver:/var/opt/mssql["'']?\s*$') "$ComposeFile must bind ./data/indo-sqlserver to /var/opt/mssql"
    Assert-Contract ($sql -match '(?m)^      - ["'']?\./backups/indo-sqlserver:/var/opt/mssql/backup["'']?\s*$') "$ComposeFile must bind ./backups/indo-sqlserver to /var/opt/mssql/backup"
    Assert-Contract ($sql -match '(?m)^      MSSQL_MEMORY_LIMIT_MB:\s*["'']?1536["'']?\s*$') "$ComposeFile must cap SQL Server at 1536 MB"
    Assert-Contract ($sql -match '(?m)^    mem_limit:\s*2304m\s*$') "$ComposeFile must cap the SQL container at 2304 MB"
    Assert-Contract ($sql -match '/opt/mssql-tools18/bin/sqlcmd') "$ComposeFile must use the SQL 2022 tools18 path"
    Assert-Contract ($sql -match '(?m)(?:^|\s)-C(?:\s|$)') "$ComposeFile sqlcmd health check must trust the image self-signed certificate while retaining encryption"
    Assert-Contract ($sql -match 'INDO_SQL_SA_PASSWORD_B64') "$ComposeFile SQL service must receive the base64 SA transport"
    Assert-Contract ($sql -match 'base64\s+--decode') "$ComposeFile SQL service must decode the SA password only inside the container"

    Assert-Contract ($init -match '(?m)^    restart:\s*["'']?no["'']?\s*$') "$ComposeFile init job restart policy must be no"
    Assert-Contract ($init -match '(?m)^      target:\s*bootstrap\s*$') "$ComposeFile init job must use the bootstrap image target"
    Assert-Contract ($init -notmatch 'INDO_SQL_SA_CONNECTION|INDO_SQL_APP_PASSWORD:|INDO_SHIPPING_ADMIN_PASSWORD:') "$ComposeFile init job must not receive raw secret values or a concatenated SA connection"
    Assert-Contract ($init -match 'INDO_SQL_SA_PASSWORD_B64') "$ComposeFile init job must receive the base64 SA transport"
    Assert-Contract ($init -match 'INDO_SQL_APP_PASSWORD_B64') "$ComposeFile init job must receive the base64 app-password transport"
    Assert-Contract ($init -match 'INDO_SHIPPING_ADMIN_PASSWORD_B64') "$ComposeFile init job must receive the base64 admin-password transport"
    Assert-Contract ($init -match '/db:/app/db:ro') "$ComposeFile init job must mount the schema directory excluded from the Docker context"
    Assert-Contract ($init -match '(?m)^      - ["'']?\./data/indo-shipping-seed:/app/seed:ro["'']?\s*$') "$ComposeFile init job must mount the server-private seed directory"
    Assert-Contract ($app -notmatch 'INDO_SQL_SA_CONNECTION|User ID=sa|ConnectionStrings__Default|Jwt__Key') "$ComposeFile runtime app must never receive SA credentials or manually concatenated secret configuration"
    Assert-Contract ($app -match 'INDO_SQL_APP_PASSWORD_B64') "$ComposeFile runtime app must receive the base64 app-password transport"
    Assert-Contract ($app -match 'INDO_SHIPPING_JWT_KEY_B64') "$ComposeFile runtime app must receive the base64 JWT transport"

    Assert-Contract ($app -notmatch '(?m)^    ports:\s*$') "$ComposeFile must not publish the app port"
    $exposedPorts = @([Regex]::Matches($app, '(?m)^      - ["'']?(\d+)["'']?\s*$') | ForEach-Object { $_.Groups[1].Value })
    Assert-Contract (($exposedPorts.Count -eq 1) -and ($exposedPorts[0] -eq '5180')) "$ComposeFile app must expose only internal port 5180"
    Assert-Contract ($app -match 'http://(?:localhost|127\.0\.0\.1):5180/api/health') "$ComposeFile app health check must use the DB-aware API health endpoint"

    foreach ($secret in $requiredTransportSecrets) {
        $requiredPattern = '\$\{' + [Regex]::Escape($secret) + ':\?[^}]+\}'
        Assert-Contract ($ComposeText -match $requiredPattern) "$ComposeFile must require $secret with shell required-variable interpolation"
        $defaultPattern = '\$\{' + [Regex]::Escape($secret) + ':-'
        Assert-Contract ($ComposeText -notmatch $defaultPattern) "$ComposeFile must not provide a default for $secret"
    }
}

function Assert-RenderedComposeContract {
    param(
        [Parameter(Mandatory)] [string] $ComposeFile,
        [Parameter(Mandatory)] [object] $Config
    )

    $sql = $Config.services.'indo-sqlserver'
    $init = $Config.services.'indo-shipping-init'
    $app = $Config.services.'indo-shipping'
    Assert-Contract ($null -ne $sql) "$ComposeFile rendered config is missing indo-sqlserver"
    Assert-Contract ($null -ne $init) "$ComposeFile rendered config is missing indo-shipping-init"
    Assert-Contract ($null -ne $app) "$ComposeFile rendered config is missing indo-shipping"

    Assert-Contract (@($sql.ports).Count -eq 0) "$ComposeFile rendered config publishes SQL Server ports"
    $sqlDataMount = @($sql.volumes) | Where-Object { $_.type -eq 'bind' -and $_.target -eq '/var/opt/mssql' }
    Assert-Contract ($sqlDataMount.Count -eq 1) "$ComposeFile rendered config is missing the SQL data bind mount"
    Assert-Contract ([int64]$sql.mem_limit -eq 2415919104) "$ComposeFile rendered SQL container limit is not 2304 MB"
    Assert-Contract ($init.restart -eq 'no') "$ComposeFile rendered init restart policy is not no"
    Assert-Contract (@($app.ports).Count -eq 0) "$ComposeFile rendered config publishes app ports"
    Assert-Contract ((@($app.expose).Count -eq 1) -and ([string]@($app.expose)[0] -eq '5180')) "$ComposeFile rendered app exposure is not exactly 5180"
    Assert-Contract ((@($app.healthcheck.test) -join ' ') -match '/api/health') "$ComposeFile rendered app health check is not DB-aware"
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
Push-Location $root
try {
    foreach ($composeFile in $composeFiles) {
        $composeText = Get-Content -LiteralPath $composeFile -Raw -Encoding utf8
        Assert-StaticComposeContract $composeFile $composeText

        if ($docker) {
            $requiredVariables = [Regex]::Matches($composeText, '\$\{([A-Za-z_][A-Za-z0-9_]*):\?[^}]+\}') |
                ForEach-Object { $_.Groups[1].Value } |
                Sort-Object -Unique
            foreach ($variable in $requiredVariables) {
                Set-Item -Path "Env:$variable" -Value "contract-test-$variable"
            }
            $json = (& $docker.Source compose -f $composeFile config --format json | Out-String)
            Assert-Contract ($LASTEXITCODE -eq 0) "docker compose config failed for $composeFile"
            $config = $json | ConvertFrom-Json
            Assert-RenderedComposeContract $composeFile $config
        }
    }

    $workflow = Get-Content -LiteralPath '.github/workflows/deploy.yml' -Raw -Encoding utf8
    for ($i = 0; $i -lt $requiredSecrets.Count; $i++) {
        $secret = $requiredSecrets[$i]
        $transport = $requiredTransportSecrets[$i]
        Assert-Contract ($workflow -match ('secrets\.' + [Regex]::Escape($secret))) "workflow does not consume GitHub Secret $secret"
        Assert-Contract ($workflow -match ('encode_indo_secret\s+' + [Regex]::Escape($secret) + '\s+' + [Regex]::Escape($transport))) "workflow does not encode $secret into synchronized transport"
    }
    Assert-Contract ($workflow -notmatch 'upsert_env_secret') 'workflow must not overwrite Indonesia dotenv values before safe synchronization'
    Assert-Contract ($workflow -match 'envs: BEFORE_COMMIT,AFTER_COMMIT,INDO_SQL_SA_PASSWORD_B64,INDO_SQL_APP_PASSWORD_B64,INDO_SHIPPING_JWT_KEY_B64,INDO_SHIPPING_ADMIN_PASSWORD_B64') 'SSH action must transport only base64-safe Indonesia values'
    Assert-Contract ($workflow -match 'DEPLOY_RESULT_FILE') 'workflow must provide an explicit deploy result file to update-server.sh'
    Assert-Contract ($workflow -match 'TARGETED_INDONESIA') 'workflow must consume the explicit Indonesia-targeted result'
    Assert-Contract ($workflow -match 'if \[ "\$PEISE_ENV_CHANGED" = "1" \] && \[ "\$INDO_TARGETED_DEPLOY" != "1" \]') 'workflow must suppress unrelated peise recreation after an Indonesia-targeted deploy'
    Assert-Contract ($workflow -match 'if \[ "\$QC_ENV_CHANGED" = "1" \] && \[ "\$INDO_TARGETED_DEPLOY" != "1" \]') 'workflow must suppress unrelated qc recreation after an Indonesia-targeted deploy'
    Assert-Contract ($workflow -match '::add-mask::') 'workflow must mask Indonesia secret diagnostics'
    Assert-Contract ($workflow -match 'git show "\$\{AFTER_COMMIT\}:deploy/update-server\.sh"') 'workflow must load the new deploy script before the server checkout is updated'
    Assert-Contract ($workflow -match 'bash "\$DEPLOY_SCRIPT_RUNNER"') 'workflow must execute the new deploy script instead of the stale checked-out inode'
    Assert-Contract ($workflow -match 'uses: appleboy/ssh-action@[0-9a-f]{40}\s+# v1') 'SSH action must be pinned to an immutable commit SHA'

    $envExample = Get-Content -LiteralPath '.env.example' -Raw -Encoding utf8
    foreach ($secret in $requiredTransportSecrets) {
        Assert-Contract ($envExample -match ('(?m)^' + [Regex]::Escape($secret) + '=$')) ".env.example must declare $secret without a committed value"
    }

    $department = -join @(0x5370, 0x5C3C, 0x5C0F, 0x7EC4 | ForEach-Object { [char]$_ })
    $appName = -join @(0x5370, 0x5C3C, 0x8D70, 0x8D27, 0x660E, 0x7EC6 | ForEach-Object { [char]$_ })
    $dockerfilePath = Join-Path (Join-Path (Join-Path 'apps' $department) $appName) 'Dockerfile'
    $dockerfile = Get-Content -LiteralPath $dockerfilePath -Raw -Encoding utf8
    Assert-Contract ($dockerfile -match '(?m)^FROM mcr\.microsoft\.com/dotnet/runtime:8\.0 AS bootstrap$') 'Dockerfile must provide a runnable bootstrap target'
    Assert-Contract ($dockerfile -match 'ENTRYPOINT \["dotnet", "IndoShipping\.Bootstrap\.dll"\]') 'bootstrap target must run IndoShipping.Bootstrap.dll'
    Assert-Contract ($dockerfile -notmatch '(?m)^COPY (?:db|seed)/') 'Dockerfile must not COPY bootstrap assets excluded by .dockerignore'
    Assert-Contract ($dockerfile -notmatch 'touch .*business-data\.json') 'Dockerfile must not manufacture or embed a production seed file'
    $bootstrapProject = Get-Content -LiteralPath (Join-Path (Split-Path $dockerfilePath) 'src\IndoShipping.Bootstrap\IndoShipping.Bootstrap.csproj') -Raw -Encoding utf8
    Assert-Contract ($bootstrapProject -notmatch 'seed\\business-data\.json') 'bootstrap project must not package the private seed into its image'
    $dockerignorePath = Join-Path (Split-Path $dockerfilePath) '.dockerignore'
    $dockerignore = Get-Content -LiteralPath $dockerignorePath -Raw -Encoding utf8
    Assert-Contract ($dockerignore -match '(?m)^!web/public/template-customs\.xlsx$') 'Docker context must include the sanitized customs template'
    $vendorTarball = Join-Path (Split-Path $dockerfilePath) 'web\vendor\xlsx-0.20.3.tgz'
    Assert-Contract (Test-Path -LiteralPath $vendorTarball) 'vendored SheetJS package is missing'
    Assert-Contract ((Get-FileHash -LiteralPath $vendorTarball -Algorithm SHA256).Hash -eq '8DC73FC3B00203E72D176E85B50938627C7B086E607C682E8D3C22C02BB99FE8') 'vendored SheetJS package checksum changed'
    $vendorCopyIndex = $dockerfile.IndexOf('COPY web/vendor ./vendor', [StringComparison]::Ordinal)
    $npmCiIndex = $dockerfile.IndexOf('RUN npm ci', [StringComparison]::Ordinal)
    Assert-Contract (($vendorCopyIndex -ge 0) -and ($vendorCopyIndex -lt $npmCiIndex)) 'Dockerfile must copy vendored packages before npm ci'

    $apiSecretsPath = Join-Path (Split-Path $dockerfilePath) 'src\IndoShipping.Api\DeploymentSecrets.cs'
    $apiSecrets = Get-Content -LiteralPath $apiSecretsPath -Raw -Encoding utf8
    Assert-Contract ($apiSecrets -match 'UserID = "indoshipping_app"') 'runtime connection builder must use indoshipping_app'
    Assert-Contract ($apiSecrets -notmatch 'UserID = "sa"') 'runtime connection builder must never use sa'

    $deploy = Get-Content -LiteralPath 'deploy/update-server.sh' -Raw -Encoding utf8
    $pathMapping = '["apps/' + $department + '/' + $appName + '/"]="indo-shipping"'
    Assert-Contract ($deploy.Contains($pathMapping)) 'deploy path mapping for indo-shipping is missing'
    Assert-Contract ($deploy -match 'MIN_INDO_AVAILABLE_MEMORY_MB=2500') 'deploy memory preflight must require 2500 MB'
    Assert-Contract ($deploy -match 'MIN_INDO_FREE_DISK_MB=10240') 'deploy disk preflight must require 10 GB'
    Assert-Contract ($deploy -match 'mkdir -p data/indo-sqlserver backups/indo-sqlserver') 'deploy must create SQL data and backup directories'
    Assert-Contract ($deploy -match 'require_indo_seed_file data/indo-shipping-seed/business-data\.json') 'deploy must require the private seed before touching containers'
    Assert-Contract ($deploy -match 'chown 10001:0 data/indo-sqlserver backups/indo-sqlserver') 'deploy must chown SQL directories to 10001:0'
    Assert-Contract ($deploy -match 'chmod 770 data/indo-sqlserver backups/indo-sqlserver') 'deploy must chmod SQL directories to 770'
    Assert-Contract ($deploy -match 'up -d --no-deps indo-sqlserver') 'deploy must start only indo-sqlserver with --no-deps'
    Assert-Contract ($deploy -match 'wait_for_healthy indo-sqlserver 180') 'deploy must wait up to 180 seconds for SQL health'
    Assert-Contract ($deploy -match 'run --rm --no-deps indo-shipping-init') 'deploy must run the init job once with --no-deps'
    Assert-Contract ($deploy -match 'up -d --build --no-deps indo-shipping') 'deploy must build/start only indo-shipping with --no-deps'
    Assert-Contract ($deploy -match '(?s)if \[\[ "\$INDO_SHIPPING_AFFECTED" -eq 1 \]\]; then.*?elif \[\[ "\$COMPOSE_CHANGED" -eq 1 \]\]; then') 'indo-shipping must bypass the generic unscoped Compose branch'
    Assert-Contract ($deploy -match 'indo_compose_services_changed') 'deploy must detect compose-only changes to Indonesia service blocks'
    Assert-Contract ($deploy -notmatch 'indo_compose_services_changed\s+<\(') 'deploy must not reuse a consumed process-substitution stream across service-block comparisons'
    Assert-Contract ($deploy -match 'indo_secret_transport_changed') 'deploy must treat Indonesia secret changes as targeted deployment changes'
    Assert-Contract ($deploy -match 'sync_indo_secret_transport') 'deploy must synchronize runtime secret state before persisting new values'
    $targetedBranch = [Regex]::Match(
        $deploy,
        '(?s)echo "\[6/6\] Deploying\.\.\."\s+if \[\[ "\$INDO_SHIPPING_AFFECTED" -eq 1 \]\]; then(?<body>.*?)elif \[\[ "\$COMPOSE_CHANGED" -eq 1 \]\]; then'
    )
    Assert-Contract $targetedBranch.Success 'deploy targeted branch could not be isolated from generic Compose branch'
    $targetedBody = $targetedBranch.Groups['body'].Value
    Assert-Contract ($targetedBody -match 'deploy_non_indonesia_affected_services') 'targeted Indonesia deploy must also rebuild other source-affected services'
    Assert-Contract ($deploy -match 'INDO_NON_TARGET_COMPOSE_CHANGED') 'targeted Indonesia deploy must detect mixed non-Indonesia Compose changes'
    Assert-Contract ($deploy -match 'refusing a mixed Compose deployment') 'mixed Compose changes must fail explicitly instead of being silently skipped'
    $appStartIndex = $targetedBody.IndexOf('up -d --build --no-deps indo-shipping', [StringComparison]::Ordinal)
    $persistIndex = $targetedBody.IndexOf('persist_indo_secret_transport "$ENV_FILE"', [StringComparison]::Ordinal)
    Assert-Contract (($appStartIndex -ge 0) -and ($persistIndex -gt $appStartIndex)) 'non-SA secret transports must be persisted only after init and app startup succeed'
    $composeCallsWithoutEnv = @($deploy -split "`r?`n" | Where-Object {
        $_ -match 'docker compose -f "\$COMPOSE_FILE"' -and $_ -notmatch '--env-file "\$ENV_FILE"'
    })
    Assert-Contract ($composeCallsWithoutEnv.Count -eq 0) 'every deploy Compose call must load the production env file required by secret interpolation'

    $bashCommand = Get-Command bash -ErrorAction SilentlyContinue
    $bashPath = if ($bashCommand) { $bashCommand.Source } else { $null }
    if (-not $bashPath) {
        $gitBash = Join-Path $env:ProgramFiles 'Git\usr\bin\bash.exe'
        if (Test-Path -LiteralPath $gitBash) {
            $bashPath = $gitBash
        }
    }
    if ($bashPath) {
        & $bashPath --noprofile --norc -c 'export PATH=/usr/bin:/bin; exec bash scripts/tests/test-indo-shipping-deploy.sh'
        Assert-Contract ($LASTEXITCODE -eq 0) 'Indonesia deploy shell contract failed'
    }

    if ($docker) {
        Write-Host 'Indonesia shipping Compose contract OK (docker compose config + static assertions)'
    }
    else {
        Write-Host 'Indonesia shipping Compose contract OK (static fallback; docker compose config deferred to Task 6)'
    }
}
finally {
    Pop-Location
}
