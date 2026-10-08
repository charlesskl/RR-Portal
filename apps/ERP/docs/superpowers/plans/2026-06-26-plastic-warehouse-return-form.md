# 塑胶退仓单 保真重做(全屏主从录入页)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 照塑胶领料单模板把塑胶退仓单换成专用全屏主从录入页(供应商🔍头+出库单号/入仓单号🔍带出+保真明细含单价/金额+底部数量金额+历史列表),后端补头/明细列;库存方向(退仓 −)/STC单号/审核/成本脱敏全不变。

**Architecture:** 后端 `塑胶退仓单`/`塑胶退仓明细单` 两表 ALTER ADD 新列,`PlasticWarehouseReturnService` INSERT/SELECT 与 DTO 带新列,其余不动。入仓带出与供应商选择全在前端复用已有端点(`plastic-receipts` list/get、`master/suppliers`)。前端新建专用页替换 `/plastic-warehouse-returns` 路由。

**Tech Stack:** .NET 8 + Dapper + SQL Server LocalDB;React 18 + TS + Vite + Ant Design v6 + Vitest。

---

## 前置约定

- 工作目录 `D:\WebpageERP`,分支 `feat-plastic-wh-return-form`,完成 `--no-ff` 合并 master 删分支。PowerShell;`dotnet` 不在 PATH:`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 测试 env(空时)从 User 取:`$env:ERP_TEST_DB`/`$env:ERP_JWT_KEY`/`$env:ERP_DB`。后端测试 `dotnet test`(锁 DLL 用 `-c Release`)。前端 `npm --prefix web run test`/`build`。
- 提交末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。LF→CRLF 警告正常。
- 镜像源:`web/src/pages/plastics/PlasticIssueFormPage.tsx` + `PlasticIssueLineTable.tsx`(领料单保真页,本单同构);`web/src/pages/materials/EmployeePicker.tsx`(选择器结构,SupplierPicker 照此);`web/src/api/plasticDocs.ts`(`plasticDocApi("plastic-receipts")` 复用拉入仓单);`web/src/api/master.ts`(`masterApi("suppliers")`)。脱敏 `hidePrice(perms, menu)`(`web/src/auth/permissions.ts`)。
- 供应商资料字段:供应商编号/供应商名称(`api/master/suppliers`)。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `db/23_plastic_warehouse_return_form.sql` | 塑胶退仓单/明细 ALTER ADD 新列(幂等) | 新建 |
| `src/ErpApi/Features/Plastics/PlasticWarehouseReturn/PlasticWarehouseReturnDtos.cs` | 头/明细 DTO 补字段 | 改 |
| `src/ErpApi/Features/Plastics/PlasticWarehouseReturn/PlasticWarehouseReturnService.cs` | INSERT/SELECT 带新列 | 改 |
| `tests/ErpApi.Tests/PlasticWarehouseReturnFormDbTests.cs` | 新字段往返测试 | 新建 |
| `web/src/pages/plastics/SupplierPicker.tsx` | 供应商🔍选择器 | 新建 |
| `web/src/pages/plastics/PlasticReceiptPicker.tsx` | 入仓单🔍选择器 | 新建 |
| `web/src/api/plasticWarehouseReturn.ts` | 退仓 typed API(含新字段) | 新建 |
| `web/src/pages/plastics/PlasticWarehouseReturnLineTable.tsx` | 左明细可编辑网格(含单价/金额脱敏) | 新建 |
| `web/src/pages/plastics/PlasticWarehouseReturnFormPage.tsx` | 全屏主从录入页 | 新建 |
| `web/src/App.tsx` | `/plastic-warehouse-returns` 路由换新页 | 改 |

---

## Task 1: 建表脚本(ALTER ADD)+ 应用两库

**Files:** Create `db/23_plastic_warehouse_return_form.sql`

- [ ] **Step 1: 写脚本** `db/23_plastic_warehouse_return_form.sql`:

```sql
-- 塑胶退仓单保真重做:头补 出库单号/入仓单号/电脑单号;明细补 生产单号/款号/塑胶货号。幂等。
SET XACT_ABORT ON;
IF COL_LENGTH(N'塑胶退仓单', N'出库单号') IS NULL ALTER TABLE [塑胶退仓单] ADD [出库单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶退仓单', N'入仓单号') IS NULL ALTER TABLE [塑胶退仓单] ADD [入仓单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶退仓单', N'电脑单号') IS NULL ALTER TABLE [塑胶退仓单] ADD [电脑单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶退仓明细单', N'生产单号') IS NULL ALTER TABLE [塑胶退仓明细单] ADD [生产单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶退仓明细单', N'款号')     IS NULL ALTER TABLE [塑胶退仓明细单] ADD [款号] nvarchar(40) NULL;
IF COL_LENGTH(N'塑胶退仓明细单', N'塑胶货号') IS NULL ALTER TABLE [塑胶退仓明细单] ADD [塑胶货号] nvarchar(40) NULL;
```

- [ ] **Step 2: 应用两库**(PowerShell):

```powershell
foreach ($V in "ERP_DB","ERP_TEST_DB") {
  $cs = [Environment]::GetEnvironmentVariable($V,"User")
  $c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
  $cmd = $c.CreateCommand(); $cmd.CommandText = [IO.File]::ReadAllText((Resolve-Path "db/23_plastic_warehouse_return_form.sql")); $null = $cmd.ExecuteNonQuery()
  $c.Close(); Write-Output "$V ok"
}
```
Expected: `ERP_DB ok` 和 `ERP_TEST_DB ok`。

- [ ] **Step 3: 验证列**(PowerShell):

```powershell
$cs = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
$c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
$cmd = $c.CreateCommand()
$cmd.CommandText = "SELECT (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'塑胶退仓单') AND name IN (N'出库单号',N'入仓单号',N'电脑单号')) AS h, (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'塑胶退仓明细单') AND name IN (N'生产单号',N'款号',N'塑胶货号')) AS d"
$r = $cmd.ExecuteReader(); $r.Read(); Write-Output ("header=" + $r["h"] + " detail=" + $r["d"]); $c.Close()
```
Expected: `header=3 detail=3`。

- [ ] **Step 4: Commit**

```powershell
git add db/23_plastic_warehouse_return_form.sql
git commit -m @'
feat(塑胶退仓单保真): 头/明细补原系统字段(ALTER ADD 幂等)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 后端 DTO + Service 带新字段 + 往返测试

