# 塑胶类型客户统计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按日期区间(单据日期+审核='1')出 行=客户 × 列=塑胶类型(加工内容)×(本月数量/本月金额)+总合计 的透视表(后端扁平行·前端透视·金额脱敏)。

**Architecture:** 后端在 `PlasticMaterialDocService` 加聚合方法(塑胶物料明细单 JOIN 塑胶物料单,按 客户×加工内容 汇总 订购数量/金额),返回扁平行;新独立 Controller(菜单 塑胶类型客户统计,无金额权限置 null)。前端新页取扁平行,前端透视成 客户行×类型列组+总合计行,复用日期工具栏+tableExport。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + Ant Design v6 + dayjs + Vitest。

---

## 前置约定

- 工作目录 `D:\WebpageERP`,分支 `feat-plastic-customer-type-stats`,完成 `--no-ff` 合并 master 删分支。PowerShell;`dotnet` 不在 PATH:`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 测试 env 从 User 取:`$env:ERP_TEST_DB`/`$env:ERP_JWT_KEY`/`$env:ERP_DB`。后端 `dotnet test`(锁 DLL 用 `-c Release`)。前端 `npm --prefix web run test`/`build`。
- 提交末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 镜像源:`web/src/pages/plastics/PlasticInOutReportPage.tsx`(日期工具栏 dayjs/上月本月下月/RangePicker)、`web/src/utils/tableExport.ts`。后端 `PlasticMaterialDocService`(`(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)`,Dapper)。
- `塑胶物料单`(头):客户/日期/审核;`塑胶物料明细单`:加工内容/订购数量/金额。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocDtos.cs` | 加 PlasticCustomerTypeStatRow | 改 |
| `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocService.cs` | 加 CustomerTypeStatsAsync | 改 |
| `src/ErpApi/Features/Plastics/PlasticCustomerType/PlasticCustomerTypeController.cs` | 报表端点+金额脱敏 | 新建 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加菜单 | 改 |
| `db/seed_plastic_customer_type_perms.sql` | admin 授权 | 新建 |
| `tests/ErpApi.Tests/PlasticCustomerTypeStatsServiceDbTests.cs` | 聚合测试 | 新建 |
| `web/src/api/plasticCustomerType.ts` | typed API | 新建 |
| `web/src/pages/plastics/PlasticCustomerTypeStatsPage.tsx` | 透视报表页 | 新建 |
| `web/src/App.tsx` | 路由 | 改 |
| `web/src/nav/menuTree.tsx` | 填菜单 | 改 |

---

## Task 1: 后端 聚合 + Controller + 菜单 + 种子 + 测试

**Files:** Modify `PlasticMaterialDocDtos.cs`, `PlasticMaterialDocService.cs`, `MenuCatalog.cs`; Create `PlasticCustomerTypeController.cs`, `db/seed_plastic_customer_type_perms.sql`, `tests/ErpApi.Tests/PlasticCustomerTypeStatsServiceDbTests.cs`

- [ ] **Step 1: DTO** 在 `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocDtos.cs` 末尾追加:

```csharp
public sealed class PlasticCustomerTypeStatRow
{
    public string? 客户 { get; set; }
    public string? 类型 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 金额 { get; set; }
}
```

- [ ] **Step 2: 服务方法** 在 `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocService.cs` 类内追加(放任一方法之后、类闭合前):

