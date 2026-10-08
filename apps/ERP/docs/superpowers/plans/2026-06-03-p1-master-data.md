# P1 主数据（M1 基础资料）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为兴信B ERP 实现基础资料模块——客户/供应商/加工厂/物料/部门/人事/报价 等主数据的增删改查，加上取价/调价（算法8），作为后续所有业务单据的下拉数据源。

**Architecture:** P1 首次引入 EF Core `ErpDbContext`（映射到已存在的中文表，绝不让 EF 建表/迁移）。一个泛型 `MasterCrudService<T>`（分页+模糊查询+CRUD）+ 泛型 `MasterCrudController<T>` 基类（REST + 按 9 位权限编程式控权 + 写 c操作记录审计）承载所有实体；每个实体只需一个薄实体类 + 一个薄控制器。取价用独立 `PricingService`（报价资料 按 物料编号+报价类别+生效日期）。前端一个可复用 `MasterDataPage`（antd Table+Modal+Form）按列配置参数化，价格列按"单价"权限隐藏（成本保密）。

**Tech Stack:** .NET 8 ASP.NET Core, EF Core 8 (SqlServer), Dapper, SQL Server LocalDB (erp/erp_test, Chinese_PRC_CI_AS), xUnit + Microsoft.AspNetCore.Mvc.Testing + Xunit.SkippableFact, React 18 + TS + Ant Design + Vitest.

---

## 前置约定（所有任务通用）

