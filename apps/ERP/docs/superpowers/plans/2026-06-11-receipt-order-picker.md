# 采购入仓单 · 订单选择器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 采购入仓单录入行加"款号/订单选择器"：点款号弹出仅含欠数的已审核采购订单明细，选行带回填（订单单号/款号/物料/规格/颜色/单位，默认数量=欠数），并把订单单号持久化到采购入仓明细单，打通订单进度表。

**Architecture:** 后端给共享 `MaterialDocLineDto` 加可选 订单单号/生产单号/款号，`PurchaseReceiptService.CreateAsync` 写入 `采购入仓明细单`（领料/退料不动）。前端新增 `OrderLinePicker`（复用已有 `GET /purchase-orders/progress?onlyOwed=true` 端点，无新后端查询），`MaterialLineTable` 加开关 `enableOrderPicker`（仅采购入仓单开）渲染款号选择列，`MaterialDocCreateDrawer` 透传开关+供应商，`materialDocConfigs` 加 `orderPicker` flag。依据 `docs/superpowers/specs/2026-06-11-receipt-order-picker-design.md`。

**Tech Stack:** .NET 8 ASP.NET Core, Dapper, SQL Server LocalDB (erp/erp_test), xUnit + Xunit.SkippableFact, React 18 + TS + Vite + Ant Design v6。

---

## 前置约定

- 工作目录 `D:\WebpageERP`，已在分支 `feat-receipt-order-picker`。Windows PowerShell；`dotnet` 不在 PATH 时刷新：`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 测试环境变量：`$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")`、`$env:ERP_JWT_KEY = [Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")`。后端测试若 ErpApi.dll 被占用(dev server)，先停 5000 端口进程再编译。
- 跑后端测试：`dotnet test`；单类 `dotnet test --filter "FullyQualifiedName~ReceiptOrderLinkDbTests"`。前端：`npm --prefix web run build`、`npm --prefix web run test`。
- 提交规范：commit 末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 现有事实：
  - `MaterialDocLineDto`（`src/ErpApi/Features/Materials/MaterialDocLineDto.cs`）= ID/物料编号/物料名称/物料类别/规格/颜色/单位/数量/单价/金额/备注。
  - `PurchaseReceiptService.CreateAsync` 明细插入 `采购入仓明细单`（单号/日期/仓库/物料类别/物料编号/物料名称/规格/颜色/单位/数量/单价/金额/备注），未写 订单单号/生产单号/款号；`采购入仓明细单` 表有这三列。
  - `DocLine`（`web/src/utils/materialLines.ts`）= 物料编号/物料名称/物料类别/规格/颜色/单位/数量/单价/金额；`validLines` 过滤 物料编号 且 数量>0。
  - `MaterialDocCreateDrawer.submit` 把 `validLines(lines)` 原样作为 `明细` 提交（DocLine 加字段后自动透传）。
  - `purchaseOrderApi.progress(q)`（`web/src/api/purchaseOrders.ts`）→ `GET /purchase-orders/progress`，`ProgressQuery={供应商?,起?,止?,keyword?,onlyOwed?}`，返回 `PurchaseOrderProgressRow[]`（含 采购单号/生产单号/款号/物料编号/物料名称/物料类别/规格/颜色/单位/订购数量/入仓数量/欠数）。

---

## 文件结构

```
src/ErpApi/Features/Materials/
├─ MaterialDocLineDto.cs                改:+订单单号/生产单号/款号
└─ PurchaseReceipt/PurchaseReceiptService.cs  改:明细插入带这三列

tests/ErpApi.Tests/
└─ ReceiptOrderLinkDbTests.cs           新:持久化订单号 + 进度联动

