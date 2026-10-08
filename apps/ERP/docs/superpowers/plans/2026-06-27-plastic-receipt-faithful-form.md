# 塑胶加工入仓单录入保真 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 塑胶入仓单 录入升级为保真「加工入仓单」专用表单,补齐缺列 工模编号 / 订单单号(扩 塑胶入仓单+明细单),为后续 塑胶入仓查询 提供完整数据源。库存口径/SR单号/审核流/脱敏全不变。

**Architecture:** DB 纯 ALTER 加列;后端扩 PlasticReceipt DTOs+Create/Get;前端新建专用 PlasticReceiptFormPage + PlasticReceiptLineTable(克隆共享件加两列),把 plastic-receipts 路由指向专用页(退仓/退料/报废 仍共享)。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + Ant Design v6 + Vitest。

---

## 前置约定

- 工作目录 `D:\WebpageERP`,分支 `feat-plastic-receipt-faithful`,完成 `--no-ff` 合并 master 删分支。`dotnet` = `C:\Program Files\dotnet\dotnet.exe`,锁 DLL 用 `-c Release`。
- DB env 从 User 取:`ERP_TEST_DB`/`ERP_JWT_KEY`/`ERP_DB`。前端 `npm --prefix D:\WebpageERP\web run test`/`build`。
- 提交末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- **坑:离线起后端冒烟须 `--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`**(否则不读 appsettings → JWT 401 IDX10208)。
- 现状:`塑胶入仓明细单` 已有 生产单号/款号/塑胶货号/物料编号/物料名称/规格/颜色/仓位号/单位/数量/单价/金额/备注;`塑胶入仓单` 头已有 出库单号/入仓单号/电脑单号。**本增量仅加** 明细 工模编号/订单单号 + 头 订单单号。
- `塑胶入仓明细单` 是塑胶表,**无 FK 到 款号总表**(应用层完整性),测试免父行。
- 镜像源:`web/src/pages/plastics/PlasticSupplierDocFormPage.tsx`(头+列表+CRUD)、`web/src/pages/plastics/PlasticSupplierDocLineTable.tsx`(可编辑行)。CRUD API:`web/src/api/plasticSupplierDoc.ts`(`plasticSupplierDocApi(resource)`·`PSDHeader`/`PSDLine`)。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `db/25_plastic_receipt_processing_cols.sql` | ALTER 加 3 列 | 新建 |
| `src/ErpApi/Features/Plastics/PlasticReceipt/PlasticReceiptDtos.cs` | DTO 加 工模编号/订单单号 | 改 |
| `src/ErpApi/Features/Plastics/PlasticReceipt/PlasticReceiptService.cs` | Create/Get 补列 | 改 |
| `tests/ErpApi.Tests/PlasticReceiptProcessingColsDbTests.cs` | Create→Get 回读测试 | 新建 |
| `web/src/api/plasticSupplierDoc.ts` | PSDLine/PSDHeader 加可选列 | 改 |
| `web/src/pages/plastics/PlasticReceiptLineTable.tsx` | 加工入仓明细可编辑行(加 订单单号/工模编号) | 新建 |
| `web/src/pages/plastics/PlasticReceiptFormPage.tsx` | 加工入仓专用录入页 | 新建 |
| `web/src/App.tsx` | plastic-receipts 路由改专用页 | 改 |

---

## Task 1: 后端 DB + DTO + Service + 测试

**Files:** Create `db/25_plastic_receipt_processing_cols.sql`, `tests/ErpApi.Tests/PlasticReceiptProcessingColsDbTests.cs`; Modify `PlasticReceiptDtos.cs`, `PlasticReceiptService.cs`

- [ ] **Step 1: DB 脚本** Create `db/25_plastic_receipt_processing_cols.sql`:

```sql
-- 塑胶加工入仓单保真:塑胶入仓明细单补 工模编号/订单单号;塑胶入仓单头补 订单单号。幂等。
IF COL_LENGTH(N'[塑胶入仓明细单]', N'工模编号') IS NULL
    ALTER TABLE [塑胶入仓明细单] ADD [工模编号] nvarchar(30) NULL;
IF COL_LENGTH(N'[塑胶入仓明细单]', N'订单单号') IS NULL
    ALTER TABLE [塑胶入仓明细单] ADD [订单单号] nvarchar(40) NULL;
IF COL_LENGTH(N'[塑胶入仓单]', N'订单单号') IS NULL
    ALTER TABLE [塑胶入仓单] ADD [订单单号] nvarchar(40) NULL;
```
应用两库(PowerShell):
```powershell
foreach ($V in "ERP_DB","ERP_TEST_DB") {
  $cs = [Environment]::GetEnvironmentVariable($V,"User"); $c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
  $cmd = $c.CreateCommand(); $cmd.CommandText = [IO.File]::ReadAllText((Resolve-Path "db/25_plastic_receipt_processing_cols.sql")); $null = $cmd.ExecuteNonQuery(); $c.Close(); Write-Output "$V ok"
}
```
Expected: `ERP_DB ok` 和 `ERP_TEST_DB ok`。

- [ ] **Step 2: DTO** 改 `PlasticReceiptDtos.cs`——四处加属性:
  - `PlasticReceiptHeaderDto` 末尾(在 `电脑单号` 后)加 `public string? 订单单号 { get; set; }`
  - `PlasticReceiptLineDto` 在 `款号` 后加 `public string? 工模编号 { get; set; }`,末尾加 `public string? 订单单号 { get; set; }`
  - `PlasticReceiptCreateLineDto` 在 `款号` 后加 `public string? 工模编号 { get; set; }`,末尾加 `public string? 订单单号 { get; set; }`
  - `PlasticReceiptCreateDto` 在 `电脑单号` 后加 `public string? 订单单号 { get; set; }`

- [ ] **Step 3: Service Create** 改 `PlasticReceiptService.CreateAsync` 的两条 INSERT:

头 INSERT 改为(加 `[订单单号]` 列与 `@订单单号` 值):
```csharp
        await c.ExecuteAsync(@"
INSERT INTO [塑胶入仓单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[备注],[出库单号],[入仓单号],[电脑单号],[订单单号])
VALUES(@单号,@日期,@供应商编号,@供应商名称,@仓库,@数量,@金额,@操作员,'0',@备注,@出库单号,@入仓单号,@电脑单号,@订单单号)",
            new { 单号, 日期 = now, dto.供应商编号, dto.供应商名称, dto.仓库,
                  数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注,
                  dto.出库单号, dto.入仓单号, dto.电脑单号, dto.订单单号 }, tx);
```

明细 INSERT 改为(加 `[工模编号],[订单单号]`;明细订单单号缺省取头):
```csharp
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [塑胶入仓明细单]([单号],[日期],[仓库],[生产单号],[款号],[工模编号],[物料编号],[物料名称],[规格],[颜色],[塑胶货号],[订单单号],[仓位号],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@日期,@仓库,@生产单号,@款号,@工模编号,@物料编号,@物料名称,@规格,@颜色,@塑胶货号,@订单单号,@仓位号,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, 日期 = now, dto.仓库, l.生产单号, l.款号, l.工模编号, l.物料编号, l.物料名称, l.规格, l.颜色, l.塑胶货号,
                      订单单号 = l.订单单号 ?? dto.订单单号, l.仓位号, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注 }, tx);
```

- [ ] **Step 4: Service Get** 改 `PlasticReceiptService.GetAsync` 的两条 SELECT 加列:

```csharp
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注],[出库单号],[入仓单号],[电脑单号],[订单单号]
FROM [塑胶入仓单] WHERE [单号]=@单号;
SELECT [ID],[生产单号],[款号],[工模编号],[物料编号],[物料名称],[规格],[颜色],[塑胶货号],[订单单号],[仓位号],[单位],[数量],[单价],[金额],[备注]
FROM [塑胶入仓明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
```

- [ ] **Step 5: 测试** Create `tests/ErpApi.Tests/PlasticReceiptProcessingColsDbTests.cs`:

