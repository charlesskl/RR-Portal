# 物料明细行 · 物料选择器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把共享物料明细行的"物料下拉框(前500条)"换成点击弹出的可搜索物料选择器(物料编号/名称/规格/材料/颜色/单位+只查有库存+分页),四种物料单据(领料/退料/采购入仓/采购退仓)一起受益。

**Architecture:** 后端给已有 `/api/material-master` 列表加 `onlyStock` 参数(无新端点)。前端新增 `MaterialPicker` 弹窗(复用 `materialMasterApi.list`),`MaterialLineTable` 把物料 Select 列换成可点单元格弹选择器,`MaterialDocCreateDrawer` 去掉预加载500条。依据 `docs/superpowers/specs/2026-06-12-material-picker-design.md`。

**Tech Stack:** .NET 8 ASP.NET Core, Dapper, SQL Server LocalDB (erp_test), xUnit + Xunit.SkippableFact, React 18 + TS + Vite + Ant Design v6。

---

## 前置约定

- 工作目录 `D:\WebpageERP`，已在分支 `feat-material-picker`。Windows PowerShell；`dotnet` 不在 PATH 时刷新：`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 测试环境变量：`$env:ERP_TEST_DB`/`$env:ERP_JWT_KEY` = `[Environment]::GetEnvironmentVariable("名","User")`。后端测试若 5000 端口 dev server 占用 ErpApi.dll → 先停该进程再编译。
- 跑后端测试：`dotnet test`；单类 `dotnet test --filter "FullyQualifiedName~MaterialMasterDbTests"`。前端：`npm --prefix web run build`、`npm --prefix web run test`。
- 提交规范：commit 末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 权限说明：选择器走 `/api/material-master`(菜单「物料资料·打开」门禁)——与现有下拉框数据源 `/api/master/materials`(同「物料资料·打开」)一致，无新增权限要求。
- 现有事实：
  - `MaterialMasterService.ListAsync(string? 类别, string? keyword, int page, int size)` → `PagedResult<MaterialRow>`；`MaterialRow` 含 ID/物料类别/物料编号/物料名称/规格/颜色/单位/单价/销售价/库存/最低库存/最高库存/供应商编号/供应商名称/备注。`物料资料` 表有 `库存` 列。
  - `MaterialMasterController.List(类别, keyword, page, size)` 调 `svc.ListAsync(...)`，无「单价」权限时剥离 单价/销售价。
  - `materialMasterApi.list(类别?, keyword?, page=1, size=50)`(`web/src/api/materialMaster.ts`)。
  - `MaterialLineTable`(`web/src/pages/materials/MaterialLineTable.tsx`)：props `{materials, value, onChange, hidePriceCols, enableOrderPicker?, 供应商?}`；物料列是 `Select`(用 `materials`)，`pickMaterial` 回填。已有「款号选订单」列(`enableOrderPicker` + `OrderLinePicker`)。
  - `MaterialDocCreateDrawer`：`useEffect` 里 `masterApi("materials").list(1,500)` → `materials` 状态 → 传给 LineTable。
  - `DocLine`(`web/src/utils/materialLines.ts`)：物料编号/物料名称/物料类别/规格/颜色/单位/数量/单价/金额/订单单号/生产单号/款号。

---

## 文件结构

```
src/ErpApi/Features/Materials/MaterialMaster/
├─ MaterialMasterService.cs     改:ListAsync 加 onlyStock 过滤
└─ MaterialMasterController.cs  改:List 加 onlyStock 参数透传
tests/ErpApi.Tests/MaterialMasterDbTests.cs  改:+onlyStock 用例