web/src/
├─ utils/materialLines.ts               改:DocLine +订单单号/生产单号/款号
├─ pages/materials/OrderLinePicker.tsx  新:欠数订单明细选择器(复用 progress)
├─ pages/materials/MaterialLineTable.tsx 改:enableOrderPicker+供应商+款号列
├─ pages/materials/MaterialDocCreateDrawer.tsx 改:透传开关+供应商
└─ pages/materials/materialDocConfigs.ts 改:purchase-receipts orderPicker=true
```

---

## Task 1: 后端 — 明细持久化订单号 + 进度联动 DbTest

**Files:**
- Modify: `src/ErpApi/Features/Materials/MaterialDocLineDto.cs`, `src/ErpApi/Features/Materials/PurchaseReceipt/PurchaseReceiptService.cs`
- Test: `tests/ErpApi.Tests/ReceiptOrderLinkDbTests.cs`

- [ ] **Step 1: DTO 加三个可选字段**

在 `MaterialDocLineDto.cs` 的 `备注` 之后追加：

```csharp
    public string? 订单单号 { get; set; }   // 采购入仓:调入的采购订单号(领料/退料留空)
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
```

- [ ] **Step 2: 写失败的 DbTest**

Create `tests/ErpApi.Tests/ReceiptOrderLinkDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Materials;
using ErpApi.Features.Materials.PurchaseOrder;
using ErpApi.Features.Materials.PurchaseReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class ReceiptOrderLinkDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PurchaseReceiptService Receipt() => new(Factory(), new DocumentNumberGenerator());
    private PurchaseOrderService Order() => new(Factory(), new DocumentNumberGenerator());

    private static PurchaseReceiptCreateDto Dto(MaterialDocLineDto line) => new()
    {
        供应商编号 = "ROLSUP", 供应商名称 = "选单测试供应商", 仓库 = "物料仓", 明细 = [line],
    };

    [SkippableFact]
    public async Task Create_persists_order_fields_on_detail()
    {
        using var c = fx.Open();
        var 单号 = await Receipt().CreateAsync(Dto(new MaterialDocLineDto
        {
            物料编号 = "ROL01", 物料名称 = "选单料", 规格 = "规A", 颜色 = "红", 单位 = "米",
            数量 = 30, 单价 = 5, 订单单号 = "POROL1", 生产单号 = "MOROL", 款号 = "KROL",
        }), "tester");
        try
        {
            var row = await c.QueryFirstAsync(
                "SELECT [订单单号],[生产单号],[款号],[数量] FROM [采购入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            Assert.Equal("POROL1", (string)row.订单单号);
            Assert.Equal("MOROL", (string)row.生产单号);
            Assert.Equal("KROL", (string)row.款号);
            Assert.Equal(30m, (decimal)row.数量);
        }
        finally
        {
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=@n", new { n = 单号 });
        }
    }

    [SkippableFact]
    public async Task Create_without_order_fields_leaves_them_null()
    {
        using var c = fx.Open();
        var 单号 = await Receipt().CreateAsync(Dto(new MaterialDocLineDto
        { 物料编号 = "ROL02", 物料名称 = "无单料", 单位 = "米", 数量 = 10 }), "tester");
        try
        {
            var v = c.ExecuteScalar<string?>(
                "SELECT [订单单号] FROM [采购入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            Assert.Null(v);
        }
        finally
        {
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=@n", new { n = 单号 });
        }
    }

    [SkippableFact]
    public async Task Receipt_with_订单单号_feeds_order_progress()
    {
        using var c = fx.Open();
        // 种采购订单 POROL9(已审核) + 明细(物料 ROL09 红 订购100)
        c.Execute("DELETE FROM [采购明细单] WHERE [单号]='POROL9'");
        c.Execute("DELETE FROM [采购订单] WHERE [单号]='POROL9'");
        c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[供应商名称],[审核]) VALUES(N'POROL9',SYSDATETIME(),N'选单供应商','1')");
        c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[物料编号],[物料名称],[颜色],[单位],[数量])
                    VALUES(N'POROL9',SYSDATETIME(),N'ROL09',N'联动料',N'红',N'米',100)");
        var 单号 = await Receipt().CreateAsync(Dto(new MaterialDocLineDto
        { 物料编号 = "ROL09", 物料名称 = "联动料", 颜色 = "红", 单位 = "米", 数量 = 30, 订单单号 = "POROL9" }), "tester");
        try
        {
            // 入仓需已审核才计入进度
            c.Execute("UPDATE [采购入仓单] SET [审核]='1' WHERE [单号]=@n", new { n = 单号 });
            var rows = await Order().ProgressAsync(供应商: null, 起: null, 止: null, keyword: "ROL09", onlyOwed: false);
            var row = Assert.Single(rows);
            Assert.Equal(100m, row.订购数量);
            Assert.Equal(30m, row.入仓数量);   // 入仓带订单号→被进度表关联上
            Assert.Equal(70m, row.欠数);
        }
        finally
        {
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [采购明细单] WHERE [单号]='POROL9'");
            c.Execute("DELETE FROM [采购订单] WHERE [单号]='POROL9'");
        }
    }
}
```

注：`QueryFirstAsync` 返回 dynamic 需 `using Dapper;`（已 using）。

- [ ] **Step 3: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~ReceiptOrderLinkDbTests"`
Expected: FAIL（明细未写订单号 → 第1/3 个断言失败；或 DTO 缺字段编译错误已在 Step 1 解决）

