# P7d 工资公式接入考勤刷卡变量 设计

> 兴信B ERP 净室重建 · 打通 全刷卡引擎(P7b)→工资(P7d) · 2026-06-09

**目标**：把全刷卡引擎(日报表)的月度产出作为**新内置变量**接进 P7d 工资公式引擎，使工资模板公式可写「加班费=加班工时×单价」「迟到扣款=迟到次数×X」等。

**已确认决策**：接 4 个变量——**加班工时 / 出勤工时 / 迟到次数 / 早退次数**（月度聚合）。与现有按天变量(应出勤天数/实出勤天数/缺勤天数)并存，互不覆盖。

---

## 1. 数据模型 — 零改表

- 来源 `日报表`（P7b 第二片产出）：工号/日期/合计时间(real,日出勤工时)/加班(real)/迟到次数(int)/早退次数(int)。
- 目标 `工资公式引擎`(P7d `PayrollService.GenerateAsync`)：vars 字典。
- **无新建/ALTER**。

## 2. 变更（`src/ErpApi/Features/Payroll/PayrollService.cs` · GenerateAsync）

紧接现有「缺勤天数字典」之后，增加**日报月聚合字典**（事务内、当月、按工号）：
```sql
SELECT [工号],
       ISNULL(SUM(CAST([合计时间] AS decimal(18,4))),0) AS 出勤工时,
       ISNULL(SUM(CAST([加班] AS decimal(18,4))),0)     AS 加班工时,
       ISNULL(SUM(ISNULL([迟到次数],0)),0)              AS 迟到次数,
       ISNULL(SUM(ISNULL([早退次数],0)),0)              AS 早退次数
FROM [日报表] WHERE [日期]>=@月初 AND [日期]<@下月初 GROUP BY [工号]
```
→ `Dictionary<string, (decimal 出勤工时, decimal 加班工时, decimal 迟到次数, decimal 早退次数)>`（次数转 decimal 以入 vars）。

逐员工 vars 追加 4 项（无日报记录→缺省 0）：
```csharp
var 日 = 日报.TryGetValue(编号, out var dv) ? dv : default;
vars["加班工时"] = 日.加班工时;
vars["出勤工时"] = 日.出勤工时;
vars["迟到次数"] = 日.迟到次数;
vars["早退次数"] = 日.早退次数;
```
其余（按序号求值、类型驱动合计、动态ZG列、整组替换）不变。

## 3. 测试

- `PayrollServiceDbTests` 增一例（或新 DbTest）：seed 部门+人事(基本工资1000) + **日报表**(当月该员工 加班=2、合计时间=8、迟到次数=1) + 模板含项 `加班费/应发/"加班工时*10"`、`基本/应发/"基本工资"` → GenerateAsync(当月,部门,模板,应出勤26) → 工资明细 该员工 ZG(加班费)=20(2*10)、应发合计含 20+1000;无日报员工→加班工时=0 公式得0。清理。
- 不破坏既有 P7d 测试（vars 仅新增，旧公式不引用新变量则不受影响）。

## 4. 文档/范围外

- 更新 P7d 设计说明的「内置变量」列表 + 记忆。
- 范围外：法定假期加班倍率、迟到→缺勤天数联动、加班分平/休/节倍率、把按天与刷卡口径统一（仍并存,由公式作者选用）。

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 公式引用未建变量名 | FormulaEvaluator 未知变量抛 FormulaException→400(已有);新增4变量始终入vars(缺省0)。 |
| 日报 real 列求和 | CAST decimal(18,4);ISNULL 兜底。 |
| 次数为 int 入 decimal vars | 聚合即转 decimal,vars 统一 decimal。 |
| 与按天变量混淆 | 文档标注两套口径并存(天/工时),公式作者按需选用。 |
| 破坏既有工资测试 | 仅新增 vars,不改求值/合计逻辑;全量回归。 |