- 工作目录 `D:\WebpageERP`，分支策略由执行技能决定。Windows 用 PowerShell 跑 dotnet；`dotnet` 不在 PATH 时刷新：`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 集成测试需 `$env:ERP_TEST_DB`、`$env:ERP_JWT_KEY`（User 级已设；shell 为空时 `$env:ERP_TEST_DB=[Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")` 等）。`erp_test` 已含 146+3 表。
- 已有可复用件：`ISqlConnectionFactory`、`IPermissionService`(`HasAsync(user,menu,action)`)、`PermissionAction`(9位枚举)、`IAuditLogger`(`WriteAsync(表名,行为,操作员,记录,SqlConnection,SqlTransaction?)`)、`tests/ErpApi.Tests/DbFixture.cs`(`[Collection("db")]`)、`JwtTokenService`(`Issue(user)`、静态 `KeyEnvVar`)、前端 `web/src/auth/permissions.ts`(`can`/`hidePrice`/`PermMap`)、`PermissionContext`(`usePerms`)、`web/src/api/client.ts`(`api` axios 实例)。
- 中文做 C# 标识符是合法的（实体类名/属性名直接用中文）。路由用 ASCII（如 `api/master/customers`），菜单名/表名用中文。

---

## 文件结构

```
src/ErpApi/
├─ Data/
│  ├─ ErpDbContext.cs              EF Core 上下文，注册所有主数据实体(映射已存在的中文表)
│  └─ Entities/
│     ├─ MasterEntity.cs           抽象基类:long ID(identity 主键)
│     ├─ 客户类别.cs 客户资料.cs
│     ├─ 供应商类别.cs 供应商资料.cs
│     ├─ 加工厂类别.cs 加工厂资料.cs
│     ├─ 物料类别.cs 物料资料.cs
│     ├─ 部门信息.cs 人事档案.cs
│     ├─ 报价类别.cs 报价资料.cs
│     └─ 调价表.cs 调价明细.cs
├─ Features/MasterData/
│  ├─ PagedResult.cs               分页结果记录
│  ├─ MasterCrudService.cs         泛型 CRUD(分页/模糊/增删改查)
│  ├─ MasterCrudController.cs      泛型控制器基类(REST+权限+审计)
│  ├─ Controllers.cs               各实体薄控制器(指定路由/菜单/表名)
│  └─ Pricing/
│     ├─ PricingService.cs         取价(报价资料 按 物料编号+报价类别+生效日期)
│     └─ PricingController.cs      取价/调价应用端点
└─ Program.cs                      注册 DbContext + 泛型 service + Pricing

db/03_p0_additions.sql            追加:给 报价资料 加 [生效日期] datetime2(0)(幂等)

web/src/
├─ api/master.ts                   泛型主数据 CRUD 客户端(list/get/create/update/remove)
├─ pages/master/
│  ├─ MasterDataPage.tsx           可复用主数据页(Table+Modal+Form,价格列按权限隐藏)
│  ├─ configs.ts                   各实体的列/资源/菜单配置(集中一处)
│  └─ MasterRouter.tsx             按菜单渲染 MasterDataPage
└─ pages/MainLayout.tsx            基础资料 改为子菜单(展开各实体)

tests/ErpApi.Tests/
├─ ErpDbContextDbTests.cs
├─ MasterCrudServiceDbTests.cs
├─ MasterApiIntegrationTests.cs    (WebApplicationFactory:权限403/成功/审计)
├─ EntityMappingDbTests.cs         (每实体能读其表,验证列名映射无误)
└─ PricingServiceDbTests.cs
web/src/__tests__/master.test.ts
```

---

## Task 1: EF Core 上下文 + 实体基类 + 首个实体（客户）

**Files:**
- Create: `src/ErpApi/Data/Entities/MasterEntity.cs`, `src/ErpApi/Data/Entities/客户类别.cs`, `src/ErpApi/Data/Entities/客户资料.cs`, `src/ErpApi/Data/ErpDbContext.cs`
- Modify: `src/ErpApi/Program.cs`
- Test: `tests/ErpApi.Tests/ErpDbContextDbTests.cs`

- [ ] **Step 1: 写实体基类与首个实体**

Create `src/ErpApi/Data/Entities/MasterEntity.cs`:
```csharp
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

public abstract class MasterEntity
{
    [Key, Column("ID"), DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    public long ID { get; set; }
}
```

Create `src/ErpApi/Data/Entities/客户类别.cs`:
```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("客户类别")]
public sealed class 客户类别 : MasterEntity
{
    [Column("客户类别")] public string? 类别 { get; set; }
    [Column("客户名称")] public string? 名称 { get; set; }
}
```

Create `src/ErpApi/Data/Entities/客户资料.cs`:
```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("客户资料")]
public sealed class 客户资料 : MasterEntity
{
    [Column("客户类别")] public string? 客户类别 { get; set; }
    [Column("客户编号")] public string? 客户编号 { get; set; }
    [Column("客户名称")] public string? 客户名称 { get; set; }
    [Column("联系人")] public string? 联系人 { get; set; }
    [Column("手机")] public string? 手机 { get; set; }
    [Column("电话")] public string? 电话 { get; set; }
    [Column("联系地址")] public string? 联系地址 { get; set; }
    [Column("付款方式")] public string? 付款方式 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
```

- [ ] **Step 2: 写 DbContext**

Create `src/ErpApi/Data/ErpDbContext.cs`:
```csharp
using ErpApi.Data.Entities;
using Microsoft.EntityFrameworkCore;
namespace ErpApi.Data;

public sealed class ErpDbContext(DbContextOptions<ErpDbContext> options) : DbContext(options)
{
    public DbSet<客户类别> 客户类别 => Set<客户类别>();
    public DbSet<客户资料> 客户资料 => Set<客户资料>();
}
```

- [ ] **Step 3: 注册 DbContext（Program.cs）**

In `src/ErpApi/Program.cs`, after the line `builder.Services.AddSingleton<ISqlConnectionFactory, SqlConnectionFactory>();`, add:
```csharp
builder.Services.AddDbContext<ErpApi.Data.ErpDbContext>((sp, o) =>
    o.UseSqlServer(sp.GetRequiredService<ISqlConnectionFactory>().GetConnectionString()));
```
And add `using Microsoft.EntityFrameworkCore;` and `using ErpApi.Data;` at the top if not present.

- [ ] **Step 4: 写失败测试（EF 能读写 客户资料）**

Create `tests/ErpApi.Tests/ErpDbContextDbTests.cs`:
```csharp
using ErpApi.Data;
using ErpApi.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Xunit;

[Collection("db")]
public class ErpDbContextDbTests(DbFixture fx)
{
    private ErpDbContext Ctx()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var opts = new DbContextOptionsBuilder<ErpDbContext>()
            .UseSqlServer(fx.ConnectionString!).Options;
        return new ErpDbContext(opts);
    }

    [SkippableFact]
    public async Task Insert_then_read_customer()
    {
        using var db = Ctx();
        var existing = await db.客户资料.Where(c => c.客户编号 == "P1T").ToListAsync();
        db.客户资料.RemoveRange(existing);
        await db.SaveChangesAsync();

        db.客户资料.Add(new 客户资料 { 客户编号 = "P1T", 客户名称 = "测试客户", 客户类别 = "甲" });
        await db.SaveChangesAsync();

        var got = await db.客户资料.SingleAsync(c => c.客户编号 == "P1T");
        Assert.Equal("测试客户", got.客户名称);
        Assert.True(got.ID > 0); // identity 主键已回填
    }
}
```

- [ ] **Step 5: 运行测试，确认失败**

Run: `dotnet test --filter ErpDbContextDbTests`
Expected: FAIL（类型不存在 / 编译错误）。

- [ ] **Step 6: 运行测试，确认通过**

设置 `$env:ERP_TEST_DB`、`$env:ERP_JWT_KEY` 后 Run: `dotnet test --filter ErpDbContextDbTests`
Expected: PASS（1 passed，not skipped）。若映射列名报错（"Invalid column name"），核对 `db/01_rebuild_schema.sql` 中 客户资料 的实际列名并修正 `[Column]`。

- [ ] **Step 7: Commit**

```powershell
git add -A; git commit -m "feat(P1): EF Core ErpDbContext + 客户实体(映射已存在中文表)"
```

---

## Task 2: 泛型 CRUD 服务

**Files:**
- Create: `src/ErpApi/Features/MasterData/PagedResult.cs`, `src/ErpApi/Features/MasterData/MasterCrudService.cs`
- Modify: `src/ErpApi/Program.cs`
- Test: `tests/ErpApi.Tests/MasterCrudServiceDbTests.cs`

- [ ] **Step 1: 写分页结果与服务**

Create `src/ErpApi/Features/MasterData/PagedResult.cs`:
```csharp
namespace ErpApi.Features.MasterData;
public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Total);
```

Create `src/ErpApi/Features/MasterData/MasterCrudService.cs`:
```csharp
using System.Linq.Expressions;
using ErpApi.Data;
using ErpApi.Data.Entities;
using Microsoft.EntityFrameworkCore;
namespace ErpApi.Features.MasterData;

public sealed class MasterCrudService<T>(ErpDbContext db) where T : MasterEntity
{
    public async Task<PagedResult<T>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var q = db.Set<T>().AsQueryable();
        if (!string.IsNullOrWhiteSpace(keyword))
            q = q.Where(KeywordPredicate(keyword.Trim()));
        var total = await q.CountAsync();
        var items = await q.OrderBy(e => e.ID).Skip((page - 1) * size).Take(size).ToListAsync();
        return new PagedResult<T>(items, total);
    }

    public Task<T?> GetAsync(long id) => db.Set<T>().FirstOrDefaultAsync(e => e.ID == id);

    public async Task<T> CreateAsync(T entity)
    {
        entity.ID = 0; // 由 identity 生成
        db.Set<T>().Add(entity);
        await db.SaveChangesAsync();
        return entity;
    }

    public async Task<bool> UpdateAsync(long id, T entity)
    {
        var exists = await db.Set<T>().AnyAsync(e => e.ID == id);
        if (!exists) return false;
        entity.ID = id;
        db.Set<T>().Update(entity);
        await db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> DeleteAsync(long id)
    {
        var e = await db.Set<T>().FirstOrDefaultAsync(x => x.ID == id);
        if (e is null) return false;
        db.Set<T>().Remove(e);
        await db.SaveChangesAsync();
        return true;
    }

    // 对所有 string 属性做 OR LIKE %kw% 的模糊查询
    private static Expression<Func<T, bool>> KeywordPredicate(string kw)
    {
        var p = Expression.Parameter(typeof(T), "e");
        var like = typeof(DbFunctionsExtensions).GetMethod(
            nameof(DbFunctionsExtensions.Like),
            new[] { typeof(DbFunctions), typeof(string), typeof(string) })!;
        var ef = Expression.Constant(EF.Functions);
        var pattern = Expression.Constant($"%{kw}%");
        Expression? body = null;
        foreach (var prop in typeof(T).GetProperties()
                     .Where(x => x.PropertyType == typeof(string)))
        {
            var call = Expression.Call(like, ef, Expression.Property(p, prop), pattern);
            body = body is null ? call : Expression.OrElse(body, call);
        }
        body ??= Expression.Constant(false);
        return Expression.Lambda<Func<T, bool>>(body, p);
    }
}
```

- [ ] **Step 2: 注册泛型服务（Program.cs）**

In `src/ErpApi/Program.cs`, after the DbContext registration, add:
```csharp
builder.Services.AddScoped(typeof(ErpApi.Features.MasterData.MasterCrudService<>));
```

- [ ] **Step 3: 写失败测试**

Create `tests/ErpApi.Tests/MasterCrudServiceDbTests.cs`:
```csharp
using ErpApi.Data;
using ErpApi.Data.Entities;
using ErpApi.Features.MasterData;
using Microsoft.EntityFrameworkCore;
using Xunit;

[Collection("db")]
public class MasterCrudServiceDbTests(DbFixture fx)
{
    private (ErpDbContext db, MasterCrudService<客户资料> svc) Make()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var db = new ErpDbContext(new DbContextOptionsBuilder<ErpDbContext>()
            .UseSqlServer(fx.ConnectionString!).Options);
        db.客户资料.RemoveRange(db.客户资料.Where(c => c.客户编号!.StartsWith("CRUD")));
        db.SaveChanges();
        return (db, new MasterCrudService<客户资料>(db));
    }

    [SkippableFact]
    public async Task Create_get_update_delete_roundtrip()
    {
        var (db, svc) = Make();
        var created = await svc.CreateAsync(new 客户资料 { 客户编号 = "CRUD1", 客户名称 = "甲", 客户类别 = "A" });
        Assert.True(created.ID > 0);

        var got = await svc.GetAsync(created.ID);
        Assert.Equal("甲", got!.客户名称);

        got.客户名称 = "乙";
        Assert.True(await svc.UpdateAsync(created.ID, got));
        Assert.Equal("乙", (await svc.GetAsync(created.ID))!.客户名称);

        Assert.True(await svc.DeleteAsync(created.ID));
        Assert.Null(await svc.GetAsync(created.ID));
        db.Dispose();
    }

    [SkippableFact]
    public async Task List_paging_and_keyword()
    {
        var (db, svc) = Make();
        for (int i = 0; i < 3; i++)
            await svc.CreateAsync(new 客户资料 { 客户编号 = $"CRUD{i}", 客户名称 = $"模糊匹配{i}", 客户类别 = "A" });

        var page = await svc.ListAsync(1, 2, "模糊匹配");
        Assert.Equal(3, page.Total);
        Assert.Equal(2, page.Items.Count); // 分页:每页2条

        var none = await svc.ListAsync(1, 20, "不存在的关键字XYZ");
        Assert.Equal(0, none.Total);
        db.Dispose();
    }
}
```

- [ ] **Step 4: 运行测试，确认失败**

Run: `dotnet test --filter MasterCrudServiceDbTests`
Expected: FAIL（类型不存在）。

- [ ] **Step 5: 运行测试，确认通过**

Run: `dotnet test --filter MasterCrudServiceDbTests`
Expected: PASS（2 passed，not skipped）。

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "feat(P1): 泛型 MasterCrudService(分页+模糊查询+CRUD)"
```

---

## Task 3: 泛型控制器基类 + 客户控制器 + 权限/审计（含集成测试）

**Files:**
- Create: `src/ErpApi/Features/MasterData/MasterCrudController.cs`, `src/ErpApi/Features/MasterData/Controllers.cs`
- Modify: `tests/ErpApi.Tests/ErpApi.Tests.csproj`（加 Mvc.Testing 包）
- Test: `tests/ErpApi.Tests/MasterApiIntegrationTests.cs`

- [ ] **Step 1: 写泛型控制器基类**

Create `src/ErpApi/Features/MasterData/MasterCrudController.cs`:
```csharp
using System.Security.Claims;
using ErpApi.Data.Entities;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.MasterData;

[ApiController]
[Authorize]
public abstract class MasterCrudController<T>(
    MasterCrudService<T> svc, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
    where T : MasterEntity
{
    protected abstract string Menu { get; }      // 9位权限的菜单名
    protected abstract string TableName { get; } // 审计用表名

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync(TableName, behavior, CurrentUser, record, c);
    }

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(page, size, keyword));
    }

    [HttpGet("{id:long}")]
    public async Task<IActionResult> Get(long id)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var e = await svc.GetAsync(id);
        return e is null ? NotFound() : Ok(e);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] T entity)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        var created = await svc.CreateAsync(entity);
        await AuditAsync("新增", $"ID={created.ID}");
        return CreatedAtAction(nameof(Get), new { id = created.ID }, created);
    }

    [HttpPut("{id:long}")]
    public async Task<IActionResult> Update(long id, [FromBody] T entity)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        if (!await svc.UpdateAsync(id, entity)) return NotFound();
        await AuditAsync("修改", $"ID={id}");
        return NoContent();
    }

    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        if (!await svc.DeleteAsync(id)) return NotFound();
        await AuditAsync("删除", $"ID={id}");
        return NoContent();
    }
}
```

- [ ] **Step 2: 写客户的两个薄控制器**

Create `src/ErpApi/Features/MasterData/Controllers.cs`:
```csharp
using ErpApi.Data.Entities;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.MasterData;

