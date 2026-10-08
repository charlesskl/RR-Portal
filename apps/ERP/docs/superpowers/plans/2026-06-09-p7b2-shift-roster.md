# P7b 全刷卡引擎 · 第一片：班次管理 + 排班 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 班次模板 CRUD(考勤_排班表) + 排班(排班表,批量按 工号×日期范围 派班次)。为第二片刷卡日报引擎备好班次/排班数据。零改表。

**Architecture:** ShiftService(考勤_排班表 CRUD,时刻 "HH:mm"↔datetime,识别唯一,排班ID MAX+1)+RosterService(排班表 CRUD+批量Assign,ID MAX+1,工号+日期去重)+两控制器+新「考勤管理」菜单组。`src/ErpApi/Features/Payroll/`。

**Tech Stack:** .NET 8 + Dapper；React + TS + AntD v6 + Vitest；xUnit。依据 `docs/superpowers/specs/2026-06-09-p7b-punch-engine-design.md`。样板：P7b AbsenceService/AttendanceService、P7c WageTemplateService(整组/MERGE)、P5c(real列CAST)。

---

## Task 1: 班次服务 ShiftService + DTOs + DbTest

**Files:** Modify `src/ErpApi/Features/Payroll/PayrollDtos.cs`(加班次/排班DTO)；Create `src/ErpApi/Features/Payroll/ShiftService.cs`；Test `tests/ErpApi.Tests/ShiftServiceDbTests.cs`.

- [ ] **Step 1: DTOs** 追加 PayrollDtos.cs：
```csharp
// ---- 考勤·班次 ----
public sealed class ShiftDto
{
    public string 识别 { get; set; } = ""; public string? 名称 { get; set; }
    public string? 上午上班 { get; set; } public string? 上午下班 { get; set; }   // "HH:mm"
    public string? 下午上班 { get; set; } public string? 下午下班 { get; set; }
    public decimal? 总小时 { get; set; } public decimal? 迟到分钟 { get; set; } public decimal? 早退分钟 { get; set; }
}
public sealed class ShiftRow
{
    public string? 识别 { get; set; } public string? 名称 { get; set; }
    public string? 上午上班 { get; set; } public string? 上午下班 { get; set; }
    public string? 下午上班 { get; set; } public string? 下午下班 { get; set; }
    public decimal? 总小时 { get; set; } public decimal? 迟到分钟 { get; set; } public decimal? 早退分钟 { get; set; }
}
// ---- 考勤·排班 ----
public sealed class RosterRow
{ public string? 工号 { get; set; } public string? 姓名 { get; set; } public DateTime? 日期 { get; set; } public string? 班次 { get; set; } }
public sealed class RosterAssignDto
{ public List<string> 工号集合 { get; set; } = []; public DateTime 开始日期 { get; set; } public DateTime 结束日期 { get; set; } public string 班次 { get; set; } = ""; }
```

