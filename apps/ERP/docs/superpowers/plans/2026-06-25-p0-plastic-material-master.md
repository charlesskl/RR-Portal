# 塑胶物料资料(P0 地基) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为塑胶独立模块建第一块地基——`塑胶物料资料` 主数据表 + 增删改 + 左分类树/右分页表只读查询页。

**Architecture:** 镜像物料侧 `物料资料`(`物料资料` 实体 + 泛型 `MasterCrudController<T>` + `MaterialMaster` 只读服务/页),换独立表 `塑胶物料资料`(= `物料资料` 字段 + `仓位号`)。增删改白嫖现有泛型 CRUD(EF),只读左树右表新写一个镜像服务/控制器/页。价格按 `单价` 权限脱敏。

**Tech Stack:** .NET 8 / EF Core / Dapper(只读)/ ASP.NET Controllers · React + TypeScript + Ant Design · SQL Server。

**设计依据:** `docs/superpowers/specs/2026-06-25-p0-plastic-material-master-design.md`

---

## 文件结构

| 文件 | 职责 | 新建/改 |
|---|---|---|
| `db/15_plastic_material_master.sql` | `塑胶物料资料` 建表 DDL | 新建 |
| `db/seed_plastic_perms.sql` | 给 admin 授「塑胶物料资料」9 位权限 | 新建 |
| `src/ErpApi/Data/Entities/塑胶物料资料.cs` | EF 实体(CRUD 用) | 新建 |
| `src/ErpApi/Data/ErpDbContext.cs` | 注册 `DbSet<塑胶物料资料>` | 改 |
| `src/ErpApi/Features/MasterData/Controllers.cs` | 注册 `PlasticMaterialController`(泛型 CRUD) | 改 |
| `src/ErpApi/Features/Plastics/PlasticMaterialMaster/PlasticMaterialMasterDtos.cs` | 只读 DTO(分类节点 + 行) | 新建 |
| `src/ErpApi/Features/Plastics/PlasticMaterialMaster/PlasticMaterialMasterService.cs` | 左树 + 右表只读查询(Dapper) | 新建 |
| `src/ErpApi/Features/Plastics/PlasticMaterialMaster/PlasticMaterialMasterController.cs` | 只读 REST + 价格脱敏 | 新建 |
| `src/ErpApi/Program.cs` | 注册 `PlasticMaterialMasterService` | 改 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加菜单项 `塑胶物料资料` | 改 |
| `tests/ErpApi.Tests/PlasticMaterialMasterDbTests.cs` | 只读服务 DB 测试 | 新建 |
| `web/src/api/plasticMaterialMaster.ts` | 前端 API + 类型 | 新建 |
| `web/src/pages/plastics/PlasticMaterialMasterPage.tsx` | 左树右表 CRUD 页 | 新建 |
| `web/src/App.tsx` | 路由 `/plastic-material-master` | 改 |
| `web/src/nav/menuTree.tsx` | ⑧塑胶仓库「塑胶物料资料」落地 | 改 |

---

### Task 1: 建表脚本 + 执行

**Files:**
- Create: `db/15_plastic_material_master.sql`

- [ ] **Step 0: 建特性分支**

Run:
```bash
cd /d/WebpageERP && git checkout master && git checkout -b feat-plastic-material-master
```
Expected: `Switched to a new branch 'feat-plastic-material-master'`

- [ ] **Step 1: 写建表脚本**

`db/15_plastic_material_master.sql`:
```sql
-- 塑胶模块 P0 地基:塑胶物料资料主数据表(镜像 物料资料 + 仓位号)
IF OBJECT_ID(N'[塑胶物料资料]', N'U') IS NULL
CREATE TABLE [塑胶物料资料] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [物料类别] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [规格] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(20) NULL,
    [仓位号] nvarchar(30) NULL,
    [单价] decimal(18,4) NULL,
    [销售价] decimal(18,4) NULL,
    [库存] decimal(18,4) NULL,
    [最低库存] decimal(18,4) NULL,
    [最高库存] decimal(18,4) NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(50) NULL,
    [款号] nvarchar(40) NULL,
    [货币] nvarchar(20) NULL,
    [备注] nvarchar(max) NULL
);
```

- [ ] **Step 2: 在两个库执行(测试库 + 开发库)**

