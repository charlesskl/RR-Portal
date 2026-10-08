# 塑胶订单制作 · 设计 · 2026-06-29

## 目标

⑦ 塑胶采购 的占位项「塑胶订单制作」落地。**只读单表平铺查询**:把已审核(调整审核='1')的塑胶 BOM(塑胶共用物料表)按生产单展开列出,供查看/导出。提示"只显示已审核物料BOM清单内容"。**无录入/无开单**(开单是"塑胶采购分析"的职责)。

## 范围与决策(已确认)

- **已审核 = 塑胶共用物料表.调整审核='1'**(BOM 清单本身已调整审核/做完)。
- **订购数量 = 塑胶共用物料表.用量 × 生产制单.计划数量**(BOM 展开总需求)。
- **订单单号列省略**(生产制单货号/塑胶共用物料表均无 ZCS 订单单号源)。
- 加工单价/金额按「塑胶订单制作·单价」权限脱敏(金额=订购数量×加工单价)。
- v1 省略:开单/创建、精确/高级查询、日期类型切换、表格设置。保留 上月/本月/下月+RangePicker(默认本月)+关键词+导出EXCEL/打印+顶部"共 N 条"。

## 数据源 / JOIN

```
生产制单货号 g
JOIN 塑胶共用物料表 p ON p.[塑胶货号] = g.[货号]
JOIN 生产制单 pm ON pm.[生产单号] = g.[生产单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = p.[物料编号]
WHERE pm.[日期] >= @qi AND pm.[日期] < @qe
  AND p.[调整审核] = '1'
  AND (@kw IS NULL OR g.[生产单号] LIKE @kw OR pm.[款号] LIKE @kw OR p.[物料编号] LIKE @kw OR p.[物料名称] LIKE @kw OR g.[货号] LIKE @kw)
```
- `生产制单货号 g`(生产单号/货号·一生产单多货号)、`塑胶共用物料表 p`(塑胶货号/工模编号/物料编号/物料名称/颜色/用料名称/加工内容/加工单价/用量/调整审核)、`生产制单 pm`(生产单号/款号/日期/计划数量)、`塑胶物料资料 m`(单位·GROUP BY 物料编号 1:1)。
- p JOIN g 按 塑胶货号=货号 可能 1:N(一货号多 BOM 行)——这是 BOM 展开,正常。pm/m 各 1:1 不额外放大。

## ① 后端

**DTO**(`PlasticMaterialDocDtos.cs` 末尾加):
```csharp
public sealed class PlasticOrderMakeRow
{
    public DateTime? 单据日期 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 用量 { get; set; }
    public decimal? 计划数量 { get; set; }
    public decimal? 订购数量 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 金额 { get; set; }
}
```

**`PlasticMaterialDocService.cs`** 加方法:
```csharp
    public async Task<IReadOnlyList<PlasticOrderMakeRow>> OrderMakeListAsync(DateTime 起, DateTime 止, string? keyword)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticOrderMakeRow>(@"
SELECT pm.[日期] AS 单据日期, g.[生产单号], pm.[款号], g.[货号] AS 塑胶货号, p.[工模编号], p.[物料编号], p.[物料名称], p.[颜色],
       p.[用料名称], m.[单位], p.[用量], pm.[计划数量],
       p.[用量]*ISNULL(pm.[计划数量],0) AS 订购数量, p.[加工单价],
       p.[用量]*ISNULL(pm.[计划数量],0)*ISNULL(p.[加工单价],0) AS 金额
FROM [生产制单货号] g
JOIN [塑胶共用物料表] p ON p.[塑胶货号] = g.[货号]
JOIN [生产制单] pm ON pm.[生产单号] = g.[生产单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = p.[物料编号]
WHERE pm.[日期] >= @qi AND pm.[日期] < @qe
  AND p.[调整审核] = '1'
  AND (@kw IS NULL OR g.[生产单号] LIKE @kw OR pm.[款号] LIKE @kw OR p.[物料编号] LIKE @kw OR p.[物料名称] LIKE @kw OR g.[货号] LIKE @kw)
ORDER BY g.[生产单号], p.[物料编号]", new { qi, qe, kw });
        return rows.AsList();
    }
```

**`PlasticOrderMakeController.cs`**(新·`Features/Plastics/PlasticOrderMake/`)
- `[Route("api/plastic-order-make")]`,菜单 `塑胶订单制作`,注入 `PlasticMaterialDocService` + `IPermissionService`。
- `GET ?起=&止=&keyword=` → 校验「打开」→ `OrderMakeListAsync` → 无「单价」权限 `r.加工单价=null; r.金额=null` → Ok。

**菜单 + 权限**:`MenuCatalog` 在 `new("塑胶采购","塑胶物料单"),` 后加 `new("塑胶采购","塑胶订单制作"),`(组名"塑胶采购"已核实);`db/seed_plastic_order_make_perms.sql` admin 9 位·两库。

## ② 前端

- `api/plasticOrderMake.ts`:`PlasticOrderMakeRow`(同后端)+ `plasticOrderMakeApi.list({起,止,keyword?})`。
- `PlasticOrderMakePage.tsx`(单 Tab 平铺·镜像查询页工具栏去 Tab):上月/本月/下月 + RangePicker(默认本月)+ 关键词(生产单号/款号/物料)+ 导出EXCEL/打印 + 顶部"共 N 条";列 单据日期/生产单号/款号/塑胶货号/工模编号/物料编号/物料名称/颜色/用料名称/单位/用量/计划数量/订购数量/(加工单价/金额 hidePrice 隐藏);`can(perms,"塑胶订单制作","打开")` 守卫。
- `App.tsx` 路由 `plastic-order-make`;`menuTree.tsx` ⑦ 塑胶采购 占位 `M("塑胶订单制作")` → `M("塑胶订单制作","/plastic-order-make","塑胶订单制作")`。

## ③ 测试

- 后端 `PlasticOrderMakeServiceDbTests`:种 款号总表(父)→生产制单(生产单号/款号/日期 2026-06-10/计划数量 100)→生产制单货号(生产单号→货号 H-OM)→塑胶共用物料表(塑胶货号 H-OM·物料 OMPM·用量 2·加工单价 3·**调整审核 '1'**·另一行 调整审核 '0' 应被过滤)→塑胶物料资料(OMPM·单位 kg)→ `OrderMakeListAsync(2026-06-01..30,"OMPM")` 验:仅调整审核1行出·订购数量=用量2×计划100=200·金额=200×3=600·款号/单位带出;keyword/区间过滤;调整审核0行不出。清理(反序·含款号总表)。**坑:生产制单.款号 FK→款号总表 须先种父行。**
- 全量 `dotnet test` 绿(374→375);前端 54 + tsc 干净。
- 冒烟:种链 → `GET /api/plastic-order-make` 订购数量=用量×计划数量、金额脱敏验证。**起后端 `--contentRoot 输出目录` + 冒烟前 `dotnet build -c Release`(锁先 Stop-Process)。**

## 不做(YAGNI)

- 开单/创建、精确/高级查询、日期类型切换、表格设置、订单单号列。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-order-make` `--no-ff` 合并 → worklog + MEMORY。