```csharp
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticReceiptProcessingColsDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Create_then_Get_roundtrips_工模编号_and_订单单号()
    {
        Skip.IfNot(fx.Available, "test DB not configured");
        var dto = new PlasticReceiptCreateDto
        {
            供应商编号 = "S01", 供应商名称 = "测试车间", 仓库 = "塑胶仓", 订单单号 = "ZCS-T1", 备注 = "smoke",
            明细 =
            [
                new PlasticReceiptCreateLineDto { 生产单号 = "PR-MO", 款号 = "K-PR", 工模编号 = "GM-PR",
                    物料编号 = "PRPM", 物料名称 = "ABS粒", 颜色 = "黑", 塑胶货号 = "H-PR", 单位 = "kg", 数量 = 7, 单价 = 2 },
                new PlasticReceiptCreateLineDto { 生产单号 = "PR-MO", 款号 = "K-PR", 工模编号 = "GM-PR",
                    物料编号 = "PRPM", 物料名称 = "ABS粒", 颜色 = "黑", 塑胶货号 = "H-PR", 订单单号 = "ZCS-LINE", 单位 = "kg", 数量 = 3, 单价 = 2 },
            ],
        };
        string 单号 = await Svc().CreateAsync(dto, "tester");
        try
        {
            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal("ZCS-T1", d!.单头!.订单单号);
            Assert.Equal(2, d.明细.Count);
            Assert.All(d.明细, l => { Assert.Equal("GM-PR", l.工模编号); Assert.Equal("K-PR", l.款号); });
            // 明细1 订单单号缺省取头;明细2 显式 ZCS-LINE
            Assert.Equal("ZCS-T1", d.明细[0].订单单号);
            Assert.Equal("ZCS-LINE", d.明细[1].订单单号);
        }
        finally
        {
            using var c = fx.Open();
            c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号]=@单号", new { 单号 });
        }
    }
}
```
（注:`using Dapper;` 已由 `c.Execute` 需要——文件顶部加 `using Dapper;`。）

- [ ] **Step 6: 跑测试 + 全量**

Run: `dotnet test --filter "FullyQualifiedName~PlasticReceiptProcessingColsDbTests"` → PASS。
Run: `dotnet test` → 全绿(368 → 369)。报告总数。

- [ ] **Step 7: Commit**

```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticReceiptProcessingColsDbTests.cs db/25_plastic_receipt_processing_cols.sql
git commit -m @'
feat(塑胶加工入仓单): 扩 塑胶入仓单+明细单(工模编号/订单单号)+Create/Get回读+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 专用录入页 + 明细行 + 路由

**Files:** Modify `web/src/api/plasticSupplierDoc.ts`, `web/src/App.tsx`; Create `web/src/pages/plastics/PlasticReceiptLineTable.tsx`, `web/src/pages/plastics/PlasticReceiptFormPage.tsx`

- [ ] **Step 1: 类型** 改 `web/src/api/plasticSupplierDoc.ts`:在 `PSDLine` 接口加 `工模编号?: string;` 和 `订单单号?: string;`;在 `PSDHeader` 接口加 `订单单号?: string;`。(共享件不渲染这两列,无副作用。)

- [ ] **Step 2: 明细行** Create `web/src/pages/plastics/PlasticReceiptLineTable.tsx`(克隆 `PlasticSupplierDocLineTable` 保真列序加 订单单号/工模编号):

```tsx
import { useState, type Dispatch, type SetStateAction } from "react";
import { Button, Input, InputNumber, Table } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import PlasticMaterialPicker from "./PlasticMaterialPicker";
import ProductionPicker from "../materials/ProductionPicker";
import type { PlasticMaterialRow } from "../../api/plasticMaterialMaster";
import type { ProductionTrackingRow } from "../../api/productionReports";
import type { PSDLine } from "../../api/plasticSupplierDoc";

