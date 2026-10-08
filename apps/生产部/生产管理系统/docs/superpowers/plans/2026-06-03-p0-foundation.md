# P0 地基阶段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立兴信B ERP 重建的地基——建库、4 个横切引擎（单号生成 / 审核过账 / 库存汇总 / 权限审计）、安全登录（bcrypt+JWT，无后门）、以及按 9 位权限控菜单的 React 前端骨架。

**Architecture:** ASP.NET Core Web API 分三层（Controllers → Services → 横切引擎），EF Core 做实体 CRUD、Dapper 做库存/报表大查询。数据库直接用净室 146 表脚本 + 3 张新增优化表。前端 React+TS+Ant Design，登录后按后端返回的 9 位权限矩阵控制菜单/按钮/价格列。

**Tech Stack:** .NET 8, ASP.NET Core, EF Core, Dapper, SQL Server, BCrypt.Net-Next, JWT (Microsoft.AspNetCore.Authentication.JwtBearer), xUnit + Xunit.SkippableFact, React 18 + TypeScript + Vite + Ant Design + Vitest.

---

## 文件结构

```
WebpageERP/
├─ db/
│  ├─ 01_rebuild_schema.sql        (从 D:\re_work\流程 复制)
│  ├─ 02_rebuild_relations.sql     (从 D:\re_work\流程 复制)
│  ├─ 03_p0_additions.sql          (新增3表 + sysfileuser 锁定列)
│  └─ run-db.ps1                   (按序执行三脚本)
├─ src/ErpApi/
│  ├─ ErpApi.csproj
│  ├─ Program.cs                   (DI/JWT/Controllers 装配)
│  ├─ appsettings.json             (无任何密钥)
│  ├─ Infrastructure/
│  │  ├─ Db/ISqlConnectionFactory.cs + SqlConnectionFactory.cs
│  │  └─ Security/IPasswordHasher.cs + BcryptPasswordHasher.cs + IJwtTokenService.cs + JwtTokenService.cs
│  ├─ Engines/
│  │  ├─ DocumentNumber/IDocumentNumberGenerator.cs + DocumentNumberGenerator.cs   (引擎①)
│  │  ├─ Posting/IPostingEngine.cs + PostingEngine.cs + PostableDocuments.cs       (引擎②)
│  │  ├─ Inventory/IInventorySummaryService.cs + InventorySummaryService.cs
│  │  │                + IInventorySnapshotProvider.cs + NullSnapshotProvider.cs   (引擎③)
│  │  └─ Authorization/PermissionFlags.cs + IPermissionService.cs + PermissionService.cs
│  │                + IAuditLogger.cs + AuditLogger.cs + RequirePermissionAttribute.cs (引擎④)
│  └─ Features/Auth/AuthController.cs + AuthService.cs + AuthDtos.cs
├─ tests/ErpApi.Tests/
│  ├─ ErpApi.Tests.csproj
│  ├─ DbFixture.cs                 (读 ERP_TEST_DB 环境变量；无则 Skip)
│  └─ ... 各引擎测试
└─ web/                            (Vite React TS)
   ├─ src/api/client.ts
   ├─ src/auth/PermissionContext.tsx + permissions.ts
   ├─ src/pages/Login.tsx + MainLayout.tsx
   └─ src/__tests__/permissions.test.ts
```

**职责边界**
- `Infrastructure/*`：纯技术能力（连库、哈希、JWT），不含业务。
- `Engines/*`：4 个横切引擎，每个一个文件夹、自带接口，可独立测试与替换（如快照层后期替换 `NullSnapshotProvider`）。
- `Features/*`：业务用例，编排引擎。
- 价格保密、审核控制等规则集中在引擎④，前后端共用同一套 9 位定义。

---

## Task 0: 解决方案与项目骨架

**Files:**
- Create: `WebpageERP.sln`, `src/ErpApi/ErpApi.csproj`, `src/ErpApi/Program.cs`, `src/ErpApi/appsettings.json`, `tests/ErpApi.Tests/ErpApi.Tests.csproj`

- [ ] **Step 1: 创建解决方案与项目**

Run:
```powershell
dotnet new sln -n WebpageERP
dotnet new webapi -n ErpApi -o src/ErpApi --use-controllers
dotnet new xunit -n ErpApi.Tests -o tests/ErpApi.Tests
dotnet sln add src/ErpApi/ErpApi.csproj tests/ErpApi.Tests/ErpApi.Tests.csproj
dotnet add tests/ErpApi.Tests/ErpApi.Tests.csproj reference src/ErpApi/ErpApi.csproj
```

- [ ] **Step 2: 添加依赖包**

Run:
```powershell
dotnet add src/ErpApi package Microsoft.EntityFrameworkCore.SqlServer
dotnet add src/ErpApi package Dapper
dotnet add src/ErpApi package BCrypt.Net-Next
dotnet add src/ErpApi package Microsoft.AspNetCore.Authentication.JwtBearer
dotnet add src/ErpApi package Microsoft.Data.SqlClient
dotnet add tests/ErpApi.Tests package Xunit.SkippableFact
dotnet add tests/ErpApi.Tests package Microsoft.Data.SqlClient
dotnet add tests/ErpApi.Tests package Dapper
```

- [ ] **Step 3: appsettings.json 不含任何密钥**

Create `src/ErpApi/appsettings.json`:
```json
{
  "Logging": { "LogLevel": { "Default": "Information", "Microsoft.AspNetCore": "Warning" } },
  "AllowedHosts": "*",
  "Erp": {
    "ConnectionStringEnvVar": "ERP_DB",
    "Jwt": { "Issuer": "ErpApi", "Audience": "ErpClient", "ExpireMinutes": 480 },
    "Login": { "MaxFailures": 5, "LockMinutes": 15 }
  }
}
```
说明：连接串与 JWT 密钥**绝不写在此文件**，运行时从环境变量 `ERP_DB`、`ERP_JWT_KEY` 读取（安全基线：无硬编码凭据）。

- [ ] **Step 4: 验证编译**

Run: `dotnet build`
Expected: Build succeeded, 0 Error。

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "chore(P0): 解决方案与项目骨架 + 依赖"
```

---

## Task 1: 建库脚本（三步建库）

**Files:**
- Create: `db/01_rebuild_schema.sql`, `db/02_rebuild_relations.sql`, `db/03_p0_additions.sql`, `db/run-db.ps1`

- [ ] **Step 1: 复制净室建表与关系脚本**

Run:
```powershell
New-Item -ItemType Directory -Force db | Out-Null
Copy-Item "D:\re_work\流程\rebuild_schema.sql"    db\01_rebuild_schema.sql
Copy-Item "D:\re_work\流程\rebuild_relations.sql" db\02_rebuild_relations.sql
```

- [ ] **Step 2: 编写 3 张新增表 + 登录锁定列**

Create `db/03_p0_additions.sql`:
```sql
-- P0 新增：库存滚存快照、单号流水、系统配置；并为登录锁定加列、移除明文错密依赖
SET XACT_ABORT ON;

IF OBJECT_ID(N'[结存快照表]') IS NULL
CREATE TABLE [结存快照表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [年月] char(6) NOT NULL,            -- 期末 yyyyMM
    [仓库] nvarchar(20) NOT NULL,
    [款号] nvarchar(30) NOT NULL,
    [款式] nvarchar(40) NULL,
    [色号] nvarchar(20) NULL,
    [颜色] nvarchar(20) NULL,
    [尺码] nvarchar(10) NULL,
    [期初] decimal(18,4) NOT NULL DEFAULT 0,
    [本期入] decimal(18,4) NOT NULL DEFAULT 0,
    [本期出] decimal(18,4) NOT NULL DEFAULT 0,
    [结存] decimal(18,4) NOT NULL DEFAULT 0,
    [生成时间] datetime2(0) NOT NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'UX_结存快照_维度')
CREATE UNIQUE INDEX UX_结存快照_维度 ON [结存快照表]
    ([年月],[仓库],[款号],[色号],[颜色],[尺码]);

IF OBJECT_ID(N'[单号流水表]') IS NULL
CREATE TABLE [单号流水表] (
    [单据类型] nvarchar(20) NOT NULL,
    [业务日期] char(8) NOT NULL,        -- yyyyMMdd
    [当日流水] int NOT NULL,
    CONSTRAINT PK_单号流水 PRIMARY KEY ([单据类型],[业务日期])
);

