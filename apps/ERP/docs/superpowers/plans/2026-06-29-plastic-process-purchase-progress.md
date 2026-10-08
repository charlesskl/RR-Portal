# 采购加工进度表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ⑩ 发外加工「采购加工进度表」只读报表——订购(塑胶加工采购单明细)vs 入仓实际(塑胶入仓明细单·审核1·按生产单号+物料编号+颜色聚合),算剩余数量/金额,金额脱敏。

**Architecture:** 扩 `PlasticProcessPurchaseOrderService` 加 `ProgressAsync`(镜像 `PlasticPurchaseOrderService.ProgressAsync`)+ 新 `PlasticProcessPurchaseProgressController`(镜像 `PlasticPurchaseProgressController`);前端克隆 `PlasticPurchaseProgressPage`。零新表。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Ant Design v6;xUnit + SkippableFact。

---

## Task 1: 后端 DTO + ProgressAsync + Controller + 菜单/权限

**Files:**
- Modify: `src/ErpApi/Features/Plastics/PlasticProcessPurchaseOrder/PlasticProcessPurchaseOrderDtos.cs` (末尾加 DTO)
- Modify: `src/ErpApi/Features/Plastics/PlasticProcessPurchaseOrder/PlasticProcessPurchaseOrderService.cs` (加 ProgressAsync)
- Create: `src/ErpApi/Features/Plastics/PlasticProcessPurchaseProgress/PlasticProcessPurchaseProgressController.cs`
- Create: `db/seed_plastic_process_purchase_progress_perms.sql`
- Modify: `src/ErpApi/Features/Admin/MenuCatalog.cs` (发外加工组加项)

- [ ] **Step 1: 加 DTO**

`PlasticProcessPurchaseOrderDtos.cs` 末尾追加:
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

- [ ] **Step 2: 加 ProgressAsync**

`PlasticProcessPurchaseOrderService.cs` 在类内加方法(放 QuerySummaryAsync 之后、DeleteAsync 之前皆可):
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

- [ ] **Step 3: 新 Controller**

`src/ErpApi/Features/Plastics/PlasticProcessPurchaseProgress/PlasticProcessPurchaseProgressController.cs`:
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Plastics.PlasticProcessPurchaseOrder;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticProcessPurchaseProgress;

[ApiController]
[Authorize]
[Route("api/plastic-process-purchase-progress")]
public sealed class PlasticProcessPurchaseProgressController(
    PlasticProcessPurchaseOrderService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "采购加工进度表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List([FromQuery(Name = "加工厂")] string? 加工厂 = null,
        [FromQuery(Name = "起")] DateTime? 起 = null, [FromQuery(Name = "止")] DateTime? 止 = null,
        string? keyword = null, bool onlyOwed = false)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.ProgressAsync(加工厂, 起, 止, keyword, onlyOwed);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.单价))
            foreach (var r in rows) { r.单价 = null; r.订购金额 = null; r.入仓金额 = null; r.剩余金额 = null; }
        return Ok(rows);
    }
}
```

- [ ] **Step 4: 菜单 + 权限种子**

`MenuCatalog.cs` 在 `new("发外加工","白件领料单"),` 之后加:
```csharp
        new("发外加工","采购加工进度表"),
