# 塑胶标签查询 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 塑胶物料单(标签)只读两 Tab 查询:汇总(款号+工模编号+物料编号+颜色+货号 GROUP)+ 明细(逐行),按 日期/审核情况/物料类别/关键词;明细双击复用 PlasticMaterialDocDrawer 按单号开整单。**无价格列 → 无脱敏**。

**Architecture:** 后端在 PlasticMaterialDocService 加 明细+汇总 两查询方法(塑胶物料明细单 JOIN 单头 + LEFT JOIN 生产制单[款号] + LEFT JOIN 塑胶物料资料[单位])。复用已存在的 `ApprovalFilter`。新 Controller(/detail + /summary·无脱敏)。前端两 Tab 页克隆 PlasticOrderQueryPage(去价格列/hidePrice)。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + Ant Design v6 + dayjs + Vitest。

---

## 前置约定

- 工作目录 `D:\WebpageERP`,分支 `feat-plastic-label-query`,完成 `--no-ff` 合并 master 删分支。PowerShell;`dotnet` 不在 PATH 用 `C:\Program Files\dotnet\dotnet.exe`。
- DB 测试 env 从 User 取:`ERP_TEST_DB`/`ERP_JWT_KEY`/`ERP_DB`。后端 `dotnet test`(锁 DLL 用 `-c Release`)。前端 `npm --prefix D:\WebpageERP\web run test`/`build`。
- 提交末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 镜像源:`web/src/pages/plastics/PlasticOrderQueryPage.tsx`(刚建·两 Tab+日期工具栏)、`web/src/api/plasticOrderQuery.ts`、`web/src/pages/plastics/PlasticMaterialDocDrawer.tsx`(`{open,生产单号?,单号?,onClose,onSaved?}`·按单号开·`onSaved` 可选)、`web/src/api/plasticMaterialMaster.ts`(`categories()` → `PlasticMaterialCategoryNode{类别?,数量}`)、`web/src/utils/tableExport.ts`、`web/src/auth/permissions.ts`(`can`/`hidePrice`·`PermAction` 是字面量联合)。
- **坑:生产制单.款号 有 FK→款号总表**,任何种 生产制单 须先种 款号总表 父行,清理反序。
- **坑:离线起后端冒烟须 `--contentRoot <bin\Release\net8.0 输出目录>`**,否则 content root=cwd 不读 appsettings → `Erp:Jwt:Issuer/Audience` null → 受保护接口 401(IDX10208 audience)。
- 数据源:塑胶物料明细单(单号/生产单号/货号/工模编号/物料编号/物料名称/颜色/订购数量/备注/`[ID]` IDENTITY),塑胶物料单头(单号/日期/审核),生产制单(生产单号 UNIQUE/款号),塑胶物料资料(物料类别/单位)。
- **`ApprovalFilter` 已存在**于 `PlasticMaterialDocService`(塑胶订购单查询时加的 private static)——本计划直接复用,不重复定义。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocDtos.cs` | 加 2 DTO | 改 |
| `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocService.cs` | 加 Label Detail/Summary 方法(复用 ApprovalFilter) | 改 |
| `src/ErpApi/Features/Plastics/PlasticLabelQuery/PlasticLabelQueryController.cs` | /detail + /summary·无脱敏 | 新建 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加菜单 | 改 |
| `db/seed_plastic_label_query_perms.sql` | admin 授权 | 新建 |
| `tests/ErpApi.Tests/PlasticLabelQueryServiceDbTests.cs` | 明细/汇总/过滤测试 | 新建 |
| `web/src/api/plasticLabelQuery.ts` | typed API | 新建 |
| `web/src/pages/plastics/PlasticLabelQueryPage.tsx` | 两 Tab 查询页 | 新建 |
| `web/src/App.tsx` | 路由 | 改 |
| `web/src/nav/menuTree.tsx` | 填菜单 | 改 |

---

## Task 1: 后端 明细/汇总 + Controller + 菜单 + 种子 + 测试

**Files:** Modify `PlasticMaterialDocDtos.cs`, `PlasticMaterialDocService.cs`, `MenuCatalog.cs`; Create `PlasticLabelQueryController.cs`, `db/seed_plastic_label_query_perms.sql`, `tests/ErpApi.Tests/PlasticLabelQueryServiceDbTests.cs`

- [ ] **Step 1: DTO** 在 `PlasticMaterialDocDtos.cs` 末尾追加:

```csharp
public sealed class PlasticLabelQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class PlasticLabelQuerySummaryRow
{
    public string? 款号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
}
```

- [ ] **Step 2: 方法** 在 `PlasticMaterialDocService` 类内追加(`ApprovalFilter` 已存在,直接调用):

```csharp
    public async Task<IReadOnlyList<PlasticLabelQueryDetailRow>> LabelQueryDetailAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticLabelQueryDetailRow>($@"
SELECT h.[日期], d.[单号], p.[款号], d.[工模编号], d.[物料编号], d.[物料名称], d.[货号] AS 塑胶货号, d.[颜色],
       m.[单位], d.[订购数量] AS 数量, d.[备注], h.[审核]
FROM [塑胶物料明细单] d
JOIN [塑胶物料单] h ON h.[单号] = d.[单号]
LEFT JOIN [生产制单] p ON p.[生产单号] = d.[生产单号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([单位]) AS 单位
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR p.[款号] LIKE @kw OR d.[货号] LIKE @kw OR d.[工模编号] LIKE @kw OR d.[生产单号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID]", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticLabelQuerySummaryRow>> LabelQuerySummaryAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticLabelQuerySummaryRow>($@"
SELECT p.[款号], d.[工模编号], d.[物料编号], MAX(d.[物料名称]) AS 物料名称, d.[颜色], d.[货号] AS 塑胶货号,
       MAX(m.[单位]) AS 单位, SUM(ISNULL(d.[订购数量],0)) AS 数量
FROM [塑胶物料明细单] d
JOIN [塑胶物料单] h ON h.[单号] = d.[单号]
LEFT JOIN [生产制单] p ON p.[生产单号] = d.[生产单号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([单位]) AS 单位
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR p.[款号] LIKE @kw OR d.[货号] LIKE @kw OR d.[工模编号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
GROUP BY p.[款号], d.[工模编号], d.[物料编号], d.[颜色], d.[货号]
ORDER BY p.[款号], d.[工模编号], d.[物料编号]", new { qi, qe, kw, cat });
        return rows.AsList();
    }
```

- [ ] **Step 3: Controller** Create `src/ErpApi/Features/Plastics/PlasticLabelQuery/PlasticLabelQueryController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Plastics.PlasticMaterialDoc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticLabelQuery;

[ApiController]
[Authorize]
[Route("api/plastic-label-query")]
public sealed class PlasticLabelQueryController(
    PlasticMaterialDocService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶标签查询";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet("detail")]
    public async Task<IActionResult> Detail(DateTime 起, DateTime 止, string? keyword = null,
        [FromQuery(Name = "审核情况")] string? 审核情况 = null, [FromQuery(Name = "物料类别")] string? 物料类别 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.LabelQueryDetailAsync(起, 止, keyword, 审核情况, 物料类别));
    }

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(DateTime 起, DateTime 止, string? keyword = null,
        [FromQuery(Name = "审核情况")] string? 审核情况 = null, [FromQuery(Name = "物料类别")] string? 物料类别 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.LabelQuerySummaryAsync(起, 止, keyword, 审核情况, 物料类别));
    }
}
```

- [ ] **Step 4: MenuCatalog** 在 `MenuCatalog.cs` 的 `new("塑胶报表","塑胶订购单查询"),` 之后加:

```csharp
        new("塑胶报表","塑胶标签查询"),
```

- [ ] **Step 5: 种子** Create `db/seed_plastic_label_query_perms.sql`:

```sql
-- 开发用:给 admin 授予 塑胶标签查询 菜单 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] = N'塑胶标签查询';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'塑胶标签查询',1,1,1,1,1,1,1,1,1);
```
应用两库(PowerShell):
```powershell
foreach ($V in "ERP_DB","ERP_TEST_DB") {
  $cs = [Environment]::GetEnvironmentVariable($V,"User"); $c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
  $cmd = $c.CreateCommand(); $cmd.CommandText = [IO.File]::ReadAllText((Resolve-Path "db/seed_plastic_label_query_perms.sql")); $null = $cmd.ExecuteNonQuery(); $c.Close(); Write-Output "$V ok"
}
```
Expected: ERP_DB ok 和 ERP_TEST_DB ok。

- [ ] **Step 6: 测试** Create `tests/ErpApi.Tests/PlasticLabelQueryServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticMaterialDoc;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticLabelQueryServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticMaterialDocService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task LabelQuery_detail_and_summary_join_filter()
    {
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶物料明细单] WHERE [单号]=N'LQ_D1'");
            c.Execute("DELETE FROM [塑胶物料单] WHERE [单号]=N'LQ_D1'");
            c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'LQ-MO'");
            c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'LQPM01'");
            c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'K-LQ'");
        }
        Clean();
        c.Execute("INSERT INTO [款号总表]([款号]) VALUES(N'K-LQ')");
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[规格],[单位]) VALUES(N'ABS',N'LQPM01',N'ABS粒',N'规A',N'kg')");
        c.Execute("INSERT INTO [生产制单]([生产单号],[款号]) VALUES(N'LQ-MO',N'K-LQ')");
        c.Execute("INSERT INTO [塑胶物料单]([单号],[日期],[生产单号],[货号],[审核]) VALUES(N'LQ_D1','2026-06-10',N'LQ-MO',N'H-LQ','1')");
        c.Execute("INSERT INTO [塑胶物料明细单]([单号],[生产单号],[货号],[工模编号],[物料编号],[物料名称],[颜色],[订购数量],[备注]) VALUES(N'LQ_D1',N'LQ-MO',N'H-LQ',N'GM01',N'LQPM01',N'ABS粒',N'黑',5,N'b1'),(N'LQ_D1',N'LQ-MO',N'H-LQ',N'GM01',N'LQPM01',N'ABS粒',N'黑',3,N'b2')");
        try
        {
            var qi = new DateTime(2026, 6, 1); var qe = new DateTime(2026, 6, 30);
            var det = await Svc().LabelQueryDetailAsync(qi, qe, "LQPM01", null, null);
            Assert.Equal(2, det.Count);
            Assert.All(det, r => {
                Assert.Equal("K-LQ", r.款号); Assert.Equal("GM01", r.工模编号);
                Assert.Equal("H-LQ", r.塑胶货号); Assert.Equal("kg", r.单位); Assert.Equal("1", r.审核);
            });
            var sum = await Svc().LabelQuerySummaryAsync(qi, qe, "LQPM01", null, null);
            var s = Assert.Single(sum, x => x.物料编号 == "LQPM01");
            Assert.Equal("K-LQ", s.款号);
            Assert.Equal("GM01", s.工模编号);
            Assert.Equal("H-LQ", s.塑胶货号);
            Assert.Equal(8m, s.数量);          // 5+3
            Assert.Equal("kg", s.单位);
            // 审核情况
            Assert.Empty(await Svc().LabelQueryDetailAsync(qi, qe, "LQPM01", "未审核", null));
            Assert.Equal(2, (await Svc().LabelQueryDetailAsync(qi, qe, "LQPM01", "已审核", null)).Count);
            // 物料类别
            Assert.Empty(await Svc().LabelQueryDetailAsync(qi, qe, "LQPM01", null, "不存在类"));
            Assert.Equal(2, (await Svc().LabelQueryDetailAsync(qi, qe, "LQPM01", null, "ABS")).Count);
            // 区间外
            Assert.Empty(await Svc().LabelQueryDetailAsync(new DateTime(2026, 5, 1), new DateTime(2026, 5, 31), "LQPM01", null, null));
        }
        finally { Clean(); }
    }
}
```

- [ ] **Step 7: 跑测试 + 全量回归**

Run: `dotnet test --filter "FullyQualifiedName~PlasticLabelQueryServiceDbTests"` → PASS。
Run: `dotnet test` → 全绿(367 → 368)。报告总数行。

- [ ] **Step 8: Commit**

```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticLabelQueryServiceDbTests.cs db/seed_plastic_label_query_perms.sql
git commit -m @'
feat(塑胶标签查询): LabelQueryDetail/Summary(明细+汇总GROUP·款号/工模·无价格)+Controller+菜单+种子+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 两Tab查询页 + API + 路由 + 菜单