IF OBJECT_ID(N'[系统配置表]') IS NULL
CREATE TABLE [系统配置表] (
    [键] nvarchar(60) NOT NULL PRIMARY KEY,
    [值] nvarchar(max) NULL,
    [是否加密] bit NOT NULL DEFAULT 0,
    [备注] nvarchar(200) NULL
);

IF COL_LENGTH(N'sysfileuser', N'登录失败次数') IS NULL
    ALTER TABLE [sysfileuser] ADD [登录失败次数] int NOT NULL DEFAULT 0;
IF COL_LENGTH(N'sysfileuser', N'锁定到期') IS NULL
    ALTER TABLE [sysfileuser] ADD [锁定到期] datetime2(0) NULL;
```
说明：原 `错密1~5` 明文列保留在表上但**代码永不写入**；新登录用 `登录失败次数`+`锁定到期`（安全基线：不存明文错误密码）。

- [ ] **Step 3: 编写 .NET 建库执行器 + 包装脚本**

> 说明：本机用 SQL Server LocalDB，go-sqlcmd 对 LocalDB 命名管道解析有 bug，故改用与应用相同的 Microsoft.Data.SqlClient 驱动建库（更一致、零外部依赖）。

Create `tools/DbDeploy/DbDeploy.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Data.SqlClient" Version="7.0.1" />
  </ItemGroup>
</Project>
```

Create `tools/DbDeploy/Program.cs`:
```csharp
using Microsoft.Data.SqlClient;

if (args.Length < 2)
{
    Console.Error.WriteLine("用法: DbDeploy <目标连接串> [<lenient:>脚本.sql ...]");
    Console.Error.WriteLine("  默认严格模式(整文件一批，出错即止)；前缀 lenient: 则逐语句执行、失败跳过并记录。");
    return 1;
}
var targetCs = args[0];
var scriptSpecs = args[1..];

var dbName = new SqlConnectionStringBuilder(targetCs).InitialCatalog;
if (string.IsNullOrWhiteSpace(dbName))
{
    Console.Error.WriteLine("连接串缺少 Database/Initial Catalog");
    return 1;
}

// 1) 连 master，库不存在则建
var masterCs = new SqlConnectionStringBuilder(targetCs) { InitialCatalog = "master" }.ConnectionString;
using (var master = new SqlConnection(masterCs))
{
    master.Open();
    using var cmd = new SqlCommand(
        "DECLARE @sql nvarchar(300) = N'CREATE DATABASE ' + QUOTENAME(@n) + N' COLLATE Chinese_PRC_CI_AS'; IF DB_ID(@n) IS NULL EXEC(@sql);", master);
    cmd.Parameters.AddWithValue("@n", dbName);
    cmd.ExecuteNonQuery();
    Console.WriteLine($"数据库 [{dbName}] 就绪");
}

// 2) 连目标库执行各脚本
int leninentSkipped = 0;
using (var conn = new SqlConnection(targetCs))
{
    conn.Open();
    foreach (var spec in scriptSpecs)
    {
        var lenient = spec.StartsWith("lenient:", StringComparison.OrdinalIgnoreCase);
        var path = lenient ? spec["lenient:".Length..] : spec;
        var text = File.ReadAllText(path);
        Console.WriteLine($"执行 {Path.GetFileName(path)} ({(lenient ? "lenient" : "strict")}) ...");

        if (lenient)
        {
            // 逐语句执行：每条独立 try/catch，失败跳过并记录(用于"推断"外键/索引，主数据未必匹配)
            int ok = 0, fail = 0;
            foreach (var stmt in text.Split(';'))
            {
                if (string.IsNullOrWhiteSpace(stmt)) continue;
                try
                {
                    using var cmd = new SqlCommand(stmt, conn) { CommandTimeout = 300 };
                    cmd.ExecuteNonQuery();
                    ok++;
                }
                catch (SqlException ex)
                {
                    fail++;
                    Console.WriteLine($"  跳过: {ex.Message.Replace("\r", " ").Replace("\n", " ")}");
                }
            }
            leninentSkipped += fail;
            Console.WriteLine($"  {Path.GetFileName(path)}: 成功 {ok}, 跳过 {fail}");
        }
        else
        {
            foreach (var batch in SplitBatches(text))
            {
                if (string.IsNullOrWhiteSpace(batch)) continue;
                using var cmd = new SqlCommand(batch, conn) { CommandTimeout = 300 };
                cmd.ExecuteNonQuery();
            }
        }
    }

    using var count = new SqlCommand("SELECT COUNT(*) FROM sys.tables", conn);
    Console.WriteLine($"表数: {count.ExecuteScalar()}");
}
Console.WriteLine($"完成 (宽松脚本累计跳过 {leninentSkipped} 条)");
return 0;

static IEnumerable<string> SplitBatches(string sql)
{
    // 单独成行的 GO 作为批分隔符(忽略大小写)；无 GO 则整文件一批
    var sb = new System.Text.StringBuilder();
    foreach (var line in sql.Replace("\r\n", "\n").Split('\n'))
    {
        if (line.Trim().Equals("GO", StringComparison.OrdinalIgnoreCase))
        {
            yield return sb.ToString();
            sb.Clear();
        }
        else sb.AppendLine(line);
    }
    yield return sb.ToString();
}
```

Create `db/run-db.ps1`:
```powershell
param([string]$ConnectionString = $env:ERP_DB)
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ConnectionString)) { throw "未提供连接串(参数 -ConnectionString 或环境变量 ERP_DB)" }
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $dir
dotnet run --project (Join-Path $root "tools\DbDeploy") -- $ConnectionString `
  ("lenient:" + (Join-Path $dir "01_rebuild_schema.sql")) `
  ("lenient:" + (Join-Path $dir "02_rebuild_relations.sql")) `
  (Join-Path $dir "03_p0_additions.sql")
```

> **DbDeploy 的 `lenient:` 模式**：净室脚本是逆向"推断"产物，含少量瑕疵——01 里几条 `CREATE INDEX [...]([单号])` 指向无该列的表；02 里部分推断外键两端列长度/精度不一致或列不存在。这些都是"声明式完整性/性能索引"，不影响表结构与列本身。故 01/02 用 `lenient:` 前缀**逐语句执行、失败即跳过并打印原因**，保证 146 张表与全部列建全；03（自建的 3 表+锁定列）保持严格模式。实测：01 跳过 ~5 条坏索引，02 应用 190/233 条关系、跳过 ~77 条（多为列长不一致的推断外键），最终 `表数: 149`。

- [ ] **Step 4: 在测试库与应用库上执行并核对表数**

Run:
```powershell
.\db\run-db.ps1 -ConnectionString $env:ERP_TEST_DB   # 建 erp_test(集成测试用)
.\db\run-db.ps1 -ConnectionString $env:ERP_DB        # 建 erp(应用运行用)
```
Expected: 两次输出末尾均为 `表数: 149`（146 原表 + 3 新表），并打印"02_rebuild_relations.sql: 成功 190, 跳过 77"。编码核对：3 张新表 OBJECT_ID 非空、`SELECT COL_LENGTH(N'sysfileuser',N'密码')` 返回 120（=nvarchar(60)）、`登录失败次数`/`锁定到期` 列存在。

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat(P0): 建库三步脚本 + 结存快照/单号流水/系统配置 3 表"
```

---

## Task 2: 数据库连接工厂（无硬编码）

**Files:**
- Create: `src/ErpApi/Infrastructure/Db/ISqlConnectionFactory.cs`, `SqlConnectionFactory.cs`
- Test: `tests/ErpApi.Tests/SqlConnectionFactoryTests.cs`

- [ ] **Step 1: 写失败测试（缺环境变量必须抛错，不得回退硬编码）**

Create `tests/ErpApi.Tests/SqlConnectionFactoryTests.cs`:
```csharp
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

public class SqlConnectionFactoryTests
{
    private static IConfiguration Cfg() => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_DB_TESTVAR" })
        .Build();

    [Fact]
    public void Missing_env_var_throws()
    {
        Environment.SetEnvironmentVariable("ERP_DB_TESTVAR", null);
        var f = new SqlConnectionFactory(Cfg());
        Assert.Throws<InvalidOperationException>(() => f.GetConnectionString());
    }

