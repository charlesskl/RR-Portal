# 加工领料进度表 · 设计 · 2026-06-30

## 目标

⑩ 发外加工「加工领料进度表」只读报表——**= 采购加工明细表 克隆,实际源从 塑胶入仓明细单 换成 白件领料明细单**(发外加工的领料=白件领料)。订购 `塑胶加工采购单明细` LEFT JOIN(`白件领料明细单` 审核1 按 生产单号+物料编号+颜色 聚合)。**零新表**。

## 范围与决策(已确认)

- 实际领料源 = **白件领料明细单 JOIN 白件领料单(审核=1)**·按 生产单号+物料编号+颜色 聚合 `SUM(数量)=领料数量, MAX(r.单号)=领料单号, MAX(h.日期)=领料日期`。
- 白件领料**无单价/金额** → **无领料金额列**;**未完成金额 = 未完成数量 × 订购单价**(派生)。
- 明细表式(领料日期/领料单号/完成情况),镜像 `采购加工明细表`(`PurchaseDetailAsync`/`PlasticProcessPurchaseDetailPage`)。
- 金额脱敏:单价/订购金额/未完成金额(3 列);columns + exportCols 两处同步隐藏。
- **不做**:领料金额、订购×领料一对多展开、双击抽屉、汇总 Tab。

## ① 后端(扩 `PlasticProcessPurchaseOrderService`)

**DTO**(`PlasticProcessPurchaseOrderDtos.cs` 末尾加):
```csharp
public sealed class PlasticProcessIssueProgressRow
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
    public DateTime? 领料日期 { get; set; }
    public string? 领料单号 { get; set; }
    public decimal? 领料数量 { get; set; }
    public decimal? 未完成数量 { get; set; }
    public decimal? 未完成金额 { get; set; }
    public string? 完成情况 { get; set; }
    public string? 加工厂名称 { get; set; }
}
```

**`PlasticProcessPurchaseOrderService.cs`** 加方法(镜像 `PurchaseDetailAsync`,实际源换 白件领料·去领料金额·未完成金额=未完成数量×订购单价):
```csharp
public async Task<IReadOnlyList<PlasticProcessIssueProgressRow>> IssueProgressAsync(
    string? 加工厂, DateTime? 起, DateTime? 止, string? keyword, string? 完成情况)
{
    var f = string.IsNullOrWhiteSpace(加工厂) ? null : $"%{加工厂.Trim()}%";
    var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
    var 止Excl = 止?.Date.AddDays(1);
    var done = 完成情况 switch { "已完成" => 1, "未完成" => 0, _ => -1 };
    using var c = factory.Create();
    var rows = await c.QueryAsync<PlasticProcessIssueProgressRow>(@"
SELECT o.[日期] AS 订购日期, o.[交货日期], o.[单号] AS 订购单号, d.[生产单号], d.[款号],
       d.[模具编号], d.[物料编号], d.[物料名称], d.[用料名称], d.[颜色], d.[加工内容], m.[单位],
       d.[数量] AS 订购数量, d.[单价], d.[金额] AS 订购金额,
       rk.[领料日期], rk.[领料单号], ISNULL(rk.[领料数量], 0) AS 领料数量,
       d.[数量] - ISNULL(rk.[领料数量], 0) AS 未完成数量,
       (d.[数量] - ISNULL(rk.[领料数量], 0)) * ISNULL(d.[单价], 0) AS 未完成金额,
       CASE WHEN d.[数量] - ISNULL(rk.[领料数量], 0) <= 0 THEN N'已完成' ELSE N'未完成' END AS 完成情况,
       o.[加工厂名称]
FROM [塑胶加工采购单明细] d
JOIN [塑胶加工采购单] o ON o.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
LEFT JOIN (
    SELECT r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键,
           SUM(r.[数量]) AS 领料数量, MAX(r.[单号]) AS 领料单号, MAX(h.[日期]) AS 领料日期
    FROM [白件领料明细单] r
    JOIN [白件领料单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
    GROUP BY r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'')
) rk ON rk.[生产单号] = d.[生产单号] AND rk.[物料编号] = d.[物料编号] AND rk.[颜色键] = ISNULL(d.[颜色],'')
WHERE (@f IS NULL OR o.[加工厂编号] LIKE @f OR o.[加工厂名称] LIKE @f)
  AND (@起 IS NULL OR o.[日期] >= @起)
  AND (@止 IS NULL OR o.[日期] < @止)
  AND (@kw IS NULL OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@done = -1 OR (@done = 1 AND (d.[数量] - ISNULL(rk.[领料数量],0)) <= 0) OR (@done = 0 AND (d.[数量] - ISNULL(rk.[领料数量],0)) > 0))
ORDER BY o.[单号] DESC, d.[ID]", new { f, 起, 止 = 止Excl, kw, done });
    return rows.AsList();
}
```