```

`db/seed_plastic_process_purchase_progress_perms.sql`:
```sql
-- 开发用:给 admin 授予 采购加工进度表 菜单 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] = N'采购加工进度表';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'采购加工进度表',1,1,1,1,1,1,1,1,1);
```
应用两库(localdb 停止态先 `SqlLocalDB start MSSQLLocalDB` 再解析 `np:\\.\pipe\` 命名管道):
```powershell
sqlcmd -S "<pipe>" -d erp -i db\seed_plastic_process_purchase_progress_perms.sql
sqlcmd -S "<pipe>" -d erp_test -i db\seed_plastic_process_purchase_progress_perms.sql
```

- [ ] **Step 5: 编译**

Run: `dotnet build src/ErpApi/ErpApi.csproj -c Debug`
Expected: Build succeeded(0 错误)。

- [ ] **Step 6: Commit**
```bash
git add src/ErpApi/Features/Plastics/PlasticProcessPurchaseOrder/ src/ErpApi/Features/Plastics/PlasticProcessPurchaseProgress/ src/ErpApi/Features/Admin/MenuCatalog.cs db/seed_plastic_process_purchase_progress_perms.sql
git commit -m "feat(采购加工进度表): 后端DTO+ProgressAsync+Controller+菜单权限"
```

---

## Task 2: 后端 DB 测试

**Files:**
- Create: `tests/ErpApi.Tests/PlasticProcessPurchaseProgressServiceDbTests.cs`

- [ ] **Step 1: 写测试**

`PlasticProcessPurchaseProgressServiceDbTests.cs`:
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticProcessPurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticProcessPurchaseProgressServiceDbTests(DbFixture fx)
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
        // 订购:塑胶加工采购单 + 明细(生产单号 PJ-PR / 物料 PRPM / 颜色 黑 / 数量8 / 单价3 / 金额24)
        c.Execute("INSERT INTO [塑胶加工采购单]([单号],[日期],[加工厂编号],[加工厂名称],[审核]) VALUES(N'SJ-PRG-1','2026-06-15',N'F-PR',N'PR测试加工厂','1')");
        c.Execute("INSERT INTO [塑胶加工采购单明细]([单号],[生产单号],[款号],[模具编号],[物料编号],[物料名称],[用料名称],[颜色],[加工内容],[数量],[单价],[金额]) VALUES(N'SJ-PRG-1',N'PJ-PR',N'K-PR',N'GM-PR',N'PRPM',N'白件A',N'用A',N'黑',N'喷油',8,3,24)");
        c.Execute("INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[单位]) VALUES(N'PRPM',N'白件A',N'个')");
        // 入仓实际:塑胶入仓单 + 明细(同 生产单号/物料/颜色 · 数量5 / 金额15)
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[审核]) VALUES(N'SR-PRG-1','2026-06-20','1')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[生产单号],[物料编号],[物料名称],[颜色],[数量],[单价],[金额]) VALUES(N'SR-PRG-1',N'PJ-PR',N'PRPM',N'白件A',N'黑',5,3,15)");
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [塑胶加工采购单明细] WHERE [单号]=N'SJ-PRG-1'");
        c.Execute("DELETE FROM [塑胶加工采购单] WHERE [单号]=N'SJ-PRG-1'");
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [单号]=N'SR-PRG-1'");
        c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号]=N'SR-PRG-1'");
        c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'PRPM'");
    }

    [SkippableFact]
    public async Task Progress_orders_minus_receipts()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var rows = await Svc().ProgressAsync(null, new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), null, false);
            var r = Assert.Single(rows.Where(x => x.加工采购单号 == "SJ-PRG-1"));
            Assert.Equal(8m, r.订购数量);
            Assert.Equal(5m, r.入仓数量);
            Assert.Equal(3m, r.剩余数量);
            Assert.Equal(24m, r.订购金额);
            Assert.Equal(15m, r.入仓金额);
            Assert.Equal(9m, r.剩余金额);
            Assert.Equal("个", r.单位);
            Assert.Equal("喷油", r.加工内容);
            Assert.Equal("PR测试加工厂", r.加工厂名称);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Progress_filters_onlyOwed_and_factory_and_keyword()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            // onlyOwed: 剩余3>0 仍含
            var owed = await Svc().ProgressAsync(null, null, null, null, true);
            Assert.Contains(owed, x => x.加工采购单号 == "SJ-PRG-1");
            // 加工厂命中
            var hit = await Svc().ProgressAsync("PR测试", null, null, null, false);
            Assert.Contains(hit, x => x.加工采购单号 == "SJ-PRG-1");
            // 加工厂不命中
            var miss = await Svc().ProgressAsync("不存在的厂", null, null, null, false);
            Assert.DoesNotContain(miss, x => x.加工采购单号 == "SJ-PRG-1");
            // keyword 命中生产单号
            var kw = await Svc().ProgressAsync(null, null, null, "PJ-PR", false);
            Assert.Contains(kw, x => x.加工采购单号 == "SJ-PRG-1");
        }
        finally { Clean(c); }
    }
}
```
注意:`DbFixture`/`fx.Open()` 用法以现有 `PlasticProcessPurchaseOrderServiceDbTests.cs` 为准。`塑胶加工采购单`/`塑胶入仓单` 无 FK 到款号总表故种子可不种父行;若 INSERT 因列名/NOT NULL 报错,读 `db/28_plastic_process_purchase_order.sql`、`db/18_plastic_receipt.sql`+`db/24`+`db/25` 核对列名修正种子(保持断言不变)。

