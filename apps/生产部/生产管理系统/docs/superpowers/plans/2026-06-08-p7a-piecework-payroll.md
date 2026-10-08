# P7a 计件归集（月度计件工资）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 按员工×月归集已审核有效计件的计件工资合计（只读），供工资表（P7d）取「计件工资」。零改表，复用 P4 M6 计件表。

**Architecture:** 只读 Dapper 归集服务（计件表 JOIN 人事档案/部门信息，过滤 审核='1' AND 有效<>'0' AND 当月）+ 控制器（打开权限，计件工资按单价权限脱敏）+ 新「工资管理」菜单组「计件归集」报表页。

**Tech Stack:** .NET 8 + Dapper；React + TS + AntD v6 + Vitest；xUnit。依据 `docs/superpowers/specs/2026-06-08-p7a-piecework-payroll-design.md`。样板：`src/ErpApi/Features/Sales/ReceivablesService.cs`(只读报表)、`src/ErpApi/Features/Production/Piecework/`(计件汇总脱敏)、`src/ErpApi/Features/MonthEnd/MonthEndService.cs`(yyyyMM 解析)。新 feature 目录 `src/ErpApi/Features/Payroll/`。

---

## Task 1: 计件归集 DTOs + Service + DbTest

**Files:** Create `src/ErpApi/Features/Payroll/PayrollDtos.cs`、`src/ErpApi/Features/Payroll/PieceworkPayrollService.cs`；Test `tests/ErpApi.Tests/PieceworkPayrollServiceDbTests.cs`.

- [ ] **Step 1: PayrollDtos.cs**
```csharp
namespace ErpApi.Features.Payroll;

public sealed class PieceworkPayrollRow
{
    public string? 编号 { get; set; }
    public string? 姓名 { get; set; }
    public string? 部门编号 { get; set; }
    public string? 部门 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 计件工资 { get; set; }
}
```

- [ ] **Step 2: PieceworkPayrollService.cs**
```csharp
using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Payroll;

// 计件归集（算法2）：按员工×月归集已审核有效计件的计件工资合计(Σ金额)。只读,不持久化。
public sealed class PieceworkPayrollService(ISqlConnectionFactory factory)
{
    private const string Sql = @"
SELECT b.[编号], MAX(b.[姓名]) AS 姓名, b.[部门编号], MAX(d.[部门]) AS 部门,
       SUM(ISNULL(a.[数量],0)) AS 数量, SUM(ISNULL(a.[金额],0)) AS 计件工资
FROM [计件表] a
JOIN [人事档案] b ON a.[员工号]=b.[编号]
LEFT JOIN [部门信息] d ON d.[编号]=b.[部门编号]
WHERE ISNULL(a.[审核],'0')='1' AND ISNULL(a.[有效],'1')<>'0'
  AND a.[日期] >= @月初 AND a.[日期] < @下月初
  AND (@部门编号 IS NULL OR b.[部门编号]=@部门编号)
GROUP BY b.[编号], b.[部门编号]
ORDER BY b.[部门编号], b.[编号];";

    public async Task<IReadOnlyList<PieceworkPayrollRow>> MonthlyAsync(string 月份, string? 部门编号)
    {
        if (string.IsNullOrWhiteSpace(月份) || 月份.Length != 6 || !int.TryParse(月份, out _))
            throw new System.ArgumentException("月份须为 6 位 yyyyMM。");
        var y = int.Parse(月份[..4]); var m = int.Parse(月份[4..]);
        if (m < 1 || m > 12) throw new System.ArgumentException("月份的月份段须在 01–12 之间。");
        var 月初 = new System.DateTime(y, m, 1);
        var 下月初 = 月初.AddMonths(1);
        using var c = factory.Create();
        var rows = await c.QueryAsync<PieceworkPayrollRow>(Sql,
            new { 月初, 下月初, 部门编号 = string.IsNullOrWhiteSpace(部门编号) ? null : 部门编号.Trim() });
        return rows.AsList();
    }
}
```

