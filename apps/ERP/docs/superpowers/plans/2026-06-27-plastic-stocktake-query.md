# 塑胶盘点查询 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 塑胶盘点单 只读两 Tab 查询(汇总按物料编号 + 明细)+ 双击专用只读抽屉。**塑胶各单据查询 4 张之④(收官)**。带 系统数量/盘点数量/盈亏数量;单价取塑胶物料资料、金额=盈亏数量×单价;脱敏。

**Architecture:** 后端扩 `PlasticStocktakeService` 加 StocktakeQueryDetail/Summary(JOIN 盘点明细→盘点单 + LEFT JOIN 共用物料表[塑胶货号/共用货号] + LEFT JOIN 塑胶物料资料[单价/物料类别])。新 Controller。前端两 Tab 页(镜像 PlasticOrderQueryPage·三数量列)+ 专用只读抽屉(列异构:系统/盘点/盈亏数量)。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + AntD v6 + Vitest。

---

## 前置约定

- 分支 `feat-plastic-stocktake-query`;`dotnet`=`C:\Program Files\dotnet\dotnet.exe`,`-c Release`。提交末尾 Co-Authored-By。
- **冒烟前 `dotnet build -c Release`(锁先 Stop-Process)+ 起后端 `--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`。**
- 数据源:头 `塑胶盘点单`(单号/日期/仓库/审核·**无部门/人**)+ 明细 `塑胶盘点明细单`(单号/日期/仓库/物料编号/物料名称/规格/颜色/仓位号/单位/系统数量/盘点数量/盈亏数量/备注·**无单价/金额/塑胶货号/生产单号**·有 [ID])。
- `塑胶共用物料表`(物料编号/塑胶货号/共用原料编号);`塑胶物料资料`(物料编号/单价/物料类别)。
- **单价=m.[单价](塑胶物料资料),金额=d.[盈亏数量]*ISNULL(m.[单价],0)**(镜像物料侧盘点查询)。塑胶货号=cm.[塑胶货号],共用货号=cm.[塑胶货号]。
- 模板参照(master·结构):`PlasticScrapQuery`(Controller/前端两 Tab/脱敏/ApprovalFilter)+ 物料侧 `MaterialStocktakeDetailDrawer.tsx`(盘点专用抽屉列)。
- **服务 ctor**:`PlasticStocktakeService(...)` 多依赖(读源确认·可能含 `PlasticInventoryService`);测试实例化按真实 ctor 传依赖(如 `new PlasticStocktakeService(factory, new PlasticInventoryService(factory))`,以源为准)。查询方法内只用 `factory.Create()`。
- 盘点 GET 整单:`api/plastic-stocktakes`(`plasticDocApi("plastic-stocktakes").get` 返 {单头,明细}·明细含 系统数量/盘点数量/盈亏数量)。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `src/ErpApi/Features/Plastics/PlasticStocktake/PlasticStocktakeDtos.cs` | 加 2 Query DTO | 改 |
| `src/ErpApi/Features/Plastics/PlasticStocktake/PlasticStocktakeService.cs` | ApprovalFilter + Detail/Summary | 改 |
| `src/ErpApi/Features/Plastics/PlasticStocktakeQuery/PlasticStocktakeQueryController.cs` | /detail+/summary·脱敏 | 新建 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加菜单 塑胶盘点查询 | 改 |
| `db/seed_plastic_stocktake_query_perms.sql` | admin 授权 | 新建 |
| `tests/ErpApi.Tests/PlasticStocktakeQueryServiceDbTests.cs` | 测试 | 新建 |
| `web/src/api/plasticStocktakeQuery.ts` / `PlasticStocktakeQueryDetailDrawer.tsx` / `PlasticStocktakeQueryPage.tsx` | 前端 | 新建 |
| `web/src/App.tsx` / `web/src/nav/menuTree.tsx` | 路由+菜单 | 改 |

---

## Task 1: 后端 Detail/Summary + Controller + 菜单 + 种子 + 测试

**Files:** Modify `PlasticStocktakeDtos.cs`, `PlasticStocktakeService.cs`, `MenuCatalog.cs`; Create `PlasticStocktakeQueryController.cs`, `db/seed_plastic_stocktake_query_perms.sql`, `PlasticStocktakeQueryServiceDbTests.cs`

- [ ] **Step 1: DTO** 在 `PlasticStocktakeDtos.cs` 末尾加:
```csharp
public sealed class PlasticStocktakeQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 共用货号 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 系统数量 { get; set; }
    public decimal? 盘点数量 { get; set; }
    public decimal? 盈亏数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}
public sealed class PlasticStocktakeQuerySummaryRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 系统数量 { get; set; }
    public decimal? 盘点数量 { get; set; }
    public decimal? 盈亏数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
```

- [ ] **Step 2: Service** 加 `private static ApprovalFilter`(已知模板)+ 两方法:

