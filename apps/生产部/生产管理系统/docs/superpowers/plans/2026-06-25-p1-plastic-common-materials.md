# 塑胶共用物料表(P1 按货号塑胶BOM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建塑胶模块 P1 —— `塑胶共用物料表`(按塑胶货号的塑胶注塑BOM)表 + 增删改 + 过滤列表页 + 塑胶物料选择器(从 P0 塑胶物料资料选料回填)。

**Architecture:** 沿用 P0 塑胶物料资料的同款模式:新独立表 `塑胶共用物料表`(19 列),增删改白嫖泛型 `MasterCrudController<T>`(EF),过滤列表新写只读服务/控制器(Dapper),前端扁平筛选列表 + 新增/编辑 Modal,Modal 里物料编号经塑胶物料选择器(克隆 MaterialPicker 换 P0 数据源)回填。加工单价按 `单价` 权限脱敏。

**Tech Stack:** .NET 8 / EF Core / Dapper / ASP.NET Controllers · React + TS + Ant Design · SQL Server。

**设计依据:** `docs/superpowers/specs/2026-06-25-p1-plastic-common-materials-design.md`。参照已完成的 P0(`946cab8`):物料侧镜像源 `MaterialMaster*`、`塑胶物料资料.cs`、`PlasticMaterialMaster*`、`PlasticMaterialMasterPage.tsx`、`MaterialPicker.tsx`。

---

## 文件结构

| 文件 | 职责 | 新建/改 |
|---|---|---|
| `db/16_plastic_common_materials.sql` | `塑胶共用物料表` 建表 DDL | 新建 |
| `db/seed_plastic_common_perms.sql` | admin 9 位权限种子 | 新建 |
| `src/ErpApi/Data/Entities/塑胶共用物料表.cs` | EF 实体 | 新建 |
| `src/ErpApi/Data/ErpDbContext.cs` | DbSet 注册 | 改 |
| `src/ErpApi/Features/MasterData/Controllers.cs` | 泛型 CRUD 控制器子类 | 改 |
| `src/ErpApi/Features/Plastics/PlasticCommonMaterial/PlasticCommonMaterialDtos.cs` | 只读行 DTO | 新建 |
| `src/ErpApi/Features/Plastics/PlasticCommonMaterial/PlasticCommonMaterialService.cs` | 过滤列表只读(Dapper) | 新建 |
| `src/ErpApi/Features/Plastics/PlasticCommonMaterial/PlasticCommonMaterialController.cs` | 只读 REST + 脱敏 | 新建 |
| `src/ErpApi/Program.cs` | 注册 service | 改 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 菜单项 | 改 |
| `tests/ErpApi.Tests/PlasticCommonMaterialDbTests.cs` | 只读服务 DB 测试 | 新建 |
| `web/src/api/plasticCommonMaterial.ts` | 前端 API + 类型 | 新建 |
| `web/src/pages/plastics/PlasticMaterialPicker.tsx` | 塑胶物料选择器(克隆 MaterialPicker) | 新建 |
| `web/src/pages/plastics/PlasticCommonMaterialPage.tsx` | 筛选列表 + CRUD 页 | 新建 |
| `web/src/App.tsx` | 路由 | 改 |
| `web/src/nav/menuTree.tsx` | ⑧塑胶仓库「塑胶共用物料表」落地 | 改 |

---

### Task 1: 建表脚本 + 执行

**Files:** Create `db/16_plastic_common_materials.sql`

- [ ] **Step 0: 建特性分支**

Run: `cd /d/WebpageERP && git checkout master && git checkout -b feat-plastic-common-materials`
Expected: `Switched to a new branch 'feat-plastic-common-materials'`

- [ ] **Step 1: 写建表脚本**

`db/16_plastic_common_materials.sql`:
```sql
-- 塑胶模块 P1:塑胶共用物料表(按塑胶货号的塑胶注塑BOM·塑胶物料单带出源)
IF OBJECT_ID(N'[塑胶共用物料表]', N'U') IS NULL
CREATE TABLE [塑胶共用物料表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [客户] nvarchar(50) NULL,
    [塑胶货号] nvarchar(40) NULL,
    [工模编号] nvarchar(30) NULL,
    [物料名称] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [色粉号] nvarchar(30) NULL,
    [用料名称] nvarchar(40) NULL,
    [加工内容] nvarchar(50) NULL,
    [加工单价] decimal(18,4) NULL,
    [整啤净重] decimal(18,4) NULL,
    [原胶件单净重] decimal(18,4) NULL,
    [整啤模腔数] decimal(18,4) NULL,
    [套数] decimal(18,4) NULL,
    [用量] decimal(18,4) NULL,
    [物料编号] nvarchar(20) NULL,
    [共用原料编号] nvarchar(20) NULL,
    [调整审核] nvarchar(5) NULL,
    [备注内容] nvarchar(200) NULL,
    [工模表备注] nvarchar(200) NULL
);
```

