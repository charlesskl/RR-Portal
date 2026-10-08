# 物料发外欠数表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ⑩ 发外加工「物料发外欠数表」只读汇总报表——欠数=加工采购订购−加工入仓,按 物料编号+模具编号 汇总,金额脱敏。零新表。

**Architecture:** 扩 `PlasticProcessPurchaseOrderService` 加 `ShortageAsync`(GROUP BY 物料编号+模具编号·SUM(订购−入仓)=欠数)+ 新 `PlasticProcessShortageController`;前端新报表页(物料类别 Select + 审核情况 Select + 只看欠数)。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Ant Design v6;xUnit + SkippableFact。

---

## Task 1: 后端 DTO + ShortageAsync + Controller + 菜单/权限

**Files:**
- Modify: `src/ErpApi/Features/Plastics/PlasticProcessPurchaseOrder/PlasticProcessPurchaseOrderDtos.cs` (末尾加 DTO)
- Modify: `src/ErpApi/Features/Plastics/PlasticProcessPurchaseOrder/PlasticProcessPurchaseOrderService.cs` (加 ShortageAsync)
- Create: `src/ErpApi/Features/Plastics/PlasticProcessShortage/PlasticProcessShortageController.cs`
- Create: `db/seed_plastic_process_shortage_perms.sql`
- Modify: `src/ErpApi/Features/Admin/MenuCatalog.cs` (发外加工组加项)

- [ ] **Step 1: 加 DTO**

`PlasticProcessPurchaseOrderDtos.cs` 末尾追加:
```csharp
public sealed class PlasticProcessShortageRow
{
    public string? 物料编号 { get; set; }
    public string? 共用物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 共用物料 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 欠数 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
```

- [ ] **Step 2: 加 ShortageAsync**

`PlasticProcessPurchaseOrderService.cs` 在类内(`IssueProgressAsync` 之后、`DeleteAsync` 之前)加方法。**注意:不要调用现有 `ApprovalFilter`(它写死别名 `h.`),本查询订购头别名为 `o.`,用内联 switch 生成审核过滤片段:**
```csharp
    public async Task<IReadOnlyList<PlasticProcessShortageRow>> ShortageAsync(
        string? 物料类别, string? 审核情况, string? keyword, bool onlyOwed)
    {
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var appr = 审核情况 switch
        {
            "已审核" => " AND ISNULL(o.[审核],'0')='1'",
            "未审核" => " AND ISNULL(o.[审核],'0')<>'1'",
            _ => "",
        };
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticProcessShortageRow>($@"
SELECT d.[物料编号], MAX(cm.[共用原料编号]) AS 共用物料编号, MAX(d.[物料名称]) AS 物料名称,
       d.[模具编号], MAX(cn.[物料名称]) AS 共用物料, MAX(m.[物料类别]) AS 物料类别, MAX(m.[单位]) AS 单位,
       SUM(d.[数量] - ISNULL(rk.[入仓数量],0)) AS 欠数,
       MAX(d.[单价]) AS 单价,
       SUM((d.[数量] - ISNULL(rk.[入仓数量],0)) * ISNULL(d.[单价],0)) AS 金额
FROM [塑胶加工采购单明细] d
JOIN [塑胶加工采购单] o ON o.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位, MAX([物料类别]) AS 物料类别, MAX([物料名称]) AS 物料名称 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([共用原料编号]) AS 共用原料编号 FROM [塑胶共用物料表] GROUP BY [物料编号]) cm ON cm.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([物料名称]) AS 物料名称 FROM [塑胶物料资料] GROUP BY [物料编号]) cn ON cn.[物料编号] = cm.[共用原料编号]
LEFT JOIN (
    SELECT r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键, SUM(r.[数量]) AS 入仓数量
    FROM [塑胶入仓明细单] r
    JOIN [塑胶入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
    GROUP BY r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'')
) rk ON rk.[生产单号] = d.[生产单号] AND rk.[物料编号] = d.[物料编号] AND rk.[颜色键] = ISNULL(d.[颜色],'')
WHERE (@cat IS NULL OR m.[物料类别] = @cat)
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw){appr}
GROUP BY d.[物料编号], d.[模具编号]
HAVING (@onlyOwed = 0 OR SUM(d.[数量] - ISNULL(rk.[入仓数量],0)) > 0)
ORDER BY d.[物料编号]", new { cat, kw, onlyOwed = onlyOwed ? 1 : 0 });
        return rows.AsList();
    }
```