- [ ] **Step 3: DbTest** `tests/ErpApi.Tests/PieceworkPayrollServiceDbTests.cs`（seed 部门信息 P7AD1 + 人事档案 P7AE1(部门P7AD1) + 计件表：当月审核有效两条(数量10@2=20, 数量5@2=10)、他月一条、未审核一条、无效一条 → MonthlyAsync("当月",null) 该员工 计件工资=30/数量=15；部门筛选命中/不命中）：
```csharp
using Dapper;
using ErpApi.Features.Payroll;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PieceworkPayrollServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task Monthly_仅计当月审核有效()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [计件表] WHERE [员工号]=N'P7AE1'");
            c.Execute("DELETE FROM [人事档案] WHERE [编号]=N'P7AE1'");
            c.Execute("DELETE FROM [部门信息] WHERE [编号]=N'P7AD1'");
        }
        Clean();
        c.Execute("INSERT INTO [部门信息]([编号],[部门]) VALUES(N'P7AD1',N'裁床部')");
        c.Execute("INSERT INTO [人事档案]([编号],[姓名],[部门编号]) VALUES(N'P7AE1',N'张三',N'P7AD1')");
        // 当月审核有效两条（金额=数量×单价 直接给）
        c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(N'P7AE1',N'01',10,2,20,'2026-05-10','1','1')");
        c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(N'P7AE1',N'02',5,2,10,'2026-05-20','1','1')");
        // 他月（不计）
        c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(N'P7AE1',N'01',99,2,198,'2026-04-30','1','1')");
        // 未审核（不计）
        c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(N'P7AE1',N'01',99,2,198,'2026-05-15','0','1')");
        // 无效（不计）
        c.Execute("INSERT INTO [计件表]([员工号],[工序号],[数量],[单价],[金额],[日期],[审核],[有效]) VALUES(N'P7AE1',N'01',99,2,198,'2026-05-16','1','0')");
        try
        {
            var rows = await new PieceworkPayrollService(Factory()).MonthlyAsync("202605", null);
            var r = Assert.Single(rows);
            Assert.Equal("P7AE1", r.编号);
            Assert.Equal("张三", r.姓名);
            Assert.Equal("裁床部", r.部门);
            Assert.Equal(15m, r.数量);       // 10+5
            Assert.Equal(30m, r.计件工资);    // 20+10

            Assert.Single(await new PieceworkPayrollService(Factory()).MonthlyAsync("202605", "P7AD1"));
            Assert.Empty(await new PieceworkPayrollService(Factory()).MonthlyAsync("202605", "别的部门"));
        }
        finally { Clean(); }
    }
}
```
注：计件表列以 `db/01_rebuild_schema.sql` 实际为准（员工号/工序号/数量/单价/金额/日期/审核/有效 均存在，已核）。若某列 NOT NULL 无默认导致 INSERT 失败，补该列最小值。

- [ ] **Step 4: 测试（绿）** — `Get-Process -Name ErpApi ...|Stop-Process -Force`；`dotnet test tests/ErpApi.Tests --filter PieceworkPayrollServiceDbTests`（过）；全量(176)。
- [ ] **Step 5: Commit** — `git add src/ErpApi/Features/Payroll tests/ErpApi.Tests/PieceworkPayrollServiceDbTests.cs && git commit -m "feat(P7): 计件归集服务(按员工×月归集已审核有效计件工资·算法2)+DbTest"`

---

## Task 2: 控制器 + DI + 权限种子 + API 测试

**Files:** Create `src/ErpApi/Features/Payroll/PieceworkPayrollController.cs`；Modify `src/ErpApi/Program.cs`；Create `db/seed_p7a_perms.sql`；Test `tests/ErpApi.Tests/P7aPayrollApiIntegrationTests.cs`.

- [ ] **Step 1: PieceworkPayrollController.cs**
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Payroll;

