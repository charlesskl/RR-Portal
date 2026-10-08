# P7b 全刷卡引擎 · 第二片：刷卡录入 + 日报计算引擎 + 月汇总 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 手工录每日刷卡时刻,引擎按算法10配对班次算 迟到/早退/加班/出勤工时 写日报表;月度考勤汇总增强(出勤工时/加班/迟到早退次数)。完成全刷卡引擎。零改表。

**Architecture:** AttendanceEngine(纯函数算法10,刷卡配对两段班次)+DailyReportService(取排班→班次→引擎→日报表整条替换)+DailyReportController+AttendanceService.MonthlyAsync增强(LEFT JOIN 日报表聚合)。`src/ErpApi/Features/Payroll/`。依据 `docs/superpowers/specs/2026-06-09-p7b-punch-engine-design.md` 第二片。样板:P7d FormulaEvaluator(纯函数引擎+单测)、P7d PayrollService(动态列/整条替换)、第一片 ShiftService/RosterService。

---

## Task 1: 计算引擎 AttendanceEngine + 单测

**Files:** Create `src/ErpApi/Features/Payroll/AttendanceEngine.cs`；Test `tests/ErpApi.Tests/AttendanceEngineTests.cs`.

- [ ] **Step 1: AttendanceEngine.cs**（纯函数,算法10,verbatim）：
```csharp
namespace ErpApi.Features.Payroll;

public sealed record ShiftDef(
    TimeSpan? 上午上班, TimeSpan? 上午下班, TimeSpan? 下午上班, TimeSpan? 下午下班,
    double 迟到宽限, double 早退宽限);

public sealed record DailyResult(
    double 上午, double 下午, double 合计, double 加班,
    int 迟到分, int 早退分, int 迟到次数, int 早退次数);

// 算法10:刷卡配对班次→迟到/早退/加班/出勤工时。两段(上午+下午)+宽限。纯函数无DB。
// 配对简化:午休中点分上午/下午两组;每组最早=上班刷卡、最晚=下班刷卡。
public static class AttendanceEngine
{
    public static DailyResult Compute(IReadOnlyList<TimeSpan> 刷卡, ShiftDef 班次)
    {
        var punches = 刷卡.Where(t => t >= TimeSpan.Zero).OrderBy(t => t).ToList();
        if (punches.Count == 0 || 班次.上午上班 is null)
            return new DailyResult(0, 0, 0, 0, 0, 0, 0, 0);

        bool hasPm = 班次.下午上班 is not null && 班次.下午下班 is not null;
        var lunchMid = hasPm
            ? TimeSpan.FromTicks(((班次.上午下班 ?? 班次.上午上班.Value).Ticks + 班次.下午上班!.Value.Ticks) / 2)
            : TimeSpan.MaxValue;

        var am = punches.Where(t => t <= lunchMid).ToList();
        var pm = punches.Where(t => t > lunchMid).ToList();

        double 上午 = 0, 下午 = 0, 加班 = 0;
        int 迟到分 = 0, 早退分 = 0;

        if (am.Count > 0)
        {
            var amIn = am[0]; var amOut = am[^1];
            var sIn = 班次.上午上班.Value; var sOut = 班次.上午下班 ?? amOut;
            迟到分 = Clamp((int)Math.Round((amIn - sIn).TotalMinutes) - (int)班次.迟到宽限);
            上午 = WorkedHours(Max(amIn, sIn), Min(amOut, sOut));
            if (!hasPm)
            {
                早退分 = Clamp((int)Math.Round((sOut - amOut).TotalMinutes) - (int)班次.早退宽限);
                加班 = Math.Max(0, (amOut - sOut).TotalMinutes) / 60.0;
            }
        }
        if (hasPm && pm.Count > 0)
        {
            var pmIn = pm[0]; var pmOut = pm[^1];
            var sIn = 班次.下午上班!.Value; var sOut = 班次.下午下班!.Value;
            下午 = WorkedHours(Max(pmIn, sIn), Min(pmOut, sOut));
            早退分 = Clamp((int)Math.Round((sOut - pmOut).TotalMinutes) - (int)班次.早退宽限);
            加班 = Math.Max(0, (pmOut - sOut).TotalMinutes) / 60.0;
        }

        return new DailyResult(
            Round2(上午), Round2(下午), Round2(上午 + 下午), Round2(加班),
            迟到分, 早退分, 迟到分 > 0 ? 1 : 0, 早退分 > 0 ? 1 : 0);
    }

    private static int Clamp(int v) => v < 0 ? 0 : v;
    private static TimeSpan Max(TimeSpan a, TimeSpan b) => a > b ? a : b;
    private static TimeSpan Min(TimeSpan a, TimeSpan b) => a < b ? a : b;
    private static double WorkedHours(TimeSpan from, TimeSpan to) => to > from ? (to - from).TotalHours : 0;
    private static double Round2(double v) => Math.Round(v, 2);
}
```

