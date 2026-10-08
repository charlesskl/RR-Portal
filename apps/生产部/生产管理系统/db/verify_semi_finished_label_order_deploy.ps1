param(
    [string]$MigrationPath = (Join-Path $PSScriptRoot 'migrate_semi_finished_label_orders.sql'),
    [string]$SeedPath = (Join-Path $PSScriptRoot 'seed_semi_finished_label_order_perms.sql'),
    [string]$ConnectionString = $env:ERP_TEST_DB,
    [switch]$Live
)

$ErrorActionPreference = 'Stop'

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw "FAIL: $Message"
    }
}

$migration = Get-Content -Raw -Encoding utf8 $MigrationPath
$seed = Get-Content -Raw -Encoding utf8 $SeedPath
$verifier = Get-Content -Raw -Encoding utf8 $PSCommandPath

$migrationTry = $migration.IndexOf('BEGIN TRY', [StringComparison]::OrdinalIgnoreCase)
$migrationBegin = $migration.IndexOf('BEGIN TRANSACTION', [StringComparison]::OrdinalIgnoreCase)
$migrationLock = $migration.IndexOf('sys.sp_getapplock', [StringComparison]::OrdinalIgnoreCase)
$migrationFirstCheck = $migration.IndexOf('IF OBJECT_ID', [StringComparison]::OrdinalIgnoreCase)
$migrationCommit = $migration.LastIndexOf('COMMIT TRANSACTION', [StringComparison]::OrdinalIgnoreCase)
$migrationCatch = $migration.IndexOf('BEGIN CATCH', [StringComparison]::OrdinalIgnoreCase)

Assert-True ($migrationTry -ge 0 -and $migrationTry -lt $migrationBegin) 'migration must enter TRY before opening its transaction'
Assert-True ($migrationBegin -ge 0 -and $migrationBegin -lt $migrationLock) 'migration must acquire the application lock inside a transaction'
Assert-True ($migrationLock -ge 0 -and $migrationLock -lt $migrationFirstCheck) 'migration lock must cover every check-then-create operation'
Assert-True ($migration -match "(?is)@LockMode\s*=\s*N'Exclusive'.*?@LockOwner\s*=\s*N'Transaction'") 'migration must use an exclusive transaction-owned application lock'
Assert-True ($migrationCommit -ge 0 -and $migrationCommit -lt $migrationCatch) 'migration must commit only on the TRY success path'
Assert-True ($migration -match '(?is)BEGIN\s+CATCH.*?IF\s+(?:XACT_STATE\(\)|@@TRANCOUNT)\s*(?:<>|>)\s*0.*?ROLLBACK\s+TRANSACTION.*?THROW') 'migration CATCH must roll back an active transaction and rethrow'
Assert-True ($migration -match '(?i)sys\.columns') 'migration must validate every required column against sys.columns'
Assert-True ($migration -match '(?i)sys\.types') 'migration must validate column SQL types against sys.types'
Assert-True ($migration -match '(?i)sys\.default_constraints') 'migration must validate required default constraints'
Assert-True ($migration -match '(?i)sys\.(?:key_constraints|indexes)') 'migration must validate primary and unique keys'
Assert-True ($migration -match '(?i)sys\.foreign_keys') 'migration must validate the detail-to-header foreign key'
Assert-True ($migration -match '(?i)sys\.check_constraints') 'migration must validate every required check constraint'
Assert-True ($migration -match '(?i)sys\.index_columns') 'migration must validate required index key columns and order'

Assert-True ($verifier -match '(?i)\[Guid\]::NewGuid\(\)') 'live verifier must use a GUID in the temporary database name'
Assert-True ($verifier -notmatch '(?m)^\s*\$databaseName\s*=.*\$PID') 'live verifier must not derive the temporary database name from PID'
Assert-True ($verifier -match '(?is)DB_ID\s*\(.*?IS\s+NOT\s+NULL.*?(?:THROW|throw)') 'live verifier must explicitly reject an existing temporary database before creation'
Assert-True ($verifier -match '(?i)(?:sp_addextendedproperty|sys\.extended_properties)') 'live verifier must write an ownership marker into the temporary database'
Assert-True ($verifier -match '(?is)finally.*?sys\.extended_properties.*?DROP\s+DATABASE') 'live verifier cleanup must verify the ownership marker before dropping the database'
Assert-True ($verifier -match '(?is)dotnet\s+restore.*?dotnet\s+build') 'live verifier must restore before building so clean checkouts work'

$seedCteStart = $seed.IndexOf(';WITH')
$seedFirstUnion = $seed.IndexOf('UNION ALL', $seedCteStart)
Assert-True ($seedCteStart -ge 0 -and $seedFirstUnion -gt $seedCteStart) 'seed permission-subject source CTE must be present'
$sysfileuserBranch = $seed.Substring($seedCteStart, $seedFirstUnion - $seedCteStart)