**Files:** Modify `PlasticWarehouseReturnDtos.cs`, `PlasticWarehouseReturnService.cs`; Create `tests/ErpApi.Tests/PlasticWarehouseReturnFormDbTests.cs`

- [ ] **Step 1: 替换整个 DTO 文件** `src/ErpApi/Features/Plastics/PlasticWarehouseReturn/PlasticWarehouseReturnDtos.cs`:

```csharp
namespace ErpApi.Features.Plastics.PlasticWarehouseReturn;

public sealed class PlasticWarehouseReturnHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
    public string? 出库单号 { get; set; }
    public string? 入仓单号 { get; set; }
    public string? 电脑单号 { get; set; }
}

public sealed class PlasticWarehouseReturnLineDto
{
    public long ID { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticWarehouseReturnDetailDto
{
    public PlasticWarehouseReturnHeaderDto? 单头 { get; set; }
    public List<PlasticWarehouseReturnLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticWarehouseReturnCreateLineDto
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticWarehouseReturnCreateDto
{
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public string? 出库单号 { get; set; }
    public string? 入仓单号 { get; set; }
    public string? 电脑单号 { get; set; }
    public List<PlasticWarehouseReturnCreateLineDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 2: 改 Service 头 INSERT** 在 `PlasticWarehouseReturnService.cs`,把头表 INSERT 块替换为:

```csharp
        await c.ExecuteAsync(@"
INSERT INTO [塑胶退仓单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[备注],[出库单号],[入仓单号],[电脑单号])
VALUES(@单号,@日期,@供应商编号,@供应商名称,@仓库,@数量,@金额,@操作员,'0',@备注,@出库单号,@入仓单号,@电脑单号)",
            new { 单号, 日期 = now, dto.供应商编号, dto.供应商名称, dto.仓库, 数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注,
                  dto.出库单号, dto.入仓单号, dto.电脑单号 }, tx);
