# 塑胶订购单查询 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 塑胶物料单(订购单)只读查询:汇总(物料编号+规格+颜色 GROUP)+ 明细(逐行)两 Tab,按 订货日期/审核情况/物料类别/关键词过滤;明细双击复用 PlasticMaterialDocDrawer 按单号开整单;加工单价/金额脱敏。

**Architecture:** 后端在 PlasticMaterialDocService 加 明细+汇总 两查询方法(塑胶物料明细单 JOIN 单头 + LEFT JOIN 生产制单[款号] + LEFT JOIN 塑胶物料资料[材料/规格/单位])。新 Controller(/detail + /summary·脱敏)。前端两 Tab 页(镜像物料 PurchaseOrderQueryPage)复用日期工具栏 + tableExport + 现成 PlasticMaterialDocDrawer。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + Ant Design v6 + dayjs + Vitest。

---

## 前置约定

- 工作目录 `D:\WebpageERP`,分支 `feat-plastic-order-query`,完成 `--no-ff` 合并 master 删分支。PowerShell;`dotnet` 不在 PATH 用机器+用户 PATH 拼。
- DB 测试 env 从 User 取:`$env:ERP_TEST_DB`/`$env:ERP_JWT_KEY`/`$env:ERP_DB`。后端 `dotnet test`(锁 DLL 用 `-c Release`)。前端 `npm --prefix web run test`/`build`。
- 提交末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 镜像源:`web/src/pages/production/PurchaseOrderQueryPage.tsx`(两 Tab+日期工具栏)、`web/src/pages/plastics/PlasticMaterialDocDrawer.tsx`(`{open,生产单号?,单号?,onClose,onSaved?}`·按单号开)、`web/src/api/plasticMaterialMaster.ts`(`categories()`)、`tableExport`、`hidePrice`。
- **坑:生产制单.款号 有 FK→款号总表**,任何种 生产制单 须先种 款号总表 父行,清理反序。
- 数据源:塑胶物料明细单(单号/工模编号/生产单号/货号/物料编号/物料名称/颜色/加工单价/订购数量/金额),塑胶物料单头(单号/日期/审核),生产制单(生产单号 UNIQUE/款号),塑胶物料资料(物料类别/规格/单位)。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocDtos.cs` | 加 2 DTO | 改 |
| `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocService.cs` | 加 ApprovalFilter + Detail/Summary 方法 | 改 |
| `src/ErpApi/Features/Plastics/PlasticOrderQuery/PlasticOrderQueryController.cs` | /detail + /summary 端点·脱敏 | 新建 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加菜单 | 改 |
| `db/seed_plastic_order_query_perms.sql` | admin 授权 | 新建 |
| `tests/ErpApi.Tests/PlasticOrderQueryServiceDbTests.cs` | 明细/汇总/过滤测试 | 新建 |
| `web/src/api/plasticOrderQuery.ts` | typed API | 新建 |
| `web/src/pages/plastics/PlasticOrderQueryPage.tsx` | 两 Tab 查询页 | 新建 |
| `web/src/App.tsx` | 路由 | 改 |
| `web/src/nav/menuTree.tsx` | 填菜单 | 改 |

---

## Task 1: 后端 明细/汇总 + Controller + 菜单 + 种子 + 测试

**Files:** Modify `PlasticMaterialDocDtos.cs`, `PlasticMaterialDocService.cs`, `MenuCatalog.cs`; Create `PlasticOrderQueryController.cs`, `db/seed_plastic_order_query_perms.sql`, `tests/ErpApi.Tests/PlasticOrderQueryServiceDbTests.cs`

- [ ] **Step 1: DTO** 在 `PlasticMaterialDocDtos.cs` 末尾追加:

```csharp
public sealed class PlasticOrderQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 货号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 材料 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class PlasticOrderQuerySummaryRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
}
```

- [ ] **Step 2: 方法** 在 `PlasticMaterialDocService` 类内追加:

```csharp
    private static string ApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL(h.[审核],'0')='1'",
        "未审核" => " AND ISNULL(h.[审核],'0')<>'1'",
        _ => "",
    };

    public async Task<IReadOnlyList<PlasticOrderQueryDetailRow>> OrderQueryDetailAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticOrderQueryDetailRow>($@"
SELECT h.[日期], d.[单号], d.[工模编号], d.[生产单号], p.[款号], d.[货号], d.[物料编号], d.[物料名称], d.[颜色],
       m.[物料类别] AS 材料, m.[规格], m.[单位], d.[订购数量] AS 数量, d.[加工单价], d.[金额], h.[审核]
FROM [塑胶物料明细单] d
JOIN [塑胶物料单] h ON h.[单号] = d.[单号]
LEFT JOIN [生产制单] p ON p.[生产单号] = d.[生产单号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([规格]) AS 规格, MAX([单位]) AS 单位
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR m.[规格] LIKE @kw OR d.[货号] LIKE @kw OR p.[款号] LIKE @kw OR d.[生产单号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID]", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticOrderQuerySummaryRow>> OrderQuerySummaryAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticOrderQuerySummaryRow>($@"
SELECT d.[物料编号], MAX(d.[物料名称]) AS 物料名称, MAX(m.[物料类别]) AS 物料类别, m.[规格], d.[颜色], MAX(m.[单位]) AS 单位,
       SUM(ISNULL(d.[订购数量],0)) AS 数量, SUM(ISNULL(d.[金额],0)) AS 金额
FROM [塑胶物料明细单] d
JOIN [塑胶物料单] h ON h.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([规格]) AS 规格, MAX([单位]) AS 单位
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR m.[规格] LIKE @kw OR d.[货号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
GROUP BY d.[物料编号], m.[规格], d.[颜色]
ORDER BY d.[物料编号]", new { qi, qe, kw, cat });
        return rows.AsList();
    }
```

- [ ] **Step 3: Controller** Create `src/ErpApi/Features/Plastics/PlasticOrderQuery/PlasticOrderQueryController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Plastics.PlasticMaterialDoc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticOrderQuery;

[ApiController]
[Authorize]
[Route("api/plastic-order-query")]
public sealed class PlasticOrderQueryController(
    PlasticMaterialDocService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶订购单查询";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> CanPrice() => perms.HasAsync(CurrentUser, Menu, PermissionAction.单价);

    [HttpGet("detail")]
    public async Task<IActionResult> Detail(DateTime 起, DateTime 止, string? keyword = null,
        [FromQuery(Name = "审核情况")] string? 审核情况 = null, [FromQuery(Name = "物料类别")] string? 物料类别 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.OrderQueryDetailAsync(起, 止, keyword, 审核情况, 物料类别);
        if (!await CanPrice()) foreach (var r in rows) { r.加工单价 = null; r.金额 = null; }
        return Ok(rows);
    }

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(DateTime 起, DateTime 止, string? keyword = null,
        [FromQuery(Name = "审核情况")] string? 审核情况 = null, [FromQuery(Name = "物料类别")] string? 物料类别 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.OrderQuerySummaryAsync(起, 止, keyword, 审核情况, 物料类别);
        if (!await CanPrice()) foreach (var r in rows) r.金额 = null;
        return Ok(rows);
    }
}
```

- [ ] **Step 4: MenuCatalog** 在 `MenuCatalog.cs` 的 `new("塑胶报表","塑胶分析明细查询"),` 之后加:

```csharp
        new("塑胶报表","塑胶订购单查询"),
```

- [ ] **Step 5: 种子** Create `db/seed_plastic_order_query_perms.sql`:

```sql
-- 开发用:给 admin 授予 塑胶订购单查询 菜单 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] = N'塑胶订购单查询';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'塑胶订购单查询',1,1,1,1,1,1,1,1,1);
```
应用两库(PowerShell):
```powershell
foreach ($V in "ERP_DB","ERP_TEST_DB") {
  $cs = [Environment]::GetEnvironmentVariable($V,"User"); $c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
  $cmd = $c.CreateCommand(); $cmd.CommandText = [IO.File]::ReadAllText((Resolve-Path "db/seed_plastic_order_query_perms.sql")); $null = $cmd.ExecuteNonQuery(); $c.Close(); Write-Output "$V ok"
}
```
Expected: ERP_DB ok 和 ERP_TEST_DB ok。

- [ ] **Step 6: 测试** Create `tests/ErpApi.Tests/PlasticOrderQueryServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticMaterialDoc;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticOrderQueryServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticMaterialDocService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task OrderQuery_detail_and_summary_join_filter()
    {
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶物料明细单] WHERE [单号]=N'OQ_D1'");
            c.Execute("DELETE FROM [塑胶物料单] WHERE [单号]=N'OQ_D1'");
            c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'OQ-MO'");
            c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'OQPM01'");
            c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'K-OQ'");
        }
        Clean();
        c.Execute("INSERT INTO [款号总表]([款号]) VALUES(N'K-OQ')");
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[规格],[单位]) VALUES(N'ABS',N'OQPM01',N'ABS粒',N'规A',N'kg')");
        c.Execute("INSERT INTO [生产制单]([生产单号],[款号]) VALUES(N'OQ-MO',N'K-OQ')");
        c.Execute("INSERT INTO [塑胶物料单]([单号],[日期],[生产单号],[货号],[审核]) VALUES(N'OQ_D1','2026-06-10',N'OQ-MO',N'H-OQ','1')");
        c.Execute("INSERT INTO [塑胶物料明细单]([单号],[生产单号],[货号],[物料编号],[物料名称],[颜色],[订购数量],[加工单价],[金额]) VALUES(N'OQ_D1',N'OQ-MO',N'H-OQ',N'OQPM01',N'ABS粒',N'黑',5,5,25),(N'OQ_D1',N'OQ-MO',N'H-OQ',N'OQPM01',N'ABS粒',N'黑',3,5,15)");
        try
        {
            var qi = new DateTime(2026, 6, 1); var qe = new DateTime(2026, 6, 30);
            var det = await Svc().OrderQueryDetailAsync(qi, qe, "OQPM01", null, null);
            Assert.Equal(2, det.Count);
            Assert.All(det, r => { Assert.Equal("K-OQ", r.款号); Assert.Equal("ABS", r.材料); Assert.Equal("规A", r.规格); Assert.Equal("1", r.审核); });
            var sum = await Svc().OrderQuerySummaryAsync(qi, qe, "OQPM01", null, null);
            var s = Assert.Single(sum, x => x.物料编号 == "OQPM01");
            Assert.Equal(8m, s.数量);          // 5+3
            Assert.Equal(40m, s.金额);         // 25+15
            Assert.Equal("ABS", s.物料类别);
            // 审核情况
            Assert.Empty(await Svc().OrderQueryDetailAsync(qi, qe, "OQPM01", "未审核", null));
            Assert.Equal(2, (await Svc().OrderQueryDetailAsync(qi, qe, "OQPM01", "已审核", null)).Count);
            // 物料类别
            Assert.Empty(await Svc().OrderQueryDetailAsync(qi, qe, "OQPM01", null, "不存在类"));
            Assert.Equal(2, (await Svc().OrderQueryDetailAsync(qi, qe, "OQPM01", null, "ABS")).Count);
            // 区间外
            Assert.Empty(await Svc().OrderQueryDetailAsync(new DateTime(2026, 5, 1), new DateTime(2026, 5, 31), "OQPM01", null, null));
        }
        finally { Clean(); }
    }
}
```

- [ ] **Step 7: 跑测试 + 全量回归**

Run: `dotnet test --filter "FullyQualifiedName~PlasticOrderQueryServiceDbTests"` → PASS。
Run: `dotnet test` → 全绿(366 → 367)。报告总数行。

- [ ] **Step 8: Commit**

```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticOrderQueryServiceDbTests.cs db/seed_plastic_order_query_perms.sql
git commit -m @'
feat(塑胶订购单查询): OrderQueryDetail/Summary(明细+汇总GROUP·款号/材料·脱敏)+Controller+菜单+种子+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 两Tab查询页 + API + 路由 + 菜单