```csharp
    // 塑胶类型客户统计:按 客户 × 加工内容(=塑胶类型) 汇总 订购数量/金额(仅审核='1' + 单据日期区间)。
    public async Task<IReadOnlyList<PlasticCustomerTypeStatRow>> CustomerTypeStatsAsync(DateTime 起, DateTime 止, string? 客户)
    {
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var ck = string.IsNullOrWhiteSpace(客户) ? null : $"%{客户.Trim()}%";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticCustomerTypeStatRow>(@"
SELECT h.[客户] AS 客户, ISNULL(NULLIF(LTRIM(RTRIM(d.[加工内容])), N''), N'未分类') AS 类型,
       SUM(ISNULL(d.[订购数量],0)) AS 数量, SUM(ISNULL(d.[金额],0)) AS 金额
FROM [塑胶物料明细单] d JOIN [塑胶物料单] h ON h.[单号]=d.[单号]
WHERE ISNULL(h.[审核],'0')='1' AND h.[日期] >= @qi AND h.[日期] < @qe
  AND (@ck IS NULL OR h.[客户] LIKE @ck)
GROUP BY h.[客户], ISNULL(NULLIF(LTRIM(RTRIM(d.[加工内容])), N''), N'未分类')
HAVING SUM(ISNULL(d.[订购数量],0)) <> 0 OR SUM(ISNULL(d.[金额],0)) <> 0
ORDER BY h.[客户], 类型", new { qi, qe, ck });
        return rows.AsList();
    }
```

- [ ] **Step 3: Controller** Create `src/ErpApi/Features/Plastics/PlasticCustomerType/PlasticCustomerTypeController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Plastics.PlasticMaterialDoc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticCustomerType;

[ApiController]
[Authorize]
[Route("api/plastic-customer-type-stats")]
public sealed class PlasticCustomerTypeController(
    PlasticMaterialDocService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶类型客户统计";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(DateTime 起, DateTime 止, string? 客户 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.CustomerTypeStatsAsync(起, 止, 客户);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.金额))
            foreach (var r in rows) r.金额 = null;
        return Ok(rows);
    }
}
```

- [ ] **Step 4: MenuCatalog** 在 `src/ErpApi/Features/Admin/MenuCatalog.cs` 的 `new("塑胶报表","塑胶进出库统计表"),` 之后加:

```csharp
        new("塑胶报表","塑胶类型客户统计"),
```

- [ ] **Step 5: 种子** Create `db/seed_plastic_customer_type_perms.sql`:

```sql
-- 开发用:给 admin 授予 塑胶类型客户统计 菜单 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] = N'塑胶类型客户统计';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'塑胶类型客户统计',1,1,1,1,1,1,1,1,1);
```
应用两库(PowerShell):
```powershell
foreach ($V in "ERP_DB","ERP_TEST_DB") {
  $cs = [Environment]::GetEnvironmentVariable($V,"User"); $c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
  $cmd = $c.CreateCommand(); $cmd.CommandText = [IO.File]::ReadAllText((Resolve-Path "db/seed_plastic_customer_type_perms.sql")); $null = $cmd.ExecuteNonQuery(); $c.Close(); Write-Output "$V ok"
}
```
Expected: ERP_DB ok 和 ERP_TEST_DB ok。

