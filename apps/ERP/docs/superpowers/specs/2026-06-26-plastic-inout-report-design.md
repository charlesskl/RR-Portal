# 塑胶进出库统计表 · 设计 · 2026-06-26

## 目标

P4 塑胶报表第二张。按日期区间出**每物料×仓库的 期初 / 本期入库 / 本期出库 / 期末** 数量。基于塑胶 6 支台账,但**带单据日期**做区间聚合。库存现有口径(`LedgerUnion`)不动,新增并行的带日期签名台账。

## 范围与决策(已确认)

- 列:期初数量 / 本期入库 / 本期出库 / 期末数量,**纯数量不带金额**;前缀物料信息列。
- 期间:按**单据日期**(单头 `日期`)划分,**仅审核='1'** 的单计入。
- **新建独立报表页/端点/菜单**(不塞进库存统计表页)。

## 架构

塑胶库存口径不变。新增 `LedgerUnionDated`(每支多选 `h.[日期]` + 签名数量),`InOutAsync(起,止,仓库?,keyword?)` 对其按 物料编号×仓库 聚合出四个数量。颜色/材料 LEFT JOIN 塑胶物料资料。新独立 Controller(菜单「塑胶进出库统计表」)。前端新报表页(无左树·全宽),复用日期工具栏与 `tableExport`。

## ① 后端

**`src/ErpApi/Engines/Inventory/PlasticInventoryService.cs`**
- 新 `PlasticInOutRow`:物料编号/物料名称/规格/颜色/物料类别/单位/仓库 + 期初数量/本期入库/本期出库/期末数量(decimal)。
- 新 `private const string LedgerUnionDated`:6 支,每支 `SELECT h.[日期] AS 日期, d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], <签名数量> AS 数量 FROM [明细] d JOIN [单头] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'`。签名:入仓 `d.[数量]`、领料 `d.[数量]*-1`、退料 `d.[数量]`、退仓 `d.[数量]*-1`、报废 `d.[数量]*-1`、盘点 `d.[盈亏数量]`。
- 新 `InOutAsync(DateTime 起, DateTime 止, string? 仓库, string? keyword)`:
  ```sql
  SELECT t.[物料编号], MAX(t.[物料名称]) 物料名称, MAX(t.[规格]) 规格, MAX(m.[颜色]) 颜色, MAX(m.[物料类别]) 物料类别, MAX(t.[单位]) 单位, t.[仓库],
         SUM(CASE WHEN t.[日期] < @起 THEN t.[数量] ELSE 0 END) AS 期初数量,
         SUM(CASE WHEN t.[日期] >= @起 AND t.[日期] < @止Excl AND t.[数量] > 0 THEN t.[数量] ELSE 0 END) AS 本期入库,
         SUM(CASE WHEN t.[日期] >= @起 AND t.[日期] < @止Excl AND t.[数量] < 0 THEN -t.[数量] ELSE 0 END) AS 本期出库
  FROM ({LedgerUnionDated}) t
  LEFT JOIN (SELECT 物料编号, MAX(颜色) 颜色, MAX(物料类别) 物料类别 FROM 塑胶物料资料 GROUP BY 物料编号) m ON m.物料编号=t.物料编号
  WHERE (@wh IS NULL OR t.仓库=@wh) AND (@kw IS NULL OR t.物料编号 LIKE @kw OR t.物料名称 LIKE @kw OR t.规格 LIKE @kw)
  GROUP BY t.物料编号, t.仓库
  HAVING SUM(CASE WHEN t.日期<@起 THEN t.数量 ELSE 0 END) <> 0
      OR SUM(CASE WHEN t.日期>=@起 AND t.日期<@止Excl THEN t.数量 ELSE 0 END) <> 0
  ORDER BY t.物料编号, t.仓库;
  ```
  - `期末数量 = 期初数量 + 本期入库 − 本期出库`(C# 端算,或 SQL 算同表达式;用 C# 端 `row.期末数量 = 期初+入-出` 简洁)。
  - `止Excl = 止.Date.AddDays(1)`;`起 = 起.Date`。
  - 返回 `IReadOnlyList<PlasticInOutRow>`。

**`src/ErpApi/Features/Plastics/PlasticInOut/PlasticInOutController.cs`**(新)
- `[Route("api/plastic-in-out")]`,菜单 `塑胶进出库统计表`,注入 `PlasticInventoryService` + `IPermissionService`。
- `GET ?起=&止=&仓库=&keyword=` → 校验「塑胶进出库统计表·打开」权限 → `InOutAsync` → Ok。无价无脱敏。
- `起/止` 必填(空则默认本月:起=本月1日、止=本月最后一天;后端可给默认或前端传)。本设计前端总是传 起/止。

**菜单 + 权限**
- `MenuCatalog.cs` 加 `new("塑胶报表","塑胶进出库统计表")`。
- `db/seed_plastic_inout_perms.sql` 给 admin 该菜单 9 位权限。

## ② 前端

**`web/src/api/plasticInOut.ts`**:`PlasticInOutRow`(物料编号/物料名称/规格/颜色/物料类别/单位/仓库/期初数量/本期入库/本期出库/期末数量)+ `plasticInOutApi.list(起,止,仓库?,keyword?)`(起/止 传 `YYYY-MM-DD`)。

**`web/src/pages/plastics/PlasticInOutReportPage.tsx`**(无左树·全宽):
- 工具栏:上月/本月/下月 按钮(移动起止月)+ 起/止 `DatePicker`(默认本月首尾)+ 仓库 `Input` + 关键词 `Input.Search` + 导出EXCEL + 打印(`tableExport`)。
- 表列:物料编号|物料名称|规格|颜色|材料(物料类别)|单位|仓库|期初数量|本期入库|本期出库|期末数量。
- 底部汇总:本期入库/本期出库/期末数量 合计。
- 权限:`can(perms,"塑胶进出库统计表","打开")` 守卫。

**`App.tsx`**:加路由 `plastic-in-out` → `<PlasticInOutReportPage/>`。
**`menuTree.tsx`**:把占位 `M("塑胶进出库统计表")` 改为 `M("塑胶进出库统计表","/plastic-in-out","塑胶进出库统计表")`。

## ③ 测试

- 后端 `PlasticInOutServiceDbTests`:种同物料 入仓100(日期 = 区间前,如上月)审核 + 入仓50(区间内)审核 + 领料20(区间内)审核 → `InOutAsync(本月起, 本月止, 仓库, kw)`:期初=100、本期入库=50、本期出库=20、期末=130;颜色/材料 带出;日期边界(区间外不计本期)。清理。
- 全量 `dotnet test` 绿(362 → 363)。
- 前端 `npm --prefix web run test`(54)+ `build` tsc 干净。
- 冒烟:建跨期 入/出 审核(改单头日期)→ GET 区间统计 期初/入/出/期末 正确。

## 不做(YAGNI)

- 金额列。
- 生产单号条件 / 精确查询 / 高级查询 / 表格设置 / 左分类树。
- 审核日期口径(用单据日期)。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-inout-report` `--no-ff` 合并 master 删分支 → worklog + MEMORY。