**Files:** Create `web/src/api/plasticOrderQuery.ts`, `web/src/pages/plastics/PlasticOrderQueryPage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: API** `web/src/api/plasticOrderQuery.ts`:

```typescript
import { api } from "./client";

export interface PlasticOrderQueryDetailRow {
  日期?: string; 单号?: string; 工模编号?: string; 生产单号?: string; 款号?: string; 货号?: string;
  物料编号?: string; 物料名称?: string; 颜色?: string; 材料?: string; 规格?: string; 单位?: string;
  数量?: number | null; 加工单价?: number | null; 金额?: number | null; 审核?: string;
}
export interface PlasticOrderQuerySummaryRow {
  物料编号?: string; 物料名称?: string; 物料类别?: string; 规格?: string; 颜色?: string; 单位?: string;
  数量?: number | null; 金额?: number | null;
}
export interface PlasticOrderQueryParams { 起: string; 止: string; keyword?: string; 审核情况?: string; 物料类别?: string }
export const plasticOrderQueryApi = {
  detail: (p: PlasticOrderQueryParams) => api.get<PlasticOrderQueryDetailRow[]>("/plastic-order-query/detail", { params: p }).then(r => r.data),
  summary: (p: PlasticOrderQueryParams) => api.get<PlasticOrderQuerySummaryRow[]>("/plastic-order-query/summary", { params: p }).then(r => r.data),
};
```

- [ ] **Step 2: 页面** `web/src/pages/plastics/PlasticOrderQueryPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, DatePicker, Input, Select, Space, Table, Tabs, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { plasticOrderQueryApi, type PlasticOrderQueryDetailRow, type PlasticOrderQuerySummaryRow, type PlasticOrderQueryParams } from "../../api/plasticOrderQuery";
import { plasticMaterialMasterApi, type PlasticMaterialCategoryNode } from "../../api/plasticMaterialMaster";
import { can, hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import { downloadCsv, printTable, type ExportCol } from "../../utils/tableExport";
import PlasticMaterialDocDrawer from "./PlasticMaterialDocDrawer";

const MENU = "塑胶订购单查询";
const ALL = "__ALL__";
const thisMonth = (): [Dayjs, Dayjs] => [dayjs().startOf("month"), dayjs().endOf("month")];

export default function PlasticOrderQueryPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const priceHidden = hidePrice(perms, MENU);
  const [tab, setTab] = useState<"detail" | "summary">("detail");
  const [range, setRange] = useState<[Dayjs, Dayjs]>(thisMonth);
  const [审核情况, set审核情况] = useState("");
  const [selCat, setSelCat] = useState(ALL);
  const [keyword, setKeyword] = useState("");
  const [cats, setCats] = useState<PlasticMaterialCategoryNode[]>([]);
  const [detail, setDetail] = useState<PlasticOrderQueryDetailRow[]>([]);
  const [summary, setSummary] = useState<PlasticOrderQuerySummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<string | undefined>(undefined);

  const query = useMemo<PlasticOrderQueryParams>(() => ({
    起: range[0].format("YYYY-MM-DD"), 止: range[1].format("YYYY-MM-DD"),
    keyword: keyword || undefined, 审核情况: 审核情况 || undefined,
    物料类别: selCat === ALL ? undefined : selCat,
  }), [range, keyword, 审核情况, selCat]);

  const load = useCallback(async () => {
    if (!canOpen) return;
    setLoading(true);
    try {
      if (tab === "detail") setDetail(await plasticOrderQueryApi.detail(query));
      else setSummary(await plasticOrderQueryApi.summary(query));
    } catch { message.error("加载塑胶订购单查询失败"); }
    finally { setLoading(false); }
  }, [canOpen, tab, query]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => { if (canOpen) plasticMaterialMasterApi.categories().then(setCats).catch(() => {}); }, [canOpen]);

  const jumpMonth = (offset: number) => {
    const base = dayjs().add(offset, "month");
    setRange([base.startOf("month"), base.endOf("month")]);
  };
  const fix2 = (v?: number | null) => (v == null ? "" : Number(v).toFixed(2));

  const detailColumns = [
    { title: "日期", dataIndex: "日期", width: 100, render: (v?: string) => v?.slice(0, 10) },
    { title: "单号", dataIndex: "单号", width: 130, render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "工模编号", dataIndex: "工模编号", width: 100 },
    { title: "生产单号", dataIndex: "生产单号", width: 130 },
    { title: "款号", dataIndex: "款号", width: 100 },
    { title: "货号", dataIndex: "货号", width: 100 },
    { title: "物料编号", dataIndex: "物料编号", width: 110 },
    { title: "物料名称", dataIndex: "物料名称", width: 140 },
    { title: "颜色", dataIndex: "颜色", width: 70 },
    { title: "材料", dataIndex: "材料", width: 70 },
    { title: "规格", dataIndex: "规格", width: 100 },
    { title: "单位", dataIndex: "单位", width: 56 },
    { title: "数量", dataIndex: "数量", width: 80, align: "right" as const },
    ...(priceHidden ? [] : [
      { title: "加工单价", dataIndex: "加工单价", width: 90, align: "right" as const, render: (v?: number | null) => v ?? "" },
      { title: "金额", dataIndex: "金额", width: 100, align: "right" as const, render: fix2 },
    ]),
    { title: "审核", dataIndex: "审核", width: 60, render: (v?: string) => (v === "1" ? "已审核" : "未审核") },
  ];
  const summaryColumns = [
    { title: "物料编号", dataIndex: "物料编号", width: 120 },
    { title: "物料名称", dataIndex: "物料名称", width: 150 },
    { title: "物料类别", dataIndex: "物料类别", width: 90 },
    { title: "规格", dataIndex: "规格", width: 120 },
    { title: "颜色", dataIndex: "颜色", width: 80 },
    { title: "单位", dataIndex: "单位", width: 60 },
    { title: "数量", dataIndex: "数量", width: 100, align: "right" as const },
    ...(priceHidden ? [] : [{ title: "金额", dataIndex: "金额", width: 120, align: "right" as const, render: fix2 }]),
  ];

  const exportNow = (action: "csv" | "print") => {
    const cols: ExportCol[] = (tab === "detail" ? detailColumns : summaryColumns).map(c => ({
      title: String(c.title), key: String(c.dataIndex),
      fmt: c.dataIndex === "日期" ? (v => String(v ?? "").slice(0, 10)) : c.dataIndex === "审核" ? (v => v === "1" ? "已审核" : "未审核") : undefined,
    }));
    const data = (tab === "detail" ? detail : summary) as unknown as Record<string, unknown>[];
    const name = tab === "detail" ? "塑胶订购单查询-明细" : "塑胶订购单查询-汇总";
    if (action === "csv") downloadCsv(`${name}.csv`, cols, data); else printTable(name, cols, data);
  };

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"塑胶订购单查询·打开"权限）。</div></Card>;
  }

  return (
    <Card title="塑胶订购单查询" variant="borderless">
      <Space style={{ marginBottom: 12 }} wrap>
        <Button onClick={() => jumpMonth(-1)}>上月</Button>
        <Button onClick={() => jumpMonth(0)}>本月</Button>
        <Button onClick={() => jumpMonth(1)}>下月</Button>
        <DatePicker.RangePicker value={range} allowClear={false}
          onChange={v => { if (v && v[0] && v[1]) setRange([v[0], v[1]]); }} />
        <Select value={审核情况} onChange={set审核情况} style={{ width: 120 }}
          options={[{ value: "", label: "审核:全部" }, { value: "已审核", label: "已审核" }, { value: "未审核", label: "未审核" }]} />
        <Select value={selCat} onChange={setSelCat} style={{ width: 150 }}
          options={[{ value: ALL, label: "所有类别" }, ...cats.map(c => ({ value: c.类别 ?? "", label: `${c.类别}（${c.数量}）` }))]} />
        <Input.Search placeholder="物料编号/名称/规格/货号/款号" allowClear value={keyword}
          onChange={e => setKeyword(e.target.value)} onSearch={load} style={{ width: 240 }} />
        <Button onClick={() => exportNow("csv")}>导出EXCEL</Button>
        <Button onClick={() => exportNow("print")}>打印</Button>
      </Space>
      <Tabs activeKey={tab} onChange={k => setTab(k as "detail" | "summary")}
        items={[
          { key: "detail", label: "明细查询" }, { key: "summary", label: "汇总查询" },
        ]} />
      {tab === "detail"
        ? <Table rowKey={(_, i) => String(i)} size="small" loading={loading} dataSource={detail} columns={detailColumns}
            scroll={{ x: "max-content" }} pagination={{ pageSize: 50, showTotal: t => `共 ${t} 条` }}
            onRow={r => ({ onDoubleClick: () => { if (r.单号) setViewing(r.单号); }, style: { cursor: "pointer" } })} />
        : <Table rowKey={(_, i) => String(i)} size="small" loading={loading} dataSource={summary} columns={summaryColumns}
            scroll={{ x: "max-content" }} pagination={{ pageSize: 50, showTotal: t => `共 ${t} 条` }} />}
      <PlasticMaterialDocDrawer open={viewing !== undefined} 单号={viewing} onClose={() => setViewing(undefined)} />
    </Card>
  );
}
```

注:双击明细行用 `r.单号` 开 `PlasticMaterialDocDrawer`(它支持 `单号` prop 按单号查看)。导出按当前 Tab 列/数据。

- [ ] **Step 3: 路由 + 菜单**
  - `web/src/App.tsx`:加 `import PlasticOrderQueryPage from "./pages/plastics/PlasticOrderQueryPage";`;在塑胶路由附近加 `<Route path="plastic-order-query" element={<PlasticOrderQueryPage />} />`。
  - `web/src/nav/menuTree.tsx`:把 ⑨ 塑胶报表 的占位 `M("塑胶订购单查询")` 改为 `M("塑胶订购单查询", "/plastic-order-query", "塑胶订购单查询")`。

- [ ] **Step 4: 测试 + 构建**

Run: `npm --prefix web run test` → 54 不减。
Run: `npm --prefix web run build` → tsc 干净 + 构建成功(若 PlasticMaterialDocDrawer 的 `onSaved` 必填则传 `onSaved={() => {}}`;若 Drawer 仅 `单号` 看整单需要别的必填 prop,按其签名补最小值并报告)。

- [ ] **Step 5: Commit**

```powershell
git add web/src/api/plasticOrderQuery.ts web/src/pages/plastics/PlasticOrderQueryPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(塑胶订购单查询): 前端两Tab查询页(汇总/明细+双击开单据+导出打印·单价脱敏)+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟**

