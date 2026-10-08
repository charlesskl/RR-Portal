# 塑胶标签查询 · 设计 · 2026-06-27

## 目标

P4 塑胶报表第七张。塑胶物料单(标签)的只读查询:**汇总查询 + 明细查询**两 Tab,按 日期区间 + 审核情况 + 物料类别 + 关键词;明细双击复用 `PlasticMaterialDocDrawer` 按单号开整单(只读)。**无价格列 → 无脱敏**(纯数量)。

## 范围与决策(已确认)

- 数据源:**塑胶物料单(头)+ 塑胶物料明细单**(订购数量);同 塑胶订购单查询,复用 `ApprovalFilter`。
- 两 Tab:汇总(GROUP BY 款号+工模编号+物料编号+颜色+货号·SUM 订购数量)+ 明细(逐行);明细双击 `PlasticMaterialDocDrawer` 按单号开。
- **省略三个标签列 每箱数量/预计标签数/实需标签数**(塑胶物料明细单/塑胶共用物料表/塑胶物料资料 均无数据源·同物料侧 来料标签查询)。
- v1 省略:物料查询(共用物料)切换、精确查询、高级查询、表格设置。
- **无价格列**(原系统标签查询无 加工单价/金额)→ Controller 无脱敏、前端无 hidePrice。

## 架构

后端在 `PlasticMaterialDocService` 加两查询方法(明细 + 汇总),同一 JOIN 链:塑胶物料明细单 JOIN 单头(日期/审核)+ LEFT JOIN 生产制单(款号·生产单号 UNIQUE 1:1)+ LEFT JOIN(塑胶物料资料 GROUP BY 物料编号·单位/物料类别)。新独立 Controller(`/detail`+`/summary`·菜单 塑胶标签查询)。前端新两 Tab 页克隆 `PlasticOrderQueryPage`(去脱敏)+ tableExport + 现成 `PlasticMaterialDocDrawer`。

## ① 后端

**`PlasticMaterialDocDtos.cs`** 末尾加:
```csharp
public sealed class PlasticLabelQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class PlasticLabelQuerySummaryRow
{
    public string? 款号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
}
```

**`PlasticMaterialDocService.cs`** 加两方法(复用已存在的 `ApprovalFilter`):

```csharp
    public async Task<IReadOnlyList<PlasticLabelQueryDetailRow>> LabelQueryDetailAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticLabelQueryDetailRow>($@"
SELECT h.[日期], d.[单号], p.[款号], d.[工模编号], d.[物料编号], d.[物料名称], d.[货号] AS 塑胶货号, d.[颜色],
       m.[单位], d.[订购数量] AS 数量, d.[备注], h.[审核]
FROM [塑胶物料明细单] d
JOIN [塑胶物料单] h ON h.[单号] = d.[单号]
LEFT JOIN [生产制单] p ON p.[生产单号] = d.[生产单号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([单位]) AS 单位
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR p.[款号] LIKE @kw OR d.[货号] LIKE @kw OR d.[工模编号] LIKE @kw OR d.[生产单号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID]", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticLabelQuerySummaryRow>> LabelQuerySummaryAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticLabelQuerySummaryRow>($@"
SELECT p.[款号], d.[工模编号], d.[物料编号], MAX(d.[物料名称]) AS 物料名称, d.[颜色], d.[货号] AS 塑胶货号,
       MAX(m.[单位]) AS 单位, SUM(ISNULL(d.[订购数量],0)) AS 数量
FROM [塑胶物料明细单] d
JOIN [塑胶物料单] h ON h.[单号] = d.[单号]
LEFT JOIN [生产制单] p ON p.[生产单号] = d.[生产单号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([单位]) AS 单位
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR p.[款号] LIKE @kw OR d.[货号] LIKE @kw OR d.[工模编号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
GROUP BY p.[款号], d.[工模编号], d.[物料编号], d.[颜色], d.[货号]
ORDER BY p.[款号], d.[工模编号], d.[物料编号]", new { qi, qe, kw, cat });
        return rows.AsList();
    }
```
（明细数量=订购数量;汇总按 款号+工模编号+物料编号+颜色+货号 GROUP·标签按款号/工模口径。生产单号 UNIQUE → LEFT JOIN 生产制单 1:1 不放大;物料资料子查询 1:1。`ApprovalFilter` 复用 塑胶订购单查询 已加的 private 方法。）