- [ ] **Step 2: 跑本测试**

Run: `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticProcessPurchaseProgress"`
Expected: 2 passed。

- [ ] **Step 3: 全量测试**

Run: `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj`
Expected: 全绿(393→395)。

- [ ] **Step 4: Commit**
```bash
git add tests/ErpApi.Tests/PlasticProcessPurchaseProgressServiceDbTests.cs
git commit -m "test(采购加工进度表): ProgressAsync 订购-入仓-剩余 + 过滤"
```

---

## Task 3: 前端 api + Page + 路由 + 菜单

**Files:**
- Create: `web/src/api/plasticProcessPurchaseProgress.ts`
- Create: `web/src/pages/plastics/PlasticProcessPurchaseProgressPage.tsx`
- Modify: `web/src/App.tsx` (import + route)
- Modify: `web/src/nav/menuTree.tsx:118` (`M("采购加工进度表")` → 带路由)

- [ ] **Step 1: api 客户端**

`web/src/api/plasticProcessPurchaseProgress.ts`:
```ts
import { api } from "./client";
export interface PlasticProcessPurchaseProgressRow {
  订购日期?: string; 交货日期?: string; 加工采购单号?: string; 生产单号?: string; 款号?: string;
  模具编号?: string; 物料编号?: string; 物料名称?: string; 用料名称?: string; 颜色?: string;
  加工内容?: string; 单位?: string;
  订购数量?: number | null; 单价?: number | null; 订购金额?: number | null;
  入仓数量?: number | null; 入仓金额?: number | null; 剩余数量?: number | null; 剩余金额?: number | null;
  加工厂名称?: string; 审核?: string;
}
export interface PlasticProcessPurchaseProgressParams { 加工厂?: string; 起: string; 止: string; keyword?: string; onlyOwed?: boolean }
export const plasticProcessPurchaseProgressApi = {
  list: (p: PlasticProcessPurchaseProgressParams) =>
    api.get<PlasticProcessPurchaseProgressRow[]>("/plastic-process-purchase-progress", { params: p }).then(r => r.data),
};
```

- [ ] **Step 2: 报表页(克隆 PlasticPurchaseProgressPage·加金额列+加工内容+加工厂+脱敏)**

