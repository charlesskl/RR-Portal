# 塑胶领料查询 · 设计 · 2026-06-27

## 目标

塑胶领料单 的只读两 Tab 查询(汇总按生产单号 + 明细),按 日期区间 + 审核情况 + 物料类别 + 关键词;明细双击新建只读抽屉看整单。带价(单价/金额)→ 脱敏。**4 张塑胶单据查询(领料/退料/报废/盘点)的第 1 张**,确立模板。

## 跨 4 张共同决策(已确认)

- **共用货号 = 塑胶共用物料表.塑胶货号;共用物料 = 塑胶共用物料表.共用原料编号**(LEFT JOIN 共用物料表 GROUP BY 物料编号·1:1);明细的「塑胶货号」列也取此。
- 明细双击 → **每单新建只读抽屉**(镜像物料侧 MaterialDocDetailDrawer):GET 对应 api 拉头+明细只读展示,单价脱敏。
- v1 省略:物料查询(共用物料)切换、精确查询、高级查询、表格设置。保留 上月/本月/下月+RangePicker+物料类别下拉+关键词+审核情况(全部/已审核/未审核)+导出/打印。

## 数据源

- 头 `塑胶领料单`(日期/领料部门/领料人/审核)+ 明细 `塑胶领料明细单`(装配采购/生产单号/款号/物料编号/模具编号/物料名称/规格/颜色/色粉号/用料名称/仓位号/单位/数量/单价/金额/备注)。
- LEFT JOIN `塑胶共用物料表`(GROUP BY 物料编号)取 塑胶货号/共用原料编号。
- LEFT JOIN `塑胶物料资料`(GROUP BY 物料编号)取 物料类别(供 物料类别 过滤)。
- 两 LEFT JOIN 子查询均按 物料编号 1:1 不放大。

## 架构

后端扩 `PlasticIssueService` 加 `IssueQueryDetailAsync`/`IssueQuerySummaryAsync` + 复用 `ApprovalFilter`(放本服务内 private static,与塑胶物料单系的同名 helper 各自独立)。新 `PlasticIssueQueryController`(`api/plastic-issue-query`·`/detail`+`/summary`·菜单 塑胶领料查询·单价脱敏)。新只读抽屉 `PlasticIssueDetailDrawer`(GET `/api/plastic-issues/{单号}`)。前端两 Tab 页镜像 `PlasticOrderQueryPage`。

## ① 后端

**DTO**(`PlasticIssueDtos.cs` 末尾加):
```csharp
public sealed class PlasticIssueQueryDetailRow
{
    public DateTime? 日期; public string? 单号, 生产单号, 款号, 领料部门, 领料人, 装配采购,
        物料编号, 物料名称, 颜色, 塑胶货号, 共用物料, 共用货号, 单位; 
    public decimal? 数量, 单价, 金额; public string? 备注, 审核;  // 实写成完整属性
}
public sealed class PlasticIssueQuerySummaryRow
{
    public string? 生产单号, 款号, 物料编号, 物料名称, 颜色, 塑胶货号, 共用物料, 共用货号, 物料类别, 单位;
    public decimal? 数量, 单价, 金额;
}
```
(每个字段写成 `public string? X { get; set; }`/`public decimal? X { get; set; }`。)

**`PlasticIssueService.cs`** 加:
- `private static string ApprovalFilter(string? 审核情况)`:已审核→` AND ISNULL(h.[审核],'0')='1'`、未审核→`<>'1'`、_→""。
- `IssueQueryDetailAsync(起,止,keyword?,审核情况?,物料类别?)`:
```sql
SELECT h.[日期], d.[单号], d.[生产单号], d.[款号], h.[领料部门], h.[领料人], d.[装配采购],
       d.[物料编号], d.[物料名称], d.[颜色], cm.[塑胶货号] AS 塑胶货号, cm.[共用原料编号] AS 共用物料, cm.[塑胶货号] AS 共用货号,
       d.[单位], d.[数量], d.[单价], d.[金额], d.[备注], h.[审核]
FROM [塑胶领料明细单] d
JOIN [塑胶领料单] h ON h.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([塑胶货号]) AS 塑胶货号, MAX([共用原料编号]) AS 共用原料编号
           FROM [塑胶共用物料表] GROUP BY [物料编号]) cm ON cm.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID]
```
- `IssueQuerySummaryAsync(...)`:GROUP BY `d.[生产单号], d.[款号], d.[物料编号], d.[颜色]`,SELECT 这些 + `MAX(d.[物料名称])` + `MAX(cm.[塑胶货号])` 共用货号/塑胶货号 + `MAX(cm.[共用原料编号])` 共用物料 + `MAX(m.[物料类别])` 物料类别 + `MAX(d.[单位])` + `SUM(d.[数量])` + `MAX(d.[单价])` 单价 + `SUM(ISNULL(d.[金额],0))` 金额。同 JOIN/WHERE(keyword 去 ID/装配采购)。

