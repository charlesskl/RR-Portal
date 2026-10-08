# 塑胶分析明细查询 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 塑胶物料单(塑胶采购分析)的扁平明细查询:按日期区间+关键词+完成情况(接生产制单.完成)列出明细行,加工单价/金额按权限脱敏。

**Architecture:** 后端在 `PlasticMaterialDocService` 加查询方法(塑胶物料明细单 JOIN 单头 + LEFT JOIN 生产制单[款号/完成] + LEFT JOIN 塑胶物料资料[材料/单位]),返回扁平行;新独立 Controller(菜单 塑胶分析明细查询,单价脱敏)。前端新查询页复用日期工具栏 + tableExport。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + Ant Design v6 + dayjs + Vitest。

---

## 前置约定

- 工作目录 `D:\WebpageERP`,分支 `feat-plastic-analysis-detail`,完成 `--no-ff` 合并 master 删分支。PowerShell;`dotnet` 不在 PATH:`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 测试 env 从 User 取:`$env:ERP_TEST_DB`/`$env:ERP_JWT_KEY`/`$env:ERP_DB`。后端 `dotnet test`(锁 DLL 用 `-c Release`)。前端 `npm --prefix web run test`/`build`。
- 提交末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 镜像源:`PlasticMaterialDocService`(P2·`(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)`·Dapper)、`PlasticInOutController`(报表 Controller 范式)、`PlasticInOutReportPage`(日期工具栏)、`tableExport`。`hidePrice(perms,menu)`(`web/src/auth/permissions.ts`)。
- 数据源:塑胶物料明细单(生产单号/货号/物料编号/物料名称/颜色/加工内容/加工单价/订购数量/金额)、塑胶物料单头(单号/日期)、生产制单(生产单号/款号/完成[N'是'/N'否'])、塑胶物料资料(物料类别/单位)。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocDtos.cs` | 加 PlasticAnalysisDetailRow | 改 |
| `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocService.cs` | 加 AnalysisDetailAsync | 改 |
| `src/ErpApi/Features/Plastics/PlasticAnalysis/PlasticAnalysisController.cs` | 报表端点+单价脱敏 | 新建 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加菜单 | 改 |
| `db/seed_plastic_analysis_perms.sql` | admin 授权 | 新建 |
| `tests/ErpApi.Tests/PlasticAnalysisDetailServiceDbTests.cs` | 明细查询测试 | 新建 |
| `web/src/api/plasticAnalysis.ts` | typed API | 新建 |
| `web/src/pages/plastics/PlasticAnalysisDetailPage.tsx` | 查询页 | 新建 |
| `web/src/App.tsx` | 路由 | 改 |
| `web/src/nav/menuTree.tsx` | 填菜单 | 改 |

---

## Task 1: 后端 明细查询 + Controller + 菜单 + 种子 + 测试

**Files:** Modify `PlasticMaterialDocDtos.cs`, `PlasticMaterialDocService.cs`, `MenuCatalog.cs`; Create `PlasticAnalysisController.cs`, `db/seed_plastic_analysis_perms.sql`, `tests/ErpApi.Tests/PlasticAnalysisDetailServiceDbTests.cs`

- [ ] **Step 1: DTO** 在 `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocDtos.cs` 末尾追加:

```csharp
public sealed class PlasticAnalysisDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 货号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 材料 { get; set; }
    public string? 单位 { get; set; }
    public string? 加工内容 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 完成 { get; set; }
}
```

- [ ] **Step 2: 方法** 在 `PlasticMaterialDocService` 类内追加(任一方法之后):

```csharp
    // 塑胶分析明细查询:塑胶物料明细 JOIN 单头(日期) + LEFT JOIN 生产制单(款号/完成) + LEFT JOIN 塑胶物料资料(材料/单位)。
    public async Task<IReadOnlyList<PlasticAnalysisDetailRow>> AnalysisDetailAsync(DateTime 起, DateTime 止, string? keyword, string? 完成)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var done = string.IsNullOrWhiteSpace(完成) ? null : 完成.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticAnalysisDetailRow>(@"
SELECT h.[日期], d.[生产单号], p.[款号], d.[货号], d.[物料编号], d.[物料名称], d.[颜色],
       m.[物料类别] AS 材料, m.[单位], d.[加工内容], d.[订购数量] AS 数量,
       d.[加工单价], d.[金额], ISNULL(p.[完成], N'否') AS 完成
FROM [塑胶物料明细单] d
JOIN [塑胶物料单] h ON h.[单号] = d.[单号]
LEFT JOIN [生产制单] p ON p.[生产单号] = d.[生产单号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([单位]) AS 单位
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[生产单号] LIKE @kw OR p.[款号] LIKE @kw OR d.[货号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@done IS NULL OR ISNULL(p.[完成], N'否') = @done)
ORDER BY h.[日期] DESC, d.[单号], d.[ID]", new { qi, qe, kw, done });
        return rows.AsList();
    }
```

