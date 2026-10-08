# 库存统计表 加分类树 + 货号/材料列 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强现有物料库存查询页「库存统计表」(`/material-inventory`)——后端 ListAsync 带出货号/物料类别并支持按物料类别过滤，前端左侧加物料分类树 + 表格补 货号/材料 两列。

**Architecture:** 后端 `MaterialInventoryService.ListAsync` 在 物料编号×仓库 聚合结果上 LEFT JOIN 物料资料（去重子查询）带出 货号/物料类别，加 `物料类别` 过滤参数。前端 `MaterialInventoryPage` 复用 `materialMasterApi.categories()` + 物料资料页的树/筛选模式，加分类树与两列。

**Tech Stack:** .NET 8 ASP.NET Core, Dapper, SQL Server LocalDB, xUnit + Xunit.SkippableFact, React 18 + TS + Vite + Ant Design v6 + Vitest。

---

## 前置约定

- 工作目录 `D:\WebpageERP`，分支 `feat-inventory-report-tree`。
- `dotnet` 不在 PATH：`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 测试环境变量：`$env:ERP_TEST_DB`/`$env:ERP_JWT_KEY`/`$env:ERP_DB`（从 User 环境变量取）。
- 后端单类测试 `dotnet test --filter "FullyQualifiedName~MaterialInventoryDbTests"`；前端 `npm --prefix web run test -- --run`、`npm --prefix web run build`。
- 跑后端测试前停 ErpApi（占锁）。提交末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- **已有件**：`materialMasterApi.categories()`(`GET /material-master/categories`→`MaterialCategoryNode[]` `{类别?,数量}`)；物料资料页 `web/src/pages/materials/MaterialMasterPage.tsx`(树/筛选/布局范本)；`物料资料` 表有 `货号 nvarchar(40)`/`物料类别 nvarchar(20)`；`LedgerUnion` 子查询列 物料编号/物料名称/规格/单位/仓库/数量。

---

## Task 1: 后端 — 带出货号/物料类别 + 按类别过滤（TDD）

**Files:**
- Modify: `src/ErpApi/Engines/Inventory/MaterialStockRow.cs`
- Modify: `src/ErpApi/Engines/Inventory/IMaterialInventoryService.cs`
- Modify: `src/ErpApi/Engines/Inventory/MaterialInventoryService.cs`
- Modify: `src/ErpApi/Features/Materials/MaterialInventoryController.cs`
- Test: `tests/ErpApi.Tests/MaterialInventoryDbTests.cs`

- [ ] **Step 1: 写失败测试**

在 `tests/ErpApi.Tests/MaterialInventoryDbTests.cs` 类最后一个 `}` 之前追加：

```csharp
    [SkippableFact]
    public async Task List_enriches_货号_物料类别_and_filters_by_类别()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN (N'P3RKA',N'P3RKB')");
        // 两物料、两类别，各入仓有库存
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位],[货号],[物料类别]) VALUES(N'P3M01',N'面料A',N'米',N'H001',N'面料')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位],[货号],[物料类别]) VALUES(N'P3M02',N'辅料B',N'个',N'H002',N'辅料')");
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'P3RKA',N'物料仓','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量])
                    VALUES(N'P3RKA',N'物料仓',N'P3M01',N'面料A',N'米',50)");
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'P3RKB',N'物料仓','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[单位],[数量])
                    VALUES(N'P3RKB',N'物料仓',N'P3M02',N'辅料B',N'个',30)");
        try
        {
            // 不过滤：两行，货号/物料类别带出
            var all = await Svc().ListAsync(仓库: "物料仓", keyword: null);
            var r1 = Assert.Single(all, x => x.物料编号 == "P3M01");
            Assert.Equal("H001", r1.货号);
            Assert.Equal("面料", r1.物料类别);
            Assert.Contains(all, x => x.物料编号 == "P3M02" && x.物料类别 == "辅料");
            // 按类别过滤：只剩面料
            var onlyFabric = await Svc().ListAsync(仓库: "物料仓", keyword: null, 物料类别: "面料");
            Assert.Single(onlyFabric);
            Assert.Equal("P3M01", onlyFabric[0].物料编号);
        }
        finally
        {
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN (N'P3RKA',N'P3RKB')");
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
            Cleanup(c);
        }
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~MaterialInventoryDbTests.List_enriches_货号_物料类别_and_filters_by_类别"`
Expected: 编译失败（`ListAsync` 还没有 `物料类别` 形参；`MaterialStockRow` 没有 `货号`/`物料类别`）。

- [ ] **Step 3: `MaterialStockRow.cs` 加两字段**

在 `MaterialStockRow` 类的 `库存数量` 之后加：
```csharp
    public string? 货号 { get; set; }
    public string? 物料类别 { get; set; }
```

- [ ] **Step 4: 接口 `IMaterialInventoryService.cs` 改 ListAsync 签名**

