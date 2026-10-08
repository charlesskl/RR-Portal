# 采购加工进度表 · 设计 · 2026-06-29

## 目标

⑩ 发外加工「采购加工进度表」落地——只读报表,**镜像现有 塑胶进度表**(`PlasticPurchaseProgress`),把订购源从 `塑胶采购订单明细` 换成 **`塑胶加工采购单明细`**(发外加工采购),加金额列 + 加工内容 + 加工厂过滤 + 金额脱敏。**零新表**(源单 塑胶加工采购单 / 入仓表 塑胶入仓明细单 全已建)。

## 范围与决策(已确认)

- **关联键 = 生产单号 + 物料编号 + 颜色**(镜像现有塑胶进度表;入仓实际来自 塑胶入仓明细单 审核=1 聚合)。
- v1 = 明细平铺(每加工采购明细一行)+ 订购/入仓/剩余(数量+金额)+ 只看欠数 + 日期工具栏 + 加工厂 + 导出/打印。
- 单价/订购金额/入仓金额/剩余金额 按「采购加工进度表·单价」权限脱敏置 null。
- 订购**不滤审核**,带审核列(镜像现有)。
- **不做**:汇总 Tab、双击进单、表格设置、精确/高级查询。

## 数据源

- 订购:`塑胶加工采购单明细 d`(生产单号/款号/模具编号/物料编号/物料名称/用料名称/颜色/加工内容/数量/单价/金额)`JOIN 塑胶加工采购单 o`(日期/交货日期/加工厂编号/加工厂名称/审核)。
- 入仓实际:`塑胶入仓明细单 r JOIN 塑胶入仓单 h`(审核=1),按 生产单号+物料编号+ISNULL(颜色,'') 聚合 `SUM(数量)=入仓数量, SUM(ISNULL(金额,0))=入仓金额`。
- 单位:`塑胶物料资料`(GROUP BY 物料编号·MAX 单位)LEFT JOIN(加工采购明细无单位列)。

## ① 后端(扩 `PlasticProcessPurchaseOrderService`)

**DTO**(`PlasticProcessPurchaseOrderDtos.cs` 末尾加):
```csharp
public sealed class PlasticProcessPurchaseProgressRow
{
    public DateTime? 订购日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 加工采购单号 { get; set; }
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
    public decimal? 入仓数量 { get; set; }
    public decimal? 入仓金额 { get; set; }
    public decimal? 剩余数量 { get; set; }
    public decimal? 剩余金额 { get; set; }
    public string? 加工厂名称 { get; set; }
    public string? 审核 { get; set; }
}
```

**`PlasticProcessPurchaseOrderService.cs`** 加方法(镜像 `PlasticPurchaseOrderService.ProgressAsync`):
```csharp
public async Task<IReadOnlyList<PlasticProcessPurchaseProgressRow>> ProgressAsync(
    string? 加工厂, DateTime? 起, DateTime? 止, string? keyword, bool onlyOwed)
{
    var f = string.IsNullOrWhiteSpace(加工厂) ? null : $"%{加工厂.Trim()}%";
    var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
    var 止Excl = 止?.Date.AddDays(1);
    using var c = factory.Create();
    var rows = await c.QueryAsync<PlasticProcessPurchaseProgressRow>(@"
SELECT o.[日期] AS 订购日期, o.[交货日期], o.[单号] AS 加工采购单号, d.[生产单号], d.[款号],
       d.[模具编号], d.[物料编号], d.[物料名称], d.[用料名称], d.[颜色], d.[加工内容], m.[单位],
       d.[数量] AS 订购数量, d.[单价], d.[金额] AS 订购金额,
       ISNULL(rk.[入仓数量], 0) AS 入仓数量, ISNULL(rk.[入仓金额], 0) AS 入仓金额,
       d.[数量] - ISNULL(rk.[入仓数量], 0) AS 剩余数量,
       ISNULL(d.[金额], 0) - ISNULL(rk.[入仓金额], 0) AS 剩余金额,
       o.[加工厂名称], o.[审核]
FROM [塑胶加工采购单明细] d
JOIN [塑胶加工采购单] o ON o.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
LEFT JOIN (
    SELECT r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键,
           SUM(r.[数量]) AS 入仓数量, SUM(ISNULL(r.[金额],0)) AS 入仓金额
    FROM [塑胶入仓明细单] r
    JOIN [塑胶入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
    GROUP BY r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'')
) rk ON rk.[生产单号] = d.[生产单号] AND rk.[物料编号] = d.[物料编号] AND rk.[颜色键] = ISNULL(d.[颜色],'')
WHERE (@f IS NULL OR o.[加工厂编号] LIKE @f OR o.[加工厂名称] LIKE @f)
  AND (@起 IS NULL OR o.[日期] >= @起)
  AND (@止 IS NULL OR o.[日期] < @止)
  AND (@kw IS NULL OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@onlyOwed = 0 OR (d.[数量] - ISNULL(rk.[入仓数量], 0)) > 0)
ORDER BY o.[单号] DESC, d.[ID]", new { f, 起, 止 = 止Excl, kw, onlyOwed = onlyOwed ? 1 : 0 });
    return rows.AsList();
}
```

