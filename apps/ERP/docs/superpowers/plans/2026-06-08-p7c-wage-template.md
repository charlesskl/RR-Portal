# P7c 工资模板/公式配置 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 工资模板配置 CRUD——模板={编号/名称}+工资项[序号/台头项目/类型/公式]，整组替换保存(写工资模板项目[类型]+工资模板公式[公式]两表)。只存配置不求值。零改表。

**Architecture:** 聚合服务(整组替换两层事务)+控制器(打开/保存/删除,无金额脱敏)+「工资管理」菜单加 工资模板 配置页。`src/ErpApi/Features/Payroll/` 续用。

**Tech Stack:** .NET 8 + Dapper；React + TS + AntD v6 + Vitest；xUnit。依据 `docs/superpowers/specs/2026-06-08-p7c-wage-template-design.md`。样板：`src/ErpApi/Features/Payroll/AbsenceService.cs`、P6 收款服务(两层事务)、物料单据可编辑明细前端。

---

## Task 1: 工资模板 DTOs + Service + DbTest

**Files:** Modify `src/ErpApi/Features/Payroll/PayrollDtos.cs`；Create `src/ErpApi/Features/Payroll/WageTemplateService.cs`；Test `tests/ErpApi.Tests/WageTemplateServiceDbTests.cs`.

- [ ] **Step 1: 追加 DTOs**
```csharp
// ---- 工资模板 ----
public sealed class WageTemplateItemDto
{ public int 序号 { get; set; } public string? 台头项目 { get; set; } public string? 类型 { get; set; } public string? 公式 { get; set; } }
public sealed class WageTemplateSaveDto
{ public string 模板编号 { get; set; } = ""; public string? 模板名称 { get; set; } public List<WageTemplateItemDto> 明细 { get; set; } = []; }
public sealed class WageTemplateHeaderDto
{ public string? 模板编号 { get; set; } public string? 模板名称 { get; set; } public int 项目数 { get; set; } }
public sealed class WageTemplateDetailDto
{ public string? 模板编号 { get; set; } public string? 模板名称 { get; set; } public List<WageTemplateItemDto> 明细 { get; set; } = []; }
```