- [ ] **Step 3: Controller** Create `src/ErpApi/Features/Plastics/PlasticAnalysis/PlasticAnalysisController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Plastics.PlasticMaterialDoc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticAnalysis;

[ApiController]
[Authorize]
[Route("api/plastic-analysis-detail")]
public sealed class PlasticAnalysisController(
    PlasticMaterialDocService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶分析明细查询";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(DateTime 起, DateTime 止, string? keyword = null, [FromQuery(Name = "完成")] string? 完成 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.AnalysisDetailAsync(起, 止, keyword, 完成);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.单价))
            foreach (var r in rows) { r.加工单价 = null; r.金额 = null; }
        return Ok(rows);
    }
}
```

- [ ] **Step 4: MenuCatalog** 在 `src/ErpApi/Features/Admin/MenuCatalog.cs` 的 `new("塑胶报表","原料本月库存汇总"),` 之后加:

```csharp
        new("塑胶报表","塑胶分析明细查询"),
```

- [ ] **Step 5: 种子** Create `db/seed_plastic_analysis_perms.sql`:

```sql
-- 开发用:给 admin 授予 塑胶分析明细查询 菜单 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] = N'塑胶分析明细查询';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'塑胶分析明细查询',1,1,1,1,1,1,1,1,1);
```
应用两库(PowerShell):
```powershell
foreach ($V in "ERP_DB","ERP_TEST_DB") {
  $cs = [Environment]::GetEnvironmentVariable($V,"User"); $c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
  $cmd = $c.CreateCommand(); $cmd.CommandText = [IO.File]::ReadAllText((Resolve-Path "db/seed_plastic_analysis_perms.sql")); $null = $cmd.ExecuteNonQuery(); $c.Close(); Write-Output "$V ok"
}
```
Expected: ERP_DB ok 和 ERP_TEST_DB ok。

- [ ] **Step 6: 测试** Create `tests/ErpApi.Tests/PlasticAnalysisDetailServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticMaterialDoc;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticAnalysisDetailServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticMaterialDocService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task AnalysisDetail_joins_kuanhao_material_done_and_filters()
    {
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶物料明细单] WHERE [单号]=N'PAD_D1'");
            c.Execute("DELETE FROM [塑胶物料单] WHERE [单号]=N'PAD_D1'");
            c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'PAD-MO1'");
            c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'PADPM01'");
        }
        Clean();
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[单位]) VALUES(N'ABS',N'PADPM01',N'ABS粒',N'kg')");
        c.Execute("INSERT INTO [生产制单]([生产单号],[款号],[完成]) VALUES(N'PAD-MO1',N'K-AD',N'是')");
        c.Execute("INSERT INTO [塑胶物料单]([单号],[日期],[生产单号],[货号]) VALUES(N'PAD_D1','2026-06-10',N'PAD-MO1',N'H-AD')");
        c.Execute("INSERT INTO [塑胶物料明细单]([单号],[生产单号],[货号],[物料编号],[物料名称],[颜色],[加工内容],[订购数量],[加工单价],[金额]) VALUES(N'PAD_D1',N'PAD-MO1',N'H-AD',N'PADPM01',N'ABS粒',N'黑',N'原胶件',8,5,40)");
        try
        {
            var rows = await Svc().AnalysisDetailAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), null, null);
            var r = Assert.Single(rows, x => x.物料编号 == "PADPM01");
            Assert.Equal("K-AD", r.款号);
            Assert.Equal("H-AD", r.货号);
            Assert.Equal("ABS", r.材料);
            Assert.Equal("kg", r.单位);
            Assert.Equal("原胶件", r.加工内容);
            Assert.Equal(8m, r.数量);
            Assert.Equal(5m, r.加工单价);
            Assert.Equal(40m, r.金额);
            Assert.Equal("是", r.完成);
            // 完成过滤(带 keyword 隔离本测试数据)
            Assert.Empty(await Svc().AnalysisDetailAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), "PADPM01", "否"));
            Assert.Single(await Svc().AnalysisDetailAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), "PADPM01", "是"));
            // keyword=款号
            Assert.Single(await Svc().AnalysisDetailAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), "K-AD", null));
            // 区间外不出
            Assert.Empty(await Svc().AnalysisDetailAsync(new DateTime(2026, 5, 1), new DateTime(2026, 5, 31), "PADPM01", null));
        }
        finally { Clean(); }
    }
}
```

