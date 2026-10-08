# 加工领料进度表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ⑩ 发外加工「加工领料进度表」只读报表——= 采购加工明细表 克隆,实际源换成 白件领料明细单(审核1·按生产单号+物料编号+颜色聚合),领料无金额·未完成金额=未完成数量×订购单价。金额脱敏。零新表。

**Architecture:** 扩 `PlasticProcessPurchaseOrderService` 加 `IssueProgressAsync`(镜像 `PurchaseDetailAsync`,实际源 白件领料明细单·去领料金额)+ 新 `PlasticProcessIssueProgressController`;前端克隆 `PlasticProcessPurchaseDetailPage`。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Ant Design v6;xUnit + SkippableFact。

---

## Task 1: 后端 DTO + IssueProgressAsync + Controller + 菜单/权限

**Files:**
- Modify: `src/ErpApi/Features/Plastics/PlasticProcessPurchaseOrder/PlasticProcessPurchaseOrderDtos.cs` (末尾加 DTO)
- Modify: `src/ErpApi/Features/Plastics/PlasticProcessPurchaseOrder/PlasticProcessPurchaseOrderService.cs` (加 IssueProgressAsync)
- Create: `src/ErpApi/Features/Plastics/PlasticProcessIssueProgress/PlasticProcessIssueProgressController.cs`
- Create: `db/seed_plastic_process_issue_progress_perms.sql`
- Modify: `src/ErpApi/Features/Admin/MenuCatalog.cs` (发外加工组加项)

- [ ] **Step 1: 加 DTO**

`PlasticProcessPurchaseOrderDtos.cs` 末尾追加:
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

- [ ] **Step 2: 加 IssueProgressAsync**

`PlasticProcessPurchaseOrderService.cs` 在类内(`PurchaseDetailAsync` 之后、`DeleteAsync` 之前)加方法:
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

- [ ] **Step 3: 新 Controller**

`src/ErpApi/Features/Plastics/PlasticProcessIssueProgress/PlasticProcessIssueProgressController.cs`:
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Plastics.PlasticProcessPurchaseOrder;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticProcessIssueProgress;

[ApiController]
[Authorize]
[Route("api/plastic-process-issue-progress")]
public sealed class PlasticProcessIssueProgressController(
    PlasticProcessPurchaseOrderService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "加工领料进度表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List([FromQuery(Name = "加工厂")] string? 加工厂 = null,
        [FromQuery(Name = "起")] DateTime? 起 = null, [FromQuery(Name = "止")] DateTime? 止 = null,
        string? keyword = null, [FromQuery(Name = "完成情况")] string? 完成情况 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.IssueProgressAsync(加工厂, 起, 止, keyword, 完成情况);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.单价))
            foreach (var r in rows) { r.单价 = null; r.订购金额 = null; r.未完成金额 = null; }
        return Ok(rows);
    }
}
```

- [ ] **Step 4: 菜单 + 权限种子**

`MenuCatalog.cs` 在 `new("发外加工","采购加工明细表"),` 之后加:
```csharp
        new("发外加工","加工领料进度表"),
