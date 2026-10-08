# 原料本月库存汇总 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按原料名称(=塑胶物料名称)汇总 本月库存(当前实时)/存外厂数量(恒0·无源)/本月报废(区间内)/本月总数(=库存+报废),纯数量无金额无重量。

**Architecture:** 复用 `PlasticInventoryService.LedgerUnion`(实时库存)。新方法两子查询 FULL OUTER JOIN:库存(LedgerUnion 按物料名称求和)+ 本月报废(塑胶报废明细单 JOIN 单头·审核+单据日期区间)。新独立 Controller(菜单 原料本月库存汇总)。前端新页复用日期工具栏 + tableExport。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + Ant Design v6 + dayjs + Vitest。

---

## 前置约定

- 工作目录 `D:\WebpageERP`,分支 `feat-plastic-raw-material-summary`,完成 `--no-ff` 合并 master 删分支。PowerShell;`dotnet` 不在 PATH:`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 测试 env 从 User 取:`$env:ERP_TEST_DB`/`$env:ERP_JWT_KEY`/`$env:ERP_DB`。后端 `dotnet test`(锁 DLL 用 `-c Release`)。前端 `npm --prefix web run test`/`build`。
- 提交末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 镜像源:`src/ErpApi/Engines/Inventory/PlasticInventoryService.cs`(LedgerUnion 在该类内·新方法同类内可用)、`src/ErpApi/Features/Plastics/PlasticInOut/PlasticInOutController.cs`(报表 Controller 范式)、`web/src/pages/plastics/PlasticInOutReportPage.tsx`(日期工具栏)、`web/src/utils/tableExport.ts`。
- `塑胶报废明细单` 有 物料名称/数量;`塑胶报废单` 有 日期/审核。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `src/ErpApi/Engines/Inventory/PlasticInventoryService.cs` | DTO + RawMaterialMonthlySummaryAsync | 改 |
| `src/ErpApi/Features/Plastics/PlasticRawMaterial/PlasticRawMaterialController.cs` | 报表端点 | 新建 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加菜单 | 改 |
| `db/seed_plastic_raw_material_perms.sql` | admin 授权 | 新建 |
| `tests/ErpApi.Tests/PlasticRawMaterialSummaryServiceDbTests.cs` | 汇总测试 | 新建 |
| `web/src/api/plasticRawMaterial.ts` | typed API | 新建 |
| `web/src/pages/plastics/PlasticRawMaterialSummaryPage.tsx` | 报表页 | 新建 |
| `web/src/App.tsx` | 路由 | 改 |
| `web/src/nav/menuTree.tsx` | 填菜单 | 改 |

---

## Task 1: 后端 汇总 + Controller + 菜单 + 种子 + 测试

**Files:** Modify `PlasticInventoryService.cs`, `MenuCatalog.cs`; Create `PlasticRawMaterialController.cs`, `db/seed_plastic_raw_material_perms.sql`, `tests/ErpApi.Tests/PlasticRawMaterialSummaryServiceDbTests.cs`

- [ ] **Step 1: DTO** 在 `src/ErpApi/Engines/Inventory/PlasticInventoryService.cs`,在 `PlasticInOutRow` 类之后、`public sealed class PlasticInventoryService` 之前加:

```csharp
public sealed class PlasticRawMaterialSummaryRow
{
    public string? 原料名称 { get; set; }
    public decimal 本月库存 { get; set; }
    public decimal 存外厂数量 { get; set; }
    public decimal 本月报废 { get; set; }
    public decimal 本月总数 { get; set; }
}
```

- [ ] **Step 2: 方法** 在 `PlasticInventoryService` 类内追加(任一方法之后):

```csharp
    // 原料本月库存汇总:按物料名称 当前实时库存 + 本月报废(区间)。存外厂无源恒0;本月总数=库存+报废。
    public async Task<IReadOnlyList<PlasticRawMaterialSummaryRow>> RawMaterialMonthlySummaryAsync(DateTime 起, DateTime 止, string? keyword)
    {
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var sql = $@"
WITH 库存 AS (
    SELECT [物料名称], SUM([数量]) AS 本月库存
    FROM ({LedgerUnion}) t
    GROUP BY [物料名称]
),
报废 AS (
    SELECT d.[物料名称], SUM(ISNULL(d.[数量],0)) AS 本月报废
    FROM [塑胶报废明细单] d JOIN [塑胶报废单] h ON h.[单号]=d.[单号]
    WHERE ISNULL(h.[审核],'0')='1' AND h.[日期] >= @qi AND h.[日期] < @qe
    GROUP BY d.[物料名称]
)
SELECT ISNULL(k.[物料名称], s.[物料名称]) AS 原料名称,
       ISNULL(k.[本月库存],0) AS 本月库存,
       CAST(0 AS decimal(18,4)) AS 存外厂数量,
       ISNULL(s.[本月报废],0) AS 本月报废,
       ISNULL(k.[本月库存],0) + ISNULL(s.[本月报废],0) AS 本月总数
FROM 库存 k
FULL OUTER JOIN 报废 s ON s.[物料名称] = k.[物料名称]
WHERE (@kw IS NULL OR ISNULL(k.[物料名称], s.[物料名称]) LIKE @kw)
  AND (ISNULL(k.[本月库存],0) <> 0 OR ISNULL(s.[本月报废],0) <> 0)
ORDER BY 原料名称";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialSummaryRow>(sql, new { qi, qe, kw });
        return rows.AsList();
    }