    [Fact]
    public void Reads_from_env_var()
    {
        Environment.SetEnvironmentVariable("ERP_DB_TESTVAR", "Server=x;Database=y;");
        var f = new SqlConnectionFactory(Cfg());
        Assert.Equal("Server=x;Database=y;", f.GetConnectionString());
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `dotnet test --filter SqlConnectionFactoryTests`
Expected: FAIL（类型不存在，编译错误）。

- [ ] **Step 3: 实现连接工厂**

Create `src/ErpApi/Infrastructure/Db/ISqlConnectionFactory.cs`:
```csharp
using Microsoft.Data.SqlClient;
namespace ErpApi.Infrastructure.Db;
public interface ISqlConnectionFactory
{
    string GetConnectionString();
    SqlConnection Create();
}
```

Create `src/ErpApi/Infrastructure/Db/SqlConnectionFactory.cs`:
```csharp
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
namespace ErpApi.Infrastructure.Db;

public sealed class SqlConnectionFactory(IConfiguration config) : ISqlConnectionFactory
{
    public string GetConnectionString()
    {
        var envName = config["Erp:ConnectionStringEnvVar"] ?? "ERP_DB";
        var cs = Environment.GetEnvironmentVariable(envName);
        if (string.IsNullOrWhiteSpace(cs))
            throw new InvalidOperationException($"连接串未配置：请设置环境变量 {envName}（禁止硬编码凭据）。");
        return cs;
    }

    public SqlConnection Create() => new(GetConnectionString());
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `dotnet test --filter SqlConnectionFactoryTests`
Expected: PASS（2 passed）。

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat(P0): 连接工厂从环境变量取连接串，禁止硬编码"
```

---

## Task 3: 密码哈希（bcrypt，无万能密码后门）

**Files:**
- Create: `src/ErpApi/Infrastructure/Security/IPasswordHasher.cs`, `BcryptPasswordHasher.cs`
- Test: `tests/ErpApi.Tests/PasswordHasherTests.cs`

- [ ] **Step 1: 写失败测试（含"后门字符串必须被拒"用例）**

Create `tests/ErpApi.Tests/PasswordHasherTests.cs`:
```csharp
using ErpApi.Infrastructure.Security;
using Xunit;

public class PasswordHasherTests
{
    private readonly IPasswordHasher _h = new BcryptPasswordHasher();

    [Fact]
    public void Hash_then_verify_true()
    {
        var hash = _h.Hash("S3cret!");
        Assert.True(_h.Verify("S3cret!", hash));
        Assert.True(hash.Length <= 60); // 适配 sysfileuser.密码 nvarchar(60)
    }

    [Fact]
    public void Wrong_password_verify_false()
    {
        var hash = _h.Hash("S3cret!");
        Assert.False(_h.Verify("wrong", hash));
    }

    [Fact]
    public void Backdoor_string_is_not_special()
    {
        var hash = _h.Hash("RealPassword");
        Assert.False(_h.Verify("zsbqr.com!#(", hash)); // 原软件万能密码后门必须无效
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `dotnet test --filter PasswordHasherTests`
Expected: FAIL（类型不存在）。

- [ ] **Step 3: 实现**

Create `src/ErpApi/Infrastructure/Security/IPasswordHasher.cs`:
```csharp
namespace ErpApi.Infrastructure.Security;
public interface IPasswordHasher
{
    string Hash(string password);
    bool Verify(string password, string hash);
}
```

Create `src/ErpApi/Infrastructure/Security/BcryptPasswordHasher.cs`:
```csharp
namespace ErpApi.Infrastructure.Security;

public sealed class BcryptPasswordHasher : IPasswordHasher
{
    // workFactor 10 => 哈希串长 60，正好适配 sysfileuser.密码 nvarchar(60)
    public string Hash(string password) => BCrypt.Net.BCrypt.HashPassword(password, workFactor: 10);

    public bool Verify(string password, string hash)
    {
        if (string.IsNullOrEmpty(hash)) return false;
        try { return BCrypt.Net.BCrypt.Verify(password, hash); }
        catch (BCrypt.Net.SaltParseException) { return false; }
    }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `dotnet test --filter PasswordHasherTests`
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat(P0): bcrypt 密码哈希，显式拒绝原后门字符串"
```

---

## Task 4: JWT 令牌服务

**Files:**
- Create: `src/ErpApi/Infrastructure/Security/IJwtTokenService.cs`, `JwtTokenService.cs`
- Test: `tests/ErpApi.Tests/JwtTokenServiceTests.cs`

- [ ] **Step 1: 写失败测试**

Create `tests/ErpApi.Tests/JwtTokenServiceTests.cs`:
```csharp
using System.IdentityModel.Tokens.Jwt;
using ErpApi.Infrastructure.Security;
using Microsoft.Extensions.Configuration;
using Xunit;

public class JwtTokenServiceTests
{
    private static IJwtTokenService Make()
    {
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{
            ["Erp:Jwt:Issuer"]="ErpApi", ["Erp:Jwt:Audience"]="ErpClient", ["Erp:Jwt:ExpireMinutes"]="480"
        }).Build();
        return new JwtTokenService(cfg);
    }

    [Fact]
    public void Token_contains_username_claim()
    {
        var token = Make().Issue("zhangsan");
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);
        Assert.Equal("zhangsan", jwt.Subject);
        Assert.Equal("ErpApi", jwt.Issuer);
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `dotnet test --filter JwtTokenServiceTests`
Expected: FAIL（类型不存在）。

- [ ] **Step 3: 实现**

Create `src/ErpApi/Infrastructure/Security/IJwtTokenService.cs`:
```csharp
namespace ErpApi.Infrastructure.Security;
public interface IJwtTokenService { string Issue(string userName); }
```

Create `src/ErpApi/Infrastructure/Security/JwtTokenService.cs`:
```csharp
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
namespace ErpApi.Infrastructure.Security;

public sealed class JwtTokenService(IConfiguration config) : IJwtTokenService
{
    public static string KeyEnvVar => "ERP_JWT_KEY";

    public string Issue(string userName)
    {
        var key = Environment.GetEnvironmentVariable(KeyEnvVar)
            ?? throw new InvalidOperationException($"JWT 密钥未配置：请设置环境变量 {KeyEnvVar}。");
        var creds = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)), SecurityAlgorithms.HmacSha256);
        var minutes = int.TryParse(config["Erp:Jwt:ExpireMinutes"], out var m) ? m : 480;
        var token = new JwtSecurityToken(
            issuer: config["Erp:Jwt:Issuer"],
            audience: config["Erp:Jwt:Audience"],
            claims: new[] { new Claim(JwtRegisteredClaimNames.Sub, userName) },
            expires: DateTime.UtcNow.AddMinutes(minutes),
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `dotnet test --filter JwtTokenServiceTests`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat(P0): JWT 令牌服务，密钥取自环境变量"
```

---

## Task 5: 引擎① 单号生成器

**Files:**
- Create: `src/ErpApi/Engines/DocumentNumber/IDocumentNumberGenerator.cs`, `DocumentNumberGenerator.cs`
- Test: `tests/ErpApi.Tests/DocumentNumberFormatTests.cs`, `tests/ErpApi.Tests/DbFixture.cs`, `tests/ErpApi.Tests/DocumentNumberDbTests.cs`

- [ ] **Step 1: 写格式化纯单元测试（与 DB 解耦）**

Create `tests/ErpApi.Tests/DocumentNumberFormatTests.cs`:
```csharp
using ErpApi.Engines.DocumentNumber;
using Xunit;

public class DocumentNumberFormatTests
{
    [Fact]
    public void Formats_prefix_date_seq_padded()
    {
        var s = DocumentNumberGenerator.Format("CRK", new DateTime(2026, 6, 3), 7);
        Assert.Equal("CRK20260603007", s); // 前缀 + yyyyMMdd + 流水补零3位
    }

    [Fact]
    public void Seq_over_999_keeps_full_digits()
    {
        var s = DocumentNumberGenerator.Format("CRK", new DateTime(2026, 6, 3), 1234);
        Assert.Equal("CRK202606031234", s);
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `dotnet test --filter DocumentNumberFormatTests`
Expected: FAIL（类型不存在）。

- [ ] **Step 3: 实现接口与生成器**

Create `src/ErpApi/Engines/DocumentNumber/IDocumentNumberGenerator.cs`:
```csharp
namespace ErpApi.Engines.DocumentNumber;
public interface IDocumentNumberGenerator
{
    // 在给定事务/连接内原子分配单号；行锁保证并发不撞号
    Task<string> NextAsync(string docType, string prefix, DateTime bizDate,
        Microsoft.Data.SqlClient.SqlConnection conn, Microsoft.Data.SqlClient.SqlTransaction tx);
}
```

Create `src/ErpApi/Engines/DocumentNumber/DocumentNumberGenerator.cs`:
```csharp
using Dapper;
using Microsoft.Data.SqlClient;
namespace ErpApi.Engines.DocumentNumber;

public sealed class DocumentNumberGenerator : IDocumentNumberGenerator
{
    public static string Format(string prefix, DateTime bizDate, int seq)
        => $"{prefix}{bizDate:yyyyMMdd}{seq.ToString().PadLeft(3, '0')}";

    public async Task<string> NextAsync(string docType, string prefix, DateTime bizDate,
        SqlConnection conn, SqlTransaction tx)
    {
        var day = bizDate.ToString("yyyyMMdd");
        // UPDLOCK+HOLDLOCK：同一(类型,日期)行串行化，避免并发撞号
        var seq = await conn.ExecuteScalarAsync<int>(@"
SET NOCOUNT ON;
UPDATE [单号流水表] WITH (UPDLOCK, HOLDLOCK)
   SET [当日流水] = [当日流水] + 1
 WHERE [单据类型]=@docType AND [业务日期]=@day;
IF @@ROWCOUNT = 0
   INSERT INTO [单号流水表]([单据类型],[业务日期],[当日流水]) VALUES(@docType,@day,1);
SELECT [当日流水] FROM [单号流水表] WHERE [单据类型]=@docType AND [业务日期]=@day;",
            new { docType, day }, tx);
        return Format(prefix, bizDate, seq);
    }
}
```

- [ ] **Step 4: 运行格式化测试，确认通过**

Run: `dotnet test --filter DocumentNumberFormatTests`
Expected: PASS。

- [ ] **Step 5: 写 DB 测试夹具（无连接串则跳过）**

Create `tests/ErpApi.Tests/DbFixture.cs`:
```csharp
using Microsoft.Data.SqlClient;
using Xunit;

public sealed class DbFixture
{
    public string? ConnectionString { get; } = Environment.GetEnvironmentVariable("ERP_TEST_DB");
    public bool Available => !string.IsNullOrWhiteSpace(ConnectionString);

    public SqlConnection Open()
    {
        Skip.IfNot(Available, "未设置 ERP_TEST_DB，跳过数据库集成测试");
        var c = new SqlConnection(ConnectionString);
        c.Open();
        return c;
    }
}

[CollectionDefinition("db")]
public sealed class DbCollection : ICollectionFixture<DbFixture> { }
```

- [ ] **Step 6: 写单号并发集成测试**

Create `tests/ErpApi.Tests/DocumentNumberDbTests.cs`:
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using Xunit;

[Collection("db")]
public class DocumentNumberDbTests(DbFixture fx)
{
    [SkippableFact]
    public async Task Concurrent_requests_produce_unique_numbers()
    {
        var bizDate = new DateTime(2026, 6, 3);
        using (var clean = fx.Open())
            clean.Execute("DELETE FROM [单号流水表] WHERE [单据类型]='TST'");

        var gen = new DocumentNumberGenerator();
        var results = new System.Collections.Concurrent.ConcurrentBag<string>();
        await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => Task.Run(async () =>
        {
            using var c = fx.Open();
            using var tx = c.BeginTransaction();
            results.Add(await gen.NextAsync("TST", "TST", bizDate, c, tx));
            tx.Commit();
        })));

        Assert.Equal(20, results.Distinct().Count()); // 无重复
    }
}
```

- [ ] **Step 7: 运行 DB 测试（已设 ERP_TEST_DB 则通过，否则 Skip）**

Run: `dotnet test --filter DocumentNumberDbTests`
Expected: PASS 或 Skipped（取决于是否设置 ERP_TEST_DB）。

- [ ] **Step 8: Commit**

```powershell
git add -A; git commit -m "feat(P0): 引擎① 单号生成器（行锁并发安全）+ DB夹具"
```

---

## Task 6: 引擎④ 权限标志与审计日志

**Files:**
- Create: `src/ErpApi/Engines/Authorization/PermissionFlags.cs`, `IPermissionService.cs`, `PermissionService.cs`, `IAuditLogger.cs`, `AuditLogger.cs`
- Test: `tests/ErpApi.Tests/PermissionFlagsTests.cs`

- [ ] **Step 1: 写 9 位权限映射纯单元测试**

Create `tests/ErpApi.Tests/PermissionFlagsTests.cs`:
```csharp
using ErpApi.Engines.Authorization;
using Xunit;

public class PermissionFlagsTests
{
    [Fact]
    public void Maps_nine_bits()
    {
        var p = new PermissionFlags { 打开=true, 单价=false, 金额=true, 审核=true };
        Assert.True(p.Has(PermissionAction.打开));
        Assert.False(p.Has(PermissionAction.单价)); // 看不到单价 => 前端隐藏价格列
        Assert.True(p.Has(PermissionAction.金额));
        Assert.True(p.Has(PermissionAction.审核));
        Assert.False(p.Has(PermissionAction.删除));
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `dotnet test --filter PermissionFlagsTests`
Expected: FAIL。

- [ ] **Step 3: 实现权限标志**

Create `src/ErpApi/Engines/Authorization/PermissionFlags.cs`:
```csharp
namespace ErpApi.Engines.Authorization;

public enum PermissionAction { 打开, 保存, 删除, 打印, 单价, 金额, 审核, 反审核, 功能 }

public sealed class PermissionFlags
{
    public bool 打开 { get; init; }
    public bool 保存 { get; init; }
    public bool 删除 { get; init; }
    public bool 打印 { get; init; }
    public bool 单价 { get; init; }
    public bool 金额 { get; init; }
    public bool 审核 { get; init; }
    public bool 反审核 { get; init; }
    public bool 功能 { get; init; }

    public bool Has(PermissionAction a) => a switch
    {
        PermissionAction.打开 => 打开,
        PermissionAction.保存 => 保存,
        PermissionAction.删除 => 删除,
        PermissionAction.打印 => 打印,
        PermissionAction.单价 => 单价,
        PermissionAction.金额 => 金额,
        PermissionAction.审核 => 审核,
        PermissionAction.反审核 => 反审核,
        PermissionAction.功能 => 功能,
        _ => false
    };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `dotnet test --filter PermissionFlagsTests`
Expected: PASS。

- [ ] **Step 5: 实现权限查询服务（从 userbqrpower 读）**

Create `src/ErpApi/Engines/Authorization/IPermissionService.cs`:
```csharp
namespace ErpApi.Engines.Authorization;
public interface IPermissionService
{
    Task<IReadOnlyDictionary<string, PermissionFlags>> GetByUserAsync(string userName);
    Task<bool> HasAsync(string userName, string menu, PermissionAction action);
}
```

Create `src/ErpApi/Engines/Authorization/PermissionService.cs`:
```csharp
using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Engines.Authorization;

public sealed class PermissionService(ISqlConnectionFactory factory) : IPermissionService
{
    public async Task<IReadOnlyDictionary<string, PermissionFlags>> GetByUserAsync(string userName)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
SELECT [菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能]
FROM [userbqrpower] WHERE [用户]=@userName", new { userName });

        var map = new Dictionary<string, PermissionFlags>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in rows)
        {
            string menu = r.菜单 ?? "";
            if (string.IsNullOrEmpty(menu)) continue;
            map[menu] = new PermissionFlags
            {
                打开 = r.打开 ?? false, 保存 = r.保存 ?? false, 删除 = r.删除 ?? false,
                打印 = r.打印 ?? false, 单价 = r.单价 ?? false, 金额 = r.金额 ?? false,
                审核 = r.审核 ?? false, 反审核 = r.反审核 ?? false, 功能 = r.功能 ?? false
            };
        }
        return map;
    }

    public async Task<bool> HasAsync(string userName, string menu, PermissionAction action)
    {
        var map = await GetByUserAsync(userName);
        return map.TryGetValue(menu, out var f) && f.Has(action);
    }
}
```

- [ ] **Step 6: 实现审计日志（写 c操作记录）**

Create `src/ErpApi/Engines/Authorization/IAuditLogger.cs`:
```csharp
using Microsoft.Data.SqlClient;
namespace ErpApi.Engines.Authorization;
public interface IAuditLogger
{
    Task WriteAsync(string tableName, string action, string user, string record,
        SqlConnection conn, SqlTransaction? tx = null);
}
```

Create `src/ErpApi/Engines/Authorization/AuditLogger.cs`:
```csharp
using Dapper;
using Microsoft.Data.SqlClient;
namespace ErpApi.Engines.Authorization;

public sealed class AuditLogger : IAuditLogger
{
    public Task WriteAsync(string tableName, string action, string user, string record,
        SqlConnection conn, SqlTransaction? tx = null)
        => conn.ExecuteAsync(@"
INSERT INTO [c操作记录]([日期时间],[表名],[行为],[操作员],[操作记录])
VALUES(SYSDATETIME(), @tableName, @action, @user, @record)",
            new { tableName, action, user, record }, tx);
}
```

- [ ] **Step 7: 运行全部测试，确认绿**

Run: `dotnet test --filter PermissionFlagsTests`
Expected: PASS。

- [ ] **Step 8: Commit**

```powershell
git add -A; git commit -m "feat(P0): 引擎④ 9位权限标志/查询服务 + c操作记录审计"
```

---

## Task 7: 引擎④ 权限授权过滤器（RequirePermission）

**Files:**
- Create: `src/ErpApi/Engines/Authorization/RequirePermissionAttribute.cs`
- Test: `tests/ErpApi.Tests/RequirePermissionTests.cs`

- [ ] **Step 1: 写授权过滤器测试（用假权限服务）**

Create `tests/ErpApi.Tests/RequirePermissionTests.cs`:
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public class RequirePermissionTests
{
    private sealed class FakePerm(bool allow) : IPermissionService
    {
        public Task<IReadOnlyDictionary<string, PermissionFlags>> GetByUserAsync(string u)
            => Task.FromResult<IReadOnlyDictionary<string, PermissionFlags>>(new Dictionary<string, PermissionFlags>());
        public Task<bool> HasAsync(string u, string m, PermissionAction a) => Task.FromResult(allow);
    }

    private static AuthorizationFilterContext Ctx(bool allow)
    {
        var services = new ServiceCollection();
        services.AddSingleton<IPermissionService>(new FakePerm(allow));
        var http = new DefaultHttpContext { RequestServices = services.BuildServiceProvider() };
        http.User = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, "u1") }, "test"));
        var ac = new ActionContext(http, new RouteData(), new ActionDescriptor());
        return new AuthorizationFilterContext(ac, new List<IFilterMetadata>());
    }