Run(Git Bash):
```bash
cd /d/WebpageERP
for V in ERP_TEST_DB ERP_DB; do \
  powershell -NoProfile -Command "\$cs=\$env:$V; \$c=New-Object System.Data.SqlClient.SqlConnection \$cs; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=[IO.File]::ReadAllText('db/15_plastic_material_master.sql'); \$null=\$cmd.ExecuteNonQuery(); \$c.Close(); Write-Output '$V ok'"; \
done
```
Expected: 输出 `ERP_TEST_DB ok` 和 `ERP_DB ok`。

- [ ] **Step 3: 验证表存在**

Run:
```bash
powershell -NoProfile -Command "\$c=New-Object System.Data.SqlClient.SqlConnection \$env:ERP_TEST_DB; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=\"SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME=N'塑胶物料资料'\"; \$cmd.ExecuteScalar(); \$c.Close()"
```
Expected: `1`

- [ ] **Step 4: Commit**

```bash
git add db/15_plastic_material_master.sql
git commit -m "feat(塑胶物料资料): 建表脚本(镜像物料资料+仓位号)"
```

---

### Task 2: EF 实体 + DbContext + 泛型 CRUD 注册

**Files:**
- Create: `src/ErpApi/Data/Entities/塑胶物料资料.cs`
- Modify: `src/ErpApi/Data/ErpDbContext.cs`(DbSet 区)
- Modify: `src/ErpApi/Features/MasterData/Controllers.cs`(末尾加控制器)

- [ ] **Step 1: 写实体**

`src/ErpApi/Data/Entities/塑胶物料资料.cs`:
```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("塑胶物料资料")]
public sealed class 塑胶物料资料 : MasterEntity
{
    [Column("物料类别")] public string? 物料类别 { get; set; }
    [Column("物料编号")] public string? 物料编号 { get; set; }
    [Column("物料名称")] public string? 物料名称 { get; set; }
    [Column("规格")] public string? 规格 { get; set; }
    [Column("颜色")] public string? 颜色 { get; set; }
    [Column("单位")] public string? 单位 { get; set; }
    [Column("仓位号")] public string? 仓位号 { get; set; }
    [Column("单价"), PriceField] public decimal? 单价 { get; set; }
    [Column("销售价"), PriceField] public decimal? 销售价 { get; set; }
    [Column("供应商编号")] public string? 供应商编号 { get; set; }
    [Column("款号")] public string? 款号 { get; set; }
    [Column("货币")] public string? 货币 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
```
注:`库存/最低库存/最高库存/供应商名称` 故意不映射(只读展示列,与 `物料资料.cs` 一致);`PriceFieldAttribute` 与 `物料资料.cs` 同命名空间 `ErpApi.Data.Entities`,无需 using。

- [ ] **Step 2: 注册 DbSet**

`src/ErpApi/Data/ErpDbContext.cs` —— 在 `public DbSet<物料资料> 物料资料 => Set<物料资料>();`(第 14 行)之后加一行:
```csharp
    public DbSet<塑胶物料资料> 塑胶物料资料 => Set<塑胶物料资料>();
```

- [ ] **Step 3: 注册泛型 CRUD 控制器**

`src/ErpApi/Features/MasterData/Controllers.cs` —— 在 `MaterialController`(`[Route("api/master/materials")]` 那段,约第 55-59 行)之后加:
```csharp
[Route("api/master/plastic-materials")]
public sealed class PlasticMaterialController(
    MasterCrudService<塑胶物料资料> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<塑胶物料资料>(s, p, a, f)
{ protected override string Menu => "塑胶物料资料"; protected override string TableName => "塑胶物料资料"; }
```
注:`Controllers.cs` 顶部已 `using ErpApi.Data.Entities;`(因 `MaterialController` 用到 `物料资料`),无需补 using;`MasterCrudService<>` 已在 `Program.cs:23` 泛型注册,无需额外 DI。

- [ ] **Step 4: 编译**

先停后端避免文件锁:
```bash
taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet build src/ErpApi/ErpApi.csproj -nologo -clp:ErrorsOnly 2>&1 | tail -5
```
Expected: `生成成功` 或仅警告,0 错误。

- [ ] **Step 5: Commit**