// 计件归集(算法2)只读报表。打开权限可看;计件工资按 单价 权限脱敏(同 M6 计件汇总)。
[ApiController]
[Authorize]
[Route("api/payroll/piecework")]
public sealed class PieceworkPayrollController(PieceworkPayrollService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "计件归集";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> Monthly([FromQuery(Name = "月份")] string 月份, [FromQuery(Name = "部门编号")] string? 部门编号 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        IReadOnlyList<PieceworkPayrollRow> rows;
        try { rows = await svc.MonthlyAsync(月份, 部门编号); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.单价))
            foreach (var r in rows) r.计件工资 = null;
        return Ok(rows);
    }
}
```

- [ ] **Step 2: DI** `Program.cs` 追加：`builder.Services.AddScoped<ErpApi.Features.Payroll.PieceworkPayrollService>();`
- [ ] **Step 3: 权限种子** `db/seed_p7a_perms.sql`：
```sql
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单]=N'计件归集';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'计件归集',1,0,0,1,1,1,0,0,1);
```
- [ ] **Step 4: API 测试** `tests/ErpApi.Tests/P7aPayrollApiIntegrationTests.cs`（仿 `P6bReceiptsApiIntegrationTests` 的 WebApplicationFactory/JWT/Client；本测试自插权限行）：①无打开权限→403；②有打开+单价 → 200 且计件工资非空(造员工当月审核计件)；③有打开无单价 → 计件工资 null、数量非空；④月份非法(如"2026")→400。seed 部门信息/人事档案/计件表;清理删之。
- [ ] **Step 5: 测试（绿）+ Commit**
```bash
git add src/ErpApi/Features/Payroll/PieceworkPayrollController.cs src/ErpApi/Program.cs db/seed_p7a_perms.sql tests/ErpApi.Tests/P7aPayrollApiIntegrationTests.cs
git commit -m "feat(P7): 计件归集REST(打开权限·计件工资按单价权限脱敏)+权限种子+API测试"
```

---

## Task 3: 前端 — 工资管理菜单 + 计件归集报表页

**Files:** Create `web/src/api/payroll.ts`、`web/src/pages/payroll/PieceworkPayrollPage.tsx`、`web/src/utils/payroll.ts`、`web/src/__tests__/payroll.test.ts`；Modify `web/src/App.tsx`、`web/src/pages/MainLayout.tsx`.

- [ ] **Step 1: api** `web/src/api/payroll.ts`：`pieceworkPayrollApi.monthly(月份, 部门编号?)` → `PieceworkPayrollRow[]`（类型 编号/姓名/部门编号/部门/数量/计件工资）。`import { api } from "./client"`。
- [ ] **Step 2: util+单测** `web/src/utils/payroll.ts`：`toYearMonth(d)`（dayjs→yyyyMM，同 monthEnd 思路）；`web/src/__tests__/payroll.test.ts` 断言。
- [ ] **Step 3: 页面** `PieceworkPayrollPage.tsx`：DatePicker(picker="month")→月份 + 部门编号 Input 筛选 + 表格(编号/姓名/部门编号/部门/数量/计件工资)；计件工资 null 显「—」。仿 `web/src/pages/sales/ReceivablesPage.tsx` 只读报表。
- [ ] **Step 4: 菜单+路由** 新独立组 **「工资管理」**(key `pr`,图标如 `WalletOutlined`/`MoneyCollectOutlined`)：计件归集(`can('计件归集','打开')`,图标 `BarChartOutlined`)；`App.tsx` 路由 `/payroll/piecework`；Header 标题链补「计件归集」。图标按需 import。
- [ ] **Step 5: 构建+测试+Commit** — `npm --prefix web run build`(无TS错);`npm --prefix web run test -- --run`(全过);
```bash
git add web/src && git commit -m "feat(P7): 工资管理菜单+计件归集报表页+api+util测试"
```

---

## Task 4: 验证 + 收尾

- [ ] **Step 1: 全量回归** — 后端 `dotnet test tests/ErpApi.Tests`(全过)；前端 test+build(全过)。
- [ ] **Step 2: 终审** — diff 核对：只读归集、审核'1'+有效<>'0'+当月过滤、计件工资按单价权限脱敏、零改表。
- [ ] **Step 3: 授权种子** — `dotnet run --project tmp/dbquery -- $env:ERP_DB "@db/seed_p7a_perms.sql"`。
- [ ] **Step 4: 收尾** — finishing-a-development-branch：合并 master 本地→删分支→重启 5000/5173→更新记忆(erp-status 加 P7a 条目,标注 P7b 考勤 为下一步)。

---

## Self-Review

- **Spec 覆盖**：DTOs+Service+DbTest(T1)、Controller+DI+权限种子+API测试(T2)、前端菜单/页/api/util(T3)、回归收尾(T4)。按员工×月合计、只读不持久化、审核+有效+当月过滤、单价脱敏、零改表——均落实。✓
- **占位符**：DTOs/Service/DbTest/Controller/权限种子完整代码;API测试与前端页给明确结构+样板引用。✓
- **类型/命名一致**：Menu 计件归集;路由 api/payroll/piecework;DTO PieceworkPayrollRow;脱敏按 单价 权限;月份 yyyyMM。✓
- **关键坑**：审核='1' AND 有效<>'0'(双标志);部门名 LEFT JOIN 部门信息(编号→部门);日期<下月初含当月;计件工资按单价脱敏数量不脱敏;ErpApi占用先Stop-Process。✓