```

- [ ] **Step 3: Controller** Create `src/ErpApi/Features/Plastics/PlasticRawMaterial/PlasticRawMaterialController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticRawMaterial;

[ApiController]
[Authorize]
[Route("api/plastic-raw-material-summary")]
public sealed class PlasticRawMaterialController(
    PlasticInventoryService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "原料本月库存汇总";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(DateTime 起, DateTime 止, string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.RawMaterialMonthlySummaryAsync(起, 止, keyword));
    }
}
```

- [ ] **Step 4: MenuCatalog** 在 `src/ErpApi/Features/Admin/MenuCatalog.cs` 的 `new("塑胶报表","塑胶类型客户统计"),` 之后加:

```csharp
        new("塑胶报表","原料本月库存汇总"),
```

- [ ] **Step 5: 种子** Create `db/seed_plastic_raw_material_perms.sql`:

```sql
-- 开发用:给 admin 授予 原料本月库存汇总 菜单 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] = N'原料本月库存汇总';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'原料本月库存汇总',1,1,1,1,1,1,1,1,1);
```
应用两库(PowerShell):
```powershell
foreach ($V in "ERP_DB","ERP_TEST_DB") {
  $cs = [Environment]::GetEnvironmentVariable($V,"User"); $c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
  $cmd = $c.CreateCommand(); $cmd.CommandText = [IO.File]::ReadAllText((Resolve-Path "db/seed_plastic_raw_material_perms.sql")); $null = $cmd.ExecuteNonQuery(); $c.Close(); Write-Output "$V ok"
}
```
Expected: ERP_DB ok 和 ERP_TEST_DB ok。

- [ ] **Step 6: 测试** Create `tests/ErpApi.Tests/PlasticRawMaterialSummaryServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialSummaryServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticInventoryService Svc() => new(Factory());

    [SkippableFact]
    public async Task RawMaterialSummary_current_stock_plus_period_scrap()
    {
        using var c = fx.Open();
        var engine = new PostingEngine(Factory(), new AuditLogger());
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料名称]=N'RAWNAME'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'RAW_R1'");
            c.Execute("DELETE FROM [塑胶报废明细单] WHERE [物料名称]=N'RAWNAME'; DELETE FROM [塑胶报废单] WHERE [单号] IN (N'RAW_B1',N'RAW_B0')");
        }
        Clean();
        // 入仓 100(物料名 RAWNAME)
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[仓库],[审核]) VALUES(N'RAW_R1','2026-06-05',N'原料仓','0')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'RAW_R1',N'原料仓',N'RAWPM01',N'RAWNAME',N'kg',100)");
        // 本月报废 20
        c.Execute("INSERT INTO [塑胶报废单]([单号],[日期],[仓库],[审核]) VALUES(N'RAW_B1','2026-06-12',N'原料仓','0')");
        c.Execute("INSERT INTO [塑胶报废明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'RAW_B1',N'原料仓',N'RAWPM01',N'RAWNAME',N'kg',20)");
        // 上月报废 7(区间外·不计本月报废,但计入库存扣减)
        c.Execute("INSERT INTO [塑胶报废单]([单号],[日期],[仓库],[审核]) VALUES(N'RAW_B0','2026-05-10',N'原料仓','0')");
        c.Execute("INSERT INTO [塑胶报废明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量]) VALUES(N'RAW_B0',N'原料仓',N'RAWPM01',N'RAWNAME',N'kg',7)");
        try
        {
            await engine.ApproveAsync("塑胶入仓单", "RAW_R1", "t");
            await engine.ApproveAsync("塑胶报废单", "RAW_B1", "t");
            await engine.ApproveAsync("塑胶报废单", "RAW_B0", "t");
            var rows = await Svc().RawMaterialMonthlySummaryAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), "RAWNAME");
            var r = Assert.Single(rows, x => x.原料名称 == "RAWNAME");
            // 当前实时库存 = 入100 − 报废20(本月) − 报废7(上月) = 73
            Assert.Equal(73m, r.本月库存);
            Assert.Equal(0m, r.存外厂数量);
            Assert.Equal(20m, r.本月报废);                 // 仅本月报废
            Assert.Equal(93m, r.本月总数);                 // 73 + 20
        }
        finally { Clean(); }
    }
}
```

- [ ] **Step 7: 跑测试 + 全量回归**

Run: `dotnet test --filter "FullyQualifiedName~PlasticRawMaterialSummaryServiceDbTests"` → PASS。
Run: `dotnet test` → 全绿(364 → 365)。报告总数行。

- [ ] **Step 8: Commit**

```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticRawMaterialSummaryServiceDbTests.cs db/seed_plastic_raw_material_perms.sql
git commit -m @'
feat(原料本月库存汇总): RawMaterialMonthlySummaryAsync(库存+本月报废·存外厂0)+Controller+菜单+种子+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 报表页 + API + 路由 + 菜单