web/src/
├─ api/materialMaster.ts        改:list 加 onlyStock 尾参
├─ pages/materials/MaterialPicker.tsx        新:可搜索物料选择器弹窗
├─ pages/materials/MaterialLineTable.tsx     改:物料列换可点单元格+选择器
└─ pages/materials/MaterialDocCreateDrawer.tsx 改:去预加载500条
```

---

## Task 1: 后端 ListAsync 加 onlyStock + DbTest

**Files:**
- Modify: `src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterService.cs`, `src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterController.cs`
- Test: `tests/ErpApi.Tests/MaterialMasterDbTests.cs`

- [ ] **Step 1: 写失败的 DbTest**

在 `tests/ErpApi.Tests/MaterialMasterDbTests.cs` 的类里追加（该类已有 `Seed`/`Cleanup`：种 MM001(库存100)/MM002(库存0)/MM003(库存500)/MM999(无类别,库存0)，`Svc()`/`fx`）：

```csharp
    [SkippableFact]
    public async Task List_onlyStock_excludes_zero_stock()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var all = await Svc().ListAsync(null, "MM00", 1, 50, onlyStock: false);
            Assert.Contains(all.Items, r => r.物料编号 == "MM002");   // 库存0,不过滤时在

            var inStock = await Svc().ListAsync(null, "MM00", 1, 50, onlyStock: true);
            Assert.Contains(inStock.Items, r => r.物料编号 == "MM001");   // 库存100
            Assert.Contains(inStock.Items, r => r.物料编号 == "MM003");   // 库存500
            Assert.DoesNotContain(inStock.Items, r => r.物料编号 == "MM002");   // 库存0被滤
        }
        finally { Cleanup(c); }
    }
```

注：现有其它测试调用 `ListAsync(类别, keyword, page, size)`（不带 onlyStock）；Step 3 给 onlyStock 默认值 `= false`，旧调用不受影响。

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~MaterialMasterDbTests"`
Expected: FAIL（`ListAsync` 无 onlyStock 形参，编译错误）

- [ ] **Step 3: ListAsync 加 onlyStock**

把 `MaterialMasterService.cs` 的 `ListAsync` 签名与 SQL 改为带 onlyStock 过滤（COUNT 与分页两段 WHERE 都加，参数对象加 onlyStock）：

```csharp
    public async Task<PagedResult<MaterialRow>> ListAsync(string? 类别, string? keyword, int page, int size, bool onlyStock = false)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var cat = string.IsNullOrWhiteSpace(类别) ? null : 类别.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [物料资料]
WHERE (@cat IS NULL OR [物料类别] = @cat)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [规格] LIKE @kw OR [颜色] LIKE @kw OR [供应商名称] LIKE @kw)
  AND (@onlyStock = 0 OR ISNULL([库存],0) > 0);
SELECT [ID],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[单价],[销售价],[库存],[最低库存],[最高库存],[供应商编号],[供应商名称],[备注]
FROM [物料资料]
WHERE (@cat IS NULL OR [物料类别] = @cat)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [规格] LIKE @kw OR [颜色] LIKE @kw OR [供应商名称] LIKE @kw)
  AND (@onlyStock = 0 OR ISNULL([库存],0) > 0)
ORDER BY [物料编号] OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { cat, kw, page, size, onlyStock = onlyStock ? 1 : 0 });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<MaterialRow>()).AsList();
        return new PagedResult<MaterialRow>(items, total);
    }
```

- [ ] **Step 4: 控制器透传 onlyStock**

把 `MaterialMasterController.cs` 的 `List` 改为：

```csharp
    [HttpGet]
    public async Task<IActionResult> List(string? 类别 = null, string? keyword = null, int page = 1, int size = 20, bool onlyStock = false)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(类别, keyword, page, size, onlyStock);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in result.Items) { r.单价 = null; r.销售价 = null; }
        return Ok(result);
    }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~MaterialMasterDbTests"`
Expected: PASS（含新 onlyStock 用例 + 原有用例）

- [ ] **Step 6: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterService.cs src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterController.cs tests/ErpApi.Tests/MaterialMasterDbTests.cs
git commit -m @'
feat(物料): 物料资料列表加 onlyStock 过滤(只查有库存)+DbTest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 api onlyStock + MaterialPicker 组件

**Files:**
- Modify: `web/src/api/materialMaster.ts`
- Create: `web/src/pages/materials/MaterialPicker.tsx`

- [ ] **Step 1: api list 加 onlyStock**

把 `web/src/api/materialMaster.ts` 的 `list` 改为带 `onlyStock` 尾参：

```typescript
  list: (类别?: string, keyword?: string, page = 1, size = 50, onlyStock?: boolean) =>
    api.get<Paged<MaterialRow>>("/material-master", { params: { 类别, keyword, page, size, onlyStock } }).then(r => r.data),
```

（`MaterialMasterPage` 调 `list(类别, keyword, page, size)` 不传 onlyStock，`undefined` 不会作为查询参数发出，后端默认 false，不受影响。）

