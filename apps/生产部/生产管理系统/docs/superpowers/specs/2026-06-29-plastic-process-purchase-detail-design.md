# 采购加工明细表 · 设计 · 2026-06-29

## 目标

⑩ 发外加工「采购加工明细表」只读报表——**= 采购加工进度表(`ProgressAsync`)+ 入仓单据列(入仓日期/入仓单号/审核情况)+ 完成情况**。同一口径:订购 `塑胶加工采购单明细` LEFT JOIN(`塑胶入仓明细单` 审核1 按 生产单号+物料编号+颜色 聚合)。**零新表**。新增独立方法/控制器/页,不动已合并的进度表。

## 范围与决策(已确认)

- **粒度 = 订购行 1:1·入仓聚合**(入仓单号取 MAX·入仓日期取 MAX(h.日期))。
- v1 = 明细平铺 + 订购/入仓/未完成(数量+金额) + 完成情况过滤(全部/已完成/未完成) + 日期工具栏 + 加工厂 + keyword + 导出/打印。
- 金额脱敏(单价/订购金额/入仓金额/未完成金额);columns + exportCols 两处同步隐藏。
- **不做**:订购×入仓一对多展开、双击抽屉、汇总 Tab。

## 数据源

同 `ProgressAsync`:`塑胶加工采购单明细 d JOIN 塑胶加工采购单 o`,LEFT JOIN `塑胶物料资料`(单位),LEFT JOIN 入仓聚合子查询(`塑胶入仓明细单 r JOIN 塑胶入仓单 h`·审核1·GROUP BY 生产单号+物料编号+ISNULL(颜色,'')·SUM数量/SUM金额·**新增 MAX(r.单号)=入仓单号、MAX(h.日期)=入仓日期**)。

## ① 后端(扩 `PlasticProcessPurchaseOrderService`)

**DTO**(`PlasticProcessPurchaseOrderDtos.cs` 末尾加):
```csharp
public sealed class PlasticProcessPurchaseDetailRow
{
    public DateTime? 订购日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 订购单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 加工内容 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 订购数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 订购金额 { get; set; }
    public DateTime? 入仓日期 { get; set; }
    public string? 入仓单号 { get; set; }
    public decimal? 入仓数量 { get; set; }
    public decimal? 入仓金额 { get; set; }
    public decimal? 未完成数量 { get; set; }
    public decimal? 未完成金额 { get; set; }
    public string? 完成情况 { get; set; }
    public string? 加工厂名称 { get; set; }
}
```

**`PlasticProcessPurchaseOrderService.cs`** 加方法:
```csharp
public async Task<IReadOnlyList<PlasticProcessPurchaseDetailRow>> PurchaseDetailAsync(
    string? 加工厂, DateTime? 起, DateTime? 止, string? keyword, string? 完成情况)
{
    var f = string.IsNullOrWhiteSpace(加工厂) ? null : $"%{加工厂.Trim()}%";
    var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
    var 止Excl = 止?.Date.AddDays(1);
    var done = 完成情况 switch { "已完成" => 1, "未完成" => 0, _ => -1 };
    using var c = factory.Create();
    var rows = await c.QueryAsync<PlasticProcessPurchaseDetailRow>(@"
SELECT o.[日期] AS 订购日期, o.[交货日期], o.[单号] AS 订购单号, d.[生产单号], d.[款号],
       d.[模具编号], d.[物料编号], d.[物料名称], d.[用料名称], d.[颜色], d.[加工内容], m.[单位],
       d.[数量] AS 订购数量, d.[单价], d.[金额] AS 订购金额,
       rk.[入仓日期], rk.[入仓单号], ISNULL(rk.[入仓数量], 0) AS 入仓数量, ISNULL(rk.[入仓金额], 0) AS 入仓金额,
       d.[数量] - ISNULL(rk.[入仓数量], 0) AS 未完成数量,
       ISNULL(d.[金额], 0) - ISNULL(rk.[入仓金额], 0) AS 未完成金额,
       CASE WHEN d.[数量] - ISNULL(rk.[入仓数量], 0) <= 0 THEN N'已完成' ELSE N'未完成' END AS 完成情况,
       o.[加工厂名称]
FROM [塑胶加工采购单明细] d
JOIN [塑胶加工采购单] o ON o.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
LEFT JOIN (
    SELECT r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键,
           SUM(r.[数量]) AS 入仓数量, SUM(ISNULL(r.[金额],0)) AS 入仓金额,
           MAX(r.[单号]) AS 入仓单号, MAX(h.[日期]) AS 入仓日期
    FROM [塑胶入仓明细单] r
    JOIN [塑胶入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
    GROUP BY r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'')
) rk ON rk.[生产单号] = d.[生产单号] AND rk.[物料编号] = d.[物料编号] AND rk.[颜色键] = ISNULL(d.[颜色],'')
WHERE (@f IS NULL OR o.[加工厂编号] LIKE @f OR o.[加工厂名称] LIKE @f)
  AND (@起 IS NULL OR o.[日期] >= @起)
  AND (@止 IS NULL OR o.[日期] < @止)
  AND (@kw IS NULL OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@done = -1 OR (@done = 1 AND (d.[数量] - ISNULL(rk.[入仓数量],0)) <= 0) OR (@done = 0 AND (d.[数量] - ISNULL(rk.[入仓数量],0)) > 0))
ORDER BY o.[单号] DESC, d.[ID]", new { f, 起, 止 = 止Excl, kw, done });
    return rows.AsList();
}
```