**Files:** Create `web/src/api/plasticLabelQuery.ts`, `web/src/pages/plastics/PlasticLabelQueryPage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: API** `web/src/api/plasticLabelQuery.ts`:

```typescript
import { api } from "./client";

export interface PlasticLabelQueryDetailRow {
  日期?: string; 单号?: string; 款号?: string; 工模编号?: string; 物料编号?: string; 物料名称?: string;
  塑胶货号?: string; 颜色?: string; 单位?: string; 数量?: number | null; 备注?: string; 审核?: string;
}
export interface PlasticLabelQuerySummaryRow {
  款号?: string; 工模编号?: string; 物料编号?: string; 物料名称?: string; 颜色?: string; 塑胶货号?: string;
  单位?: string; 数量?: number | null;
}
export interface PlasticLabelQueryParams { 起: string; 止: string; keyword?: string; 审核情况?: string; 物料类别?: string }
export const plasticLabelQueryApi = {
  detail: (p: PlasticLabelQueryParams) => api.get<PlasticLabelQueryDetailRow[]>("/plastic-label-query/detail", { params: p }).then(r => r.data),
  summary: (p: PlasticLabelQueryParams) => api.get<PlasticLabelQuerySummaryRow[]>("/plastic-label-query/summary", { params: p }).then(r => r.data),
};
```

- [ ] **Step 2: 页面** `web/src/pages/plastics/PlasticLabelQueryPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, DatePicker, Input, Select, Space, Table, Tabs, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { plasticLabelQueryApi, type PlasticLabelQueryDetailRow, type PlasticLabelQuerySummaryRow, type PlasticLabelQueryParams } from "../../api/plasticLabelQuery";
import { plasticMaterialMasterApi, type PlasticMaterialCategoryNode } from "../../api/plasticMaterialMaster";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import { downloadCsv, printTable, type ExportCol } from "../../utils/tableExport";
import PlasticMaterialDocDrawer from "./PlasticMaterialDocDrawer";

