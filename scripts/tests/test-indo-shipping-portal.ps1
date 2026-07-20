$ErrorActionPreference = 'Stop'

$root = Resolve-Path "$PSScriptRoot/../.."
Set-Location $root

function Assert-Contract {
    param(
        [Parameter(Mandatory)] [bool] $Condition,
        [Parameter(Mandatory)] [string] $Message
    )

    if (-not $Condition) {
        throw "Contract failed: $Message"
    }
}

function Get-LocationBlock {
    param(
        [Parameter(Mandatory)] [string] $Text,
        [Parameter(Mandatory)] [string] $Location
    )

    $escaped = [regex]::Escape($Location)
    $match = [regex]::Match($Text, "(?ms)location\s+$escaped\s*\{(?<body>.*?)^\s*\}")
    Assert-Contract $match.Success "nginx location '$Location' is missing"
    return $match.Value
}

$portal = Get-Content -LiteralPath 'frontend/index.cloud.html' -Raw -Encoding utf8
$nginx = Get-Content -LiteralPath 'nginx/nginx.cloud.conf' -Raw -Encoding utf8
$workflow = Get-Content -LiteralPath '.github/workflows/deploy.yml' -Raw -Encoding utf8
$backup = Get-Content -LiteralPath 'devops/scripts/backup-db.sh' -Raw -Encoding utf8

$department = -join @(0x5370, 0x5C3C, 0x5C0F, 0x7EC4 | ForEach-Object { [char]$_ })
$appName = -join @(0x5370, 0x5C3C, 0x8D70, 0x8D27, 0x660E, 0x7EC6 | ForEach-Object { [char]$_ })

Assert-Contract ($portal -match [regex]::Escape($department)) 'portal must add an 印尼小组 department'
Assert-Contract ($portal -match [regex]::Escape($appName)) 'portal must name the application 印尼走货明细'
Assert-Contract ($portal -match 'indoShippingDot') 'portal is missing indoShippingDot'
Assert-Contract ($portal -match 'indoShippingDetailDot') 'portal is missing indoShippingDetailDot'
Assert-Contract ($portal -match 'showDept\(''indonesia''\)') 'portal must open a separate Indonesia department view'
Assert-Contract ($portal -match 'id="indonesiaDetail"') 'portal is missing the Indonesia detail view'
Assert-Contract ($portal -match 'href="/indo-shipping/"') 'portal app card must link to /indo-shipping/'
Assert-Contract ($portal -match "name:\s*'indoShipping',\s*url:\s*'/indo-shipping/health',\s*dot:\s*'indoShippingDot',\s*detailDot:\s*'indoShippingDetailDot'") 'portal health check is missing or incomplete'
foreach ($feature in @(
    (-join @(0x8D70, 0x8D27 | ForEach-Object { [char]$_ })),
    (-join @(0x91C7, 0x8D2D | ForEach-Object { [char]$_ })),
    (-join @(0x6392, 0x671F | ForEach-Object { [char]$_ })),
    (-join @(0x62A5, 0x5173 | ForEach-Object { [char]$_ }))
)) {
    Assert-Contract ($portal -match $feature) "Indonesia detail card must describe $feature work"
}

Assert-Contract ($nginx -match 'location\s*=\s*/indo-shipping\s*\{\s*return\s+301\s+/indo-shipping/;\s*\}') 'nginx must redirect /indo-shipping to its trailing-slash URL'
$health = Get-LocationBlock $nginx '= /indo-shipping/health'
Assert-Contract ($health -match 'auth_basic\s+off;') 'Indonesia health endpoint must bypass portal basic auth'
Assert-Contract ($health -match 'set\s+\$ups\s+"indo-shipping:5180";') 'Indonesia health endpoint must use dynamic indo-shipping upstream'
Assert-Contract ($health -match 'proxy_pass\s+http://\$ups/api/health;') 'Indonesia health endpoint must call DB-aware /api/health'
foreach ($header in @('Host \$host', 'X-Real-IP \$remote_addr', 'X-Forwarded-For \$proxy_add_x_forwarded_for', 'X-Forwarded-Proto \$scheme')) {
    Assert-Contract ($health -match ('proxy_set_header\s+' + $header + ';')) "Indonesia health endpoint must preserve proxy header $header"
}