// 加工入仓单明细可编辑行(保真列序:订单单号|生产单号|款号|物料编号|工模编号|物料名称|颜色|塑胶货号|单位|数量|单价|金额|备注)。
export default function PlasticReceiptLineTable({ value, onChange, readOnly, hidePrice }: {
  value: PSDLine[];
  onChange: Dispatch<SetStateAction<PSDLine[]>>;
  readOnly?: boolean;
  hidePrice?: boolean;
}) {
  const setLine = (i: number, patch: Partial<PSDLine>) =>
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
  const lineAmt = (r: PSDLine) => Number(r.数量 ?? 0) * Number(r.单价 ?? 0);

  const columns = [
    { title: "订单单号", dataIndex: "订单单号", width: 130, render: (_: unknown, r: PSDLine, i: number) => txt(r.订单单号, s => setLine(i, { 订单单号: s }), 116) },
    { title: "生产单号", dataIndex: "生产单号", width: 150, render: (_: unknown, r: PSDLine, i: number) => pickCell(r.生产单号, s => setLine(i, { 生产单号: s }), () => setProdPickFor(i), 128) },
    { title: "款号", dataIndex: "款号", width: 124, render: (_: unknown, r: PSDLine, i: number) => pickCell(r.款号, s => setLine(i, { 款号: s }), () => setProdPickFor(i), 102) },
    { title: "物料编号", dataIndex: "物料编号", width: 140, render: (_: unknown, r: PSDLine, i: number) => pickCell(r.物料编号, s => setLine(i, { 物料编号: s }), () => setMatPickFor(i), 118) },
    { title: "工模编号", dataIndex: "工模编号", width: 120, render: (_: unknown, r: PSDLine, i: number) => txt(r.工模编号, s => setLine(i, { 工模编号: s }), 106) },
    { title: "物料名称", dataIndex: "物料名称", width: 140, render: (v: string) => ro(v) },
    { title: "颜色", dataIndex: "颜色", width: 80, render: (_: unknown, r: PSDLine, i: number) => txt(r.颜色, s => setLine(i, { 颜色: s }), 68) },
    { title: "塑胶货号", dataIndex: "塑胶货号", width: 120, render: (_: unknown, r: PSDLine, i: number) => txt(r.塑胶货号, s => setLine(i, { 塑胶货号: s }), 108) },
    { title: "单位", dataIndex: "单位", width: 64, render: (v: string) => ro(v) },
    { title: "数量", dataIndex: "数量", width: 92, render: (_: unknown, r: PSDLine, i: number) => <InputNumber min={0} precision={2} style={{ width: 80 }} disabled={readOnly} value={r.数量 ?? 0} onChange={n => setLine(i, { 数量: Number(n ?? 0) })} /> },
    ...(hidePrice ? [] : [
      { title: "单价", dataIndex: "单价", width: 100, render: (_: unknown, r: PSDLine, i: number) => <InputNumber min={0} precision={4} style={{ width: 88 }} disabled={readOnly} value={r.单价 ?? 0} onChange={n => setLine(i, { 单价: Number(n ?? 0) })} /> },
      { title: "金额", dataIndex: "_amt", width: 96, render: (_: unknown, r: PSDLine) => lineAmt(r).toFixed(2) },
    ]),
    { title: "备注", dataIndex: "备注", width: 130, render: (_: unknown, r: PSDLine, i: number) => txt(r.备注, s => setLine(i, { 备注: s }), 118) },
    ...(readOnly ? [] : [{ title: "", key: "_op", width: 50, render: (_: unknown, __: PSDLine, i: number) => <a onClick={() => onChange(prev => prev.filter((_, j) => j !== i))}>删除</a> }]),
  ];

  return (
    <div>
      <Table size="small" rowKey={(_: PSDLine, i?: number) => String(i)} pagination={false}
        dataSource={value} columns={columns} scroll={{ x: "max-content" }} />
      {!readOnly && <Button icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={() => onChange(prev => [...prev, { 数量: 0 }])}>加一行</Button>}
      <PlasticMaterialPicker open={matPickFor !== null} onPick={fillFromMaterial} onClose={() => setMatPickFor(null)} />
      <ProductionPicker open={prodPickFor !== null} onPick={fillFromProduction} onClose={() => setProdPickFor(null)} />
    </div>
  );
}
```

- [ ] **Step 3: 专用录入页** Create `web/src/pages/plastics/PlasticReceiptFormPage.tsx`(克隆 `PlasticSupplierDocFormPage`·头加 订单单号·用 PlasticReceiptLineTable·标题加工入仓·固定 menu/resource):

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Col, Form, Input, Popconfirm, Row, Space, Statistic, Table, Tag, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { plasticSupplierDocApi, type PSDHeader, type PSDLine } from "../../api/plasticSupplierDoc";
import SupplierPicker from "./SupplierPicker";
import PlasticReceiptLineTable from "./PlasticReceiptLineTable";
import { can, hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "塑胶入仓单";
const RESOURCE = "plastic-receipts";
const today = () => new Date().toLocaleDateString("zh-CN");
const currentUser = () => localStorage.getItem("erp_user") ?? "";

export default function PlasticReceiptFormPage() {
  const docApi = useMemo(() => plasticSupplierDocApi(RESOURCE), []);
  const perms = usePerms();
  const priceHidden = hidePrice(perms, MENU);
  const [form] = Form.useForm<Record<string, unknown>>();
  const [lines, setLines] = useState<PSDLine[]>([]);
  const [rows, setRows] = useState<PSDHeader[]>([]);
  const [opened, setOpened] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const readOnly = opened !== null;

  const loadRows = useCallback(async () => {
    try { setRows((await docApi.list(1, 50, "")).items); }
    catch { message.error("加载单据失败"); }
  }, [docApi]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const reset = useCallback(() => {
    form.resetFields();
    form.setFieldsValue({ 日期: today(), 操作员: currentUser() });
    setLines([]); setOpened(null);
  }, [form]);
  useEffect(() => { reset(); }, [reset]);

  const openDoc = async (单号: string) => {
    try {
      const d = await docApi.get(单号);
      const h = d.单头 ?? {} as PSDHeader;
      form.setFieldsValue({
        供应商编号: h.供应商编号, 供应商名称: h.供应商名称, 仓库: h.仓库, 备注: h.备注,
        日期: h.日期?.slice(0, 10), 操作员: h.操作员, 入仓单号: h.入仓单号, 电脑单号: h.电脑单号, 订单单号: h.订单单号,
      });
      setLines(d.明细 ?? []); setOpened(单号);
    } catch { message.error("打开单据失败"); }
  };

  const save = async () => {
    if (readOnly) { message.info("查看模式:请先「新建」再录入"); return; }
    let v: Record<string, unknown>;
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => l.物料编号 && Number(l.数量) > 0);
    if (ok.length === 0) { message.error("请至少录入一行有效物料明细(物料编号+数量)"); return; }
    setSaving(true);
    try {
      await docApi.create({ ...v, 明细: ok });
      message.success("塑胶入仓单已创建"); reset(); loadRows();
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
    { title: "单号", dataIndex: "单号", key: "单号", render: (v: string) => <a onClick={() => openDoc(v)} className="erp-num">{v}</a> },
    { title: "供应商", dataIndex: "供应商名称", key: "供应商名称" },
    { title: "仓库", dataIndex: "仓库", key: "仓库" },
    { title: "数量", dataIndex: "数量", key: "数量" },
    { title: "日期", dataIndex: "日期", key: "日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "状态", dataIndex: "审核", key: "审核", render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: PSDHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => docApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => docApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该单据?" onConfirm={() => act(() => docApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title={`塑胶入仓单（加工入仓）${readOnly ? `（查看 ${opened}）` : "（新建）"}`} variant="borderless"
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
          <Col span={5}><Form.Item name="入仓单号" label="入库单号"><Input disabled={readOnly} /></Form.Item></Col>
          <Col span={5}><Form.Item name="订单单号" label="订单单号"><Input disabled={readOnly} /></Form.Item></Col>
          <Col span={4}><Form.Item name="电脑单号" label="电脑单号"><Input disabled /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={3}><Form.Item name="仓库" label="仓库" rules={[{ required: true, message: "请填仓库" }]}><Input disabled={readOnly} /></Form.Item></Col>
          <Col span={4}><Form.Item name="操作员" label="操作员"><Input disabled /></Form.Item></Col>
          <Col span={17}><Form.Item name="备注" label="备注"><Input disabled={readOnly} /></Form.Item></Col>
        </Row>
      </Form>

      <PlasticReceiptLineTable value={lines} onChange={setLines} readOnly={readOnly} hidePrice={priceHidden} />

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
    </Card>
  );
}
```

