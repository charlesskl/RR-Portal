# 塑胶分析明细查询 · 设计 · 2026-06-26

## 目标

P4 塑胶报表第五张。塑胶物料单(塑胶采购分析)的**扁平明细查询**:按日期区间 + 关键词 + 完成情况,列出每条塑胶物料明细行(只读·单 Tab·镜像物料侧查询页)。

## 范围与决策(已确认)

- 单 Tab 扁平明细(无汇总 Tab)。
- 完成情况:接 **生产制单.完成**(存 N'是'/N'否'·LEFT JOIN 生产单号),下拉 全部/已完成(是)/未完成(否)。
- 加工单价/金额:**带价 + 按「塑胶分析明细查询·单价」权限脱敏**(无权限置 null)。

## 架构

后端在 `PlasticMaterialDocService`(P2 已建)加查询方法:塑胶物料明细单 JOIN 单头(日期)+ LEFT JOIN 生产制单(款号/完成)+ LEFT JOIN 塑胶物料资料(材料=物料类别/单位),按日期区间 + 关键词 + 完成过滤,返回扁平行。新独立 Controller(菜单 塑胶分析明细查询,加工单价/金额脱敏)。前端新查询页复用日期工具栏 + tableExport。

## ① 后端

**`src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocDtos.cs`** 末尾加:
```csharp
public sealed class PlasticAnalysisDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 货号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 材料 { get; set; }
    public string? 单位 { get; set; }
    public string? 加工内容 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 完成 { get; set; }
}
```

**`PlasticMaterialDocService.cs`** 加方法:
```csharp
public async Task<IReadOnlyList<PlasticAnalysisDetailRow>> AnalysisDetailAsync(DateTime 起, DateTime 止, string? keyword, string? 完成)
{
    var qi = 起.Date; var qe = 止.Date.AddDays(1);
    var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
    var done = string.IsNullOrWhiteSpace(完成) ? null : 完成.Trim();   // 是/否/null
    using var c = factory.Create();
    var rows = await c.QueryAsync<PlasticAnalysisDetailRow>(@"
SELECT h.[日期], d.[生产单号], p.[款号], d.[货号], d.[物料编号], d.[物料名称], d.[颜色],
       m.[物料类别] AS 材料, m.[单位], d.[加工内容], d.[订购数量] AS 数量,
       d.[加工单价], d.[金额], ISNULL(p.[完成], N'否') AS 完成
FROM [塑胶物料明细单] d
JOIN [塑胶物料单] h ON h.[单号] = d.[单号]
LEFT JOIN [生产制单] p ON p.[生产单号] = d.[生产单号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([单位]) AS 单位
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[生产单号] LIKE @kw OR p.[款号] LIKE @kw OR d.[货号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@done IS NULL OR ISNULL(p.[完成], N'否') = @done)
ORDER BY h.[日期] DESC, d.[单号], d.[ID]", new { qi, qe, kw, done });
    return rows.AsList();
}
```
（生产单号在生产制单内唯一 → LEFT JOIN 1:1 不放大;数量取明细 订购数量。）

**`src/ErpApi/Features/Plastics/PlasticAnalysis/PlasticAnalysisController.cs`**(新)
- `[Route("api/plastic-analysis-detail")]`,菜单 `塑胶分析明细查询`,注入 `PlasticMaterialDocService` + `IPermissionService`。
- `GET ?起=&止=&keyword=&完成=` → 校验「打开」→ `AnalysisDetailAsync` → 无「单价」权限 `foreach r: r.加工单价=null; r.金额=null` → Ok。

**菜单 + 权限**:`MenuCatalog.cs` 加 `new("塑胶报表","塑胶分析明细查询")`;`db/seed_plastic_analysis_perms.sql` 给 admin 9 位,应用两库。

## ② 前端

**`web/src/api/plasticAnalysis.ts`**:`PlasticAnalysisDetailRow`(同后端字段)+ `plasticAnalysisApi.list(起,止,keyword?,完成?)`。

**`web/src/pages/plastics/PlasticAnalysisDetailPage.tsx`**(镜像 `PlasticInOutReportPage` 日期工具栏 + 物料查询页脱敏):
- 工具栏:上月/本月/下月 + RangePicker(默认本月)+ 完成情况 `Select`(全部=空/已完成=是/未完成=否)+ 关键词 `Input.Search` + 导出EXCEL/打印。
- 表列:日期(slice 10)| 生产单号 | 款号 | 货号 | 物料编号 | 物料名称 | 颜色 | 材料 | 单位 | 加工内容 | 数量 | 加工单价 | 金额 | 完成;`hidePrice(perms,"塑胶分析明细查询")` 为真去 加工单价/金额 两列。
- 底部汇总:数量、金额(脱敏不显金额)合计。
- 权限:`can(perms,"塑胶分析明细查询","打开")` 守卫。

**`App.tsx`**:加路由 `plastic-analysis-detail` → 页。
**`menuTree.tsx`**:把占位 `M("塑胶分析明细查询")` 改为 `M("塑胶分析明细查询","/plastic-analysis-detail","塑胶分析明细查询")`。

## ③ 测试

- 后端 `PlasticAnalysisDetailServiceDbTests`:种 塑胶物料单(日期本月)+ 明细(加工内容/订购数量/加工单价/金额)+ 生产制单(生产单号→款号/完成='是')+ 塑胶物料资料(物料类别/单位)→ `AnalysisDetailAsync(本月,null,null)` 行带出 款号/材料/单位/数量/加工单价/完成;`完成="否"` 过滤排除已完成行;`keyword=款号` 过滤;区间外不出。清理。
- 全量 `dotnet test` 绿(365 → 366)。
- 前端 `npm --prefix web run test`(54)+ `build` tsc 干净。
- 冒烟:种数据 → `GET /api/plastic-analysis-detail?起=&止=` 返回明细;无单价权限 加工单价/金额=null。

## 不做(YAGNI)

- 汇总 Tab、精确查询、表格设置、双击开整单、按审核过滤。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-analysis-detail` `--no-ff` 合并 master 删分支 → worklog + MEMORY。