- [ ] **Step 2: WageTemplateService.cs**
```csharp
using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Payroll;

// 工资模板配置(整组替换)。模板=工资模板项目(类型)+工资模板公式(公式),按 模板编号+台头项目 串联。本期公式模板级(部门编号=NULL)。
public sealed class WageTemplateService(ISqlConnectionFactory factory)
{
    public async Task<IReadOnlyList<WageTemplateHeaderDto>> ListAsync(string? keyword)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var rows = await c.QueryAsync<WageTemplateHeaderDto>(@"
SELECT [模板编号], MAX([模板名称]) AS 模板名称, COUNT(*) AS 项目数
FROM [工资模板项目]
WHERE @kw IS NULL OR [模板编号] LIKE @kw OR [模板名称] LIKE @kw
GROUP BY [模板编号] ORDER BY [模板编号];", new { kw });
        return rows.AsList();
    }

    public async Task<WageTemplateDetailDto?> GetAsync(string 模板编号)
    {
        using var c = factory.Create();
        var items = (await c.QueryAsync<WageTemplateItemDto>(@"
SELECT CAST(i.[序号] AS int) AS 序号, i.[台头项目], i.[类型], f.[公式]
FROM [工资模板项目] i
LEFT JOIN [工资模板公式] f ON f.[模板编号]=i.[模板编号] AND f.[台头项目]=i.[台头项目] AND f.[部门编号] IS NULL
WHERE i.[模板编号]=@模板编号 ORDER BY i.[序号];", new { 模板编号 })).AsList();
        if (items.Count == 0) return null;
        var 名称 = await c.ExecuteScalarAsync<string?>("SELECT MAX([模板名称]) FROM [工资模板项目] WHERE [模板编号]=@模板编号", new { 模板编号 });
        return new WageTemplateDetailDto { 模板编号 = 模板编号, 模板名称 = 名称, 明细 = items };
    }

    public async Task SaveAsync(WageTemplateSaveDto dto, string user)
    {
        if (string.IsNullOrWhiteSpace(dto.模板编号)) throw new ArgumentException("模板编号必填");
        if (dto.明细.Count == 0) throw new ArgumentException("工资模板至少要有一个工资项");
        var 项目名 = dto.明细.Select(x => (x.台头项目 ?? "").Trim()).ToList();
        if (项目名.Any(string.IsNullOrEmpty)) throw new ArgumentException("台头项目必填");
        if (项目名.Distinct().Count() != 项目名.Count) throw new ArgumentException("台头项目在模板内不能重复");

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        await c.ExecuteAsync("DELETE FROM [工资模板项目] WHERE [模板编号]=@模板编号", new { dto.模板编号 }, tx);
        await c.ExecuteAsync("DELETE FROM [工资模板公式] WHERE [模板编号]=@模板编号", new { dto.模板编号 }, tx);
        int 序 = 0;
        foreach (var it in dto.明细)
        {
            序++;
            await c.ExecuteAsync(@"
INSERT INTO [工资模板项目]([模板编号],[模板名称],[序号],[台头项目],[类型])
VALUES(@模板编号,@模板名称,@序号,@台头项目,@类型)",
                new { dto.模板编号, dto.模板名称, 序号 = 序, it.台头项目, it.类型 }, tx);
            await c.ExecuteAsync(@"
INSERT INTO [工资模板公式]([模板编号],[模板名称],[部门编号],[部门名称],[序号],[台头项目],[公式])
VALUES(@模板编号,@模板名称,NULL,NULL,@序号,@台头项目,@公式)",
                new { dto.模板编号, dto.模板名称, 序号 = 序, it.台头项目, it.公式 }, tx);
        }
        tx.Commit();
    }

    public async Task<bool> DeleteAsync(string 模板编号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var n = await c.ExecuteAsync("DELETE FROM [工资模板项目] WHERE [模板编号]=@模板编号", new { 模板编号 }, tx);
        await c.ExecuteAsync("DELETE FROM [工资模板公式] WHERE [模板编号]=@模板编号", new { 模板编号 }, tx);
        tx.Commit();
        return n > 0;
    }
}
```

- [ ] **Step 3: DbTest** `tests/ErpApi.Tests/WageTemplateServiceDbTests.cs`：SaveAsync(模板 P7CT1,4项[基本工资/应发/"基本工资", 计件工资/应发/"计件工资", 社保费/应扣/"社保费", 实发合计/合计/"基本工资+计件工资-社保费"]) → GetAsync 返回4项、序号1..4、公式/类型匹配；再 SaveAsync(P7CT1,2项) → Get 返回2项(整组替换)；DeleteAsync → Get 为 null。清理删两表 P7CT1。
```csharp
using Dapper;
using ErpApi.Features.Payroll;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class WageTemplateServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private WageTemplateService Svc() => new(Factory());

    [SkippableFact]
    public async Task Save_整组替换_then_Get_Delete()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [工资模板项目] WHERE [模板编号]=N'P7CT1'");
            c.Execute("DELETE FROM [工资模板公式] WHERE [模板编号]=N'P7CT1'");
        }
        Clean();
        try
        {
            await Svc().SaveAsync(new WageTemplateSaveDto
            {
                模板编号 = "P7CT1", 模板名称 = "车间模板",
                明细 = [
                    new() { 台头项目 = "基本工资", 类型 = "应发", 公式 = "基本工资" },
                    new() { 台头项目 = "计件工资", 类型 = "应发", 公式 = "计件工资" },
                    new() { 台头项目 = "社保费", 类型 = "应扣", 公式 = "社保费" },
                    new() { 台头项目 = "实发合计", 类型 = "合计", 公式 = "基本工资+计件工资-社保费" },
                ]
            }, "tester");
            var d = await Svc().GetAsync("P7CT1");
            Assert.NotNull(d);
            Assert.Equal("车间模板", d!.模板名称);
            Assert.Equal(4, d.明细.Count);
            Assert.Equal(1, d.明细[0].序号);
            Assert.Equal("实发合计", d.明细[3].台头项目);
            Assert.Equal("基本工资+计件工资-社保费", d.明细[3].公式);
            Assert.Equal("应扣", d.明细[2].类型);

            // 整组替换为2项
            await Svc().SaveAsync(new WageTemplateSaveDto
            { 模板编号 = "P7CT1", 模板名称 = "车间模板V2", 明细 = [
                new() { 台头项目 = "基本工资", 类型 = "应发", 公式 = "基本工资" },
                new() { 台头项目 = "实发合计", 类型 = "合计", 公式 = "基本工资" } ] }, "tester");
            var d2 = await Svc().GetAsync("P7CT1");
            Assert.Equal(2, d2!.明细.Count);
            Assert.Equal("车间模板V2", d2.模板名称);

            Assert.True(await Svc().DeleteAsync("P7CT1"));
            Assert.Null(await Svc().GetAsync("P7CT1"));
        }
        finally { Clean(); }
    }
}
```