- [ ] **Step 2: 单测** `tests/ErpApi.Tests/AttendanceEngineTests.cs`（纯单测,无DB）：
```csharp
using ErpApi.Features.Payroll;
using Xunit;

public class AttendanceEngineTests
{
    private static readonly ShiftDef 常日班 = new(
        new TimeSpan(8,0,0), new TimeSpan(12,0,0), new TimeSpan(13,0,0), new TimeSpan(17,0,0), 5, 5);
    private static DailyResult Run(ShiftDef s, params string[] hhmm)
        => AttendanceEngine.Compute(hhmm.Select(TimeSpan.Parse).ToList(), s);

    [Fact] public void 全勤无迟到早退加班()
    { var r = Run(常日班, "08:00","12:00","13:00","17:00");
      Assert.Equal(0, r.迟到分); Assert.Equal(0, r.早退分); Assert.Equal(0, r.加班);
      Assert.Equal(4, r.上午); Assert.Equal(4, r.下午); Assert.Equal(8, r.合计); }

    [Fact] public void 迟到20分扣宽限5()
    { var r = Run(常日班, "08:20","12:00","13:00","17:00");
      Assert.Equal(15, r.迟到分); Assert.Equal(1, r.迟到次数); }

    [Fact] public void 宽限内不算迟到()
    { var r = Run(常日班, "08:04","12:00","13:00","17:00");
      Assert.Equal(0, r.迟到分); Assert.Equal(0, r.迟到次数); }

    [Fact] public void 早退()
    { var r = Run(常日班, "08:00","12:00","13:00","16:30");
      Assert.Equal(25, r.早退分); Assert.Equal(1, r.早退次数); }

    [Fact] public void 加班1小时()
    { var r = Run(常日班, "08:00","12:00","13:00","18:00");
      Assert.Equal(1.0, r.加班); Assert.Equal(0, r.早退分); }

    [Fact] public void 只上午班()
    { var s = new ShiftDef(new TimeSpan(8,0,0), new TimeSpan(12,0,0), null, null, 5, 5);
      var r = Run(s, "08:00","12:00");
      Assert.Equal(4, r.上午); Assert.Equal(0, r.下午); Assert.Equal(4, r.合计); Assert.Equal(0, r.加班); }

    [Fact] public void 空刷卡为零()
    { var r = AttendanceEngine.Compute(new List<TimeSpan>(), 常日班);
      Assert.Equal(0, r.合计); Assert.Equal(0, r.迟到分); }
}
```

