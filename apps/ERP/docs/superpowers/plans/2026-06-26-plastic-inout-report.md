# 塑胶进出库统计表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按日期区间(单据日期·仅审核='1')出每物料×仓库的 期初/本期入库/本期出库/期末 数量;新独立报表页/端点/菜单。

**Architecture:** 库存现有 `LedgerUnion` 不动;新增并行 `LedgerUnionDated`(每支多带 h.[日期]),`InOutAsync` 对其按 物料编号×仓库 做区间聚合(期初=起前净、本期入=区间内正、本期出=区间内负的量、期末=期初+入−出)。新 `PlasticInOutController`(菜单 塑胶进出库统计表)。前端新报表页(无左树·全宽)复用日期工具栏 + tableExport。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + Ant Design v6 + dayjs + Vitest。

---

## 前置约定

- 工作目录 `D:\WebpageERP`,分支 `feat-plastic-inout-report`,完成 `--no-ff` 合并 master 删分支。PowerShell;`dotnet` 不在 PATH:`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 测试 env 从 User 取:`$env:ERP_TEST_DB`/`$env:ERP_JWT_KEY`/`$env:ERP_DB`。后端 `dotnet test`(锁 DLL 用 `-c Release`)。前端 `npm --prefix web run test`/`build`。
- 提交末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 镜像源:`web/src/pages/materials/MaterialIssueQueryPage.tsx`(日期工具栏 dayjs/thisMonth/jumpMonth/RangePicker)、`web/src/utils/tableExport.ts`(`downloadCsv`/`printTable`/`ExportCol`)。塑胶库存查询页脱敏不需要(本表无价)。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `src/ErpApi/Engines/Inventory/PlasticInventoryService.cs` | PlasticInOutRow + LedgerUnionDated + InOutAsync | 改 |
| `src/ErpApi/Features/Plastics/PlasticInOut/PlasticInOutController.cs` | 报表端点 | 新建 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加 塑胶进出库统计表 菜单 | 改 |
| `db/seed_plastic_inout_perms.sql` | admin 授权 | 新建 |
| `tests/ErpApi.Tests/PlasticInOutServiceDbTests.cs` | 区间聚合测试 | 新建 |
| `web/src/api/plasticInOut.ts` | typed API | 新建 |
| `web/src/pages/plastics/PlasticInOutReportPage.tsx` | 报表页 | 新建 |
| `web/src/App.tsx` | 加路由 | 改 |
| `web/src/nav/menuTree.tsx` | 填菜单路由 | 改 |

---

## Task 1: 后端 InOutAsync + Controller + 菜单 + 种子 + 测试

**Files:** Modify `PlasticInventoryService.cs`, `MenuCatalog.cs`; Create `PlasticInOutController.cs`, `db/seed_plastic_inout_perms.sql`, `tests/ErpApi.Tests/PlasticInOutServiceDbTests.cs`

- [ ] **Step 1: PlasticInOutRow** 在 `src/ErpApi/Engines/Inventory/PlasticInventoryService.cs`,在 `PlasticStockRow` 类之后(`public sealed class PlasticInventoryService` 之前)加:

```csharp
public sealed class PlasticInOutRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 单位 { get; set; }
    public string? 仓库 { get; set; }
    public decimal 期初数量 { get; set; }
    public decimal 本期入库 { get; set; }
    public decimal 本期出库 { get; set; }
    public decimal 期末数量 { get; set; }
}
```

- [ ] **Step 2: LedgerUnionDated 常量** 在 `PlasticInventoryService` 类内,`LedgerUnion` 常量之后加(6 支带 h.[日期]):

```csharp
    // 带单据日期的签名台账(进出库统计用;仅审核='1')。与 LedgerUnion 同 6 支,多选 h.[日期]。
    private const string LedgerUnionDated = @"