- [ ] **Step 7: 跑测试 + 全量回归**

Run: `dotnet test --filter "FullyQualifiedName~PlasticAnalysisDetailServiceDbTests"` → PASS。
Run: `dotnet test` → 全绿(365 → 366)。报告总数行。

- [ ] **Step 8: Commit**

```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticAnalysisDetailServiceDbTests.cs db/seed_plastic_analysis_perms.sql
git commit -m @'
feat(塑胶分析明细查询): AnalysisDetailAsync(明细+生产制单款号/完成+材料·脱敏)+Controller+菜单+种子+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 查询页 + API + 路由 + 菜单

**Files:** Create `web/src/api/plasticAnalysis.ts`, `web/src/pages/plastics/PlasticAnalysisDetailPage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: API** `web/src/api/plasticAnalysis.ts`:

```typescript
import { api } from "./client";

export interface PlasticAnalysisDetailRow {
  日期?: string; 生产单号?: string; 款号?: string; 货号?: string; 物料编号?: string; 物料名称?: string;
  颜色?: string; 材料?: string; 单位?: string; 加工内容?: string;
  数量?: number | null; 加工单价?: number | null; 金额?: number | null; 完成?: string;
}
export const plasticAnalysisApi = {
  list: (起: string, 止: string, keyword?: string, 完成?: string) =>
    api.get<PlasticAnalysisDetailRow[]>("/plastic-analysis-detail", { params: { 起, 止, keyword, 完成 } }).then(r => r.data),
};
```

