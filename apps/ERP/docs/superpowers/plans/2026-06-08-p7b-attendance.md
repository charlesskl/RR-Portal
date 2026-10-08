# P7b 考勤（缺勤登记 + 月度出勤汇总）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 建缺勤登记（请假/缺勤扁平记录，录入即生效）+ 月度出勤汇总（实出勤=应出勤−缺勤，按员工×月），喂工资表。排除刷卡引擎。零改表。

**Architecture:** 缺勤登记=扁平记录 CRUD（b缺勤登记明细，无审核）；出勤汇总=只读 Dapper（人事档案 LEFT JOIN 缺勤/部门，应出勤天数为入参）。`src/ErpApi/Features/Payroll/` 续用。

**Tech Stack:** .NET 8 + Dapper；React + TS + AntD v6 + Vitest；xUnit。依据 `docs/superpowers/specs/2026-06-08-p7b-attendance-design.md`。样板：`src/ErpApi/Features/Production/Piecework/`(扁平记录CRUD)、`src/ErpApi/Features/Payroll/PieceworkPayrollService.cs`(只读月度+yyyyMM解析)。

---

## Task 1: 缺勤登记 DTOs + Service + Controller + DI + 权限种子 + DbTest

**Files:** Modify `src/ErpApi/Features/Payroll/PayrollDtos.cs`；Create `src/ErpApi/Features/Payroll/AbsenceService.cs`、`AbsenceController.cs`；Modify `src/ErpApi/Program.cs`；Create `db/seed_p7b_perms.sql`；Test `tests/ErpApi.Tests/AbsenceServiceDbTests.cs`.

- [ ] **Step 1: 追加 DTOs 到 PayrollDtos.cs**
```csharp
// ---- 缺勤登记 ----
public sealed class AbsenceCreateDto
{
    public string 工号 { get; set; } = "";
    public string? 姓名 { get; set; }
    public string? 部门 { get; set; }
    public string? 登记类型 { get; set; }
    public string? 前后段 { get; set; }
    public decimal 计算出勤 { get; set; }
    public DateTime 日期 { get; set; }
    public string? 开始时间 { get; set; }
    public string? 结束时间 { get; set; }
    public string? 事由 { get; set; }
}
public sealed class AbsenceRow
{
    public long ID { get; set; }
    public string? 工号 { get; set; }
    public string? 姓名 { get; set; }
    public string? 部门 { get; set; }
    public string? 登记类型 { get; set; }
    public string? 前后段 { get; set; }
    public decimal? 计算出勤 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 事由 { get; set; }
}

// ---- 月度出勤汇总 ----
public sealed class AttendanceMonthlyRow
{
    public string? 工号 { get; set; }
    public string? 姓名 { get; set; }
    public string? 部门编号 { get; set; }
    public string? 部门 { get; set; }
    public decimal 应出勤天数 { get; set; }
    public decimal 缺勤天数 { get; set; }
    public decimal 实出勤天数 { get; set; }
}
```