- [ ] **Step 3: 测试(绿)** — `Get-Process ...|Stop-Process -Force`;`dotnet test tests/ErpApi.Tests --filter AttendanceEngineTests`(7过,0跳过);全量(227)。
- [ ] **Step 4: Commit**
```bash
git add src/ErpApi/Features/Payroll/AttendanceEngine.cs tests/ErpApi.Tests/AttendanceEngineTests.cs
git commit -m "feat(P7b): 考勤计算引擎AttendanceEngine(算法10·刷卡配对两段班次·迟到/早退/加班/工时·宽限)+单测

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 日报服务 DailyReportService + DbTest

**Files:** Modify `src/ErpApi/Features/Payroll/PayrollDtos.cs`(加日报DTO)；Create `src/ErpApi/Features/Payroll/DailyReportService.cs`；Test `tests/ErpApi.Tests/DailyReportServiceDbTests.cs`.

- [ ] **Step 1: DTOs** 追加 PayrollDtos.cs：
```csharp
// ---- 考勤·日报 ----
public sealed class DailySaveDto
{ public string 工号 { get; set; } = ""; public DateTime 日期 { get; set; } public List<string> 刷卡 { get; set; } = []; }  // 刷卡 "HH:mm"
public sealed class DailyRow
{
    public string? 工号 { get; set; } public string? 姓名 { get; set; } public string? 部门 { get; set; } public DateTime? 日期 { get; set; }
    public decimal? 上午 { get; set; } public decimal? 下午 { get; set; } public decimal? 合计时间 { get; set; } public decimal? 加班 { get; set; }
    public int? 迟到分 { get; set; } public int? 早退分 { get; set; } public int? 迟到次数 { get; set; } public int? 早退次数 { get; set; }
}
```

- [ ] **Step 2: DailyReportService.cs**（取排班→班次→引擎→日报表整条替换）。要点：
  - 注入 `ISqlConnectionFactory factory`。`private static TimeSpan? Tod(DateTime? d)=>d?.TimeOfDay;`
  - `SaveAsync(DailySaveDto dto, string user)`：
    1. 取排班：`SELECT TOP 1 [班次] FROM [排班表] WHERE [工号]=@工号 AND [日期]=@日期`(日期取 .Date)。无→抛 ArgumentException("该员工当日未排班")。
    2. 取班次：`SELECT [上午上班],[上午下班],[下午上班],[下午下班],[迟到分钟],[早退分钟] FROM [考勤_排班表] WHERE [识别]=@班次`。无→抛。
    3. 构 `ShiftDef`(各 datetime?.TimeOfDay；迟到/早退分钟 real→double)。
    4. 解析 dto.刷卡("HH:mm"→TimeSpan,过滤非法)；`AttendanceEngine.Compute`→DailyResult。
    5. 查 姓名/部门：`SELECT [姓名],[部门编号] FROM [人事档案] WHERE [编号]=@工号`(部门编号→部门名查 部门信息,或直接存编号)。
    6. **整条替换**(事务)：`DELETE [日报表] WHERE [工号]=@工号 AND [日期]=@日期`;构刷卡时刻 datetime = `日期.Date + TimeSpan`,写入 刷卡1..刷卡N(N=min(数量,12),动态列名内部生成安全)；INSERT [日报表]([工号],[姓名],[部门],[日期],刷卡1..N,[上午],[下午],[合计时间],[加班],[迟到分],[早退分],[迟到次数],[早退次数])。
  - `ListAsync(工号?,开始,结束,部门?)`：`SELECT [工号],[姓名],[部门],[日期],[上午],[下午],[合计时间],[加班],[迟到分],[早退分],[迟到次数],[早退次数] FROM [日报表] WHERE [日期]>=@开始 AND [日期]<=@结束 AND (@工号 IS NULL OR [工号]=@工号) AND (@部门 IS NULL OR [部门]=@部门) ORDER BY [日期],[工号]`(real列 CAST decimal 或 (decimal?)(double?))。
  - real 列 上午/下午/合计时间/加班 读出 `(decimal?)(double?)`;迟到分/早退分/迟到次数/早退次数 int。
- [ ] **Step 3: DbTest** `DailyReportServiceDbTests.cs`：seed 人事档案(D_E1,部门 D_D1) + 班次(考勤_排班表 识别 D_S1: 上午08:00-12:00 下午13:00-17:00 迟到分钟5 早退分钟5,排班ID MAX+1) + 排班(排班表 D_E1 当日 D_S1)。`new DailyReportService(Factory())`。SaveAsync({工号=D_E1,日期=d0,刷卡=["08:05","12:00","13:00","17:30"]})→ListAsync(D_E1,d0,d0) 1条:迟到分=0(迟5-宽限5)、加班=0.5(30分)、合计=8(±舍入);重算 SaveAsync 同工号同日 刷卡=["08:00",...]→仍1条(整条替换)、迟到分=0;未排班工号 Save→抛 ArgumentException。清理删 日报表/排班表/人事/考勤_排班表(D_*)。
- [ ] **Step 4: 测试(绿)+Commit**
```bash
git add src/ErpApi/Features/Payroll/PayrollDtos.cs src/ErpApi/Features/Payroll/DailyReportService.cs tests/ErpApi.Tests/DailyReportServiceDbTests.cs
git commit -m "feat(P7b): 日报服务(取排班班次→引擎算法10→日报表整条替换·刷卡时刻datetime)+DbTest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 控制器 + 月汇总增强 + DI + 种子 + MenuCatalog + API 测试

