# 加工采购查询 · 设计 · 2026-06-29

## 目标

⑩ 发外加工「加工采购查询」落地。只读两 Tab(汇总+明细)查询 over **塑胶加工采购单/明细**(刚建),明细双击新建只读抽屉看整单。带价脱敏。镜像塑胶单据查询系列(如 `PlasticReceiptQuery`)。

## 范围与决策(已确认)

- **汇总 GROUP BY 模具编号+物料编号+颜色+加工内容**;SUM(数量)=订购数量、SUM(金额)=总金额。
- **共用物料 = cm.共用原料编号**(LEFT JOIN 塑胶共用物料表 GROUP BY 物料编号 1:1);单位/物料类别 来自塑胶物料资料(GROUP BY 物料编号)。
- 明细双击 → **新建只读抽屉**(GET `/api/plastic-process-purchase-orders/{单号}`·单价脱敏)。
- 单价/金额(明细)+总金额(汇总)按「加工采购查询·单价」权限脱敏。
- 保留 上月/本月/下月+RangePicker(默认本月)+审核情况(全部/已审核/未审核)+物料类别下拉+关键词+导出/打印。v1 省略 物料查询(共用物料)切换/精确/高级查询/表格设置。

## 数据源

- 头 `塑胶加工采购单`(日期/加工厂名称/审核)+ 明细 `塑胶加工采购单明细`(生产单号/款号/模具编号/物料编号/物料名称/用料名称/颜色/加工内容/数量/单价/金额/备注·有 [ID])。
- LEFT JOIN `塑胶共用物料表`(GROUP BY 物料编号·共用原料编号)、`塑胶物料资料`(GROUP BY 物料编号·单位/物料类别)。1:1 不放大。

## ① 后端(扩 `PlasticProcessPurchaseOrderService`)

**DTO**(`PlasticProcessPurchaseOrderDtos.cs` 末尾加):
```csharp
public sealed class PlasticProcessPurchaseQueryDetailRow
{
    public DateTime? 单据日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 加工内容 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}
public sealed class PlasticProcessPurchaseQuerySummaryRow
{
    public string? 模具编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 共用物料 { get; set; }
    public string? 加工内容 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 订购数量 { get; set; }
    public decimal? 总金额 { get; set; }
}
```

**`PlasticProcessPurchaseOrderService.cs`** 加 `private static ApprovalFilter`(已审核→` AND ISNULL(h.[审核],'0')='1'`、未审核→`<>'1'`、_→"")+ 两方法:

明细:
```sql
SELECT h.[日期] AS 单据日期, d.[单号], h.[加工厂名称], d.[生产单号], d.[款号], d.[模具编号], d.[物料编号], d.[物料名称],
       d.[用料名称], d.[颜色], d.[加工内容], m.[单位], d.[数量], d.[单价], d.[金额], d.[备注], h.[审核]
FROM [塑胶加工采购单明细] d
JOIN [塑胶加工采购单] h ON h.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位, MAX([物料类别]) AS 物料类别 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[单号] LIKE @kw OR h.[加工厂名称] LIKE @kw OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID]
```
汇总:`GROUP BY d.[模具编号], d.[物料编号], d.[颜色], d.[加工内容]`,SELECT `d.[模具编号], d.[物料编号], MAX(d.[物料名称]) 物料名称, d.[颜色], MAX(cm.[共用原料编号]) 共用物料, d.[加工内容], MAX(m.[物料类别]) 物料类别, MAX(m.[单位]) 单位, SUM(d.[数量]) 订购数量, SUM(ISNULL(d.[金额],0)) 总金额`,JOIN 同明细 + `LEFT JOIN (SELECT [物料编号], MAX([共用原料编号]) AS 共用原料编号 FROM [塑胶共用物料表] GROUP BY [物料编号]) cm ON cm.[物料编号]=d.[物料编号]`,WHERE 同(keyword 去 单号/加工厂/生产单号/款号 亦可),`ORDER BY d.[物料编号]`。(明细也加 cm JOIN 以便 keyword 一致——可选;明细不出共用物料列故可不加。)

**`PlasticProcessPurchaseQueryController.cs`**(新·`Features/Plastics/PlasticProcessPurchaseQuery/`):`[Route("api/plastic-process-purchase-query")]`·菜单 `加工采购查询`·注入 `PlasticProcessPurchaseOrderService`+`IPermissionService`·`/detail`+`/summary`(校验打开→查询→无单价权限:明细置 单价/金额 null·汇总置 总金额 null→Ok)。

**菜单 + 权限**:`MenuCatalog` 加 `new("发外加工","加工采购查询")`;`db/seed_plastic_process_purchase_query_perms.sql` admin 9 位·两库。

## ② 前端

- `api/plasticProcessPurchaseQuery.ts`:两 Row 接口 + `detail/summary(p)`(p={起,止,keyword?,审核情况?,物料类别?})。
- `PlasticProcessPurchaseOrderQueryDetailDrawer.tsx`(新·只读):props `{open,单号?,onClose}`;GET `plasticProcessPurchaseOrderApi.get(单号)`;Descriptions 头(单号/日期/加工厂名称/客户名称/审核)+ Table 明细(生产单号/款号/模具编号/物料编号/物料名称/用料名称/颜色/加工内容/数量/单价/金额/备注·单价金额 `hidePrice(perms,"加工采购查询")` 隐藏)。
- `PlasticProcessPurchaseQueryPage.tsx`(镜像 `PlasticReceiptQueryPage` 两 Tab):工具栏 上月/本月/下月+RangePicker+审核情况+物料类别(categories)+关键词+导出/打印;明细列见上(单价/金额 priceHidden);汇总列 模具编号/物料编号/物料名称/颜色/共用物料/加工内容/单位/订购数量/(总金额 priceHidden);明细 onDoubleClick → Drawer 单号。
- `App.tsx` 路由 `plastic-process-purchase-query`;`menuTree.tsx` ⑩ 占位 `M("加工采购查询")` → 带路由。

## ③ 测试

- 后端 `PlasticProcessPurchaseQueryServiceDbTests`:种 共用物料表(物料→共用原料编号 CR)+物料资料(单位/物料类别)+塑胶加工采购单(加工厂名称/日期/审核1)+明细(2 行·模具编号/物料/颜色/加工内容/数量/单价)→ Detail 验 加工厂名称/模具编号/加工内容/单位/数量;Summary GROUP 合计 + 共用物料=CR;审核情况/物料类别/keyword/区间过滤。清理(明细/单·共用物料表·物料资料·加工采购单塑胶表无 FK 免父行)。
- 全量 `dotnet test` 绿(389→390);前端 54 + tsc 干净。
- 冒烟:种链 → `GET /api/plastic-process-purchase-query/detail`+`/summary` 正确·单价脱敏。**起后端 `--contentRoot 输出目录` + 冒烟前 `dotnet build -c Release`(锁先按 PID Stop-Process)。**

## 不做(YAGNI)

- 物料查询(共用物料)切换/精确/高级查询/表格设置。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-process-purchase-query` `--no-ff` 合并 → worklog + MEMORY。