```bash
git add src/ErpApi/Data/Entities/塑胶物料资料.cs src/ErpApi/Data/ErpDbContext.cs src/ErpApi/Features/MasterData/Controllers.cs
git commit -m "feat(塑胶物料资料): EF实体+DbSet+泛型CRUD控制器"
```

---

### Task 3: 只读服务(左树 + 右表) · TDD

**Files:**
- Create: `src/ErpApi/Features/Plastics/PlasticMaterialMaster/PlasticMaterialMasterDtos.cs`
- Create: `src/ErpApi/Features/Plastics/PlasticMaterialMaster/PlasticMaterialMasterService.cs`
- Test: `tests/ErpApi.Tests/PlasticMaterialMasterDbTests.cs`

- [ ] **Step 1: 写 DTO**

`src/ErpApi/Features/Plastics/PlasticMaterialMaster/PlasticMaterialMasterDtos.cs`:
```csharp
namespace ErpApi.Features.Plastics.PlasticMaterialMaster;

// 左树节点:一个物料类别 + 该类塑胶物料数
public sealed class PlasticMaterialCategoryNode
{
    public string? 类别 { get; set; }
    public int 数量 { get; set; }
}

// 右网格行(展示用;库存/最低/最高/供应商名称 为只读列,实体未映射)
public sealed class PlasticMaterialRow
{
    public long ID { get; set; }
    public string? 物料类别 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public string? 仓位号 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 销售价 { get; set; }
    public decimal? 库存 { get; set; }
    public decimal? 最低库存 { get; set; }
    public decimal? 最高库存 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 备注 { get; set; }
}
```

- [ ] **Step 2: 写失败测试**

`tests/ErpApi.Tests/PlasticMaterialMasterDbTests.cs`:
```csharp
using Dapper;
using ErpApi.Features.Plastics.PlasticMaterialMaster;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticMaterialMasterDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticMaterialMasterService Svc() => new(Factory());

    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute(@"INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[规格],[单位],[仓位号],[单价],[销售价],[库存],[最低库存],[供应商名称])
                    VALUES(N'啤料PM',N'PM001',N'ABS粒',N'规X',N'kg',N'A-01',10,15,100,5,N'供A'),
                          (N'啤料PM',N'PM002',N'PP粒',N'规Y',N'kg',N'A-02',12,0,0,0,N'供A'),
                          (N'色种PM',N'PM003',N'黑色种',N'规Z',N'kg',N'B-01',0.5,1,500,50,N'供B'),
                          (NULL,      N'PM999',N'无类别料',N'规W',N'个',NULL,1,2,0,0,N'供C')");
    }
    private static void Cleanup(SqlConnection c)
        => c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号] IN (N'PM001',N'PM002',N'PM003',N'PM999')");

    [SkippableFact]
    public async Task Categories_groups_nonempty_with_counts()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var cats = await Svc().CategoriesAsync();
            Assert.Equal(2, cats.Single(x => x.类别 == "啤料PM").数量);
            Assert.Equal(1, cats.Single(x => x.类别 == "色种PM").数量);
            Assert.DoesNotContain(cats, x => x.类别 is null);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_filters_by_category_and_carries_仓位号()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var page = await Svc().ListAsync("啤料PM", null, 1, 20);
            Assert.Equal(2, page.Total);
            Assert.All(page.Items, r => Assert.Equal("啤料PM", r.物料类别));
            Assert.Contains(page.Items, r => r.物料编号 == "PM001" && r.仓位号 == "A-01" && r.库存 == 100m && r.供应商名称 == "供A");
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_filters_by_keyword_within_all()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var page = await Svc().ListAsync(null, "黑色种", 1, 20);
            Assert.Equal("PM003", Assert.Single(page.Items).物料编号);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_no_filter_returns_all_including_uncategorized()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var page = await Svc().ListAsync(null, null, 1, 200);
            var seeded = page.Items.Where(r => new[] { "PM001", "PM002", "PM003", "PM999" }.Contains(r.物料编号)).ToList();
            Assert.Equal(4, seeded.Count);
            Assert.Contains(seeded, r => r.物料编号 == "PM999" && r.物料类别 is null);
        }
        finally { Cleanup(c); }
    }
}
```

- [ ] **Step 3: 运行测试,确认失败(编译错误:服务不存在)**