```

`db/seed_plastic_process_issue_progress_perms.sql`:
```sql
-- 开发用:给 admin 授予 加工领料进度表 菜单 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] = N'加工领料进度表';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'加工领料进度表',1,1,1,1,1,1,1,1,1);
```
应用两库(localdb 停止态先 `SqlLocalDB start MSSQLLocalDB`,再 `SqlLocalDB info` 取 `np:\\.\pipe\...`)。

- [ ] **Step 5: 编译**

Run: `dotnet build src/ErpApi/ErpApi.csproj -c Debug` → Build succeeded(0 错误)。

- [ ] **Step 6: Commit**
```bash
git add src/ErpApi/Features/Plastics/PlasticProcessPurchaseOrder/ src/ErpApi/Features/Plastics/PlasticProcessIssueProgress/ src/ErpApi/Features/Admin/MenuCatalog.cs db/seed_plastic_process_issue_progress_perms.sql
git commit -m "feat(加工领料进度表): 后端DTO+IssueProgressAsync+Controller+菜单权限"
```

---

## Task 2: 后端 DB 测试

**Files:**
- Create: `tests/ErpApi.Tests/PlasticProcessIssueProgressServiceDbTests.cs`

- [ ] **Step 1: 写测试**

`PlasticProcessIssueProgressServiceDbTests.cs`:
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticProcessPurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticProcessIssueProgressServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticProcessPurchaseOrderService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static void Seed(SqlConnection c)
    {
        Clean(c);
        c.Execute("INSERT INTO [塑胶加工采购单]([单号],[日期],[加工厂编号],[加工厂名称],[审核]) VALUES(N'SJ-IP-1','2026-06-15',N'F-IP',N'IP测试加工厂','1')");
        c.Execute("INSERT INTO [塑胶加工采购单明细]([单号],[生产单号],[款号],[模具编号],[物料编号],[物料名称],[用料名称],[颜色],[加工内容],[数量],[单价],[金额]) VALUES(N'SJ-IP-1',N'PJ-IP',N'K-IP',N'GM-IP',N'IPPM',N'白件A',N'用A',N'黑',N'喷油',8,3,24)");
        c.Execute("INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[单位]) VALUES(N'IPPM',N'白件A',N'个')");
        c.Execute("INSERT INTO [白件领料单]([单号],[日期],[审核]) VALUES(N'BJL-IP-1','2026-06-20','1')");
        c.Execute("INSERT INTO [白件领料明细单]([单号],[生产单号],[物料编号],[物料名称],[颜色],[数量]) VALUES(N'BJL-IP-1',N'PJ-IP',N'IPPM',N'白件A',N'黑',5)");
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [塑胶加工采购单明细] WHERE [单号]=N'SJ-IP-1'");
        c.Execute("DELETE FROM [塑胶加工采购单] WHERE [单号]=N'SJ-IP-1'");
        c.Execute("DELETE FROM [白件领料明细单] WHERE [单号]=N'BJL-IP-1'");
        c.Execute("DELETE FROM [白件领料单] WHERE [单号]=N'BJL-IP-1'");
        c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'IPPM'");
    }

    [SkippableFact]
    public async Task IssueProgress_orders_minus_issues()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var rows = await Svc().IssueProgressAsync(null, new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), null, null);
            var r = Assert.Single(rows.Where(x => x.订购单号 == "SJ-IP-1"));
            Assert.Equal(8m, r.订购数量);
            Assert.Equal(5m, r.领料数量);
            Assert.Equal(3m, r.未完成数量);
            Assert.Equal(9m, r.未完成金额); // 3 * 3
            Assert.Equal("BJL-IP-1", r.领料单号);
            Assert.NotNull(r.领料日期);
            Assert.Equal("未完成", r.完成情况);
            Assert.Equal("个", r.单位);
            Assert.Equal("IP测试加工厂", r.加工厂名称);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task IssueProgress_filters_完成情况_and_factory_and_keyword()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var unfinished = await Svc().IssueProgressAsync(null, null, null, null, "未完成");
            Assert.Contains(unfinished, x => x.订购单号 == "SJ-IP-1");
            var finished = await Svc().IssueProgressAsync(null, null, null, null, "已完成");
            Assert.DoesNotContain(finished, x => x.订购单号 == "SJ-IP-1");
            Assert.Contains(await Svc().IssueProgressAsync("IP测试", null, null, null, null), x => x.订购单号 == "SJ-IP-1");
            Assert.DoesNotContain(await Svc().IssueProgressAsync("不存在", null, null, null, null), x => x.订购单号 == "SJ-IP-1");
            Assert.Contains(await Svc().IssueProgressAsync(null, null, null, "PJ-IP", null), x => x.订购单号 == "SJ-IP-1");
        }
        finally { Clean(c); }
    }
}
```
注意:`DbFixture`/`fx.Open()` 用法以 `PlasticProcessPurchaseDetailServiceDbTests.cs` 为准。塑胶加工采购单/白件领料单 无 FK 到款号总表故种子不种父行。

