# 塑胶进度表(塑胶采购进度)· 设计 · 2026-06-29

## 目标

⑦ 塑胶采购「塑胶进度表」落地。只读单表平铺报表:塑胶采购订单(刚建)的采购进度——一行一订单明细 + 已审核塑胶入仓数量 + 欠数(订购−入仓)。镜像物料侧订单进度表(`PurchaseOrderService.ProgressAsync`)。

## 范围与决策(已确认)

- **入仓关联键 = 生产单号 + 物料编号 + 颜色**(采购订单明细与塑胶入仓明细都有这三列·能算真实入仓数量·欠数=订购−入仓)。
- **v1 只做塑胶进度表(汇总)**;塑胶进度明细表(每条入仓一行)留后续。
- 过滤:供应商 + 日期区间(按采购订单 o.日期·半开)+ 关键词 + 只看欠数(欠数>0)。**无价格→无脱敏。**
- **注(镜像物料侧已知)**:入仓按 生产单号+物料编号+颜色 聚合(无明细行 ID),同生产单+物料+颜色若在多采购订单行重复,聚合入仓会同挂多行(高估各行入仓/低估欠数);接受。

## 数据源 / JOIN

- 头 `塑胶采购订单 o`(单号/日期/交货日期/供应商编号/供应商名称/审核)+ 明细 `塑胶采购订单明细 d`(生产单号/款号/物料编号/物料名称/模具编号/数量/颜色)。
- LEFT JOIN `塑胶物料资料`(GROUP BY 物料编号·单位)。
- LEFT JOIN 已审核入仓聚合(`塑胶入仓明细单 r JOIN 塑胶入仓单 h`·审核='1'·GROUP BY 生产单号+物料编号+ISNULL(颜色,''))。

## ① 后端

**DTO**(`PlasticPurchaseOrderDtos.cs` 末尾加):
```csharp
public sealed class PlasticPurchaseProgressRow
{
    public DateTime? 订购日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 采购单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 订购数量 { get; set; }
    public decimal? 入仓数量 { get; set; }
    public decimal? 欠数 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 审核 { get; set; }
}
```

**`PlasticPurchaseOrderService.cs`** 加方法:
```csharp
    public async Task<IReadOnlyList<PlasticPurchaseProgressRow>> ProgressAsync(
        string? 供应商, DateTime? 起, DateTime? 止, string? keyword, bool onlyOwed)
    {
        var sup = string.IsNullOrWhiteSpace(供应商) ? null : $"%{供应商.Trim()}%";
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var 止Excl = 止?.Date.AddDays(1);
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticPurchaseProgressRow>(@"
SELECT o.[日期] AS 订购日期, o.[交货日期], o.[单号] AS 采购单号, d.[生产单号], d.[款号],
       d.[物料编号], d.[物料名称], d.[模具编号], d.[颜色], m.[单位],
       d.[数量] AS 订购数量,
       ISNULL(rk.[入仓数量], 0) AS 入仓数量,
       d.[数量] - ISNULL(rk.[入仓数量], 0) AS 欠数,
       o.[供应商名称], o.[审核]
FROM [塑胶采购订单明细] d
JOIN [塑胶采购订单] o ON o.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
LEFT JOIN (
    SELECT r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键, SUM(r.[数量]) AS 入仓数量
    FROM [塑胶入仓明细单] r
    JOIN [塑胶入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
    GROUP BY r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'')
) rk ON rk.[生产单号] = d.[生产单号] AND rk.[物料编号] = d.[物料编号] AND rk.[颜色键] = ISNULL(d.[颜色],'')
WHERE (@sup IS NULL OR o.[供应商编号] LIKE @sup OR o.[供应商名称] LIKE @sup)
  AND (@起 IS NULL OR o.[日期] >= @起)
  AND (@止 IS NULL OR o.[日期] < @止)
  AND (@kw IS NULL OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@onlyOwed = 0 OR (d.[数量] - ISNULL(rk.[入仓数量], 0)) > 0)
ORDER BY o.[单号] DESC, d.[ID]", new { sup, 起, 止 = 止Excl, kw, onlyOwed = onlyOwed ? 1 : 0 });
        return rows.AsList();
    }
```

**`PlasticPurchaseProgressController.cs`**(新·`Features/Plastics/PlasticPurchaseProgress/`):`[Route("api/plastic-purchase-progress")]`·菜单 `塑胶进度表`·注入 `PlasticPurchaseOrderService`+`IPermissionService`。`GET ?供应商=&起=&止=&keyword=&onlyOwed=` → 校验「打开」→ `ProgressAsync` → Ok。**无脱敏**。

**菜单 + 权限**:`MenuCatalog` 在 `new("塑胶采购","塑胶采购订单"),` 后加 `new("塑胶采购","塑胶进度表")`;`db/seed_plastic_purchase_progress_perms.sql` admin 9 位·两库。

## ② 前端

- `api/plasticPurchaseProgress.ts`:`PlasticPurchaseProgressRow`(同后端)+ `plasticPurchaseProgressApi.list({供应商?,起,止,keyword?,onlyOwed?})`(起/止 YYYY-MM-DD·onlyOwed bool)。
- `PlasticPurchaseProgressPage.tsx`(单 Tab 平铺·镜像 `PlasticOrderMakePage`/物料订单进度页):上月/本月/下月 + RangePicker(默认本月)+ 供应商 Input + 关键词 Input.Search + **只看欠数 Checkbox** + 导出EXCEL/打印 + "共 N 条";列 订购日期/交货日期/采购单号/生产单号/款号/物料编号/物料名称/模具编号/颜色/单位/订购数量/入仓数量/欠数/供应商名称/审核(审核渲染 已审核/未审核·日期 slice 10);`can(perms,"塑胶进度表","打开")` 守卫。
- `App.tsx` 路由 `plastic-purchase-progress`;`menuTree.tsx` ⑦ 占位 `M("塑胶进度表")` → 带路由。

## ③ 测试

- 后端 `PlasticPurchaseProgressServiceDbTests`:**免款号总表/生产制单父行**(ProgressAsync 只 JOIN 塑胶采购订单明细·塑胶表无 FK·生产单号仅为字符串匹配键)。种 塑胶采购订单(单号 PP_D1·供应商/日期本月/审核)+采购订单明细(生产单号 PP-MO/物料 PPPM/颜色 黑/数量 10)+塑胶物料资料(PPPM·单位 kg)+已审核塑胶入仓单+入仓明细(生产单号 PP-MO/物料 PPPM/颜色 黑/数量 4)→ `ProgressAsync(null,本月,null,"PPPM",false)` 验:订购数量=10·入仓数量=4·欠数=6·单位=kg·采购单号=PP_D1;`onlyOwed=true` 该行(欠 6>0)在;**未审核入仓不计**(再种一张审核'0'入仓·数量99·该行欠数仍=6);供应商/日期/keyword 过滤。清理(采购订单明细/头·物料资料·入仓明细/头)。`using Dapper;`。
- 全量 `dotnet test` 绿(380→381);前端 54 + tsc 干净。
- 冒烟:种链 → `GET /api/plastic-purchase-progress` 订购10/入仓4/欠6·只看欠数·未审核入仓不计。**起后端 `--contentRoot 输出目录` + 冒烟前 `dotnet build -c Release`(锁先按 PID Stop-Process)。**

## 不做(YAGNI)

- 塑胶进度明细表、价格、审核情况下拉。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-purchase-progress` `--no-ff` 合并 → worklog + MEMORY。**坑**:生产制单/采购订单 种子含款号总表 FK 父行(反序清)。
