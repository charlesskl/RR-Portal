# 原料本月库存汇总 · 设计 · 2026-06-26

## 目标

P4 塑胶报表第四张。按**原料名称(=塑胶物料名称)**汇总:本月库存(当前实时)/ 存外厂数量(恒 0·无源)/ 本月报废(日期区间内)/ 本月总数(=库存+存外厂+报废)。**纯数量、无金额、无重量列**。

## 范围与决策(已确认)

- 存外厂:**保留「存外厂数量」一列但恒 0**(重建里无塑胶外厂库存数据源);**重量(KG)系列列全部不画**(无可靠单件净重)。
- 本月库存:**当前实时库存**(`LedgerUnion` 实时聚合,无历史快照);本月报废:日期区间内塑胶报废单。
- 本月总数 = 本月库存 + 存外厂数量(0) + 本月报废;**按 物料名称 分组**。
- 纯数量报表,无金额、无脱敏。

## 架构

复用 `PlasticInventoryService` 的 `LedgerUnion`(实时库存,审核='1')。新方法用两个聚合子查询 FULL OUTER JOIN:库存(LedgerUnion 按物料名称求和=当前库存,已扣全部报废)+ 本月报废(塑胶报废明细单 JOIN 单头,审核+单据日期区间)。新独立 Controller(菜单 原料本月库存汇总)。前端新页复用日期工具栏 + tableExport。

## ① 后端

**`src/ErpApi/Engines/Inventory/PlasticInventoryService.cs`**
- 新 DTO `PlasticRawMaterialSummaryRow`:`原料名称`(string?)、`本月库存`(decimal)、`存外厂数量`(decimal)、`本月报废`(decimal)、`本月总数`(decimal)。
- 新方法:
```csharp
public async Task<IReadOnlyList<PlasticRawMaterialSummaryRow>> RawMaterialMonthlySummaryAsync(DateTime 起, DateTime 止, string? keyword)
{
    var qi = 起.Date; var qe = 止.Date.AddDays(1);
    var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
    var sql = $@"
WITH 库存 AS (
    SELECT [物料名称], SUM([数量]) AS 本月库存
    FROM ({LedgerUnion}) t
    GROUP BY [物料名称]
),
报废 AS (
    SELECT d.[物料名称], SUM(ISNULL(d.[数量],0)) AS 本月报废
    FROM [塑胶报废明细单] d JOIN [塑胶报废单] h ON h.[单号]=d.[单号]
    WHERE ISNULL(h.[审核],'0')='1' AND h.[日期] >= @qi AND h.[日期] < @qe
    GROUP BY d.[物料名称]
)
SELECT ISNULL(k.[物料名称], s.[物料名称]) AS 原料名称,
       ISNULL(k.[本月库存],0) AS 本月库存,
       CAST(0 AS decimal(18,4)) AS 存外厂数量,
       ISNULL(s.[本月报废],0) AS 本月报废,
       ISNULL(k.[本月库存],0) + ISNULL(s.[本月报废],0) AS 本月总数
FROM 库存 k
FULL OUTER JOIN 报废 s ON s.[物料名称] = k.[物料名称]
WHERE (@kw IS NULL OR ISNULL(k.[物料名称], s.[物料名称]) LIKE @kw)
  AND (ISNULL(k.[本月库存],0) <> 0 OR ISNULL(s.[本月报废],0) <> 0)
ORDER BY 原料名称";
    using var c = factory.Create();
    var rows = await c.QueryAsync<PlasticRawMaterialSummaryRow>(sql, new { qi, qe, kw });
    return rows.AsList();
}
```
（`LedgerUnion` 已含报废 − 支,故库存=当前实时库存[已扣全部报废];本月报废单列另算;本月总数=库存+本月报废,与原系统口径一致。）

**`src/ErpApi/Features/Plastics/PlasticRawMaterial/PlasticRawMaterialController.cs`**(新)
- `[Route("api/plastic-raw-material-summary")]`,菜单 `原料本月库存汇总`,注入 `PlasticInventoryService` + `IPermissionService`。
- `GET ?起=&止=&keyword=` → 校验「打开」→ `RawMaterialMonthlySummaryAsync` → Ok。无金额无脱敏。

**菜单 + 权限**
- `MenuCatalog.cs` 加 `new("塑胶报表","原料本月库存汇总")`。
- `db/seed_plastic_raw_material_perms.sql` 给 admin 9 位权限,应用两库。

## ② 前端

**`web/src/api/plasticRawMaterial.ts`**:`PlasticRawMaterialSummaryRow {原料名称?,本月库存,存外厂数量,本月报废,本月总数}` + `plasticRawMaterialApi.list(起,止,keyword?)`。

**`web/src/pages/plastics/PlasticRawMaterialSummaryPage.tsx`**(镜像 `PlasticInOutReportPage` 的日期工具栏):
- 工具栏:上月/本月/下月 + RangePicker(默认本月)+ 原料名称关键词 + 导出EXCEL/打印。
- 表列:原料名称 | 本月库存 | 存外厂数量 | 本月报废 | 本月总数(数值右对齐;本月总数加粗)。
- 底部 `Table.Summary` 汇总:本月库存/存外厂数量/本月报废/本月总数 合计。
- 权限:`can(perms,"原料本月库存汇总","打开")` 守卫。

**`App.tsx`**:加路由 `plastic-raw-material-summary` → 页。
**`menuTree.tsx`**:把占位 `M("原料本月库存汇总")` 改为 `M("原料本月库存汇总","/plastic-raw-material-summary","原料本月库存汇总")`。

## ③ 测试

- 后端 `PlasticRawMaterialSummaryServiceDbTests`:种 1 物料(名 RAWNAME)入仓 100 审核(库存+100)+ 本月报废 20 审核(库存−20→80、本月报废列 20)→ `RawMaterialMonthlySummaryAsync(本月起,止,"RAWNAME")`:本月库存=80、存外厂数量=0、本月报废=20、本月总数=100(80+20);另种区间外报废(上月)不计入本月报废。清理。
- 全量 `dotnet test` 绿(364 → 365)。
- 前端 `npm --prefix web run test`(54)+ `build` tsc 干净。
- 冒烟:种数据 → `GET /api/plastic-raw-material-summary?起=&止=` 返回该名称 库存/报废/总数正确,存外厂=0。

## 不做(YAGNI)

- 存外厂 真实数据(无塑胶外厂库存源;列恒 0)。
- 重量(KG)系列列(无可靠单件净重)。
- 条件下拉多选项 / 精确查询 / 表格设置 / 货币。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-raw-material-summary` `--no-ff` 合并 master 删分支 → worklog + MEMORY。
