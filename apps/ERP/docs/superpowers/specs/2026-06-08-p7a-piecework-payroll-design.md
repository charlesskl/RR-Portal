# P7a 计件归集（月度计件工资）设计

> 兴信B ERP 净室重建 · P7 算薪(M10)第一切片 · 2026-06-08

**目标**：按 **员工×月** 归集已审核有效计件的计件工资合计（`Σ金额`），JOIN 人事档案/部门信息取姓名/部门，作为工资表（P7d）的「计件工资」输入。只读实时归集，不持久化。复用 P4 M6 已建的 `计件表`。

**已确认决策（与用户）**：
- 产出维度：**按员工×月 计件工资合计**（+数量合计 + 姓名/部门）；员工×工序明细 M6 计件汇总已有，不重做。
- **只读实时归集，不持久化**（沿用"实时聚合不存余额"哲学；`计件月结` 表延后）。
- P7 切四片：P7a 计件归集 → P7b 考勤 → P7c 模板公式 → P7d 工资表。

---

## 1. 数据模型 — 零改表

- `计件表`（P4 M6）：员工号/日期/工序号/数量/单价/金额(=数量×单价)/**审核**/**有效**。计件工资来源。
- `人事档案`：编号/姓名/部门编号/职称/基本工资/在职。员工主数据。
- `部门信息`：编号/部门。部门名称来源（人事档案.部门编号 = 部门信息.编号）。
- **无新建/ALTER 脚本**。

## 2. 归集服务（`src/ErpApi/Features/Payroll/PieceworkPayrollService.cs`）

只读 Dapper。`MonthlyAsync(月份 yyyyMM, 部门编号?)`：

```sql
SELECT b.[编号], MAX(b.[姓名]) AS 姓名, b.[部门编号], MAX(d.[部门]) AS 部门,
       SUM(ISNULL(a.[数量],0)) AS 数量, SUM(ISNULL(a.[金额],0)) AS 计件工资
FROM [计件表] a
JOIN [人事档案] b ON a.[员工号]=b.[编号]
LEFT JOIN [部门信息] d ON d.[编号]=b.[部门编号]
WHERE ISNULL(a.[审核],'0')='1' AND ISNULL(a.[有效],'1')<>'0'
  AND a.[日期] >= @月初 AND a.[日期] < @下月初
  AND (@部门编号 IS NULL OR b.[部门编号]=@部门编号)
GROUP BY b.[编号], b.[部门编号]
ORDER BY b.[部门编号], b.[编号];
```

- 过滤：**审核='1' 且 有效<>'0'**（已审核且有效计件）；日期落在 `月份` 当月（`月初`= yyyyMM 当月1日，`下月初`= 月初.AddMonths(1)，用 `< 下月初` 含当月避边界）。
- 月份解析：6 位 yyyyMM 数字，否则 `ArgumentException`（控制器→400）。
- DTO `PieceworkPayrollRow { 编号, 姓名?, 部门编号?, 部门?, 数量(decimal), 计件工资(decimal?) }`。

## 3. 控制器（`PieceworkPayrollController`）

- `GET api/payroll/piecework?月份=yyyyMM&部门编号=`；Menu `计件归集`；`打开` 权限。
- **成本保密**：缺 `单价` 权限时把每行 `计件工资` 置 null（与 P4 M6 计件汇总一致——同计件数据域，按单价权限脱敏）。数量不脱敏。
- 只读，无写/审核。DI 注册 `PieceworkPayrollService`。

## 4. 前端

- `web/src/api/payroll.ts`：`pieceworkPayrollApi.monthly(月份, 部门编号?)` + 类型 `PieceworkPayrollRow`。
- 页面 `web/src/pages/payroll/PieceworkPayrollPage.tsx`：月份选择(DatePicker month→yyyyMM) + 部门编号筛选 Input + 表格(编号/姓名/部门编号/部门/数量/计件工资)；计件工资缺权限显空。
- 菜单：新独立顶级组 **「工资管理」**（key `pr`）→ 计件归集；`App.tsx` 路由 `/payroll/piecework`；Header 标题链补。
- `web/src/utils/payroll.ts`：`toYearMonth(dayjs)`（可复用 monthEnd 的同名思路，或独立）+ 单测。

## 5. 权限 / 测试

- 权限种子 `db/seed_p7a_perms.sql`：admin `计件归集`（打开/打印/单价/功能）。
- 后端 `PieceworkPayrollServiceDbTests`：seed 人事档案(P7AE1,部门P7AD1)+部门信息(P7AD1)+计件表(当月审核有效若干、他月、未审核、无效各一)→ MonthlyAsync 按员工合计仅计「当月+审核+有效」；部门筛选。
- 后端 `P7aPayrollApiIntegrationTests`：无打开权限→403；缺单价权限→计件工资 null、数量非空；月份非法→400。
- 前端 util/页面测试。

## 6. 范围外（后续 P7 切片）

考勤(P7b)、工资模板/公式(P7c)、工资表生成(P7d 公式引擎)、计件月结持久化、员工×工序明细下钻（M6 计件汇总已有）。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 计件双标志(审核+有效) | 过滤 `审核='1' AND 有效<>'0'`（已审核且有效），与 M6 计件录入/审核口径一致。 |
| 部门名称来源 | LEFT JOIN 部门信息(编号→部门)取名；缺则 部门 为 null（不影响合计）。 |
| 成本保密 | 计件工资按 `单价` 权限脱敏（同 M6 计件汇总）；数量不脱敏。 |
| 边界日期 | `日期 < 下月初` 含当月，避 datetime 末时刻。 |
| 与 M6 计件汇总重叠 | P7a 是员工×月合计(供工资)；M6 是员工×工序实时汇总，二者并存不冲突。 |