- [ ] **Step 2: 跑本测试**

Run: `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticProcessIssueProgress"`
Expected: 2 passed。

- [ ] **Step 3: 全量测试**

Run: `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj`
Expected: 全绿(397→399)。

- [ ] **Step 4: Commit**
```bash
git add tests/ErpApi.Tests/PlasticProcessIssueProgressServiceDbTests.cs
git commit -m "test(加工领料进度表): IssueProgressAsync 订购-领料-未完成 + 完成情况过滤"
```

---

## Task 3: 前端 api + Page + 路由 + 菜单

**Files:**
- Create: `web/src/api/plasticProcessIssueProgress.ts`
- Create: `web/src/pages/plastics/PlasticProcessIssueProgressPage.tsx`
- Modify: `web/src/App.tsx` (import + route)
- Modify: `web/src/nav/menuTree.tsx:120` (`M("加工领料进度表")` → 带路由)

- [ ] **Step 1: api 客户端**

`web/src/api/plasticProcessIssueProgress.ts`:
```ts
import { api } from "./client";
export interface PlasticProcessIssueProgressRow {
  订购日期?: string; 交货日期?: string; 订购单号?: string; 生产单号?: string; 款号?: string;
  模具编号?: string; 物料编号?: string; 物料名称?: string; 用料名称?: string; 颜色?: string;
  加工内容?: string; 单位?: string;
  订购数量?: number | null; 单价?: number | null; 订购金额?: number | null;
  领料日期?: string; 领料单号?: string; 领料数量?: number | null;
  未完成数量?: number | null; 未完成金额?: number | null; 完成情况?: string; 加工厂名称?: string;
}
export interface PlasticProcessIssueProgressParams { 加工厂?: string; 起: string; 止: string; keyword?: string; 完成情况?: string }
export const plasticProcessIssueProgressApi = {
  list: (p: PlasticProcessIssueProgressParams) =>
    api.get<PlasticProcessIssueProgressRow[]>("/plastic-process-issue-progress", { params: p }).then(r => r.data),
};
```

- [ ] **Step 2: 报表页(克隆 PlasticProcessPurchaseDetailPage·入仓列→领料列·去入仓金额)**