- [ ] **Step 2: 写 MaterialPicker**

Create `web/src/pages/materials/MaterialPicker.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Checkbox, Input, Modal, Table } from "antd";
import { materialMasterApi, type MaterialRow } from "../../api/materialMaster";

// 物料选择器：可搜索物料资料列表(复用 /api/material-master)，点行返回该物料。
export default function MaterialPicker({ open, hidePriceCols, onPick, onClose }: {
  open: boolean;
  hidePriceCols?: boolean;
  onPick: (row: MaterialRow) => void;
  onClose: () => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [onlyStock, setOnlyStock] = useState(false);
  const [rows, setRows] = useState<MaterialRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const r = await materialMasterApi.list(undefined, keyword.trim() || undefined, p, 50, onlyStock || undefined);
      setRows(r.items); setTotal(r.total);
    } catch { /* 忽略 */ }
    finally { setLoading(false); }
  }, [keyword, onlyStock]);

  // 打开 / 切换只查有库存 时重查(回第1页)；关键字由搜索框显式触发
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setPage(1); load(1); } }, [open, onlyStock]);

  const search = () => { setPage(1); load(1); };

  const columns = [
    { title: "物料编号", dataIndex: "物料编号", width: 120 },
    { title: "物料名称", dataIndex: "物料名称", width: 150 },
    { title: "规格", dataIndex: "规格", width: 110 },
    { title: "材料", dataIndex: "物料类别", width: 90 },
    { title: "颜色", dataIndex: "颜色", width: 80 },
    { title: "单位", dataIndex: "单位", width: 60 },
    { title: "库存", dataIndex: "库存", width: 80, align: "right" as const, render: (v?: number | null) => v ?? "" },
    ...(hidePriceCols ? [] : [
      { title: "单价", dataIndex: "单价", width: 90, align: "right" as const, render: (v?: number | null) => v ?? "" },
    ]),
  ];

  return (
    <Modal title="选择物料" open={open} onCancel={onClose} footer={null} width={900}>
      <div style={{ marginBottom: 12, display: "flex", gap: 12, alignItems: "center" }}>
        <Input.Search
          placeholder="物料编号/名称/规格/颜色/供应商" allowClear style={{ width: 280 }}
          value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={search}
        />
        <Checkbox checked={onlyStock} onChange={e => setOnlyStock(e.target.checked)}>只查有库存</Checkbox>
      </div>
      <Table
        size="small" rowKey="ID" loading={loading} dataSource={rows} columns={columns} scroll={{ x: true, y: 380 }}
        pagination={{ current: page, pageSize: 50, total, showSizeChanger: false,
          onChange: p => { setPage(p); load(p); }, showTotal: t => `共 ${t} 条` }}
        onRow={r => ({ onClick: () => { onPick(r); onClose(); }, style: { cursor: "pointer" } })}
      />
    </Modal>
  );
}
```

- [ ] **Step 3: 构建确认**

Run: `npm --prefix web run build`
Expected: 成功（tsc 无类型错误）

- [ ] **Step 4: 提交**

```powershell
git add web/src/api/materialMaster.ts web/src/pages/materials/MaterialPicker.tsx
git commit -m @'
feat(物料): 物料选择器组件(可搜索物料资料+只查有库存+分页,复用material-master)+api加onlyStock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: MaterialLineTable 换选择器 + Drawer 去预加载

**Files:**
- Modify: `web/src/pages/materials/MaterialLineTable.tsx`, `web/src/pages/materials/MaterialDocCreateDrawer.tsx`

- [ ] **Step 1: 改 MaterialLineTable**

把 `web/src/pages/materials/MaterialLineTable.tsx` 整体替换为（去掉 `materials` prop/`Select`/`pickMaterial`，物料列改可点单元格 + 物料选择器；保留既有 款号选订单 列与价格/数量/颜色/删除列）：

```tsx
import { useState, type Dispatch, type SetStateAction } from "react";
import { Button, Input, InputNumber, Table } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { lineAmount, type DocLine } from "../../utils/materialLines";
import OrderLinePicker from "./OrderLinePicker";
import MaterialPicker from "./MaterialPicker";
import type { PurchaseOrderProgressRow } from "../../api/purchaseOrders";
import type { MaterialRow } from "../../api/materialMaster";