- [ ] **Step 4: 路由** 改 `web/src/App.tsx`:
  - 顶部加 `import PlasticReceiptFormPage from "./pages/plastics/PlasticReceiptFormPage";`
  - 第 121 行 `plastic-receipts` 路由由 `<PlasticSupplierDocFormPage cfg={PLASTIC_SUPPLIER_DOC_CONFIGS["plastic-receipts"]} />` 改为 `<PlasticReceiptFormPage />`。其余三单(returns/warehouse-returns/scraps)不动。

- [ ] **Step 5: 测试 + 构建**

Run: `npm --prefix D:\WebpageERP\web run test` → 54 不减。
Run: `npm --prefix D:\WebpageERP\web run build` → tsc 干净 + 构建成功。

- [ ] **Step 6: Commit**

```powershell
git add web/src/api/plasticSupplierDoc.ts web/src/pages/plastics/PlasticReceiptLineTable.tsx web/src/pages/plastics/PlasticReceiptFormPage.tsx web/src/App.tsx
git commit -m @'
feat(塑胶加工入仓单): 专用保真录入页(头订单单号+明细工模编号/订单单号)+路由切换

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟**

重启后端(新代码·`-c Release`·`ASPNETCORE_URLS=http://127.0.0.1:5000`·env ERP_DB/ERP_JWT_KEY·**`--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`**),待就绪。Node axios(`proxy:false`):admin 登录 → POST `/api/plastic-receipts` body `{供应商编号:"S01",供应商名称:"测试车间",仓库:"塑胶仓",订单单号:"ZCS-SMK",明细:[{生产单号:"SMK-MO",款号:"K-SMK",工模编号:"GM-SMK",物料编号:"SMKPM",物料名称:"ABS粒",颜色:"黑",塑胶货号:"H-SMK",单位:"kg",数量:10,单价:2}]}` → 取回 单号 → GET `/api/plastic-receipts/{单号}` 验证 单头.订单单号=ZCS-SMK、明细[0].工模编号=GM-SMK、明细[0].订单单号=ZCS-SMK(缺省取头)→ POST `/{单号}/approve` → GET `/api/plastic-inventory?keyword=SMKPM` 数量含 10。清理:DELETE 明细+头(SQL)。