    [Fact]
    public async Task Denied_sets_403()
    {
        var ctx = Ctx(allow: false);
        await new RequirePermissionAttribute("成品入仓", PermissionAction.审核).OnAuthorizationAsync(ctx);
        Assert.IsType<ForbidResult>(ctx.Result);
    }

    [Fact]
    public async Task Allowed_passes_through()
    {
        var ctx = Ctx(allow: true);
        await new RequirePermissionAttribute("成品入仓", PermissionAction.审核).OnAuthorizationAsync(ctx);
        Assert.Null(ctx.Result);
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `dotnet test --filter RequirePermissionTests`
Expected: FAIL。

- [ ] **Step 3: 实现授权特性**

Create `src/ErpApi/Engines/Authorization/RequirePermissionAttribute.cs`:
```csharp
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.DependencyInjection;
namespace ErpApi.Engines.Authorization;

[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = true)]
public sealed class RequirePermissionAttribute(string menu, PermissionAction action)
    : Attribute, IAsyncAuthorizationFilter
{
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var user = context.HttpContext.User;
        var name = user.FindFirstValue(ClaimTypes.NameIdentifier)
                   ?? user.FindFirstValue("sub");
        if (string.IsNullOrEmpty(name)) { context.Result = new UnauthorizedResult(); return; }

        var svc = context.HttpContext.RequestServices.GetRequiredService<IPermissionService>();
        if (!await svc.HasAsync(name, menu, action))
            context.Result = new ForbidResult();
    }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `dotnet test --filter RequirePermissionTests`
Expected: PASS（2 passed）。

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat(P0): [RequirePermission] 按菜单×动作授权过滤器"
```

---

## Task 8: 引擎② 审核过账

**Files:**
- Create: `src/ErpApi/Engines/Posting/PostableDocuments.cs`, `IPostingEngine.cs`, `PostingEngine.cs`
- Test: `tests/ErpApi.Tests/PostableDocumentsTests.cs`, `tests/ErpApi.Tests/PostingEngineDbTests.cs`

- [ ] **Step 1: 写"单据表白名单"纯单元测试（防 SQL 注入）**

Create `tests/ErpApi.Tests/PostableDocumentsTests.cs`:
```csharp
using ErpApi.Engines.Posting;
using Xunit;

public class PostableDocumentsTests
{
    [Fact]
    public void Known_table_is_allowed()
        => Assert.True(PostableDocuments.IsAllowed("成品入仓单"));

    [Fact]
    public void Unknown_or_injection_is_rejected()
    {
        Assert.False(PostableDocuments.IsAllowed("成品入仓单; DROP TABLE x--"));
        Assert.False(PostableDocuments.IsAllowed("不存在的表"));
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `dotnet test --filter PostableDocumentsTests`
Expected: FAIL。

- [ ] **Step 3: 实现白名单 + 引擎接口**

Create `src/ErpApi/Engines/Posting/PostableDocuments.cs`:
```csharp
namespace ErpApi.Engines.Posting;

// 可审核的单头表白名单：表名只能来自此集合，杜绝拼接注入。
public static class PostableDocuments
{
    public static readonly IReadOnlySet<string> Tables = new HashSet<string>(StringComparer.Ordinal)
    {
        "成品入仓单","成品出仓单","成品调拨单","成品盘点单","成品退仓单","成品退货单",
        "采购入仓单","采购付款单","采购退仓单",
        "销售出货单","销售收款单","销售退货单",
        "领料单","退料单","调拨单","盘点单",
        "发外加工单","发外回收单","发外加工付款单",
        "半成品入仓单","半成品领料单","半成品盘点单",
        "成品客户订货单","生产制单"
        // 注：后续阶段可按需追加，但必须列入白名单才允许过账
    };

    public static bool IsAllowed(string table) => Tables.Contains(table);
}
```

Create `src/ErpApi/Engines/Posting/IPostingEngine.cs`:
```csharp
namespace ErpApi.Engines.Posting;
public interface IPostingEngine
{
    Task<bool> ApproveAsync(string table, string docNo, string user);     // 审核 0->1
    Task<bool> UnapproveAsync(string table, string docNo, string user);   // 反审核 1->0
}
```

- [ ] **Step 4: 实现过账引擎（事务 + 写审计）**

Create `src/ErpApi/Engines/Posting/PostingEngine.cs`:
```csharp
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Engines.Posting;

public sealed class PostingEngine(ISqlConnectionFactory factory, IAuditLogger audit) : IPostingEngine
{
    public Task<bool> ApproveAsync(string table, string docNo, string user)
        => SetAuditAsync(table, docNo, user, from: "0", to: "1", behavior: "审核");

    public Task<bool> UnapproveAsync(string table, string docNo, string user)
        => SetAuditAsync(table, docNo, user, from: "1", to: "0", behavior: "反审核");

    private async Task<bool> SetAuditAsync(string table, string docNo, string user,
        string from, string to, string behavior)
    {
        if (!PostableDocuments.IsAllowed(table))
            throw new InvalidOperationException($"表 [{table}] 不在可过账白名单内。");

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        // 表名来自白名单，安全可拼接；单号/状态参数化。仅当当前状态=from 才翻转（幂等、防重复）
        var sql = $@"
UPDATE [{table}]
   SET [审核]=@to,
       [审核人]=CASE WHEN @to='1' THEN @user ELSE NULL END,
       [审核日期]=CASE WHEN @to='1' THEN SYSDATETIME() ELSE NULL END
 WHERE [单号]=@docNo AND ISNULL([审核],'0')=@from;";
        var affected = await c.ExecuteAsync(sql, new { to, from, user, docNo }, tx);
        if (affected == 0) { tx.Rollback(); return false; }

        await audit.WriteAsync(table, behavior, user, $"单号={docNo}", c, tx);
        tx.Commit();
        return true;
    }
}
```
说明：单头表均含 `单号/审核/审核人/审核日期`（见 `schema_full.txt`）；反审核被下游引用的校验放在各模块 Service 调用前（P5+ 接入），P0 引擎只负责原子翻转 + 审计。

- [ ] **Step 5: 运行白名单测试，确认通过**

Run: `dotnet test --filter PostableDocumentsTests`
Expected: PASS。

- [ ] **Step 6: 写过账 DB 集成测试**

Create `tests/ErpApi.Tests/PostingEngineDbTests.cs`:
```csharp
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PostingEngineDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string,string?>{ ["Erp:ConnectionStringEnvVar"]="ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task Approve_then_unapprove_flips_flag_and_audits()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [成品入仓单] WHERE [单号]='P0TEST'");
        c.Execute("DELETE FROM [c操作记录] WHERE [操作记录]='单号=P0TEST'");
        c.Execute("INSERT INTO [成品入仓单]([单号],[审核]) VALUES('P0TEST','0')");

        var engine = new PostingEngine(Factory(), new AuditLogger());

        Assert.True(await engine.ApproveAsync("成品入仓单", "P0TEST", "tester"));
        Assert.Equal("1", c.ExecuteScalar<string>("SELECT [审核] FROM [成品入仓单] WHERE [单号]='P0TEST'"));
        Assert.Equal("tester", c.ExecuteScalar<string>("SELECT [审核人] FROM [成品入仓单] WHERE [单号]='P0TEST'"));

        Assert.False(await engine.ApproveAsync("成品入仓单", "P0TEST", "tester")); // 已是1，重复审核返回false
        Assert.True(await engine.UnapproveAsync("成品入仓单", "P0TEST", "tester"));
        Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [成品入仓单] WHERE [单号]='P0TEST'"));

        Assert.True(c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [c操作记录] WHERE [操作记录]='单号=P0TEST'") >= 2);
    }
}
```

- [ ] **Step 7: 运行 DB 测试（设了 ERP_TEST_DB 则通过）**

Run: `dotnet test --filter PostingEngineDbTests`
Expected: PASS 或 Skipped。

- [ ] **Step 8: Commit**

```powershell
git add -A; git commit -m "feat(P0): 引擎② 审核/反审核过账（白名单+事务+审计）"
```

---

## Task 9: 引擎③ 库存汇总（Dapper UNION 符号法 + 快照接口）

**Files:**
- Create: `src/ErpApi/Engines/Inventory/InventoryRow.cs`, `IInventorySnapshotProvider.cs`, `NullSnapshotProvider.cs`, `IInventorySummaryService.cs`, `InventorySummaryService.cs`
- Test: `tests/ErpApi.Tests/InventorySummaryDbTests.cs`

- [ ] **Step 1: 实现行模型与快照接口**

Create `src/ErpApi/Engines/Inventory/InventoryRow.cs`:
```csharp
namespace ErpApi.Engines.Inventory;
public sealed class InventoryRow
{
    public string 款号 { get; set; } = "";
    public string? 款式 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 库存 { get; set; }
}
```

Create `src/ErpApi/Engines/Inventory/IInventorySnapshotProvider.cs`:
```csharp
namespace ErpApi.Engines.Inventory;
// 快照层占位：P0 用 Null 实现（无快照=全量实时）；P5 替换为按月滚存实现。
public interface IInventorySnapshotProvider
{
    Task<(string? 年月, IReadOnlyList<InventoryRow> 期初)> GetLatestAsync(string warehouse);
}
```

Create `src/ErpApi/Engines/Inventory/NullSnapshotProvider.cs`:
```csharp
namespace ErpApi.Engines.Inventory;
public sealed class NullSnapshotProvider : IInventorySnapshotProvider
{
    public Task<(string?, IReadOnlyList<InventoryRow>)> GetLatestAsync(string warehouse)
        => Task.FromResult<(string?, IReadOnlyList<InventoryRow>)>((null, Array.Empty<InventoryRow>()));
}
```

- [ ] **Step 2: 实现库存汇总服务**

Create `src/ErpApi/Engines/Inventory/IInventorySummaryService.cs`:
```csharp
namespace ErpApi.Engines.Inventory;
public interface IInventorySummaryService
{
    Task<IReadOnlyList<InventoryRow>> FinishedGoodsAsync(string warehouse);
}
```

Create `src/ErpApi/Engines/Inventory/InventorySummaryService.cs`:
```csharp
using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Engines.Inventory;

public sealed class InventorySummaryService(ISqlConnectionFactory factory) : IInventorySummaryService
{
    // 算法1：入 +数量 / 出 −数量，UNION ALL 后按 款号×色号×颜色×尺码 group sum，仅 审核='1'。
    // 成品口径：入仓(+)、退货(+客户退回)、出仓(-)、退仓(-)、调入(+)/调出(-)。
    private const string Sql = @"
SELECT 款号, MAX(款式) AS 款式, 色号, 颜色, 尺码, SUM(库存) AS 库存
FROM (
    SELECT 款号,款式,色号,颜色,尺码, 数量        AS 库存 FROM [成品入仓明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL
    SELECT 款号,款式,色号,颜色,尺码, 数量        AS 库存 FROM [成品退货明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL
    SELECT 款号,款式,色号,颜色,尺码, 数量*-1     AS 库存 FROM [成品出仓明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL
    SELECT 款号,款式,色号,颜色,尺码, 数量*-1     AS 库存 FROM [成品退仓明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
) t
GROUP BY 款号,色号,颜色,尺码
HAVING SUM(库存) <> 0;";

    public async Task<IReadOnlyList<InventoryRow>> FinishedGoodsAsync(string warehouse)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<InventoryRow>(Sql, new { 仓 = warehouse });
        return rows.AsList();
    }
}
```
说明：调拨在 P5 接入（调拨明细单需区分调入/调出仓字段）；P0 先覆盖入/出/退货/退仓四类，保证引擎骨架可跑通、可测。

- [ ] **Step 3: 写库存汇总 DB 集成测试**

Create `tests/ErpApi.Tests/InventorySummaryDbTests.cs`:
```csharp
using Dapper;
using ErpApi.Engines.Inventory;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class InventorySummaryDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string,string?>{ ["Erp:ConnectionStringEnvVar"]="ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task In_minus_out_only_counts_approved()
    {
        using var c = fx.Open();
        c.Execute(@"DELETE FROM [成品入仓明细单] WHERE 款号='K0';
                    DELETE FROM [成品出仓明细单] WHERE 款号='K0';");
        // 入100(审核) + 入50(未审,应忽略) - 出30(审核) = 70
        c.Execute(@"INSERT INTO [成品入仓明细单](单号,仓库,款号,颜色,尺码,数量,审核) VALUES('I1','W1','K0','红','M',100,'1')");
        c.Execute(@"INSERT INTO [成品入仓明细单](单号,仓库,款号,颜色,尺码,数量,审核) VALUES('I2','W1','K0','红','M',50,'0')");
        c.Execute(@"INSERT INTO [成品出仓明细单](单号,仓库,款号,颜色,尺码,数量,审核) VALUES('O1','W1','K0','红','M',30,'1')");

        var rows = await new InventorySummaryService(Factory()).FinishedGoodsAsync("W1");
        var k0 = rows.Single(r => r.款号 == "K0" && r.颜色 == "红" && r.尺码 == "M");
        Assert.Equal(70m, k0.库存);
    }
}
```

- [ ] **Step 4: 运行 DB 测试**

Run: `dotnet test --filter InventorySummaryDbTests`
Expected: PASS 或 Skipped。

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat(P0): 引擎③ 库存汇总(UNION符号法,仅审核单)+快照接口占位"
```

---

## Task 10: 登录认证（bcrypt 比对 + 锁定，无后门）

**Files:**
- Create: `src/ErpApi/Features/Auth/AuthDtos.cs`, `AuthService.cs`, `AuthController.cs`
- Test: `tests/ErpApi.Tests/AuthServiceDbTests.cs`

- [ ] **Step 1: 实现 DTO**

Create `src/ErpApi/Features/Auth/AuthDtos.cs`:
```csharp
namespace ErpApi.Features.Auth;
public sealed record LoginRequest(string 用户, string 密码);
public sealed record LoginResult(bool 成功, string? 令牌, string? 消息);
```

- [ ] **Step 2: 实现登录服务（核心安全逻辑）**

Create `src/ErpApi/Features/Auth/AuthService.cs`:
```csharp
using Dapper;
using ErpApi.Infrastructure.Db;
using ErpApi.Infrastructure.Security;
using Microsoft.Extensions.Configuration;
namespace ErpApi.Features.Auth;

public sealed class AuthService(
    ISqlConnectionFactory factory, IPasswordHasher hasher,
    IJwtTokenService jwt, IConfiguration config)
{
    public async Task<LoginResult> LoginAsync(string userName, string password)
    {
        int maxFail = int.TryParse(config["Erp:Login:MaxFailures"], out var mf) ? mf : 5;
        int lockMin = int.TryParse(config["Erp:Login:LockMinutes"], out var lm) ? lm : 15;

        using var c = factory.Create();
        await c.OpenAsync();
        var u = await c.QuerySingleOrDefaultAsync(
            "SELECT [用户],[密码],[登录失败次数],[锁定到期] FROM [sysfileuser] WHERE [用户]=@userName",
            new { userName });

        // 无此用户：返回与密码错误一致的模糊消息（不泄露用户是否存在）
        if (u is null) return new LoginResult(false, null, "用户名或密码错误");

        if (u.锁定到期 is DateTime until && until > DateTime.Now)
            return new LoginResult(false, null, $"账户已锁定，请于 {until:HH:mm} 后再试");

        // 唯一的校验路径：bcrypt 比对。没有任何万能密码/后门分支。
        bool ok = hasher.Verify(password, (string?)u.密码 ?? "");
        if (!ok)
        {
            int fails = (int)(u.登录失败次数 ?? 0) + 1;
            DateTime? lockUntil = fails >= maxFail ? DateTime.Now.AddMinutes(lockMin) : null;
            // 只存失败次数与锁定时间，绝不写入明文错误密码
            await c.ExecuteAsync(
                "UPDATE [sysfileuser] SET [登录失败次数]=@fails,[锁定到期]=@lockUntil WHERE [用户]=@userName",
                new { fails, lockUntil, userName });
            return new LoginResult(false, null, "用户名或密码错误");
        }

        // 成功：清零计数、记录登录信息
        await c.ExecuteAsync(@"UPDATE [sysfileuser]
            SET [登录失败次数]=0,[锁定到期]=NULL,[登录状态]='在线',[日期]=GETDATE()
            WHERE [用户]=@userName", new { userName });
        return new LoginResult(true, jwt.Issue((string)u.用户), null);
    }
}
```

- [ ] **Step 3: 实现控制器**

Create `src/ErpApi/Features/Auth/AuthController.cs`:
```csharp
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
namespace ErpApi.Features.Auth;

[ApiController]
[Route("api/[controller]")]
public sealed class AuthController(AuthService auth, IPermissionService perm) : ControllerBase
{
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResult>> Login([FromBody] LoginRequest req)
    {
        var r = await auth.LoginAsync(req.用户, req.密码);
        return r.成功 ? Ok(r) : Unauthorized(r);
    }

    [HttpGet("me/permissions")]
    [Authorize]
    public async Task<IActionResult> MyPermissions()
    {
        var name = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub")!;
        return Ok(await perm.GetByUserAsync(name));
    }
}
```

- [ ] **Step 4: 写登录 DB 集成测试（含后门用例 + 锁定）**

Create `tests/ErpApi.Tests/AuthServiceDbTests.cs`:
```csharp
using Dapper;
using ErpApi.Features.Auth;
using ErpApi.Infrastructure.Db;
using ErpApi.Infrastructure.Security;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class AuthServiceDbTests(DbFixture fx)
{
    private (AuthService svc, ISqlConnectionFactory f) Make()
    {
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{
            ["Erp:ConnectionStringEnvVar"]="ERP_TEST_DB",
            ["Erp:Login:MaxFailures"]="5", ["Erp:Login:LockMinutes"]="15",
            ["Erp:Jwt:Issuer"]="ErpApi", ["Erp:Jwt:Audience"]="ErpClient", ["Erp:Jwt:ExpireMinutes"]="480"
        }).Build();
        var f = new SqlConnectionFactory(cfg);
        var hasher = new BcryptPasswordHasher();
        using (var c = fx.Open())
        {
            c.Execute("DELETE FROM [sysfileuser] WHERE [用户]='p0user'");
            c.Execute("INSERT INTO [sysfileuser]([用户],[密码],[登录失败次数]) VALUES('p0user',@h,0)",
                new { h = hasher.Hash("Right#123") });
        }
        return (new AuthService(f, hasher, new JwtTokenService(cfg), cfg), f);
    }

    [SkippableFact]
    public async Task Correct_password_succeeds()
    {
        var (svc, _) = Make();
        var r = await svc.LoginAsync("p0user", "Right#123");
        Assert.True(r.成功);
        Assert.NotNull(r.令牌);
    }

    [SkippableFact]
    public async Task Backdoor_password_fails()
    {
        var (svc, _) = Make();
        var r = await svc.LoginAsync("p0user", "zsbqr.com!#("); // 原万能密码后门必须失败
        Assert.False(r.成功);
    }

    [SkippableFact]
    public async Task Five_failures_lock_account()
    {
        var (svc, f) = Make();
        for (int i = 0; i < 5; i++) await svc.LoginAsync("p0user", "wrong");
        var r = await svc.LoginAsync("p0user", "Right#123"); // 即便密码对，也因锁定被拒
        Assert.False(r.成功);
        Assert.Contains("锁定", r.消息);
        using var c = fx.Open();
        Assert.Null(c.ExecuteScalar<string>("SELECT [错密1] FROM [sysfileuser] WHERE [用户]='p0user'")); // 不存明文错密
    }
}
```

- [ ] **Step 5: 运行测试**

Run: `dotnet test --filter AuthServiceDbTests`
Expected: PASS 或 Skipped。

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "feat(P0): 登录认证 bcrypt+锁定，无后门，错误只存计数"
```

---

## Task 11: 装配 Program.cs（DI + JWT + 控制器）

**Files:**
- Modify: `src/ErpApi/Program.cs`

- [ ] **Step 1: 写 Program.cs**

Replace `src/ErpApi/Program.cs` 全文:
```csharp
using System.Text;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Engines.Posting;
using ErpApi.Features.Auth;
using ErpApi.Infrastructure.Db;
using ErpApi.Infrastructure.Security;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// 基础设施
builder.Services.AddSingleton<ISqlConnectionFactory, SqlConnectionFactory>();
builder.Services.AddSingleton<IPasswordHasher, BcryptPasswordHasher>();
builder.Services.AddSingleton<IJwtTokenService, JwtTokenService>();
// 4 横切引擎
builder.Services.AddScoped<IDocumentNumberGenerator, DocumentNumberGenerator>();
builder.Services.AddScoped<IPostingEngine, PostingEngine>();
builder.Services.AddScoped<IInventorySummaryService, InventorySummaryService>();
builder.Services.AddSingleton<IInventorySnapshotProvider, NullSnapshotProvider>();
builder.Services.AddScoped<IPermissionService, PermissionService>();
builder.Services.AddSingleton<IAuditLogger, AuditLogger>();
// 业务
builder.Services.AddScoped<AuthService>();

// JWT 认证（密钥来自环境变量，无硬编码）
var jwtKey = Environment.GetEnvironmentVariable(JwtTokenService.KeyEnvVar)
    ?? throw new InvalidOperationException($"请设置环境变量 {JwtTokenService.KeyEnvVar}");
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true, ValidateAudience = true, ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Erp:Jwt:Issuer"],
            ValidAudience = builder.Configuration["Erp:Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
        };
    });
builder.Services.AddAuthorization();

builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins("http://localhost:5173").AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();
if (app.Environment.IsDevelopment()) { app.UseSwagger(); app.UseSwaggerUI(); }
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.Run();

public partial class Program { } // 供集成测试引用
```

- [ ] **Step 2: 验证编译与启动**

Run:
```powershell
$env:ERP_DB="Server=localhost;Database=erp_test;Trusted_Connection=True;TrustServerCertificate=True"
$env:ERP_JWT_KEY="dev-key-please-change-0123456789abcdef"
dotnet build
```
Expected: Build succeeded, 0 Error。

- [ ] **Step 3: 烟雾测试登录端点（需 DB 已建 + 有 p0user，可跳过）**

Run (可选):
```powershell
dotnet run --project src/ErpApi &
# 另开终端：curl -X POST http://localhost:5xxx/api/auth/login -H "Content-Type: application/json" -d '{"用户":"p0user","密码":"Right#123"}'
```
Expected: 返回 `{"成功":true,"令牌":"..."}`。

- [ ] **Step 4: 运行整套测试**

Run: `dotnet test`
Expected: 所有纯单元测试 PASS；DB 测试 PASS 或 Skipped。

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat(P0): Program 装配 DI/JWT/CORS/控制器"
```

---

## Task 12: 前端骨架 + 登录页

**Files:**
- Create: `web/`（Vite 脚手架）, `web/src/api/client.ts`, `web/src/pages/Login.tsx`
- Test: `web/src/__tests__/permissions.test.ts`

- [ ] **Step 1: 脚手架 + 依赖**

Run:
```powershell
npm create vite@latest web -- --template react-ts
cd web; npm install; npm install antd axios react-router-dom; npm install -D vitest; cd ..
```

- [ ] **Step 2: 实现 API 客户端（携带 JWT）**

Create `web/src/api/client.ts`:
```ts
import axios from "axios";

export const api = axios.create({ baseURL: "http://localhost:5000/api" });

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem("erp_token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

export async function login(用户: string, 密码: string) {
  const { data } = await api.post("/auth/login", { 用户, 密码 });
  if (data.令牌) localStorage.setItem("erp_token", data.令牌);
  return data as { 成功: boolean; 令牌?: string; 消息?: string };
}
```

- [ ] **Step 3: 实现登录页**

Create `web/src/pages/Login.tsx`:
```tsx
import { Button, Card, Form, Input, message } from "antd";
import { useNavigate } from "react-router-dom";
import { login } from "../api/client";

export default function Login() {
  const nav = useNavigate();
  const onFinish = async (v: { 用户: string; 密码: string }) => {
    const r = await login(v.用户, v.密码);
    if (r.成功) nav("/");
    else message.error(r.消息 ?? "登录失败");
  };
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
      <Card title="兴信B ERP 登录" style={{ width: 360 }}>
        <Form onFinish={onFinish} layout="vertical">
          <Form.Item name="用户" label="用户" rules={[{ required: true }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="密码" label="密码" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>登录</Button>
        </Form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: 验证前端编译**

Run: `cd web; npm run build; cd ..`
Expected: build 成功。

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat(P0): 前端骨架 + 登录页 + JWT API 客户端"
```

---

## Task 13: 前端权限模型 + 主框架（菜单/价格列按 9 位控）

**Files:**
- Create: `web/src/auth/permissions.ts`, `web/src/auth/PermissionContext.tsx`, `web/src/pages/MainLayout.tsx`, `web/src/App.tsx`(改)
- Test: `web/src/__tests__/permissions.test.ts`

- [ ] **Step 1: 写权限工具失败测试**

Create `web/src/__tests__/permissions.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { can, hidePrice, type PermMap } from "../auth/permissions";

const map: PermMap = {
  成品入仓: { 打开: true, 保存: true, 删除: false, 打印: true,
            单价: false, 金额: true, 审核: true, 反审核: false, 功能: false },
};

describe("permissions", () => {
  it("can() reads a bit", () => {
    expect(can(map, "成品入仓", "审核")).toBe(true);
    expect(can(map, "成品入仓", "删除")).toBe(false);
    expect(can(map, "不存在", "打开")).toBe(false);
  });
  it("hidePrice() true when 单价 bit off", () => {
    expect(hidePrice(map, "成品入仓")).toBe(true); // 无单价权限 => 隐藏价格列
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd web; npx vitest run; cd ..`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现权限工具**

Create `web/src/auth/permissions.ts`:
```ts
export type PermAction =
  | "打开" | "保存" | "删除" | "打印" | "单价" | "金额" | "审核" | "反审核" | "功能";

export type PermFlags = Record<PermAction, boolean>;
export type PermMap = Record<string, PermFlags>;

export const can = (m: PermMap, menu: string, a: PermAction): boolean =>
  !!m[menu]?.[a];

// 与后端 PermissionFlags.单价 对齐：无"单价"权限即隐藏所有价格列（成本保密）
export const hidePrice = (m: PermMap, menu: string): boolean =>
  !can(m, menu, "单价");
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd web; npx vitest run; cd ..`
Expected: PASS。

- [ ] **Step 5: 实现权限上下文（登录后拉取 /me/permissions）**

Create `web/src/auth/PermissionContext.tsx`:
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { PermMap } from "./permissions";

const Ctx = createContext<PermMap>({});
export const usePerms = () => useContext(Ctx);

export function PermissionProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<PermMap>({});
  useEffect(() => {
    api.get<PermMap>("/auth/me/permissions").then((r) => setMap(r.data)).catch(() => setMap({}));
  }, []);
  return <Ctx.Provider value={map}>{children}</Ctx.Provider>;
}
```

- [ ] **Step 6: 实现主框架（按 打开 位过滤菜单）**

Create `web/src/pages/MainLayout.tsx`:
```tsx
import { Layout, Menu } from "antd";
import { Outlet } from "react-router-dom";
import { can, usePerms } from "../auth/permissions";
import { usePerms as usePermsCtx } from "../auth/PermissionContext";

const ALL_MENUS = ["基础资料", "接单", "生产制单", "采购入仓", "成品入仓", "成品出仓", "工资计件", "系统设置"];

export default function MainLayout() {
  const perms = usePermsCtx();
  // 只显示用户拥有"打开"权限的菜单
  const items = ALL_MENUS.filter((m) => can(perms, m, "打开")).map((m) => ({ key: m, label: m }));
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Sider><Menu theme="dark" mode="inline" items={items} /></Layout.Sider>
      <Layout>
        <Layout.Header style={{ color: "#fff" }}>兴信B ERP</Layout.Header>
        <Layout.Content style={{ padding: 16 }}><Outlet /></Layout.Content>
      </Layout>
    </Layout>
  );
}
```
注：`MainLayout` 用 `usePermsCtx`（来自 PermissionContext）取权限；`can` 来自 permissions.ts。

- [ ] **Step 7: 接线路由**

Replace `web/src/App.tsx`:
```tsx
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { PermissionProvider } from "./auth/PermissionContext";
import Login from "./pages/Login";
import MainLayout from "./pages/MainLayout";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<PermissionProvider><MainLayout /></PermissionProvider>}>
          <Route index element={<div>欢迎使用兴信B ERP（P0 地基已就绪）</div>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 8: 验证构建与测试**

Run: `cd web; npx vitest run; npm run build; cd ..`
Expected: 测试 PASS，build 成功。

- [ ] **Step 9: Commit**

```powershell
git add -A; git commit -m "feat(P0): 前端 9位权限模型 + 主框架(菜单/价格列按位控)"
```

---

## Task 14: P0 收尾（README + 端到端核对）

**Files:**
- Create: `README.md`

- [ ] **Step 1: 写运行说明**

Create `README.md`:
```markdown
# 兴信B ERP 重建（P0 地基）

## 环境变量（禁止硬编码，必须设置）
- `ERP_DB`：SQL Server 连接串
- `ERP_JWT_KEY`：JWT 签名密钥（≥32 字符）
- `ERP_TEST_DB`：（可选）集成测试数据库连接串；不设则 DB 测试跳过

## 启动
1. 建库：`./db/run-db.ps1 -ConnectionString $env:ERP_DB`（再对 `$env:ERP_TEST_DB` 跑一次建测试库）
2. 后端：`dotnet run --project src/ErpApi`
3. 前端：`cd web; npm run dev`

## P0 已交付
- 建库三步（146表+233外键+3新表）
- 4 横切引擎：单号生成 / 审核过账 / 库存汇总 / 权限审计
- 登录：bcrypt + JWT + 连错5次锁定，无后门
- 前端：登录 + 主框架 + 9位权限控菜单/价格列
```

- [ ] **Step 2: 全量测试**

Run: `dotnet test`
Expected: 单元测试全绿；DB 测试 PASS/Skip。

- [ ] **Step 3: Commit**

```powershell
git add -A; git commit -m "docs(P0): 运行说明，P0 地基完成"
```

---

## Self-Review 记录

- **Spec 覆盖**：建库三步(T1)、引擎①(T5)、引擎②(T8)、引擎③(T9)、引擎④(T6/T7)、登录bcrypt+锁定无后门(T10)、前端骨架+9位权限控菜单/价格列(T12/T13)、安全基线连接串/密钥取环境变量(T2/T4/T11) —— 8 项需求均有对应任务。
- **占位符**：无 TBD/TODO；每个代码步骤含完整代码。
- **类型一致**：`PermissionFlags`/`PermissionAction` 跨 T6/T7 一致；`IInventorySummaryService.FinishedGoodsAsync` 与测试一致；`ISqlConnectionFactory.Create/GetConnectionString` 全程一致；前端 `can/hidePrice/PermMap` 跨 T13 一致。
- **已知边界**：库存引擎 P0 覆盖入/出/退货/退仓，调拨留 P5；反审核下游引用校验留 P5；快照层 P0 用 `NullSnapshotProvider` 占位。
```