Run:
```bash
taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticMaterialMasterDbTests" -nologo 2>&1 | tail -8
```
Expected: 编译失败,`PlasticMaterialMasterService` 未定义。

- [ ] **Step 4: 写服务实现**

`src/ErpApi/Features/Plastics/PlasticMaterialMaster/PlasticMaterialMasterService.cs`:
```csharp
using Dapper;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticMaterialMaster;

// 塑胶物料资料左树 + 右表只读查询。增删改复用 PlasticMaterialController(/api/master/plastic-materials)。
public sealed class PlasticMaterialMasterService(ISqlConnectionFactory factory)
{
    // 左树:实际出现的非空分类 + 该类塑胶物料数
    public async Task<IReadOnlyList<PlasticMaterialCategoryNode>> CategoriesAsync()
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticMaterialCategoryNode>(@"
SELECT [物料类别] AS 类别, COUNT(*) AS 数量
FROM [塑胶物料资料]
WHERE [物料类别] IS NOT NULL AND LTRIM(RTRIM([物料类别])) <> ''
GROUP BY [物料类别]
ORDER BY [物料类别];");
        return rows.AsList();
    }

    // 右表:精确分类(@类别 空=不过滤) + 关键字 过滤分页
    public async Task<PagedResult<PlasticMaterialRow>> ListAsync(string? 类别, string? keyword, int page, int size, bool onlyStock = false)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var cat = string.IsNullOrWhiteSpace(类别) ? null : 类别.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [塑胶物料资料]
WHERE (@cat IS NULL OR [物料类别] = @cat)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [规格] LIKE @kw OR [颜色] LIKE @kw OR [供应商名称] LIKE @kw)
  AND (@onlyStock = 0 OR ISNULL([库存],0) > 0);
SELECT [ID],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[仓位号],[单价],[销售价],[库存],[最低库存],[最高库存],[供应商编号],[供应商名称],[备注]
FROM [塑胶物料资料]
WHERE (@cat IS NULL OR [物料类别] = @cat)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [规格] LIKE @kw OR [颜色] LIKE @kw OR [供应商名称] LIKE @kw)
  AND (@onlyStock = 0 OR ISNULL([库存],0) > 0)
ORDER BY [物料编号] OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { cat, kw, page, size, onlyStock = onlyStock ? 1 : 0 });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticMaterialRow>()).AsList();
        return new PagedResult<PlasticMaterialRow>(items, total);
    }
}
```

- [ ] **Step 5: 运行测试,确认通过**

Run:
```bash
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticMaterialMasterDbTests" -nologo 2>&1 | tail -6
```
Expected: `已通过! ... 通过: 4`

- [ ] **Step 6: Commit**

```bash
git add src/ErpApi/Features/Plastics/PlasticMaterialMaster/PlasticMaterialMasterDtos.cs src/ErpApi/Features/Plastics/PlasticMaterialMaster/PlasticMaterialMasterService.cs tests/ErpApi.Tests/PlasticMaterialMasterDbTests.cs
git commit -m "feat(塑胶物料资料): 左树右表只读服务+DB测试"
```

---

### Task 4: 只读控制器 + DI 注册

**Files:**
- Create: `src/ErpApi/Features/Plastics/PlasticMaterialMaster/PlasticMaterialMasterController.cs`
- Modify: `src/ErpApi/Program.cs`(服务注册区)

- [ ] **Step 1: 写控制器**

`src/ErpApi/Features/Plastics/PlasticMaterialMaster/PlasticMaterialMasterController.cs`:
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticMaterialMaster;