- [ ] **Step 6: 测试** Create `tests/ErpApi.Tests/PlasticCustomerTypeStatsServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticMaterialDoc;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticCustomerTypeStatsServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticMaterialDocService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task CustomerTypeStats_groups_by_customer_and_type_filters_period_and_approval()
    {
        using var c = fx.Open();
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶物料明细单] WHERE [单号] IN (N'SCT_D0',N'SCT_D1',N'SCT_D2',N'SCT_D9')");
            c.Execute("DELETE FROM [塑胶物料单] WHERE [单号] IN (N'SCT_D0',N'SCT_D1',N'SCT_D2',N'SCT_D9')");
        }
        Clean();
        // 客SCTA 本月:原胶件 10/100 + 印喷件 5/50
        c.Execute("INSERT INTO [塑胶物料单]([单号],[日期],[客户],[审核]) VALUES(N'SCT_D1','2026-06-10',N'客SCTA','1')");
        c.Execute("INSERT INTO [塑胶物料明细单]([单号],[加工内容],[订购数量],[金额]) VALUES(N'SCT_D1',N'原胶件',10,100),(N'SCT_D1',N'印喷件',5,50)");
        // 客SCTB 本月:原胶件 3/30
        c.Execute("INSERT INTO [塑胶物料单]([单号],[日期],[客户],[审核]) VALUES(N'SCT_D2','2026-06-12',N'客SCTB','1')");
        c.Execute("INSERT INTO [塑胶物料明细单]([单号],[加工内容],[订购数量],[金额]) VALUES(N'SCT_D2',N'原胶件',3,30)");
        // 区间外(上月):不计
        c.Execute("INSERT INTO [塑胶物料单]([单号],[日期],[客户],[审核]) VALUES(N'SCT_D0','2026-05-10',N'客SCTA','1')");
        c.Execute("INSERT INTO [塑胶物料明细单]([单号],[加工内容],[订购数量],[金额]) VALUES(N'SCT_D0',N'原胶件',99,999)");
        // 未审核:不计
        c.Execute("INSERT INTO [塑胶物料单]([单号],[日期],[客户],[审核]) VALUES(N'SCT_D9','2026-06-15',N'客SCTA','0')");
        c.Execute("INSERT INTO [塑胶物料明细单]([单号],[加工内容],[订购数量],[金额]) VALUES(N'SCT_D9',N'原胶件',88,888)");
        try
        {
            var rows = await Svc().CustomerTypeStatsAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), null);
            var a原 = Assert.Single(rows, r => r.客户 == "客SCTA" && r.类型 == "原胶件");
            Assert.Equal(10m, a原.数量); Assert.Equal(100m, a原.金额);
            var a印 = Assert.Single(rows, r => r.客户 == "客SCTA" && r.类型 == "印喷件");
            Assert.Equal(5m, a印.数量); Assert.Equal(50m, a印.金额);
            var b原 = Assert.Single(rows, r => r.客户 == "客SCTB" && r.类型 == "原胶件");
            Assert.Equal(3m, b原.数量);
            Assert.DoesNotContain(rows, r => r.数量 == 99m);  // 区间外
            Assert.DoesNotContain(rows, r => r.数量 == 88m);  // 未审核
            // 客户过滤
            var ja = await Svc().CustomerTypeStatsAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), "客SCTA");
            Assert.Equal(2, ja.Count);
            Assert.All(ja, r => Assert.Equal("客SCTA", r.客户));
        }
        finally { Clean(); }
    }
}
```

- [ ] **Step 7: 跑测试 + 全量回归**

Run: `dotnet test --filter "FullyQualifiedName~PlasticCustomerTypeStatsServiceDbTests"` → PASS。
Run: `dotnet test` → 全绿(363 → 364)。报告总数行。

- [ ] **Step 8: Commit**

```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticCustomerTypeStatsServiceDbTests.cs db/seed_plastic_customer_type_perms.sql
git commit -m @'
feat(塑胶类型客户统计): CustomerTypeStatsAsync(客户×加工内容汇总)+Controller金额脱敏+菜单+种子+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 透视报表页 + API + 路由 + 菜单

**Files:** Create `web/src/api/plasticCustomerType.ts`, `web/src/pages/plastics/PlasticCustomerTypeStatsPage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: API** `web/src/api/plasticCustomerType.ts`:

```typescript
import { api } from "./client";

export interface PlasticCustomerTypeStatRow {
  客户?: string; 类型?: string; 数量: number; 金额?: number | null;
}
export const plasticCustomerTypeApi = {
  list: (起: string, 止: string, 客户?: string) =>
    api.get<PlasticCustomerTypeStatRow[]>("/plastic-customer-type-stats", { params: { 起, 止, 客户 } }).then(r => r.data),
};
```

