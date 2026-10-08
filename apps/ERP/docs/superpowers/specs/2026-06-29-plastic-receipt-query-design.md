# 塑胶入仓查询 · 设计 · 2026-06-29

## 目标

⑨ 塑胶报表「塑胶入仓查询」落地(塑胶入仓查询拆两步的**第 2 步**;第 1 步加工入仓单录入保真已扩 订单单号/工模编号)。只读两 Tab(汇总按物料编号 + 明细)over 塑胶入仓单/塑胶入仓明细单,明细双击新建只读抽屉看整单。带价脱敏。**姊妹张 塑胶退仓查询 照此克隆**。

## 范围与决策(已确认·沿用塑胶单据查询系列口径)

- **共用货号 = cm.塑胶货号;共用物料 = cm.共用原料编号**(LEFT JOIN 塑胶共用物料表 GROUP BY 物料编号 1:1);塑胶货号列取 d.[塑胶货号](入仓明细自带)。
- **汇总按 物料编号 + 颜色**(入库统计口径,已拍板)。
- 明细双击 → **新建只读抽屉**(GET `api/plastic-receipts/{单号}` 拉 {单头,明细}·单价脱敏)。
- 单价/金额(明细+汇总+抽屉)按「塑胶入仓查询·单价」权限脱敏。
- 保留 上月/本月/下月+RangePicker(默认本月)+审核情况(全部/已审核/未审核)+物料类别下拉+关键词+导出/打印。v1 省略物料查询切换/精确/高级/表格设置。

## 数据源

- 头 `塑胶入仓单`(供应商编号/供应商名称/日期/审核/订单单号)+ 明细 `塑胶入仓明细单`(订单单号/生产单号/款号/工模编号/物料编号/物料名称/规格/颜色/塑胶货号/仓位号/单位/数量/单价/金额/备注·有 [ID])。
- LEFT JOIN `塑胶共用物料表`(GROUP BY 物料编号·塑胶货号/共用原料编号)、`塑胶物料资料`(GROUP BY 物料编号·物料类别)。两子查询 1:1 不放大。

## ① 后端(扩 `PlasticReceiptService`)

**DTO**(`PlasticReceiptDtos.cs` 末尾加):
```csharp
public sealed class PlasticReceiptQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 共用货号 { get; set; }
    public string? 供应商 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}
public sealed class PlasticReceiptQuerySummaryRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 共用货号 { get; set; }
    public string? 共用物料 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
}
```

**`PlasticReceiptService.cs`** 加 `private static ApprovalFilter`(已知模板:已审核→` AND ISNULL(h.[审核],'0')='1'`、未审核→`<>'1'`、_→"")+ 两方法:

明细:
```sql
SELECT h.[日期], d.[单号], d.[订单单号], d.[生产单号], d.[款号], d.[工模编号], d.[物料编号], d.[物料名称], d.[颜色],
       d.[塑胶货号] AS 塑胶货号, cm.[塑胶货号] AS 共用货号, h.[供应商名称] AS 供应商,
       d.[单位], d.[数量], d.[单价], d.[金额], d.[备注], h.[审核]
FROM [塑胶入仓明细单] d
JOIN [塑胶入仓单] h ON h.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([塑胶货号]) AS 塑胶货号, MAX([共用原料编号]) AS 共用原料编号 FROM [塑胶共用物料表] GROUP BY [物料编号]) cm ON cm.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[订单单号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID]
```
汇总:`GROUP BY d.[物料编号], d.[颜色]`,SELECT `d.[物料编号], MAX(d.[物料名称]) 物料名称, d.[颜色], MAX(d.[塑胶货号]) 塑胶货号, MAX(cm.[塑胶货号]) 共用货号, MAX(cm.[共用原料编号]) 共用物料, MAX(m.[物料类别]) 物料类别, MAX(d.[单位]) 单位, SUM(d.[数量]) 数量, SUM(ISNULL(d.[金额],0)) 金额`,同 JOIN/WHERE(keyword 去 订单单号/生产单号/款号 亦可保留),`ORDER BY d.[物料编号]`。

**`PlasticReceiptQueryController.cs`**(新·`Features/Plastics/PlasticReceiptQuery/`):`[Route("api/plastic-receipt-query")]`·菜单 `塑胶入仓查询`·注入 `PlasticReceiptService`+`IPermissionService`·`/detail`+`/summary`(校验打开→查询→无单价权限置 单价/金额 null→Ok)。

**菜单 + 权限**:`MenuCatalog` 加 `new("塑胶报表","塑胶入仓查询")`;`db/seed_plastic_receipt_query_perms.sql` admin 9 位·两库。

## ② 前端

- `api/plasticReceiptQuery.ts`:两 Row 接口 + `detail/summary(p)`(p={起,止,keyword?,审核情况?,物料类别?})。
- `PlasticReceiptQueryDetailDrawer.tsx`(新·只读):props `{open,单号?,onClose}`;GET `plasticDocApi("plastic-receipts").get(单号)`;Descriptions 头(单号/日期/供应商/订单单号/审核)+ Table 明细(订单单号/生产单号/款号/工模编号/物料编号/物料名称/颜色/塑胶货号/单位/数量/单价/金额/备注·单价金额 `hidePrice(perms,"塑胶入仓查询")` 隐藏)。
- `PlasticReceiptQueryPage.tsx`(镜像 `PlasticOrderQueryPage` 两 Tab):工具栏 上月/本月/下月+RangePicker+审核情况+物料类别(categories)+关键词+导出/打印;明细列 日期/单号/订单单号/生产单号/款号/工模编号/物料编号/物料名称/颜色/塑胶货号/共用货号/供应商/单位/数量/单价/金额/备注/审核(单价/金额 priceHidden);汇总列 物料编号/物料名称/颜色/塑胶货号/共用货号/共用物料/单位/数量/金额;明细 onDoubleClick → PlasticReceiptQueryDetailDrawer 单号。
- `App.tsx` 路由 `plastic-receipt-query`;`menuTree.tsx` ⑨ 占位 `M("塑胶入仓查询")` → 带路由。

## ③ 测试

- 后端 `PlasticReceiptQueryServiceDbTests`:种 共用物料表(物料→塑胶货号/共用原料编号)+物料资料(物料类别)+塑胶入仓单(供应商/日期/审核1/订单单号)+明细(订单单号/生产单号/款号/工模编号/物料/颜色/塑胶货号/数量/单价)→ Detail 验 订单单号/工模编号/供应商/共用货号/塑胶货号/数量 + Summary GROUP 合计 + 审核情况/物料类别/keyword/区间。清理(明细/单/共用物料表/物料资料·入仓单据塑胶表无 FK 免父行)。
- 全量 `dotnet test` 绿(375→376);前端 54 + tsc 干净。
- 冒烟:种链 → `GET /api/plastic-receipt-query/detail`+`/summary` 正确·单价脱敏。**起后端 `--contentRoot 输出目录` + 冒烟前 `dotnet build -c Release`(锁先 Stop-Process)。**

## 不做(YAGNI)

- 物料查询切换/精确/高级查询/表格设置;塑胶退仓查询(本张做完即克隆)。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-receipt-query` `--no-ff` 合并 → worklog + MEMORY。**确立模板**:塑胶退仓查询照此克隆换 `PlasticWarehouseReturn`/`api/plastic-warehouse-return-query`/菜单 塑胶退仓查询/抽屉 `plastic-warehouse-returns`。
