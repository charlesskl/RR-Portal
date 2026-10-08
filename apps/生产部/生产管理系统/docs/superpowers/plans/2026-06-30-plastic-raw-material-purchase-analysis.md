# 原料采购分析表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ⑪ 原料仓库「原料采购分析表」只读汇总报表——按原料编号交叉 库存(塑胶原料资料)与 生产需求(原料生产需求表·审核1),算 可购数量=生产需求+安全库存−库存。零新表。

**Architecture:** 扩 `PlasticRawMaterialMasterService` 加 `PurchaseAnalysisAsync` + 新 `PlasticRawMaterialPurchaseAnalysisController`;前端新报表页(镜像 物料发外欠数表 PlasticProcessShortagePage)。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Ant Design v6;xUnit + SkippableFact。

---

## Task 1: 后端 DTO + PurchaseAnalysisAsync + Controller + 菜单/权限

**Files:**
- Modify: `src/ErpApi/Features/Plastics/PlasticRawMaterialMaster/PlasticRawMaterialMasterDtos.cs` (末尾加 DTO)
- Modify: `src/ErpApi/Features/Plastics/PlasticRawMaterialMaster/PlasticRawMaterialMasterService.cs` (加方法)
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialPurchaseAnalysis/PlasticRawMaterialPurchaseAnalysisController.cs`
- Create: `db/seed_plastic_raw_material_purchase_analysis_perms.sql`
- Modify: `src/ErpApi/Features/Admin/MenuCatalog.cs` (原料仓库组加项)

- [ ] **Step 1: 加 DTO**

`PlasticRawMaterialMasterDtos.cs` 末尾追加:
```csharp
public sealed class PlasticRawMaterialPurchaseRow
{
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 当前库存 { get; set; }
    public decimal? 安全库存 { get; set; }
    public decimal? 生产需求 { get; set; }
    public decimal? 可购数量 { get; set; }
}
```

- [ ] **Step 2: 加 PurchaseAnalysisAsync**

`PlasticRawMaterialMasterService.cs` 在类内(ListAsync 之后)加方法(`factory` 为构造注入字段,直接用):
```csharp
    public async Task<IReadOnlyList<PlasticRawMaterialPurchaseRow>> PurchaseAnalysisAsync(
        string? 物料类别, string? keyword, bool onlyBuy)
    {
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialPurchaseRow>(@"
SELECT m.[物料编号] AS 原料编号, MAX(m.[物料名称]) AS 原料名称, MAX(m.[规格]) AS 规格,
       MAX(m.[物料类别]) AS 物料类别, MAX(m.[单位]) AS 单位,
       MAX(ISNULL(m.[库存],0)) AS 当前库存, MAX(ISNULL(m.[安全库存],0)) AS 安全库存,
       MAX(ISNULL(dm.[生产需求],0)) AS 生产需求,
       MAX(ISNULL(m.[安全库存],0)) + MAX(ISNULL(dm.[生产需求],0)) - MAX(ISNULL(m.[库存],0)) AS 可购数量
FROM [塑胶原料资料] m
LEFT JOIN (
    SELECT d.[原料编号], SUM(d.[需求数量KG]) AS 生产需求
    FROM [原料生产需求明细单] d
    JOIN [原料生产需求表] h ON h.[单号] = d.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
    GROUP BY d.[原料编号]
) dm ON dm.[原料编号] = m.[物料编号]
WHERE (@cat IS NULL OR m.[物料类别] = @cat)
  AND (@kw IS NULL OR m.[物料编号] LIKE @kw OR m.[物料名称] LIKE @kw)
GROUP BY m.[物料编号]
HAVING (@onlyBuy = 0 OR (MAX(ISNULL(m.[安全库存],0)) + MAX(ISNULL(dm.[生产需求],0)) - MAX(ISNULL(m.[库存],0))) > 0)
ORDER BY m.[物料编号]", new { cat, kw, onlyBuy = onlyBuy ? 1 : 0 });
        return rows.AsList();
    }
```

- [ ] **Step 3: 新 Controller**

`src/ErpApi/Features/Plastics/PlasticRawMaterialPurchaseAnalysis/PlasticRawMaterialPurchaseAnalysisController.cs`:
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Plastics.PlasticRawMaterialMaster;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticRawMaterialPurchaseAnalysis;

[ApiController]
[Authorize]
[Route("api/plastic-raw-material-purchase-analysis")]
public sealed class PlasticRawMaterialPurchaseAnalysisController(
    PlasticRawMaterialMasterService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "原料采购分析表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List([FromQuery(Name = "物料类别")] string? 物料类别 = null,
        string? keyword = null, bool onlyBuy = false)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.PurchaseAnalysisAsync(物料类别, keyword, onlyBuy));
    }
}
```

- [ ] **Step 4: 菜单 + 权限种子**

`MenuCatalog.cs` 在 `new("原料仓库","原料生产需求表"),` 之后加:
```csharp
        new("原料仓库","原料采购分析表"),
```

`db/seed_plastic_raw_material_purchase_analysis_perms.sql`（**先 `ls db/ | grep purchase_analysis` 确认未占用**）:
```sql
-- 开发用:给 admin 授予 原料采购分析表 菜单 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] = N'原料采购分析表';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'原料采购分析表',1,1,1,1,1,1,1,1,1);
```
应用两库(localdb 停止态先 `SqlLocalDB start MSSQLLocalDB`,再 `SqlLocalDB info` 取 `np:\\.\pipe\...`)。

- [ ] **Step 5: 编译**

Run: `dotnet build src/ErpApi/ErpApi.csproj -c Debug` → Build succeeded(0 错误)。DI 复用已注册 `PlasticRawMaterialMasterService`(无需新增)。

- [ ] **Step 6: Commit**
```bash
git add src/ErpApi/Features/Plastics/PlasticRawMaterialMaster/ src/ErpApi/Features/Plastics/PlasticRawMaterialPurchaseAnalysis/ src/ErpApi/Features/Admin/MenuCatalog.cs db/seed_plastic_raw_material_purchase_analysis_perms.sql
git commit -m "feat(原料采购分析表): 后端DTO+PurchaseAnalysisAsync+Controller+菜单权限"
```

---

## Task 2: 后端 DB 测试

**Files:**
- Create: `tests/ErpApi.Tests/PlasticRawMaterialPurchaseAnalysisServiceDbTests.cs`

- [ ] **Step 1: 写测试**

```csharp
using Dapper;
using ErpApi.Features.Plastics.PlasticRawMaterialMaster;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialPurchaseAnalysisServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticRawMaterialMasterService Svc() => new(Factory());

    private static void Seed(SqlConnection c)
    {
        Clean(c);
        // 缺料原料:库存10/安全库存5/需求8 → 可购=8+5-10=3
        c.Execute("INSERT INTO [塑胶原料资料]([物料类别],[物料编号],[物料名称],[规格],[单位],[库存],[安全库存]) VALUES(N'ABS',N'RA-PA',N'ABS粒',N'规X',N'kg',10,5)");
        // 充足原料:库存100/安全5/需求8 → 可购=8+5-100=-87 (onlyBuy 排除)
        c.Execute("INSERT INTO [塑胶原料资料]([物料类别],[物料编号],[物料名称],[规格],[单位],[库存],[安全库存]) VALUES(N'ABS',N'RA-PB',N'ABS足',N'规Y',N'kg',100,5)");
        c.Execute("INSERT INTO [原料生产需求表]([单号],[审核]) VALUES(N'YLX-PA-1','1')");
        c.Execute("INSERT INTO [原料生产需求明细单]([单号],[原料编号],[需求数量KG],[需求数量包]) VALUES(N'YLX-PA-1',N'RA-PA',8,1)");
        c.Execute("INSERT INTO [原料生产需求明细单]([单号],[原料编号],[需求数量KG],[需求数量包]) VALUES(N'YLX-PA-1',N'RA-PB',8,1)");
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [原料生产需求明细单] WHERE [单号]=N'YLX-PA-1'");
        c.Execute("DELETE FROM [原料生产需求表] WHERE [单号]=N'YLX-PA-1'");
        c.Execute("DELETE FROM [塑胶原料资料] WHERE [物料编号] IN (N'RA-PA',N'RA-PB')");
    }

    [SkippableFact]
    public async Task Analysis_computes_可购数量_with_safety_stock()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var r = Assert.Single((await Svc().PurchaseAnalysisAsync("ABS", "RA-PA", false)).Where(x => x.原料编号 == "RA-PA"));
            Assert.Equal(8m, r.生产需求);
            Assert.Equal(10m, r.当前库存);
            Assert.Equal(5m, r.安全库存);
            Assert.Equal(3m, r.可购数量); // 8+5-10
            Assert.Equal("ABS", r.物料类别);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Analysis_filters_onlyBuy_and_category()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            // onlyBuy: RA-PA(可购3>0)含, RA-PB(可购-87)排除
            var buy = await Svc().PurchaseAnalysisAsync(null, null, true);
            Assert.Contains(buy, x => x.原料编号 == "RA-PA");
            Assert.DoesNotContain(buy, x => x.原料编号 == "RA-PB");
            // 物料类别不命中
            Assert.DoesNotContain(await Svc().PurchaseAnalysisAsync("不存在", null, false), x => x.原料编号 == "RA-PA");
            // 不过滤含两者
            var all = await Svc().PurchaseAnalysisAsync(null, "RA-P", false);
            Assert.Contains(all, x => x.原料编号 == "RA-PA");
            Assert.Contains(all, x => x.原料编号 == "RA-PB");
        }
        finally { Clean(c); }
    }
}
```
注:`DbFixture`/`fx.Open()` 用法以 `PlasticRawMaterialMasterDbTests.cs` 为准。表无 FK,种子不种父行。

- [ ] **Step 2: 跑本测试** → `dotnet test ... --filter "FullyQualifiedName~PlasticRawMaterialPurchaseAnalysis"`(2 passed)。
- [ ] **Step 3: 全量** → `dotnet test ...`(407→409)。
- [ ] **Step 4: Commit**
```bash
git add tests/ErpApi.Tests/PlasticRawMaterialPurchaseAnalysisServiceDbTests.cs
git commit -m "test(原料采购分析表): 可购=需求+安全库存-库存 + onlyBuy/类别过滤"
```

---

## Task 3: 前端 api + Page + 路由 + 菜单

**Files:**
- Create: `web/src/api/plasticRawMaterialPurchaseAnalysis.ts`
- Create: `web/src/pages/plastics/PlasticRawMaterialPurchaseAnalysisPage.tsx`
- Modify: `web/src/App.tsx` (import + route)
- Modify: `web/src/nav/menuTree.tsx` (`M("原料采购分析表")` → 带路由)

- [ ] **Step 1: api 客户端**

`web/src/api/plasticRawMaterialPurchaseAnalysis.ts`:
```ts
import { api } from "./client";
export interface PlasticRawMaterialPurchaseRow {
  原料编号?: string; 原料名称?: string; 规格?: string; 物料类别?: string; 单位?: string;
  当前库存?: number | null; 安全库存?: number | null; 生产需求?: number | null; 可购数量?: number | null;
}
export interface PlasticRawMaterialPurchaseParams { 物料类别?: string; keyword?: string; onlyBuy?: boolean }
export const plasticRawMaterialPurchaseAnalysisApi = {
  list: (p: PlasticRawMaterialPurchaseParams) =>
    api.get<PlasticRawMaterialPurchaseRow[]>("/plastic-raw-material-purchase-analysis", { params: p }).then(r => r.data),
};
```

- [ ] **Step 2: 报表页**(镜像 PlasticProcessShortagePage·物料类别 Select 用 plasticRawMaterialMasterApi.categories·只看可购)

`web/src/pages/plastics/PlasticRawMaterialPurchaseAnalysisPage.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Checkbox, Input, Select, Space, Table, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { plasticRawMaterialPurchaseAnalysisApi, type PlasticRawMaterialPurchaseRow } from "../../api/plasticRawMaterialPurchaseAnalysis";
import { plasticRawMaterialMasterApi, type PlasticRawMaterialCategoryNode } from "../../api/plasticRawMaterialMaster";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import { downloadCsv, printTable, type ExportCol } from "../../utils/tableExport";

const MENU = "原料采购分析表";

export default function PlasticRawMaterialPurchaseAnalysisPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const [cats, setCats] = useState<PlasticRawMaterialCategoryNode[]>([]);
  const [cat, setCat] = useState("");
  const [keyword, setKeyword] = useState("");
  const [onlyBuy, setOnlyBuy] = useState(false);
  const [rows, setRows] = useState<PlasticRawMaterialPurchaseRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (canOpen) plasticRawMaterialMasterApi.categories().then(setCats).catch(() => { /* 取类别失败不阻塞 */ });
  }, [canOpen]);

  const load = useCallback(async () => {
    if (!canOpen) return;
    setLoading(true);
    try {
      setRows(await plasticRawMaterialPurchaseAnalysisApi.list({
        物料类别: cat || undefined, keyword: keyword || undefined, onlyBuy,
      }));
    } catch { message.error("加载原料采购分析表失败"); }
    finally { setLoading(false); }
  }, [canOpen, cat, keyword, onlyBuy]);
  useEffect(() => { load(); }, [canOpen, cat, onlyBuy]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns: ColumnsType<PlasticRawMaterialPurchaseRow> = [
    { title: "原料编号", dataIndex: "原料编号", width: 120 },
    { title: "原料名称", dataIndex: "原料名称", width: 160 },
    { title: "规格", dataIndex: "规格", width: 100 },
    { title: "物料类别", dataIndex: "物料类别", width: 100 },
    { title: "单位", dataIndex: "单位", width: 60 },
    { title: "当前库存", dataIndex: "当前库存", width: 100, align: "right" as const },
    { title: "安全库存", dataIndex: "安全库存", width: 100, align: "right" as const },
    { title: "生产需求(KG)", dataIndex: "生产需求", width: 120, align: "right" as const },
    { title: "可购数量", dataIndex: "可购数量", width: 110, align: "right" as const,
      render: (v?: number | null) => <span style={{ color: Number(v) > 0 ? "#cf1322" : undefined }}>{v ?? ""}</span> },
  ];

  const exportCols: ExportCol[] = [
    { title: "原料编号", key: "原料编号" }, { title: "原料名称", key: "原料名称" }, { title: "规格", key: "规格" },
    { title: "物料类别", key: "物料类别" }, { title: "单位", key: "单位" },
    { title: "当前库存", key: "当前库存" }, { title: "安全库存", key: "安全库存" },
    { title: "生产需求(KG)", key: "生产需求" }, { title: "可购数量", key: "可购数量" },
  ];
  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"原料采购分析表·打开"权限）。</div></Card>;
  }

  return (
    <Card title="原料采购分析表" variant="borderless">
      <Space style={{ marginBottom: 12 }} wrap>
        <Select value={cat} onChange={setCat} style={{ width: 160 }}
          options={[{ value: "", label: "全部类别" }, ...cats.filter(x => x.类别).map(x => ({ value: x.类别!, label: `${x.类别}(${x.数量})` }))]} />
        <Input.Search placeholder="原料编号/名称" allowClear value={keyword}
          onChange={e => setKeyword(e.target.value)} onSearch={load} style={{ width: 220 }} />
        <Checkbox checked={onlyBuy} onChange={e => setOnlyBuy(e.target.checked)}>只看可购</Checkbox>
        <Button onClick={() => downloadCsv("原料采购分析表.csv", exportCols, asRecords())}>导出EXCEL</Button>
        <Button onClick={() => printTable("原料采购分析表", exportCols, asRecords())}>打印</Button>
        <span style={{ color: "#888" }}>共 {rows.length} 条</span>
      </Space>
      <Table rowKey={(_, i) => String(i)} size="small" loading={loading} dataSource={rows} columns={columns}
        scroll={{ x: "max-content" }} pagination={{ pageSize: 50, showTotal: t => `共 ${t} 条` }} />
    </Card>
  );
}
```

- [ ] **Step 3: 路由 + 菜单**

`App.tsx`:import `PlasticRawMaterialPurchaseAnalysisPage`;在 `plastic-raw-material-demand` 路由附近加 `<Route path="plastic-raw-material-purchase-analysis" element={<PlasticRawMaterialPurchaseAnalysisPage />} />`。

`menuTree.tsx`:`M("原料采购分析表"),` → `M("原料采购分析表", "/plastic-raw-material-purchase-analysis", "原料采购分析表"),`。

- [ ] **Step 4: 类型检查 + 测试** → `cd web && npx tsc --noEmit`(0)；`npx vitest run`(54)。
- [ ] **Step 5: Commit**
```bash
git add web/src/api/plasticRawMaterialPurchaseAnalysis.ts web/src/pages/plastics/PlasticRawMaterialPurchaseAnalysisPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m "feat(原料采购分析表): 前端 api+报表页+路由+菜单"
```

---

## Task 4: HTTP 冒烟 + 终审 + 合并

- [ ] **Step 1: Release 编译**(锁先按 PID Stop-Process)+ 起后端 `--contentRoot 输出目录`。
- [ ] **Step 2: 冒烟**:种 塑胶原料资料(库存10/安全5)+ 原料生产需求(审核1·需求8)→ `GET /api/plastic-raw-material-purchase-analysis?onlyBuy=true&keyword=` 验 生产需求8/当前库存10/安全库存5/可购数量3;物料类别过滤;库存充足项被 onlyBuy 排除。清理种子。
- [ ] **Step 3: opus 终审**:全分支 diff·验 ① dm 子查询先聚合(原料生产需求明细·审核1·按原料编号 SUM)不放大·外层 GROUP BY 物料编号;② 可购数量=安全库存+生产需求−库存·HAVING onlyBuy;③ 物料类别/keyword 过滤;④ 菜单/权限(**种子文件名未撞**)/DI 复用/路由/menuTree 齐;⑤ 前端 可购>0 红色·只看可购·物料类别下拉·导出;⑥ DTO↔SQL↔前端一致;⑦ 全参数化·未动既有(PlasticRawMaterialMaster 既有方法/原料生产需求表)。READY 才合并。
- [ ] **Step 4: 合并 + 收尾**:`--no-ff` 合并 master,删分支;worklog `docs/worklogs/2026-06-30-plastic-raw-material-purchase-analysis.md`;更新 MEMORY。