```

- [ ] **Step 3: 改 Service 明细 INSERT** 把明细 INSERT 块替换为:

```csharp
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [塑胶退仓明细单]([单号],[日期],[仓库],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[塑胶货号],[仓位号],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@日期,@仓库,@生产单号,@款号,@物料编号,@物料名称,@规格,@颜色,@塑胶货号,@仓位号,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, 日期 = now, dto.仓库, l.生产单号, l.款号, l.物料编号, l.物料名称, l.规格, l.颜色, l.塑胶货号, l.仓位号, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注 }, tx);
```

- [ ] **Step 4: 改 Service GetAsync 两个 SELECT** 把 GetAsync 的 QueryMultipleAsync 替换为:

```csharp
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注],[出库单号],[入仓单号],[电脑单号]
FROM [塑胶退仓单] WHERE [单号]=@单号;
SELECT [ID],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[塑胶货号],[仓位号],[单位],[数量],[单价],[金额],[备注]
FROM [塑胶退仓明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
```

(ListAsync/DeleteAsync 不改。)

- [ ] **Step 5: 写往返测试** Create `tests/ErpApi.Tests/PlasticWarehouseReturnFormDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticWarehouseReturn;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticWarehouseReturnFormDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticWarehouseReturnService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Create_persists_new_header_and_line_fields_then_Get_reads_back()
    {
        using var c = fx.Open();
        var 单号 = await Svc().CreateAsync(new PlasticWarehouseReturnCreateDto
        {
            供应商编号 = "S01", 供应商名称 = "宏达塑料", 仓库 = "塑胶仓",
            出库单号 = "CK-01", 入仓单号 = "SR-OLD-01", 电脑单号 = "PC-02",
            明细 =
            [
                new PlasticWarehouseReturnCreateLineDto
                {
                    生产单号 = "MO-002", 款号 = "K200", 物料编号 = "PWRM01", 物料名称 = "ABS粒",
                    规格 = "规A", 颜色 = "黑", 塑胶货号 = "H-9", 单位 = "kg", 数量 = 6, 单价 = 7
                }
            ]
        }, "tester");
        try
        {
            Assert.StartsWith("STC", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.Equal("CK-01", d!.单头!.出库单号);
            Assert.Equal("SR-OLD-01", d.单头!.入仓单号);
            Assert.Equal("PC-02", d.单头!.电脑单号);
            var l = Assert.Single(d.明细);
            Assert.Equal("MO-002", l.生产单号);
            Assert.Equal("K200", l.款号);
            Assert.Equal("H-9", l.塑胶货号);
            Assert.Equal(42m, l.金额);   // 6×7
        }
        finally { c.Execute("DELETE FROM [塑胶退仓明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶退仓单] WHERE [单号]=@n", new { n = 单号 }); }
    }
}
```

- [ ] **Step 6: 跑测试 + 全量回归**

Run: `dotnet test --filter "FullyQualifiedName~PlasticWarehouseReturnFormDbTests"` → PASS 1。
Run: `dotnet test` → 全绿(358 起;现有 `PlasticReturnScrapServiceDbTests` 仍绿,新列可空)。报告总数行。

- [ ] **Step 7: Commit**

```powershell
git add src/ErpApi/Features/Plastics/PlasticWarehouseReturn tests/ErpApi.Tests/PlasticWarehouseReturnFormDbTests.cs
git commit -m @'
feat(塑胶退仓单保真): 后端DTO+Service带新头/明细字段+往返测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 前端 选择器×2 + typed API + 明细网格

**Files:** Create `SupplierPicker.tsx`, `PlasticReceiptPicker.tsx`, `api/plasticWarehouseReturn.ts`, `PlasticWarehouseReturnLineTable.tsx`

- [ ] **Step 1: SupplierPicker** `web/src/pages/plastics/SupplierPicker.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Input, message, Modal, Table } from "antd";
import { masterApi } from "../../api/master";

export interface SupplierRow { 供应商编号?: string; 供应商名称?: string }

// 供应商选择器:搜供应商资料,点行返回 编号+名称。
export default function SupplierPicker({ open, onPick, onClose }: {
  open: boolean; onPick: (row: SupplierRow) => void; onClose: () => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows((await masterApi("suppliers").list(1, 200, keyword.trim())).items as SupplierRow[]); }
    catch { message.error("加载供应商资料失败"); }
    finally { setLoading(false); }
  }, [keyword]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) load(); }, [open]);

  const columns = [
    { title: "供应商编号", dataIndex: "供应商编号", width: 130 },
    { title: "供应商名称", dataIndex: "供应商名称", width: 220 },
  ];
  return (
    <Modal title="选择供应商" open={open} onCancel={onClose} footer={null} width={560}>
      <Input.Search placeholder="编号/名称" allowClear style={{ width: 220, marginBottom: 12 }}
        value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={load} />
      <Table size="small" rowKey={(_, i) => String(i)} loading={loading} dataSource={rows} columns={columns}
        scroll={{ y: 360 }} pagination={false}
        onRow={r => ({ onClick: () => { onPick(r); onClose(); }, style: { cursor: "pointer" } })} />
    </Modal>
  );
}
```

- [ ] **Step 2: PlasticReceiptPicker** `web/src/pages/plastics/PlasticReceiptPicker.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Input, message, Modal, Table, Tag } from "antd";
import { plasticDocApi, type PlasticDocHeader } from "../../api/plasticDocs";

// 塑胶入仓单选择器:列已审核的塑胶入仓单,点行返回单号(调用方再 get 拉明细带出)。
export default function PlasticReceiptPicker({ open, onPick, onClose }: {
  open: boolean; onPick: (单号: string) => void; onClose: () => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<PlasticDocHeader[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await plasticDocApi("plastic-receipts").list(1, 50, keyword.trim());
      setRows(r.items.filter(h => h.审核 === "1"));
    } catch { message.error("加载塑胶入仓单失败"); }
    finally { setLoading(false); }
  }, [keyword]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) load(); }, [open]);

  const columns = [
    { title: "入仓单号", dataIndex: "单号", width: 150 },
    { title: "供应商", dataIndex: "供应商名称", width: 160 },
    { title: "仓库", dataIndex: "仓库", width: 90 },
    { title: "数量", dataIndex: "数量", width: 80 },
    { title: "日期", dataIndex: "日期", width: 110, render: (v?: string) => v?.slice(0, 10) },
    { title: "状态", dataIndex: "审核", width: 80, render: () => <Tag color="green">已审核</Tag> },
  ];
  return (
    <Modal title="选择塑胶入仓单（仅已审核）" open={open} onCancel={onClose} footer={null} width={760}>
      <Input.Search placeholder="单号/供应商" allowClear style={{ width: 240, marginBottom: 12 }}
        value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={load} />
      <Table size="small" rowKey="id" loading={loading} dataSource={rows} columns={columns}
        scroll={{ y: 360 }} pagination={false}
        onRow={r => ({ onClick: () => { onPick(r.单号 ?? ""); onClose(); }, style: { cursor: "pointer" } })} />
    </Modal>
  );
}
```

- [ ] **Step 3: typed API** `web/src/api/plasticWarehouseReturn.ts`:

```typescript
import { api } from "./client";
import type { Paged } from "./master";

export interface PWRLine {
  id?: number;
  生产单号?: string; 款号?: string; 物料编号?: string; 物料名称?: string; 规格?: string; 颜色?: string;
  塑胶货号?: string; 仓位号?: string; 单位?: string; 数量?: number; 单价?: number | null; 金额?: number | null; 备注?: string;
}
export interface PWRHeader {
  id: number; 单号?: string; 日期?: string; 供应商编号?: string; 供应商名称?: string; 仓库?: string;
  数量?: number | null; 金额?: number | null; 操作员?: string; 审核?: string; 审核人?: string; 备注?: string;
  出库单号?: string; 入仓单号?: string; 电脑单号?: string;
}
export interface PWRDetail { 单头?: PWRHeader; 明细: PWRLine[] }

const enc = encodeURIComponent;
export const plasticWarehouseReturnApi = {
  list: (page = 1, size = 10, keyword = "") => api.get<Paged<PWRHeader>>("/plastic-warehouse-returns", { params: { page, size, keyword } }).then(r => r.data),
  get: (单号: string) => api.get<PWRDetail>(`/plastic-warehouse-returns/${enc(单号)}`).then(r => r.data),
  create: (body: Record<string, unknown>) => api.post<{ 单号: string }>("/plastic-warehouse-returns", body).then(r => r.data),
  remove: (单号: string) => api.delete(`/plastic-warehouse-returns/${enc(单号)}`),
  approve: (单号: string) => api.post(`/plastic-warehouse-returns/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/plastic-warehouse-returns/${enc(单号)}/unapprove`),
};
```

- [ ] **Step 4: 明细网格** `web/src/pages/plastics/PlasticWarehouseReturnLineTable.tsx`:

```tsx
import { useState, type Dispatch, type SetStateAction } from "react";
import { Button, Input, InputNumber, Table } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import PlasticMaterialPicker from "./PlasticMaterialPicker";
import ProductionPicker from "../materials/ProductionPicker";
import type { PlasticMaterialRow } from "../../api/plasticMaterialMaster";
import type { ProductionTrackingRow } from "../../api/productionReports";
import type { PWRLine } from "../../api/plasticWarehouseReturn";

// 塑胶退仓明细可编辑行(保真列序:生产单号|款号|物料编号|物料名称|颜色|塑胶货号|单位|数量|单价|金额|备注)。
// 物料编号🔍=PlasticMaterialPicker;生产单号/款号🔍=ProductionPicker;塑胶货号手录。hidePrice 时隐藏 单价/金额。
export default function PlasticWarehouseReturnLineTable({ value, onChange, readOnly, hidePrice }: {
  value: PWRLine[];
  onChange: Dispatch<SetStateAction<PWRLine[]>>;
  readOnly?: boolean;
  hidePrice?: boolean;
}) {
  const setLine = (i: number, patch: Partial<PWRLine>) =>
    onChange(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const [matPickFor, setMatPickFor] = useState<number | null>(null);
  const [prodPickFor, setProdPickFor] = useState<number | null>(null);

  const fillFromMaterial = (row: PlasticMaterialRow) => {
    if (matPickFor === null) return;
    setLine(matPickFor, {
      物料编号: row.物料编号 ?? undefined, 物料名称: row.物料名称 ?? undefined,
      规格: row.规格 ?? undefined, 颜色: row.颜色 ?? undefined,
      仓位号: row.仓位号 ?? undefined, 单位: row.单位 ?? undefined,
    });
  };
  const fillFromProduction = (row: ProductionTrackingRow) => {
    if (prodPickFor === null) return;
    setLine(prodPickFor, { 生产单号: row.生产单号 ?? undefined, 款号: row.款号 ?? undefined });
  };

  const txt = (val: string | undefined, on: (s: string) => void, w: number) =>
    <Input style={{ width: w }} value={val ?? ""} disabled={readOnly} onChange={e => on(e.target.value)} />;
  const pickCell = (val: string | undefined, on: (s: string) => void, onPick: () => void, w: number) =>
    <Input style={{ width: w }} value={val ?? ""} disabled={readOnly} onChange={e => on(e.target.value)}
      suffix={readOnly ? null : <SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={onPick} />} />;
  const ro = (v?: string) => <span>{v ?? ""}</span>;
  const lineAmt = (r: PWRLine) => Number(r.数量 ?? 0) * Number(r.单价 ?? 0);

  const columns = [
    { title: "生产单号", dataIndex: "生产单号", width: 150, render: (_: unknown, r: PWRLine, i: number) => pickCell(r.生产单号, s => setLine(i, { 生产单号: s }), () => setProdPickFor(i), 128) },
    { title: "款号", dataIndex: "款号", width: 124, render: (_: unknown, r: PWRLine, i: number) => pickCell(r.款号, s => setLine(i, { 款号: s }), () => setProdPickFor(i), 102) },
    { title: "物料编号", dataIndex: "物料编号", width: 140, render: (_: unknown, r: PWRLine, i: number) => pickCell(r.物料编号, s => setLine(i, { 物料编号: s }), () => setMatPickFor(i), 118) },
    { title: "物料名称", dataIndex: "物料名称", width: 140, render: (v: string) => ro(v) },
    { title: "颜色", dataIndex: "颜色", width: 80, render: (_: unknown, r: PWRLine, i: number) => txt(r.颜色, s => setLine(i, { 颜色: s }), 68) },
    { title: "塑胶货号", dataIndex: "塑胶货号", width: 120, render: (_: unknown, r: PWRLine, i: number) => txt(r.塑胶货号, s => setLine(i, { 塑胶货号: s }), 108) },
    { title: "单位", dataIndex: "单位", width: 64, render: (v: string) => ro(v) },
    { title: "数量", dataIndex: "数量", width: 92, render: (_: unknown, r: PWRLine, i: number) => <InputNumber min={0} precision={2} style={{ width: 80 }} disabled={readOnly} value={r.数量 ?? 0} onChange={n => setLine(i, { 数量: Number(n ?? 0) })} /> },
    ...(hidePrice ? [] : [
      { title: "单价", dataIndex: "单价", width: 100, render: (_: unknown, r: PWRLine, i: number) => <InputNumber min={0} precision={4} style={{ width: 88 }} disabled={readOnly} value={r.单价 ?? 0} onChange={n => setLine(i, { 单价: Number(n ?? 0) })} /> },
      { title: "金额", dataIndex: "_amt", width: 96, render: (_: unknown, r: PWRLine) => lineAmt(r).toFixed(2) },
    ]),
    { title: "备注", dataIndex: "备注", width: 130, render: (_: unknown, r: PWRLine, i: number) => txt(r.备注, s => setLine(i, { 备注: s }), 118) },
    ...(readOnly ? [] : [{ title: "", key: "_op", width: 50, render: (_: unknown, __: PWRLine, i: number) => <a onClick={() => onChange(prev => prev.filter((_, j) => j !== i))}>删除</a> }]),
  ];

  return (
    <div>
      <Table size="small" rowKey={(_: PWRLine, i?: number) => String(i)} pagination={false}
        dataSource={value} columns={columns} scroll={{ x: "max-content" }} />
      {!readOnly && <Button icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={() => onChange(prev => [...prev, { 数量: 0 }])}>加一行</Button>}
      <PlasticMaterialPicker open={matPickFor !== null} onPick={fillFromMaterial} onClose={() => setMatPickFor(null)} />
      <ProductionPicker open={prodPickFor !== null} onPick={fillFromProduction} onClose={() => setProdPickFor(null)} />
    </div>
  );
}
```

- [ ] **Step 5: 构建确认编译**

Run: `npm --prefix web run build` → tsc 干净 + 构建成功。`npm --prefix web run test` → 54 不减。

- [ ] **Step 6: Commit**

```powershell
git add web/src/pages/plastics/SupplierPicker.tsx web/src/pages/plastics/PlasticReceiptPicker.tsx web/src/api/plasticWarehouseReturn.ts web/src/pages/plastics/PlasticWarehouseReturnLineTable.tsx
git commit -m @'
feat(塑胶退仓单保真): 供应商/入仓单选择器+typed API+明细网格(单价金额脱敏)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: 全屏主从录入页 + 路由替换

**Files:** Create `web/src/pages/plastics/PlasticWarehouseReturnFormPage.tsx`; Modify `web/src/App.tsx`

- [ ] **Step 1: 写页面** `web/src/pages/plastics/PlasticWarehouseReturnFormPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Col, Form, Input, Popconfirm, Row, Space, Statistic, Table, Tag, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { plasticWarehouseReturnApi, type PWRHeader, type PWRLine } from "../../api/plasticWarehouseReturn";
import { plasticDocApi } from "../../api/plasticDocs";
import SupplierPicker from "./SupplierPicker";
import PlasticReceiptPicker from "./PlasticReceiptPicker";
import PlasticWarehouseReturnLineTable from "./PlasticWarehouseReturnLineTable";
import { can, hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "塑胶退仓单";
const today = () => new Date().toLocaleDateString("zh-CN");
const currentUser = () => localStorage.getItem("erp_user") ?? "";

export default function PlasticWarehouseReturnFormPage() {
  const perms = usePerms();
  const priceHidden = hidePrice(perms, MENU);
  const [form] = Form.useForm<Record<string, unknown>>();
  const [lines, setLines] = useState<PWRLine[]>([]);
  const [rows, setRows] = useState<PWRHeader[]>([]);
  const [opened, setOpened] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const readOnly = opened !== null;

  const loadRows = useCallback(async () => {
    try { setRows((await plasticWarehouseReturnApi.list(1, 50, "")).items); }
    catch { message.error("加载退仓单失败"); }
  }, []);
  useEffect(() => { loadRows(); }, [loadRows]);

  const reset = useCallback(() => {
    form.resetFields();
    form.setFieldsValue({ 日期: today(), 操作员: currentUser() });
    setLines([]); setOpened(null);
  }, [form]);
  useEffect(() => { reset(); }, [reset]);

  // 入仓单号🔍带出:选已审核入仓单 → 拉明细映射进退仓
  const bringFromReceipt = async (单号: string) => {
    try {
      const d = await plasticDocApi("plastic-receipts").get(单号);
      const h = d.单头 as { 供应商编号?: string; 供应商名称?: string } | undefined;
      form.setFieldsValue({ 入仓单号: 单号, 供应商编号: h?.供应商编号, 供应商名称: h?.供应商名称 });
      setLines((d.明细 ?? []).map(l => ({
        物料编号: l.物料编号, 物料名称: l.物料名称, 规格: l.规格, 颜色: l.颜色,
        仓位号: l.仓位号, 单位: l.单位, 数量: Number(l.数量 ?? 0), 单价: l.单价 ?? undefined,
      })));
      message.success(`已带出入仓单 ${单号} 的明细`);
    } catch { message.error("带出入仓单明细失败"); }
  };

  const openDoc = async (单号: string) => {
    try {
      const d = await plasticWarehouseReturnApi.get(单号);
      const h = d.单头 ?? {} as PWRHeader;
      form.setFieldsValue({
        供应商编号: h.供应商编号, 供应商名称: h.供应商名称, 仓库: h.仓库, 备注: h.备注,
        日期: h.日期?.slice(0, 10), 操作员: h.操作员, 出库单号: h.出库单号, 入仓单号: h.入仓单号, 电脑单号: h.电脑单号,
      });
      setLines(d.明细 ?? []); setOpened(单号);
    } catch { message.error("打开退仓单失败"); }
  };

  const save = async () => {
    if (readOnly) { message.info("查看模式:请先「新建」再录入"); return; }
    let v: Record<string, unknown>;
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => l.物料编号 && Number(l.数量) > 0);
    if (ok.length === 0) { message.error("请至少录入一行有效物料明细(物料编号+数量)"); return; }
    setSaving(true);
    try {
      await plasticWarehouseReturnApi.create({ ...v, 明细: ok });
      message.success("塑胶退仓单已创建"); reset(); loadRows();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建失败");
    } finally { setSaving(false); }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); loadRows(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const 数量合计 = lines.reduce((s, l) => s + Number(l.数量 ?? 0), 0);
  const 金额合计 = lines.reduce((s, l) => s + Number(l.数量 ?? 0) * Number(l.单价 ?? 0), 0);

  const listColumns = [
    { title: "退仓单号", dataIndex: "单号", key: "单号", render: (v: string) => <a onClick={() => openDoc(v)} className="erp-num">{v}</a> },
    { title: "供应商", dataIndex: "供应商名称", key: "供应商名称" },
    { title: "仓库", dataIndex: "仓库", key: "仓库" },
    { title: "数量", dataIndex: "数量", key: "数量" },
    { title: "日期", dataIndex: "日期", key: "日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "状态", dataIndex: "审核", key: "审核", render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: PWRHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => plasticWarehouseReturnApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => plasticWarehouseReturnApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该退仓单?" onConfirm={() => act(() => plasticWarehouseReturnApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title={`塑胶退仓单${readOnly ? `（查看 ${opened}）` : "（新建）"}`} variant="borderless"
      extra={
        <Space wrap>
          <Button onClick={reset}>新建</Button>
          {can(perms, MENU, "保存") && <Button type="primary" loading={saving} disabled={readOnly} onClick={save}>保存</Button>}
          <Button onClick={() => window.print()}>打印</Button>
        </Space>
      }>
      <Form form={form} layout="vertical" size="small">
        <Row gutter={12}>
          <Col span={6}>
            <Form.Item name="供应商名称" label="供应商" rules={[{ required: true, message: "请选供应商" }]}>
              <Input readOnly placeholder="点🔍选供应商"
                suffix={readOnly ? null : <SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={() => setSupplierOpen(true)} />} />
            </Form.Item>
            <Form.Item name="供应商编号" hidden><Input /></Form.Item>
          </Col>
          <Col span={4}><Form.Item name="日期" label="日期"><Input disabled /></Form.Item></Col>
          <Col span={4}><Form.Item name="出库单号" label="出库单号"><Input disabled={readOnly} /></Form.Item></Col>
          <Col span={5}>
            <Form.Item name="入仓单号" label="入仓单号">
              <Input readOnly placeholder="点🔍选入仓单带出"
                suffix={readOnly ? null : <SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={() => setReceiptOpen(true)} />} />
            </Form.Item>
          </Col>
          <Col span={5}><Form.Item name="电脑单号" label="电脑单号"><Input disabled /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={3}><Form.Item name="仓库" label="仓库" rules={[{ required: true, message: "请填仓库" }]}><Input disabled={readOnly} /></Form.Item></Col>
          <Col span={4}><Form.Item name="操作员" label="操作员"><Input disabled /></Form.Item></Col>
          <Col span={17}><Form.Item name="备注" label="备注"><Input disabled={readOnly} /></Form.Item></Col>
        </Row>
      </Form>

      <PlasticWarehouseReturnLineTable value={lines} onChange={setLines} readOnly={readOnly} hidePrice={priceHidden} />

      <Space style={{ marginTop: 16 }} size={32}>
        <Statistic title="数量合计" value={数量合计} />
        {!priceHidden && <Statistic title="金额合计" value={金额合计.toFixed(2)} />}
        <Statistic title="制单人" value={currentUser()} />
      </Space>

      <div style={{ marginTop: 24 }}>
        <Table rowKey="id" size="middle" dataSource={rows} columns={listColumns} pagination={{ pageSize: 10 }} />
      </div>

      <SupplierPicker open={supplierOpen}
        onPick={row => form.setFieldsValue({ 供应商编号: row.供应商编号, 供应商名称: row.供应商名称 })}
        onClose={() => setSupplierOpen(false)} />
      <PlasticReceiptPicker open={receiptOpen} onPick={bringFromReceipt} onClose={() => setReceiptOpen(false)} />
    </Card>
  );
}
```

- [ ] **Step 2: 换路由** 在 `web/src/App.tsx`:
  - 顶部加 import:`import PlasticWarehouseReturnFormPage from "./pages/plastics/PlasticWarehouseReturnFormPage";`(放其它塑胶页 import 附近)。
  - 把 `<Route path="plastic-warehouse-returns" element={<PlasticDocPage cfg={PLASTIC_DOC_CONFIGS["plastic-warehouse-returns"]} />} />` 改为:
    `<Route path="plastic-warehouse-returns" element={<PlasticWarehouseReturnFormPage />} />`

- [ ] **Step 3: 测试 + 构建**

Run: `npm --prefix web run test` → 54 不减。
Run: `npm --prefix web run build` → tsc 干净 + 构建成功。

- [ ] **Step 4: Commit**

```powershell
git add web/src/pages/plastics/PlasticWarehouseReturnFormPage.tsx web/src/App.tsx
git commit -m @'
feat(塑胶退仓单保真): 全屏主从录入页(供应商头+入仓带出+明细单价金额+历史列表)+路由替换

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟**

重启后端(新代码,`-c Release`,`ASPNETCORE_URLS=http://127.0.0.1:5000`,env ERP_DB/ERP_JWT_KEY),待就绪。Node axios(`proxy:false`):admin 登录 → 先建塑胶入仓单(物料 SMOKEWR/数量 20/单价 7,仓库 塑胶仓)→ approve → POST `/api/plastic-warehouse-returns`(带 出库单号/入仓单号=该入仓单号/电脑单号 + 明细 生产单号/塑胶货号/物料 SMOKEWR/数量 6/单价 7,仓库 塑胶仓)→ GET 读回新字段一致(出库单号/入仓单号/生产单号/塑胶货号、金额=42)→ approve → GET `/api/plastic-inventory?keyword=SMOKEWR` 库存=14(20−6)→ 清理(反审核+删两单)。

Expected: 新字段往返一致、金额=42、库存 20−6=14。

- [ ] **Step 2: opus 全分支终审**

派 opus 子代理对 `feat-plastic-wh-return-form` 全分支 diff 终审:四处列名对齐(DB ADD/DTO/INSERT列+参/SELECT,头 出库单号/入仓单号/电脑单号·明细 生产单号/款号/塑胶货号)、金额=数量×单价、库存方向(退仓 −)未变、成本脱敏(hidePrice 隐藏单价/金额列 + 后端 List/Get 剥离)、前端 PWRLine/PWRHeader 字段与 DTO 一致、入仓带出映射正确、SupplierPicker/ReceiptPicker 接线、路由替换无残留、其它单未受影响。目标 READY TO MERGE。

- [ ] **Step 3: 合并 master**

```powershell
git checkout master
git merge --no-ff feat-plastic-wh-return-form -m @'
Merge branch 'feat-plastic-wh-return-form' into master

塑胶退仓单保真重做(全屏主从录入页+供应商头+入仓带出+头/明细补字段)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
git branch -d feat-plastic-wh-return-form
```

- [ ] **Step 4: worklog + MEMORY** Create `docs/worklogs/2026-06-26-plastic-warehouse-return-form.md`;在塑胶领料单保真记忆文件(或新增)追加退仓本次摘要(含 SupplierPicker/入仓带出 复用件)。Commit。

```powershell
git add docs/worklogs/2026-06-26-plastic-warehouse-return-form.md
git commit -m @'
docs(worklog): 塑胶退仓单保真重做 2026-06-26

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## 自审清单(已核对)

- **Spec 覆盖**:DB 列(头3+明细3)=Task1;DTO/Service+往返测试=Task2;SupplierPicker/ReceiptPicker/typed API/明细网格=Task3;全屏页(供应商🔍头/出库单号/入仓单号🔍带出/明细单价金额脱敏/底部/历史)+路由=Task4;冒烟/终审/合并/worklog=Task5。入仓带出复用 plastic-receipts(零新后端)。无遗漏。
- **类型一致**:`PWRHeader`/`PWRLine`/`PWRDetail` 与后端 DTO 一致;create 传 `{...表单, 明细}`;供应商表单字段 供应商编号(hidden)/供应商名称;入仓带出读 plasticDocApi 明细字段(物料编号/名称/规格/颜色/仓位号/单位/数量/单价 均存在于 PlasticDocLine)。
- **无占位**:每步含完整代码/命令/预期。
- **列名一致**:DB ADD / DTO / INSERT 列+@参 / SELECT 四处对齐(头 出库单号/入仓单号/电脑单号;明细 生产单号/款号/塑胶货号)。
- **库存/脱敏不变**:LedgerUnion 退仓支未动;hidePrice 隐藏单价/金额列,后端 Controller List/Get 仍按权限剥离。金额=Σ数量×单价 合计算法不变。
- **回归**:现有 `PlasticReturnScrapServiceDbTests` 不传新字段仍绿(新列可空);仓库必填不变。
- **路由替换**:`PLASTIC_DOC_CONFIGS["plastic-warehouse-returns"]` 保留(不被新页引用),只换 Route 元素。