**`PlasticLabelQueryController.cs`**(新·`Features/Plastics/PlasticLabelQuery/`)
- `[Route("api/plastic-label-query")]`,菜单 `塑胶标签查询`,注入 `PlasticMaterialDocService` + `IPermissionService`。
- `GET /detail ?起=&止=&keyword=&审核情况=&物料类别=` → 校验「打开」(否则 Forbid)→ LabelQueryDetailAsync → Ok。**无脱敏**。
- `GET /summary ?...` → 校验「打开」→ LabelQuerySummaryAsync → Ok。

**菜单 + 权限**:`MenuCatalog.cs` 加 `new("塑胶报表","塑胶标签查询")`;`db/seed_plastic_label_query_perms.sql` admin 9 位,应用两库。

## ② 前端

**`web/src/api/plasticLabelQuery.ts`**:`PlasticLabelQueryDetailRow`/`PlasticLabelQuerySummaryRow`(同后端)+ `plasticLabelQueryApi.detail(p)`/`.summary(p)`(p={起,止,keyword?,审核情况?,物料类别?})。

**`web/src/pages/plastics/PlasticLabelQueryPage.tsx`**(克隆 `PlasticOrderQueryPage`·去 hidePrice/价格列):
- 工具栏:上月/本月/下月 + RangePicker(默认本月)+ 审核情况 `Select`(全部/已审核/未审核)+ 物料类别 `Select`(所有类别 + `plasticMaterialMasterApi.categories()`)+ 关键词 `Input.Search` + 导出EXCEL/打印。
- `Tabs`:汇总查询(列 款号/工模编号/物料编号/物料名称/颜色/塑胶货号/单位/数量)+ 明细查询(列 日期/单号/款号/工模编号/物料编号/物料名称/塑胶货号/颜色/单位/数量/备注/审核)。
- 明细行 `onRow.onDoubleClick` → 打开 `PlasticMaterialDocDrawer open 单号={r.单号}`(只读看整单)。
- 导出/打印:按当前 Tab 列与数据。
- 权限:`can(perms,"塑胶标签查询","打开")` 守卫。**无 hidePrice**(无价格列)。

**`App.tsx`**:加路由 `plastic-label-query` → 页。
**`menuTree.tsx`**:把占位 `M("塑胶标签查询")` 改为 `M("塑胶标签查询","/plastic-label-query","塑胶标签查询")`。

## ③ 测试

- 后端 `PlasticLabelQueryServiceDbTests`:种 款号总表→塑胶物料资料(单位)→生产制单(款号)→塑胶物料单(日期/审核='1')→明细(2 行同 款号/工模/物料/颜色/货号·订购数量 5/3)→ `LabelQueryDetailAsync`(带款号/工模编号/塑胶货号/单位/数量/备注)+ `LabelQuerySummaryAsync`(GROUP 合计 数量=8)+ 审核情况/物料类别/keyword 过滤 + 区间外不出。清理(反 FK 序:明细→头→生产制单→物料资料→款号总表)。
- 全量 `dotnet test` 绿(367 → 368)。
- 前端 `npm --prefix web run test`(54)+ `build` tsc 干净。
- 冒烟:种数据 → `GET /api/plastic-label-query/detail`+`/summary` 正确(数量/款号/工模/塑胶货号)+ 审核情况过滤;**起后端须 `--contentRoot <bin\Release\net8.0 输出目录>`**(否则不读 appsettings → JWT Issuer/Audience null → 401 IDX10208)。

## 不做(YAGNI)

- 每箱数量/预计标签数/实需标签数(无源)、物料查询(共用物料)切换、精确查询、高级查询、表格设置。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-label-query` `--no-ff` 合并 master 删分支 → worklog + MEMORY。