- [ ] **Step 2: 在两库执行**

Run:
```bash
cd /d/WebpageERP
for V in ERP_TEST_DB ERP_DB; do \
  powershell -NoProfile -Command "\$cs=\$env:$V; \$c=New-Object System.Data.SqlClient.SqlConnection \$cs; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=[IO.File]::ReadAllText('db/16_plastic_common_materials.sql'); \$null=\$cmd.ExecuteNonQuery(); \$c.Close(); Write-Output '$V ok'"; \
done
```
Expected: `ERP_TEST_DB ok` 和 `ERP_DB ok`。

- [ ] **Step 3: 验证表存在**

Run:
```bash
powershell -NoProfile -Command "\$c=New-Object System.Data.SqlClient.SqlConnection \$env:ERP_TEST_DB; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=\"SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME=N'塑胶共用物料表'\"; \$cmd.ExecuteScalar(); \$c.Close()"
```
Expected: `1`

- [ ] **Step 4: Commit**

```bash
git add db/16_plastic_common_materials.sql
git commit -m "feat(塑胶共用物料表): 建表脚本(按货号塑胶BOM·19列)"
```

---

### Task 2: EF 实体 + DbSet + 泛型 CRUD 注册

**Files:** Create `src/ErpApi/Data/Entities/塑胶共用物料表.cs`; Modify `ErpDbContext.cs`, `Features/MasterData/Controllers.cs`

- [ ] **Step 1: 写实体**

`src/ErpApi/Data/Entities/塑胶共用物料表.cs`:
```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("塑胶共用物料表")]
public sealed class 塑胶共用物料表 : MasterEntity
{
    [Column("客户")] public string? 客户 { get; set; }
    [Column("塑胶货号")] public string? 塑胶货号 { get; set; }
    [Column("工模编号")] public string? 工模编号 { get; set; }
    [Column("物料名称")] public string? 物料名称 { get; set; }
    [Column("颜色")] public string? 颜色 { get; set; }
    [Column("色粉号")] public string? 色粉号 { get; set; }
    [Column("用料名称")] public string? 用料名称 { get; set; }
    [Column("加工内容")] public string? 加工内容 { get; set; }
    [Column("加工单价"), PriceField] public decimal? 加工单价 { get; set; }
    [Column("整啤净重")] public decimal? 整啤净重 { get; set; }
    [Column("原胶件单净重")] public decimal? 原胶件单净重 { get; set; }
    [Column("整啤模腔数")] public decimal? 整啤模腔数 { get; set; }
    [Column("套数")] public decimal? 套数 { get; set; }
    [Column("用量")] public decimal? 用量 { get; set; }
    [Column("物料编号")] public string? 物料编号 { get; set; }
    [Column("共用原料编号")] public string? 共用原料编号 { get; set; }
    [Column("调整审核")] public string? 调整审核 { get; set; }
    [Column("备注内容")] public string? 备注内容 { get; set; }
    [Column("工模表备注")] public string? 工模表备注 { get; set; }
}
```

- [ ] **Step 2: 注册 DbSet**

`src/ErpApi/Data/ErpDbContext.cs` —— 在 `public DbSet<塑胶物料资料> 塑胶物料资料 => Set<塑胶物料资料>();` 之后加:
```csharp
    public DbSet<塑胶共用物料表> 塑胶共用物料表 => Set<塑胶共用物料表>();
```

- [ ] **Step 3: 注册泛型 CRUD 控制器**

`src/ErpApi/Features/MasterData/Controllers.cs` —— 在 `PlasticMaterialController`(P0 加的那段,`[Route("api/master/plastic-materials")]`)之后加:
```csharp
[Route("api/master/plastic-common-materials")]
public sealed class PlasticCommonMaterialController(
    MasterCrudService<塑胶共用物料表> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<塑胶共用物料表>(s, p, a, f)
{ protected override string Menu => "塑胶共用物料表"; protected override string TableName => "塑胶共用物料表"; }
```
注:`using ErpApi.Data.Entities;` 已在文件顶部(P0 已确认),无需补。

- [ ] **Step 4: 编译**

