# 原料采购分析表 · 设计 · 2026-06-30

## 目标

⑪ 原料仓库「原料采购分析表」只读**汇总**报表。按原料编号交叉 **库存**(塑胶原料资料)与 **生产需求**(原料生产需求表·审核1)→ **可购数量 = 生产需求 + 安全库存 − 库存**(采购缺口)。**零新表**。

## 范围与决策(已确认)

- 可购数量 = `生产需求 + 安全库存 − 库存`(含安全库存·>0=需采购)。
- 按 **原料编号** 汇总;过滤 物料类别 + keyword + 只看可购(可购>0);**无日期**(快照)。
- 无单价/金额 → 无脱敏。
- **不做**:采购在途(无源)、最高库存列、双击进单。

## 数据源

- 原料主数据:`塑胶原料资料`(物料编号=原料编号/物料名称/规格/单位/库存/安全库存/物料类别)。
- 生产需求:`原料生产需求明细单 d JOIN 原料生产需求表 h`(审核1)·按 原料编号 `SUM(需求数量KG)=生产需求`(子查询 dm·1:1)。

## ① 后端(扩 `PlasticRawMaterialMaster/PlasticRawMaterialMasterService`)

**DTO**(`PlasticRawMaterialMasterDtos.cs` 末尾加):
```csharp
public sealed class PlasticRawMaterialPurchaseRow
{
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 当前库存 { get; set; }
    public decimal? 安全库存 { get; set; }
    public decimal? 生产需求 { get; set; }
    public decimal? 可购数量 { get; set; }
}
```

**`PlasticRawMaterialMasterService.cs`** 加方法:
```csharp
public async Task<IReadOnlyList<PlasticRawMaterialPurchaseRow>> PurchaseAnalysisAsync(
    string? 物料类别, string? keyword, bool onlyBuy)
{
    var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
    var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
    using var c = factory.Create();
    var rows = await c.QueryAsync<PlasticRawMaterialPurchaseRow>(@"
SELECT m.[物料编号] AS 原料编号, MAX(m.[物料名称]) AS 原料名称, MAX(m.[规格]) AS 规格,
       MAX(m.[物料类别]) AS 物料类别, MAX(m.[单位]) AS 单位,
       MAX(ISNULL(m.[库存],0)) AS 当前库存, MAX(ISNULL(m.[安全库存],0)) AS 安全库存,
       MAX(ISNULL(dm.[生产需求],0)) AS 生产需求,
       MAX(ISNULL(m.[安全库存],0)) + MAX(ISNULL(dm.[生产需求],0)) - MAX(ISNULL(m.[库存],0)) AS 可购数量
FROM [塑胶原料资料] m
LEFT JOIN (
    SELECT d.[原料编号], SUM(d.[需求数量KG]) AS 生产需求
    FROM [原料生产需求明细单] d
    JOIN [原料生产需求表] h ON h.[单号] = d.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
    GROUP BY d.[原料编号]
) dm ON dm.[原料编号] = m.[物料编号]
WHERE (@cat IS NULL OR m.[物料类别] = @cat)
  AND (@kw IS NULL OR m.[物料编号] LIKE @kw OR m.[物料名称] LIKE @kw)
GROUP BY m.[物料编号]
HAVING (@onlyBuy = 0 OR (MAX(ISNULL(m.[安全库存],0)) + MAX(ISNULL(dm.[生产需求],0)) - MAX(ISNULL(m.[库存],0))) > 0)
ORDER BY m.[物料编号]", new { cat, kw, onlyBuy = onlyBuy ? 1 : 0 });
    return rows.AsList();
}
```

**`PlasticRawMaterialPurchaseAnalysisController.cs`**(新·`Features/Plastics/PlasticRawMaterialPurchaseAnalysis/`):
- `[Route("api/plastic-raw-material-purchase-analysis")]`·`Menu="原料采购分析表"`·注入 `PlasticRawMaterialMasterService` + `IPermissionService`。
- `GET /`(参 物料类别/keyword/onlyBuy)→ 校验 打开 → PurchaseAnalysisAsync → Ok(无脱敏)。

**菜单 + 权限**:`MenuCatalog.cs` 加 `new("原料仓库","原料采购分析表")`;`db/seed_plastic_raw_material_purchase_analysis_perms.sql`(**确认文件名未占用**)admin 9 位(两库)。DI 复用已注册 PlasticRawMaterialMasterService。

## ② 前端(新报表页·镜像 物料发外欠数表 PlasticProcessShortagePage 结构)

- `api/plasticRawMaterialPurchaseAnalysis.ts`:`PlasticRawMaterialPurchaseRow` + `Params{物料类别?,keyword?,onlyBuy?}` + `list(p)` → `/plastic-raw-material-purchase-analysis`。
- `PlasticRawMaterialPurchaseAnalysisPage.tsx`:`MENU="原料采购分析表"`;工具栏 物料类别 Select(`plasticRawMaterialMasterApi.categories()`)+ keyword + **只看可购 Checkbox** + 导出EXCEL/打印。列:原料编号/原料名称/规格/物料类别/单位/当前库存/安全库存/生产需求(KG)/可购数量(可购>0 红色)。无脱敏。
- `App.tsx`:import + `<Route path="plastic-raw-material-purchase-analysis" element={<PlasticRawMaterialPurchaseAnalysisPage />} />`。
- `menuTree.tsx`:`M("原料采购分析表")` → `M("原料采购分析表","/plastic-raw-material-purchase-analysis","原料采购分析表")`。

## ③ 测试

- 后端 `PlasticRawMaterialPurchaseAnalysisServiceDbTests`:种 塑胶原料资料(原料 RA-PA·类别 ABS·库存10·安全库存5)+ 原料生产需求表(审核1)+ 明细(原料 RA-PA·需求数量KG 8)→ PurchaseAnalysisAsync 单行:生产需求=8/当前库存=10/安全库存=5/可购数量=8+5−10=3;物料类别过滤;onlyBuy=true 含(3>0);再种一行 库存够(库存100)验 onlyBuy 排除(可购=8+5−100=−87<0)。Clean 逆序删。
- 全量 `dotnet test` 绿(407→≥409);前端 54 + `tsc` 干净。
- **HTTP 冒烟**:种 原料+需求 → `GET /api/plastic-raw-material-purchase-analysis?onlyBuy=true&keyword=` 验 生产需求/可购数量;物料类别过滤。**起后端 Release(锁先 PID Stop-Process)+ `--contentRoot 输出目录`;node axios `proxy:false`。**

## 不做(YAGNI)

- 采购在途、最高库存、双击进单、表格设置。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-raw-material-purchase-analysis` `--no-ff` 合并 master → worklog + MEMORY。