[ApiController]
[Authorize]
[Route("api/plastic-material-master")]
public sealed class PlasticMaterialMasterController(
    PlasticMaterialMasterService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶物料资料";
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    [HttpGet("categories")]
    public async Task<IActionResult> Categories()
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.CategoriesAsync());
    }

    [HttpGet]
    public async Task<IActionResult> List(string? 类别 = null, string? keyword = null, int page = 1, int size = 20, bool onlyStock = false)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(类别, keyword, page, size, onlyStock);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in result.Items) { r.单价 = null; r.销售价 = null; }
        return Ok(result);
    }
}
```

- [ ] **Step 2: 注册服务 DI**

`src/ErpApi/Program.cs` —— 在 `builder.Services.AddScoped<ErpApi.Features.Materials.MaterialMaster.MaterialMasterService>();`(第 45 行)之后加:
```csharp
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticMaterialMaster.PlasticMaterialMasterService>();
```

- [ ] **Step 3: 编译**

Run:
```bash
taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet build src/ErpApi/ErpApi.csproj -nologo -clp:ErrorsOnly 2>&1 | tail -5
```
Expected: 0 错误。

- [ ] **Step 4: Commit**

```bash
git add src/ErpApi/Features/Plastics/PlasticMaterialMaster/PlasticMaterialMasterController.cs src/ErpApi/Program.cs
git commit -m "feat(塑胶物料资料): 只读REST控制器+DI注册"
```

---

### Task 5: 菜单目录 + 权限种子

**Files:**
- Modify: `src/ErpApi/Features/Admin/MenuCatalog.cs`
- Create: `db/seed_plastic_perms.sql`

- [ ] **Step 1: MenuCatalog 加菜单项**

`src/ErpApi/Features/Admin/MenuCatalog.cs` —— 在 `new("系统管理","系统配置"),` 这一行之前(或 `new("管理后台","账号管理"),` 之前任意位置)插入一行新分组:
```csharp
        new("塑胶仓储","塑胶物料资料"),
```

- [ ] **Step 2: 写权限种子脚本**

`db/seed_plastic_perms.sql`:
```sql
-- 开发用:给某用户授予 塑胶物料资料 菜单的 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'塑胶物料资料');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'塑胶物料资料',1,1,1,1,1,1,1,1,1);
```

- [ ] **Step 3: 在开发库执行种子**

Run:
```bash
cd /d/WebpageERP
powershell -NoProfile -Command "\$c=New-Object System.Data.SqlClient.SqlConnection \$env:ERP_DB; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=[IO.File]::ReadAllText('db/seed_plastic_perms.sql'); \$null=\$cmd.ExecuteNonQuery(); \$c.Close(); Write-Output 'perms seeded'"
```
Expected: `perms seeded`

- [ ] **Step 4: 编译(确认 MenuCatalog 合法)**

Run:
```bash
taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet build src/ErpApi/ErpApi.csproj -nologo -clp:ErrorsOnly 2>&1 | tail -4
```
Expected: 0 错误。

- [ ] **Step 5: Commit**

```bash
git add src/ErpApi/Features/Admin/MenuCatalog.cs db/seed_plastic_perms.sql
git commit -m "feat(塑胶物料资料): MenuCatalog菜单项+权限种子"
```

---

### Task 6: 前端 API + 页面 + 路由 + 菜单

**Files:**
- Create: `web/src/api/plasticMaterialMaster.ts`
- Create: `web/src/pages/plastics/PlasticMaterialMasterPage.tsx`
- Modify: `web/src/App.tsx`(import + route)
- Modify: `web/src/nav/menuTree.tsx`(⑧塑胶仓库)

- [ ] **Step 1: 写前端 API**

`web/src/api/plasticMaterialMaster.ts`:
```typescript
import { api } from "./client";
import type { Paged } from "./master";

export interface PlasticMaterialCategoryNode { 类别?: string; 数量: number }

export interface PlasticMaterialRow {
  ID: number;
  物料类别?: string;
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  仓位号?: string;
  单价?: number | null;
  销售价?: number | null;
  库存?: number | null;
  最低库存?: number | null;
  最高库存?: number | null;
  供应商编号?: string;
  供应商名称?: string;
  备注?: string;
}