- [ ] **Step 3: 新 Controller**

`src/ErpApi/Features/Plastics/PlasticProcessShortage/PlasticProcessShortageController.cs`:
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Plastics.PlasticProcessPurchaseOrder;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticProcessShortage;

[ApiController]
[Authorize]
[Route("api/plastic-process-shortage")]
public sealed class PlasticProcessShortageController(
    PlasticProcessPurchaseOrderService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "物料发外欠数表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List([FromQuery(Name = "物料类别")] string? 物料类别 = null,
        [FromQuery(Name = "审核情况")] string? 审核情况 = null, string? keyword = null, bool onlyOwed = false)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.ShortageAsync(物料类别, 审核情况, keyword, onlyOwed);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.单价))
            foreach (var r in rows) { r.单价 = null; r.金额 = null; }
        return Ok(rows);
    }
}
```

- [ ] **Step 4: 菜单 + 权限种子**

`MenuCatalog.cs` 在 `new("发外加工","加工领料进度表"),` 之后加:
```csharp
        new("发外加工","物料发外欠数表"),
```

`db/seed_plastic_process_shortage_perms.sql`:
```sql
-- 开发用:给 admin 授予 物料发外欠数表 菜单 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] = N'物料发外欠数表';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'物料发外欠数表',1,1,1,1,1,1,1,1,1);
```
应用两库(localdb 停止态先 `SqlLocalDB start MSSQLLocalDB`,再 `SqlLocalDB info` 取 `np:\\.\pipe\...`)。

- [ ] **Step 5: 编译**

Run: `dotnet build src/ErpApi/ErpApi.csproj -c Debug` → Build succeeded(0 错误)。

- [ ] **Step 6: Commit**
```bash
git add src/ErpApi/Features/Plastics/PlasticProcessPurchaseOrder/ src/ErpApi/Features/Plastics/PlasticProcessShortage/ src/ErpApi/Features/Admin/MenuCatalog.cs db/seed_plastic_process_shortage_perms.sql
git commit -m "feat(物料发外欠数表): 后端DTO+ShortageAsync+Controller+菜单权限"
```

---

## Task 2: 后端 DB 测试

**Files:**
- Create: `tests/ErpApi.Tests/PlasticProcessShortageServiceDbTests.cs`

- [ ] **Step 1: 写测试**

`PlasticProcessShortageServiceDbTests.cs`:
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticProcessPurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticProcessShortageServiceDbTests(DbFixture fx)
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
        c.Execute("INSERT INTO [塑胶加工采购单]([单号],[日期],[加工厂编号],[加工厂名称],[审核]) VALUES(N'SJ-SH-1','2026-06-15',N'F-SH',N'SH测试加工厂','1')");
        c.Execute("INSERT INTO [塑胶加工采购单明细]([单号],[生产单号],[款号],[模具编号],[物料编号],[物料名称],[用料名称],[颜色],[加工内容],[数量],[单价],[金额]) VALUES(N'SJ-SH-1',N'PJ-SH',N'K-SH',N'GM-SH',N'SHPM',N'白件A',N'用A',N'黑',N'喷油',8,3,24)");
        c.Execute("INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[单位],[物料类别]) VALUES(N'SHPM',N'白件A',N'个',N'注塑')");
        c.Execute("INSERT INTO [塑胶共用物料表]([塑胶货号],[工模编号],[物料编号],[物料名称],[颜色],[共用原料编号]) VALUES(N'H-SH',N'GM-SH',N'SHPM',N'白件A',N'黑',N'CR-SH')");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[日期],[审核]) VALUES(N'SR-SH-1','2026-06-20','1')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[生产单号],[物料编号],[物料名称],[颜色],[数量]) VALUES(N'SR-SH-1',N'PJ-SH',N'SHPM',N'白件A',N'黑',5)");
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [塑胶加工采购单明细] WHERE [单号]=N'SJ-SH-1'");
        c.Execute("DELETE FROM [塑胶加工采购单] WHERE [单号]=N'SJ-SH-1'");
        c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [单号]=N'SR-SH-1'");
        c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号]=N'SR-SH-1'");
        c.Execute("DELETE FROM [塑胶共用物料表] WHERE [塑胶货号]=N'H-SH'");
        c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'SHPM'");
    }

    [SkippableFact]
    public async Task Shortage_orders_minus_receipts_grouped_by_material()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var rows = await Svc().ShortageAsync(null, null, "SHPM", false);
            var r = Assert.Single(rows.Where(x => x.物料编号 == "SHPM"));
            Assert.Equal(3m, r.欠数);   // 8 - 5
            Assert.Equal(3m, r.单价);
            Assert.Equal(9m, r.金额);   // 3 * 3
            Assert.Equal("CR-SH", r.共用物料编号);
            Assert.Equal("GM-SH", r.模具编号);
            Assert.Equal("个", r.单位);
            Assert.Equal("注塑", r.物料类别);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Shortage_filters_category_approval_onlyOwed()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            // 物料类别命中/不命中
            Assert.Contains(await Svc().ShortageAsync("注塑", null, "SHPM", false), x => x.物料编号 == "SHPM");
            Assert.DoesNotContain(await Svc().ShortageAsync("不存在类别", null, "SHPM", false), x => x.物料编号 == "SHPM");
            // onlyOwed: 欠3>0 含
            Assert.Contains(await Svc().ShortageAsync(null, null, "SHPM", true), x => x.物料编号 == "SHPM");
            // 审核情况=已审核 含(订购 o.审核=1)
            Assert.Contains(await Svc().ShortageAsync(null, "已审核", "SHPM", false), x => x.物料编号 == "SHPM");
            // 审核情况=未审核 不含
            Assert.DoesNotContain(await Svc().ShortageAsync(null, "未审核", "SHPM", false), x => x.物料编号 == "SHPM");
        }
        finally { Clean(c); }
    }
}
```
注意:`DbFixture`/`fx.Open()` 用法以 `PlasticProcessIssueProgressServiceDbTests.cs` 为准。塑胶加工采购单/塑胶入仓单/塑胶共用物料表 无 FK 到款号总表故种子不种父行。