SELECT h.[日期] AS 日期, d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量] AS 数量
    FROM [塑胶入仓明细单] d JOIN [塑胶入仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [塑胶领料明细单] d JOIN [塑胶领料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]
    FROM [塑胶退料明细单] d JOIN [塑胶退料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [塑胶退仓明细单] d JOIN [塑胶退仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [塑胶报废明细单] d JOIN [塑胶报废单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT h.[日期], d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[盈亏数量]
    FROM [塑胶盘点明细单] d JOIN [塑胶盘点单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'";
```

- [ ] **Step 3: InOutAsync 方法** 在 `PlasticInventoryService` 类内(`ListAsync` 之后)加:

```csharp
    public async Task<IReadOnlyList<PlasticInOutRow>> InOutAsync(DateTime 起, DateTime 止, string? 仓库, string? keyword)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var wh = string.IsNullOrWhiteSpace(仓库) ? null : 仓库.Trim();
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var sql = $@"
SELECT t.[物料编号], MAX(t.[物料名称]) AS 物料名称, MAX(t.[规格]) AS 规格,
       MAX(m.[颜色]) AS 颜色, MAX(m.[物料类别]) AS 物料类别, MAX(t.[单位]) AS 单位, t.[仓库],
       SUM(CASE WHEN t.[日期] < @qi THEN t.[数量] ELSE 0 END) AS 期初数量,
       SUM(CASE WHEN t.[日期] >= @qi AND t.[日期] < @qe AND t.[数量] > 0 THEN t.[数量] ELSE 0 END) AS 本期入库,
       SUM(CASE WHEN t.[日期] >= @qi AND t.[日期] < @qe AND t.[数量] < 0 THEN -t.[数量] ELSE 0 END) AS 本期出库
FROM ({LedgerUnionDated}) t
LEFT JOIN (SELECT [物料编号], MAX([颜色]) AS 颜色, MAX([物料类别]) AS 物料类别
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号]=t.[物料编号]
WHERE (@wh IS NULL OR t.[仓库]=@wh)
  AND (@kw IS NULL OR t.[物料编号] LIKE @kw OR t.[物料名称] LIKE @kw OR t.[规格] LIKE @kw)
GROUP BY t.[物料编号], t.[仓库]
HAVING SUM(CASE WHEN t.[日期] < @qi THEN t.[数量] ELSE 0 END) <> 0
    OR SUM(CASE WHEN t.[日期] >= @qi AND t.[日期] < @qe THEN t.[数量] ELSE 0 END) <> 0
ORDER BY t.[物料编号], t.[仓库]";
        using var c = factory.Create();
        var rows = (await c.QueryAsync<PlasticInOutRow>(sql, new { qi, qe, wh, kw })).AsList();
        foreach (var r in rows) r.期末数量 = r.期初数量 + r.本期入库 - r.本期出库;
        return rows;
    }
```

- [ ] **Step 4: Controller** Create `src/ErpApi/Features/Plastics/PlasticInOut/PlasticInOutController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticInOut;

[ApiController]
[Authorize]
[Route("api/plastic-in-out")]
public sealed class PlasticInOutController(
    PlasticInventoryService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶进出库统计表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(DateTime 起, DateTime 止, string? 仓库 = null, string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.InOutAsync(起, 止, 仓库, keyword));
    }
}
```

- [ ] **Step 5: MenuCatalog** 在 `src/ErpApi/Features/Admin/MenuCatalog.cs` 的 `new("塑胶报表","塑胶库存"),` 之后加:

```csharp
        new("塑胶报表","塑胶进出库统计表"),
```

- [ ] **Step 6: 种子** Create `db/seed_plastic_inout_perms.sql`:

```sql
-- 开发用:给 admin 授予 塑胶进出库统计表 菜单 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] = N'塑胶进出库统计表';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'塑胶进出库统计表',1,1,1,1,1,1,1,1,1);
```
应用到两库(PowerShell):
```powershell
foreach ($V in "ERP_DB","ERP_TEST_DB") {
  $cs = [Environment]::GetEnvironmentVariable($V,"User"); $c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
  $cmd = $c.CreateCommand(); $cmd.CommandText = [IO.File]::ReadAllText((Resolve-Path "db/seed_plastic_inout_perms.sql")); $null = $cmd.ExecuteNonQuery(); $c.Close(); Write-Output "$V ok"
}
```

- [ ] **Step 7: 写测试** Create `tests/ErpApi.Tests/PlasticInOutServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.Inventory;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticInOutServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticInventoryService Svc() => new(Factory());

    [SkippableFact]
    public async Task InOut_splits_opening_in_out_by_doc_date()
    {
        using var c = fx.Open();
        var engine = new PostingEngine(Factory(), new AuditLogger());
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SIOM01'; DELETE FROM [塑胶入仓单] WHERE [单号] IN (N'SIO_R0',N'SIO_R1')");
            c.Execute("DELETE FROM [塑胶领料明细单] WHERE [物料编号]=N'SIOM01'; DELETE FROM [塑胶领料单] WHERE [单号]=N'SIO_L1'");
            c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'SIOM01'");
        }
        Clean();
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[颜色]) VALUES(N'ABS',N'SIOM01',N'ABS粒',N'黑')");
        // 期初:上月入仓 100(日期 2026-05-20)
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[仓库],[审核]) VALUES(N'SIO_R0','2026-05-20',N'进出仓','0')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'SIO_R0',N'进出仓',N'SIOM01',N'ABS粒',N'kg',100)");
        // 本期入:本月入仓 50(日期 2026-06-10)
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[仓库],[审核]) VALUES(N'SIO_R1','2026-06-10',N'进出仓','0')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'SIO_R1',N'进出仓',N'SIOM01',N'ABS粒',N'kg',50)");
        // 本期出:本月领料 20(日期 2026-06-12)
        c.Execute("INSERT INTO [塑胶领料单]([单号],[日期],[仓库],[审核]) VALUES(N'SIO_L1','2026-06-12',N'进出仓','0')");
        c.Execute("INSERT INTO [塑胶领料明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'SIO_L1',N'进出仓',N'SIOM01',N'ABS粒',N'kg',20)");
        try
        {
            await engine.ApproveAsync("塑胶入仓单", "SIO_R0", "t");
            await engine.ApproveAsync("塑胶入仓单", "SIO_R1", "t");
            await engine.ApproveAsync("塑胶领料单", "SIO_L1", "t");
            var rows = await Svc().InOutAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), "进出仓", "SIOM01");
            var r = Assert.Single(rows, x => x.物料编号 == "SIOM01");
            Assert.Equal(100m, r.期初数量);
            Assert.Equal(50m, r.本期入库);
            Assert.Equal(20m, r.本期出库);
            Assert.Equal(130m, r.期末数量);
            Assert.Equal("黑", r.颜色);
            Assert.Equal("ABS", r.物料类别);
            // 未审核不计:把本月入仓反审核 → 本期入库变 0
            await engine.UnapproveAsync("塑胶入仓单", "SIO_R1", "t");
            var rows2 = await Svc().InOutAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), "进出仓", "SIOM01");
            Assert.Equal(0m, Assert.Single(rows2, x => x.物料编号 == "SIOM01").本期入库);
        }
        finally { Clean(); }
    }
}
```

- [ ] **Step 8: 跑测试 + 全量回归**

Run: `dotnet test --filter "FullyQualifiedName~PlasticInOutServiceDbTests"` → PASS。
Run: `dotnet test` → 全绿(362 → 363)。报告总数行。

- [ ] **Step 9: Commit**

```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticInOutServiceDbTests.cs db/seed_plastic_inout_perms.sql
git commit -m @'
feat(塑胶进出库统计表): InOutAsync区间聚合(期初/本期入/出/期末·单据日期)+Controller+菜单+种子+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 报表页 + API + 路由 + 菜单