**`PlasticProcessPurchaseDetailController.cs`**(新·`Features/Plastics/PlasticProcessPurchaseDetail/`):
- `[Route("api/plastic-process-purchase-detail")]`·`Menu="采购加工明细表"`·注入 `PlasticProcessPurchaseOrderService` + `IPermissionService`。
- `GET /`(参 加工厂/起/止/keyword/完成情况)→ 校验 打开 → PurchaseDetailAsync → 无单价权限则每行 `单价/订购金额/入仓金额/未完成金额=null` → Ok。

**菜单 + 权限**:`MenuCatalog.cs` 加 `new("发外加工","采购加工明细表")`;`db/seed_plastic_process_purchase_detail_perms.sql` admin 9 位(两库)。DI 复用已注册 service。

## ② 前端(克隆 `PlasticProcessPurchaseProgressPage`)

- `api/plasticProcessPurchaseDetail.ts`:`PlasticProcessPurchaseDetailRow`(上述全列)+ `Params{加工厂?,起,止,keyword?,完成情况?}` + `list(p)` → `/plastic-process-purchase-detail`。
- `PlasticProcessPurchaseDetailPage.tsx`:`MENU="采购加工明细表"`;列 加工厂名称/生产单号/款号/模具编号/物料编号/物料名称/用料名称/颜色/加工内容/单位/订购日期/交货日期/订购单号/订购数量/(单价/订购金额 priceHidden)/入仓日期/入仓单号/入仓数量/(入仓金额 priceHidden)/**审核情况**(派生:入仓数量>0→已审核·否则空)/未完成数量/(未完成金额 priceHidden)/完成情况。工具栏 上月/本月/下月 + RangePicker + 加工厂 Input + keyword + **完成情况 Select(全部/已完成/未完成)** + 导出EXCEL/打印。`priceHidden` 时四价列从 columns + exportCols 同步隐藏。
- `App.tsx`:import + `<Route path="plastic-process-purchase-detail" element={<PlasticProcessPurchaseDetailPage />} />`。
- `menuTree.tsx` line 119:`M("采购加工明细表")` → `M("采购加工明细表","/plastic-process-purchase-detail","采购加工明细表")`。

## ③ 测试

- 后端 `PlasticProcessPurchaseDetailServiceDbTests`:种 加工采购单订购8(单价3金额24)+ 塑胶入仓5(同生产单号+物料+颜色·金额15·单号 SR-PD-1)→ PurchaseDetailAsync 单行:入仓数量5/未完成数量3/未完成金额9/入仓单号 SR-PD-1/入仓日期非空/完成情况=未完成;完成情况="已完成" 过滤掉、"未完成" 含;加工厂/keyword 命中。Clean 逆序删。
- 全量 `dotnet test` 绿(395→397);前端 54 + `tsc` 干净。
- **HTTP 冒烟**:种 订购+入仓 → `GET /api/plastic-process-purchase-detail?起=&止=` 验 订购8/入仓5/未完成3/入仓单号/完成情况;完成情况过滤。**起后端 Release(锁先 PID Stop-Process)+ `--contentRoot 输出目录`;node axios `proxy:false`。**

## 不做(YAGNI)

- 订购×入仓一对多展开、双击抽屉、汇总 Tab、表格设置。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-process-purchase-detail` `--no-ff` 合并 master → worklog + MEMORY。