- [ ] **Step 2: 跑本测试**

Run: `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticProcessShortage"`
Expected: 2 passed。

- [ ] **Step 3: 全量测试**

Run: `dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj`
Expected: 全绿(399→401)。

- [ ] **Step 4: Commit**
```bash
git add tests/ErpApi.Tests/PlasticProcessShortageServiceDbTests.cs
git commit -m "test(物料发外欠数表): ShortageAsync 欠数=订购-入仓 + 过滤"
```

---

## Task 3: 前端 api + Page + 路由 + 菜单

**Files:**
- Create: `web/src/api/plasticProcessShortage.ts`
- Create: `web/src/pages/plastics/PlasticProcessShortagePage.tsx`
- Modify: `web/src/App.tsx` (import + route)
- Modify: `web/src/nav/menuTree.tsx:121` (`M("物料发外欠数表")` → 带路由)

- [ ] **Step 1: api 客户端**

`web/src/api/plasticProcessShortage.ts`:
```ts
import { api } from "./client";
export interface PlasticProcessShortageRow {
  物料编号?: string; 共用物料编号?: string; 物料名称?: string; 模具编号?: string; 共用物料?: string;
  物料类别?: string; 单位?: string;
  欠数?: number | null; 单价?: number | null; 金额?: number | null;
}
export interface PlasticProcessShortageParams { 物料类别?: string; 审核情况?: string; keyword?: string; onlyOwed?: boolean }
export const plasticProcessShortageApi = {
  list: (p: PlasticProcessShortageParams) =>
    api.get<PlasticProcessShortageRow[]>("/plastic-process-shortage", { params: p }).then(r => r.data),
};
```