Expected: Get 回读 订单单号/工模编号 正确,审核后库存 +10。

- [ ] **Step 2: opus 全分支终审**

派 opus 对 `feat-plastic-receipt-faithful` 全分支终审:DB ALTER 幂等;DTO/Create/Get 三处列对齐(列名/@参/SELECT 一致·明细订单单号缺省取头);**库存 LedgerUnion 入仓支未改(按物料编号×仓库·新增列无关)**;脱敏不变;前端专用页头(订单单号)+明细行(工模编号/订单单号)保真列序、CRUD 复用 plasticSupplierDocApi("plastic-receipts")、路由切换且 退仓/退料/报废 共享件未受影响、PSDLine/PSDHeader 加可选列不破坏共享件;测试自洽(免 款号总表父行·Create→Get 回读)。目标 READY TO MERGE。

- [ ] **Step 3: 合并 master**

```powershell
git checkout master
git merge --no-ff feat-plastic-receipt-faithful -m @'
Merge branch 'feat-plastic-receipt-faithful' into master

塑胶加工入仓单录入保真(扩 工模编号/订单单号·专用录入页·拆两步第1步)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
git branch -d feat-plastic-receipt-faithful
```

- [ ] **Step 4: worklog + MEMORY** Create `docs/worklogs/2026-06-27-plastic-receipt-faithful-form.md`;更新塑胶模块记忆(标注 #2 塑胶入仓查询 待做)。Commit。

```powershell
git add docs/worklogs/2026-06-27-plastic-receipt-faithful-form.md
git commit -m @'
docs(worklog): 塑胶加工入仓单录入保真 2026-06-27

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## 自审清单(已核对)

- **Spec 覆盖**:DB ALTER=Task1 Step1;DTO=Step2;Create=Step3;Get=Step4;测试=Step5;前端 类型/明细行/录入页/路由=Task2;冒烟/终审/合并=Task3。无遗漏。
- **类型一致**:后端 DTO 加 工模编号(明细 Detail+Create)/订单单号(头 Header+Create、明细 Detail+Create);前端 PSDLine 加 工模编号?/订单单号?、PSDHeader 加 订单单号?。Create INSERT 列与 @参一致;Get SELECT 列与 DTO 一致。
- **库存不变**:LedgerUnion 入仓支(PlasticInventoryService)未触碰,新增列与聚合(物料编号×仓库)无关。
- **缺省取头**:明细订单单号 `l.订单单号 ?? dto.订单单号`(后端);测试覆盖两态(缺省/显式)。
- **共享件不破坏**:PSDLine/PSDHeader 加的是可选属性,PlasticSupplierDocLineTable 不渲染这两列;退仓/退料/报废 路由与 config 未动。
- **无新菜单/权限**:沿用 塑胶入仓单 菜单 + `api/plastic-receipts`,免种子。
- **content root 坑**:冒烟 Step1 明确 `--contentRoot 输出目录`。
- **测试 using**:测试文件含 `using Dapper;`(c.Execute 清理需要)。