- [ ] **Step 2: 透视页** `web/src/pages/plastics/PlasticCustomerTypeStatsPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, DatePicker, Input, Select, Space, Table, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { plasticCustomerTypeApi, type PlasticCustomerTypeStatRow } from "../../api/plasticCustomerType";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import { downloadCsv, printTable, type ExportCol } from "../../utils/tableExport";

const MENU = "塑胶类型客户统计";
const thisMonth = (): [Dayjs, Dayjs] => [dayjs().startOf("month"), dayjs().endOf("month")];

interface PivotRow { 客户: string; cells: Record<string, { 数量: number; 金额: number }>; 总数量: number; 总金额: number }

export default function PlasticCustomerTypeStatsPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const 金额Hidden = !can(perms, MENU, "金额");
  const [range, setRange] = useState<[Dayjs, Dayjs]>(thisMonth);
  const [客户, set客户] = useState("");
  const [rows, setRows] = useState<PlasticCustomerTypeStatRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!canOpen) return;
    setLoading(true);
    try {
      setRows(await plasticCustomerTypeApi.list(
        range[0].format("YYYY-MM-DD"), range[1].format("YYYY-MM-DD"), 客户 || undefined));
    } catch { message.error("加载塑胶类型客户统计失败"); }
    finally { setLoading(false); }
  }, [canOpen, range, 客户]);
  useEffect(() => { load(); }, [load]);

  const jumpMonth = (offset: number) => {
    const base = dayjs().add(offset, "month");
    setRange([base.startOf("month"), base.endOf("month")]);
  };

  const types = useMemo(
    () => Array.from(new Set(rows.map(r => r.类型 ?? "未分类"))).sort((a, b) => a.localeCompare(b)),
    [rows]);

  const pivot = useMemo<PivotRow[]>(() => {
    const m: Record<string, PivotRow> = {};
    for (const r of rows) {
      const k = r.客户 ?? "";
      (m[k] ??= { 客户: k, cells: {}, 总数量: 0, 总金额: 0 });
      const t = r.类型 ?? "未分类";
      const q = Number(r.数量 ?? 0), a = Number(r.金额 ?? 0);
      m[k].cells[t] = { 数量: q, 金额: a };
      m[k].总数量 += q; m[k].总金额 += a;
    }
    return Object.values(m).sort((x, y) => x.客户.localeCompare(y.客户));
  }, [rows]);

  const fix1 = (v: number) => Number(v).toFixed(1);
  const columns = useMemo(() => [
    { title: "客户", dataIndex: "客户", fixed: "left" as const, width: 150, render: (_: unknown, r: PivotRow) => r.客户 },
    ...types.map(t => ({
      title: t,
      children: [
        { title: "本月数量", key: `${t}_q`, align: "right" as const, width: 90, render: (_: unknown, r: PivotRow) => r.cells[t]?.数量 ?? 0 },
        ...(金额Hidden ? [] : [{ title: "本月金额", key: `${t}_a`, align: "right" as const, width: 110, render: (_: unknown, r: PivotRow) => fix1(r.cells[t]?.金额 ?? 0) }]),
      ],
    })),
    {
      title: "总合计",
      children: [
        { title: "总数量", key: "_tq", align: "right" as const, width: 100, render: (_: unknown, r: PivotRow) => <b>{r.总数量}</b> },
        ...(金额Hidden ? [] : [{ title: "总金额", key: "_ta", align: "right" as const, width: 120, render: (_: unknown, r: PivotRow) => <b>{fix1(r.总金额)}</b> }]),
      ],
    },
  ], [types, 金额Hidden]);

  const typeQ = (t: string) => pivot.reduce((s, r) => s + (r.cells[t]?.数量 ?? 0), 0);
  const typeA = (t: string) => pivot.reduce((s, r) => s + (r.cells[t]?.金额 ?? 0), 0);
  const grandQ = pivot.reduce((s, r) => s + r.总数量, 0);
  const grandA = pivot.reduce((s, r) => s + r.总金额, 0);

  const exportCols: ExportCol[] = useMemo(() => [
    { title: "客户", key: "客户" },
    ...types.flatMap(t => 金额Hidden
      ? [{ title: `${t}-数量`, key: `${t}__q` }]
      : [{ title: `${t}-数量`, key: `${t}__q` }, { title: `${t}-金额`, key: `${t}__a` }]),
    { title: "总数量", key: "总数量" },
    ...(金额Hidden ? [] : [{ title: "总金额", key: "总金额" }]),
  ], [types, 金额Hidden]);
  const exportRows = useMemo(() => pivot.map(r => {
    const o: Record<string, unknown> = { 客户: r.客户, 总数量: r.总数量, 总金额: r.总金额 };
    for (const t of types) { o[`${t}__q`] = r.cells[t]?.数量 ?? 0; o[`${t}__a`] = r.cells[t]?.金额 ?? 0; }
    return o;
  }), [pivot, types]);

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"塑胶类型客户统计·打开"权限）。</div></Card>;
  }

  return (
    <Card title="塑胶类型客户统计" variant="borderless">
      <Space style={{ marginBottom: 12 }} wrap>
        <Button onClick={() => jumpMonth(-1)}>上月</Button>
        <Button onClick={() => jumpMonth(0)}>本月</Button>
        <Button onClick={() => jumpMonth(1)}>下月</Button>
        <DatePicker.RangePicker value={range} allowClear={false}
          onChange={v => { if (v && v[0] && v[1]) setRange([v[0], v[1]]); }} />
        <Input.Search placeholder="客户" allowClear value={客户}
          onChange={e => set客户(e.target.value)} onSearch={load} style={{ width: 200 }} />
        <Select value="默认" disabled options={[{ value: "默认", label: "货币:默认" }]} style={{ width: 120 }} />
        <Button onClick={() => downloadCsv("塑胶类型客户统计.csv", exportCols, exportRows)}>导出EXCEL</Button>
        <Button onClick={() => printTable("塑胶类型客户统计", exportCols, exportRows)}>打印</Button>
      </Space>
      <Table rowKey="客户" size="small" loading={loading} dataSource={pivot} columns={columns}
        scroll={{ x: "max-content" }} pagination={{ pageSize: 50, showTotal: t => `共 ${t} 客户` }}
        summary={() => {
          let idx = 0;
          const cells = [<Table.Summary.Cell key="lbl" index={idx++}><b>总合计</b></Table.Summary.Cell>];
          for (const t of types) {
            cells.push(<Table.Summary.Cell key={`${t}q`} index={idx++} align="right"><b>{typeQ(t)}</b></Table.Summary.Cell>);
            if (!金额Hidden) cells.push(<Table.Summary.Cell key={`${t}a`} index={idx++} align="right"><b>{fix1(typeA(t))}</b></Table.Summary.Cell>);
          }
          cells.push(<Table.Summary.Cell key="gq" index={idx++} align="right"><b>{grandQ}</b></Table.Summary.Cell>);
          if (!金额Hidden) cells.push(<Table.Summary.Cell key="ga" index={idx++} align="right"><b>{fix1(grandA)}</b></Table.Summary.Cell>);
          return <Table.Summary fixed><Table.Summary.Row>{cells}</Table.Summary.Row></Table.Summary>;
        }} />
    </Card>
  );
}
```