**Files:** Create `web/src/api/plasticRawMaterial.ts`, `web/src/pages/plastics/PlasticRawMaterialSummaryPage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: API** `web/src/api/plasticRawMaterial.ts`:

```typescript
import { api } from "./client";

export interface PlasticRawMaterialSummaryRow {
  原料名称?: string; 本月库存: number; 存外厂数量: number; 本月报废: number; 本月总数: number;
}
export const plasticRawMaterialApi = {
  list: (起: string, 止: string, keyword?: string) =>
    api.get<PlasticRawMaterialSummaryRow[]>("/plastic-raw-material-summary", { params: { 起, 止, keyword } }).then(r => r.data),
};
```

- [ ] **Step 2: 页面** `web/src/pages/plastics/PlasticRawMaterialSummaryPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, DatePicker, Input, Space, Table, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { plasticRawMaterialApi, type PlasticRawMaterialSummaryRow } from "../../api/plasticRawMaterial";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import { downloadCsv, printTable, type ExportCol } from "../../utils/tableExport";

const MENU = "原料本月库存汇总";
const thisMonth = (): [Dayjs, Dayjs] => [dayjs().startOf("month"), dayjs().endOf("month")];

export default function PlasticRawMaterialSummaryPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const [range, setRange] = useState<[Dayjs, Dayjs]>(thisMonth);
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<PlasticRawMaterialSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!canOpen) return;
    setLoading(true);
    try {
      setRows(await plasticRawMaterialApi.list(
        range[0].format("YYYY-MM-DD"), range[1].format("YYYY-MM-DD"), keyword || undefined));
    } catch { message.error("加载原料本月库存汇总失败"); }
    finally { setLoading(false); }
  }, [canOpen, range, keyword]);
  useEffect(() => { load(); }, [load]);

  const jumpMonth = (offset: number) => {
    const base = dayjs().add(offset, "month");
    setRange([base.startOf("month"), base.endOf("month")]);
  };

  const columns = [
    { title: "原料名称", dataIndex: "原料名称", width: 240 },
    { title: "本月库存", dataIndex: "本月库存", width: 120, align: "right" as const,
      render: (v: number) => <span style={{ color: v < 0 ? "#cf1322" : undefined }}>{v}</span> },
    { title: "存外厂数量", dataIndex: "存外厂数量", width: 120, align: "right" as const },
    { title: "本月报废", dataIndex: "本月报废", width: 120, align: "right" as const,
      render: (v: number) => <span style={{ color: v > 0 ? "#cf1322" : undefined }}>{v}</span> },
    { title: "本月总数", dataIndex: "本月总数", width: 120, align: "right" as const,
      render: (v: number) => <span style={{ fontWeight: 600 }}>{v}</span> },
  ];

  const sum = (k: keyof PlasticRawMaterialSummaryRow) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const exportCols: ExportCol[] = [
    { title: "原料名称", key: "原料名称" }, { title: "本月库存", key: "本月库存" },
    { title: "存外厂数量", key: "存外厂数量" }, { title: "本月报废", key: "本月报废" }, { title: "本月总数", key: "本月总数" },
  ];
  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"原料本月库存汇总·打开"权限）。</div></Card>;
  }

  return (
    <Card title="原料本月库存汇总" variant="borderless">
      <Space style={{ marginBottom: 12 }} wrap>
        <Button onClick={() => jumpMonth(-1)}>上月</Button>
        <Button onClick={() => jumpMonth(0)}>本月</Button>
        <Button onClick={() => jumpMonth(1)}>下月</Button>
        <DatePicker.RangePicker value={range} allowClear={false}
          onChange={v => { if (v && v[0] && v[1]) setRange([v[0], v[1]]); }} />
        <Input.Search placeholder="原料名称" allowClear value={keyword}
          onChange={e => setKeyword(e.target.value)} onSearch={load} style={{ width: 220 }} />
        <Button onClick={() => downloadCsv("原料本月库存汇总.csv", exportCols, asRecords())}>导出EXCEL</Button>
        <Button onClick={() => printTable("原料本月库存汇总", exportCols, asRecords())}>打印</Button>
      </Space>
      <Table rowKey={(_, i) => String(i)} size="small" loading={loading} dataSource={rows} columns={columns}
        scroll={{ x: "max-content" }} pagination={{ pageSize: 50, showTotal: t => `共 ${t} 条` }}
        summary={() => (
          <Table.Summary fixed>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}><b>合计</b></Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right"><b>{sum("本月库存")}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right"><b>{sum("存外厂数量")}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right"><b>{sum("本月报废")}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right"><b>{sum("本月总数")}</b></Table.Summary.Cell>
            </Table.Summary.Row>
          </Table.Summary>
        )} />
    </Card>
  );
}
```

- [ ] **Step 3: 路由 + 菜单**
  - `web/src/App.tsx`:加 `import PlasticRawMaterialSummaryPage from "./pages/plastics/PlasticRawMaterialSummaryPage";`;在塑胶路由附近加 `<Route path="plastic-raw-material-summary" element={<PlasticRawMaterialSummaryPage />} />`。
  - `web/src/nav/menuTree.tsx`:把 ⑨ 塑胶报表 的占位 `M("原料本月库存汇总")` 改为 `M("原料本月库存汇总", "/plastic-raw-material-summary", "原料本月库存汇总")`。

- [ ] **Step 4: 测试 + 构建**

Run: `npm --prefix web run test` → 54 不减。
Run: `npm --prefix web run build` → tsc 干净 + 构建成功。

- [ ] **Step 5: Commit**

```powershell
git add web/src/api/plasticRawMaterial.ts web/src/pages/plastics/PlasticRawMaterialSummaryPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(原料本月库存汇总): 前端报表页(日期工具栏+库存/存外厂/报废/总数+导出打印+汇总)+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟**