```bash
taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet build src/ErpApi/ErpApi.csproj -nologo -clp:ErrorsOnly 2>&1 | tail -6
```
Expected: 0 错误(仅 MSB3027/MSB3021 exe 锁错误则重跑 taskkill+build 确认 C# 已编过)。

- [ ] **Step 5: Commit**

```bash
git add src/ErpApi/Data/Entities/塑胶共用物料表.cs src/ErpApi/Data/ErpDbContext.cs src/ErpApi/Features/MasterData/Controllers.cs
git commit -m "feat(塑胶共用物料表): EF实体+DbSet+泛型CRUD控制器"
```

---

### Task 3: 过滤列表只读服务 · TDD

**Files:** Create `PlasticCommonMaterialDtos.cs`, `PlasticCommonMaterialService.cs`; Test `tests/ErpApi.Tests/PlasticCommonMaterialDbTests.cs`

- [ ] **Step 1: 写 DTO**

`src/ErpApi/Features/Plastics/PlasticCommonMaterial/PlasticCommonMaterialDtos.cs`:
```csharp
namespace ErpApi.Features.Plastics.PlasticCommonMaterial;

// 塑胶共用物料表·行(全列;加工单价按权限脱敏)
public sealed class PlasticCommonMaterialRow
{
    public long ID { get; set; }
    public string? 客户 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 色粉号 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 加工内容 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 整啤净重 { get; set; }
    public decimal? 原胶件单净重 { get; set; }
    public decimal? 整啤模腔数 { get; set; }
    public decimal? 套数 { get; set; }
    public decimal? 用量 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 共用原料编号 { get; set; }
    public string? 调整审核 { get; set; }
    public string? 备注内容 { get; set; }
    public string? 工模表备注 { get; set; }
}
```

- [ ] **Step 2: 写失败测试**

`tests/ErpApi.Tests/PlasticCommonMaterialDbTests.cs`:
```csharp
using Dapper;
using ErpApi.Features.Plastics.PlasticCommonMaterial;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticCommonMaterialDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticCommonMaterialService Svc() => new(Factory());

    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute(@"INSERT INTO [塑胶共用物料表]([客户],[塑胶货号],[工模编号],[物料名称],[颜色],[用料名称],[加工单价],[用量],[物料编号],[调整审核])
            VALUES(N'TONY',N'PG001',N'M01',N'黑色车头壳',N'黑色',N'ABS',5,1.5,N'PM001',N'1'),
                  (N'TONY',N'PG001',N'M02',N'后壳',N'白色',N'ABS',6,2.0,N'PM002',N'0'),
                  (N'KING',N'PG002',N'M01',N'面壳',N'红色',N'PP',4,1.0,N'PM003',N'1')");
    }
    private static void Cleanup(SqlConnection c)
        => c.Execute("DELETE FROM [塑胶共用物料表] WHERE [物料编号] IN (N'PM001',N'PM002',N'PM003')");

    [SkippableFact]
    public async Task List_filters_by_塑胶货号()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var page = await Svc().ListAsync(null, "PG001", null, null, null, 1, 20);
            Assert.Equal(2, page.Total);
            Assert.All(page.Items, r => Assert.Equal("PG001", r.塑胶货号));
            Assert.Contains(page.Items, r => r.物料编号 == "PM001" && r.工模编号 == "M01" && r.用量 == 1.5m);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_filters_by_客户_and_keyword()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var byCust = await Svc().ListAsync("KING", null, null, null, null, 1, 20);
            Assert.Equal("PG002", Assert.Single(byCust.Items).塑胶货号);
            var byKw = await Svc().ListAsync(null, null, null, "面壳", null, 1, 20);
            Assert.Equal("PM003", Assert.Single(byKw.Items).物料编号);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_filters_by_审核情况()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var approved = await Svc().ListAsync(null, "PG001", null, null, "已审核", 1, 20);
            Assert.Equal("PM001", Assert.Single(approved.Items).物料编号);
            var unapproved = await Svc().ListAsync(null, "PG001", null, null, "未审核", 1, 20);
            Assert.Equal("PM002", Assert.Single(unapproved.Items).物料编号);
        }
        finally { Cleanup(c); }
    }
}
```

- [ ] **Step 3: 运行测试,确认失败(服务未定义)**

```bash
taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticCommonMaterialDbTests" -nologo 2>&1 | tail -8
```
Expected: 编译失败,`PlasticCommonMaterialService` 未定义。

- [ ] **Step 4: 写服务**

`src/ErpApi/Features/Plastics/PlasticCommonMaterial/PlasticCommonMaterialService.cs`:
```csharp
using Dapper;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticCommonMaterial;

// 塑胶共用物料表过滤列表只读。增删改复用 PlasticCommonMaterialController(/api/master/plastic-common-materials)。
public sealed class PlasticCommonMaterialService(ISqlConnectionFactory factory)
{
    public async Task<PagedResult<PlasticCommonMaterialRow>> ListAsync(
        string? 客户, string? 塑胶货号, string? 工模编号, string? keyword, string? 审核情况, int page, int size)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var cust = string.IsNullOrWhiteSpace(客户) ? null : 客户.Trim();
        var goods = string.IsNullOrWhiteSpace(塑胶货号) ? null : 塑胶货号.Trim();
        var mold = string.IsNullOrWhiteSpace(工模编号) ? null : 工模编号.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync($@"
SELECT COUNT(*) FROM [塑胶共用物料表]
WHERE (@cust IS NULL OR [客户] = @cust)
  AND (@goods IS NULL OR [塑胶货号] = @goods)
  AND (@mold IS NULL OR [工模编号] = @mold)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [用料名称] LIKE @kw OR [共用原料编号] LIKE @kw){ApprovalFilter(审核情况)};
SELECT [ID],[客户],[塑胶货号],[工模编号],[物料名称],[颜色],[色粉号],[用料名称],[加工内容],[加工单价],
       [整啤净重],[原胶件单净重],[整啤模腔数],[套数],[用量],[物料编号],[共用原料编号],[调整审核],[备注内容],[工模表备注]
FROM [塑胶共用物料表]
WHERE (@cust IS NULL OR [客户] = @cust)
  AND (@goods IS NULL OR [塑胶货号] = @goods)
  AND (@mold IS NULL OR [工模编号] = @mold)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [用料名称] LIKE @kw OR [共用原料编号] LIKE @kw){ApprovalFilter(审核情况)}
ORDER BY [塑胶货号],[工模编号],[ID] OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { cust, goods, mold, kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticCommonMaterialRow>()).AsList();
        return new PagedResult<PlasticCommonMaterialRow>(items, total);
    }

    // 审核情况过滤片段(对 调整审核):已审核=‘1’；未审核≠‘1’；其它/空=全部。
    private static string ApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL([调整审核],'0') = '1'",
        "未审核" => " AND ISNULL([调整审核],'0') <> '1'",
        _ => "",
    };
}
```

- [ ] **Step 5: 运行测试,确认通过**

```bash
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticCommonMaterialDbTests" -nologo 2>&1 | tail -6
```
Expected: `已通过! ... 通过: 3`

- [ ] **Step 6: Commit**

```bash
git add src/ErpApi/Features/Plastics/PlasticCommonMaterial/PlasticCommonMaterialDtos.cs src/ErpApi/Features/Plastics/PlasticCommonMaterial/PlasticCommonMaterialService.cs tests/ErpApi.Tests/PlasticCommonMaterialDbTests.cs
git commit -m "feat(塑胶共用物料表): 过滤列表只读服务+DB测试"
```

---

### Task 4: 只读控制器 + DI

**Files:** Create `PlasticCommonMaterialController.cs`; Modify `Program.cs`

- [ ] **Step 1: 写控制器**

`src/ErpApi/Features/Plastics/PlasticCommonMaterial/PlasticCommonMaterialController.cs`:
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticCommonMaterial;

[ApiController]
[Authorize]
[Route("api/plastic-common-materials")]
public sealed class PlasticCommonMaterialController(
    PlasticCommonMaterialService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶共用物料表";
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    [HttpGet]
    public async Task<IActionResult> List(
        string? 客户 = null, string? 塑胶货号 = null, string? 工模编号 = null,
        string? keyword = null, string? 审核情况 = null, int page = 1, int size = 20)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(客户, 塑胶货号, 工模编号, keyword, 审核情况, page, size);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in result.Items) r.加工单价 = null;
        return Ok(result);
    }
}
```

- [ ] **Step 2: 注册 DI**

`src/ErpApi/Program.cs` —— 在 `builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticMaterialMaster.PlasticMaterialMasterService>();`(P0 加的那行)之后加:
```csharp
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticCommonMaterial.PlasticCommonMaterialService>();
```

- [ ] **Step 3: 编译**

```bash
taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet build src/ErpApi/ErpApi.csproj -nologo -clp:ErrorsOnly 2>&1 | tail -5
```
Expected: 0 错误。

- [ ] **Step 4: Commit**

```bash
git add src/ErpApi/Features/Plastics/PlasticCommonMaterial/PlasticCommonMaterialController.cs src/ErpApi/Program.cs
git commit -m "feat(塑胶共用物料表): 只读REST控制器+DI"
```

---

### Task 5: 菜单目录 + 权限种子

**Files:** Modify `MenuCatalog.cs`; Create `db/seed_plastic_common_perms.sql`

- [ ] **Step 1: MenuCatalog 加菜单项**

`src/ErpApi/Features/Admin/MenuCatalog.cs` —— 在 P0 加的 `new("塑胶仓储","塑胶物料资料"),` 之后加:
```csharp
        new("塑胶仓储","塑胶共用物料表"),