export const plasticMaterialMasterApi = {
  categories: () =>
    api.get<PlasticMaterialCategoryNode[]>("/plastic-material-master/categories").then(r => r.data),
  list: (类别?: string, keyword?: string, page = 1, size = 50, onlyStock?: boolean) =>
    api.get<Paged<PlasticMaterialRow>>("/plastic-material-master", { params: { 类别, keyword, page, size, onlyStock } }).then(r => r.data),
};
```

- [ ] **Step 2: 写页面(克隆 MaterialMasterPage,换 API/菜单/加仓位号)**

`web/src/pages/plastics/PlasticMaterialMasterPage.tsx`:
```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Space, Table, Tree, message,
} from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { plasticMaterialMasterApi, type PlasticMaterialRow, type PlasticMaterialCategoryNode } from "../../api/plasticMaterialMaster";
import { masterApi } from "../../api/master";
import { can, hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "塑胶物料资料";
const ALL = "__ALL__";
const plasticMaterials = masterApi("plastic-materials");

export default function PlasticMaterialMasterPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const canSave = can(perms, MENU, "保存");
  const canDelete = can(perms, MENU, "删除");
  const priceHidden = hidePrice(perms, MENU);
  const money = (v?: number | null) => (priceHidden ? "***" : (v ?? ""));

  const [cats, setCats] = useState<PlasticMaterialCategoryNode[]>([]);
  const [selKey, setSelKey] = useState<string>(ALL);
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<PlasticMaterialRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState<PlasticMaterialRow | null>(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const 类别 = selKey === ALL ? undefined : selKey;

  const loadCats = useCallback(async () => {
    try { setCats(await plasticMaterialMasterApi.categories()); } catch { /* 忽略 */ }
  }, []);

  const loadRows = useCallback(async (p: number) => {
    if (!canOpen) return;
    setLoading(true);
    try {
      const r = await plasticMaterialMasterApi.list(类别, keyword.trim() || undefined, p, 50);
      setRows(r.items); setTotal(r.total);
    } catch { message.error("加载塑胶物料失败"); }
    finally { setLoading(false); }
  }, [canOpen, 类别, keyword]);

  useEffect(() => { if (canOpen) loadCats(); }, [canOpen, loadCats]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); loadRows(1); }, [selKey]);

  const treeData = useMemo(() => [{
    title: "全部塑胶物料", key: ALL,
    children: cats.map(c => ({ title: `${c.类别}（${c.数量}）`, key: c.类别 ?? "", isLeaf: true })),
  }], [cats]);

  const openCreate = () => {
    const init: PlasticMaterialRow = { ID: 0, 物料类别: 类别 };
    setEditing(init);
    form.resetFields();
    form.setFieldsValue(init);
  };
  const openEdit = async (r: PlasticMaterialRow) => {
    try {
      const full = await plasticMaterials.get(r.ID) as Record<string, unknown>;
      setEditing(r);
      form.resetFields();
      form.setFieldsValue(full);
    } catch { message.error("加载塑胶物料详情失败"); }
  };

  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      if (editing && editing.ID > 0) await plasticMaterials.update(editing.ID, v);
      else await plasticMaterials.create(v);
      message.success("已保存");
      setEditing(null);
      await loadCats();
      await loadRows(page);
    } catch { message.error("保存失败"); }
    finally { setSaving(false); }
  };

  const del = async (r: PlasticMaterialRow) => {
    try {
      await plasticMaterials.remove(r.ID);
      message.success("已删除");
      await loadCats();
      await loadRows(page);
    } catch { message.error("删除失败"); }
  };

  const columns = [
    { title: "物料编号", dataIndex: "物料编号", width: 120 },
    { title: "物料名称", dataIndex: "物料名称", width: 150 },
    { title: "类别", dataIndex: "物料类别", width: 100 },
    { title: "规格", dataIndex: "规格", width: 100 },
    { title: "颜色", dataIndex: "颜色", width: 80 },
    { title: "单位", dataIndex: "单位", width: 64 },
    { title: "仓位号", dataIndex: "仓位号", width: 90 },
    { title: "单价", dataIndex: "单价", width: 90, align: "right" as const, render: money },
    { title: "销售价", dataIndex: "销售价", width: 90, align: "right" as const, render: money },
    { title: "库存", dataIndex: "库存", width: 90, align: "right" as const, render: (v?: number | null) => v ?? "" },
    { title: "最低库存", dataIndex: "最低库存", width: 90, align: "right" as const, render: (v?: number | null) => v ?? "" },
    { title: "供应商", dataIndex: "供应商名称", width: 140 },
    { title: "备注", dataIndex: "备注", width: 160 },
    {
      title: "操作", width: 120, fixed: "right" as const,
      render: (_: unknown, r: PlasticMaterialRow) => (
        <Space size="small">
          {canSave && <a onClick={() => openEdit(r)}><EditOutlined /></a>}
          {canDelete && (
            <Popconfirm title="确认删除该塑胶物料?" onConfirm={() => del(r)}>
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
        <div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"塑胶物料资料·打开"权限）。</div>
      </Card>
    );
  }

  return (
    <Card title="塑胶物料资料" variant="borderless" styles={{ body: { display: "flex", gap: 12 } }}>
      <div style={{ width: 220, flex: "0 0 220px", borderRight: "1px solid #f0f0f0", paddingRight: 8 }}>
        <Tree
          treeData={treeData}
          selectedKeys={[selKey]}
          defaultExpandAll
          onSelect={keys => { if (keys.length) setSelKey(String(keys[0])); }}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Space style={{ marginBottom: 12 }} wrap>
          <Input.Search
            placeholder="物料编号/名称/规格/颜色/供应商" allowClear style={{ width: 260 }}
            value={keyword} onChange={e => setKeyword(e.target.value)}
            onSearch={() => { setPage(1); loadRows(1); }}
          />
          {canSave && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增</Button>}
        </Space>
        <Table
          size="small" rowKey="ID" loading={loading} dataSource={rows} columns={columns}
          scroll={{ x: true }}
          pagination={{
            current: page, pageSize: 50, total, showSizeChanger: false,
            onChange: p => { setPage(p); loadRows(p); }, showTotal: t => `共 ${t} 条`,
          }}
        />
      </div>

      <Modal
        title={editing && editing.ID > 0 ? "编辑塑胶物料" : "新增塑胶物料"}
        open={!!editing} onCancel={() => setEditing(null)} onOk={submit}
        confirmLoading={saving} destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="物料编号" label="物料编号" rules={[{ required: true, message: "请输入物料编号" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="物料名称" label="物料名称"><Input /></Form.Item>
          <Form.Item name="物料类别" label="类别"><Input /></Form.Item>
          <Form.Item name="规格" label="规格"><Input /></Form.Item>
          <Form.Item name="颜色" label="颜色"><Input /></Form.Item>
          <Form.Item name="单位" label="单位"><Input /></Form.Item>
          <Form.Item name="仓位号" label="仓位号"><Input /></Form.Item>
          {!priceHidden && (
            <>
              <Form.Item name="单价" label="单价"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
              <Form.Item name="销售价" label="销售价"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
            </>
          )}
          <Form.Item name="供应商编号" label="供应商编号"><Input /></Form.Item>
          <Form.Item name="备注" label="备注"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="款号" hidden><Input /></Form.Item>
          <Form.Item name="货币" hidden><Input /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
```

- [ ] **Step 3: 加路由**

`web/src/App.tsx` —— 在 import 区(与其它页 import 一起)加:
```tsx
import PlasticMaterialMasterPage from "./pages/plastics/PlasticMaterialMasterPage";
```
在 `<Route path="material-master" .../>` 同级路由区加一行(若无 material-master 行,则放在其它顶层 `<Route>` 旁):
```tsx
          <Route path="plastic-material-master" element={<PlasticMaterialMasterPage />} />
```

- [ ] **Step 4: 菜单落地**

`web/src/nav/menuTree.tsx` —— ⑧塑胶仓库分组里把 `M("塑胶物料资料")` 改为:
```tsx
    M("塑胶物料资料", "/plastic-material-master", "塑胶物料资料"),
```

- [ ] **Step 5: 类型检查 + 测试 + lint**

Run:
```bash
cd /d/WebpageERP/web && npx tsc --noEmit 2>&1 | head -20 && echo "=== test ===" && npm test 2>&1 | tail -6
```
Expected: tsc 无输出(通过);vitest 全过(现有 54 不回归)。

- [ ] **Step 6: Commit**

```bash
cd /d/WebpageERP
git add web/src/api/plasticMaterialMaster.ts web/src/pages/plastics/PlasticMaterialMasterPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m "feat(塑胶物料资料): 前端左树右表CRUD页+路由+菜单"
```

---

### Task 7: 全量验证 + 冒烟 + 收尾

**Files:** 无(验证)

- [ ] **Step 1: 后端全量测试**

Run:
```bash
taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj -nologo 2>&1 | tail -6
```
Expected: 全过(328 + 新增 4 = 332,无回归)。

- [ ] **Step 2: 启动后端 + 冒烟测试只读端点**

Run:
```bash
cd /d/WebpageERP
LOG="/c/Users/DELL/AppData/Local/Temp/claude/D--WebpageERP/fdfd44d2-3cdb-474f-87c7-a257d20da5b7/scratchpad/be.log"
nohup dotnet run --project src/ErpApi/ErpApi.csproj --no-build > "$LOG" 2>&1 &
sleep 8
echo '{"用户":"admin","密码":"admin123"}' > /tmp/login.json
TOK=$(curl -s --noproxy '*' -X POST http://localhost:5000/api/auth/login -H "Content-Type: application/json" --data @/tmp/login.json | python -c "import sys,json; d=json.load(sys.stdin); print(next(v for v in d.values() if isinstance(v,str) and v.startswith('eyJ')))")
echo "=== categories ==="; curl -s --noproxy '*' "http://localhost:5000/api/plastic-material-master/categories" -H "Authorization: Bearer $TOK" -w "\nHTTP %{http_code}\n"
echo "=== list ==="; curl -s --noproxy '*' "http://localhost:5000/api/plastic-material-master" -H "Authorization: Bearer $TOK" -w "\nHTTP %{http_code}\n" | head -c 300
echo "=== create ==="; echo '{"物料编号":"PMSMOKE","物料名称":"冒烟料","物料类别":"啤料PM","仓位号":"Z-99","单位":"kg","单价":9}' > /tmp/pm.json
curl -s --noproxy '*' -X POST "http://localhost:5000/api/master/plastic-materials" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" --data @/tmp/pm.json -w "\nHTTP %{http_code}\n" | head -c 300
```
Expected: categories `HTTP 200`、list `HTTP 200`、create `HTTP 200/201`(返回新建对象,含 仓位号=Z-99)。

- [ ] **Step 3: 清理冒烟数据**

Run:
```bash
powershell -NoProfile -Command "\$c=New-Object System.Data.SqlClient.SqlConnection \$env:ERP_DB; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=\"DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'PMSMOKE'\"; \$null=\$cmd.ExecuteNonQuery(); \$c.Close(); Write-Output 'cleaned'"
```
Expected: `cleaned`

- [ ] **Step 4: 前端 lint(确认无新基线外偏差)**

Run:
```bash
cd /d/WebpageERP/web && npx eslint src/pages/plastics/PlasticMaterialMasterPage.tsx src/api/plasticMaterialMaster.ts 2>&1 | tail -15
```
Expected:仅 `react-hooks/set-state-in-effect` / `react-hooks/exhaustive-deps` 类与克隆源 `MaterialMasterPage` 相同的基线惯例(无新类型错误)。

- [ ] **Step 5: 合并到 master(--no-ff,对齐既有约定)**

Run:
```bash
cd /d/WebpageERP
git checkout master
git merge --no-ff feat-plastic-material-master -m "Merge branch 'feat-plastic-material-master' into master"
git log --oneline -3
```
Expected: 合并成功。
> 注:执行前确认本计划所有 Task 都在分支 `feat-plastic-material-master` 上(Task 1 前先 `git checkout -b feat-plastic-material-master`)。

- [ ] **Step 6: worklog + 记忆**

写 `docs/worklogs/2026-06-25-plastic-material-master.md`(P0 地基落地纪要),更新记忆 `MEMORY.md` + 新建 `erp-plastic-module-p0-0625.md`(塑胶模块启动 + P0 完成 + P1-P4 路线)。

---

## 自检

**Spec 覆盖:** ① 数据模型→Task1+2;② 后端增删改→Task2,只读左树右表→Task3+4,权限→Task5;③ 前端→Task6;④ 测试→Task3+Task7;⑤ 验收标准 1-4→Task7 冒烟覆盖。无遗漏。

**占位扫描:** 无 TBD/TODO;每个写代码的步骤都给了完整代码;`db/15` 序号已定;DI/DbSet/MenuCatalog 插入位置都给了具体锚点行。

**类型一致:** 服务方法 `CategoriesAsync()`/`ListAsync(类别,keyword,page,size,onlyStock)` 在 Task3 定义、Task4 控制器调用一致;DTO `PlasticMaterialCategoryNode`/`PlasticMaterialRow`(后端)与前端 `PlasticMaterialCategoryNode`/`PlasticMaterialRow` 字段一致(含 `仓位号`);菜单名/权限名/控制器 `Menu` 常量三处统一 `塑胶物料资料`;CRUD 路由 `api/master/plastic-materials` ↔ 前端 `masterApi("plastic-materials")` 一致。