- [ ] **Step 2: 页面** `web/src/pages/plastics/PlasticAnalysisDetailPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, DatePicker, Input, Select, Space, Table, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { plasticAnalysisApi, type PlasticAnalysisDetailRow } from "../../api/plasticAnalysis";
import { can, hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import { downloadCsv, printTable, type ExportCol } from "../../utils/tableExport";

const MENU = "塑胶分析明细查询";
const thisMonth = (): [Dayjs, Dayjs] => [dayjs().startOf("month"), dayjs().endOf("month")];

export default function PlasticAnalysisDetailPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const priceHidden = hidePrice(perms, MENU);
  const [range, setRange] = useState<[Dayjs, Dayjs]>(thisMonth);
  const [完成, set完成] = useState<string>("");
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<PlasticAnalysisDetailRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!canOpen) return;
    setLoading(true);
    try {
      setRows(await plasticAnalysisApi.list(
        range[0].format("YYYY-MM-DD"), range[1].format("YYYY-MM-DD"),
        keyword || undefined, 完成 || undefined));
    } catch { message.error("加载塑胶分析明细查询失败"); }
    finally { setLoading(false); }
  }, [canOpen, range, keyword, 完成]);
  useEffect(() => { load(); }, [load]);

  const jumpMonth = (offset: number) => {
    const base = dayjs().add(offset, "month");
    setRange([base.startOf("month"), base.endOf("month")]);
  };

  const columns = [
    { title: "日期", dataIndex: "日期", width: 100, render: (v?: string) => v?.slice(0, 10) },
    { title: "生产单号", dataIndex: "生产单号", width: 140, render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "款号", dataIndex: "款号", width: 110 },
    { title: "货号", dataIndex: "货号", width: 110 },
    { title: "物料编号", dataIndex: "物料编号", width: 110 },
    { title: "物料名称", dataIndex: "物料名称", width: 140 },
    { title: "颜色", dataIndex: "颜色", width: 80 },
    { title: "材料", dataIndex: "材料", width: 80 },
    { title: "单位", dataIndex: "单位", width: 60 },
    { title: "加工内容", dataIndex: "加工内容", width: 100 },
    { title: "数量", dataIndex: "数量", width: 90, align: "right" as const },
    ...(priceHidden ? [] : [
      { title: "加工单价", dataIndex: "加工单价", width: 100, align: "right" as const, render: (v?: number | null) => v ?? "" },
      { title: "金额", dataIndex: "金额", width: 110, align: "right" as const, render: (v?: number | null) => (v == null ? "" : Number(v).toFixed(2)) },
    ]),
    { title: "完成", dataIndex: "完成", width: 70 },
  ];

  const 数量合计 = rows.reduce((s, r) => s + Number(r.数量 ?? 0), 0);
  const 金额合计 = rows.reduce((s, r) => s + Number(r.金额 ?? 0), 0);

  const exportCols: ExportCol[] = [
    { title: "日期", key: "日期", fmt: v => String(v ?? "").slice(0, 10) },
    { title: "生产单号", key: "生产单号" }, { title: "款号", key: "款号" }, { title: "货号", key: "货号" },
    { title: "物料编号", key: "物料编号" }, { title: "物料名称", key: "物料名称" }, { title: "颜色", key: "颜色" },
    { title: "材料", key: "材料" }, { title: "单位", key: "单位" }, { title: "加工内容", key: "加工内容" }, { title: "数量", key: "数量" },
    ...(priceHidden ? [] : [{ title: "加工单价", key: "加工单价" }, { title: "金额", key: "金额" }]),
    { title: "完成", key: "完成" },
  ];
  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"塑胶分析明细查询·打开"权限）。</div></Card>;
  }

  return (
    <Card title="塑胶分析明细查询" variant="borderless">
      <Space style={{ marginBottom: 12 }} wrap>
        <Button onClick={() => jumpMonth(-1)}>上月</Button>
        <Button onClick={() => jumpMonth(0)}>本月</Button>
        <Button onClick={() => jumpMonth(1)}>下月</Button>
        <DatePicker.RangePicker value={range} allowClear={false}
          onChange={v => { if (v && v[0] && v[1]) setRange([v[0], v[1]]); }} />
        <Select value={完成} onChange={set完成} style={{ width: 120 }}
          options={[{ value: "", label: "完成:全部" }, { value: "是", label: "已完成" }, { value: "否", label: "未完成" }]} />
        <Input.Search placeholder="生产单号/款号/货号/物料" allowClear value={keyword}
          onChange={e => setKeyword(e.target.value)} onSearch={load} style={{ width: 240 }} />
        <Button onClick={() => downloadCsv("塑胶分析明细查询.csv", exportCols, asRecords())}>导出EXCEL</Button>
        <Button onClick={() => printTable("塑胶分析明细查询", exportCols, asRecords())}>打印</Button>
      </Space>
      <Table rowKey={(_, i) => String(i)} size="small" loading={loading} dataSource={rows} columns={columns}
        scroll={{ x: "max-content" }} pagination={{ pageSize: 50, showTotal: t => `共 ${t} 条` }}
        summary={() => (
          <Table.Summary fixed>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={10}><b>合计</b></Table.Summary.Cell>
              <Table.Summary.Cell index={10} align="right"><b>{数量合计}</b></Table.Summary.Cell>
              {!priceHidden && <Table.Summary.Cell index={11} />}
              {!priceHidden && <Table.Summary.Cell index={12} align="right"><b>{金额合计.toFixed(2)}</b></Table.Summary.Cell>}
              <Table.Summary.Cell index={priceHidden ? 11 : 13} />
            </Table.Summary.Row>
          </Table.Summary>
        )} />
    </Card>
  );
}
```

注:列序为 日期,生产单号,款号,货号,物料编号,物料名称,颜色,材料,单位,加工内容(共 10 列·index 0-9),数量(index 10),[加工单价(11),金额(12)],完成(末列)。汇总 colSpan=10 覆盖前 10 列、数量合计在 index 10、有价时空单价单元+金额合计、末尾补一个完成列空单元。若实跑列数对不齐,按上方列定义数一遍微调 colSpan/index。

- [ ] **Step 3: 路由 + 菜单**
  - `web/src/App.tsx`:加 `import PlasticAnalysisDetailPage from "./pages/plastics/PlasticAnalysisDetailPage";`;在塑胶路由附近加 `<Route path="plastic-analysis-detail" element={<PlasticAnalysisDetailPage />} />`。
  - `web/src/nav/menuTree.tsx`:把 ⑨ 塑胶报表 的占位 `M("塑胶分析明细查询")` 改为 `M("塑胶分析明细查询", "/plastic-analysis-detail", "塑胶分析明细查询")`。