重启后端(新代码,`-c Release`,`ASPNETCORE_URLS=http://127.0.0.1:5000`,env ERP_DB/ERP_JWT_KEY),待就绪。PowerShell 在 ERP_DB 种:塑胶入仓单 RAW_SMK(物料名 RAWSMK·100·审核'0')+ 塑胶报废单 RAWB_SMK(本月·20·'0')。Node axios:admin 登录 → approve 两单 → `GET /api/plastic-raw-material-summary?起=<本月1日>&止=<本月末>&keyword=RAWSMK` → 本月库存=80、存外厂数量=0、本月报废=20、本月总数=100。清理(PowerShell 删两单)。

Expected: 库存=80(入100−报废20)、本月报废=20、本月总数=100、存外厂=0。

- [ ] **Step 2: opus 全分支终审**

派 opus 对 `feat-plastic-raw-material-summary` 全分支终审:LedgerUnion(现有)未动、库存 CTE 按物料名称聚合(=当前实时库存含全部报废扣减)、报废 CTE 审核='1'+单据日期区间、FULL OUTER JOIN(库存有/报废无 或 反之 都出行)、存外厂恒0、本月总数=库存+报废、keyword 过滤名称、HAVING 滤全零、菜单/权限/DI、前端字段一致、汇总 5 列对齐、日期工具栏。目标 READY TO MERGE。