Assert-True ($seed -notmatch '(?i)LEFT\s*\(') 'seed must never truncate a source account before authorization'
Assert-True ($sysfileuserBranch -match '(?is)FROM\s+\[sysfileuser\].*?DATALENGTH\s*\([^)]*\)\s*<=\s*60') 'seed must exclude sysfileuser accounts that cannot fit nvarchar(30) before UNION type coercion'
Assert-True ($seed -match '(?is)PRINT\s+CONCAT\s*\(.*?nvarchar\(30\)') 'seed must make its conservative skipped-account policy visible in deployment output'

Write-Output 'PASS: migration lock and rollback contract verified.'
Write-Output 'PASS: seed long-account no-truncation policy verified.'

if (-not $Live) {
    return
}
if ([string]::IsNullOrWhiteSpace($ConnectionString)) {
    throw 'FAIL: -Live requires -ConnectionString or ERP_TEST_DB.'
}

$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'tools/DbDeploy/DbDeploy.csproj'
$deployDll = Join-Path $root 'tools/DbDeploy/bin/Release/net8.0/DbDeploy.dll'
$setupPath = Join-Path $PSScriptRoot 'verify_semi_finished_label_order_deploy_setup.sql'
$malformedSetupPath = Join-Path $PSScriptRoot 'verify_semi_finished_label_order_deploy_malformed_setup.sql'
$malformedAssertPath = Join-Path $PSScriptRoot 'verify_semi_finished_label_order_deploy_malformed_assert.sql'
$rollbackSetupPath = Join-Path $PSScriptRoot 'verify_semi_finished_label_order_deploy_rollback_setup.sql'
$assertPath = Join-Path $PSScriptRoot 'verify_semi_finished_label_order_deploy_assert.sql'
$successAssertPath = Join-Path $PSScriptRoot 'verify_semi_finished_label_order_deploy_success_assert.sql'
$runId = [Guid]::NewGuid().ToString('N')
$databaseName = 'WebpageERP_LabelDeployVerify_' + $runId
$ownershipMarkerName = 'WebpageERP.LabelDeployVerify.Owner'
$ownershipMarkerValue = $runId

$normalizedConnectionString = [regex]::Replace(
    $ConnectionString,
    '(?i)(^|;)\s*InitialCatalog\s*=',
    '$1Initial Catalog='
)
$builder = New-Object System.Data.SqlClient.SqlConnectionStringBuilder($normalizedConnectionString)
$builder['Initial Catalog'] = $databaseName
$temporaryConnectionString = $builder.ConnectionString
$databaseCreated = $false

function Invoke-Deploy {
    param([string[]]$Scripts)

    & dotnet $deployDll $temporaryConnectionString @Scripts
    if ($LASTEXITCODE -ne 0) {
        throw "FAIL: DbDeploy exited $LASTEXITCODE for $($Scripts -join ', ')."
    }
}

function Invoke-DeployExpectFailure {
    param(
        [string]$Script,
        [string]$Scenario
    )

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & dotnet $deployDll $temporaryConnectionString $Script 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($exitCode -eq 0) {
        throw "FAIL: $Scenario unexpectedly succeeded."
    }

    Write-Verbose ($output -join [Environment]::NewLine)
}

function Invoke-ConcurrentDeploy {
    param(
        [string]$Script,
        [string]$Scenario
    )

    $jobs = @()
    try {
        $jobs = 1..2 | ForEach-Object {
            Start-Job -ScriptBlock {
                param($Dll, $Cs, $SqlScript)
                & dotnet $Dll $Cs $SqlScript
                if ($LASTEXITCODE -ne 0) {
                    throw "concurrent DbDeploy exited $LASTEXITCODE"
                }
            } -ArgumentList $deployDll, $temporaryConnectionString, $Script
        }

        $jobs | Wait-Job | Out-Null
        $jobOutput = $jobs | Receive-Job -ErrorAction SilentlyContinue
        $failedJobs = @($jobs | Where-Object State -ne 'Completed')
        if ($failedJobs.Count -ne 0) {
            throw "FAIL: $Scenario had $($failedJobs.Count) failed process(es).`n$($jobOutput -join [Environment]::NewLine)"
        }
    }
    finally {
        if ($jobs.Count -gt 0) {
            $jobs | Remove-Job -Force
        }
    }
}