- [ ] **Step 4: 测试（绿）** — `Get-Process ...|Stop-Process -Force`；`dotnet test tests/ErpApi.Tests --filter WageTemplateServiceDbTests`；全量(188)。
- [ ] **Step 5: Commit** — `git add src/ErpApi/Features/Payroll/PayrollDtos.cs src/ErpApi/Features/Payroll/WageTemplateService.cs tests/ErpApi.Tests/WageTemplateServiceDbTests.cs && git commit -m "feat(P7): 工资模板配置服务(整组替换·项目+公式两表·模板级公式)+DbTest"`

---

## Task 2: 控制器 + DI + 权限种子 + API 测试

**Files:** Create `src/ErpApi/Features/Payroll/WageTemplateController.cs`；Modify `src/ErpApi/Program.cs`；Create `db/seed_p7c_perms.sql`；Test `tests/ErpApi.Tests/P7cWageTemplateApiIntegrationTests.cs`.

- [ ] **Step 1: WageTemplateController.cs**
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Payroll;

// 工资模板配置 REST(整组替换,无金额脱敏)。
[ApiController]
[Authorize]
[Route("api/payroll/wage-templates")]
public sealed class WageTemplateController(
    WageTemplateService svc, IPermissionService perms, IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "工资模板";
    private const string Table = "工资模板项目";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    { using var c = factory.Create(); await c.OpenAsync(); await audit.WriteAsync(Table, behavior, CurrentUser, record, c); }

    [HttpGet]
    public async Task<IActionResult> List(string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(keyword));
    }

    [HttpGet("{模板编号}")]
    public async Task<IActionResult> Get(string 模板编号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(模板编号);
        if (d is null) return NotFound();
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Save([FromBody] WageTemplateSaveDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await svc.SaveAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        await AuditAsync("保存", $"模板={dto.模板编号},项目数={dto.明细.Count}");
        return Ok(new { dto.模板编号 });
    }

    [HttpDelete("{模板编号}")]
    public async Task<IActionResult> Delete(string 模板编号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        if (!await svc.DeleteAsync(模板编号)) return NotFound();
        await AuditAsync("删除", $"模板={模板编号}");
        return NoContent();
    }
}
```

- [ ] **Step 2: DI** 追加 `builder.Services.AddScoped<ErpApi.Features.Payroll.WageTemplateService>();`
- [ ] **Step 3: 权限种子** `db/seed_p7c_perms.sql`：
```sql
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单]=N'工资模板';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'工资模板',1,1,1,1,0,0,0,0,1);
```
- [ ] **Step 4: API 测试** `tests/ErpApi.Tests/P7cWageTemplateApiIntegrationTests.cs`（仿 P7a/P7b）：①无保存权限 POST→403；②保存(模板+3项含公式)→ GET 返回3项且公式原样 → DELETE → GET 404；③模板编号空 save→400。权限种子内联;清理删两表。
- [ ] **Step 5: 测试（绿）+ Commit**
```bash
git add src/ErpApi/Features/Payroll/WageTemplateController.cs src/ErpApi/Program.cs db/seed_p7c_perms.sql tests/ErpApi.Tests/P7cWageTemplateApiIntegrationTests.cs
git commit -m "feat(P7): 工资模板REST(整组替换CRUD)+权限种子+API测试"
```

---

## Task 3: 前端 — 工资模板配置页

**Files:** Modify `web/src/api/payroll.ts`、`web/src/App.tsx`、`web/src/pages/MainLayout.tsx`；Create `web/src/pages/payroll/WageTemplatePage.tsx`；Modify `web/src/__tests__/payroll.test.ts`.

- [ ] **Step 1: api 追加** `payroll.ts`：`wageTemplateApi`(list(keyword?)/get(模板编号)/save(body)/remove(模板编号)) + 类型 `WageTemplateItem {序号/台头项目/类型/公式}`、`WageTemplateHeader {模板编号/模板名称/项目数}`、`WageTemplateDetail {模板编号/模板名称/明细}`、`WageTemplateSave`。
- [ ] **Step 2: 页面** `WageTemplatePage.tsx`：模板列表(Card+Table:模板编号/模板名称/项目数,行可点开编辑) + 新建/编辑抽屉(模板编号 Input[编辑只读]/模板名称 + 可编辑明细表:序号自动/台头项目 Input/类型 Select[应发/应扣/合计]/公式 Input,增删行,整组保存) + 删除 Popconfirm。仿物料单据 CreateDrawer 的明细可编辑表。按 `can('工资模板',...)` 控权。
- [ ] **Step 3: util 测试** `payroll.test.ts` 加一条（如 `validWageItems(items)` 过滤台头项目空/查重，放 `web/src/utils/payroll.ts`）。
- [ ] **Step 4: 菜单+路由** 「工资管理」组追加 工资模板(`can('工资模板','打开')`,图标如 `ProfileOutlined`/`FormOutlined`)；`App.tsx` 路由 `/payroll/wage-templates`；Header 标题链补「工资模板」。图标按需 import。
- [ ] **Step 5: 构建+测试+Commit** — `npm --prefix web run build`;`npm --prefix web run test -- --run`;
```bash
git add web/src && git commit -m "feat(P7): 工资模板配置页(可编辑明细+整组保存)+api+util测试"
```

---

## Task 4: 验证 + 收尾

- [ ] **Step 1: 全量回归** — 后端 `dotnet test tests/ErpApi.Tests`(全过)；前端 test+build(全过)。
- [ ] **Step 2: 终审** — diff 核对：整组替换两表、公式只存不校验、部门编号NULL通用、无金额脱敏、零改表。
- [ ] **Step 3: 授权种子** — `dotnet run --project tmp/dbquery -- $env:ERP_DB "@db/seed_p7c_perms.sql"`。
- [ ] **Step 4: 收尾** — finishing-a-development-branch：合并 master 本地→删分支→重启 5000/5173→更新记忆(erp-status 加 P7c 条目,标注 P7d 工资表生成[公式引擎]为下一步,且 P7d 需先 brainstorm 公式引擎全表达式vs固定结构)。

---

## Self-Review

- **Spec 覆盖**：DTOs+Service(整组替换)+DbTest(T1)、Controller+DI+权限种子+API测试(T2)、前端配置页(T3)、回归收尾(T4)。模板级公式、只存不校验、模板编号手填、整组替换两表——均落实。✓
- **占位符**：DTOs/Service/DbTest/Controller/权限种子完整代码;API测试与前端给明确结构+样板引用。✓
- **类型/命名一致**：Menu 工资模板;路由 api/payroll/wage-templates;DTO WageTemplate*;两表 工资模板项目(类型)/工资模板公式(公式);序号 CAST int;部门编号 NULL。✓
- **关键坑**：两表按 模板编号+台头项目 串联(台头项目模板内唯一,保存查重);序号 real→CAST int;公式只存不校验(P7d求值);部门编号NULL避FK;整组替换事务删+插;ErpApi占用先Stop-Process。✓
