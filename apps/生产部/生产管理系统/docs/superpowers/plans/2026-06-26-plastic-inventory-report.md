# 塑胶库存统计表 保真增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把简版塑胶库存页增强为对齐原系统的塑胶库存统计表:左物料分类树 + 补列(工模编号/塑胶货号/颜色/单价/金额)+ 单价/金额按权限脱敏 + 导出EXCEL/打印 + 底部汇总。

**Architecture:** 库存口径不变(PlasticInventoryService 6 支 UNION 实时聚合)。只在 ListAsync 外层多 LEFT JOIN 带出展示列(颜色/单价 来自 塑胶物料资料;工模编号/塑胶货号 来自 塑胶共用物料表),加 物料类别 过滤参,金额=库存×单价(展示)。Controller 加脱敏。前端重写页(镜像 MaterialInventoryPage)复用 categories 端点 + tableExport 工具。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + Ant Design v6 + Vitest。

---

## 前置约定

- 工作目录 `D:\WebpageERP`,分支 `feat-plastic-inventory-report`,完成 `--no-ff` 合并 master 删分支。PowerShell;`dotnet` 不在 PATH:`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 测试 env 从 User 取:`$env:ERP_TEST_DB`/`$env:ERP_JWT_KEY`/`$env:ERP_DB`。后端 `dotnet test`(锁 DLL 用 `-c Release`)。前端 `npm --prefix web run test`/`build`。
- 提交末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 镜像源:`web/src/pages/materials/MaterialInventoryPage.tsx`(左树+查询)、`web/src/utils/tableExport.ts`(`downloadCsv(filename,cols,rows)`/`printTable(title,cols,rows)`,`ExportCol={title,key,fmt?}`)、`web/src/api/plasticMaterialMaster.ts`(`plasticMaterialMasterApi.categories()`→`{类别?,数量}[]`)、`web/src/auth/permissions.ts`(`hidePrice(perms,menu)`)。

## 文件结构

| 文件 | 责任 | 改 |
|---|---|---|
| `src/ErpApi/Engines/Inventory/PlasticInventoryService.cs` | PlasticStockRow 加列 + ListAsync 补 JOIN/物料类别/金额 | 改 |
| `src/ErpApi/Engines/Inventory/PlasticInventoryController.cs` | List 加 物料类别 参 + 单价/金额脱敏 | 改 |
| `tests/ErpApi.Tests/PlasticInventoryServiceDbTests.cs` | 加列/过滤测试 | 改 |
| `web/src/api/plasticInventory.ts` | PlasticStockRow 加字段 + list 加 物料类别 | 改 |
| `web/src/pages/plastics/PlasticInventoryPage.tsx` | 重写:树+全列+导出打印+汇总 | 改 |

---

## Task 1: 后端 ListAsync 补列/过滤 + Controller 脱敏 + 测试

**Files:** Modify `PlasticInventoryService.cs`, `PlasticInventoryController.cs`; Test `PlasticInventoryServiceDbTests.cs`

- [ ] **Step 1: PlasticStockRow 加字段** 在 `src/ErpApi/Engines/Inventory/PlasticInventoryService.cs` 的 `PlasticStockRow` 类(`public string? 仓位号 { get; set; }` 后)加:

```csharp
    public string? 颜色 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 塑胶货号 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
```

- [ ] **Step 2: 改 ListAsync** 把整个 `ListAsync` 方法替换为:

```csharp
    public async Task<IReadOnlyList<PlasticStockRow>> ListAsync(string? 仓库, string? keyword, string? 物料类别 = null)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var wh = string.IsNullOrWhiteSpace(仓库) ? null : 仓库.Trim();
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var sql = $@"
SELECT t.[物料编号], MAX(t.[物料名称]) AS 物料名称, MAX(t.[规格]) AS 规格, MAX(t.[单位]) AS 单位,
       t.[仓库], SUM(t.[数量]) AS 库存数量,
       MAX(m.[物料类别]) AS 物料类别, MAX(m.[仓位号]) AS 仓位号, MAX(m.[颜色]) AS 颜色,
       MAX(g.[工模编号]) AS 工模编号, MAX(g.[塑胶货号]) AS 塑胶货号,
       MAX(m.[单价]) AS 单价, SUM(t.[数量]) * ISNULL(MAX(m.[单价]), 0) AS 金额