- [ ] **Step 3: 路由 + 菜单**
  - `web/src/App.tsx`:加 `import PlasticCustomerTypeStatsPage from "./pages/plastics/PlasticCustomerTypeStatsPage";`;在塑胶路由附近加 `<Route path="plastic-customer-type-stats" element={<PlasticCustomerTypeStatsPage />} />`。
  - `web/src/nav/menuTree.tsx`:把 ⑨ 塑胶报表 的占位 `M("塑胶类型客户统计")` 改为 `M("塑胶类型客户统计", "/plastic-customer-type-stats", "塑胶类型客户统计")`。

- [ ] **Step 4: 测试 + 构建**

Run: `npm --prefix web run test` → 54 不减。
Run: `npm --prefix web run build` → tsc 干净 + 构建成功(注意 antd Table 列分组 children 的 align/render 泛型;若 tsc 报列类型错,最小调整类型断言,不改行为并报告)。

- [ ] **Step 5: Commit**

```powershell
git add web/src/api/plasticCustomerType.ts web/src/pages/plastics/PlasticCustomerTypeStatsPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(塑胶类型客户统计): 前端透视报表页(客户×类型列组+总合计+导出打印·金额脱敏)+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟**

重启后端(新代码,`-c Release`,`ASPNETCORE_URLS=http://127.0.0.1:5000`,env ERP_DB/ERP_JWT_KEY),待就绪。PowerShell 在 ERP_DB 种:塑胶物料单 SCT_SMK1(客户 客SMKA·日期本月·审核'1')+明细(原胶件 10/100、印喷件 5/50)、SCT_SMK2(客户 客SMKB·本月·'1')+明细(原胶件 3/30)。Node axios:admin 登录 → `GET /api/plastic-customer-type-stats?起=<本月1日>&止=<本月末>&客户=客SMK` → 含 客SMKA-原胶件(10/100)/客SMKA-印喷件(5/50)/客SMKB-原胶件(3/30) 扁平行,金额非 null(admin 有金额权限)。PowerShell 清理两单。