- [ ] **Step 2: AbsenceService.cs**
```csharp
using Dapper;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Payroll;

// 缺勤登记（请假/缺勤扁平记录,录入即生效,无审核）。b缺勤登记明细.工号→人事档案。
public sealed class AbsenceService(ISqlConnectionFactory factory)
{
    public async Task<long> CreateAsync(AbsenceCreateDto dto, string user)
    {
        if (string.IsNullOrWhiteSpace(dto.工号)) throw new ArgumentException("工号必填");
        if (dto.计算出勤 <= 0) throw new ArgumentException("计算出勤(缺勤折算天数)须大于0");
        using var c = factory.Create();
        return await c.ExecuteScalarAsync<long>(@"
INSERT INTO [b缺勤登记明细]([操作日期],[操作员],[工号],[姓名],[部门],[登记类型],[前后段],[计算出勤],[日期],[开始时间],[结束时间],[事由])
VALUES(@操作日期,@操作员,@工号,@姓名,@部门,@登记类型,@前后段,@计算出勤,@日期,@开始时间,@结束时间,@事由);
SELECT CAST(SCOPE_IDENTITY() AS bigint);",
            new { 操作日期 = DateTime.Now, 操作员 = user, dto.工号, dto.姓名, dto.部门, dto.登记类型, dto.前后段, dto.计算出勤, dto.日期, dto.开始时间, dto.结束时间, dto.事由 });
    }

    public async Task<PagedResult<AbsenceRow>> ListAsync(string? 月份, string? 工号, string? 部门编号, int page, int size)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        DateTime? 月初 = null, 下月初 = null;
        if (!string.IsNullOrWhiteSpace(月份))
        {
            if (月份.Length != 6 || !int.TryParse(月份, out _)) throw new ArgumentException("月份须为 6 位 yyyyMM。");
            var y = int.Parse(月份[..4]); var m = int.Parse(月份[4..]);
            if (m < 1 || m > 12) throw new ArgumentException("月份的月份段须在 01–12 之间。");
            月初 = new DateTime(y, m, 1); 下月初 = 月初.Value.AddMonths(1);
        }
        var kwGh = string.IsNullOrWhiteSpace(工号) ? null : 工号.Trim();
        var dept = string.IsNullOrWhiteSpace(部门编号) ? null : 部门编号.Trim();
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [b缺勤登记明细] q LEFT JOIN [人事档案] b ON b.[编号]=q.[工号]
WHERE (@月初 IS NULL OR (q.[日期]>=@月初 AND q.[日期]<@下月初))
  AND (@工号 IS NULL OR q.[工号]=@工号) AND (@部门编号 IS NULL OR b.[部门编号]=@部门编号);
SELECT q.[ID],q.[工号],q.[姓名],q.[部门],q.[登记类型],q.[前后段],q.[计算出勤],q.[日期],q.[事由]
FROM [b缺勤登记明细] q LEFT JOIN [人事档案] b ON b.[编号]=q.[工号]
WHERE (@月初 IS NULL OR (q.[日期]>=@月初 AND q.[日期]<@下月初))
  AND (@工号 IS NULL OR q.[工号]=@工号) AND (@部门编号 IS NULL OR b.[部门编号]=@部门编号)
ORDER BY q.[日期] DESC, q.[ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { 月初, 下月初, 工号 = kwGh, 部门编号 = dept, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<AbsenceRow>()).AsList();
        return new PagedResult<AbsenceRow>(items, total);
    }

    public async Task<bool> DeleteAsync(long id)
    {
        using var c = factory.Create();
        var n = await c.ExecuteAsync("DELETE FROM [b缺勤登记明细] WHERE [ID]=@id", new { id });
        return n > 0;
    }
}
```

- [ ] **Step 3: AbsenceController.cs**
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Payroll;

// 缺勤登记 REST（录入即生效,无审核,无金额脱敏）。
[ApiController]
[Authorize]
[Route("api/payroll/absences")]
public sealed class AbsenceController(
    AbsenceService svc, IPermissionService perms, IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "缺勤登记";
    private const string Table = "b缺勤登记明细";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    { using var c = factory.Create(); await c.OpenAsync(); await audit.WriteAsync(Table, behavior, CurrentUser, record, c); }

    [HttpGet]
    public async Task<IActionResult> List(string? 月份 = null, string? 工号 = null, string? 部门编号 = null, int page = 1, int size = 20)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        try { return Ok(await svc.ListAsync(月份, 工号, 部门编号, page, size)); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] AbsenceCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        long id;
        try { id = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "员工不存在。" }); }
        await AuditAsync("新增", $"工号={dto.工号},日期={dto.日期:yyyy-MM-dd}");
        return Ok(new { id });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(long id)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        if (!await svc.DeleteAsync(id)) return NotFound();
        await AuditAsync("删除", $"ID={id}");
        return NoContent();
    }
}
```

- [ ] **Step 4: DI** `Program.cs` 追加 `builder.Services.AddScoped<ErpApi.Features.Payroll.AbsenceService>();`
- [ ] **Step 5: 权限种子** `db/seed_p7b_perms.sql`：
```sql
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'缺勤登记',N'出勤汇总');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'缺勤登记',1,1,1,1,0,0,0,0,1),
       (@用户,N'出勤汇总',1,0,0,1,0,0,0,0,1);