**`PlasticProcessPurchaseProgressController.cs`**(新·`Features/Plastics/PlasticProcessPurchaseProgress/`·镜像 `PlasticPurchaseProgressController`):
- `[Route("api/plastic-process-purchase-progress")]`·`Menu="采购加工进度表"`·注入 `PlasticProcessPurchaseOrderService` + `IPermissionService`。
- `GET /`(参 加工厂/起/止/keyword/onlyOwed)→ 校验 打开 → ProgressAsync → 无单价权限则每行 `单价/订购金额/入仓金额/剩余金额 = null` → Ok。

**菜单 + 权限**:`MenuCatalog.cs` 加 `new("发外加工","采购加工进度表")`;`db/seed_plastic_process_purchase_progress_perms.sql` admin 9 位(两库)。

**DI**:无需新增(复用已注册的 `PlasticProcessPurchaseOrderService`;新控制器自动发现)。

## ② 前端(克隆 `PlasticPurchaseProgressPage`)

- `api/plasticProcessPurchaseProgress.ts`:`PlasticProcessPurchaseProgressRow`(上述全列)+ `Params{加工厂?,起,止,keyword?,onlyOwed?}` + `list(p)` → `/plastic-process-purchase-progress`。
- `PlasticProcessPurchaseProgressPage.tsx`:`MENU="采购加工进度表"`;工具栏 上月/本月/下月 + RangePicker(默认本月)+ 加工厂 Input + keyword(生产单号/款号/物料)+ 只看欠数 Checkbox + 导出EXCEL/打印(`tableExport`)。列:订购日期/交货日期/加工采购单号/生产单号/款号/模具编号/物料编号/物料名称/用料名称/颜色/加工内容/单位/订购数量/(单价/订购金额 priceHidden)/入仓数量/(入仓金额 priceHidden)/剩余数量/(剩余金额 priceHidden)/加工厂名称/审核。`priceHidden = hidePrice(perms, MENU)` 时隐藏 单价/订购金额/入仓金额/剩余金额 列。exportCols 同步(脱敏时去价列)。
- `App.tsx`:import + `<Route path="plastic-process-purchase-progress" element={<PlasticProcessPurchaseProgressPage />} />`。
- `menuTree.tsx` line 118:`M("采购加工进度表")` → `M("采购加工进度表","/plastic-process-purchase-progress","采购加工进度表")`。

## ③ 测试

- 后端 `PlasticProcessPurchaseProgressServiceDbTests`:种 款号总表/生产制单/生产制单货号(免 FK)+ 塑胶加工采购单 o(加工厂名称/日期/审核1)+ 明细(生产单号 PJ-PR/物料 PRPM/颜色 黑/订购数量8/单价3/金额24)+ 塑胶入仓单 h(审核1)+ 塑胶入仓明细单(同 生产单号/物料/颜色·数量5/金额15)→ ProgressAsync 单行:入仓数量=5、剩余数量=3、入仓金额=15、剩余金额=9;onlyOwed=true 仍含(剩余3>0);加工厂过滤命中/不命中;keyword 命中。Clean 逆序删。
- 全量 `dotnet test` 绿(393→394);前端 54 + `tsc` 干净。
- **HTTP 冒烟**:种 加工采购单订购 + 入仓 → `GET /api/plastic-process-purchase-progress?起=&止=&加工厂=` 验 订购/入仓/剩余/金额;onlyOwed 过滤。**起后端 Release(锁先 PID Stop-Process)+ `--contentRoot 输出目录`;node axios `proxy:false`。**

## 不做(YAGNI)

- 汇总 Tab、双击进单、表格设置、精确/高级查询。

## 执行

writing-plans → subagent-driven(per-task subagent + 两段审查)→ opus 终审 → 分支 `feat-plastic-process-purchase-progress` `--no-ff` 合并 master → worklog + MEMORY。