**Files:** Create `web/src/api/plasticInOut.ts`, `web/src/pages/plastics/PlasticInOutReportPage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: API** `web/src/api/plasticInOut.ts`:

```typescript
import { api } from "./client";

export interface PlasticInOutRow {
  物料编号?: string; 物料名称?: string; 规格?: string; 颜色?: string; 物料类别?: string; 单位?: string; 仓库?: string;
  期初数量: number; 本期入库: number; 本期出库: number; 期末数量: number;
}
export const plasticInOutApi = {
  list: (起: string, 止: string, 仓库?: string, keyword?: string) =>
    api.get<PlasticInOutRow[]>("/plastic-in-out", { params: { 起, 止, 仓库, keyword } }).then(r => r.data),
};
```

- [ ] **Step 2: 报表页** `web/src/pages/plastics/PlasticInOutReportPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, DatePicker, Input, Space, Table, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { plasticInOutApi, type PlasticInOutRow } from "../../api/plasticInOut";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import { downloadCsv, printTable, type ExportCol } from "../../utils/tableExport";

const MENU = "塑胶进出库统计表";
const thisMonth = (): [Dayjs, Dayjs] => [dayjs().startOf("month"), dayjs().endOf("month")];

export default function PlasticInOutReportPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const [range, setRange] = useState<[Dayjs, Dayjs]>(thisMonth);
  const [仓库, set仓库] = useState("");
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<PlasticInOutRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!canOpen) return;
    setLoading(true);
    try {
      setRows(await plasticInOutApi.list(
        range[0].format("YYYY-MM-DD"), range[1].format("YYYY-MM-DD"),
        仓库 || undefined, keyword || undefined));
    } catch { message.error("加载塑胶进出库统计表失败"); }
    finally { setLoading(false); }
  }, [canOpen, range, 仓库, keyword]);
  useEffect(() => { load(); }, [load]);

  const jumpMonth = (offset: number) => {
    const base = dayjs().add(offset, "month");
    setRange([base.startOf("month"), base.endOf("month")]);
  };

  const columns = [
    { title: "物料编号", dataIndex: "物料编号", width: 120, render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "物料名称", dataIndex: "物料名称", width: 150 },
    { title: "规格", dataIndex: "规格", width: 110 },
    { title: "颜色", dataIndex: "颜色", width: 80 },
    { title: "材料", dataIndex: "物料类别", width: 90 },
    { title: "单位", dataIndex: "单位", width: 64 },
    { title: "仓库", dataIndex: "仓库", width: 100 },
    { title: "期初数量", dataIndex: "期初数量", width: 100, align: "right" as const },
    { title: "本期入库", dataIndex: "本期入库", width: 100, align: "right" as const, render: (v: number) => <span style={{ color: "#389e0d" }}>{v}</span> },
    { title: "本期出库", dataIndex: "本期出库", width: 100, align: "right" as const, render: (v: number) => <span style={{ color: "#cf1322" }}>{v}</span> },
    { title: "期末数量", dataIndex: "期末数量", width: 100, align: "right" as const, render: (v: number) => <span style={{ fontWeight: 600 }}>{v}</span> },
  ];

  const sum = (k: keyof PlasticInOutRow) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const exportCols: ExportCol[] = [
    { title: "物料编号", key: "物料编号" }, { title: "物料名称", key: "物料名称" }, { title: "规格", key: "规格" },
    { title: "颜色", key: "颜色" }, { title: "材料", key: "物料类别" }, { title: "单位", key: "单位" }, { title: "仓库", key: "仓库" },
    { title: "期初数量", key: "期初数量" }, { title: "本期入库", key: "本期入库" }, { title: "本期出库", key: "本期出库" }, { title: "期末数量", key: "期末数量" },
  ];
  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"塑胶进出库统计表·打开"权限）。</div></Card>;
  }

  return (
    <Card title="塑胶进出库统计表" variant="borderless">
      <Space style={{ marginBottom: 12 }} wrap>
        <Button onClick={() => jumpMonth(-1)}>上月</Button>
        <Button onClick={() => jumpMonth(0)}>本月</Button>
        <Button onClick={() => jumpMonth(1)}>下月</Button>
        <DatePicker.RangePicker value={range} allowClear={false}
          onChange={v => { if (v && v[0] && v[1]) setRange([v[0], v[1]]); }} />
        <Input placeholder="仓库" allowClear value={仓库} onChange={e => set仓库(e.target.value)} onPressEnter={load} style={{ width: 120 }} />
        <Input.Search placeholder="物料编号/名称/规格" allowClear value={keyword}
          onChange={e => setKeyword(e.target.value)} onSearch={load} style={{ width: 220 }} />
        <Button onClick={() => downloadCsv("塑胶进出库统计表.csv", exportCols, asRecords())}>导出EXCEL</Button>
        <Button onClick={() => printTable("塑胶进出库统计表", exportCols, asRecords())}>打印</Button>
      </Space>
      <Table rowKey={(_, i) => String(i)} size="small" loading={loading} dataSource={rows} columns={columns}
        scroll={{ x: "max-content" }} pagination={{ pageSize: 50, showTotal: t => `共 ${t} 条` }}
        summary={() => (
          <Table.Summary fixed>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={7}><b>合计</b></Table.Summary.Cell>
              <Table.Summary.Cell index={7} align="right"><b>{sum("期初数量")}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={8} align="right"><b>{sum("本期入库")}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={9} align="right"><b>{sum("本期出库")}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={10} align="right"><b>{sum("期末数量")}</b></Table.Summary.Cell>
            </Table.Summary.Row>
          </Table.Summary>
        )} />
    </Card>
  );
}
```

- [ ] **Step 3: 路由 + 菜单**
  - `web/src/App.tsx`:顶部加 `import PlasticInOutReportPage from "./pages/plastics/PlasticInOutReportPage";`;在塑胶相关路由附近加 `<Route path="plastic-in-out" element={<PlasticInOutReportPage />} />`。
  - `web/src/nav/menuTree.tsx`:把 ⑨ 塑胶报表组的占位 `M("塑胶进出库统计表")` 改为 `M("塑胶进出库统计表", "/plastic-in-out", "塑胶进出库统计表")`。

- [ ] **Step 4: 测试 + 构建**

Run: `npm --prefix web run test` → 54 不减。
Run: `npm --prefix web run build` → tsc 干净 + 构建成功。

- [ ] **Step 5: Commit**

```powershell
git add web/src/api/plasticInOut.ts web/src/pages/plastics/PlasticInOutReportPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(塑胶进出库统计表): 前端报表页(日期工具栏+期初本期入出期末+导出打印+汇总)+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟**

