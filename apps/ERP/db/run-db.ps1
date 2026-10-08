# run-db.ps1 — 全新建库/迁移：自动枚举 db/ 下脚本，交给 tools/DbDeploy 逐脚本执行、出错即止。
#
# 枚举规则（新增脚本无需改本文件）：
#   1) 编号迁移：db/ 下所有数字前缀开头的 NN_*.sql，按数字升序；
#      同号时无字母后缀的在前、带字母后缀的变体在后（如 10_production_notice.sql 先于 10b_p5_material_cost.sql）。
#      明确排除文件名含 demo 的脚本（60_demo_virtual_data.sql / 61_demo_verify.sql / 79_seed_raw_material_demo.sql：
#      演示数据已清理，新部署不带入）。
#      特例：01_rebuild_schema.sql / 02_rebuild_relations.sql 以 lenient: 前缀执行
#      （逐语句、失败跳过——02 为按名推断外键，主数据未必匹配）；其余脚本均严格模式，出错即止。
#   2) 权限种子：所有 seed_*_perms.sql，按文件名字母序（只写 userbqrpower，互相无依赖）。
#   3) 最后执行 seed_92125_zuru_engineering.sql（92125 ZURU 工程放产资料）。
#   非编号的 migrate_*.sql 不再单独引用（建表职责已由编号脚本自包含，见 43_assembly_rules.sql）。
#
# 用法：./db/run-db.ps1 [-ConnectionString <连接串>]   （缺省取环境变量 ERP_DB）
param([string]$ConnectionString = $env:ERP_DB)
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ConnectionString)) { throw "未提供连接串(参数 -ConnectionString 或环境变量 ERP_DB)" }
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $dir

# 1) 编号迁移：数字前缀升序，同号无后缀在前、字母后缀变体在后
$migrations = Get-ChildItem -Path $dir -Filter '*.sql' |
    Where-Object { $_.Name -match '^\d+[A-Za-z]*_' -and $_.Name -notmatch 'demo' } |
    Sort-Object @{
        Expression = { [int]($_.Name -replace '^(\d+).*', '$1') }
    }, @{
        Expression = { if ($_.Name -match '^\d+([A-Za-z]*)_') { $Matches[1] } else { '' } }
    }

$specs = New-Object System.Collections.Generic.List[string]
foreach ($f in $migrations) {
    $p = $f.FullName
    if ($f.Name -eq '01_rebuild_schema.sql' -or $f.Name -eq '02_rebuild_relations.sql') { $p = 'lenient:' + $p }
    $specs.Add($p)
}

# 2) 权限种子（文件名字母序）
Get-ChildItem -Path $dir -Filter 'seed_*_perms.sql' | Sort-Object Name |
    ForEach-Object { $specs.Add($_.FullName) }

# 3) ZURU 工程放产资料
$zuru = Join-Path $dir 'seed_92125_zuru_engineering.sql'
if (Test-Path $zuru) { $specs.Add($zuru) }

Write-Host "共 $($specs.Count) 个脚本（编号迁移 $($migrations.Count) + 权限种子 + ZURU 工程资料）"
dotnet run --project (Join-Path $root "tools\DbDeploy") -- $ConnectionString $specs.ToArray()
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
