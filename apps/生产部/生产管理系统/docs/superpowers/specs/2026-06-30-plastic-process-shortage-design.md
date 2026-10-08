# 物料发外欠数表 · 设计 · 2026-06-30

## 目标

⑩ 发外加工「物料发外欠数表」只读**汇总**报表。**欠数 = 加工采购订购 − 加工入仓**(同采购加工进度表口径,物料级汇总)。**零新表**。

## 范围与决策(已确认)

- 欠数 = SUM(加工采购订购数量 − 加工入仓数量),按 **物料编号 + 共用物料编号 + 模具编号** 汇总(共用物料编号 1:1 取 MAX,故 GROUP BY 物料编号+模具编号 等效)。
- 过滤:物料类别 + 审核情况(订购单 o.审核·全部/已审核/未审核)+ keyword + 只看欠数(HAVING SUM(欠数)>0)。**无日期**(欠数=未结清快照)。
- 单价/金额脱敏;columns + exportCols 同步隐藏。
- **不做**:日期过滤、双击进单、再分组。

## 数据源 / 列映射

- 订购:`塑胶加工采购单明细 d JOIN 塑胶加工采购单 o`(o.审核)。
- 入仓实际:`塑胶入仓明细单`(审核1)按 生产单号+物料编号+ISNULL(颜色,'') 聚合 SUM(数量)=入仓数量(子查询 rk)。
- 单位/物料类别:`塑胶物料资料`(GROUP BY 物料编号·MAX)。
- 共用物料编号:`塑胶共用物料表`(GROUP BY 物料编号·MAX 共用原料编号)= cm。
- **共用物料(名称)**:`塑胶物料资料`(按 物料编号)LEFT JOIN ON `物料编号 = cm.共用原料编号` 取其物料名称(*数据源假设:共用物料=共用原料编号在物料资料的名称·无则空*)。

## ① 后端(扩 `PlasticProcessPurchaseOrderService`)

**DTO**(`PlasticProcessPurchaseOrderDtos.cs` 末尾加):
```csharp
public sealed class PlasticProcessShortageRow
{
    public string? 物料编号 { get; set; }
    public string? 共用物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 共用物料 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 欠数 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
```

**`PlasticProcessPurchaseOrderService.cs`** 加方法:
```csharp
public async Task<IReadOnlyList<PlasticProcessShortageRow>> ShortageAsync(
    string? 物料类别, string? 审核情况, string? keyword, bool onlyOwed)
{
    var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
    var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
    using var c = factory.Create();
    var rows = await c.QueryAsync<PlasticProcessShortageRow>($@"
SELECT d.[物料编号], MAX(cm.[共用原料编号]) AS 共用物料编号, MAX(d.[物料名称]) AS 物料名称,
       d.[模具编号], MAX(cn.[物料名称]) AS 共用物料, MAX(m.[物料类别]) AS 物料类别, MAX(m.[单位]) AS 单位,
       SUM(d.[数量] - ISNULL(rk.[入仓数量],0)) AS 欠数,
       MAX(d.[单价]) AS 单价,
       SUM((d.[数量] - ISNULL(rk.[入仓数量],0)) * ISNULL(d.[单价],0)) AS 金额
FROM [塑胶加工采购单明细] d
JOIN [塑胶加工采购单] o ON o.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位, MAX([物料类别]) AS 物料类别, MAX([物料名称]) AS 物料名称 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([共用原料编号]) AS 共用原料编号 FROM [塑胶共用物料表] GROUP BY [物料编号]) cm ON cm.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([物料名称]) AS 物料名称 FROM [塑胶物料资料] GROUP BY [物料编号]) cn ON cn.[物料编号] = cm.[共用原料编号]
LEFT JOIN (
    SELECT r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键, SUM(r.[数量]) AS 入仓数量
    FROM [塑胶入仓明细单] r
    JOIN [塑胶入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
    GROUP BY r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'')
) rk ON rk.[生产单号] = d.[生产单号] AND rk.[物料编号] = d.[物料编号] AND rk.[颜色键] = ISNULL(d.[颜色],'')
WHERE (@cat IS NULL OR m.[物料类别] = @cat)
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw){ApprovalFilter(审核情况)}
GROUP BY d.[物料编号], d.[模具编号]
HAVING (@onlyOwed = 0 OR SUM(d.[数量] - ISNULL(rk.[入仓数量],0)) > 0)
ORDER BY d.[物料编号]", new { cat, kw, onlyOwed = onlyOwed ? 1 : 0 });
    return rows.AsList();
}
```
注:`ApprovalFilter` 已存在于本 service(已审核→` AND ISNULL(o.[审核],'0')='1'`、未审核→`<>'1'`、_→"")——**复核:现有 ApprovalFilter 用别名 `h.`,本查询订购头别名为 `o.`,故须用本查询适配版**:在方法内联拼 `审核情况` 过滤片段(`已审核`→` AND ISNULL(o.[审核],'0')='1'`;`未审核`→` AND ISNULL(o.[审核],'0')<>'1'`;_→"")而非调用 `ApprovalFilter`(其写死 h.)。实现时用本地 switch 生成片段。