Expected: 客户×类型聚合正确,数量/金额对。

- [ ] **Step 2: opus 全分支终审**

派 opus 对 `feat-plastic-customer-type-stats` 全分支终审:数据源 JOIN(塑胶物料明细单×塑胶物料单)正确、按 客户×ISNULL(加工内容,'未分类') 聚合、订购数量→数量/金额→金额、审核='1'+单据日期边界(起含/止<次日)、客户过滤、HAVING 滤全零、金额脱敏(无金额权限置 null)、菜单/权限/DI(复用 PlasticMaterialDocService 注册)、前端透视(类型去重列组+客户总合计+底部总合计 colSpan/index 随金额权限变)、导出列与透视一致、日期工具栏。目标 READY TO MERGE。

- [ ] **Step 3: 合并 master**

```powershell
git checkout master
git merge --no-ff feat-plastic-customer-type-stats -m @'
Merge branch 'feat-plastic-customer-type-stats' into master

塑胶类型客户统计(客户×加工内容透视·单据日期区间·金额脱敏)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
git branch -d feat-plastic-customer-type-stats
```

- [ ] **Step 4: worklog + MEMORY** Create `docs/worklogs/2026-06-26-plastic-customer-type-stats.md`(P4 第三张);更新塑胶模块记忆。Commit。

```powershell
git add docs/worklogs/2026-06-26-plastic-customer-type-stats.md
git commit -m @'
docs(worklog): 塑胶类型客户统计 2026-06-26

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## 自审清单(已核对)

- **Spec 覆盖**:DTO+CustomerTypeStatsAsync=Task1 Step1-2;Controller+金额脱敏=Step3;菜单+种子=Step4-5;测试=Step6;前端 api/透视页/路由/菜单=Task2;冒烟/终审/合并=Task3。无遗漏。
- **类型一致**:前端 `PlasticCustomerTypeStatRow`(客户/类型/数量/金额)= 后端 DTO;`list(起,止,客户?)` = Controller `List(起,止,客户)`。
- **无占位**:全码;透视 summary 用计数器 idx 顺序发 leaf cells,随金额权限增减。
- **金额脱敏**:Controller 无「塑胶类型客户统计·金额」权限置 null;前端 `金额Hidden` 去金额列(列组/汇总/导出一致)。
- **数据源**:客户(头)/加工内容·订购数量·金额(明细);审核='1'+单据日期区间。
- **DI**:复用已注册 `PlasticMaterialDocService`(Program.cs:48);新 Controller 注入它。