FROM ({LedgerUnion}) t
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([仓位号]) AS 仓位号, MAX([颜色]) AS 颜色, MAX([单价]) AS 单价
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号]=t.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([工模编号]) AS 工模编号, MAX([塑胶货号]) AS 塑胶货号
           FROM [塑胶共用物料表] GROUP BY [物料编号]) g ON g.[物料编号]=t.[物料编号]
WHERE (@wh IS NULL OR t.[仓库]=@wh)
  AND (@kw IS NULL OR t.[物料编号] LIKE @kw OR t.[物料名称] LIKE @kw OR t.[规格] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat)
GROUP BY t.[物料编号], t.[仓库]
HAVING SUM(t.[数量]) <> 0
ORDER BY t.[物料编号], t.[仓库]";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticStockRow>(sql, new { wh, kw, cat });
        return rows.AsList();
    }
```

- [ ] **Step 3: 改 Controller** 把 `src/ErpApi/Engines/Inventory/PlasticInventoryController.cs` 的 List 方法替换为(加 物料类别 参 + 脱敏):

```csharp
    [HttpGet]
    public async Task<IActionResult> List(string? 仓库 = null, string? keyword = null, string? 物料类别 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.ListAsync(仓库, keyword, 物料类别);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.单价))
            foreach (var r in rows) { r.单价 = null; r.金额 = null; }
        return Ok(rows);
    }
```

- [ ] **Step 4: 加测试** 在 `tests/ErpApi.Tests/PlasticInventoryServiceDbTests.cs` 末尾(类闭合 `}` 前)追加。文件已有 `using ErpApi.Engines.Posting;`/`using Dapper;`:

```csharp
    [SkippableFact]
    public async Task List_brings_join_columns_and_filters_by_category()
    {
        using var c = fx.Open();
        var engine = new PostingEngine(Factory(), new AuditLogger());
        void Clean()
        {
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [物料编号]=N'SINVR01'; DELETE FROM [塑胶入仓单] WHERE [单号]=N'SRINVR01'");
            c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'SINVR01'");
            c.Execute("DELETE FROM [塑胶共用物料表] WHERE [物料编号]=N'SINVR01'");
        }
        Clean();
        c.Execute("INSERT INTO [塑胶物料资料]([物料类别],[物料编号],[物料名称],[规格],[颜色],[仓位号],[单价]) VALUES(N'ABS',N'SINVR01',N'ABS粒',N'规A',N'黑',N'A-1',10)");
        c.Execute("INSERT INTO [塑胶共用物料表]([物料编号],[工模编号],[塑胶货号]) VALUES(N'SINVR01',N'MJ-1',N'HH-1')");
        c.Execute("INSERT INTO [塑胶入仓单]([单号],[仓库],[审核]) VALUES(N'SRINVR01',N'报表仓','0')");
        c.Execute("INSERT INTO [塑胶入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量]) VALUES(N'SRINVR01',N'报表仓',N'SINVR01',N'ABS粒',N'规A',N'kg',100)");
        try
        {
            await engine.ApproveAsync("塑胶入仓单", "SRINVR01", "t");
            var rows = await Svc().ListAsync("报表仓", "SINVR01");
            var row = Assert.Single(rows, r => r.物料编号 == "SINVR01");
            Assert.Equal("黑", row.颜色);
            Assert.Equal("MJ-1", row.工模编号);
            Assert.Equal("HH-1", row.塑胶货号);
            Assert.Equal("ABS", row.物料类别);
            Assert.Equal(10m, row.单价);
            Assert.Equal(1000m, row.金额);   // 100 × 10
            // 物料类别 过滤
            Assert.Empty(await Svc().ListAsync("报表仓", "SINVR01", "不存在类"));
            Assert.Single(await Svc().ListAsync("报表仓", "SINVR01", "ABS"));
        }
        finally { Clean(); }
    }