**`PlasticIssueQueryController.cs`**(新·`Features/Plastics/PlasticIssueQuery/`)
- `[Route("api/plastic-issue-query")]`,菜单 `塑胶领料查询`,注入 `PlasticIssueService` + `IPermissionService`。
- `/detail`、`/summary`:校验「打开」→ 查询 → 无「单价」权限置 单价/金额 null → Ok。

**菜单+权限**:`MenuCatalog` 加 `new("塑胶报表","塑胶领料查询")`;`db/seed_plastic_issue_query_perms.sql` admin 9 位·两库。

## ② 前端

- `api/plasticIssueQuery.ts`:两 Row 接口 + `detail/summary(p)`。
- `PlasticIssueDetailDrawer.tsx`(新·只读):props `{ open, 单号?, onClose }`;GET `plasticDocApi("plastic-issues").get(单号)` 或 `plasticIssueApi.get`,Descriptions 头(单号/日期/领料部门/领料人/审核)+ Table 明细(物料编号/物料名称/规格/颜色/塑胶货号/单位/数量/单价/金额/备注·单价金额 hidePrice 脱敏)。
- `PlasticIssueQueryPage.tsx`(镜像 `PlasticOrderQueryPage`·两 Tab):工具栏 上月/本月/下月+RangePicker(默认本月)+审核情况+物料类别下拉(categories)+关键词+导出/打印;明细列 日期/单号/生产单号/款号/领料部门/领料人/装配采购/物料编号/物料名称/颜色/塑胶货号/共用物料/共用货号/单位/数量/单价/金额/备注/审核;汇总列 生产单号/款号/物料编号/物料名称/颜色/塑胶货号/共用物料/共用货号/单位/数量/单价/金额;单价/金额 hidePrice 隐藏;明细 onDoubleClick → PlasticIssueDetailDrawer 单号。
- `App.tsx` 路由 `plastic-issue-query`;`menuTree.tsx` 占位 `M("塑胶领料查询")` → 带路由。

## ③ 测试

- 后端 `PlasticIssueQueryServiceDbTests`:种 塑胶共用物料表(物料编号→塑胶货号/共用原料编号)+塑胶物料资料(物料类别)+塑胶领料单(日期/审核1/领料部门人)+明细(生产单号/款号/物料/颜色/数量/单价)→ Detail 验 共用货号=塑胶货号/共用物料=共用原料编号/领料部门人/数量 + Summary GROUP 合计 + 审核情况/物料类别/keyword/区间过滤。清理(塑胶领料明细单/单·共用物料表·物料资料)。
- 全量 `dotnet test` 绿(370 → 371);前端 54 + tsc 干净。
- 冒烟:种链 → `GET /api/plastic-issue-query/detail`+`/summary` 正确;无单价权限 单价/金额 null。**起后端 `--contentRoot 输出目录` + 冒烟前 `dotnet build -c Release`(锁先 Stop-Process)。**

## 不做(YAGNI)

- 共用物料切换/精确/高级查询/表格设置;#2-4(退料/报废/盘点查询)后续逐张克隆。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-issue-query` `--no-ff` 合并 → worklog + MEMORY。**确立模板**:#2 退料/#3 报废/#4 盘点查询 照此克隆换数据源(退料/报废 头部门人·盘点带系统/盘点/盈亏数量)。
