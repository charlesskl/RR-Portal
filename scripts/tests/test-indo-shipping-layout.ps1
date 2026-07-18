$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot/../.."
$newPath = Join-Path $root 'apps/印尼小组/印尼走货明细'
$oldPath = Join-Path $root 'apps/业务部/印尼走货明细'
if (-not (Test-Path (Join-Path $newPath 'IndoShipping.sln'))) { throw 'new Indonesia app path missing' }
if (Test-Path $oldPath) { throw 'old Business department path still exists' }
$privateArtifacts = @(
    'seed/business-data.json',
    '报价单导入模板(3)(2)(3).xlsx',
    'web/public/legacy.html',
    'web/public/vendor/xlsx.bundle.js',
    'web/public/vendor/jszip.min.js'
)
foreach ($relativePath in $privateArtifacts) {
    if (Test-Path (Join-Path $newPath $relativePath)) {
        throw "private or obsolete artifact must not be committed: $relativePath"
    }
}
if (-not (Test-Path (Join-Path $newPath 'seed/example-data.json'))) {
    throw 'sanitized seed fixture missing'
}
$moldingExport = Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $newPath 'web/src/utils/moldingPoExport.ts')
if ($moldingExport -match '(?<!\d)1[3-9]\d{9}(?!\d)') {
    throw 'molding PO export must not hard-code a personal mobile number'
}
if ($moldingExport -notmatch 'mpo\.vendorContact' -or $moldingExport -notmatch 'mpo\.buyerContact') {
    throw 'molding PO export contacts must come from the private order data'
}
Write-Host 'Indonesia app layout OK'