**`PlasticProcessShortageController.cs`**(新·`Features/Plastics/PlasticProcessShortage/`):
- `[Route("api/plastic-process-shortage")]`·`Menu="物料发外欠数表"`·注入 service + `IPermissionService`。
- `GET /`(参 物料类别/审核情况/keyword/onlyOwed)→ 校验 打开 → ShortageAsync → 无单价权限则每行 `单价/金额=null` → Ok。

**菜单 + 权限**:`MenuCatalog.cs` 加 `new("发外加工","物料发外欠数表")`;`db/seed_plastic_process_shortage_perms.sql` admin 9 位(两库)。DI 复用已注册 service。

## ② 前端(新报表页)

- `api/plasticProcessShortage.ts`:`PlasticProcessShortageRow`(上述全列)+ `Params{物料类别?,审核情况?,keyword?,onlyOwed?}` + `list(p)` → `/plastic-process-shortage`。
- `PlasticProcessShortagePage.tsx`:`MENU="物料发外欠数表"`;工具栏 物料类别 Select(`plasticMaterialMasterApi.categories()` → options 类别)+ 审核情况 Select(全部/已审核/未审核)+ keyword(物料编号/名称)+ 只看欠数 Checkbox + 导出EXCEL/打印。列:物料编号/共用物料编号/物料名称/模具编号/共用物料/单位/欠数/(单价/金额 priceHidden)。`priceHidden` 时 单价/金额 从 columns + exportCols 同步隐藏。
- `App.tsx`:import + `<Route path="plastic-process-shortage" element={<PlasticProcessShortagePage />} />`。
- `menuTree.tsx` line 121:`M("物料发外欠数表")` → `M("物料发外欠数表","/plastic-process-shortage","物料发外欠数表")`。

## ③ 测试

- 后端 `PlasticProcessShortageServiceDbTests`:种 加工采购单订购8(单价3·物料 SHPM·模具 GM-SH·物料类别 注塑)+ 塑胶物料资料(SHPM·单位个·类别注塑)+ 塑胶共用物料表(SHPM·共用原料编号 CR-SH)+ 塑胶入仓(同生产单号+物料+颜色·数量5)→ ShortageAsync 单行:欠数3/单价3/金额9/共用物料编号 CR-SH;物料类别=注塑 命中、=别的 不命中;审核情况;onlyOwed=true 含(欠3>0);keyword。Clean 逆序删。
- 全量 `dotnet test` 绿(399→401);前端 54 + `tsc` 干净。
- **HTTP 冒烟**:种 订购+入仓 → `GET /api/plastic-process-shortage?onlyOwed=true` 验 欠数3/单价3/金额9;物料类别/审核情况过滤。**起后端 Release(锁先 PID Stop-Process)+ `--contentRoot 输出目录`;node axios `proxy:false`。**

## 不做(YAGNI)

- 日期过滤、双击进单、再分组、表格设置。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-process-shortage` `--no-ff` 合并 master → worklog + MEMORY。