```
- [ ] **Step 6: DbTest** `tests/ErpApi.Tests/AbsenceServiceDbTests.cs`：seed 人事档案 P7BE1；CreateAsync(工号 P7BE1,计算出勤1,日期当月,登记类型事假)→返回ID>0；ListAsync(当月)命中1条；DeleteAsync→true；工号不存在 Create 抛 SqlException(547) 或断言（可用 try）。清理删缺勤/人事。
- [ ] **Step 7: 测试（绿）+ Commit** — `Get-Process ...|Stop-Process -Force`；`dotnet test tests/ErpApi.Tests --filter AbsenceServiceDbTests`；全量(181)。
```bash
git add src/ErpApi/Features/Payroll/PayrollDtos.cs src/ErpApi/Features/Payroll/AbsenceService.cs src/ErpApi/Features/Payroll/AbsenceController.cs src/ErpApi/Program.cs db/seed_p7b_perms.sql tests/ErpApi.Tests/AbsenceServiceDbTests.cs
git commit -m "feat(P7): 缺勤登记(扁平记录CRUD·录入即生效·FK人事档案)+权限种子+DbTest"
```

---

## Task 2: 月度出勤汇总 Service + Controller + DI + DbTest + API 测试

**Files:** Create `src/ErpApi/Features/Payroll/AttendanceService.cs`、`AttendanceController.cs`；Modify `src/ErpApi/Program.cs`；Test `tests/ErpApi.Tests/AttendanceServiceDbTests.cs`、`tests/ErpApi.Tests/P7bAttendanceApiIntegrationTests.cs`.

- [ ] **Step 1: AttendanceService.cs**
```csharp
using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Payroll;

// 月度出勤汇总：实出勤天数 = 应出勤天数(入参) − 缺勤天数(Σ缺勤登记.计算出勤,当月)。列出在职员工。只读。
public sealed class AttendanceService(ISqlConnectionFactory factory)
{
    private const string Sql = @"
SELECT b.[编号] AS 工号, MAX(b.[姓名]) AS 姓名, b.[部门编号], MAX(d.[部门]) AS 部门,
       @应出勤天数 AS 应出勤天数,
       ISNULL(SUM(q.[计算出勤]),0) AS 缺勤天数,
       @应出勤天数 - ISNULL(SUM(q.[计算出勤]),0) AS 实出勤天数
FROM [人事档案] b
LEFT JOIN [b缺勤登记明细] q ON q.[工号]=b.[编号] AND q.[日期] >= @月初 AND q.[日期] < @下月初
LEFT JOIN [部门信息] d ON d.[编号]=b.[部门编号]
WHERE ISNULL(b.[在职],'1')='1' AND (@部门编号 IS NULL OR b.[部门编号]=@部门编号)
GROUP BY b.[编号], b.[部门编号]
ORDER BY b.[部门编号], b.[编号];";