重启后端(新代码,`-c Release`,`ASPNETCORE_URLS=http://127.0.0.1:5000`,env ERP_DB/ERP_JWT_KEY),待就绪。PowerShell 在 ERP_DB 种(**先种 款号总表 父行**):款号总表(K-OQS)、塑胶物料资料(OQSPM·类别ABS/规格规A/单位kg)、生产制单(OQS-MO·款号 K-OQS)、塑胶物料单(OQ_SMK·本月·审核'1')、塑胶物料明细单(OQ_SMK·物料 OQSPM·颜色黑·订购数量 5/3·加工单价 5·金额 25/15)。Node axios:admin 登录 → `GET /api/plastic-order-query/detail?起=<本月1日>&止=<本月末>&keyword=OQSPM` 2 行(款号 K-OQS/材料 ABS)→ `/summary?...` 1 行(数量 8/金额 40)。PowerShell 清理(反 FK 序)。

Expected: 明细 2 行带款号/材料,汇总 1 行 数量8/金额40。

- [ ] **Step 2: opus 全分支终审**

派 opus 对 `feat-plastic-order-query` 全分支终审:JOIN 链(明细→单头·LEFT JOIN 生产制单 ON 生产单号[UNIQUE 1:1]·LEFT JOIN 物料资料[材料/规格/单位])、明细数量=订购数量、汇总 GROUP BY 物料编号+规格+颜色 SUM、审核情况片段(已/未/全部)、物料类别/keyword/日期边界、单价脱敏(明细加工单价+金额、汇总金额)、菜单/权限/DI、前端两 Tab + 双击 PlasticMaterialDocDrawer 按单号、categories 下拉、导出按 Tab、测试自洽含款号总表 FK 父行。目标 READY TO MERGE。