把 `Task<IReadOnlyList<MaterialStockRow>> ListAsync(string? 仓库, string? keyword);` 改为：
```csharp
    Task<IReadOnlyList<MaterialStockRow>> ListAsync(string? 仓库, string? keyword, string? 物料类别 = null);
```

- [ ] **Step 5: `MaterialInventoryService.cs` 改 ListAsync 实现**

把整个 `ListAsync` 方法替换为（加 `物料类别` 形参、LEFT JOIN 物料资料带出 货号/物料类别、按类别过滤；注意列名用 `t.`/`m.` 限定）：
```csharp
    public async Task<IReadOnlyList<MaterialStockRow>> ListAsync(string? 仓库, string? keyword, string? 物料类别 = null)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var wh = string.IsNullOrWhiteSpace(仓库) ? null : 仓库.Trim();
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var sql = $@"
SELECT t.[物料编号], MAX(t.[物料名称]) AS 物料名称, MAX(t.[规格]) AS 规格, MAX(t.[单位]) AS 单位,
       t.[仓库], SUM(t.[数量]) AS 库存数量,
       MAX(m.[货号]) AS 货号, MAX(m.[物料类别]) AS 物料类别
FROM ({LedgerUnion}) t
LEFT JOIN (SELECT [物料编号], MAX([货号]) AS 货号, MAX([物料类别]) AS 物料类别
           FROM [物料资料] GROUP BY [物料编号]) m ON m.[物料编号]=t.[物料编号]
WHERE (@wh IS NULL OR t.[仓库]=@wh)
  AND (@kw IS NULL OR t.[物料编号] LIKE @kw OR t.[物料名称] LIKE @kw OR t.[规格] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别]=@cat)
GROUP BY t.[物料编号], t.[仓库]
HAVING SUM(t.[数量]) <> 0
ORDER BY t.[物料编号], t.[仓库]";
        using var c = factory.Create();
        var rows = await c.QueryAsync<MaterialStockRow>(sql, new { wh, kw, cat });
        return rows.AsList();
    }
```

- [ ] **Step 6: `MaterialInventoryController.cs` 加查询参数**

把 `List` action 改为：
```csharp
    [HttpGet]
    public async Task<IActionResult> List(string? 仓库 = null, string? keyword = null,
        [FromQuery(Name = "物料类别")] string? 物料类别 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await inventory.ListAsync(仓库, keyword, 物料类别);
        return Ok(rows);
    }
```

- [ ] **Step 7: 跑全部库存测试确认通过、不回归**

Run: `dotnet test --filter "FullyQualifiedName~MaterialInventoryDbTests"`
Expected: 全绿（新测试 + 原有 库存/报废/盘点 断言均过；原有调用 `ListAsync(仓库, keyword)` 因第三参可选默认 null 不受影响）。

- [ ] **Step 8: Commit**

```bash
git add src/ErpApi/Engines/Inventory/MaterialStockRow.cs src/ErpApi/Engines/Inventory/IMaterialInventoryService.cs src/ErpApi/Engines/Inventory/MaterialInventoryService.cs src/ErpApi/Features/Materials/MaterialInventoryController.cs tests/ErpApi.Tests/MaterialInventoryDbTests.cs
git commit -m "feat(库存统计表): ListAsync带出货号/物料类别+按类别过滤+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 前端 — 分类树 + 货号/材料列

**Files:**
- Modify: `web/src/api/materialInventory.ts`
- Modify: `web/src/pages/materials/MaterialInventoryPage.tsx`

- [ ] **Step 1: api 加字段 + 参数**

把 `web/src/api/materialInventory.ts` 整个替换为：
```ts
import { api } from "./client";

export interface MaterialStockRow {
  物料编号: string; 物料名称?: string; 规格?: string; 单位?: string; 仓库?: string; 库存数量: number;
  货号?: string; 物料类别?: string;
}

export const materialInventoryApi = {
  list: (仓库?: string, keyword?: string, 物料类别?: string) =>
    api.get<MaterialStockRow[]>("/material-inventory", { params: { 仓库, keyword, 物料类别 } }).then(r => r.data),
};
```

- [ ] **Step 2: 重写盘点查询页加树与两列**

把 `web/src/pages/materials/MaterialInventoryPage.tsx` 整个替换为：
```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Input, Space, Table, Tree, message } from "antd";
import { materialInventoryApi, type MaterialStockRow } from "../../api/materialInventory";
import { materialMasterApi, type MaterialCategoryNode } from "../../api/materialMaster";

const ALL = "__ALL__";