- [ ] **Step 4: 测试 + 构建**

Run: `npm --prefix web run test` → 54 不减。
Run: `npm --prefix web run build` → tsc 干净 + 构建成功。

- [ ] **Step 5: Commit**

```powershell
git add web/src/api/plasticAnalysis.ts web/src/pages/plastics/PlasticAnalysisDetailPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(塑胶分析明细查询): 前端查询页(日期/完成情况/关键词+明细列+导出打印+汇总·单价脱敏)+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟**

重启后端(新代码,`-c Release`,`ASPNETCORE_URLS=http://127.0.0.1:5000`,env ERP_DB/ERP_JWT_KEY),待就绪。PowerShell 在 ERP_DB 种:塑胶物料资料(PADSMK·类别ABS/单位kg)、生产制单(PADSMK-MO·款号 K-SMK·完成 是)、塑胶物料单(PAD_SMK·本月·生产单号 PADSMK-MO·货号 H-SMK)、塑胶物料明细单(PAD_SMK·物料 PADSMK·加工内容 原胶件·订购数量 8·加工单价 5·金额 40)。Node axios:admin 登录 → `GET /api/plastic-analysis-detail?起=<本月1日>&止=<本月末>&keyword=PADSMK` → 行含 款号 K-SMK/材料 ABS/数量 8/加工单价 5/金额 40/完成 是;`&完成=否` 空。PowerShell 清理种子。

Expected: 明细带出款号/材料/完成正确,完成过滤生效。

- [ ] **Step 2: opus 全分支终审**

派 opus 对 `feat-plastic-analysis-detail` 全分支终审:JOIN 链(明细→单头·LEFT JOIN 生产制单 ON 生产单号[1:1 不放大]·LEFT JOIN 塑胶物料资料)、款号/完成 来自生产制单、材料/单位来自物料资料、日期区间(起含/止<次日)、keyword OR 多字段、完成过滤(ISNULL(完成,'否')=@done)、单价脱敏(无单价权限置 加工单价+金额 null)、菜单/权限/DI(复用 PlasticMaterialDocService)、前端字段一致、汇总 colSpan/index 两权限态对齐、完成情况下拉值(空/是/否)、导出列。目标 READY TO MERGE。

- [ ] **Step 3: 合并 master**

```powershell
git checkout master
git merge --no-ff feat-plastic-analysis-detail -m @'
Merge branch 'feat-plastic-analysis-detail' into master

塑胶分析明细查询(塑胶物料明细+生产制单款号/完成·日期区间·单价脱敏)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
git branch -d feat-plastic-analysis-detail
```

- [ ] **Step 4: worklog + MEMORY** Create `docs/worklogs/2026-06-26-plastic-analysis-detail.md`(P4 第五张);更新塑胶模块记忆。Commit。

```powershell
git add docs/worklogs/2026-06-26-plastic-analysis-detail.md
git commit -m @'
docs(worklog): 塑胶分析明细查询 2026-06-26

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## 自审清单(已核对)

- **Spec 覆盖**:DTO+AnalysisDetailAsync=Task1 Step1-2;Controller+单价脱敏=Step3;菜单+种子=Step4-5;测试=Step6;前端 api/页/路由/菜单=Task2;冒烟/终审/合并=Task3。无遗漏。
- **类型一致**:前端 `PlasticAnalysisDetailRow` 字段(日期/生产单号/款号/货号/物料编号/物料名称/颜色/材料/单位/加工内容/数量/加工单价/金额/完成)= 后端 DTO;`list(起,止,keyword?,完成?)` = Controller `List(起,止,keyword,完成)`。
- **JOIN 不放大**:生产单号在生产制单唯一 → LEFT JOIN 1:1;物料资料子查询按物料编号 GROUP。
- **脱敏**:无「塑胶分析明细查询·单价」权限置 加工单价+金额 null;前端 hidePrice 去两列 + 汇总不显金额 + 导出不含两列。
- **完成过滤**:`@done IS NULL OR ISNULL(p.完成,'否')=@done`;前端下拉 空/是/否。
- **无占位**:全码;汇总列序说明给出。