$app = Get-LocationBlock $nginx '/indo-shipping/'
Assert-Contract ($app -match 'auth_basic\s+off;') 'Indonesia app route must bypass portal basic auth'
Assert-Contract ($app -match 'set\s+\$ups\s+"indo-shipping:5180";') 'Indonesia app route must use dynamic indo-shipping upstream'
Assert-Contract ($app -match 'rewrite\s+\^/indo-shipping/\(\.\*\)\$\s+/\$1\s+break;') 'Indonesia app route must strip /indo-shipping/ before proxying'
Assert-Contract ($app -match 'proxy_pass\s+http://\$ups;') 'Indonesia app route must proxy to the dynamic upstream'
Assert-Contract ($app -match 'proxy_set_header\s+X-Forwarded-Prefix\s+/indo-shipping;') 'Indonesia app route must preserve X-Forwarded-Prefix'
foreach ($header in @('Host \$host', 'X-Real-IP \$remote_addr', 'X-Forwarded-For \$proxy_add_x_forwarded_for', 'X-Forwarded-Proto \$scheme')) {
    Assert-Contract ($app -match ('proxy_set_header\s+' + $header + ';')) "Indonesia app route must preserve proxy header $header"
}

Assert-Contract ($workflow -match '/indo-shipping/health') 'GitHub Actions must smoke-test /indo-shipping/health'

Assert-Contract ($backup -match 'indo-sqlserver') 'backup script must detect the indo-sqlserver container'
Assert-Contract ($backup -match 'INDO_SQL_SA_PASSWORD_B64') 'backup script must use the persisted base64 SA transport'
Assert-Contract ($backup -match 'base64\s+--decode') 'backup script must decode the SA transport only at use time'
Assert-Contract ($backup -match 'SQLCMDPASSWORD') 'backup script must pass the decoded credential without a sqlcmd -P argument'
Assert-Contract ($backup -match '(?s)set -o pipefail.*pg_dumpall') 'PostgreSQL backup must enable remote pipefail before pg_dumpall'
Assert-Contract ($backup -match 'BACKUP\s+DATABASE\s+\[?IndoShipping\]?') 'backup script must back up the IndoShipping database'
Assert-Contract ($backup -match 'WITH\s+INIT,\s*CHECKSUM') 'SQL backup must use INIT and CHECKSUM'
Assert-Contract ($backup -match 'RESTORE\s+VERIFYONLY') 'SQL backup must run RESTORE VERIFYONLY'
Assert-Contract ($backup -match '/var/opt/mssql/backup') 'SQL backup must use the SQL Server bind-mounted backup directory'
Assert-Contract ($backup -match 'indo-shipping-\$\{TIMESTAMP\}\.bak') 'SQL backup must have timestamped .bak filenames'
Assert-Contract ($backup -match 'tail\s+-n\s+\+8') 'SQL backup retention must keep the seven newest verified files'
Assert-Contract ($backup -match 'WARNING:.*indo-sqlserver') 'backup script must warn and continue when SQL Server is absent'
Assert-Contract ($backup -notmatch '(?im)^(?!\s*#).*\b(?:echo|log)\b.*\$\{?(?:password|sa_password)\}?') 'backup script must not log raw or decoded SQL passwords'
Assert-Contract ($backup -match '(?s)pg_dump failed.*?exit 1') 'PostgreSQL backup failure must return nonzero'
Assert-Contract ($backup -match '(?s)suspiciously small.*?exit 1') 'suspicious PostgreSQL backup must return nonzero'
Assert-Contract ($backup -match '(?s)SQL backup or RESTORE VERIFYONLY failed.*?exit 1') 'SQL backup or verification failure must return nonzero'
$verifyIndex = $backup.IndexOf('RESTORE VERIFYONLY', [StringComparison]::Ordinal)
$successIndex = $backup.IndexOf('SQL_OK:', [StringComparison]::Ordinal)
Assert-Contract (($verifyIndex -ge 0) -and ($successIndex -gt $verifyIndex)) 'SQL backup success must be reported only after VERIFYONLY'

Write-Host 'Indonesia portal, nginx, workflow, and SQL backup contract OK'