**Files:** Create `src/ErpApi/Features/Payroll/DailyReportController.cs`；Modify `src/ErpApi/Features/Payroll/AttendanceService.cs`、`PayrollDtos.cs`(AttendanceMonthlyRow加列)、`src/ErpApi/Program.cs`、`src/ErpApi/Features/Admin/MenuCatalog.cs`；Create `db/seed_p7b2b_perms.sql`；Test `tests/ErpApi.Tests/P7b2DailyApiIntegrationTests.cs`.

- [ ] **Step 1: DailyReportController.cs**（`api/attendance/daily`，Menu `刷卡录入`，仿 AbsenceController helpers）：
  - `GET` list(工号?,开始,结束,部门?,打开)、`POST` save([FromBody] DailySaveDto,保存;catch ArgumentException→400;审计 "刷卡录入" $"工号={dto.工号}")。
- [ ] **Step 2: 月汇总增强** `AttendanceService.MonthlyAsync`：在现有查询加 `LEFT JOIN (SELECT [工号], SUM(CAST([合计时间] AS decimal(18,4))) 出勤工时, SUM(CAST([加班] AS decimal(18,4))) 加班工时, SUM(ISNULL([迟到次数],0)) 迟到次数, SUM(ISNULL([早退次数],0)) 早退次数 FROM [日报表] WHERE [日期]>=@月初 AND [日期]<@下月初 GROUP BY [工号]) d ON d.[工号]=b.[编号]`，SELECT 补 `ISNULL(d.出勤工时,0) AS 出勤工时, ISNULL(d.加班工时,0) AS 加班工时, ISNULL(d.迟到次数,0) AS 迟到次数, ISNULL(d.早退次数,0) AS 早退次数`。`AttendanceMonthlyRow` 加 `出勤工时/加班工时/迟到次数/早退次数`(decimal?/int?)。
- [ ] **Step 3: DI** Program.cs：`AddScoped<DailyReportService>()`。
- [ ] **Step 4: MenuCatalog 同步** 在 考勤管理 组加：`new("考勤管理","刷卡录入"),`（与 班次管理/排班 同组）。
- [ ] **Step 5: 权限种子** `db/seed_p7b2b_perms.sql`：admin 刷卡录入(打开/保存/删除/打印/功能=1)（含 名称 列）。
- [ ] **Step 6: API 测试** `P7b2DailyApiIntegrationTests.cs`：①无权限→GET/POST daily 403。②有权限+seed(人事 API_DE1/班次 ADS1/排班 当日):POST daily save({工号:API_DE1,日期,刷卡:["08:00","12:00","13:00","17:00"]})→200;GET daily?工号=API_DE1&开始=&结束= 命中 合计时间≈8;出勤汇总 GET(沿用 attendance 月汇总端点)含 出勤工时列。清理。
- [ ] **Step 7: 测试(绿)+Commit**
```bash
git add src/ErpApi/Features/Payroll/DailyReportController.cs src/ErpApi/Features/Payroll/AttendanceService.cs src/ErpApi/Features/Payroll/PayrollDtos.cs src/ErpApi/Program.cs src/ErpApi/Features/Admin/MenuCatalog.cs db/seed_p7b2b_perms.sql tests/ErpApi.Tests/P7b2DailyApiIntegrationTests.cs
git commit -m "feat(P7b): 刷卡录入REST(api/attendance/daily)+月汇总增强(出勤工时/加班/迟到早退)+DI+种子+MenuCatalog刷卡录入+API测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 前端 — 刷卡录入页 + 出勤汇总增列

**Files:** Modify `web/src/api/attendance.ts`(加 dailyApi)、`web/src/pages/payroll/AttendancePage.tsx`(增列)、`web/src/App.tsx`、`web/src/pages/MainLayout.tsx`；Create `web/src/pages/attendance/DailyPage.tsx`.

- [ ] **Step 1: api** attendance.ts 追加 `dailyApi`：`list(工号?,开始,结束,部门?)` GET /attendance/daily、`save({工号,日期,刷卡})` POST /attendance/daily + 类型 DailyRow/DailySave({工号,日期:string,刷卡:string[]})。
- [ ] **Step 2: 刷卡录入页** `DailyPage.tsx`：录入区(工号 Input + 日期 DatePicker + 刷卡时刻 多个 TimePicker(动态增删,或 `Select mode="tags"` 收 "HH:mm")→保存[保存权限]) + 日报列表(筛选 工号/日期范围/部门→list;列 工号/姓名/部门/日期/上午/下午/合计时间/加班/迟到分/早退分/迟到次数/早退次数)。`can('刷卡录入',...)`。保存 body 刷卡=["HH:mm"...],日期 "YYYY-MM-DD"。错误 `e.response?.data?.消息`。
- [ ] **Step 3: 出勤汇总增列** `AttendancePage.tsx`：月汇总表加列 出勤工时/加班工时/迟到次数/早退次数(若 AttendanceMonthlyRow 已含则直接加 Table columns)。
- [ ] **Step 4: 菜单+路由** 「考勤管理」组加 刷卡录入(`can('刷卡录入','打开')`,图标如 `FieldTimeOutlined`);`App.tsx` 路由 `/attendance/daily`;Header 标题链补「刷卡录入」。
- [ ] **Step 5: 构建+测试+Commit**
```bash
npm --prefix web run build; npm --prefix web run test -- --run
git add web/src && git commit -m "feat(P7b): 刷卡录入页+出勤汇总增列(工时/加班/迟到早退)+api

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 验证 + 收尾（P7b 全刷卡引擎收官）