`web/src/pages/plastics/PlasticProcessIssueProgressPage.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, DatePicker, Input, Select, Space, Table, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { plasticProcessIssueProgressApi, type PlasticProcessIssueProgressRow } from "../../api/plasticProcessIssueProgress";
import { can, hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import { downloadCsv, printTable, type ExportCol } from "../../utils/tableExport";

const MENU = "加工领料进度表";
const thisMonth = (): [Dayjs, Dayjs] => [dayjs().startOf("month"), dayjs().endOf("month")];

export default function PlasticProcessIssueProgressPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const priceHidden = hidePrice(perms, MENU);
  const [range, setRange] = useState<[Dayjs, Dayjs]>(thisMonth);
  const [factory, setFactory] = useState("");
  const [keyword, setKeyword] = useState("");
  const [done, setDone] = useState<string>("");
  const [rows, setRows] = useState<PlasticProcessIssueProgressRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!canOpen) return;
    setLoading(true);
    try {
      setRows(await plasticProcessIssueProgressApi.list({
        加工厂: factory || undefined,
        起: range[0].format("YYYY-MM-DD"), 止: range[1].format("YYYY-MM-DD"),
        keyword: keyword || undefined, 完成情况: done || undefined,
      }));
    } catch { message.error("加载加工领料进度表失败"); }
    finally { setLoading(false); }
  }, [canOpen, range, factory, keyword, done]);
  useEffect(() => { load(); }, [canOpen, range, factory, done]); // eslint-disable-line react-hooks/exhaustive-deps

  const jumpMonth = (offset: number) => {
    const base = dayjs().add(offset, "month");
    setRange([base.startOf("month"), base.endOf("month")]);
  };

  const priceCols: ColumnsType<PlasticProcessIssueProgressRow> = priceHidden ? [] : [
    { title: "单价", dataIndex: "单价", width: 80, align: "right" as const },
    { title: "订购金额", dataIndex: "订购金额", width: 100, align: "right" as const },
  ];
  const unfinAmtCol: ColumnsType<PlasticProcessIssueProgressRow> = priceHidden ? [] : [
    { title: "未完成金额", dataIndex: "未完成金额", width: 100, align: "right" as const },
  ];

  const columns: ColumnsType<PlasticProcessIssueProgressRow> = [
    { title: "加工厂名称", dataIndex: "加工厂名称", width: 140 },
    { title: "生产单号", dataIndex: "生产单号", width: 140, render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "款号", dataIndex: "款号", width: 110 },
    { title: "模具编号", dataIndex: "模具编号", width: 100 },
    { title: "物料编号", dataIndex: "物料编号", width: 110 },
    { title: "物料名称", dataIndex: "物料名称", width: 140 },
    { title: "用料名称", dataIndex: "用料名称", width: 120 },
    { title: "颜色", dataIndex: "颜色", width: 70 },
    { title: "加工内容", dataIndex: "加工内容", width: 100 },
    { title: "单位", dataIndex: "单位", width: 60 },
    { title: "订购日期", dataIndex: "订购日期", width: 100, render: (v?: string) => v?.slice(0, 10) },
    { title: "交货日期", dataIndex: "交货日期", width: 100, render: (v?: string) => v?.slice(0, 10) },
    { title: "订购单号", dataIndex: "订购单号", width: 140, render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "订购数量", dataIndex: "订购数量", width: 90, align: "right" as const },
    ...priceCols,
    { title: "领料日期", dataIndex: "领料日期", width: 100, render: (v?: string) => v?.slice(0, 10) },
    { title: "领料单号", dataIndex: "领料单号", width: 140, render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "领料数量", dataIndex: "领料数量", width: 90, align: "right" as const },
    { title: "审核情况", dataIndex: "领料数量", key: "审核情况", width: 90, render: (v: number) => (Number(v) > 0 ? "已审核" : "") },
    { title: "未完成数量", dataIndex: "未完成数量", width: 90, align: "right" as const },
    ...unfinAmtCol,
    { title: "完成情况", dataIndex: "完成情况", width: 90 },
  ];

  const exportCols: ExportCol[] = [
    { title: "加工厂名称", key: "加工厂名称" }, { title: "生产单号", key: "生产单号" }, { title: "款号", key: "款号" },
    { title: "模具编号", key: "模具编号" }, { title: "物料编号", key: "物料编号" }, { title: "物料名称", key: "物料名称" },
    { title: "用料名称", key: "用料名称" }, { title: "颜色", key: "颜色" }, { title: "加工内容", key: "加工内容" }, { title: "单位", key: "单位" },
    { title: "订购日期", key: "订购日期", fmt: v => String(v ?? "").slice(0, 10) },
    { title: "交货日期", key: "交货日期", fmt: v => String(v ?? "").slice(0, 10) },
    { title: "订购单号", key: "订购单号" }, { title: "订购数量", key: "订购数量" },
    ...(priceHidden ? [] : [{ title: "单价", key: "单价" }, { title: "订购金额", key: "订购金额" }]),
    { title: "领料日期", key: "领料日期", fmt: v => String(v ?? "").slice(0, 10) },
    { title: "领料单号", key: "领料单号" }, { title: "领料数量", key: "领料数量" },
    { title: "审核情况", key: "领料数量", fmt: v => (Number(v) > 0 ? "已审核" : "") },
    { title: "未完成数量", key: "未完成数量" },
    ...(priceHidden ? [] : [{ title: "未完成金额", key: "未完成金额" }]),
    { title: "完成情况", key: "完成情况" },
  ];
  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"加工领料进度表·打开"权限）。</div></Card>;
  }

  return (
    <Card title="加工领料进度表" variant="borderless">
      <Space style={{ marginBottom: 12 }} wrap>
        <Button onClick={() => jumpMonth(-1)}>上月</Button>
        <Button onClick={() => jumpMonth(0)}>本月</Button>
        <Button onClick={() => jumpMonth(1)}>下月</Button>
        <DatePicker.RangePicker value={range} allowClear={false}
          onChange={v => { if (v && v[0] && v[1]) setRange([v[0], v[1]]); }} />
        <Input placeholder="加工厂" allowClear value={factory}
          onChange={e => setFactory(e.target.value)} style={{ width: 160 }} />
        <Select value={done} onChange={setDone} style={{ width: 130 }}
          options={[{ value: "", label: "全部" }, { value: "已完成", label: "已完成" }, { value: "未完成", label: "未完成" }]} />
        <Input.Search placeholder="生产单号/款号/物料" allowClear value={keyword}
          onChange={e => setKeyword(e.target.value)} onSearch={load} style={{ width: 240 }} />
        <Button onClick={() => downloadCsv("加工领料进度表.csv", exportCols, asRecords())}>导出EXCEL</Button>
        <Button onClick={() => printTable("加工领料进度表", exportCols, asRecords())}>打印</Button>
        <span style={{ color: "#888" }}>共 {rows.length} 条</span>
      </Space>
      <Table rowKey={(_, i) => String(i)} size="small" loading={loading} dataSource={rows} columns={columns}
        scroll={{ x: "max-content" }} pagination={{ pageSize: 50, showTotal: t => `共 ${t} 条` }} />
    </Card>
  );
}
```