- [ ] **Step 2: ShiftService.cs**（考勤_排班表 CRUD；时刻 "HH:mm"↔基准日 datetime；识别唯一；排班ID MAX+1）：
```csharp
using System.Globalization;
using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Payroll;

// 班次模板(考勤_排班表)CRUD。时刻列存基准日 1900-01-01 + HH:mm;读出格式化 "HH:mm"。按 识别 唯一。
public sealed class ShiftService(ISqlConnectionFactory factory)
{
    private static readonly DateTime Base = new(1900, 1, 1);
    private static DateTime? ParseHm(string? hm)
        => string.IsNullOrWhiteSpace(hm) || !TimeSpan.TryParse(hm, CultureInfo.InvariantCulture, out var t) ? null : Base + t;
    private static string? FmtHm(DateTime? d) => d?.ToString("HH:mm");

    public async Task<IReadOnlyList<ShiftRow>> ListAsync(string? keyword)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
SELECT [识别],[名称],[上午上班],[上午下班],[下午上班],[下午下班],[总小时],[迟到分钟],[早退分钟]
FROM [考勤_排班表] WHERE @kw IS NULL OR [识别] LIKE @kw OR [名称] LIKE @kw ORDER BY [识别];", new { kw });
        return rows.Select(r => new ShiftRow {
            识别 = r.识别, 名称 = r.名称,
            上午上班 = FmtHm((DateTime?)r.上午上班), 上午下班 = FmtHm((DateTime?)r.上午下班),
            下午上班 = FmtHm((DateTime?)r.下午上班), 下午下班 = FmtHm((DateTime?)r.下午下班),
            总小时 = (decimal?)(double?)r.总小时, 迟到分钟 = (decimal?)(double?)r.迟到分钟, 早退分钟 = (decimal?)(double?)r.早退分钟
        }).ToList();
    }

    public async Task<ShiftRow?> GetAsync(string 识别)
        => (await ListAsync(null)).FirstOrDefault(x => x.识别 == 识别)
           ?? ((await GetRawAsync(识别)) is null ? null : null);
    private async Task<dynamic?> GetRawAsync(string 识别)
    { using var c = factory.Create(); return await c.QueryFirstOrDefaultAsync("SELECT [识别] FROM [考勤_排班表] WHERE [识别]=@识别", new { 识别 }); }

    public async Task SaveAsync(ShiftDto dto, string user)
    {
        if (string.IsNullOrWhiteSpace(dto.识别)) throw new ArgumentException("识别必填");
        using var c = factory.Create();
        await c.OpenAsync();
        var exists = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM [考勤_排班表] WHERE [识别]=@识别", new { dto.识别 });
        var p = new {
            dto.识别, dto.名称,
            上午上班 = ParseHm(dto.上午上班), 上午下班 = ParseHm(dto.上午下班),
            下午上班 = ParseHm(dto.下午上班), 下午下班 = ParseHm(dto.下午下班),
            总小时 = dto.总小时, 迟到分钟 = dto.迟到分钟, 早退分钟 = dto.早退分钟
        };
        if (exists > 0)
            await c.ExecuteAsync(@"UPDATE [考勤_排班表] SET [名称]=@名称,[上午上班]=@上午上班,[上午下班]=@上午下班,
[下午上班]=@下午上班,[下午下班]=@下午下班,[总小时]=@总小时,[迟到分钟]=@迟到分钟,[早退分钟]=@早退分钟 WHERE [识别]=@识别", p);
        else
        {
            var nextId = await c.ExecuteScalarAsync<long>("SELECT ISNULL(MAX([排班ID]),0)+1 FROM [考勤_排班表]");
            await c.ExecuteAsync(@"INSERT INTO [考勤_排班表]([排班ID],[识别],[名称],[上午上班],[上午下班],[下午上班],[下午下班],[总小时],[迟到分钟],[早退分钟])
VALUES(@nextId,@识别,@名称,@上午上班,@上午下班,@下午上班,@下午下班,@总小时,@迟到分钟,@早退分钟)",
                new { nextId, p.识别, p.名称, p.上午上班, p.上午下班, p.下午上班, p.下午下班, p.总小时, p.迟到分钟, p.早退分钟 });
        }
    }

    public async Task<bool> DeleteAsync(string 识别)
    { using var c = factory.Create(); return await c.ExecuteAsync("DELETE FROM [考勤_排班表] WHERE [识别]=@识别", new { 识别 }) > 0; }
}
```
（注:`GetAsync` 简化为从 ListAsync 找;若嫌啰嗦可直接写单条 SELECT+格式化。real 列 `(decimal?)(double?)r.列` 转换。）

- [ ] **Step 3: DbTest** `ShiftServiceDbTests.cs`：`new ShiftService(Factory())`。Save(ShiftDto{识别="S1",名称="常日班",上午上班="08:00",上午下班="12:00",下午上班="13:00",下午下班="17:00",总小时=8,迟到分钟=5,早退分钟=5})→GetAsync("S1") 上午上班=="08:00"、下午下班=="17:00"、迟到分钟==5;再 Save 同识别改名称→ListAsync 仍1条(更新非重复)且名称变;DeleteAsync("S1")→ListAsync 无。清理删 S1。
- [ ] **Step 4: 测试(绿)+Commit**
```bash
git add src/ErpApi/Features/Payroll/PayrollDtos.cs src/ErpApi/Features/Payroll/ShiftService.cs tests/ErpApi.Tests/ShiftServiceDbTests.cs
git commit -m "feat(P7b): 班次服务(考勤_排班表CRUD·HH:mm时刻·识别唯一·排班ID MAX+1)+DbTest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 排班服务 RosterService + DbTest

**Files:** Create `src/ErpApi/Features/Payroll/RosterService.cs`；Test `tests/ErpApi.Tests/RosterServiceDbTests.cs`.

- [ ] **Step 1: RosterService.cs**：
```csharp
using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Payroll;

