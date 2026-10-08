# P7d 工资公式接入考勤刷卡变量 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** P7d `PayrollService.GenerateAsync` 新增 4 个内置公式变量(加班工时/出勤工时/迟到次数/早退次数,来自日报表当月聚合),打通刷卡考勤→工资。零改表。

**Architecture:** 在 GenerateAsync 缺勤字典后加日报月聚合字典,逐员工 vars 追加4项。其余不变。`src/ErpApi/Features/Payroll/PayrollService.cs`。依据 `docs/superpowers/specs/2026-06-09-payroll-punch-vars-design.md`。

---

## Task 1: GenerateAsync 接入刷卡变量 + DbTest

**Files:** Modify `src/ErpApi/Features/Payroll/PayrollService.cs`；Test `tests/ErpApi.Tests/PayrollPunchVarsDbTests.cs`(新) 或扩 `PayrollServiceDbTests.cs`.

- [ ] **Step 1: 日报月聚合字典** — 在 GenerateAsync「缺勤天数字典」之后(动态INSERT列片段之前)插入：
```csharp
        // 8b. 日报(刷卡)月聚合字典:出勤工时/加班工时/迟到次数/早退次数
        var 日报 = (await c.QueryAsync(@"
SELECT [工号],
       ISNULL(SUM(CAST([合计时间] AS decimal(18,4))),0) AS 出勤工时,
       ISNULL(SUM(CAST([加班] AS decimal(18,4))),0)     AS 加班工时,
       ISNULL(SUM(ISNULL([迟到次数],0)),0)              AS 迟到次数,
       ISNULL(SUM(ISNULL([早退次数],0)),0)              AS 早退次数
FROM [日报表] WHERE [日期]>=@月初 AND [日期]<@下月初 GROUP BY [工号]", new { 月初, 下月初 }, tx))
            .ToDictionary(r => (string)r.工号, r => (
                出勤工时: (decimal)r.出勤工时,
                加班工时: (decimal)r.加班工时,
                迟到次数: (decimal)(int)r.迟到次数,
                早退次数: (decimal)(int)r.早退次数));
```
（注:SUM(int) 返回 int → `(int)r.迟到次数` 再转 decimal;若驱动返回 long 用 `(decimal)(long)`。实现时按实际类型调整,DbTest 会暴露。）

- [ ] **Step 2: vars 追加4项** — 在 `var vars = new Dictionary<string, decimal> {...};` 之后(即追加台头项目值的循环之前)加：
```csharp
            var 日 = 日报.TryGetValue(编号, out var dv) ? dv : default;
            vars["加班工时"] = 日.加班工时;
            vars["出勤工时"] = 日.出勤工时;
            vars["迟到次数"] = 日.迟到次数;
            vars["早退次数"] = 日.早退次数;
```
（`default` 即 (0,0,0,0)。）

- [ ] **Step 3: DbTest** `tests/ErpApi.Tests/PayrollPunchVarsDbTests.cs`（`[Collection("db")]`+Factory()）：seed 部门信息(PV_D1)+人事档案(PV_E1,部门PV_D1,基本工资1000,在职'1')+**日报表**(PV_E1,当月某日,合计时间=8,加班=2,迟到次数=1,早退次数=0)[直接INSERT,日期取当月如 new DateTime(now年,now月,10)——用固定当月;或传月份与之一致]+工资模板(PV_T1: 项 基本/应发/"基本工资"、加班费/应发/"加班工时*10")[直接INSERT 工资模板项目+工资模板公式,或调 WageTemplateService.SaveAsync]。`new PayrollService(Factory(), new DocumentNumberGenerator())`.GenerateAsync({月份=当月yyyyMM,部门编号=PV_D1,模板编号=PV_T1,应出勤天数=26},"tester")→断言 工资明细表 PV_E1:加班费列(查 工资表项目公式 找 台头项目='加班费' 的 列名→读该ZG列)=20(加班工时2*10)、应发合计=1020(1000+20);**再 seed 一个无日报的员工 PV_E2**→其 加班费=0、应发=1000(加班工时缺省0)。清理删 工资明细表/工资总表/工资表项目公式(按月+部门)、日报表/人事/部门/工资模板(PV_*)。
  - 月份用当月以匹配日报日期:`var now=DateTime.Today; var 月份=now.ToString("yyyyMM"); var 日报日期=new DateTime(now.Year,now.Month,10);`(避免跨月边界取10号)。
- [ ] **Step 4: 测试(绿)** — `Get-Process ...|Stop-Process -Force`;`dotnet test tests/ErpApi.Tests --filter PayrollPunchVarsDbTests`;**全量回归**(确认既有 P7d PayrollServiceDbTests/API 仍绿,~231)。
- [ ] **Step 5: Commit**
```bash
git add src/ErpApi/Features/Payroll/PayrollService.cs tests/ErpApi.Tests/PayrollPunchVarsDbTests.cs
git commit -m "feat(P7d): 工资公式接入刷卡考勤变量(加班工时/出勤工时/迟到/早退次数·日报月聚合)+DbTest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 文档 + 验证 + 收尾

- [ ] **Step 1: 文档** — 在 P7c/P7d 工资模板前端页或设计文档标注新可用变量(可选:`web/src/pages/payroll/WageTemplatePage.tsx` 公式输入处加提示文本「可用:基本工资/计件工资/应出勤天数/实出勤天数/缺勤天数/加班工时/出勤工时/迟到次数/早退次数」)。若改前端则 `npm --prefix web run build`+test。
- [ ] **Step 2: 全量回归** — 后端 `dotnet test tests/ErpApi.Tests`(全过)；前端(若动)test+build。
- [ ] **Step 3: 终审** — diff:仅新增日报字典+4 vars,未改求值/合计;零改表。
- [ ] **Step 4: 收尾** — finishing-a-development-branch：合并 master 本地→删分支→重启 5000/5173→更新记忆(P7d 工资公式新增刷卡变量,考勤→工资打通;两套口径[天/工时]并存)。

---

## Self-Review

- **Spec 覆盖**：日报聚合字典+4vars接入(T1 Step1-2)、DbTest 验证加班费=加班工时*10 且无日报员工=0(T1 Step3)、文档+回归收尾(T2)。✓
- **占位符**：聚合SQL+vars追加+DbTest断言完整;类型转换注明按实际调整。✓
- **类型/命名一致**：变量名 加班工时/出勤工时/迟到次数/早退次数;vars 统一 decimal;日报表列 合计时间/加班/迟到次数/早退次数。✓
- **关键坑**：SUM(int)返回类型(int/long)→DbTest暴露后调cast;real列CAST decimal;无日报员工缺省0(default元组);月份与日报日期同月(取10号);仅新增不改既有逻辑→既有P7d测试须仍绿;提交带trailer;ErpApi占用先Stop-Process。✓