- [ ] **Step 3: 路由 + 菜单**

`App.tsx`:import `PlasticProcessIssueProgressPage`;在 `plastic-process-purchase-detail` 路由附近加 `<Route path="plastic-process-issue-progress" element={<PlasticProcessIssueProgressPage />} />`。

`menuTree.tsx` line 120 `M("加工领料进度表"),` → `M("加工领料进度表", "/plastic-process-issue-progress", "加工领料进度表"),`。

- [ ] **Step 4: 类型检查 + 测试**

Run: `cd web && npx tsc --noEmit`(0 错误)；`cd web && npx vitest run`(54 passed)。

- [ ] **Step 5: Commit**
```bash
git add web/src/api/plasticProcessIssueProgress.ts web/src/pages/plastics/PlasticProcessIssueProgressPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m "feat(加工领料进度表): 前端 api+报表页+路由+菜单"
```

---

## Task 4: HTTP 冒烟 + 终审 + 合并

- [ ] **Step 1: Release 编译**(锁先按 PID Stop-Process)+ 起后端 `--contentRoot 输出目录`。
- [ ] **Step 2: 冒烟**:种 加工采购单订购8 + 白件领料5(同生产单号+物料+颜色·审核1·单号 BJL)→ `GET /api/plastic-process-issue-progress?起=&止=` 验 订购8/领料5/未完成3/未完成金额9/领料单号/完成情况=未完成;完成情况="已完成" 过滤掉。清理种子。
- [ ] **Step 3: opus 终审**:全分支 diff·验 ① 领料子查询先聚合不放大(白件领料明细单 审核1);② 未完成=订购−领料·未完成金额=未完成数量×订购单价·完成情况 CASE;③ 完成情况过滤;④ 金额脱敏 columns+exportCols 同步(无领料金额·审核情况用领料数量派生);⑤ 菜单/权限齐;⑥ DTO↔SQL↔前端一致;⑦ 全参数化·未动 ProgressAsync/PurchaseDetailAsync/LedgerUnion。READY 才合并。
- [ ] **Step 4: 合并 + 收尾**:`--no-ff` 合并 master,删分支;worklog `docs/worklogs/2026-06-30-plastic-process-issue-progress.md`;更新 MEMORY。