export default function MaterialInventoryPage() {
  const [rows, setRows] = useState<MaterialStockRow[]>([]);
  const [cats, setCats] = useState<MaterialCategoryNode[]>([]);
  const [selKey, setSelKey] = useState<string>(ALL);
  const [仓库, set仓库] = useState("");
  const [keyword, setKeyword] = useState("");

  const 类别 = selKey === ALL ? undefined : selKey;

  const load = useCallback(async () => {
    try { setRows(await materialInventoryApi.list(仓库 || undefined, keyword || undefined, 类别)); }
    catch { message.error("加载物料库存失败"); }
  }, [仓库, keyword, 类别]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    materialMasterApi.categories().then(setCats).catch(() => { /* 树取数失败不阻塞主表 */ });
  }, []);

  const treeData = useMemo(() => [{
    title: "全部物料", key: ALL,
    children: cats.map(c => ({ title: `${c.类别}（${c.数量}）`, key: c.类别 ?? "", isLeaf: true })),
  }], [cats]);

  const columns = [
    { title: "物料编号", dataIndex: "物料编号", render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "货号", dataIndex: "货号" },
    { title: "物料名称", dataIndex: "物料名称" },
    { title: "规格", dataIndex: "规格" },
    { title: "材料", dataIndex: "物料类别" },
    { title: "单位", dataIndex: "单位" },
    { title: "仓库", dataIndex: "仓库" },
    {
      title: "库存数量", dataIndex: "库存数量",
      render: (v: number) => <span style={{ fontWeight: 600, color: v < 0 ? "#cf1322" : undefined }}>{v}</span>,
    },
  ];

  return (
    <Card title="库存统计表" variant="borderless" styles={{ body: { display: "flex", gap: 12 } }}>
      <div style={{ width: 220, flex: "0 0 220px", borderRight: "1px solid #f0f0f0", paddingRight: 8 }}>
        <Tree treeData={treeData} selectedKeys={[selKey]} defaultExpandAll
          onSelect={keys => { if (keys.length) setSelKey(String(keys[0])); }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Space style={{ marginBottom: 12 }} wrap>
          <Input placeholder="仓库" allowClear value={仓库} onChange={e => set仓库(e.target.value)} style={{ width: 140 }} />
          <Input.Search placeholder="物料编号/名称" allowClear onSearch={setKeyword} style={{ width: 220 }} />
        </Space>
        <Table rowKey={r => `${r.物料编号}|${r.仓库}`} size="small" dataSource={rows} columns={columns}
          scroll={{ x: true }} pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }} />
      </div>
    </Card>
  );
}
```
> 说明：标题改「库存统计表」对齐菜单/原系统；树取数失败静默（需 物料资料·打开 权限，admin 有全权）。`类别` 变化经 `load` 依赖自动重查。

- [ ] **Step 3: 前端测试 + 构建**

Run: `npm --prefix web run test -- --run`
Expected: 现有 42 测试不回归。
Run: `npm --prefix web run build`
Expected: tsc 无错，构建成功。

- [ ] **Step 4: Commit**

```bash
git add web/src/api/materialInventory.ts web/src/pages/materials/MaterialInventoryPage.tsx
git commit -m "feat(库存统计表): 左侧物料分类树+货号/材料列(对齐原系统)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 验证 + 合并

**Files:** 无

- [ ] **Step 1: 后端全量测试**

先停 ErpApi。Run: `dotnet test`
Expected: 全绿（约 303 通过：原 302 +1 新）。

- [ ] **Step 2: 起后端 5000 + 前端 5173，puppeteer 冒烟**

写 `tmp/shot/inv-report-smoke.cjs`（参照 `tmp/shot/stocktake-smoke.cjs`）：登录 admin/admin123 → 开 `/material-inventory` → 抓页面标题、左树是否有节点、表头列。
Expected：标题「库存统计表」；左侧树有「全部物料」+ 若干类别节点；表头含 `货号`、`材料`；点某类别节点后表格按该类别筛选。

- [ ] **Step 3: 合并 master**

```bash
git checkout master
git merge --no-ff feat-inventory-report-tree -m "Merge branch 'feat-inventory-report-tree' into master"
git branch -d feat-inventory-report-tree
```

- [ ] **Step 4: 收尾**

更新记忆（库存统计表加分类树+货号/材料列）；重启 5000/5173（见 [[restart-servers-after-plan]]）。

---

## 自查（写完计划回看 spec）

- **Spec 覆盖**：MaterialStockRow 加货号/物料类别(T1 Step3)✓、ListAsync JOIN 物料资料+类别过滤(T1 Step5)✓、接口签名(T1 Step4)✓、Controller 参数(T1 Step6)✓、前端 api(T2 Step1)✓、分类树+货号/材料列+布局(T2 Step2)✓、测试(T1)✓、不加颜色列(列定义无颜色)✓、StockOfAsync 不动(只改 ListAsync)✓。无遗漏。
- **占位符扫描**：无 TBD/TODO；每步含完整代码/命令/期望输出。
- **类型一致**：`ListAsync(仓库, keyword, 物料类别=null)` 接口/实现/调用一致；`MaterialStockRow` 后端 货号/物料类别 与前端类型一致；前端 `materialInventoryApi.list(仓库?,keyword?,物料类别?)` 与页面调用一致；树用 `materialMasterApi.categories()`→`MaterialCategoryNode{类别?,数量}`(已核实)。
```