**`PlasticProcessIssueProgressController.cs`**(新·`Features/Plastics/PlasticProcessIssueProgress/`):
- `[Route("api/plastic-process-issue-progress")]`·`Menu="加工领料进度表"`·注入 `PlasticProcessPurchaseOrderService` + `IPermissionService`。
- `GET /`(参 加工厂/起/止/keyword/完成情况)→ 校验 打开 → IssueProgressAsync → 无单价权限则每行 `单价/订购金额/未完成金额=null` → Ok。

**菜单 + 权限**:`MenuCatalog.cs` 加 `new("发外加工","加工领料进度表")`;`db/seed_plastic_process_issue_progress_perms.sql` admin 9 位(两库)。DI 复用已注册 service。

## ② 前端(克隆 `PlasticProcessPurchaseDetailPage`)

- `api/plasticProcessIssueProgress.ts`:`PlasticProcessIssueProgressRow`(上述全列)+ `Params{加工厂?,起,止,keyword?,完成情况?}` + `list(p)` → `/plastic-process-issue-progress`。
- `PlasticProcessIssueProgressPage.tsx`:`MENU="加工领料进度表"`;列 加工厂名称/生产单号/款号/模具编号/物料编号/物料名称/用料名称/颜色/加工内容/单位/订购日期/交货日期/订购单号/订购数量/(单价/订购金额 priceHidden)/领料日期/领料单号/领料数量/**审核情况**(派生:领料数量>0→已审核·否则空)/未完成数量/(未完成金额 priceHidden)/完成情况。工具栏 上月/本月/下月 + RangePicker + 加工厂 + 完成情况 Select(全部/已完成/未完成)+ keyword + 导出/打印。`priceHidden` 时 单价/订购金额/未完成金额 从 columns + exportCols 同步隐藏。
- `App.tsx`:import + `<Route path="plastic-process-issue-progress" element={<PlasticProcessIssueProgressPage />} />`。
- `menuTree.tsx` line 120:`M("加工领料进度表")` → `M("加工领料进度表","/plastic-process-issue-progress","加工领料进度表")`。

## ③ 测试

- 后端 `PlasticProcessIssueProgressServiceDbTests`:种 加工采购单订购8(单价3金额24)+ 白件领料单(审核1·单号 BJL-IP-1)+ 白件领料明细单(同生产单号+物料+颜色·数量5)→ IssueProgressAsync 单行:领料数量5/未完成数量3/未完成金额9(=3×3)/领料单号 BJL-IP-1/领料日期非空/完成情况=未完成;完成情况="已完成" 排除、"未完成" 含;加工厂/keyword。Clean 逆序删。
- 全量 `dotnet test` 绿(397→399);前端 54 + `tsc` 干净。
- **HTTP 冒烟**:种 订购+白件领料 → `GET /api/plastic-process-issue-progress?起=&止=` 验 订购8/领料5/未完成3/领料单号/完成情况;完成情况过滤。**起后端 Release(锁先 PID Stop-Process)+ `--contentRoot 输出目录`;node axios `proxy:false`。**

## 不做(YAGNI)

- 领料金额、订购×领料一对多展开、双击抽屉、汇总 Tab、表格设置。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-process-issue-progress` `--no-ff` 合并 master → worklog + MEMORY。