// 受控物料明细行编辑表；物料点击弹选择器带出名称/规格/单位/单价；可选款号选订单。
export default function MaterialLineTable({ value, onChange, hidePriceCols, enableOrderPicker, 供应商 }: {
  value: DocLine[];
  onChange: Dispatch<SetStateAction<DocLine[]>>;
  hidePriceCols: boolean;
  enableOrderPicker?: boolean;
  供应商?: string;
}) {
  const setLine = (i: number, patch: Partial<DocLine>) =>
    onChange(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const [pickFor, setPickFor] = useState<number | null>(null);       // 款号选订单
  const [matPickFor, setMatPickFor] = useState<number | null>(null); // 物料选择器

  const fillFromOrder = (row: PurchaseOrderProgressRow) => {
    if (pickFor === null) return;
    setLine(pickFor, {
      订单单号: row.采购单号 ?? undefined,
      生产单号: row.生产单号 ?? undefined,
      款号: row.款号 ?? undefined,
      物料编号: row.物料编号 ?? undefined,
      物料名称: row.物料名称 ?? undefined,
      物料类别: row.物料类别 ?? undefined,
      规格: row.规格 ?? undefined,
      颜色: row.颜色 ?? undefined,
      单位: row.单位 ?? undefined,
      数量: Number(row.欠数 ?? 0),
    });
  };

  const fillFromMaterial = (row: MaterialRow) => {
    if (matPickFor === null) return;
    setLine(matPickFor, {
      物料编号: row.物料编号 ?? undefined,
      物料名称: row.物料名称 ?? undefined,
      物料类别: row.物料类别 ?? undefined,
      规格: row.规格 ?? undefined,
      颜色: row.颜色 ?? undefined,
      单位: row.单位 ?? undefined,
      单价: hidePriceCols ? null : (row.单价 ?? null),
    });
  };

  const columns = [
    ...(enableOrderPicker ? [{
      title: "款号", dataIndex: "款号", width: 130,
      render: (_: unknown, r: DocLine, i: number) => (
        <a onClick={() => setPickFor(i)}>{r.款号 ? r.款号 : "选订单"}</a>
      ),
    }] : []),
    {
      title: "物料", dataIndex: "物料编号", width: 220,
      render: (_: unknown, r: DocLine, i: number) => (
        <a onClick={() => setMatPickFor(i)}>
          {r.物料编号 ? `${r.物料编号} ${r.物料名称 ?? ""}` : "选物料"}
        </a>
      ),
    },
    { title: "规格", dataIndex: "规格", width: 110, render: (v: string) => v ?? "" },
    {
      title: "颜色", dataIndex: "颜色", width: 100,
      render: (_: unknown, r: DocLine, i: number) => (
        <Input style={{ width: 90 }} value={r.颜色 ?? ""} onChange={e => setLine(i, { 颜色: e.target.value })} />
      ),
    },
    { title: "单位", dataIndex: "单位", width: 70, render: (v: string) => v ?? "" },
    {
      title: "数量", dataIndex: "数量", width: 110,
      render: (_: unknown, r: DocLine, i: number) => (
        <InputNumber min={0} precision={2} style={{ width: 96 }} value={r.数量 ?? 0}
          onChange={n => setLine(i, { 数量: Number(n ?? 0) })} />
      ),
    },
    ...(hidePriceCols ? [] : [
      {
        title: "单价", dataIndex: "单价", width: 110,
        render: (_: unknown, r: DocLine, i: number) => (
          <InputNumber min={0} precision={4} style={{ width: 96 }} value={r.单价 ?? 0}
            onChange={n => setLine(i, { 单价: Number(n ?? 0) })} />
        ),
      },
      { title: "金额", dataIndex: "_amt", width: 100, render: (_: unknown, r: DocLine) => lineAmount(r).toFixed(2) },
    ]),
    {
      title: "", key: "_op", width: 50,
      render: (_: unknown, __: DocLine, i: number) => <a onClick={() => onChange(prev => prev.filter((_, j) => j !== i))}>删除</a>,
    },
  ];

  return (
    <div>
      <Table size="small" rowKey={(_: DocLine, i?: number) => String(i)} pagination={false} dataSource={value} columns={columns} />
      <Button icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={() => onChange(prev => [...prev, { 数量: 0 }])}>加一行</Button>
      <MaterialPicker
        open={matPickFor !== null} hidePriceCols={hidePriceCols}
        onPick={fillFromMaterial} onClose={() => setMatPickFor(null)}
      />
      {enableOrderPicker && (
        <OrderLinePicker
          open={pickFor !== null} 供应商={供应商}
          onPick={fillFromOrder} onClose={() => setPickFor(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: 改 MaterialDocCreateDrawer 去预加载**

修改 `web/src/pages/materials/MaterialDocCreateDrawer.tsx`：

(a) 删除 `materials` 状态与其预加载。当前：
```tsx
  const [materials, setMaterials] = useState<Record<string, unknown>[]>([]);
  const [lines, setLines] = useState<DocLine[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const r = await masterApi("materials").list(1, 500);
        setMaterials(r.items as Record<string, unknown>[]);
        if (r.total > 500) message.warning("物料超过500条，仅加载前500条");
      } catch { message.error("加载物料数据失败"); }
    })();
    form.resetFields(); setLines([]);
  }, [open, form, cfg.resource]);
```
改为（去掉 materials 状态与物料预加载，仅保留打开时重置表单/行）：
```tsx
  const [lines, setLines] = useState<DocLine[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.resetFields(); setLines([]);
  }, [open, form, cfg.resource]);
```

(b) 删除不再使用的 `masterApi` import（顶部 `import { masterApi } from "../../api/master";` 若仅此处用则删除；若文件别处仍用则保留）。检查：本文件仅在预加载处用 `masterApi`，删除该 import。

(c) `MaterialLineTable` 调用去掉 `materials`：
```tsx
      <MaterialLineTable
        value={lines} onChange={setLines} hidePriceCols={priceHidden}
        enableOrderPicker={cfg.orderPicker} 供应商={供应商编号 as string | undefined}
      />
```

- [ ] **Step 3: 构建确认**

Run: `npm --prefix web run build`
Expected: 成功（tsc 无类型错误；确认无 `materials`/`masterApi` 未用报错）

- [ ] **Step 4: 前端单测回归**

Run: `npm --prefix web run test`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```powershell
git add web/src/pages/materials/MaterialLineTable.tsx web/src/pages/materials/MaterialDocCreateDrawer.tsx
git commit -m @'
feat(物料): 录入行物料列改点击弹选择器(替换前500下拉框),Drawer去预加载;四单据共享

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

- [ ] **Step 6: 冒烟（可选，服务在跑时）**

后端 5000 / 前端 5173：浏览器 admin/admin123 → 任一物料单据(领料/退料/采购入仓/采购退仓) 新建 → 加一行 → 点「选物料」弹选择器，搜索/勾只查有库存/翻页/选行 → 该行 物料编号+名称/规格/单位/单价 被填;采购入仓/退仓 的「款号选订单」列仍可用。

---

## Self-Review

- **Spec 覆盖**：onlyStock 后端过滤 → Task1；api onlyStock + MaterialPicker 组件 → Task2；LineTable 换选择器 + Drawer 去预加载 → Task3。✓
- **占位符**：无 TBD/TODO；每步含完整代码/命令/预期。✓
- **类型一致**：后端 `ListAsync(...,bool onlyStock=false)`(Task1) ↔ 前端 `materialMasterApi.list(...,onlyStock?)`(Task2) ↔ `MaterialPicker` 用之(Task2) ↔ `MaterialLineTable.fillFromMaterial(MaterialRow)`(Task3)；`MaterialRow` 字段(物料编号/名称/物料类别/规格/颜色/单位/单价)在选择器列与回填一致。✓
- **关键坑**：①onlyStock 默认 false，旧调用(MaterialMasterPage/现有测试)不受影响；②LineTable 去 `materials` prop 后唯一调用方 MaterialDocCreateDrawer 同步去预加载+去 masterApi import(否则 tsc 报未用)；③物料选择器与既有款号选订单(enableOrderPicker)两套 pick 状态分开(matPickFor/pickFor);④选择器权限门禁「物料资料·打开」与原下拉框数据源一致,无回归;⑤价格脱敏:回填单价在 hidePriceCols 时置 null。✓
- **范围**：共享录入行换选择器 + 后端一个参数,聚焦。✓