`web/src/pages/plastics/PlasticProcessPurchaseProgressPage.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Checkbox, DatePicker, Input, Space, Table, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { plasticProcessPurchaseProgressApi, type PlasticProcessPurchaseProgressRow } from "../../api/plasticProcessPurchaseProgress";
import { can, hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import { downloadCsv, printTable, type ExportCol } from "../../utils/tableExport";

const MENU = "采购加工进度表";
const thisMonth = (): [Dayjs, Dayjs] => [dayjs().startOf("month"), dayjs().endOf("month")];

export default function PlasticProcessPurchaseProgressPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const priceHidden = hidePrice(perms, MENU);
  const [range, setRange] = useState<[Dayjs, Dayjs]>(thisMonth);
  const [factory, setFactory] = useState("");
  const [keyword, setKeyword] = useState("");
  const [onlyOwed, setOnlyOwed] = useState(false);
  const [rows, setRows] = useState<PlasticProcessPurchaseProgressRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!canOpen) return;
    setLoading(true);
    try {
      setRows(await plasticProcessPurchaseProgressApi.list({
        加工厂: factory || undefined,
        起: range[0].format("YYYY-MM-DD"), 止: range[1].format("YYYY-MM-DD"),
        keyword: keyword || undefined, onlyOwed,
      }));
    } catch { message.error("加载采购加工进度表失败"); }
    finally { setLoading(false); }
  }, [canOpen, range, factory, keyword, onlyOwed]);
  useEffect(() => { load(); }, [canOpen, range, factory, onlyOwed]); // eslint-disable-line react-hooks/exhaustive-deps

  const jumpMonth = (offset: number) => {
    const base = dayjs().add(offset, "month");
    setRange([base.startOf("month"), base.endOf("month")]);
  };

  const priceCols: ColumnsType<PlasticProcessPurchaseProgressRow> = priceHidden ? [] : [
    { title: "单价", dataIndex: "单价", width: 80, align: "right" as const },
    { title: "订购金额", dataIndex: "订购金额", width: 100, align: "right" as const },
  ];
  const inAmtCol: ColumnsType<PlasticProcessPurchaseProgressRow> = priceHidden ? [] : [
    { title: "入仓金额", dataIndex: "入仓金额", width: 100, align: "right" as const },
  ];
  const remainAmtCol: ColumnsType<PlasticProcessPurchaseProgressRow> = priceHidden ? [] : [
    { title: "剩余金额", dataIndex: "剩余金额", width: 100, align: "right" as const },
  ];

  const columns: ColumnsType<PlasticProcessPurchaseProgressRow> = [
    { title: "订购日期", dataIndex: "订购日期", width: 100, render: (v?: string) => v?.slice(0, 10) },
    { title: "交货日期", dataIndex: "交货日期", width: 100, render: (v?: string) => v?.slice(0, 10) },
    { title: "加工采购单号", dataIndex: "加工采购单号", width: 140, render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "生产单号", dataIndex: "生产单号", width: 140, render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "款号", dataIndex: "款号", width: 110 },
    { title: "模具编号", dataIndex: "模具编号", width: 100 },
    { title: "物料编号", dataIndex: "物料编号", width: 110 },
    { title: "物料名称", dataIndex: "物料名称", width: 140 },
    { title: "用料名称", dataIndex: "用料名称", width: 120 },
    { title: "颜色", dataIndex: "颜色", width: 70 },
    { title: "加工内容", dataIndex: "加工内容", width: 100 },
    { title: "单位", dataIndex: "单位", width: 60 },
    { title: "订购数量", dataIndex: "订购数量", width: 90, align: "right" as const },
    ...priceCols,
    { title: "入仓数量", dataIndex: "入仓数量", width: 90, align: "right" as const },
    ...inAmtCol,
    { title: "剩余数量", dataIndex: "剩余数量", width: 90, align: "right" as const },
    ...remainAmtCol,
    { title: "加工厂名称", dataIndex: "加工厂名称", width: 140 },
    { title: "审核", dataIndex: "审核", width: 80, render: (v?: string) => (v === "1" ? "已审核" : "未审核") },
  ];

  const exportCols: ExportCol[] = [
    { title: "订购日期", key: "订购日期", fmt: v => String(v ?? "").slice(0, 10) },
    { title: "交货日期", key: "交货日期", fmt: v => String(v ?? "").slice(0, 10) },
    { title: "加工采购单号", key: "加工采购单号" }, { title: "生产单号", key: "生产单号" }, { title: "款号", key: "款号" },
    { title: "模具编号", key: "模具编号" }, { title: "物料编号", key: "物料编号" }, { title: "物料名称", key: "物料名称" },
    { title: "用料名称", key: "用料名称" }, { title: "颜色", key: "颜色" }, { title: "加工内容", key: "加工内容" }, { title: "单位", key: "单位" },
    { title: "订购数量", key: "订购数量" },
    ...(priceHidden ? [] : [{ title: "单价", key: "单价" }, { title: "订购金额", key: "订购金额" }]),
    { title: "入仓数量", key: "入仓数量" },
    ...(priceHidden ? [] : [{ title: "入仓金额", key: "入仓金额" }]),
    { title: "剩余数量", key: "剩余数量" },
    ...(priceHidden ? [] : [{ title: "剩余金额", key: "剩余金额" }]),
    { title: "加工厂名称", key: "加工厂名称" },
    { title: "审核", key: "审核", fmt: v => (v === "1" ? "已审核" : "未审核") },
  ];
  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"采购加工进度表·打开"权限）。</div></Card>;
  }

  return (
    <Card title="采购加工进度表" variant="borderless">
      <Space style={{ marginBottom: 12 }} wrap>
        <Button onClick={() => jumpMonth(-1)}>上月</Button>
        <Button onClick={() => jumpMonth(0)}>本月</Button>
        <Button onClick={() => jumpMonth(1)}>下月</Button>
        <DatePicker.RangePicker value={range} allowClear={false}
          onChange={v => { if (v && v[0] && v[1]) setRange([v[0], v[1]]); }} />
        <Input placeholder="加工厂" allowClear value={factory}
          onChange={e => setFactory(e.target.value)} style={{ width: 160 }} />
        <Input.Search placeholder="生产单号/款号/物料" allowClear value={keyword}
          onChange={e => setKeyword(e.target.value)} onSearch={load} style={{ width: 240 }} />
        <Checkbox checked={onlyOwed} onChange={e => setOnlyOwed(e.target.checked)}>只看欠数</Checkbox>
        <Button onClick={() => downloadCsv("采购加工进度表.csv", exportCols, asRecords())}>导出EXCEL</Button>
        <Button onClick={() => printTable("采购加工进度表", exportCols, asRecords())}>打印</Button>
        <span style={{ color: "#888" }}>共 {rows.length} 条</span>
      </Space>
      <Table rowKey={(_, i) => String(i)} size="small" loading={loading} dataSource={rows} columns={columns}
        scroll={{ x: "max-content" }} pagination={{ pageSize: 50, showTotal: t => `共 ${t} 条` }} />
    </Card>
  );
}
```

