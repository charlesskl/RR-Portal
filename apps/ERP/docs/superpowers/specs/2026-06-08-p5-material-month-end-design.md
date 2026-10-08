# 物料(原料仓)月结 设计

> 兴信B ERP 净室重建 · P5 仓储模块剩余项 · 2026-06-08 · 是 [2026-06-06 库存月结](2026-06-06-p5-month-end-design.md) 的扩展

**目标**：把已建成的库存月结扩到第三个口径 `物料`（原料/采购物料仓），按 `物料编号×仓库` 把 期初/本期入/本期出/结存 滚存进 `结存快照表`，复用同一套日期切片算法、同一页面与权限。软月结、仅数量、不改实时库存热路径。

**已确认决策（与用户）**：
- 维度 = `物料编号×仓库`（**忽略颜色**），与实时物料库存 `MaterialInventoryService`（跨色汇总）口径一致，保证月报与库存查询对得上。
- 复用「库存月结」页：物料作为口径 Select 的第三项，**不新增菜单/权限**。
- 不改 `结存快照表` 结构（已有 物料编号/物料名称/规格/单位 列；物料行 `口径='物料'`、`颜色=NULL`）。
- 范围外（沿用 P5 延后）：加权出库成本/金额、硬月结锁期。

---

## 1. 数据模型 — 零改动

`结存快照表`（P5 月结已扩展）当前列足够承载物料口径：物料行写 `口径='物料'`、`物料编号/物料名称/规格/单位`，`款号/款式/色号/颜色/尺码` 全 NULL。唯一索引 `(年月,仓库,口径,款号,色号,颜色,尺码,物料编号)` 靠 `口径+物料编号` 区分物料行，与半成品行（口径='半成品'，物料编号+颜色）不冲突——即使同一 `物料编号` 在两个口径出现，`口径` 列已隔离。**无新建/ALTER 脚本。**

## 2. 月结算法 — 复用 MaterialInventoryService 账本 + 日期切片

物料口径账本沿用 `src/ErpApi/Engines/Inventory/MaterialInventoryService.cs` 的 `LedgerUnion`（**审核在单头，明细 JOIN 单头**）：

- 采购入仓明细单 `+数量`（JOIN 采购入仓单）
- 退料明细单 `+数量`（JOIN 退料单）
- 领料明细单 `−数量`（JOIN 领料单）

均 `ISNULL(h.审核,'0')='1'`。明细自带 `日期`（服务端 INSERT 已写）。在此基础上加日期谓词与符号拆分，按 `物料编号` 分组（每仓单独算，CloseAsync 逐仓迭代）、`MAX(物料名称/规格/单位)`：

```sql
WITH 账本 AS (
    SELECT d.物料编号,d.物料名称,d.规格,d.单位,d.[日期], ISNULL(d.数量,0)    AS 签
      FROM [采购入仓明细单] d JOIN [采购入仓单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号,d.物料名称,d.规格,d.单位,d.[日期], ISNULL(d.数量,0)
      FROM [退料明细单] d JOIN [退料单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号,d.物料名称,d.规格,d.单位,d.[日期], ISNULL(d.数量,0)*-1
      FROM [领料明细单] d JOIN [领料单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
)
SELECT 物料编号, MAX(物料名称) AS 物料名称, MAX(规格) AS 规格, MAX(单位) AS 单位,
       SUM(CASE WHEN [日期] <  @月初 THEN 签 ELSE 0 END)                                  AS 期初,
       SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 AND 签 > 0 THEN 签  ELSE 0 END) AS 本期入,
       SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 AND 签 < 0 THEN -签 ELSE 0 END) AS 本期出
FROM 账本
GROUP BY 物料编号
HAVING SUM(CASE WHEN [日期] < @下月初 THEN 签 ELSE 0 END) <> 0
    OR SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 THEN ABS(签) ELSE 0 END) > 0;
```

与成品/半成品口径完全同形（`ISNULL` 防 NULL 传播、`ABS(签)` 活动判定保留净零但本期有流水的行、`<@下月初` 避边界）。`结存=期初+本期入-本期出` 服务端算。查询结果映射到 `MonthEndRow`（颜色保持 NULL）。

仓库发现（缺省全仓 close）：

```sql
SELECT DISTINCT 仓库 FROM (
    SELECT d.仓库 FROM [采购入仓明细单] d JOIN [采购入仓单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1' AND d.[日期] < @下月初
    UNION SELECT d.仓库 FROM [退料明细单] d JOIN [退料单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1' AND d.[日期] < @下月初
    UNION SELECT d.仓库 FROM [领料明细单] d JOIN [领料单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1' AND d.[日期] < @下月初
) t WHERE 仓库 IS NOT NULL AND 仓库 <> N'';
```

## 3. 后端改动（仅 `MonthEndService.cs`）

1. `NormalizeKind`：放行 `物料`（现 `成品`/`半成品`/`物料`）。
2. 新增 `private const string 物料账本Sql`、`物料仓库Sql`（上面两段）。
3. `CloseAsync` 内的账本与发现 SQL 选择从二元改三元：`口径=="成品"?成品账本Sql : 口径=="半成品"?半成品账本Sql : 物料账本Sql`，发现同理。
4. `ReopenAsync`/`ReportAsync`/`PeriodsAsync` 本就口径无关（仅 `NormalizeKind` + 按 `口径` 字符串过滤），放行后自动支持物料，无需改动。

## 4. REST / 权限 / 成本保密 — 不变

`api/month-end` 的 `口径` 是字符串参数，`MonthEndController` 不需改。复用「库存月结」菜单与 9 位权限（打开=月报、功能=月结、删除=反月结）。物料快照只有数量列，无单价/金额 → 无需脱敏。

## 5. 前端（复用同一页，不新增菜单）

- `web/src/utils/monthEnd.ts`：`type Kind = "成品" | "半成品" | "物料"`；`dimColumns("物料")` 返回 `仓库/物料编号/物料名称/规格/单位`（公共列 期初/本期入/本期出/结存 由页面拼接）。
- `web/src/pages/warehouse/MonthEnd.tsx`：口径 `Select` options 增加 `{ value: "物料", label: "物料" }`。其余逻辑（report/close/reopen 调用、rowKey）已通用。

## 6. 测试

- 后端 `MonthEndServiceDbTests` 加物料口径用例：seed `物料资料` 父行；采购入仓单(单头审核'1')+明细 上月100、领料单+明细 本月30（明细 款号/生产单号留 NULL 避额外 FK）→ close 本月物料 → 期初100/本期入0/本期出30/结存70。cleanup 删明细/单头/物料资料。
- 前端 `monthEnd.test.ts` 加 `dimColumns("物料")` 断言（含 物料编号/单位，不含 款号）。
- 现有 API 集成测试已覆盖 REST 生命周期；物料口径走同一控制器，不再单独加（可选）。

## 7. 关键风险与对策

| 风险 | 对策 |
|---|---|
| 物料明细有颜色列但实时库存忽略颜色 | 月结 GROUP BY 物料编号（不含颜色），与 `MaterialInventoryService` 完全一致；颜色在快照留 NULL。 |
| 明细 FK（物料编号→物料资料、款号→款号总表、生产单号→生产制单） | 测试只 seed 物料资料，款号/生产单号 留 NULL（FK 允许 NULL）。 |
| 日期可靠性 | 三个物料明细服务 INSERT 均写 `日期=now`（已核），明细自带日期可直接切片。 |
| 与半成品行键冲突 | `口径` 列隔离；唯一索引含口径+物料编号。 |