```

- [ ] **Step 2: 写权限种子**

`db/seed_plastic_common_perms.sql`:
```sql
-- 开发用:给某用户授予 塑胶共用物料表 菜单的 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'塑胶共用物料表');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'塑胶共用物料表',1,1,1,1,1,1,1,1,1);
```

- [ ] **Step 3: 执行种子**

```bash
cd /d/WebpageERP
powershell -NoProfile -Command "\$c=New-Object System.Data.SqlClient.SqlConnection \$env:ERP_DB; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=[IO.File]::ReadAllText('db/seed_plastic_common_perms.sql'); \$null=\$cmd.ExecuteNonQuery(); \$c.Close(); Write-Output 'perms seeded'"
```
Expected: `perms seeded`

- [ ] **Step 4: 编译**

```bash
taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet build src/ErpApi/ErpApi.csproj -nologo -clp:ErrorsOnly 2>&1 | tail -4
```
Expected: 0 错误。

- [ ] **Step 5: Commit**

```bash
git add src/ErpApi/Features/Admin/MenuCatalog.cs db/seed_plastic_common_perms.sql
git commit -m "feat(塑胶共用物料表): MenuCatalog菜单项+权限种子"
```

---

### Task 6: 前端 API + 选择器 + 页面 + 路由 + 菜单

**Files:** Create `web/src/api/plasticCommonMaterial.ts`, `web/src/pages/plastics/PlasticMaterialPicker.tsx`, `web/src/pages/plastics/PlasticCommonMaterialPage.tsx`; Modify `App.tsx`, `menuTree.tsx`

- [ ] **Step 1: 写前端 API**

`web/src/api/plasticCommonMaterial.ts`:
```typescript
import { api } from "./client";
import type { Paged } from "./master";