- [ ] **Step 4: 服务写入三列**

在 `PurchaseReceiptService.cs` 的明细插入语句里，把列与值都补上 订单单号/生产单号/款号：

```csharp
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [采购入仓明细单]([单号],[订单单号],[生产单号],[款号],[日期],[仓库],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@订单单号,@生产单号,@款号,@日期,@仓库,@物料类别,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, l.订单单号, l.生产单号, l.款号, 日期 = now, dto.仓库, l.物料类别, l.物料编号, l.物料名称, l.规格, l.颜色, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注 }, tx);
```

- [ ] **Step 5: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~ReceiptOrderLinkDbTests"`
Expected: PASS 3 个

- [ ] **Step 6: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS（既有 PurchaseReceiptServiceDbTests 不受影响——新增列可空）

```powershell
git add src/ErpApi/Features/Materials/MaterialDocLineDto.cs src/ErpApi/Features/Materials/PurchaseReceipt/PurchaseReceiptService.cs tests/ErpApi.Tests/ReceiptOrderLinkDbTests.cs
git commit -m @'
feat(采购管理): 采购入仓明细持久化 订单单号/生产单号/款号(打通订单进度表入仓数量)+DbTest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 — DocLine 类型 + OrderLinePicker 组件

**Files:**
- Modify: `web/src/utils/materialLines.ts`
- Create: `web/src/pages/materials/OrderLinePicker.tsx`

- [ ] **Step 1: DocLine 加三个可选字段**

在 `web/src/utils/materialLines.ts` 的 `DocLine` 接口里追加（在 `金额?` 之后）：

```typescript
  订单单号?: string; 生产单号?: string; 款号?: string;
```

（`validLines`/`lineAmount`/`sumQty` 等不变；新增字段仅采购入仓单填，随明细体透传。）

- [ ] **Step 2: 写 OrderLinePicker**

Create `web/src/pages/materials/OrderLinePicker.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Input, Modal, Table } from "antd";
import { purchaseOrderApi, type PurchaseOrderProgressRow } from "../../api/purchaseOrders";