```

- [ ] **Step 5: 跑测试 + 全量回归**

Run: `dotnet test --filter "FullyQualifiedName~PlasticInventoryServiceDbTests"` → 全 PASS(原有 + 新增)。
Run: `dotnet test` → 全绿(361 → 362)。报告总数行。

- [ ] **Step 6: Commit**

```powershell
git add src/ErpApi/Engines/Inventory tests/ErpApi.Tests/PlasticInventoryServiceDbTests.cs
git commit -m @'
feat(塑胶库存统计表): ListAsync补工模/货号/颜色/单价/金额+物料类别过滤+Controller脱敏+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 重写库存统计表页(树+全列+导出打印+汇总)

**Files:** Modify `web/src/api/plasticInventory.ts`, `web/src/pages/plastics/PlasticInventoryPage.tsx`

- [ ] **Step 1: 改 API** 把 `web/src/api/plasticInventory.ts` 整体替换为:

```typescript
import { api } from "./client";

export interface PlasticStockRow {
  物料编号?: string; 物料名称?: string; 规格?: string; 单位?: string;
  仓库?: string; 库存数量: number; 物料类别?: string; 仓位号?: string;
  颜色?: string; 工模编号?: string; 塑胶货号?: string; 单价?: number | null; 金额?: number | null;
}
export const plasticInventoryApi = {
  list: (仓库?: string, keyword?: string, 物料类别?: string) =>
    api.get<PlasticStockRow[]>("/plastic-inventory", { params: { 仓库, keyword, 物料类别 } }).then(r => r.data),
};
```