export interface PlasticCommonMaterialRow {
  ID: number;
  客户?: string;
  塑胶货号?: string;
  工模编号?: string;
  物料名称?: string;
  颜色?: string;
  色粉号?: string;
  用料名称?: string;
  加工内容?: string;
  加工单价?: number | null;
  整啤净重?: number | null;
  原胶件单净重?: number | null;
  整啤模腔数?: number | null;
  套数?: number | null;
  用量?: number | null;
  物料编号?: string;
  共用原料编号?: string;
  调整审核?: string;
  备注内容?: string;
  工模表备注?: string;
}

export interface PlasticCommonQuery {
  客户?: string; 塑胶货号?: string; 工模编号?: string; keyword?: string; 审核情况?: string; page?: number; size?: number;
}

export const plasticCommonMaterialApi = {
  list: (q: PlasticCommonQuery) =>
    api.get<Paged<PlasticCommonMaterialRow>>("/plastic-common-materials", { params: q }).then(r => r.data),
};
```

- [ ] **Step 2: 写塑胶物料选择器(克隆 MaterialPicker 换 P0 数据源)**

`web/src/pages/plastics/PlasticMaterialPicker.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { Input, message, Modal, Table } from "antd";
import { plasticMaterialMasterApi, type PlasticMaterialRow } from "../../api/plasticMaterialMaster";