    public async Task<IReadOnlyList<AttendanceMonthlyRow>> MonthlyAsync(string 月份, decimal 应出勤天数, string? 部门编号)
    {
        if (string.IsNullOrWhiteSpace(月份) || 月份.Length != 6 || !int.TryParse(月份, out _))
            throw new System.ArgumentException("月份须为 6 位 yyyyMM。");
        var y = int.Parse(月份[..4]); var m = int.Parse(月份[4..]);
        if (m < 1 || m > 12) throw new System.ArgumentException("月份的月份段须在 01–12 之间。");
        var 月初 = new System.DateTime(y, m, 1); var 下月初 = 月初.AddMonths(1);
        using var c = factory.Create();
        var rows = await c.QueryAsync<AttendanceMonthlyRow>(Sql,
            new { 月初, 下月初, 应出勤天数, 部门编号 = string.IsNullOrWhiteSpace(部门编号) ? null : 部门编号.Trim() });
        return rows.AsList();
    }
}
```

- [ ] **Step 2: AttendanceController.cs**
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Payroll;

// 月度出勤汇总只读报表（无金额,不脱敏）。打开权限可看。
[ApiController]
[Authorize]
[Route("api/payroll/attendance")]
public sealed class AttendanceController(AttendanceService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "出勤汇总";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> Monthly(
        [FromQuery(Name = "月份")] string 月份,
        [FromQuery(Name = "应出勤天数")] decimal 应出勤天数 = 0,
        [FromQuery(Name = "部门编号")] string? 部门编号 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        try { return Ok(await svc.MonthlyAsync(月份, 应出勤天数, 部门编号)); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
    }
}
```

- [ ] **Step 3: DI** `Program.cs` 追加 `builder.Services.AddScoped<ErpApi.Features.Payroll.AttendanceService>();`

- [ ] **Step 4: DbTest** `tests/ErpApi.Tests/AttendanceServiceDbTests.cs`：seed 部门信息 P7BD1 + 人事档案 两人(P7BE1 在职'1' 部门P7BD1、P7BE2 在职'1')+ 1人离职(P7BE0 在职'0')；缺勤登记 P7BE1 当月两条(计算出勤 1+1=2)；MonthlyAsync("当月",26,null) → P7BE1 缺勤2/实出勤24、P7BE2 缺勤0/实出勤26、P7BE0(离职)不出现；部门筛选 P7BD1 命中。清理。
```csharp
// 关键断言：
var rows = await new AttendanceService(Factory()).MonthlyAsync("202605", 26m, null);
var e1 = rows.First(r => r.工号 == "P7BE1");
Assert.Equal(2m, e1.缺勤天数); Assert.Equal(24m, e1.实出勤天数);
var e2 = rows.First(r => r.工号 == "P7BE2");
Assert.Equal(0m, e2.缺勤天数); Assert.Equal(26m, e2.实出勤天数);
Assert.DoesNotContain(rows, r => r.工号 == "P7BE0");
```
（seed 人事档案 含 在职 列；缺勤用直接 INSERT [b缺勤登记明细]([工号],[计算出勤],[日期]) VALUES(...)）。

- [ ] **Step 5: API 测试** `tests/ErpApi.Tests/P7bAttendanceApiIntegrationTests.cs`（仿 P7a）：①缺勤登记无保存→403、生命周期 create→list(命中)→delete；②出勤汇总无打开→403、有打开→200 实出勤=应出勤−缺勤；③月份非法→400。seed 人事/部门/缺勤;权限种子内联。
- [ ] **Step 6: 测试（绿）+ Commit**
```bash
git add src/ErpApi/Features/Payroll/AttendanceService.cs src/ErpApi/Features/Payroll/AttendanceController.cs src/ErpApi/Program.cs tests/ErpApi.Tests/AttendanceServiceDbTests.cs tests/ErpApi.Tests/P7bAttendanceApiIntegrationTests.cs
git commit -m "feat(P7): 月度出勤汇总(实出勤=应出勤入参-缺勤·列出在职员工)+DbTest+API测试"
```

---

## Task 3: 前端 — 缺勤登记页 + 出勤汇总页

**Files:** Modify `web/src/api/payroll.ts`、`web/src/App.tsx`、`web/src/pages/MainLayout.tsx`；Create `web/src/pages/payroll/AbsencePage.tsx`、`web/src/pages/payroll/AttendancePage.tsx`；Modify `web/src/__tests__/payroll.test.ts`.