- [ ] **Step 2: 重写页面** 把 `web/src/pages/plastics/PlasticInventoryPage.tsx` 整体替换为:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Space, Table, Tree, message } from "antd";
import { plasticInventoryApi, type PlasticStockRow } from "../../api/plasticInventory";
import { plasticMaterialMasterApi, type PlasticMaterialCategoryNode } from "../../api/plasticMaterialMaster";
import { can, hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import { downloadCsv, printTable, type ExportCol } from "../../utils/tableExport";

const MENU = "塑胶库存";
const ALL = "__ALL__";

export default function PlasticInventoryPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const priceHidden = hidePrice(perms, MENU);
  const [rows, setRows] = useState<PlasticStockRow[]>([]);
  const [cats, setCats] = useState<PlasticMaterialCategoryNode[]>([]);
  const [selKey, setSelKey] = useState<string>(ALL);
  const [仓库, set仓库] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);

  const 类别 = selKey === ALL ? undefined : selKey;

  const load = useCallback(async () => {
    if (!canOpen) return;
    setLoading(true);
    try { setRows(await plasticInventoryApi.list(仓库 || undefined, keyword || undefined, 类别)); }
    catch { message.error("加载塑胶库存失败"); }
    finally { setLoading(false); }
  }, [canOpen, 仓库, keyword, 类别]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (canOpen) plasticMaterialMasterApi.categories().then(setCats).catch(() => { /* 树取数失败不阻塞主表 */ });
  }, [canOpen]);

  const treeData = useMemo(() => [{
    title: "全部物料", key: ALL,
    children: cats.map(c => ({ title: `${c.类别}（${c.数量}）`, key: c.类别 ?? "", isLeaf: true })),
  }], [cats]);

  const columns = [
    { title: "物料编号", dataIndex: "物料编号", width: 120, render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "工模编号", dataIndex: "工模编号", width: 110 },
    { title: "物料名称", dataIndex: "物料名称", width: 150 },
    { title: "规格", dataIndex: "规格", width: 110 },
    { title: "颜色", dataIndex: "颜色", width: 80 },
    { title: "材料", dataIndex: "物料类别", width: 90 },
    { title: "塑胶货号", dataIndex: "塑胶货号", width: 110 },
    { title: "仓位号", dataIndex: "仓位号", width: 90 },
    { title: "单位", dataIndex: "单位", width: 64 },
    { title: "仓库", dataIndex: "仓库", width: 100 },
    { title: "库存数量", dataIndex: "库存数量", width: 100, align: "right" as const,
      render: (v: number) => <span style={{ fontWeight: 600, color: v < 0 ? "#cf1322" : undefined }}>{v}</span> },
    ...(priceHidden ? [] : [
      { title: "单价", dataIndex: "单价", width: 90, align: "right" as const, render: (v?: number | null) => v ?? "" },
      { title: "金额", dataIndex: "金额", width: 110, align: "right" as const, render: (v?: number | null) => (v == null ? "" : Number(v).toFixed(2)) },
    ]),
  ];

  const 库存合计 = rows.reduce((s, r) => s + Number(r.库存数量 ?? 0), 0);
  const 金额合计 = rows.reduce((s, r) => s + Number(r.金额 ?? 0), 0);

  const exportCols: ExportCol[] = [
    { title: "物料编号", key: "物料编号" }, { title: "工模编号", key: "工模编号" }, { title: "物料名称", key: "物料名称" },
    { title: "规格", key: "规格" }, { title: "颜色", key: "颜色" }, { title: "材料", key: "物料类别" },
    { title: "塑胶货号", key: "塑胶货号" }, { title: "仓位号", key: "仓位号" }, { title: "单位", key: "单位" },
    { title: "仓库", key: "仓库" }, { title: "库存数量", key: "库存数量" },
    ...(priceHidden ? [] : [{ title: "单价", key: "单价" }, { title: "金额", key: "金额" }]),
  ];
  const asRecords = () => rows as unknown as Record<string, unknown>[];

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"塑胶库存·打开"权限）。</div></Card>;
  }

  return (
    <Card title="塑胶库存统计表" variant="borderless" styles={{ body: { display: "flex", gap: 12 } }}>
      <div style={{ width: 200, flex: "0 0 200px", borderRight: "1px solid #f0f0f0", paddingRight: 8 }}>
        <Tree treeData={treeData} selectedKeys={[selKey]} defaultExpandAll
          onSelect={keys => { if (keys.length) setSelKey(String(keys[0])); }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Space style={{ marginBottom: 12 }} wrap>
          <Input placeholder="仓库" allowClear value={仓库} onChange={e => set仓库(e.target.value)} onPressEnter={load} style={{ width: 140 }} />
          <Input.Search placeholder="物料编号/名称/规格" allowClear value={keyword}
            onChange={e => setKeyword(e.target.value)} onSearch={load} style={{ width: 240 }} />
          <Button onClick={() => downloadCsv("塑胶库存统计表.csv", exportCols, asRecords())}>导出EXCEL</Button>
          <Button onClick={() => printTable("塑胶库存统计表", exportCols, asRecords())}>打印</Button>
        </Space>
        <Table rowKey={(_, i) => String(i)} size="small" loading={loading} dataSource={rows} columns={columns}
          scroll={{ x: "max-content" }} pagination={{ pageSize: 50, showTotal: t => `共 ${t} 条` }}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={priceHidden ? 10 : 10}><b>合计</b></Table.Summary.Cell>
                <Table.Summary.Cell index={10} align="right"><b>{库存合计}</b></Table.Summary.Cell>
                {!priceHidden && <Table.Summary.Cell index={11} />}
                {!priceHidden && <Table.Summary.Cell index={12} align="right"><b>{金额合计.toFixed(2)}</b></Table.Summary.Cell>}
              </Table.Summary.Row>
            </Table.Summary>
          )} />
      </div>
    </Card>
  );
}
```

注:summary 的 `colSpan` 覆盖 库存数量 之前的 10 列(物料编号/工模编号/物料名称/规格/颜色/材料/塑胶货号/仓位号/单位/仓库),库存数量列单独显合计;有价时单价列空、金额列显合计。若实跑列对不齐,按实际列数微调 colSpan/index(列定义即上方 columns,数一遍即可)。

- [ ] **Step 3: 前端测试 + 构建**

Run: `npm --prefix web run test` → 54 不减。
Run: `npm --prefix web run build` → tsc 干净 + 构建成功。

- [ ] **Step 4: Commit**

```powershell
git add web/src/api/plasticInventory.ts web/src/pages/plastics/PlasticInventoryPage.tsx
git commit -m @'
feat(塑胶库存统计表): 前端左分类树+全列+导出EXCEL/打印+底部汇总(单价金额脱敏)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟**