- [ ] **Step 3: 合并 master**

```powershell
git checkout master
git merge --no-ff feat-plastic-raw-material-summary -m @'
Merge branch 'feat-plastic-raw-material-summary' into master

原料本月库存汇总(物料名称·当前库存+本月报废·存外厂无源置0)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
git branch -d feat-plastic-raw-material-summary
```

- [ ] **Step 4: worklog + MEMORY** Create `docs/worklogs/2026-06-26-plastic-raw-material-summary.md`(P4 第四张·记数据源缺口 存外厂/重量 务实处理);更新塑胶模块记忆。Commit。

```powershell
git add docs/worklogs/2026-06-26-plastic-raw-material-summary.md
git commit -m @'
docs(worklog): 原料本月库存汇总 2026-06-26

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## 自审清单(已核对)

- **Spec 覆盖**:DTO+RawMaterialMonthlySummaryAsync=Task1 Step1-2;Controller+菜单+种子=Step3-5;测试=Step6;前端 api/页/路由/菜单=Task2;冒烟/终审/合并=Task3。无遗漏。
- **类型一致**:前端 `PlasticRawMaterialSummaryRow`(原料名称/本月库存/存外厂数量/本月报废/本月总数)= 后端 DTO;`list(起,止,keyword?)` = Controller `List(起,止,keyword)`。
- **库存不变**:`LedgerUnion` 未动(只在新方法 CTE 内 `FROM (${LedgerUnion}) t`)。
- **口径**:本月库存=当前实时(LedgerUnion 净额·含全部报废扣减);本月报废=区间内单列;本月总数=库存+报废;存外厂=0。
- **无占位**:全码;汇总 5 列 index 0-4 对齐。
- **测试边界**:验 当前库存=入100−本月报废20−上月报废7=73、本月报废=20(仅本月)、本月总数=93。