- [ ] **Step 3: 路由 + 菜单**

`App.tsx`:在其它 plastics 报表 import 处加 `import PlasticProcessPurchaseProgressPage from "./pages/plastics/PlasticProcessPurchaseProgressPage";`;在 `plastic-process-purchase-query` 路由附近加 `<Route path="plastic-process-purchase-progress" element={<PlasticProcessPurchaseProgressPage />} />`。

`menuTree.tsx` line 118 `M("采购加工进度表"),` → `M("采购加工进度表", "/plastic-process-purchase-progress", "采购加工进度表"),`。

- [ ] **Step 4: 类型检查 + 测试**

Run: `cd web && npx tsc --noEmit`(0 错误)；`cd web && npx vitest run`(54 passed)。

- [ ] **Step 5: Commit**
```bash
git add web/src/api/plasticProcessPurchaseProgress.ts web/src/pages/plastics/PlasticProcessPurchaseProgressPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m "feat(采购加工进度表): 前端 api+报表页+路由+菜单"
```

---

## Task 4: HTTP 冒烟 + 终审 + 合并

- [ ] **Step 1: Release 编译**(锁先按 PID Stop-Process)+ 起后端 `--contentRoot 输出目录`。
- [ ] **Step 2: 冒烟**:种 加工采购单订购(SJ)+ 塑胶入仓(SR·同生产单号+物料+颜色)→ `GET /api/plastic-process-purchase-progress?起=&止=&加工厂=` 验 订购8/入仓5/剩余3/入仓金额15/剩余金额9;onlyOwed 过滤。清理种子。
- [ ] **Step 3: opus 终审**:全分支 diff·验 ① ProgressAsync 关联键=生产单号+物料编号+颜色 与现有塑胶进度表一致;② 金额脱敏齐(单价/订购金额/入仓金额/剩余金额);③ JOIN 1:N 不放大(入仓子查询先 GROUP BY);④ 菜单/权限齐;⑤ 前端脱敏列与 exportCols 同步;⑥ 无注入(全参数化)。READY 才合并。
- [ ] **Step 4: 合并 + 收尾**:`--no-ff` 合并 master,删分支;worklog `docs/worklogs/2026-06-29-plastic-process-purchase-progress.md`;更新 MEMORY。