try {
    & dotnet restore $project --nologo
    if ($LASTEXITCODE -ne 0) {
        throw "FAIL: DbDeploy restore exited $LASTEXITCODE."
    }

    & dotnet build $project -c Release --nologo --no-restore
    if ($LASTEXITCODE -ne 0) {
        throw "FAIL: DbDeploy build exited $LASTEXITCODE."
    }

    $builder['Initial Catalog'] = 'master'
    $masterConnection = New-Object System.Data.SqlClient.SqlConnection($builder.ConnectionString)
    try {
        $masterConnection.Open()
        $existsCommand = $masterConnection.CreateCommand()
        $existsCommand.CommandText = 'SELECT DB_ID(@databaseName);'
        [void]$existsCommand.Parameters.AddWithValue('@databaseName', $databaseName)
        $existingDatabaseId = $existsCommand.ExecuteScalar()
        if ($existingDatabaseId -ne [DBNull]::Value) {
            throw "FAIL: temporary database [$databaseName] already exists before creation."
        }

        $createCommand = $masterConnection.CreateCommand()
        $createCommand.CommandText = "IF DB_ID(@databaseName) IS NOT NULL THROW 51140, N'Temporary verification database already exists', 1; DECLARE @sql nvarchar(max) = N'CREATE DATABASE ' + QUOTENAME(@databaseName) + N' COLLATE Chinese_PRC_CI_AS'; EXEC(@sql);"
        [void]$createCommand.Parameters.AddWithValue('@databaseName', $databaseName)
        [void]$createCommand.ExecuteNonQuery()
        $databaseCreated = $true
    }
    finally {
        $masterConnection.Dispose()
    }

    $builder['Initial Catalog'] = $databaseName
    $markerConnection = New-Object System.Data.SqlClient.SqlConnection($builder.ConnectionString)
    try {
        $markerConnection.Open()
        $markerCommand = $markerConnection.CreateCommand()
        $markerCommand.CommandText = 'EXEC sys.sp_addextendedproperty @name = @markerName, @value = @markerValue;'
        [void]$markerCommand.Parameters.AddWithValue('@markerName', $ownershipMarkerName)
        [void]$markerCommand.Parameters.AddWithValue('@markerValue', $ownershipMarkerValue)
        [void]$markerCommand.ExecuteNonQuery()
    }
    finally {
        $markerConnection.Dispose()
    }

    Invoke-Deploy @($setupPath)
    Invoke-Deploy @($MigrationPath)
    Invoke-Deploy @($malformedSetupPath)
    Invoke-DeployExpectFailure -Script $MigrationPath -Scenario 'migration against a malformed existing column'
    Invoke-Deploy @($malformedAssertPath)
    Write-Output 'PASS: malformed existing table was rejected without mutation.'

    Invoke-Deploy @($setupPath)
    Invoke-Deploy @($MigrationPath)
    Invoke-Deploy @($rollbackSetupPath)
    Invoke-DeployExpectFailure -Script $MigrationPath -Scenario 'late index-contract failure'
    Invoke-Deploy @($assertPath)
    Write-Output 'PASS: late migration failure rolled back all preceding DDL.'

    Invoke-Deploy @($setupPath)
    Invoke-ConcurrentDeploy -Script $MigrationPath -Scenario 'concurrent migration verification'
    Write-Output 'PASS: two concurrent migration executions completed.'

    Invoke-Deploy @($MigrationPath)
    Write-Output 'PASS: migration repeat execution completed.'

    Invoke-ConcurrentDeploy -Script $SeedPath -Scenario 'concurrent permission seed verification'
    Invoke-Deploy @($SeedPath)
    Invoke-Deploy @($successAssertPath)
    Write-Output 'PASS: concurrent/repeated seed and complete schema contract assertions completed.'
}
finally {
    if ($databaseCreated) {
        $builder['Initial Catalog'] = $databaseName
        $ownershipConnection = New-Object System.Data.SqlClient.SqlConnection($builder.ConnectionString)
        try {
            $ownershipConnection.Open()
            $ownershipCommand = $ownershipConnection.CreateCommand()
            $ownershipCommand.CommandText = 'SELECT CONVERT(nvarchar(128), [value]) FROM sys.extended_properties WHERE [class] = 0 AND [major_id] = 0 AND [minor_id] = 0 AND [name] = @markerName;'
            [void]$ownershipCommand.Parameters.AddWithValue('@markerName', $ownershipMarkerName)
            $actualMarker = $ownershipCommand.ExecuteScalar()
        }
        finally {
            $ownershipConnection.Dispose()
        }

        if ($actualMarker -ne $ownershipMarkerValue) {
            throw "FAIL: refusing to drop [$databaseName] because its ownership marker does not match this run."
        }

        $builder['Initial Catalog'] = 'master'
        $cleanupConnection = New-Object System.Data.SqlClient.SqlConnection($builder.ConnectionString)
        try {
            $cleanupConnection.Open()
            $cleanupCommand = $cleanupConnection.CreateCommand()
            $cleanupCommand.CommandText = "IF DB_ID(@databaseName) IS NOT NULL BEGIN DECLARE @sql nvarchar(max) = N'ALTER DATABASE ' + QUOTENAME(@databaseName) + N' SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ' + QUOTENAME(@databaseName) + N';'; EXEC(@sql); END"
            [void]$cleanupCommand.Parameters.AddWithValue('@databaseName', $databaseName)
            [void]$cleanupCommand.ExecuteNonQuery()
        }
        finally {
            $cleanupConnection.Dispose()
        }
    }
}