// 采购订单明细选择器：仅列已审核、有欠数的订单行(复用订单进度表端点)，点行返回。
export default function OrderLinePicker({ open, 供应商, onPick, onClose }: {
  open: boolean;
  供应商?: string;
  onPick: (row: PurchaseOrderProgressRow) => void;
  onClose: () => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<PurchaseOrderProgressRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await purchaseOrderApi.progress({
        onlyOwed: true,
        供应商: 供应商 || undefined,
        keyword: keyword.trim() || undefined,
      });
      setRows(r);
    } catch { /* 忽略 */ }
    finally { setLoading(false); }
  }, [供应商, keyword]);

  // 每次打开重新加载(供应商可能变)
  useEffect(() => { if (open) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = [
    { title: "订单单号", dataIndex: "采购单号", width: 130 },
    { title: "款号", dataIndex: "款号", width: 100 },
    { title: "物料编号", dataIndex: "物料编号", width: 110 },
    { title: "物料名称", dataIndex: "物料名称", width: 130 },
    { title: "规格", dataIndex: "规格", width: 90 },
    { title: "颜色", dataIndex: "颜色", width: 70 },
    { title: "单位", dataIndex: "单位", width: 56 },
    { title: "订购", dataIndex: "订购数量", width: 70, align: "right" as const },
    { title: "已入仓", dataIndex: "入仓数量", width: 72, align: "right" as const },
    {
      title: "欠数", dataIndex: "欠数", width: 70, align: "right" as const,
      render: (v?: number | null) => <b style={{ color: "#cf1322" }}>{v ?? 0}</b>,
    },
  ];

  return (
    <Modal title="选择采购订单明细（仅列欠数行）" open={open} onCancel={onClose} footer={null} width={940}>
      <Input.Search
        placeholder="款号/物料/生产单号" allowClear style={{ width: 260, marginBottom: 12 }}
        value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={load}
      />
      <Table
        size="small" rowKey={(_, i) => String(i)} loading={loading} dataSource={rows} columns={columns}
        scroll={{ x: true, y: 360 }} pagination={false}
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
git add web/src/utils/materialLines.ts web/src/pages/materials/OrderLinePicker.tsx
git commit -m @'
feat(采购管理): 订单明细选择器组件(复用progress端点列欠数行,点行返回)+DocLine加订单字段

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 前端 — LineTable 选择列 + Drawer 透传 + 配置 + 验证

**Files:**
- Modify: `web/src/pages/materials/MaterialLineTable.tsx`, `web/src/pages/materials/MaterialDocCreateDrawer.tsx`, `web/src/pages/materials/materialDocConfigs.ts`

- [ ] **Step 1: materialDocConfigs 加 orderPicker flag**

在 `web/src/pages/materials/materialDocConfigs.ts` 的 `MaterialDocCfg` 接口加可选字段：

```typescript
  orderPicker?: boolean;   // true=录入行支持"款号选采购订单"(仅采购入仓单)
```

并给 `purchase-receipts` 配置加 `orderPicker: true`（放在该对象内，例如 `title` 之后）：

```typescript
    resource: "purchase-receipts", menu: "采购入仓单", title: "采购入仓", orderPicker: true,
```

- [ ] **Step 2: MaterialLineTable 加选择列**

修改 `web/src/pages/materials/MaterialLineTable.tsx`：

(a) 顶部 import 追加：

```tsx
import { useState } from "react";
import OrderLinePicker from "./OrderLinePicker";
import type { PurchaseOrderProgressRow } from "../../api/purchaseOrders";
```

(b) 组件 props 解构加 `enableOrderPicker` 与 `供应商`：

```tsx
export default function MaterialLineTable({ materials, value, onChange, hidePriceCols, enableOrderPicker, 供应商 }: {
  materials: MaterialOption[];
  value: DocLine[];
  onChange: Dispatch<SetStateAction<DocLine[]>>;
  hidePriceCols: boolean;
  enableOrderPicker?: boolean;
  供应商?: string;
}) {
```

(c) 组件体顶部(在 `setLine` 之后)加选择器状态与回填：

```tsx
  const [pickFor, setPickFor] = useState<number | null>(null);

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
```

(d) `columns` 数组最前面(在 物料 列之前)插入"款号"列——仅启用时：

```tsx
  const columns = [
    ...(enableOrderPicker ? [{
      title: "款号", dataIndex: "款号", width: 130,
      render: (_: unknown, r: DocLine, i: number) => (
        <a onClick={() => setPickFor(i)}>{r.款号 ? r.款号 : "选订单"}</a>
      ),
    }] : []),
    {
      title: "物料", dataIndex: "物料编号", width: 220,
```

（其余列保持不变。）

(e) 在 `return` 的 `<div>` 内、`<Table .../>` 之后、`<Button .../>` 之后，加选择器 Modal：

```tsx
      <Button icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={() => onChange(prev => [...prev, { 数量: 0 }])}>加一行</Button>
      {enableOrderPicker && (
        <OrderLinePicker
          open={pickFor !== null}
          供应商={供应商}
          onPick={fillFromOrder}
          onClose={() => setPickFor(null)}
        />
      )}
```

- [ ] **Step 3: MaterialDocCreateDrawer 透传开关 + 供应商**

修改 `web/src/pages/materials/MaterialDocCreateDrawer.tsx`：

(a) `import { Form }` 已在;在组件内 `const [form]` 之后加监听供应商：

```tsx
  const 供应商编号 = Form.useWatch("供应商编号", form);
```

(b) 把 `MaterialLineTable` 调用改为传开关与供应商：

```tsx
      <MaterialLineTable
        materials={materials} value={lines} onChange={setLines} hidePriceCols={priceHidden}
        enableOrderPicker={cfg.orderPicker} 供应商={供应商编号 as string | undefined}
      />
```

（`submit` 不改——`validLines(lines)` 已把含 订单单号/生产单号/款号 的明细原样提交。）

- [ ] **Step 4: 构建确认**

Run: `npm --prefix web run build`
Expected: 成功（tsc 无类型错误）

- [ ] **Step 5: 前端单测回归**

Run: `npm --prefix web run test`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```powershell
git add web/src/pages/materials/MaterialLineTable.tsx web/src/pages/materials/MaterialDocCreateDrawer.tsx web/src/pages/materials/materialDocConfigs.ts
git commit -m @'
feat(采购管理): 采购入仓单录入行加"款号选采购订单"列(选欠数行带回填+暗存订单号),领料/退料不受影响

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

- [ ] **Step 7: 冒烟（可选，服务在跑时）**

后端 5000 / 前端 5173 运行中：浏览器 admin/admin123 → 采购管理/仓库管理 → 采购入仓单 → 新建：先确保有"已审核且有欠数"的采购订单；点录入行「选订单」→ 选一行 → 该行物料/规格/颜色/单位/数量(=欠数)被填、款号显示；保存后审核；到「订单进度表」查该物料，入仓数量应反映本次入仓。领料/退料新建无款号列、行为不变。

---

## Self-Review

- **Spec 覆盖**：明细持久化 订单单号/生产单号/款号 + 进度联动 → Task1；选择器组件(复用 progress) + DocLine 透传 → Task2；款号选择列 + Drawer 供应商透传 + 仅采购入仓单开 + 配置 flag → Task3。✓
- **占位符**：无 TBD/TODO；每步含完整代码/命令/预期。✓
- **类型一致**：后端 `MaterialDocLineDto` 三新字段(C#) ↔ 前端 `DocLine` 三新字段(TS) 同名；选择器 `onPick(PurchaseOrderProgressRow)` 的 `采购单号→订单单号` 映射在 `fillFromOrder` 完成；`MaterialDocCfg.orderPicker` Task3 定义并被 Drawer 读取传 `enableOrderPicker`。✓
- **关键坑**：①入仓需审核='1' 才被 ProgressAsync 计入(Task1 测试用 UPDATE 模拟审核)；②`enableOrderPicker` 默认 undefined→领料/退料不显示款号列、不渲染选择器 Modal、行为零变化；③选择器复用 progress 端点(onlyOwed=true)，无新后端查询；④DocLine 新字段随 `validLines` 透传，submit 不需改；⑤供应商用 `Form.useWatch` 取，空则选择器列全部欠数行。✓
- **范围**：录入行加选择器 + 后端持久化三列，聚焦；不整页重做、不改进度表口径。✓