[Route("api/master/customer-categories")]
public sealed class CustomerCategoryController(
    MasterCrudService<客户类别> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<客户类别>(s, p, a, f)
{
    protected override string Menu => "客户类别";
    protected override string TableName => "客户类别";
}

[Route("api/master/customers")]
public sealed class CustomerController(
    MasterCrudService<客户资料> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<客户资料>(s, p, a, f)
{
    protected override string Menu => "客户资料";
    protected override string TableName => "客户资料";
}
```

- [ ] **Step 3: 加 Mvc.Testing 测试包**

Run:
```powershell
dotnet add tests/ErpApi.Tests package Microsoft.AspNetCore.Mvc.Testing --version 8.0.21
```

- [ ] **Step 4: 写集成测试（权限 403 / 成功 / 审计）**

Create `tests/ErpApi.Tests/MasterApiIntegrationTests.cs`:
```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Dapper;
using ErpApi.Infrastructure.Security;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

[Collection("db")]
public class MasterApiIntegrationTests(DbFixture fx)
{
    private static IConfiguration JwtCfg() => new ConfigurationBuilder().AddInMemoryCollection(
        new Dictionary<string, string?> {
            ["Erp:Jwt:Issuer"] = "ErpApi", ["Erp:Jwt:Audience"] = "ErpClient", ["Erp:Jwt:ExpireMinutes"] = "60"
        }).Build();

    private WebApplicationFactory<Program> Factory()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Environment.SetEnvironmentVariable("ERP_DB", fx.ConnectionString);     // 让应用连测试库
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        return new WebApplicationFactory<Program>();
    }

    private void SeedPerms(string user, bool canSave)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除])
                    VALUES(@user,N'客户资料',1,@canSave,1)", new { user, canSave });
    }

    private static string Token(string user) => new JwtTokenService(JwtCfg()).Issue(user);

    [SkippableFact]
    public async Task List_requires_open_permission_and_returns_data()
    {
        using var app = Factory();
        SeedPerms("p1viewer", canSave: false);
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token("p1viewer"));

        var resp = await client.GetAsync("/api/master/customers?page=1&size=5");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [SkippableFact]
    public async Task Create_forbidden_without_save_permission()
    {
        using var app = Factory();
        SeedPerms("p1viewer", canSave: false); // 无保存权限
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token("p1viewer"));

        var resp = await client.PostAsJsonAsync("/api/master/customers",
            new { 客户编号 = "INT1", 客户名称 = "应被拒" });
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [SkippableFact]
    public async Task Create_succeeds_with_save_permission_and_writes_audit()
    {
        using var app = Factory();
        SeedPerms("p1editor", canSave: true);
        using (var c = new SqlConnection(fx.ConnectionString))
        {
            c.Open();
            c.Execute("DELETE FROM [客户资料] WHERE [客户编号]='INT2'");
            c.Execute("DELETE FROM [c操作记录] WHERE [操作员]='p1editor' AND [表名]=N'客户资料'");
        }
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token("p1editor"));

        var resp = await client.PostAsJsonAsync("/api/master/customers",
            new { 客户编号 = "INT2", 客户名称 = "集成新增" });
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

        using var verify = new SqlConnection(fx.ConnectionString);
        verify.Open();
        Assert.Equal(1, verify.ExecuteScalar<int>("SELECT COUNT(*) FROM [客户资料] WHERE [客户编号]='INT2'"));
        Assert.True(verify.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [c操作记录] WHERE [操作员]='p1editor' AND [行为]=N'新增'") >= 1);
    }
}
```

- [ ] **Step 5: 运行测试，确认失败**

Run: `dotnet test --filter MasterApiIntegrationTests`
Expected: FAIL（控制器/类型不存在或编译错误）。

- [ ] **Step 6: 运行测试，确认通过**

设置 `$env:ERP_TEST_DB`、`$env:ERP_JWT_KEY` 后 Run: `dotnet test --filter MasterApiIntegrationTests`
Expected: PASS（3 passed，not skipped）。

- [ ] **Step 7: Commit**

```powershell
git add -A; git commit -m "feat(P1): 泛型 MasterCrudController(权限+审计)+客户控制器+集成测试"
```

---

## Task 4: 供应商 / 加工厂 / 物料 实体与控制器

**Files:**
- Create: `src/ErpApi/Data/Entities/供应商类别.cs`, `供应商资料.cs`, `加工厂类别.cs`, `加工厂资料.cs`, `物料类别.cs`, `物料资料.cs`
- Modify: `src/ErpApi/Data/ErpDbContext.cs`, `src/ErpApi/Features/MasterData/Controllers.cs`
- Test: `tests/ErpApi.Tests/EntityMappingDbTests.cs`

- [ ] **Step 1: 写实体类**

Create `src/ErpApi/Data/Entities/供应商类别.cs`:
```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("供应商类别")]
public sealed class 供应商类别 : MasterEntity
{
    [Column("供应商类别")] public string? 类别 { get; set; }
    [Column("供应商名称")] public string? 名称 { get; set; }
}
```

Create `src/ErpApi/Data/Entities/供应商资料.cs`:
```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("供应商资料")]
public sealed class 供应商资料 : MasterEntity
{
    [Column("供应商类别")] public string? 供应商类别 { get; set; }
    [Column("供应商编号")] public string? 供应商编号 { get; set; }
    [Column("供应商名称")] public string? 供应商名称 { get; set; }
    [Column("联系人")] public string? 联系人 { get; set; }
    [Column("手机")] public string? 手机 { get; set; }
    [Column("电话")] public string? 电话 { get; set; }
    [Column("联系地址")] public string? 联系地址 { get; set; }
    [Column("付款方式")] public string? 付款方式 { get; set; }
    [Column("货币")] public string? 货币 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
```

Create `src/ErpApi/Data/Entities/加工厂类别.cs`:
```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("加工厂类别")]
public sealed class 加工厂类别 : MasterEntity
{
    [Column("加工厂类别")] public string? 类别 { get; set; }
    [Column("加工厂名称")] public string? 名称 { get; set; }
}
```

Create `src/ErpApi/Data/Entities/加工厂资料.cs`:
```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("加工厂资料")]
public sealed class 加工厂资料 : MasterEntity
{
    [Column("加工厂类别")] public string? 加工厂类别 { get; set; }
    [Column("加工厂编号")] public string? 加工厂编号 { get; set; }
    [Column("加工厂名称")] public string? 加工厂名称 { get; set; }
    [Column("联系人")] public string? 联系人 { get; set; }
    [Column("手机")] public string? 手机 { get; set; }
    [Column("电话")] public string? 电话 { get; set; }
    [Column("联系地址")] public string? 联系地址 { get; set; }
    [Column("付款方式")] public string? 付款方式 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
```

Create `src/ErpApi/Data/Entities/物料类别.cs`:
```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("物料类别")]
public sealed class 物料类别 : MasterEntity
{
    [Column("物料类别")] public string? 类别 { get; set; }
    [Column("物料名称")] public string? 名称 { get; set; }
}
```
> 注：执行前用 `db/01_rebuild_schema.sql` 核对 物料类别 的实际列名（搜索 `CREATE TABLE [物料类别]`）。若列名不同，按实际修正 `[Column]`。

Create `src/ErpApi/Data/Entities/物料资料.cs`:
```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("物料资料")]
public sealed class 物料资料 : MasterEntity
{
    [Column("物料类别")] public string? 物料类别 { get; set; }
    [Column("物料编号")] public string? 物料编号 { get; set; }
    [Column("物料名称")] public string? 物料名称 { get; set; }
    [Column("规格")] public string? 规格 { get; set; }
    [Column("颜色")] public string? 颜色 { get; set; }
    [Column("单位")] public string? 单位 { get; set; }
    [Column("单价")] public decimal? 单价 { get; set; }
    [Column("销售价")] public decimal? 销售价 { get; set; }
    [Column("供应商编号")] public string? 供应商编号 { get; set; }
    [Column("款号")] public string? 款号 { get; set; }
    [Column("货币")] public string? 货币 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
```

- [ ] **Step 2: 注册到 DbContext**

In `src/ErpApi/Data/ErpDbContext.cs`, add these properties inside the class:
```csharp
    public DbSet<供应商类别> 供应商类别 => Set<供应商类别>();
    public DbSet<供应商资料> 供应商资料 => Set<供应商资料>();
    public DbSet<加工厂类别> 加工厂类别 => Set<加工厂类别>();
    public DbSet<加工厂资料> 加工厂资料 => Set<加工厂资料>();
    public DbSet<物料类别> 物料类别 => Set<物料类别>();
    public DbSet<物料资料> 物料资料 => Set<物料资料>();
```

- [ ] **Step 3: 加薄控制器**

In `src/ErpApi/Features/MasterData/Controllers.cs`, append:
```csharp
[Route("api/master/supplier-categories")]
public sealed class SupplierCategoryController(
    MasterCrudService<供应商类别> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<供应商类别>(s, p, a, f)
{ protected override string Menu => "供应商类别"; protected override string TableName => "供应商类别"; }

[Route("api/master/suppliers")]
public sealed class SupplierController(
    MasterCrudService<供应商资料> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<供应商资料>(s, p, a, f)
{ protected override string Menu => "供应商资料"; protected override string TableName => "供应商资料"; }

[Route("api/master/factory-categories")]
public sealed class FactoryCategoryController(
    MasterCrudService<加工厂类别> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<加工厂类别>(s, p, a, f)
{ protected override string Menu => "加工厂类别"; protected override string TableName => "加工厂类别"; }

[Route("api/master/factories")]
public sealed class FactoryController(
    MasterCrudService<加工厂资料> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<加工厂资料>(s, p, a, f)
{ protected override string Menu => "加工厂资料"; protected override string TableName => "加工厂资料"; }

[Route("api/master/material-categories")]
public sealed class MaterialCategoryController(
    MasterCrudService<物料类别> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<物料类别>(s, p, a, f)
{ protected override string Menu => "物料类别"; protected override string TableName => "物料类别"; }

[Route("api/master/materials")]
public sealed class MaterialController(
    MasterCrudService<物料资料> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<物料资料>(s, p, a, f)
{ protected override string Menu => "物料资料"; protected override string TableName => "物料资料"; }
```

- [ ] **Step 4: 写映射验证测试（每实体能读其表）**

Create `tests/ErpApi.Tests/EntityMappingDbTests.cs`:
```csharp
using ErpApi.Data;
using ErpApi.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Xunit;

[Collection("db")]
public class EntityMappingDbTests(DbFixture fx)
{
    private ErpDbContext Ctx()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        return new ErpDbContext(new DbContextOptionsBuilder<ErpDbContext>()
            .UseSqlServer(fx.ConnectionString!).Options);
    }

    // 对每个实体跑一次 Take(1) 查询；列名映射有误会抛 "Invalid column name"
    [SkippableFact]
    public async Task All_entities_query_without_mapping_error()
    {
        using var db = Ctx();
        _ = await db.供应商类别.Take(1).ToListAsync();
        _ = await db.供应商资料.Take(1).ToListAsync();
        _ = await db.加工厂类别.Take(1).ToListAsync();
        _ = await db.加工厂资料.Take(1).ToListAsync();
        _ = await db.物料类别.Take(1).ToListAsync();
        _ = await db.物料资料.Take(1).ToListAsync();
        Assert.True(true); // 跑到这里即说明所有实体列映射正确
    }
}
```

- [ ] **Step 5: 运行测试，确认失败 → 通过**

Run: `dotnet test --filter EntityMappingDbTests`
先 FAIL（实体不存在），实现后 PASS。若某实体抛 "Invalid column name '<列>'"，对照 `db/01_rebuild_schema.sql` 修正该实体的 `[Column]`，再跑通。

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "feat(P1): 供应商/加工厂/物料 实体与控制器 + 列映射校验"
```

---

## Task 5: 部门 / 人事 / 报价 实体与控制器

**Files:**
- Create: `src/ErpApi/Data/Entities/部门信息.cs`, `人事档案.cs`, `报价类别.cs`, `报价资料.cs`
- Modify: `src/ErpApi/Data/ErpDbContext.cs`, `Controllers.cs`, `tests/ErpApi.Tests/EntityMappingDbTests.cs`

- [ ] **Step 1: 写实体类**

Create `src/ErpApi/Data/Entities/部门信息.cs`:
```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("部门信息")]
public sealed class 部门信息 : MasterEntity
{
    [Column("编号")] public string? 编号 { get; set; }
    [Column("部门")] public string? 部门 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
```

Create `src/ErpApi/Data/Entities/人事档案.cs`:
```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("人事档案")]
public sealed class 人事档案 : MasterEntity
{
    [Column("编号")] public string? 编号 { get; set; }
    [Column("姓名")] public string? 姓名 { get; set; }
    [Column("考勤卡号")] public string? 考勤卡号 { get; set; }
    [Column("性别")] public string? 性别 { get; set; }
    [Column("部门编号")] public string? 部门编号 { get; set; }
    [Column("职称")] public string? 职称 { get; set; }
    [Column("工序类型")] public string? 工序类型 { get; set; }
    [Column("电话")] public string? 电话 { get; set; }
    [Column("手机")] public string? 手机 { get; set; }
    [Column("基本工资")] public decimal? 基本工资 { get; set; }
    [Column("在职")] public string? 在职 { get; set; }
    [Column("默认班次")] public string? 默认班次 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
```

Create `src/ErpApi/Data/Entities/报价类别.cs`:
```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("报价类别")]
public sealed class 报价类别 : MasterEntity
{
    [Column("编号")] public string? 编号 { get; set; }
    [Column("名称")] public string? 名称 { get; set; }
    [Column("类别")] public string? 类别 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
```

Create `src/ErpApi/Data/Entities/报价资料.cs`:
```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("报价资料")]
public sealed class 报价资料 : MasterEntity
{
    [Column("报价类别")] public string? 报价类别 { get; set; }
    [Column("物料编号")] public string? 物料编号 { get; set; }
    [Column("物料名称")] public string? 物料名称 { get; set; }
    [Column("规格")] public string? 规格 { get; set; }
    [Column("颜色")] public string? 颜色 { get; set; }
    [Column("单位")] public string? 单位 { get; set; }
    [Column("单价")] public decimal? 单价 { get; set; }
    [Column("销售价")] public decimal? 销售价 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
    // 生效日期列在 Task 6 通过迁移加入并补到此实体
}
```

- [ ] **Step 2: 注册 DbContext**

In `src/ErpApi/Data/ErpDbContext.cs`, add:
```csharp
    public DbSet<部门信息> 部门信息 => Set<部门信息>();
    public DbSet<人事档案> 人事档案 => Set<人事档案>();
    public DbSet<报价类别> 报价类别 => Set<报价类别>();
    public DbSet<报价资料> 报价资料 => Set<报价资料>();
```

- [ ] **Step 3: 加薄控制器**

In `src/ErpApi/Features/MasterData/Controllers.cs`, append:
```csharp
[Route("api/master/departments")]
public sealed class DepartmentController(
    MasterCrudService<部门信息> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<部门信息>(s, p, a, f)
{ protected override string Menu => "部门信息"; protected override string TableName => "部门信息"; }

[Route("api/master/employees")]
public sealed class EmployeeController(
    MasterCrudService<人事档案> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<人事档案>(s, p, a, f)
{ protected override string Menu => "人事档案"; protected override string TableName => "人事档案"; }

[Route("api/master/quote-categories")]
public sealed class QuoteCategoryController(
    MasterCrudService<报价类别> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<报价类别>(s, p, a, f)
{ protected override string Menu => "报价类别"; protected override string TableName => "报价类别"; }

[Route("api/master/quotes")]
public sealed class QuoteController(
    MasterCrudService<报价资料> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<报价资料>(s, p, a, f)
{ protected override string Menu => "报价资料"; protected override string TableName => "报价资料"; }
```

- [ ] **Step 4: 扩展映射验证测试**

In `tests/ErpApi.Tests/EntityMappingDbTests.cs`, inside `All_entities_query_without_mapping_error`, before the `Assert.True(true);` line, add:
```csharp
        _ = await db.部门信息.Take(1).ToListAsync();
        _ = await db.人事档案.Take(1).ToListAsync();
        _ = await db.报价类别.Take(1).ToListAsync();
        _ = await db.报价资料.Take(1).ToListAsync();
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `dotnet test --filter EntityMappingDbTests`
Expected: PASS。映射错误按 Task 4 Step 5 的方法对照修正。

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "feat(P1): 部门/人事/报价 实体与控制器"
```

---

## Task 6: 取价（算法8）— 报价资料加生效日期 + PricingService

**Files:**
- Modify: `db/03_p0_additions.sql`, `src/ErpApi/Data/Entities/报价资料.cs`, `src/ErpApi/Program.cs`
- Create: `src/ErpApi/Features/MasterData/Pricing/PricingService.cs`
- Test: `tests/ErpApi.Tests/PricingServiceDbTests.cs`

- [ ] **Step 1: 给 报价资料 加 生效日期 列（幂等迁移）**

In `db/03_p0_additions.sql`, append at the end:
```sql
-- P1 取价(算法8)：报价资料 增加 生效日期，支持按生效日期取最新价
IF COL_LENGTH(N'报价资料', N'生效日期') IS NULL
    ALTER TABLE [报价资料] ADD [生效日期] datetime2(0) NULL;
```
Then apply it to both DBs:
```powershell
.\db\run-db.ps1 -ConnectionString $env:ERP_TEST_DB
.\db\run-db.ps1 -ConnectionString $env:ERP_DB
```
Expected: 两次输出末尾 `表数: 149`（已存在表/列被幂等跳过，无报错）。

- [ ] **Step 2: 实体补 生效日期**

In `src/ErpApi/Data/Entities/报价资料.cs`, replace the comment line `// 生效日期列在 Task 6 ...` with:
```csharp
    [Column("生效日期")] public DateTime? 生效日期 { get; set; }
```

- [ ] **Step 3: 写失败测试**

Create `tests/ErpApi.Tests/PricingServiceDbTests.cs`:
```csharp
using Dapper;
using ErpApi.Features.MasterData.Pricing;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PricingServiceDbTests(DbFixture fx)
{
    private PricingService Make()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new PricingService(new SqlConnectionFactory(cfg));
    }

    [SkippableFact]
    public async Task Picks_latest_effective_price_on_or_before_date()
    {
        using (var c = new SqlConnection(fx.ConnectionString))
        {
            c.Open();
            c.Execute("DELETE FROM [报价资料] WHERE [物料编号]='PR1'");
            c.Execute(@"INSERT INTO [报价资料]([报价类别],[物料编号],[单价],[生效日期])
                        VALUES(N'甲',N'PR1',10,'2026-01-01'),
                               (N'甲',N'PR1',12,'2026-03-01'),
                               (N'甲',N'PR1',99,'2026-12-01')"); // 未来价,不应取
        }
        var svc = Make();
        var price = await svc.GetMaterialPriceAsync("PR1", "甲", new DateTime(2026, 6, 1));
        Assert.Equal(12m, price); // 生效日期<=6/1 的最新一条 = 3/1 的 12
    }

    [SkippableFact]
    public async Task Returns_null_when_no_quote()
    {
        var svc = Make();
        Assert.Null(await svc.GetMaterialPriceAsync("NOPE_XYZ", "甲", DateTime.Now));
    }
}
```

- [ ] **Step 4: 运行测试，确认失败**

Run: `dotnet test --filter PricingServiceDbTests`
Expected: FAIL（类型不存在）。

- [ ] **Step 5: 实现 PricingService**

Create `src/ErpApi/Features/MasterData/Pricing/PricingService.cs`:
```csharp
using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.MasterData.Pricing;

public sealed class PricingService(ISqlConnectionFactory factory)
{
    // 算法8 取价：按 物料编号+报价类别，取 生效日期<=asOf 的最新一条单价；
    // 生效日期为 NULL 视为最早基线价(始终有效)。
    public async Task<decimal?> GetMaterialPriceAsync(string 物料编号, string 报价类别, DateTime asOf)
    {
        using var c = factory.Create();
        return await c.ExecuteScalarAsync<decimal?>(@"
SELECT TOP 1 [单价]
FROM [报价资料]
WHERE [物料编号]=@物料编号 AND [报价类别]=@报价类别
  AND ([生效日期] IS NULL OR [生效日期] <= @asOf)
ORDER BY CASE WHEN [生效日期] IS NULL THEN 0 ELSE 1 END DESC, [生效日期] DESC, [ID] DESC",
            new { 物料编号, 报价类别, asOf });
    }
}
```

- [ ] **Step 6: 注册服务（Program.cs）**

In `src/ErpApi/Program.cs`, after the MasterCrudService registration, add:
```csharp
builder.Services.AddScoped<ErpApi.Features.MasterData.Pricing.PricingService>();
```

- [ ] **Step 7: 运行测试，确认通过**

Run: `dotnet test --filter PricingServiceDbTests`
Expected: PASS（2 passed）。

- [ ] **Step 8: Commit**

```powershell
git add -A; git commit -m "feat(P1): 取价 PricingService(报价资料+生效日期,算法8)"
```

---

## Task 7: 调价（价格变更留痕 + 应用调价）

**Files:**
- Create: `src/ErpApi/Data/Entities/调价表.cs`, `调价明细.cs`, `src/ErpApi/Features/MasterData/Pricing/PricingController.cs`
- Modify: `src/ErpApi/Data/ErpDbContext.cs`, `src/ErpApi/Features/MasterData/Controllers.cs`
- Test: `tests/ErpApi.Tests/PricingApplyDbTests.cs`

- [ ] **Step 1: 写调价实体**

Create `src/ErpApi/Data/Entities/调价表.cs`:
```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("调价表")]
public sealed class 调价表 : MasterEntity
{
    [Column("单号")] public string? 单号 { get; set; }
    [Column("日期")] public DateTime? 日期 { get; set; }
    [Column("操作员")] public string? 操作员 { get; set; }
    [Column("审核")] public string? 审核 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
```

Create `src/ErpApi/Data/Entities/调价明细.cs`:
```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("调价明细表")]
public sealed class 调价明细 : MasterEntity
{
    [Column("单号")] public string? 单号 { get; set; }
    [Column("日期")] public DateTime? 日期 { get; set; }
    [Column("物料类别")] public string? 物料类别 { get; set; }
    [Column("物料编号")] public string? 物料编号 { get; set; }
    [Column("物料名称")] public string? 物料名称 { get; set; }
    [Column("规格")] public string? 规格 { get; set; }
    [Column("颜色")] public string? 颜色 { get; set; }
    [Column("单位")] public string? 单位 { get; set; }
    [Column("原单价")] public decimal? 原单价 { get; set; }
    [Column("修改单价")] public decimal? 修改单价 { get; set; }
    [Column("修改原因")] public string? 修改原因 { get; set; }
}
```

- [ ] **Step 2: 注册 DbContext + CRUD 控制器**

In `src/ErpApi/Data/ErpDbContext.cs`, add:
```csharp
    public DbSet<调价表> 调价表 => Set<调价表>();
    public DbSet<调价明细> 调价明细 => Set<调价明细>();
```
In `src/ErpApi/Features/MasterData/Controllers.cs`, append:
```csharp
[Route("api/master/price-adjusts")]
public sealed class PriceAdjustController(
    MasterCrudService<调价表> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<调价表>(s, p, a, f)
{ protected override string Menu => "调价"; protected override string TableName => "调价表"; }

[Route("api/master/price-adjust-lines")]
public sealed class PriceAdjustLineController(
    MasterCrudService<调价明细> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<调价明细>(s, p, a, f)
{ protected override string Menu => "调价"; protected override string TableName => "调价明细表"; }
```

- [ ] **Step 3: 写"应用调价"端点（写回报价资料新价 + 生效日期）**

Create `src/ErpApi/Features/MasterData/Pricing/PricingController.cs`:
```csharp
using System.Security.Claims;
using Dapper;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.MasterData.Pricing;

[ApiController]
[Authorize]
[Route("api/master/pricing")]
public sealed class PricingController(PricingService pricing, ISqlConnectionFactory factory) : ControllerBase
{
    // 取价：GET /api/master/pricing/material?物料编号=..&报价类别=..&asOf=2026-06-01
    [HttpGet("material")]
    public async Task<IActionResult> GetPrice(string 物料编号, string 报价类别, DateTime? asOf)
    {
        var price = await pricing.GetMaterialPriceAsync(物料编号, 报价类别, asOf ?? DateTime.Now);
        return Ok(new { 物料编号, 报价类别, 单价 = price });
    }

    // 应用调价：把一张调价单的明细写成 报价资料 的新生效价(生效日期=单据日期)
    // POST /api/master/pricing/apply/{调价单号}?报价类别=甲
    [HttpPost("apply/{单号}")]
    public async Task<IActionResult> Apply(string 单号, string 报价类别)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var rows = await c.ExecuteAsync(@"
INSERT INTO [报价资料]([报价类别],[物料编号],[物料名称],[规格],[颜色],[单位],[单价],[生效日期])
SELECT @报价类别, d.[物料编号], d.[物料名称], d.[规格], d.[颜色], d.[单位], d.[修改单价], ISNULL(d.[日期], SYSDATETIME())
FROM [调价明细表] d
WHERE d.[单号]=@单号 AND d.[修改单价] IS NOT NULL", new { 单号, 报价类别 }, tx);
        tx.Commit();
        return Ok(new { 单号, 报价类别, 生成报价条数 = rows });
    }
}
```

- [ ] **Step 4: 写失败测试**

Create `tests/ErpApi.Tests/PricingApplyDbTests.cs`:
```csharp
using Dapper;
using ErpApi.Features.MasterData.Pricing;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PricingApplyDbTests(DbFixture fx)
{
    private SqlConnectionFactory Factory()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task Apply_writes_new_effective_quote_then_pricing_reads_it()
    {
        var f = Factory();
        using (var c = new SqlConnection(fx.ConnectionString))
        {
            c.Open();
            c.Execute("DELETE FROM [调价明细表] WHERE [单号]='TJ1'");
            c.Execute("DELETE FROM [报价资料] WHERE [物料编号]='TJ_M'");
            c.Execute(@"INSERT INTO [调价明细表]([单号],[日期],[物料编号],[物料名称],[修改单价])
                        VALUES('TJ1','2026-05-01',N'TJ_M',N'测试料',88)");
        }
        // 直接调用 PricingController.Apply 的等价逻辑通过 service 验证不便，这里用 PricingService 读取结果
        // 先手工执行 apply 的 SQL（与控制器一致）以隔离测试 DB 逻辑：
        using (var c = new SqlConnection(fx.ConnectionString))
        {
            c.Open();
            c.Execute(@"
INSERT INTO [报价资料]([报价类别],[物料编号],[物料名称],[规格],[颜色],[单位],[单价],[生效日期])
SELECT N'甲', d.[物料编号], d.[物料名称], d.[规格], d.[颜色], d.[单位], d.[修改单价], ISNULL(d.[日期], SYSDATETIME())
FROM [调价明细表] d WHERE d.[单号]='TJ1' AND d.[修改单价] IS NOT NULL");
        }
        var price = await new PricingService(f).GetMaterialPriceAsync("TJ_M", "甲", new DateTime(2026, 6, 1));
        Assert.Equal(88m, price);
    }
}
```
> 说明：本测试验证"调价明细 → 报价资料 新生效价 → 取价读到新价"这条数据链；`PricingController.Apply` 用相同 SQL，端到端在 Task 8 后可由前端手测。

- [ ] **Step 5: 运行测试 失败→实现→通过**

先 `dotnet test --filter PricingApplyDbTests` 确认 FAIL（实体/类型缺失），完成 Step 1-3 后再跑 PASS。

- [ ] **Step 6: 注册 DbContext 变更已在 Step 2;运行全量确认无回归**

Run: `dotnet test`
Expected: 全绿，0 跳过。

- [ ] **Step 7: Commit**

```powershell
git add -A; git commit -m "feat(P1): 调价单CRUD + 应用调价写回报价资料生效价"
```

---

## Task 8: 前端 — 可复用主数据页 + 客户页 + 菜单/路由

**Files:**
- Create: `web/src/api/master.ts`, `web/src/pages/master/MasterDataPage.tsx`, `web/src/pages/master/configs.ts`, `web/src/pages/master/MasterRouter.tsx`
- Modify: `web/src/App.tsx`, `web/src/pages/MainLayout.tsx`
- Test: `web/src/__tests__/master.test.ts`

- [ ] **Step 1: 写主数据 API 客户端**

Create `web/src/api/master.ts`:
```ts
import { api } from "./client";

export interface Paged<T> { items: T[]; total: number }

export function masterApi(resource: string) {
  const base = `/master/${resource}`;
  return {
    list: (page = 1, size = 20, keyword = "") =>
      api.get<Paged<Record<string, unknown>>>(base, { params: { page, size, keyword } }).then(r => r.data),
    get: (id: number) => api.get<Record<string, unknown>>(`${base}/${id}`).then(r => r.data),
    create: (body: Record<string, unknown>) => api.post(base, body).then(r => r.data),
    update: (id: number, body: Record<string, unknown>) => api.put(`${base}/${id}`, body).then(r => r.data),
    remove: (id: number) => api.delete(`${base}/${id}`).then(r => r.data),
  };
}
```

- [ ] **Step 2: 写失败测试（API 路径构造）**

Create `web/src/__tests__/master.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../api/client", () => {
  const calls: { method: string; url: string; cfg?: unknown }[] = [];
  const rec = (method: string) => (url: string, cfg?: unknown) => {
    calls.push({ method, url, cfg });
    return Promise.resolve({ data: { items: [], total: 0 } });
  };
  return { api: { get: rec("get"), post: rec("post"), put: rec("put"), delete: rec("delete"), __calls: calls } };
});

import { masterApi } from "../api/master";
import { api } from "../api/client";

describe("masterApi", () => {
  beforeEach(() => { (api as unknown as { __calls: unknown[] }).__calls.length = 0; });

  it("builds resource paths", async () => {
    const a = masterApi("customers");
    await a.list(2, 10, "甲");
    await a.get(5);
    await a.update(5, { 客户名称: "x" });
    await a.remove(5);
    const calls = (api as unknown as { __calls: { method: string; url: string }[] }).__calls;
    expect(calls[0]).toMatchObject({ method: "get", url: "/master/customers" });
    expect(calls[1]).toMatchObject({ method: "get", url: "/master/customers/5" });
    expect(calls[2]).toMatchObject({ method: "put", url: "/master/customers/5" });
    expect(calls[3]).toMatchObject({ method: "delete", url: "/master/customers/5" });
  });
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `npm --prefix web run test`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 运行测试，确认通过**

实现 master.ts 后 Run: `npm --prefix web run test`
Expected: PASS。

- [ ] **Step 5: 写实体配置**

Create `web/src/pages/master/configs.ts`:
```ts
export interface FieldCfg { name: string; label: string; price?: boolean }
export interface MasterCfg { menu: string; resource: string; title: string; fields: FieldCfg[] }

export const MASTER_CONFIGS: Record<string, MasterCfg> = {
  客户资料: {
    menu: "客户资料", resource: "customers", title: "客户资料",
    fields: [
      { name: "客户编号", label: "客户编号" }, { name: "客户名称", label: "客户名称" },
      { name: "客户类别", label: "类别" }, { name: "联系人", label: "联系人" },
      { name: "手机", label: "手机" }, { name: "电话", label: "电话" },
      { name: "付款方式", label: "付款方式" }, { name: "备注", label: "备注" },
    ],
  },
  物料资料: {
    menu: "物料资料", resource: "materials", title: "物料资料",
    fields: [
      { name: "物料编号", label: "物料编号" }, { name: "物料名称", label: "物料名称" },
      { name: "物料类别", label: "类别" }, { name: "规格", label: "规格" },
      { name: "颜色", label: "颜色" }, { name: "单位", label: "单位" },
      { name: "单价", label: "单价", price: true }, { name: "销售价", label: "销售价", price: true },
      { name: "供应商编号", label: "供应商编号" }, { name: "备注", label: "备注" },
    ],
  },
};
```
> 其余实体的配置在 Task 9 补全。`price:true` 的字段在用户无"单价"权限时隐藏。

- [ ] **Step 6: 写可复用主数据页**

Create `web/src/pages/master/MasterDataPage.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Form, Input, Modal, Popconfirm, Space, Table, message } from "antd";
import { masterApi } from "../../api/master";
import { hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import type { MasterCfg } from "./configs";

type Row = Record<string, unknown> & { ID: number };

export default function MasterDataPage({ cfg }: { cfg: MasterCfg }) {
  const perms = usePerms();
  const api = masterApi(cfg.resource);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [form] = Form.useForm();

  const priceHidden = hidePrice(perms, cfg.menu);
  const fields = cfg.fields.filter(f => !(f.price && priceHidden));

  const load = useCallback(async () => {
    const r = await api.list(page, 10, keyword);
    setRows(r.items as Row[]); setTotal(r.total);
  }, [page, keyword, cfg.resource]);

  useEffect(() => { load(); }, [load]);

  const columns = [
    ...fields.map(f => ({ title: f.label, dataIndex: f.name, key: f.name })),
    {
      title: "操作", key: "_op", render: (_: unknown, row: Row) => (
        <Space>
          <a onClick={() => { setEditing(row); form.setFieldsValue(row); }}>编辑</a>
          <Popconfirm title="确认删除?" onConfirm={async () => { await api.remove(row.ID); message.success("已删除"); load(); }}>
            <a>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const onSave = async () => {
    const v = await form.validateFields();
    if (editing && editing.ID) await api.update(editing.ID, v);
    else await api.create(v);
    message.success("已保存"); setEditing(null); form.resetFields(); load();
  };

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Input.Search placeholder="搜索" allowClear onSearch={v => { setPage(1); setKeyword(v); }} style={{ width: 240 }} />
        <Button type="primary" onClick={() => { setEditing({ ID: 0 } as Row); form.resetFields(); }}>新增</Button>
      </Space>
      <Table rowKey="ID" dataSource={rows} columns={columns}
        pagination={{ current: page, pageSize: 10, total, onChange: setPage }} />
      <Modal open={!!editing} title={cfg.title} onOk={onSave} onCancel={() => { setEditing(null); form.resetFields(); }} destroyOnClose>
        <Form form={form} layout="vertical">
          {fields.map(f => (
            <Form.Item key={f.name} name={f.name} label={f.label}><Input /></Form.Item>
          ))}
        </Form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 7: 写菜单路由组件**

Create `web/src/pages/master/MasterRouter.tsx`:
```tsx
import { useParams } from "react-router-dom";
import { MASTER_CONFIGS } from "./configs";
import MasterDataPage from "./MasterDataPage";

export default function MasterRouter() {
  const { menu } = useParams();
  const cfg = menu ? MASTER_CONFIGS[decodeURIComponent(menu)] : undefined;
  if (!cfg) return <div>请选择左侧基础资料项</div>;
  return <MasterDataPage key={cfg.resource} cfg={cfg} />;
}
```

- [ ] **Step 8: 接线菜单 + 路由**

Replace `web/src/pages/MainLayout.tsx`:
```tsx
import { Layout, Menu } from "antd";
import { Outlet, useNavigate } from "react-router-dom";
import { can } from "../auth/permissions";
import { usePerms } from "../auth/PermissionContext";
import { MASTER_CONFIGS } from "./master/configs";

export default function MainLayout() {
  const perms = usePerms();
  const nav = useNavigate();
  const masterChildren = Object.values(MASTER_CONFIGS)
    .filter(c => can(perms, c.menu, "打开"))
    .map(c => ({ key: `master/${encodeURIComponent(c.menu)}`, label: c.title }));
  const items = [{ key: "基础资料", label: "基础资料", children: masterChildren }];
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Sider><Menu theme="dark" mode="inline" items={items} onClick={e => nav("/" + e.key)} /></Layout.Sider>
      <Layout>
        <Layout.Header style={{ color: "#fff" }}>兴信B ERP</Layout.Header>
        <Layout.Content style={{ padding: 16 }}><Outlet /></Layout.Content>
      </Layout>
    </Layout>
  );
}
```
In `web/src/App.tsx`, replace the index route block
```tsx
          <Route index element={<div>欢迎使用兴信B ERP（P0 地基已就绪）</div>} />
```
with:
```tsx
          <Route index element={<div>欢迎使用兴信B ERP</div>} />
          <Route path="master/:menu" element={<MasterRouter />} />
```
and add the import at the top of `App.tsx`:
```tsx
import MasterRouter from "./pages/master/MasterRouter";
```

- [ ] **Step 9: 构建 + 测试**

Run: `npm --prefix web run test` 然后 `npm --prefix web run build`
Expected: 测试 PASS，build 成功。

- [ ] **Step 10: Commit**

```powershell
git add -A; git commit -m "feat(P1): 前端可复用主数据页+客户/物料配置+基础资料子菜单"
```

---

## Task 9: 前端 — 其余实体配置补全

**Files:**
- Modify: `web/src/pages/master/configs.ts`

- [ ] **Step 1: 补全所有实体配置**

In `web/src/pages/master/configs.ts`, add these entries inside the `MASTER_CONFIGS` object (after 物料资料):
```ts
  客户类别: { menu: "客户类别", resource: "customer-categories", title: "客户类别",
    fields: [{ name: "客户类别", label: "类别" }, { name: "客户名称", label: "名称" }] },
  供应商类别: { menu: "供应商类别", resource: "supplier-categories", title: "供应商类别",
    fields: [{ name: "供应商类别", label: "类别" }, { name: "供应商名称", label: "名称" }] },
  供应商资料: { menu: "供应商资料", resource: "suppliers", title: "供应商资料",
    fields: [
      { name: "供应商编号", label: "编号" }, { name: "供应商名称", label: "名称" },
      { name: "供应商类别", label: "类别" }, { name: "联系人", label: "联系人" },
      { name: "手机", label: "手机" }, { name: "货币", label: "货币" }, { name: "备注", label: "备注" }] },
  加工厂类别: { menu: "加工厂类别", resource: "factory-categories", title: "加工厂类别",
    fields: [{ name: "加工厂类别", label: "类别" }, { name: "加工厂名称", label: "名称" }] },
  加工厂资料: { menu: "加工厂资料", resource: "factories", title: "加工厂资料",
    fields: [
      { name: "加工厂编号", label: "编号" }, { name: "加工厂名称", label: "名称" },
      { name: "加工厂类别", label: "类别" }, { name: "联系人", label: "联系人" },
      { name: "手机", label: "手机" }, { name: "备注", label: "备注" }] },
  物料类别: { menu: "物料类别", resource: "material-categories", title: "物料类别",
    fields: [{ name: "物料类别", label: "类别" }, { name: "物料名称", label: "名称" }] },
  部门信息: { menu: "部门信息", resource: "departments", title: "部门信息",
    fields: [{ name: "编号", label: "编号" }, { name: "部门", label: "部门" }, { name: "备注", label: "备注" }] },
  人事档案: { menu: "人事档案", resource: "employees", title: "人事档案",
    fields: [
      { name: "编号", label: "编号" }, { name: "姓名", label: "姓名" },
      { name: "考勤卡号", label: "考勤卡号" }, { name: "部门编号", label: "部门" },
      { name: "工序类型", label: "工序类型" }, { name: "基本工资", label: "基本工资", price: true },
      { name: "在职", label: "在职" }, { name: "默认班次", label: "默认班次" }] },
  报价类别: { menu: "报价类别", resource: "quote-categories", title: "报价类别",
    fields: [{ name: "编号", label: "编号" }, { name: "名称", label: "名称" }, { name: "类别", label: "类别" }] },
  报价资料: { menu: "报价资料", resource: "quotes", title: "报价资料",
    fields: [
      { name: "报价类别", label: "报价类别" }, { name: "物料编号", label: "物料编号" },
      { name: "物料名称", label: "物料名称" }, { name: "规格", label: "规格" },
      { name: "颜色", label: "颜色" }, { name: "单位", label: "单位" },
      { name: "单价", label: "单价", price: true }, { name: "销售价", label: "销售价", price: true }] },
```

- [ ] **Step 2: 构建 + 测试**

Run: `npm --prefix web run test` 然后 `npm --prefix web run build`
Expected: 测试 PASS，build 成功。

- [ ] **Step 3: Commit**

```powershell
git add -A; git commit -m "feat(P1): 前端补全 供应商/加工厂/部门/人事/报价 等主数据配置"
```

---

## Task 10: 收尾（README + 全量验证 + 权限种子）

**Files:**
- Modify: `README.md`
- Create: `db/seed_p1_perms.sql`

- [ ] **Step 1: 写一份开发用权限种子（便于手测前端）**

Create `db/seed_p1_perms.sql`:
```sql
-- 开发用:给某用户授予所有 P1 主数据菜单的 打开/保存/删除/单价 权限。
-- 用法:把 @用户 改成你的登录名,在目标库执行(可经 DbDeploy 严格模式跑)。
DECLARE @用户 nvarchar(30) = N'admin';
DECLARE @menus TABLE([菜单] nvarchar(40));
INSERT INTO @menus VALUES
 (N'客户类别'),(N'客户资料'),(N'供应商类别'),(N'供应商资料'),
 (N'加工厂类别'),(N'加工厂资料'),(N'物料类别'),(N'物料资料'),
 (N'部门信息'),(N'人事档案'),(N'报价类别'),(N'报价资料'),(N'调价');
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (SELECT [菜单] FROM @menus);
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
SELECT @用户,[菜单],1,1,1,1,1,1,0,0,1 FROM @menus;
```

- [ ] **Step 2: 全量后端测试**

设置 `$env:ERP_TEST_DB`、`$env:ERP_JWT_KEY`，Run: `dotnet test`
Expected: 全绿，0 跳过。记录通过数。

- [ ] **Step 3: 前端测试 + 构建**

Run: `npm --prefix web run test` 与 `npm --prefix web run build`
Expected: 通过 + 构建成功。

- [ ] **Step 4: 更新 README**

In `README.md`, under `## P0 已交付`, add a new section after it:
```markdown
## P1 已交付（基础资料）
- EF Core `ErpDbContext`（映射已存在中文表，不做迁移）
- 泛型 `MasterCrudService<T>` + `MasterCrudController<T>`（分页/模糊/CRUD + 9位权限 + 审计）
- 实体：客户/供应商/加工厂/物料（各含类别）、部门、人事、报价（类别+资料）、调价（表+明细）
- 取价（算法8）：`报价资料` 加 `生效日期`，按 物料编号+报价类别 取生效价；调价单可"应用"写回新生效价
- 前端：可复用主数据页（搜索/分页/增删改），基础资料子菜单，价格列按"单价"权限隐藏
- 开发用权限种子：`db/seed_p1_perms.sql`（授权某用户访问全部主数据菜单）
```

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "docs(P1): README 更新 + 开发权限种子，P1 主数据完成"
```

---

## Self-Review 记录

- **Spec 覆盖**：客户/供应商/加工厂/物料（含类别）(T1,T4)、部门/人事/报价(T5)、调价(T7)、取价算法8(T6)、9位权限+审计(T3 基类)、价格列按单价权限隐藏(T8 前端 hidePrice)、前端列表/增改删(T8/T9) —— 蓝图 M1 各项均有任务对应。
- **占位符**：无 TBD/TODO；每步含完整代码。映射列名以 `db/01_rebuild_schema.sql` 为准，几处提示执行时核对（中文列名易错）。
- **类型一致**：`MasterEntity.ID`、`MasterCrudService<T>` 方法名(`ListAsync/GetAsync/CreateAsync/UpdateAsync/DeleteAsync`)、`PagedResult<T>(Items,Total)`、`MasterCrudController<T>`(`Menu`/`TableName`)、`PricingService.GetMaterialPriceAsync(物料编号,报价类别,asOf)`、前端 `masterApi(resource)`/`MasterCfg`/`hidePrice` 全程一致。
- **已知边界**：实体仅映射常用列（非全部列，未映射列保持 NULL 不受影响）；调价"应用"用 Dapper 直写，PricingApply 测试用等价 SQL 验证数据链；报价资料按 物料编号+报价类别+生效日期 取价，生效日期 NULL 视为基线价。
```