// 排班(排班表)。批量按 工号×日期范围 派班次;工号+日期去重(存在则更新);ID MAX+1。
public sealed class RosterService(ISqlConnectionFactory factory)
{
    public async Task<IReadOnlyList<RosterRow>> ListAsync(DateTime 开始, DateTime 结束, string? 部门编号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<RosterRow>(@"
SELECT r.[工号],r.[姓名],r.[日期],r.[班次]
FROM [排班表] r LEFT JOIN [人事档案] e ON e.[编号]=r.[工号]
WHERE r.[日期]>=@开始 AND r.[日期]<=@结束 AND (@部门编号 IS NULL OR e.[部门编号]=@部门编号)
ORDER BY r.[日期], r.[工号];", new { 开始, 结束, 部门编号 = string.IsNullOrWhiteSpace(部门编号) ? null : 部门编号 });
        return rows.AsList();
    }

    public async Task AssignAsync(RosterAssignDto dto, string user)
    {
        if (dto.工号集合.Count == 0) throw new ArgumentException("请选择工号");
        if (string.IsNullOrWhiteSpace(dto.班次)) throw new ArgumentException("班次必填");
        if (dto.结束日期 < dto.开始日期) throw new ArgumentException("结束日期不能早于开始日期");
        using var c = factory.Create();
        await c.OpenAsync();
        var shiftOk = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM [考勤_排班表] WHERE [识别]=@班次", new { dto.班次 });
        if (shiftOk == 0) throw new ArgumentException("班次不存在");
        using var tx = c.BeginTransaction();
        for (var d = dto.开始日期.Date; d <= dto.结束日期.Date; d = d.AddDays(1))
            foreach (var 工号 in dto.工号集合)
            {
                var 姓名 = await c.ExecuteScalarAsync<string?>("SELECT [姓名] FROM [人事档案] WHERE [编号]=@工号", new { 工号 }, tx);
                var n = await c.ExecuteAsync("UPDATE [排班表] SET [班次]=@班次,[姓名]=@姓名 WHERE [工号]=@工号 AND [日期]=@d",
                    new { dto.班次, 姓名, 工号, d }, tx);
                if (n == 0)
                {
                    var nextId = await c.ExecuteScalarAsync<long>("SELECT ISNULL(MAX([ID]),0)+1 FROM [排班表]", transaction: tx);
                    await c.ExecuteAsync("INSERT INTO [排班表]([ID],[工号],[姓名],[日期],[班次]) VALUES(@nextId,@工号,@姓名,@d,@班次)",
                        new { nextId, 工号, 姓名, d, dto.班次 }, tx);
                }
            }
        tx.Commit();
    }

    public async Task<bool> RemoveAsync(string 工号, DateTime 日期)
    { using var c = factory.Create(); return await c.ExecuteAsync("DELETE FROM [排班表] WHERE [工号]=@工号 AND [日期]=@d", new { 工号, d = 日期.Date }) > 0; }
}
```

- [ ] **Step 2: DbTest** `RosterServiceDbTests.cs`：seed 人事档案(编号 R_E1,姓名,部门 R_D1) + 班次(考勤_排班表 识别 R_S1)。Assign({工号集合=[R_E1],开始=某日,结束=次日,班次=R_S1})→ListAsync(开始,结束) 命中2条且班次=R_S1;再 Assign 同工号同首日 班次仍R_S1(改名/重派)→ListAsync 仍2条(首日更新非新增);Remove(R_E1,首日)→1条。班次不存在→Assign 抛 ArgumentException。清理删 排班表(R_E1)+人事(R_E1)+考勤_排班表(R_S1)。
- [ ] **Step 3: 测试(绿)+Commit**
```bash
git add src/ErpApi/Features/Payroll/RosterService.cs tests/ErpApi.Tests/RosterServiceDbTests.cs
git commit -m "feat(P7b): 排班服务(排班表批量派班·工号+日期去重·ID MAX+1·校验班次存在)+DbTest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 控制器 + DI + 权限种子 + MenuCatalog + API 测试

**Files:** Create `src/ErpApi/Features/Payroll/ShiftController.cs`、`RosterController.cs`；Modify `src/ErpApi/Program.cs`、`src/ErpApi/Features/Admin/MenuCatalog.cs`；Create `db/seed_p7b2_perms.sql`；Test `tests/ErpApi.Tests/P7b2ShiftRosterApiIntegrationTests.cs`.

- [ ] **Step 1: ShiftController.cs**（`api/attendance/shifts`，Menu `班次管理`，仿 AbsenceController：CurrentUser/AllowAsync/AuditAsync）：GET list(keyword,打开)/GET {识别}(打开,404)/POST save(保存;catch ArgumentException→400)/DELETE {识别}(删除,404)。审计 保存/删除。
- [ ] **Step 2: RosterController.cs**（`api/attendance/rosters`，Menu `排班`）：GET list(开始,结束,部门编号?,打开;开始/结束必填)/POST assign(保存;catch ArgumentException→400;审计)/DELETE(删除;query 工号+日期;404)。
- [ ] **Step 3: DI** Program.cs：`AddScoped<ShiftService>()`、`AddScoped<RosterService>()`（命名空间 ErpApi.Features.Payroll）。
- [ ] **Step 4: MenuCatalog 同步** 在 `MenuCatalog.All` 加（系统管理 之前或工资管理 之后）：
```csharp
        new("考勤管理","班次管理"), new("考勤管理","排班"),
```
（第二片再加 刷卡录入。）
- [ ] **Step 5: 权限种子** `db/seed_p7b2_perms.sql`：
```sql
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'班次管理',N'排班');
INSERT INTO [userbqrpower]([用户],[名称],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,@用户,N'班次管理',1,1,1,1,0,0,0,0,1),
       (@用户,@用户,N'排班',1,1,1,1,0,0,0,0,1);
```
- [ ] **Step 6: API 测试** `P7b2ShiftRosterApiIntegrationTests.cs`（仿 P7b API 测试，内联种权限）：①无权限 用户→GET shifts / GET rosters→403。②有权限：POST shifts(save S1)→200;GET shifts?keyword=S1 命中;GET shifts/S1 时刻"HH:mm";seed 人事(API_E1)→POST rosters/assign({工号集合:[API_E1],开始,结束同日,班次:S1})→200;GET rosters?开始=&结束= 命中;DELETE rosters?工号=API_E1&日期=→204;DELETE shifts/S1→204。清理。
- [ ] **Step 7: 测试(绿)+Commit**
```bash
git add src/ErpApi/Features/Payroll/ShiftController.cs src/ErpApi/Features/Payroll/RosterController.cs src/ErpApi/Program.cs src/ErpApi/Features/Admin/MenuCatalog.cs db/seed_p7b2_perms.sql tests/ErpApi.Tests/P7b2ShiftRosterApiIntegrationTests.cs
git commit -m "feat(P7b): 班次/排班REST(api/attendance/shifts·rosters)+DI+权限种子+MenuCatalog考勤管理组+API测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 前端 — 考勤管理菜单 + 班次管理页 + 排班页

**Files:** Create `web/src/api/attendance.ts`、`web/src/pages/attendance/ShiftPage.tsx`、`web/src/pages/attendance/RosterPage.tsx`、`web/src/utils/attendance.ts`、`web/src/__tests__/attendance.test.ts`；Modify `web/src/App.tsx`、`web/src/pages/MainLayout.tsx`.

- [ ] **Step 1: api** `web/src/api/attendance.ts`：`shiftApi`(list(keyword?)/get(识别)/save(body)/remove(识别))、`rosterApi`(list(开始,结束,部门编号?)/assign(body)/remove(工号,日期)) + 类型 ShiftRow/RosterRow。`import { api } from "./client"`,enc。
- [ ] **Step 2: util+单测** `web/src/utils/attendance.ts`：`isValidHm(s)` ("HH:mm" 校验,正则 `^([01]\d|2[0-3]):[0-5]\d$`);`web/src/__tests__/attendance.test.ts` 断言("08:00"真,"25:00"假,""假)。
- [ ] **Step 3: 班次页** `ShiftPage.tsx`：列表(识别/名称/上午上班-上午下班/下午上班-下午下班/总小时/迟到分钟/早退分钟)+新建/编辑抽屉(识别[编辑只读]/名称/4个 TimePicker 或 Input"HH:mm"/总小时/迟到分钟/早退分钟 InputNumber)+删除 Popconfirm。`can('班次管理',...)` 控权。时刻可用 AntD `TimePicker format="HH:mm"` 取值转字符串,或 Input + isValidHm 校验。
- [ ] **Step 4: 排班页** `RosterPage.tsx`：筛选(开始/结束 DatePicker + 部门编号 Input)→列表(工号/姓名/日期/班次);批量排班(选工号[多选 Input 或 Select]/日期范围 RangePicker/班次 Select[shiftApi.list]→派班按钮 保存权限);行删除(删除权限)。
- [ ] **Step 5: 菜单+路由** 新顶级组 **「考勤管理」**(key `att`,图标 `ScheduleOutlined`/`ClockCircleOutlined`)→ 班次管理(`can('班次管理','打开')`)/排班(`can('排班','打开')`);`App.tsx` 路由 `/attendance/shifts`、`/attendance/rosters`;Header 标题链补。图标按需 import。
- [ ] **Step 6: 构建+测试+Commit**
```bash
npm --prefix web run build; npm --prefix web run test -- --run
git add web/src && git commit -m "feat(P7b): 考勤管理菜单+班次管理页+排班页+api+util测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 验证 + 收尾

- [ ] **Step 1: 全量回归** — 后端 `dotnet test tests/ErpApi.Tests`(全过)；前端 test+build(全过)。
- [ ] **Step 2: 终审** — diff 核对：时刻 HH:mm↔datetime、识别/工号+日期 去重、排班ID/ID MAX+1、班次存在校验、MenuCatalog 已同步考勤管理组、零改表。
- [ ] **Step 3: 授权种子** — `dotnet run --project tmp/dbquery -- $env:ERP_DB "@db/seed_p7b2_perms.sql"`。
- [ ] **Step 4: 收尾** — finishing-a-development-branch：合并 master 本地→删分支→重启 5000/5173→更新记忆(P7b 增强第一片:班次管理+排班已建,下一步第二片刷卡日报引擎+月汇总;MenuCatalog 已加考勤管理组)。

---

## Self-Review

- **Spec(第一片)覆盖**：班次服务+DbTest(T1)、排班服务+DbTest(T2)、控制器+DI+种子+MenuCatalog+API(T3)、前端(T4)、回归收尾(T5)。✓
- **占位符**：ShiftService/RosterService/DTOs/种子/MenuCatalog 行 完整;DbTest 给精确断言;控制器/前端给明确结构(仿 AbsenceController)。✓
- **类型/命名一致**：Menu 班次管理/排班;路由 api/attendance/shifts·rosters;DTO ShiftDto/Row·RosterRow/AssignDto;时刻 "HH:mm";识别唯一;工号+日期去重。✓
- **关键坑**：考勤_排班表.排班ID 与 排班表.ID 都 bigint NULL 非自增→MAX+1;时刻 datetime 存 1900-01-01+HH:mm,读格式化;real 列(总小时/迟到分钟)`(decimal?)(double?)`;Assign 校验班次存在+工号+日期去重(更新);**MenuCatalog 必须同步**(gotcha#9)否则权限矩阵无新菜单;提交带 Co-Authored-By trailer;ErpApi 占用先 Stop-Process。✓