```csharp
    public async Task<IReadOnlyList<PlasticStocktakeQueryDetailRow>> StocktakeQueryDetailAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticStocktakeQueryDetailRow>($@"
SELECT h.[日期], d.[单号], d.[物料编号], d.[物料名称], d.[颜色], cm.[塑胶货号] AS 塑胶货号, cm.[塑胶货号] AS 共用货号,
       d.[单位], d.[系统数量], d.[盘点数量], d.[盈亏数量],
       m.[单价] AS 单价, d.[盈亏数量]*ISNULL(m.[单价],0) AS 金额, d.[备注], h.[审核]
FROM [塑胶盘点明细单] d
JOIN [塑胶盘点单] h ON h.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([塑胶货号]) AS 塑胶货号 FROM [塑胶共用物料表] GROUP BY [物料编号]) cm ON cm.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([单价]) AS 单价 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID]", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticStocktakeQuerySummaryRow>> StocktakeQuerySummaryAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticStocktakeQuerySummaryRow>($@"
SELECT d.[物料编号], MAX(d.[物料名称]) AS 物料名称, d.[颜色], MAX(cm.[塑胶货号]) AS 塑胶货号, MAX(m.[物料类别]) AS 物料类别, MAX(d.[单位]) AS 单位,
       SUM(d.[系统数量]) AS 系统数量, SUM(d.[盘点数量]) AS 盘点数量, SUM(d.[盈亏数量]) AS 盈亏数量,
       MAX(m.[单价]) AS 单价, SUM(d.[盈亏数量]*ISNULL(m.[单价],0)) AS 金额
FROM [塑胶盘点明细单] d
JOIN [塑胶盘点单] h ON h.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([塑胶货号]) AS 塑胶货号 FROM [塑胶共用物料表] GROUP BY [物料编号]) cm ON cm.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([单价]) AS 单价 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
GROUP BY d.[物料编号], d.[颜色]
ORDER BY d.[物料编号]", new { qi, qe, kw, cat });
        return rows.AsList();
    }
```
`ApprovalFilter` = `审核情况 switch { "已审核" => " AND ISNULL(h.[审核],'0')='1'", "未审核" => " AND ISNULL(h.[审核],'0')<>'1'", _ => "" }`。`factory` 字段名读源确认。

- [ ] **Step 3: Controller** Create `PlasticStocktakeQueryController.cs`:克隆 `PlasticScrapQueryController` 结构,改 `Menu="塑胶盘点查询"`、`[Route("api/plastic-stocktake-query")]`、注入 `PlasticStocktakeService`、调 `StocktakeQueryDetail/SummaryAsync`,无 单价 权限时置 `单价=null; 金额=null`(明细+汇总)。

- [ ] **Step 4: 菜单** `MenuCatalog.cs` 在 `new("塑胶报表","塑胶报废查询"),` 后加 `new("塑胶报表","塑胶盘点查询"),`。

- [ ] **Step 5: 种子** Create `db/seed_plastic_stocktake_query_perms.sql`(菜单 塑胶盘点查询·克隆),应用两库。

- [ ] **Step 6: 测试** Create `PlasticStocktakeQueryServiceDbTests.cs`:种 共用物料表(PDPM→塑胶货号 H-PD)+物料资料(PDPM·物料类别 ABS·单价 2)+盘点单(PD_D1·日期 2026-06-10·审核'1')+盘点明细(2 行·物料 PDPM·颜色 黑·系统数量 10,5/盘点数量 12,4/盈亏数量 2,-1)→ Detail 验 塑胶货号=H-PD/共用货号=H-PD/系统数量/盘点数量/盈亏数量/单价=2/金额=盈亏×2;Summary 单行·系统数量=15/盘点数量=16/盈亏数量=1/金额=SUM(盈亏×2)=2 + 审核/物料类别/keyword/区间。**ctor 按真实签名实例化**(读源·可能 `new(Factory(), new PlasticInventoryService(Factory()))`)。`using Dapper;`·免款号总表父行。

- [ ] **Step 7: 跑测试** focused PASS;`dotnet test` 全绿(373→374)。报告总数。

- [ ] **Step 8: Commit**
```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticStocktakeQueryServiceDbTests.cs db/seed_plastic_stocktake_query_perms.sql
git commit -m @'
feat(塑胶盘点查询): StocktakeQueryDetail/Summary(系统/盘点/盈亏数量·单价取资料金额=盈亏×单价·脱敏)+Controller+菜单+种子+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 两Tab查询页 + 专用只读抽屉 + API + 路由

**Files:** Create `web/src/api/plasticStocktakeQuery.ts`, `web/src/pages/plastics/PlasticStocktakeQueryDetailDrawer.tsx`, `web/src/pages/plastics/PlasticStocktakeQueryPage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: API** Create `web/src/api/plasticStocktakeQuery.ts`:`PlasticStocktakeQueryDetailRow`(日期/单号/物料编号/物料名称/颜色/塑胶货号/共用货号/单位/系统数量/盘点数量/盈亏数量/单价/金额/备注/审核·数量类 number|null)+`PlasticStocktakeQuerySummaryRow`(物料编号/物料名称/颜色/塑胶货号/物料类别/单位/系统数量/盘点数量/盈亏数量/单价/金额)+`plasticStocktakeQueryApi.detail/summary`(端点 `/plastic-stocktake-query/...`)。