重启后端(新代码,`-c Release`,`ASPNETCORE_URLS=http://127.0.0.1:5000`,env ERP_DB/ERP_JWT_KEY),待就绪。先用 PowerShell 在 ERP_DB 种:物料 SIOSMK(塑胶物料资料 类别 ABS/颜色)+ 塑胶入仓单 SIO_SMK0(日期 上月·100)+ SIO_SMK1(日期 本月·50)+ 塑胶领料单 SIO_SMKL(日期 本月·20),审核位先留 '0'。Node axios:admin 登录 → approve 三单 → `GET /api/plastic-in-out?起=<本月1日>&止=<本月末>&仓库=进出仓&keyword=SIOSMK` → 期初=100、本期入库=50、本期出库=20、期末=130。清理(PowerShell 删三单+物料)。

Expected: 区间聚合正确,单据日期划分生效。

- [ ] **Step 2: opus 全分支终审**

派 opus 对 `feat-plastic-inout-report` 全分支终审:LedgerUnion(现有)未动、LedgerUnionDated 6 支签名与 LedgerUnion 一致只多 h.[日期]、InOutAsync 期初/入/出 CASE 边界正确(起含、止含当天即 `<止+1`)、期末=期初+入−出、仅审核='1'(JOIN 单头过滤)、HAVING 滤全零行、菜单/权限/DI(复用 PlasticInventoryService 注册)齐全、前端 PlasticInOutRow 字段与后端一致、汇总 colSpan(7+4)对齐、日期工具栏 dayjs 正确、导出列与表列一致。目标 READY TO MERGE。