- [ ] **Step 1: api 追加** `payroll.ts`：`absenceApi`(list(月份?,工号?,部门编号?,page,size)/create/remove)、`attendanceApi.monthly(月份,应出勤天数,部门编号?)` + 类型 `AbsenceRow/AbsenceCreate/AttendanceMonthlyRow`。
- [ ] **Step 2: 缺勤登记页** `AbsencePage.tsx`：列表(月份/工号筛选)+新建抽屉(工号/登记类型 Select[事假/病假/年假/旷工/其他]/日期/计算出勤(缺勤天数 InputNumber)/前后段 Select[全天/上午/下午]/事由)+删除。仿计件录入/单据页模式,按 `can('缺勤登记',...)` 控权。
- [ ] **Step 3: 出勤汇总页** `AttendancePage.tsx`：月份(month picker)+应出勤天数(InputNumber,默认26)+部门编号筛选 → 表格(工号/姓名/部门/应出勤天数/缺勤天数/实出勤天数,实出勤<应出勤红色)。只读,仿计件归集页。
- [ ] **Step 4: 菜单+路由** 「工资管理」组追加 缺勤登记(`can('缺勤登记','打开')`,图标如 `CalendarOutlined`)、出勤汇总(`can('出勤汇总','打开')`,图标 `ScheduleOutlined`/`SolutionOutlined`)；`App.tsx` 路由 `/payroll/absences`、`/payroll/attendance`；Header 标题链补。图标按需 import。
- [ ] **Step 5: util 测试** `payroll.test.ts` 加一条（如 `实出勤=应出勤−缺勤` 的纯函数 `netAttendance(应出勤,缺勤)` + 断言，放 `web/src/utils/payroll.ts`）。
- [ ] **Step 6: 构建+测试+Commit** — `npm --prefix web run build`(无TS错);`npm --prefix web run test -- --run`(全过);
```bash
git add web/src && git commit -m "feat(P7): 缺勤登记页+月度出勤汇总页+api+util测试"
```

---

## Task 4: 验证 + 收尾

- [ ] **Step 1: 全量回归** — 后端 `dotnet test tests/ErpApi.Tests`(全过)；前端 test+build(全过)。
- [ ] **Step 2: 终审** — diff 核对：缺勤登记录入即生效(无审核)、出勤汇总只读应出勤入参−缺勤、列在职员工、零改表、无金额脱敏。
- [ ] **Step 3: 授权种子** — `dotnet run --project tmp/dbquery -- $env:ERP_DB "@db/seed_p7b_perms.sql"`。
- [ ] **Step 4: 收尾** — finishing-a-development-branch：合并 master 本地→删分支→重启 5000/5173→更新记忆(erp-status 加 P7b 条目,标注 P7c 工资模板/公式 为下一步)。

---

## Self-Review

- **Spec 覆盖**：缺勤登记全栈+权限种子+DbTest(T1)、出勤汇总+API(T2)、前端(T3)、回归收尾(T4)。缺勤登记扁平录入即生效、出勤汇总应出勤入参−缺勤、列在职、零改表、考勤无金额无脱敏、排除刷卡引擎——均落实。✓
- **占位符**：DTOs/AbsenceService/Controller/AttendanceService/Controller/权限种子完整代码;DbTest给关键断言;API测试与前端给明确结构。✓
- **类型/命名一致**：Menu 缺勤登记/出勤汇总;路由 api/payroll/absences、api/payroll/attendance;DTO Absence*/AttendanceMonthlyRow;计算出勤=缺勤折算天数;实出勤=应出勤−缺勤。✓
- **关键坑**：b缺勤登记明细.工号 FK→人事档案(547→400);在职 ISNULL(,'1')='1'(测试种'1',真实数据按需调);缺勤无审核录入即生效;考勤无金额不脱敏;日期<下月初含当月;ErpApi占用先Stop-Process。✓