- [ ] **Step 3: 合并 master**

```powershell
git checkout master
git merge --no-ff feat-plastic-order-query -m @'
Merge branch 'feat-plastic-order-query' into master

塑胶订购单查询(塑胶物料单·汇总+明细两Tab·双击开单据·单价脱敏)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
git branch -d feat-plastic-order-query
```

- [ ] **Step 4: worklog + MEMORY** Create `docs/worklogs/2026-06-26-plastic-order-query.md`(P4 第六张);更新塑胶模块记忆。Commit。

```powershell
git add docs/worklogs/2026-06-26-plastic-order-query.md
git commit -m @'
docs(worklog): 塑胶订购单查询 2026-06-26

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## 自审清单(已核对)

- **Spec 覆盖**:2 DTO+ApprovalFilter+Detail/Summary=Task1 Step1-2;Controller 2 端点+脱敏=Step3;菜单+种子=Step4-5;测试=Step6;前端 api/两Tab页/路由/菜单=Task2;冒烟/终审/合并=Task3。无遗漏。
- **类型一致**:前端 `PlasticOrderQueryDetailRow`/`PlasticOrderQuerySummaryRow` = 后端 DTO;`detail/summary(参数对象)` = Controller 两端点。
- **JOIN 不放大**:生产单号 UNIQUE → LEFT JOIN 1:1;物料资料子查询 GROUP 1:1。
- **脱敏**:明细 无单价权限置 加工单价+金额 null;汇总置 金额 null;前端 hidePrice 去对应列。
- **审核情况**:ApprovalFilter 片段 已审核/未审核/全部;前端下拉 空/已审核/未审核。
- **双击开单**:PlasticMaterialDocDrawer `单号` prop;`viewing` state。
- **无占位**:全码;FK 父行(款号总表)种子/清理顺序在测试与冒烟均给出。