- [ ] **Step 1: 全量回归** — 后端 `dotnet test tests/ErpApi.Tests`(全过)；前端 test+build(全过)。
- [ ] **Step 2: 终审** — diff 核对：引擎纯函数算法10单测充分、日报整条替换、刷卡时刻 datetime、月汇总增强 LEFT JOIN 日报、MenuCatalog 已加刷卡录入、零改表。
- [ ] **Step 3: 授权种子** — `dotnet run --project tmp/dbquery -- $env:ERP_DB "@db/seed_p7b2b_perms.sql"`。
- [ ] **Step 4: 收尾** — finishing-a-development-branch：合并 master 本地→删分支→重启 5000/5173→更新记忆(P7b 全刷卡引擎收官:班次/排班+刷卡日报引擎+月汇总;算法10落地;晚班/法定假期/CSV导入/接P7d 仍延后)。

---

## Self-Review

- **Spec(第二片)覆盖**：引擎+单测(T1)、日报服务+DbTest(T2)、控制器+月汇总增强+DI+种子+MenuCatalog+API(T3)、前端(T4)、回归收尾(T5)。算法10刷卡配对两段+宽限、日报整条替换、月汇总增强——均落实。✓
- **占位符**：AttendanceEngine+单测完整;DTOs完整;DailyReportService给详细步骤+关键SQL(动态刷卡列说明);月汇总增强给JOIN SQL;控制器/前端明确结构。✓
- **类型/命名一致**：Menu 刷卡录入;路由 api/attendance/daily;DTO DailySaveDto/DailyRow;ShiftDef/DailyResult;月汇总加 出勤工时/加班工时/迟到次数/早退次数。✓
- **关键坑**：引擎纯函数(午休中点分段·每段最早=上班最晚=下班·迟到只看上午到岗·早退/加班看下午下班·宽限clamp);日报刷卡存 日期.Date+TimeSpan datetime,写刷卡1..N动态列(内部名安全);real列(上午/下午/合计/加班)CAST/(decimal?)(double?);月汇总 LEFT JOIN 日报聚合 CAST decimal;**MenuCatalog同步刷卡录入**(gotcha#9);未排班 Save 报400;提交带trailer;ErpApi占用先Stop-Process。✓
