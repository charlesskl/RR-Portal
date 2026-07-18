# 重置 admin 密码(种子的占位 hash 不一定可用,跑这个生成新 hash 并写回)
# 用法: .\reset-admin-password.ps1 -NewPassword "你的新密码"
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$NewPassword,
    [string]$Server = "(localdb)\MSSQLLocalDB"
)

$ErrorActionPreference = "Stop"

# 用项目自带的 .NET 生成 bcrypt hash
$snippet = @"
using BCrypt.Net;
var hash = BCrypt.Net.BCrypt.HashPassword(args[0], workFactor: 11);
Console.Write(hash);
"@

$tmpDir = Join-Path $env:TEMP "indo-bcrypt-$([guid]::NewGuid())"
New-Item -ItemType Directory -Force $tmpDir | Out-Null
try {
    $proj = @"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <RootNamespace>Hasher</RootNamespace>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="BCrypt.Net-Next" Version="4.0.3" />
  </ItemGroup>
</Project>
"@
    Set-Content -Path (Join-Path $tmpDir "Hasher.csproj") -Value $proj -Encoding utf8
    Set-Content -Path (Join-Path $tmpDir "Program.cs") -Value $snippet -Encoding utf8

    Push-Location $tmpDir
    $hash = dotnet run --nologo -c Release -- $NewPassword 2>$null
    Pop-Location

    if (-not $hash) { throw "bcrypt 生成失败" }

    Write-Host "生成的 hash: $hash"

    $sql = "UPDATE dbo.Users SET PasswordHash = N'$hash' WHERE Username = N'admin';"
    & sqlcmd -S $Server -E -d IndoShipping -Q $sql
    if ($LASTEXITCODE -ne 0) { throw "更新失败" }

    Write-Host "✅ admin 密码已更新" -ForegroundColor Green
}
finally {
    Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
}