// 塑胶物料选择器:可搜索 P0 塑胶物料资料,点行返回该物料。
export default function PlasticMaterialPicker({ open, onPick, onClose }: {
  open: boolean;
  onPick: (row: PlasticMaterialRow) => void;
  onClose: () => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<PlasticMaterialRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const r = await plasticMaterialMasterApi.list(undefined, keyword.trim() || undefined, p, 50);
      setRows(r.items); setTotal(r.total);
    } catch { message.error("加载塑胶物料列表失败"); }
    finally { setLoading(false); }
  }, [keyword]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setPage(1); load(1); } }, [open]);
  useEffect(() => { if (!open) { setKeyword(""); setPage(1); setRows([]); } }, [open]);

  const search = () => { setPage(1); load(1); };

  const columns = [
    { title: "物料编号", dataIndex: "物料编号", width: 120 },
    { title: "物料名称", dataIndex: "物料名称", width: 150 },
    { title: "规格", dataIndex: "规格", width: 110 },
    { title: "颜色", dataIndex: "颜色", width: 80 },
    { title: "仓位号", dataIndex: "仓位号", width: 90 },
    { title: "单位", dataIndex: "单位", width: 60 },
  ];

  return (
    <Modal title="选择塑胶物料" open={open} onCancel={onClose} footer={null} width={820}>
      <div style={{ marginBottom: 12 }}>
        <Input.Search
          placeholder="物料编号/名称/规格/颜色" allowClear style={{ width: 280 }}
          value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={search}
        />
      </div>
      <Table
        size="small" rowKey="ID" loading={loading} dataSource={rows} columns={columns} scroll={{ x: true, y: 380 }}
        pagination={{ current: page, pageSize: 50, total, showSizeChanger: false,
          onChange: p => { setPage(p); load(p); }, showTotal: t => `共 ${t} 条` }}
        onRow={r => ({ onClick: () => { onPick(r); onClose(); }, style: { cursor: "pointer" } })}
      />
    </Modal>
  );
}
```

- [ ] **Step 3: 写页面**

`web/src/pages/plastics/PlasticCommonMaterialPage.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import {
  Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, message,
} from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { plasticCommonMaterialApi, type PlasticCommonMaterialRow } from "../../api/plasticCommonMaterial";
import { masterApi } from "../../api/master";
import { can, hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import PlasticMaterialPicker from "./PlasticMaterialPicker";

const MENU = "塑胶共用物料表";
const ALL_APPROVAL = "全部";
const crud = masterApi("plastic-common-materials");

export default function PlasticCommonMaterialPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const canSave = can(perms, MENU, "保存");
  const canDelete = can(perms, MENU, "删除");
  const priceHidden = hidePrice(perms, MENU);
  const money = (v?: number | null) => (priceHidden ? "***" : (v ?? ""));

  const [客户, set客户] = useState("");
  const [塑胶货号, set塑胶货号] = useState("");
  const [工模编号, set工模编号] = useState("");
  const [keyword, setKeyword] = useState("");
  const [审核情况, set审核情况] = useState(ALL_APPROVAL);

  const [rows, setRows] = useState<PlasticCommonMaterialRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState<PlasticCommonMaterialRow | null>(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const loadRows = useCallback(async (p: number) => {
    if (!canOpen) return;
    setLoading(true);
    try {
      const r = await plasticCommonMaterialApi.list({
        客户: 客户.trim() || undefined,
        塑胶货号: 塑胶货号.trim() || undefined,
        工模编号: 工模编号.trim() || undefined,
        keyword: keyword.trim() || undefined,
        审核情况: 审核情况 === ALL_APPROVAL ? undefined : 审核情况,
        page: p, size: 50,
      });
      setRows(r.items); setTotal(r.total);
    } catch { message.error("加载塑胶共用物料失败"); }
    finally { setLoading(false); }
  }, [canOpen, 客户, 塑胶货号, 工模编号, keyword, 审核情况]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadRows(1); setPage(1); }, [canOpen]);

  const search = () => { setPage(1); loadRows(1); };

  const openCreate = () => {
    const init = { ID: 0, 塑胶货号: 塑胶货号.trim() || undefined, 客户: 客户.trim() || undefined } as PlasticCommonMaterialRow;
    setEditing(init); form.resetFields(); form.setFieldsValue(init);
  };
  const openEdit = async (r: PlasticCommonMaterialRow) => {
    try {
      const full = await crud.get(r.ID) as Record<string, unknown>;
      setEditing(r); form.resetFields(); form.setFieldsValue(full);
    } catch { message.error("加载详情失败"); }
  };

  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      if (editing && editing.ID > 0) await crud.update(editing.ID, v);
      else await crud.create(v);
      message.success("已保存"); setEditing(null); await loadRows(page);
    } catch { message.error("保存失败"); }
    finally { setSaving(false); }
  };

  const del = async (r: PlasticCommonMaterialRow) => {
    try { await crud.remove(r.ID); message.success("已删除"); await loadRows(page); }
    catch { message.error("删除失败"); }
  };

  const columns = [
    { title: "客户", dataIndex: "客户", width: 90 },
    { title: "塑胶货号", dataIndex: "塑胶货号", width: 110 },
    { title: "工模编号", dataIndex: "工模编号", width: 90 },
    { title: "物料名称", dataIndex: "物料名称", width: 140 },
    { title: "颜色", dataIndex: "颜色", width: 70 },
    { title: "色粉号", dataIndex: "色粉号", width: 90 },
    { title: "用料名称", dataIndex: "用料名称", width: 110 },
    { title: "加工内容", dataIndex: "加工内容", width: 110 },
    { title: "加工单价", dataIndex: "加工单价", width: 90, align: "right" as const, render: money },
    { title: "整啤净重", dataIndex: "整啤净重", width: 90, align: "right" as const, render: (v?: number | null) => v ?? "" },
    { title: "原胶件单净重", dataIndex: "原胶件单净重", width: 110, align: "right" as const, render: (v?: number | null) => v ?? "" },
    { title: "整啤模腔数", dataIndex: "整啤模腔数", width: 100, align: "right" as const, render: (v?: number | null) => v ?? "" },
    { title: "套数", dataIndex: "套数", width: 70, align: "right" as const, render: (v?: number | null) => v ?? "" },
    { title: "用量", dataIndex: "用量", width: 80, align: "right" as const, render: (v?: number | null) => v ?? "" },
    { title: "物料编号", dataIndex: "物料编号", width: 110 },
    { title: "共用原料编号", dataIndex: "共用原料编号", width: 110 },
    { title: "审核", dataIndex: "调整审核", width: 70, render: (v?: string) => (v === "1" ? "已审核" : "未审核") },
    { title: "备注内容", dataIndex: "备注内容", width: 140 },
    {
      title: "操作", width: 100, fixed: "right" as const,
      render: (_: unknown, r: PlasticCommonMaterialRow) => (
        <Space size="small">
          {canSave && <a onClick={() => openEdit(r)}><EditOutlined /></a>}
          {canDelete && (
            <Popconfirm title="确认删除该行?" onConfirm={() => del(r)}>
              <a style={{ color: "#cf1322" }}><DeleteOutlined /></a>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  if (!canOpen) {
    return (
      <Card variant="borderless">
        <div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"塑胶共用物料表·打开"权限）。</div>
      </Card>
    );
  }

  return (
    <Card title="塑胶共用物料表" variant="borderless">
      <Space style={{ marginBottom: 12 }} wrap>
        <Input placeholder="客户" allowClear value={客户} onChange={e => set客户(e.target.value)} style={{ width: 120 }} />
        <Input placeholder="塑胶货号" allowClear value={塑胶货号} onChange={e => set塑胶货号(e.target.value)} style={{ width: 130 }} />
        <Input placeholder="工模编号" allowClear value={工模编号} onChange={e => set工模编号(e.target.value)} style={{ width: 120 }} />
        <Input.Search placeholder="物料编号/名称/用料/共用原料" allowClear style={{ width: 240 }}
          value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={search} />
        <Select value={审核情况} onChange={set审核情况} style={{ width: 110 }}
          options={[ALL_APPROVAL, "已审核", "未审核"].map(v => ({ value: v, label: v }))} />
        <Button type="primary" onClick={search}>查询</Button>
        {canSave && <Button icon={<PlusOutlined />} onClick={openCreate}>新增</Button>}
      </Space>
      <Table
        size="small" rowKey="ID" loading={loading} dataSource={rows} columns={columns}
        scroll={{ x: "max-content" }}
        pagination={{ current: page, pageSize: 50, total, showSizeChanger: false,
          onChange: p => { setPage(p); loadRows(p); }, showTotal: t => `共 ${t} 条` }}
      />

      <Modal
        title={editing && editing.ID > 0 ? "编辑共用物料" : "新增共用物料"}
        open={!!editing} onCancel={() => setEditing(null)} onOk={submit}
        confirmLoading={saving} destroyOnClose width={640}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="客户" label="客户"><Input /></Form.Item>
          <Form.Item name="塑胶货号" label="塑胶货号" rules={[{ required: true, message: "请输入塑胶货号" }]}><Input /></Form.Item>
          <Form.Item name="工模编号" label="工模编号"><Input /></Form.Item>
          <Form.Item name="物料编号" label="物料编号(选料回填名称/颜色)">
            <Input readOnly addonAfter={<a onClick={() => setPickerOpen(true)}>选料</a>} />
          </Form.Item>
          <Form.Item name="物料名称" label="物料名称"><Input /></Form.Item>
          <Form.Item name="颜色" label="颜色"><Input /></Form.Item>
          <Form.Item name="色粉号" label="色粉号"><Input /></Form.Item>
          <Form.Item name="用料名称" label="用料名称"><Input /></Form.Item>
          <Form.Item name="加工内容" label="加工内容"><Input /></Form.Item>
          {!priceHidden && (
            <Form.Item name="加工单价" label="加工单价"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
          )}
          <Form.Item name="整啤净重" label="整啤净重"><InputNumber style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="原胶件单净重" label="原胶件单净重"><InputNumber style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="整啤模腔数" label="整啤模腔数"><InputNumber style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="套数" label="套数"><InputNumber style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="用量" label="用量"><InputNumber style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="共用原料编号" label="共用原料编号"><Input /></Form.Item>
          <Form.Item name="备注内容" label="备注内容"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="工模表备注" label="工模表备注"><Input /></Form.Item>
          <Form.Item name="调整审核" hidden><Input /></Form.Item>
        </Form>
      </Modal>

      <PlasticMaterialPicker
        open={pickerOpen} onClose={() => setPickerOpen(false)}
        onPick={r => form.setFieldsValue({ 物料编号: r.物料编号, 物料名称: r.物料名称, 颜色: r.颜色 })}
      />
    </Card>
  );
}
```

- [ ] **Step 4: 路由 + 菜单**

`web/src/App.tsx` —— import 区加:
```tsx
import PlasticCommonMaterialPage from "./pages/plastics/PlasticCommonMaterialPage";
```
路由区(P0 的 `plastic-material-master` 路由旁)加:
```tsx
          <Route path="plastic-common-materials" element={<PlasticCommonMaterialPage />} />
```
`web/src/nav/menuTree.tsx` —— ⑧塑胶仓库把 `M("塑胶共用物料表")` 改为:
```tsx
    M("塑胶共用物料表", "/plastic-common-materials", "塑胶共用物料表"),
```

- [ ] **Step 5: 类型检查 + 测试**

```bash
cd /d/WebpageERP/web && npx tsc --noEmit 2>&1 | head -20 && echo "=== test ===" && npm test 2>&1 | tail -6
```
Expected: tsc 无输出;vitest 54 全过(无回归)。修 YOUR 新文件里的 tsc 报错;无关既有报错只报告不动。

- [ ] **Step 6: Commit**

```bash
cd /d/WebpageERP
git add web/src/api/plasticCommonMaterial.ts web/src/pages/plastics/PlasticMaterialPicker.tsx web/src/pages/plastics/PlasticCommonMaterialPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m "feat(塑胶共用物料表): 前端筛选列表+CRUD+塑胶物料选择器+路由+菜单"
```

---

### Task 7: 全量验证 + 冒烟 + 收尾

- [ ] **Step 1: 后端全量测试**

```bash
taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj -nologo 2>&1 | tail -6
```
Expected: 全过(332 + 新增 3 = 335,无回归)。

- [ ] **Step 2: 启动后端 + 冒烟**

```bash
cd /d/WebpageERP
nohup dotnet run --project src/ErpApi/ErpApi.csproj --no-build > /tmp/be_p1.log 2>&1 &
sleep 9
echo '{"用户":"admin","密码":"admin123"}' > /tmp/login.json
TOK=$(curl -s --noproxy '*' -X POST http://localhost:5000/api/auth/login -H "Content-Type: application/json" --data @/tmp/login.json | python -c "import sys,json; d=json.load(sys.stdin); print(next(v for v in d.values() if isinstance(v,str) and v.startswith('eyJ')))")
echo "=== list ==="; curl -s --noproxy '*' "http://localhost:5000/api/plastic-common-materials" -H "Authorization: Bearer $TOK" -w "\nHTTP %{http_code}\n" | head -c 200
echo "=== create ==="; echo '{"客户":"TONY","塑胶货号":"PGSMOKE","工模编号":"M1","物料编号":"PM001","物料名称":"测试料","颜色":"黑","加工单价":5,"用量":1.5,"调整审核":"0"}' > /tmp/pc.json
curl -s --noproxy '*' -X POST "http://localhost:5000/api/master/plastic-common-materials" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" --data @/tmp/pc.json -w "\nHTTP %{http_code}\n" | head -c 300
echo ""; echo "=== list by 塑胶货号 ==="; curl -s --noproxy '*' "http://localhost:5000/api/plastic-common-materials?塑胶货号=PGSMOKE" -H "Authorization: Bearer $TOK" -w "\nHTTP %{http_code}\n" | head -c 300
```
Expected: list 200;create 201(返回含 塑胶货号/用量);按货号 list 200 返回该行(注:中文 query 参数名需 UTF-8 编码,curl `--data-urlencode` 对中文参数名有怪癖,如遇 400 属 curl 编码问题非 bug,可用 `keyword=PM001` 验证过滤)。

- [ ] **Step 3: 清理冒烟数据**

```bash
powershell -NoProfile -Command "\$c=New-Object System.Data.SqlClient.SqlConnection \$env:ERP_DB; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=\"DELETE FROM [塑胶共用物料表] WHERE [塑胶货号]=N'PGSMOKE'\"; \$null=\$cmd.ExecuteNonQuery(); \$c.Close(); Write-Output 'cleaned'"
```
Expected: `cleaned`

- [ ] **Step 4: 前端 lint 新文件**

```bash
cd /d/WebpageERP/web && npx eslint src/pages/plastics/PlasticCommonMaterialPage.tsx src/pages/plastics/PlasticMaterialPicker.tsx src/api/plasticCommonMaterial.ts 2>&1 | tail -15
```
Expected:仅 `react-hooks/set-state-in-effect`/`exhaustive-deps` 类与克隆源相同的基线惯例,无新类型错误。

- [ ] **Step 5: 合并 master**

```bash
cd /d/WebpageERP
git checkout master
git merge --no-ff feat-plastic-common-materials -m "Merge branch 'feat-plastic-common-materials' into master"
git log --oneline -2
git branch -d feat-plastic-common-materials
```
Expected: 合并成功,分支删除。

- [ ] **Step 6: worklog + 记忆**

写 `docs/worklogs/2026-06-25-plastic-common-materials.md`;更新 `erp-plastic-module-p0-0625.md`(标 P1 完成)+ `MEMORY.md` 索引。

---

## 自检

**Spec 覆盖:** ① 数据模型→Task1+2;② 后端增删改→Task2,过滤列表→Task3+4,权限→Task5;③ 前端列表+选择器→Task6;④ 测试→Task3+Task7;⑤ 验收 1-4→Task7 冒烟。无遗漏。

**占位扫描:** 无 TBD;每个写代码步骤都给完整代码;db/16 序号已定;DI/DbSet/MenuCatalog/菜单 锚点都具体。

**类型一致:** 服务 `ListAsync(客户,塑胶货号,工模编号,keyword,审核情况,page,size)` Task3 定义、Task4 控制器调用一致;后端 `PlasticCommonMaterialRow` 与前端 `PlasticCommonMaterialRow` 字段一致(19列);菜单名/权限名/控制器 `Menu` 三处统一 `塑胶共用物料表`;CRUD 路由 `api/master/plastic-common-materials` ↔ 前端 `masterApi("plastic-common-materials")` 一致;选择器 `onPick` 回填 物料编号/物料名称/颜色 用 `form.setFieldsValue`。