- [ ] **Step 2: 报表页**

`web/src/pages/plastics/PlasticProcessShortagePage.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Checkbox, Input, Select, Space, Table, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { plasticProcessShortageApi, type PlasticProcessShortageRow } from "../../api/plasticProcessShortage";
import { plasticMaterialMasterApi, type PlasticMaterialCategoryNode } from "../../api/plasticMaterialMaster";
import { can, hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import { downloadCsv, printTable, type ExportCol } from "../../utils/tableExport";

const MENU = "物料发外欠数表";

export default function PlasticProcessShortagePage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const priceHidden = hidePrice(perms, MENU);
  const [cats, setCats] = useState<PlasticMaterialCategoryNode[]>([]);
  const [cat, setCat] = useState("");
  const [appr, setAppr] = useState("");
  const [keyword, setKeyword] = useState("");
  const [onlyOwed, setOnlyOwed] = useState(false);
  const [rows, setRows] = useState<PlasticProcessShortageRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (canOpen) plasticMaterialMasterApi.categories().then(setCats).catch(() => { /* 取类别失败不阻塞 */ });
  }, [canOpen]);

  const load = useCallback(async () => {
    if (!canOpen) return;
    setLoading(true);
    try {
      setRows(await plasticProcessShortageApi.list({
        物料类别: cat || undefined, 审核情况: appr || undefined,
        keyword: keyword || undefined, onlyOwed,
      }));
    } catch { message.error("加载物料发外欠数表失败"); }
    finally { setLoading(false); }
  }, [canOpen, cat, appr, keyword, onlyOwed]);
  useEffect(() => { load(); }, [canOpen, cat, appr, onlyOwed]); // eslint-disable-line react-hooks/exhaustive-deps

  const priceCols: ColumnsType<PlasticProcessShortageRow> = priceHidden ? [] : [
    { title: "单价", dataIndex: "单价", width: 90, align: "right" as const },
    { title: "金额", dataIndex: "金额", width: 110, align: "right" as const },
  ];

  const columns: ColumnsType<PlasticProcessShortageRow> = [
    { title: "物料编号", dataIndex: "物料编号", width: 120 },
    { title: "共用物料编号", dataIndex: "共用物料编号", width: 130 },
    { title: "物料名称", dataIndex: "物料名称", width: 160 },
    { title: "模具编号", dataIndex: "模具编号", width: 110 },
    { title: "共用物料", dataIndex: "共用物料", width: 140 },
    { title: "物料类别", dataIndex: "物料类别", width: 100 },
    { title: "单位", dataIndex: "单位", width: 60 },
    { title: "欠数", dataIndex: "欠数", width: 100, align: "right" as const },
    ...priceCols,
  ];

  const exportCols: ExportCol[] = [
    { title: "物料编号", key: "物料编号" }, { title: "共用物料编号", key: "共用物料编号" }, { title: "物料名称", key: "物料名称" },
    { title: "模具编号", key: "模具编号" }, { title: "共用物料", key: "共用物料" }, { title: "物料类别", key: "物料类别" }, { title: "单位", key: "单位" },
    { title: "欠数", key: "欠数" },
    ...(priceHidden ? [] : [{ title: "单价", key: "单价" }, { title: "金额", key: "金额" }]),
  ];
  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"物料发外欠数表·打开"权限）。</div></Card>;
  }

  return (
    <Card title="物料发外欠数表" variant="borderless">
      <Space style={{ marginBottom: 12 }} wrap>
        <Select value={cat} onChange={setCat} style={{ width: 160 }}
          options={[{ value: "", label: "全部类别" }, ...cats.filter(x => x.类别).map(x => ({ value: x.类别!, label: `${x.类别}(${x.数量})` }))]} />
        <Select value={appr} onChange={setAppr} style={{ width: 130 }}
          options={[{ value: "", label: "全部" }, { value: "已审核", label: "已审核" }, { value: "未审核", label: "未审核" }]} />
        <Input.Search placeholder="物料编号/名称" allowClear value={keyword}
          onChange={e => setKeyword(e.target.value)} onSearch={load} style={{ width: 220 }} />
        <Checkbox checked={onlyOwed} onChange={e => setOnlyOwed(e.target.checked)}>只看欠数</Checkbox>
        <Button onClick={() => downloadCsv("物料发外欠数表.csv", exportCols, asRecords())}>导出EXCEL</Button>
        <Button onClick={() => printTable("物料发外欠数表", exportCols, asRecords())}>打印</Button>
        <span style={{ color: "#888" }}>共 {rows.length} 条</span>
      </Space>
      <Table rowKey={(_, i) => String(i)} size="small" loading={loading} dataSource={rows} columns={columns}
        scroll={{ x: "max-content" }} pagination={{ pageSize: 50, showTotal: t => `共 ${t} 条` }} />
    </Card>
  );
}
```