const MENU = "塑胶标签查询";
const ALL = "__ALL__";
const thisMonth = (): [Dayjs, Dayjs] => [dayjs().startOf("month"), dayjs().endOf("month")];

export default function PlasticLabelQueryPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const [tab, setTab] = useState<"detail" | "summary">("detail");
  const [range, setRange] = useState<[Dayjs, Dayjs]>(thisMonth);
  const [审核情况, set审核情况] = useState("");
  const [selCat, setSelCat] = useState(ALL);
  const [keyword, setKeyword] = useState("");
  const [cats, setCats] = useState<PlasticMaterialCategoryNode[]>([]);
  const [detail, setDetail] = useState<PlasticLabelQueryDetailRow[]>([]);
  const [summary, setSummary] = useState<PlasticLabelQuerySummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<string | undefined>(undefined);

  const query = useMemo<PlasticLabelQueryParams>(() => ({
    起: range[0].format("YYYY-MM-DD"), 止: range[1].format("YYYY-MM-DD"),
    keyword: keyword || undefined, 审核情况: 审核情况 || undefined,
    物料类别: selCat === ALL ? undefined : selCat,
  }), [range, keyword, 审核情况, selCat]);

  const load = useCallback(async () => {
    if (!canOpen) return;
    setLoading(true);
    try {
      if (tab === "detail") setDetail(await plasticLabelQueryApi.detail(query));
      else setSummary(await plasticLabelQueryApi.summary(query));
    } catch { message.error("加载塑胶标签查询失败"); }
    finally { setLoading(false); }
  }, [canOpen, tab, query]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => { if (canOpen) plasticMaterialMasterApi.categories().then(setCats).catch(() => {}); }, [canOpen]);

  const jumpMonth = (offset: number) => {
    const base = dayjs().add(offset, "month");
    setRange([base.startOf("month"), base.endOf("month")]);
  };

  const detailColumns: ColumnsType<PlasticLabelQueryDetailRow> = [
    { title: "日期", dataIndex: "日期", width: 100, render: (v?: string) => v?.slice(0, 10) },
    { title: "单号", dataIndex: "单号", width: 130, render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "款号", dataIndex: "款号", width: 100 },
    { title: "工模编号", dataIndex: "工模编号", width: 100 },
    { title: "物料编号", dataIndex: "物料编号", width: 110 },
    { title: "物料名称", dataIndex: "物料名称", width: 140 },
    { title: "塑胶货号", dataIndex: "塑胶货号", width: 100 },
    { title: "颜色", dataIndex: "颜色", width: 70 },
    { title: "单位", dataIndex: "单位", width: 56 },
    { title: "数量", dataIndex: "数量", width: 80, align: "right" },
    { title: "备注", dataIndex: "备注", width: 140 },
    { title: "审核", dataIndex: "审核", width: 60, render: (v?: string) => (v === "1" ? "已审核" : "未审核") },
  ];
  const summaryColumns: ColumnsType<PlasticLabelQuerySummaryRow> = [
    { title: "款号", dataIndex: "款号", width: 110 },
    { title: "工模编号", dataIndex: "工模编号", width: 110 },
    { title: "物料编号", dataIndex: "物料编号", width: 120 },
    { title: "物料名称", dataIndex: "物料名称", width: 150 },
    { title: "颜色", dataIndex: "颜色", width: 80 },
    { title: "塑胶货号", dataIndex: "塑胶货号", width: 110 },
    { title: "单位", dataIndex: "单位", width: 60 },
    { title: "数量", dataIndex: "数量", width: 100, align: "right" },
  ];

  const exportNow = (action: "csv" | "print") => {
    const baseCols = tab === "detail" ? detailColumns : summaryColumns;
    const cols: ExportCol[] = baseCols.map(c => {
      const key = String((c as { dataIndex?: string }).dataIndex);
      return {
        title: String(c.title), key,
        fmt: key === "日期" ? (v => String(v ?? "").slice(0, 10)) : key === "审核" ? (v => v === "1" ? "已审核" : "未审核") : undefined,
      };
    });
    const data = (tab === "detail" ? detail : summary) as unknown as Record<string, unknown>[];
    const name = tab === "detail" ? "塑胶标签查询-明细" : "塑胶标签查询-汇总";
    if (action === "csv") downloadCsv(`${name}.csv`, cols, data); else printTable(name, cols, data);
  };

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"塑胶标签查询·打开"权限）。</div></Card>;
  }

  return (
    <Card title="塑胶标签查询" variant="borderless">
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
        <Input.Search placeholder="物料编号/名称/款号/货号/工模" allowClear value={keyword}
          onChange={e => setKeyword(e.target.value)} onSearch={load} style={{ width: 240 }} />
        <Button onClick={() => exportNow("csv")}>导出EXCEL</Button>
        <Button onClick={() => exportNow("print")}>打印</Button>
        <span style={{ color: "#999" }}>提示：双击明细行可打开单据</span>
      </Space>
      <Tabs activeKey={tab} onChange={k => setTab(k as "detail" | "summary")}
        items={[{ key: "detail", label: "明细查询" }, { key: "summary", label: "汇总查询" }]} />
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

- [ ] **Step 3: 路由 + 菜单**
  - `web/src/App.tsx`:加 `import PlasticLabelQueryPage from "./pages/plastics/PlasticLabelQueryPage";`;在塑胶路由附近(`plastic-order-query` 那行旁)加 `<Route path="plastic-label-query" element={<PlasticLabelQueryPage />} />`。
  - `web/src/nav/menuTree.tsx`:把 ⑨ 塑胶报表 的占位 `M("塑胶标签查询")` 改为 `M("塑胶标签查询", "/plastic-label-query", "塑胶标签查询")`。

- [ ] **Step 4: 测试 + 构建**

Run: `npm --prefix D:\WebpageERP\web run test` → 54 不减。
Run: `npm --prefix D:\WebpageERP\web run build` → tsc 干净 + 构建成功。

- [ ] **Step 5: Commit**

```powershell
git add web/src/api/plasticLabelQuery.ts web/src/pages/plastics/PlasticLabelQueryPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(塑胶标签查询): 前端两Tab查询页(汇总/明细+双击开单据+导出打印·无价格)+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟**

重启后端(新代码,`-c Release`,`ASPNETCORE_URLS=http://127.0.0.1:5000`,env ERP_DB/ERP_JWT_KEY,**`--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`**),待就绪。PowerShell 在 ERP_DB 种(**先种 款号总表 父行**):款号总表(K-LQS)、塑胶物料资料(LQSPM·类别ABS/单位kg)、生产制单(LQS-MO·款号 K-LQS)、塑胶物料单(LQ_SMK·本月·审核'1')、塑胶物料明细单(LQ_SMK·工模 GMS·物料 LQSPM·货号 H-LQS·颜色黑·订购数量 5/3·备注)。Node axios(`proxy:false`):admin 登录 → `GET /api/plastic-label-query/detail?起=<本月1日>&止=<本月末>&keyword=LQSPM` 2 行(款号 K-LQS/工模 GMS/塑胶货号 H-LQS)→ `/summary?...` 1 行(数量 8/款号 K-LQS)→ `&审核情况=未审核` 空。PowerShell 清理(反 FK 序)。

Expected: 明细 2 行带款号/工模/塑胶货号,汇总 1 行 数量8,未审核过滤空。

- [ ] **Step 2: opus 全分支终审**

派 opus 对 `feat-plastic-label-query` 全分支终审:JOIN 链(明细→单头·LEFT JOIN 生产制单 ON 生产单号[UNIQUE 1:1]·LEFT JOIN 物料资料[单位])、明细数量=订购数量、汇总 GROUP BY 款号+工模编号+物料编号+颜色+货号 SUM、审核情况片段复用 ApprovalFilter、物料类别/keyword/日期边界、**无脱敏(确认无价格列泄漏风险)**、菜单/权限/DI、前端两 Tab + 双击 PlasticMaterialDocDrawer 按单号、categories 下拉、导出按 Tab、测试自洽含款号总表 FK 父行。目标 READY TO MERGE。

- [ ] **Step 3: 合并 master**

```powershell
git checkout master
git merge --no-ff feat-plastic-label-query -m @'
Merge branch 'feat-plastic-label-query' into master

塑胶标签查询(塑胶物料单·汇总+明细两Tab·双击开单据·无价格·省略标签三列)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
git branch -d feat-plastic-label-query
```

- [ ] **Step 4: worklog + MEMORY** Create `docs/worklogs/2026-06-27-plastic-label-query.md`(P4 第七张);更新塑胶模块记忆。Commit。

```powershell
git add docs/worklogs/2026-06-27-plastic-label-query.md
git commit -m @'
docs(worklog): 塑胶标签查询 2026-06-27

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## 自审清单(已核对)

- **Spec 覆盖**:2 DTO+Label Detail/Summary(复用 ApprovalFilter)=Task1 Step1-2;Controller 2 端点无脱敏=Step3;菜单+种子=Step4-5;测试=Step6;前端 api/两Tab页/路由/菜单=Task2;冒烟/终审/合并=Task3。无遗漏。
- **类型一致**:前端 `PlasticLabelQueryDetailRow`/`PlasticLabelQuerySummaryRow` = 后端 DTO(字段逐一对齐:日期/单号/款号/工模编号/物料编号/物料名称/塑胶货号/颜色/单位/数量/备注/审核;汇总去 日期/单号/备注/审核)。`detail/summary(参数对象)` = Controller 两端点。
- **JOIN 不放大**:生产单号 UNIQUE → LEFT JOIN 1:1;物料资料子查询 GROUP 1:1。
- **无脱敏**:无价格列(加工单价/金额),Controller 不注入价格权限判断;前端无 hidePrice import。
- **审核情况**:复用已存在的 `ApprovalFilter`(不重定义);前端下拉 空/已审核/未审核。
- **双击开单**:PlasticMaterialDocDrawer `单号` prop;`viewing` state;`onSaved` 可选省略。
- **省略标签三列**:每箱数量/预计标签数/实需标签数 不出现在 DTO/SQL/前端列(无源)。
- **FK 父行**:款号总表 在测试/冒烟均先种、反序清。
- **content root 坑**:冒烟 Step1 明确 `--contentRoot 输出目录`。
