# 塑胶订购单查询 · 设计 · 2026-06-26

## 目标

P4 塑胶报表第六张。塑胶物料单(订购单)的只读查询:**汇总查询 + 明细查询**两 Tab,按 订货日期区间 + 审核情况 + 物料类别 + 关键词;明细双击复用 `PlasticMaterialDocDrawer` 按单号开整单(只读)。

## 范围与决策(已确认)

- 数据源:**塑胶物料单(头)+ 塑胶物料明细单**(订购数量/金额);**无独立塑胶采购订单表**。
- 两 Tab:汇总(GROUP BY 物料编号+规格+颜色·SUM 订购数量/金额)+ 明细(逐行);明细双击 `PlasticMaterialDocDrawer` 按单号开。
- 加工单价/金额按「塑胶订购单查询·单价」权限脱敏。
- v1 省略:物料查询(共用物料)切换、精确查询、高级查询、表格设置。

## 架构

后端在 `PlasticMaterialDocService` 加两查询方法(明细 + 汇总),同一 JOIN 链:塑胶物料明细单 JOIN 单头(日期/审核)+ LEFT JOIN 生产制单(款号·生产单号 UNIQUE 1:1)+ LEFT JOIN 塑胶物料资料(材料=物料类别/规格/单位)。新独立 Controller(`/detail`+`/summary`·菜单 塑胶订购单查询·脱敏)。前端新两 Tab 页复用日期工具栏 + tableExport + 现成 `PlasticMaterialDocDrawer`。

## ① 后端

**`PlasticMaterialDocDtos.cs`** 末尾加:
```csharp
public sealed class PlasticOrderQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 货号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 材料 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class PlasticOrderQuerySummaryRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
}
```

**`PlasticMaterialDocService.cs`** 加两方法(共用一段过滤 + JOIN;`审核情况` 片段:已审核→`AND ISNULL(h.审核,'0')='1'`、未审核→`AND ISNULL(h.审核,'0')<>'1'`、空→无):

```csharp
    private static string ApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL(h.[审核],'0')='1'",
        "未审核" => " AND ISNULL(h.[审核],'0')<>'1'",
        _ => "",
    };

    public async Task<IReadOnlyList<PlasticOrderQueryDetailRow>> OrderQueryDetailAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticOrderQueryDetailRow>($@"
SELECT h.[日期], d.[单号], d.[工模编号], d.[生产单号], p.[款号], d.[货号], d.[物料编号], d.[物料名称], d.[颜色],
       m.[物料类别] AS 材料, m.[规格], m.[单位], d.[订购数量] AS 数量, d.[加工单价], d.[金额], h.[审核]
FROM [塑胶物料明细单] d
JOIN [塑胶物料单] h ON h.[单号] = d.[单号]
LEFT JOIN [生产制单] p ON p.[生产单号] = d.[生产单号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([规格]) AS 规格, MAX([单位]) AS 单位
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR m.[规格] LIKE @kw OR d.[货号] LIKE @kw OR p.[款号] LIKE @kw OR d.[生产单号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID]", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticOrderQuerySummaryRow>> OrderQuerySummaryAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticOrderQuerySummaryRow>($@"
SELECT d.[物料编号], MAX(d.[物料名称]) AS 物料名称, MAX(m.[物料类别]) AS 物料类别, m.[规格], d.[颜色], MAX(m.[单位]) AS 单位,
       SUM(ISNULL(d.[订购数量],0)) AS 数量, SUM(ISNULL(d.[金额],0)) AS 金额
FROM [塑胶物料明细单] d
JOIN [塑胶物料单] h ON h.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([规格]) AS 规格, MAX([单位]) AS 单位
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR m.[规格] LIKE @kw OR d.[货号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
GROUP BY d.[物料编号], m.[规格], d.[颜色]
ORDER BY d.[物料编号]", new { qi, qe, kw, cat });
        return rows.AsList();
    }
```
（明细数量=订购数量;汇总按 物料编号+规格+颜色 GROUP·规格取自物料资料子查询的单值列。生产单号 UNIQUE → LEFT JOIN 生产制单 1:1 不放大;物料资料子查询 1:1。）

**`PlasticOrderQueryController.cs`**(新·`Features/Plastics/PlasticOrderQuery/`)
- `[Route("api/plastic-order-query")]`,菜单 `塑胶订购单查询`,注入 `PlasticMaterialDocService` + `IPermissionService`。
- `GET /detail ?起=&止=&keyword=&审核情况=&物料类别=` → 校验「打开」→ DetailAsync → 无「单价」权限 `r.加工单价=null; r.金额=null` → Ok。
- `GET /summary ?...` → SummaryAsync → 无「单价」权限 `r.金额=null` → Ok。

**菜单 + 权限**:`MenuCatalog.cs` 加 `new("塑胶报表","塑胶订购单查询")`;`db/seed_plastic_order_query_perms.sql` admin 9 位,应用两库。

## ② 前端

**`web/src/api/plasticOrderQuery.ts`**:`PlasticOrderQueryDetailRow`/`PlasticOrderQuerySummaryRow`(同后端)+ `plasticOrderQueryApi.detail(起,止,q)`/`.summary(起,止,q)`(q={keyword?,审核情况?,物料类别?})。

**`web/src/pages/plastics/PlasticOrderQueryPage.tsx`**(镜像 `web/src/pages/production/PurchaseOrderQueryPage.tsx` 的两 Tab + 日期工具栏):
- 工具栏:上月/本月/下月 + RangePicker(默认本月)+ 审核情况 `Select`(全部/已审核/未审核)+ 物料类别 `Select`(所有类别 + `plasticMaterialMasterApi.categories()`)+ 关键词 `Input.Search` + 导出EXCEL/打印。
- `Tabs`:汇总查询(列 物料编号/物料名称/物料类别/规格/颜色/单位/数量/金额)+ 明细查询(列 日期/单号/工模编号/生产单号/款号/货号/物料编号/物料名称/颜色/材料/规格/单位/数量/加工单价/金额/审核)。
- 明细行 `onRow.onDoubleClick` → 打开 `PlasticMaterialDocDrawer open 单号={r.单号}`(只读看整单)。
- 加工单价/金额(明细)、金额(汇总)按 `hidePrice(perms,"塑胶订购单查询")` 隐藏。
- 导出/打印:按当前 Tab 列与数据。
- 权限:`can(perms,"塑胶订购单查询","打开")` 守卫。

**`App.tsx`**:加路由 `plastic-order-query` → 页。
**`menuTree.tsx`**:把占位 `M("塑胶订购单查询")` 改为 `M("塑胶订购单查询","/plastic-order-query","塑胶订购单查询")`。

## ③ 测试

- 后端 `PlasticOrderQueryServiceDbTests`:种 款号总表→塑胶物料资料(类别/规格/单位)→生产制单(款号)→塑胶物料单(日期/审核='1')→明细(2 行同物料不同/同规格颜色)→ `OrderQueryDetailAsync`(带款号/材料/规格/数量)+ `OrderQuerySummaryAsync`(GROUP 合计)+ 审核情况/物料类别/keyword 过滤 + 区间外不出。清理(反 FK 序)。
- 全量 `dotnet test` 绿(366 → 367)。
- 前端 `npm --prefix web run test`(54)+ `build` tsc 干净。
- 冒烟:种数据 → `GET /api/plastic-order-query/detail`+`/summary` 正确;无单价权限 加工单价/金额=null。

## 不做(YAGNI)

- 物料查询(共用物料)切换、精确查询、高级查询、表格设置。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-order-query` `--no-ff` 合并 master 删分支 → worklog + MEMORY。