- [ ] **Step 3: 路由 + 菜单**

`App.tsx`:import `PlasticProcessShortagePage`;在 `plastic-process-issue-progress` 路由附近加 `<Route path="plastic-process-shortage" element={<PlasticProcessShortagePage />} />`。

`menuTree.tsx` line 121 `M("物料发外欠数表"),` → `M("物料发外欠数表", "/plastic-process-shortage", "物料发外欠数表"),`。

- [ ] **Step 4: 类型检查 + 测试**

Run: `cd web && npx tsc --noEmit`(0 错误)；`cd web && npx vitest run`(54 passed)。

- [ ] **Step 5: Commit**
```bash
git add web/src/api/plasticProcessShortage.ts web/src/pages/plastics/PlasticProcessShortagePage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m "feat(物料发外欠数表): 前端 api+报表页+路由+菜单"
```

---

## Task 4: HTTP 冒烟 + 终审 + 合并

- [ ] **Step 1: Release 编译**(锁先按 PID Stop-Process)+ 起后端 `--contentRoot 输出目录`。
- [ ] **Step 2: 冒烟**:种 加工采购单订购8 + 塑胶入仓5(同生产单号+物料+颜色)+ 塑胶物料资料(类别)+ 塑胶共用物料表(共用原料编号)→ `GET /api/plastic-process-shortage?onlyOwed=true&keyword=` 验 欠数3/单价3/金额9/共用物料编号;物料类别/审核情况过滤。清理种子。
- [ ] **Step 3: opus 终审**:全分支 diff·验 ① 入仓子查询先聚合不放大·GROUP BY 物料编号+模具编号汇总;② 欠数=SUM(订购−入仓)·金额=SUM(行欠数×行单价)·单价=MAX;③ 审核情况用内联 o. 片段(非写死 h. 的 ApprovalFilter);④ 物料类别/keyword/onlyOwed(HAVING)过滤;⑤ 金额脱敏 columns+exportCols 同步;⑥ 菜单/权限齐·DTO↔SQL↔前端一致;⑦ 全参数化·未动 ProgressAsync/PurchaseDetailAsync/IssueProgressAsync/LedgerUnion。READY 才合并。
- [ ] **Step 4: 合并 + 收尾**:`--no-ff` 合并 master,删分支;worklog `docs/worklogs/2026-06-30-plastic-process-shortage.md`;更新 MEMORY。