- [ ] **Step 2: 专用抽屉** Create `PlasticStocktakeQueryDetailDrawer.tsx`(克隆 `PlasticScrapDetailDrawer` 但**明细列换 系统数量/盘点数量/盈亏数量**·无单价/金额[盘点单据本身无价]):props `{open,单号?,onClose}`;GET `plasticDocApi("plastic-stocktakes").get(单号)`;Descriptions 头(单号/日期/仓库/审核)+ Table 明细(物料编号/物料名称/规格/颜色/单位/系统数量/盘点数量/盈亏数量/备注)。menu="塑胶盘点查询"。标题 塑胶盘点单。

- [ ] **Step 3: 查询页** Create `PlasticStocktakeQueryPage.tsx`(克隆 `PlasticScrapQueryPage`·改三数量列):MENU="塑胶盘点查询"、API=plasticStocktakeQueryApi、抽屉=PlasticStocktakeQueryDetailDrawer。明细列 日期/单号/物料编号/物料名称/颜色/塑胶货号/共用货号/单位/系统数量/盘点数量/盈亏数量/(单价/金额 priceHidden)/备注/审核;汇总列 物料编号/物料名称/颜色/塑胶货号/单位/系统数量/盘点数量/盈亏数量/(单价/金额 priceHidden)。金额列 `.toFixed(2)`。盈亏数量可负正常显示。导出按 Tab。

- [ ] **Step 4: 路由+菜单** `App.tsx` 加 import + `<Route path="plastic-stocktake-query" element={<PlasticStocktakeQueryPage />} />`;`menuTree.tsx` 占位 `M("塑胶盘点查询")` → 带路由。

- [ ] **Step 5: 测试+构建** `npm --prefix D:\WebpageERP\web run test`(54)+ `run build`(tsc 干净)。

- [ ] **Step 6: Commit**
```powershell
git add web/src/api/plasticStocktakeQuery.ts web/src/pages/plastics/PlasticStocktakeQueryDetailDrawer.tsx web/src/pages/plastics/PlasticStocktakeQueryPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(塑胶盘点查询): 前端两Tab查询页+专用只读抽屉(系统/盘点/盈亏数量·脱敏)+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟** Release 重建(锁先 Stop-Process)+ 起后端(`--contentRoot 输出目录`)。Node:种 共用物料表 PDSMK→H-PD·物料资料 PDSMK 单价2·盘点单本月审核1·明细 PDSMK 系统数量10/盘点数量12/盈亏数量2 + 系统数量5/盘点数量4/盈亏数量-1 → `GET /api/plastic-stocktake-query/detail?keyword=PDSMK` 验 塑胶货号 H-PD/系统/盘点/盈亏/单价2/金额=盈亏×2;`/summary` 单行 系统15/盘点16/盈亏1;未审核空。清理。
- [ ] **Step 2: opus 全分支终审** 派 opus 审 `feat-plastic-stocktake-query`:JOIN 1:1、塑胶货号/共用货号=cm.塑胶货号、单价=m.单价、金额=盈亏×单价(明细)/SUM(盈亏×单价)(汇总)、汇总 GROUP BY 物料编号+颜色 三数量 SUM、ApprovalFilter、脱敏(单价+金额 明细+汇总)、专用抽屉系统/盘点/盈亏、盈亏可负、菜单/权限/DI、双击 plastic-stocktakes、测试自洽(盈亏=盘点−系统)、其它三查询模板未动。目标 READY。
- [ ] **Step 3: 合并** `git checkout master; git merge --no-ff feat-plastic-stocktake-query -m "...(塑胶盘点查询·4张收官)..."; git branch -d feat-plastic-stocktake-query`。
- [ ] **Step 4: worklog + MEMORY** `docs/worklogs/2026-06-27-plastic-stocktake-query.md`;更新记忆(**4 张塑胶单据查询全完成**)。Commit。

---

## 自审清单
- 三数量列(系统/盘点/盈亏)贯穿 DTO/SQL/前端/抽屉;单价=物料资料、金额=盈亏×单价(明细)与 SUM(盈亏×单价)(汇总)。
- 盘点单头无部门/人(与领料/退料/报废不同),查询无部门/人列。
- 脱敏 单价/金额 明细+汇总;专用抽屉列异构(系统/盘点/盈亏·无价)。
- ctor 多依赖→测试按真实签名实例化(读源)。
- JOIN cm/m 各 GROUP BY 物料编号 1:1;汇总 GROUP BY 物料编号+颜色合法(非分组列 MAX/SUM)。