重启后端(新代码,`-c Release`,`ASPNETCORE_URLS=http://127.0.0.1:5000`,env ERP_DB/ERP_JWT_KEY),待就绪。Node axios(`proxy:false`):admin 登录 → 种 1 塑胶物料(塑胶物料资料 物料类别 ABS/颜色/单价 10)+ 共用物料表(工模/货号)→ 建塑胶入仓单(该物料 100,仓库 报表仓)→ approve → `GET /api/plastic-inventory?keyword=<物料编号>` 返回行含 颜色/工模编号/塑胶货号/物料类别/单价 10/金额 1000;`?物料类别=ABS` 有、`?物料类别=不存在` 空。清理(反审核+删入仓单+删种子)。

Expected: 新列带出正确、金额=库存×单价、物料类别过滤生效。(脱敏在前端按权限,admin 有单价权限可见。)

- [ ] **Step 2: opus 全分支终审**

派 opus 对 `feat-plastic-inventory-report` 全分支终审:库存 UNION 口径未变(只外层加 JOIN/列)、金额=SUM(数量)×MAX(单价) 正确无重复计、物料类别过滤正确、Controller 按「塑胶库存·单价」脱敏(单价+金额都置 null)、前端列与脱敏一致、导出/打印列与表列一致、汇总 colSpan 对齐、categories 复用正确。目标 READY TO MERGE。

- [ ] **Step 3: 合并 master**

```powershell
git checkout master
git merge --no-ff feat-plastic-inventory-report -m @'
Merge branch 'feat-plastic-inventory-report' into master

塑胶库存统计表保真增强(左分类树+全列+导出打印+汇总+脱敏)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
git branch -d feat-plastic-inventory-report
```

- [ ] **Step 4: worklog + MEMORY** Create `docs/worklogs/2026-06-26-plastic-inventory-report.md`;记 P4 塑胶报表第一张。Commit。

```powershell
git add docs/worklogs/2026-06-26-plastic-inventory-report.md
git commit -m @'
docs(worklog): 塑胶库存统计表保真增强 2026-06-26

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## 自审清单(已核对)

- **Spec 覆盖**:PlasticStockRow 加列+ListAsync JOIN/物料类别/金额=Task1;Controller 脱敏=Task1 Step3;前端树+全列+导出打印+汇总+脱敏=Task2;测试=Task1 Step4;冒烟/终审/合并=Task3。无遗漏。
- **类型一致**:前端 `PlasticStockRow` 字段 = 后端 `PlasticStockRow`(加 颜色/工模编号/塑胶货号/单价/金额);`list` 三参 = Controller 三参。
- **库存不变**:`LedgerUnion` 未动;新 JOIN 只在外层带展示列;`HAVING SUM<>0` 保留。
- **金额无重复计**:`SUM(t.数量) * ISNULL(MAX(m.单价),0)`——单价用 MAX(每物料单值,JOIN 后每明细行重复但 MAX 取一)避免 SUM 放大。
- **脱敏**:Controller 无单价权限置 单价/金额=null;前端 hidePrice 去两列+不显金额合计+导出不含两列。
- **无占位**:全码;summary colSpan 给了数列说明。