- [ ] **Step 3: 合并 master**

```powershell
git checkout master
git merge --no-ff feat-plastic-inout-report -m @'
Merge branch 'feat-plastic-inout-report' into master

塑胶进出库统计表(期初/本期入出/期末·单据日期区间聚合)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
git branch -d feat-plastic-inout-report
```

- [ ] **Step 4: worklog + MEMORY** Create `docs/worklogs/2026-06-26-plastic-inout-report.md`(P4 第二张);更新塑胶模块记忆。Commit。

```powershell
git add docs/worklogs/2026-06-26-plastic-inout-report.md
git commit -m @'
docs(worklog): 塑胶进出库统计表 2026-06-26

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## 自审清单(已核对)

- **Spec 覆盖**:PlasticInOutRow+LedgerUnionDated+InOutAsync=Task1 Step1-3;Controller+菜单+种子=Task1 Step4-6;测试=Task1 Step7;前端 api/页/路由/菜单=Task2;冒烟/终审/合并=Task3。无遗漏。
- **类型一致**:前端 `PlasticInOutRow`(期初数量/本期入库/本期出库/期末数量)= 后端 `PlasticInOutRow`;`list(起,止,仓库?,keyword?)` = Controller `List(起,止,仓库,keyword)`。
- **库存不变**:`LedgerUnion` 未动;新增并行 `LedgerUnionDated`。
- **签名一致**:LedgerUnionDated 6 支签名 = LedgerUnion(入仓+/领料−/退料+/退仓−/报废−/盘点盈亏)。
- **日期边界**:起含(`>=@qi`,qi=起.Date)、止含当天(`<@qe`,qe=止.Date+1)。
- **无占位**:全码;汇总 colSpan=7 + 4 列(共 11 列)对齐。
