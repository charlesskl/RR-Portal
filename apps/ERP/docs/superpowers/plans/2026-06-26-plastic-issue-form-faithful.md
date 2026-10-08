# 塑胶领料单 保真重做(全屏主从录入页)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把塑胶领料单从通用列表+抽屉换成专用全屏主从录入页(工具栏+丰富表头+左明细网格+右只读库存参考+底部合计),按原系统截图保真;后端补表头/明细列,库存方向(领料 −)与单号/审核全不变。

**Architecture:** 后端 `塑胶领料单`/`塑胶领料明细单` 两表 `ALTER ADD` 新列,`PlasticIssueService` 的 INSERT/SELECT 与 DTO 带上新列,其余(单号 SLL、审核、库存 UNION 领料支−)不动。右侧库存参考零新端点,前端直接调 `api/plastic-inventory`。前端新建专用页替换 `/plastic-issues` 路由,明细网格镜像物料侧 `MaterialLineTable`(usageCols)的「输入框+🔍」编辑行,改用 `PlasticMaterialPicker`/`ProductionPicker`/`EmployeePicker`。

**Tech Stack:** .NET 8 ASP.NET Core, Dapper, SQL Server LocalDB, xUnit + SkippableFact, React 18 + TS + Vite + Ant Design v6。

---

## 前置约定

- 工作目录 `D:\WebpageERP`,新建分支 `feat-plastic-issue-form`,完成 `--no-ff` 合并 master 删分支。PowerShell;`dotnet` 不在 PATH:`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 测试 env(空时):`$env:ERP_TEST_DB`/`$env:ERP_JWT_KEY`/`$env:ERP_DB` 从 User 取。后端测试 `dotnet test`(锁 DLL 时 `-c Release`)。前端 `npm --prefix web run test`、`npm --prefix web run build`。
- 提交末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。LF→CRLF 警告正常。
- 镜像源:明细编辑行 = `web/src/pages/materials/MaterialLineTable.tsx`(usageColumns 段);选择器 `web/src/pages/plastics/PlasticMaterialPicker.tsx`(onPick(PlasticMaterialRow))、`web/src/pages/materials/ProductionPicker.tsx`(onPick(ProductionTrackingRow:生产单号/款号))、`web/src/pages/materials/EmployeePicker.tsx`(onPick(姓名:string))。库存 `web/src/api/plasticInventory.ts`(plasticInventoryApi.list(仓库?,keyword?)→PlasticStockRow[])。
- 后端 `仓库` 必填(CreateAsync 空仓库抛错):本页表头保留「仓库」字段(原截图未显式画,功能必需)。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `db/22_plastic_issue_form.sql` | 塑胶领料单/明细单 ALTER ADD 新列(幂等) | 新建 |
| `src/ErpApi/Features/Plastics/PlasticIssue/PlasticIssueDtos.cs` | 头/明细 DTO 补字段 | 改 |
| `src/ErpApi/Features/Plastics/PlasticIssue/PlasticIssueService.cs` | INSERT/SELECT 带新列 | 改 |
| `tests/ErpApi.Tests/PlasticIssueFormDbTests.cs` | 新字段往返测试 | 新建 |
| `web/src/api/plasticIssue.ts` | 领料单专用 typed API(含新字段) | 新建 |
| `web/src/pages/plastics/PlasticIssueLineTable.tsx` | 左明细可编辑网格(保真列序) | 新建 |
| `web/src/pages/plastics/PlasticIssueFormPage.tsx` | 全屏主从录入页 | 新建 |
| `web/src/App.tsx` | `/plastic-issues` 路由换成新页 | 改 |

---

## Task 1: 建表脚本(ALTER ADD 新列)+ 应用到两库

**Files:** Create `db/22_plastic_issue_form.sql`

- [ ] **Step 1: 写脚本** `db/22_plastic_issue_form.sql`:

```sql
-- 塑胶领料单保真重做:头/明细补原系统字段。幂等(COL_LENGTH 判空再 ADD)。
SET XACT_ABORT ON;
IF COL_LENGTH(N'塑胶领料单', N'胶箱数')   IS NULL ALTER TABLE [塑胶领料单] ADD [胶箱数] int NULL;
IF COL_LENGTH(N'塑胶领料单', N'纸箱数')   IS NULL ALTER TABLE [塑胶领料单] ADD [纸箱数] int NULL;
IF COL_LENGTH(N'塑胶领料单', N'钙塑箱数') IS NULL ALTER TABLE [塑胶领料单] ADD [钙塑箱数] int NULL;
IF COL_LENGTH(N'塑胶领料单', N'卡板数')   IS NULL ALTER TABLE [塑胶领料单] ADD [卡板数] int NULL;
IF COL_LENGTH(N'塑胶领料单', N'收件人')   IS NULL ALTER TABLE [塑胶领料单] ADD [收件人] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶领料单', N'电脑单号') IS NULL ALTER TABLE [塑胶领料单] ADD [电脑单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶领料单', N'领料备注') IS NULL ALTER TABLE [塑胶领料单] ADD [领料备注] nvarchar(40) NULL;

IF COL_LENGTH(N'塑胶领料明细单', N'生产单号') IS NULL ALTER TABLE [塑胶领料明细单] ADD [生产单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶领料明细单', N'款号')     IS NULL ALTER TABLE [塑胶领料明细单] ADD [款号] nvarchar(40) NULL;
IF COL_LENGTH(N'塑胶领料明细单', N'模具编号') IS NULL ALTER TABLE [塑胶领料明细单] ADD [模具编号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶领料明细单', N'色粉号')   IS NULL ALTER TABLE [塑胶领料明细单] ADD [色粉号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶领料明细单', N'用料名称') IS NULL ALTER TABLE [塑胶领料明细单] ADD [用料名称] nvarchar(40) NULL;
IF COL_LENGTH(N'塑胶领料明细单', N'装配采购') IS NULL ALTER TABLE [塑胶领料明细单] ADD [装配采购] nvarchar(10) NULL;
```

- [ ] **Step 2: 应用到两库**(PowerShell):

```powershell
foreach ($V in "ERP_DB","ERP_TEST_DB") {
  $cs = [Environment]::GetEnvironmentVariable($V,"User")
  $c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
  $cmd = $c.CreateCommand(); $cmd.CommandText = [IO.File]::ReadAllText((Resolve-Path "db/22_plastic_issue_form.sql")); $null = $cmd.ExecuteNonQuery()
  $c.Close(); Write-Output "$V ok"
}
```
Expected: `ERP_DB ok` 和 `ERP_TEST_DB ok`。

- [ ] **Step 3: 验证列存在**(PowerShell):

```powershell
$cs = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
$c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
$cmd = $c.CreateCommand()
$cmd.CommandText = "SELECT (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'塑胶领料单') AND name IN (N'胶箱数',N'纸箱数',N'钙塑箱数',N'卡板数',N'收件人',N'电脑单号',N'领料备注')) AS h, (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'塑胶领料明细单') AND name IN (N'生产单号',N'款号',N'模具编号',N'色粉号',N'用料名称',N'装配采购')) AS d"
$r = $cmd.ExecuteReader(); $r.Read(); Write-Output ("header=" + $r["h"] + " detail=" + $r["d"]); $c.Close()
```
Expected: `header=7 detail=6`。

- [ ] **Step 4: Commit**

```powershell
git add db/22_plastic_issue_form.sql
git commit -m @'
feat(塑胶领料单保真): 头/明细补原系统字段(ALTER ADD 幂等)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 后端 DTO + Service 带新字段 + 往返测试

**Files:** Modify `PlasticIssueDtos.cs`, `PlasticIssueService.cs`; Create `tests/ErpApi.Tests/PlasticIssueFormDbTests.cs`

- [ ] **Step 1: 改 DTO** 把 `src/ErpApi/Features/Plastics/PlasticIssue/PlasticIssueDtos.cs` 整体替换为:

```csharp
namespace ErpApi.Features.Plastics.PlasticIssue;

public sealed class PlasticIssueHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 领料部门 { get; set; }
    public string? 领料人 { get; set; }
    public string? 仓库 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
    public int? 胶箱数 { get; set; }
    public int? 纸箱数 { get; set; }
    public int? 钙塑箱数 { get; set; }
    public int? 卡板数 { get; set; }
    public string? 收件人 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 领料备注 { get; set; }
}

public sealed class PlasticIssueLineDto
{
    public long ID { get; set; }
    public string? 装配采购 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 色粉号 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticIssueDetailDto
{
    public PlasticIssueHeaderDto? 单头 { get; set; }
    public List<PlasticIssueLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticIssueCreateLineDto
{
    public string? 装配采购 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 色粉号 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticIssueCreateDto
{
    public string? 领料部门 { get; set; }
    public string? 领料人 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public int? 胶箱数 { get; set; }
    public int? 纸箱数 { get; set; }
    public int? 钙塑箱数 { get; set; }
    public int? 卡板数 { get; set; }
    public string? 收件人 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 领料备注 { get; set; }
    public List<PlasticIssueCreateLineDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 2: 改 Service 的 CreateAsync 头 INSERT** 在 `PlasticIssueService.cs`,把头表 INSERT 替换为(加新列):

```csharp
        await c.ExecuteAsync(@"
INSERT INTO [塑胶领料单]([单号],[日期],[领料部门],[领料人],[仓库],[数量],[金额],[操作员],[审核],[备注],[胶箱数],[纸箱数],[钙塑箱数],[卡板数],[收件人],[电脑单号],[领料备注])
VALUES(@单号,@日期,@领料部门,@领料人,@仓库,@数量,@金额,@操作员,'0',@备注,@胶箱数,@纸箱数,@钙塑箱数,@卡板数,@收件人,@电脑单号,@领料备注)",
            new { 单号, 日期 = now, dto.领料部门, dto.领料人, dto.仓库, 数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注,
                  dto.胶箱数, dto.纸箱数, dto.钙塑箱数, dto.卡板数, dto.收件人, dto.电脑单号, dto.领料备注 }, tx);
```

- [ ] **Step 3: 改 Service 的明细 INSERT** 把明细 INSERT 替换为(加新列):

```csharp
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [塑胶领料明细单]([单号],[日期],[仓库],[装配采购],[生产单号],[款号],[物料编号],[模具编号],[物料名称],[规格],[颜色],[色粉号],[用料名称],[仓位号],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@日期,@仓库,@装配采购,@生产单号,@款号,@物料编号,@模具编号,@物料名称,@规格,@颜色,@色粉号,@用料名称,@仓位号,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, 日期 = now, dto.仓库, l.装配采购, l.生产单号, l.款号, l.物料编号, l.模具编号, l.物料名称, l.规格, l.颜色, l.色粉号, l.用料名称, l.仓位号, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注 }, tx);
```

- [ ] **Step 4: 改 Service 的 GetAsync 两个 SELECT** 把 GetAsync 里头/明细 SELECT 替换为(读出新列):

```csharp
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[领料部门],[领料人],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注],[胶箱数],[纸箱数],[钙塑箱数],[卡板数],[收件人],[电脑单号],[领料备注]
FROM [塑胶领料单] WHERE [单号]=@单号;
SELECT [ID],[装配采购],[生产单号],[款号],[物料编号],[模具编号],[物料名称],[规格],[颜色],[色粉号],[用料名称],[仓位号],[单位],[数量],[单价],[金额],[备注]
FROM [塑胶领料明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
```

(ListAsync/DeleteAsync 不改。)

- [ ] **Step 5: 写往返测试** Create `tests/ErpApi.Tests/PlasticIssueFormDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticIssue;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticIssueFormDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticIssueService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Create_persists_new_header_and_line_fields_then_Get_reads_back()
    {
        using var c = fx.Open();
        var 单号 = await Svc().CreateAsync(new PlasticIssueCreateDto
        {
            领料部门 = "注塑车间", 领料人 = "张三", 仓库 = "塑胶仓",
            胶箱数 = 2, 纸箱数 = 1, 钙塑箱数 = 3, 卡板数 = 4, 收件人 = "李四", 电脑单号 = "PC-01", 领料备注 = "生产领料",
            明细 =
            [
                new PlasticIssueCreateLineDto
                {
                    装配采购 = "是", 生产单号 = "MO-001", 款号 = "K100", 物料编号 = "PIFM01", 模具编号 = "MJ-9",
                    物料名称 = "ABS粒", 规格 = "规A", 颜色 = "黑", 色粉号 = "S5", 用料名称 = "外壳料", 单位 = "kg", 数量 = 8, 单价 = 5
                }
            ]
        }, "tester");
        try
        {
            Assert.StartsWith("SLL", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.Equal(2, d!.单头!.胶箱数);
            Assert.Equal("李四", d.单头!.收件人);
            Assert.Equal("PC-01", d.单头!.电脑单号);
            Assert.Equal("生产领料", d.单头!.领料备注);
            var l = Assert.Single(d.明细);
            Assert.Equal("是", l.装配采购);
            Assert.Equal("MO-001", l.生产单号);
            Assert.Equal("MJ-9", l.模具编号);
            Assert.Equal("S5", l.色粉号);
            Assert.Equal("外壳料", l.用料名称);
            Assert.Equal(8m, l.数量);
        }
        finally { c.Execute("DELETE FROM [塑胶领料明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶领料单] WHERE [单号]=@n", new { n = 单号 }); }
    }
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~PlasticIssueFormDbTests"`
Expected: PASS 1 个。(先跑会因 DTO/Service 改动编译——本任务一次性改完再跑。)

- [ ] **Step 7: 全量后端回归**

Run: `dotnet test`
Expected: 全部 PASS(356 起,不减;现有 `PlasticIssueReturnServiceDbTests` 仍绿——其 create 不传新字段,新列可空)。报告总数行。

- [ ] **Step 8: Commit**

```powershell
git add src/ErpApi/Features/Plastics/PlasticIssue tests/ErpApi.Tests/PlasticIssueFormDbTests.cs
git commit -m @'
feat(塑胶领料单保真): 后端DTO+Service带新头/明细字段+往返测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 前端 API + 明细可编辑网格

**Files:** Create `web/src/api/plasticIssue.ts`, `web/src/pages/plastics/PlasticIssueLineTable.tsx`

- [ ] **Step 1: 写 API** `web/src/api/plasticIssue.ts`:

```typescript
import { api } from "./client";
import type { Paged } from "./master";

export interface PILine {
  id?: number;
  装配采购?: string; 生产单号?: string; 款号?: string;
  物料编号?: string; 模具编号?: string; 物料名称?: string; 规格?: string; 颜色?: string;
  色粉号?: string; 用料名称?: string; 仓位号?: string; 单位?: string; 数量?: number; 备注?: string;
}
export interface PIHeader {
  id: number; 单号?: string; 日期?: string; 领料部门?: string; 领料人?: string; 仓库?: string;
  数量?: number | null; 金额?: number | null; 操作员?: string; 审核?: string; 审核人?: string; 备注?: string;
  胶箱数?: number | null; 纸箱数?: number | null; 钙塑箱数?: number | null; 卡板数?: number | null;
  收件人?: string; 电脑单号?: string; 领料备注?: string;
}
export interface PIDetail { 单头?: PIHeader; 明细: PILine[] }

const enc = encodeURIComponent;
export const plasticIssueApi = {
  list: (page = 1, size = 10, keyword = "") => api.get<Paged<PIHeader>>("/plastic-issues", { params: { page, size, keyword } }).then(r => r.data),
  get: (单号: string) => api.get<PIDetail>(`/plastic-issues/${enc(单号)}`).then(r => r.data),
  create: (body: Record<string, unknown>) => api.post<{ 单号: string }>("/plastic-issues", body).then(r => r.data),
  remove: (单号: string) => api.delete(`/plastic-issues/${enc(单号)}`),
  approve: (单号: string) => api.post(`/plastic-issues/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/plastic-issues/${enc(单号)}/unapprove`),
};
```

- [ ] **Step 2: 写明细网格** `web/src/pages/plastics/PlasticIssueLineTable.tsx`(镜像 MaterialLineTable usageColumns,改塑胶选择器+列):

```tsx
import { useState, type Dispatch, type SetStateAction } from "react";
import { Button, Input, InputNumber, Table } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import PlasticMaterialPicker from "./PlasticMaterialPicker";
import ProductionPicker from "../materials/ProductionPicker";
import type { PlasticMaterialRow } from "../../api/plasticMaterialMaster";
import type { ProductionTrackingRow } from "../../api/productionReports";
import type { PILine } from "../../api/plasticIssue";

// 塑胶领料明细可编辑行(保真列序:装配采购|生产单号|款号|物料编号|模具编号|物料名称|颜色|色粉号|用料名称|单位|数量)。
// 物料编号🔍=PlasticMaterialPicker(回填名称/规格/颜色/仓位号/单位);生产单号/款号🔍=ProductionPicker(回填生产单号/款号)。只读=查看已建单。
export default function PlasticIssueLineTable({ value, onChange, readOnly }: {
  value: PILine[];
  onChange: Dispatch<SetStateAction<PILine[]>>;
  readOnly?: boolean;
}) {
  const setLine = (i: number, patch: Partial<PILine>) =>
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

  const columns = [
    { title: "装配采购", dataIndex: "装配采购", width: 88, render: (_: unknown, r: PILine, i: number) => txt(r.装配采购, s => setLine(i, { 装配采购: s }), 76) },
    { title: "生产单号", dataIndex: "生产单号", width: 150, render: (_: unknown, r: PILine, i: number) => pickCell(r.生产单号, s => setLine(i, { 生产单号: s }), () => setProdPickFor(i), 128) },
    { title: "款号", dataIndex: "款号", width: 124, render: (_: unknown, r: PILine, i: number) => pickCell(r.款号, s => setLine(i, { 款号: s }), () => setProdPickFor(i), 102) },
    { title: "物料编号", dataIndex: "物料编号", width: 140, render: (_: unknown, r: PILine, i: number) => pickCell(r.物料编号, s => setLine(i, { 物料编号: s }), () => setMatPickFor(i), 118) },
    { title: "模具编号", dataIndex: "模具编号", width: 110, render: (_: unknown, r: PILine, i: number) => txt(r.模具编号, s => setLine(i, { 模具编号: s }), 98) },
    { title: "物料名称", dataIndex: "物料名称", width: 140, render: (v: string) => ro(v) },
    { title: "颜色", dataIndex: "颜色", width: 80, render: (_: unknown, r: PILine, i: number) => txt(r.颜色, s => setLine(i, { 颜色: s }), 68) },
    { title: "色粉号", dataIndex: "色粉号", width: 100, render: (_: unknown, r: PILine, i: number) => txt(r.色粉号, s => setLine(i, { 色粉号: s }), 88) },
    { title: "用料名称", dataIndex: "用料名称", width: 120, render: (_: unknown, r: PILine, i: number) => txt(r.用料名称, s => setLine(i, { 用料名称: s }), 108) },
    { title: "单位", dataIndex: "单位", width: 64, render: (v: string) => ro(v) },
    { title: "数量", dataIndex: "数量", width: 96, render: (_: unknown, r: PILine, i: number) => <InputNumber min={0} precision={2} style={{ width: 84 }} disabled={readOnly} value={r.数量 ?? 0} onChange={n => setLine(i, { 数量: Number(n ?? 0) })} /> },
    ...(readOnly ? [] : [{ title: "", key: "_op", width: 50, render: (_: unknown, __: PILine, i: number) => <a onClick={() => onChange(prev => prev.filter((_, j) => j !== i))}>删除</a> }]),
  ];

  return (
    <div>
      <Table size="small" rowKey={(_: PILine, i?: number) => String(i)} pagination={false}
        dataSource={value} columns={columns} scroll={{ x: "max-content" }} />
      {!readOnly && <Button icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={() => onChange(prev => [...prev, { 数量: 0 }])}>加一行</Button>}
      <PlasticMaterialPicker open={matPickFor !== null} onPick={fillFromMaterial} onClose={() => setMatPickFor(null)} />
      <ProductionPicker open={prodPickFor !== null} onPick={fillFromProduction} onClose={() => setProdPickFor(null)} />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```powershell
git add web/src/api/plasticIssue.ts web/src/pages/plastics/PlasticIssueLineTable.tsx
git commit -m @'
feat(塑胶领料单保真): 前端typed API + 明细可编辑网格(保真列序+塑胶选择器)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: 全屏主从录入页 + 路由替换

**Files:** Create `web/src/pages/plastics/PlasticIssueFormPage.tsx`; Modify `web/src/App.tsx`

- [ ] **Step 1: 写页面** `web/src/pages/plastics/PlasticIssueFormPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Checkbox, Col, Form, Input, InputNumber, Popconfirm, Row, Select, Space, Statistic, Table, Tag, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { plasticIssueApi, type PIHeader, type PILine } from "../../api/plasticIssue";
import { plasticInventoryApi } from "../../api/plasticInventory";
import EmployeePicker from "../materials/EmployeePicker";
import PlasticIssueLineTable from "./PlasticIssueLineTable";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "塑胶领料单";
const today = () => new Date().toLocaleDateString("zh-CN");
const currentUser = () => localStorage.getItem("erp_user") ?? "";

export default function PlasticIssueFormPage() {
  const perms = usePerms();
  const [form] = Form.useForm<Record<string, unknown>>();
  const 仓库 = Form.useWatch("仓库", form);
  const [lines, setLines] = useState<PILine[]>([]);
  const [rows, setRows] = useState<PIHeader[]>([]);
  const [opened, setOpened] = useState<string | null>(null);   // 当前打开的已存在单号(只读查看)
  const [saving, setSaving] = useState(false);
  const [empPickFor, setEmpPickFor] = useState<string | null>(null);
  const [mergePrint, setMergePrint] = useState(true);
  const [stock, setStock] = useState<Record<string, number>>({});
  const readOnly = opened !== null;

  const loadRows = useCallback(async () => {
    try { setRows((await plasticIssueApi.list(1, 50, "")).items); }
    catch { message.error("加载领料单失败"); }
  }, []);
  useEffect(() => { loadRows(); }, [loadRows]);

  // 库存参考:按所选仓库拉塑胶库存,映射 物料编号→库存数量
  useEffect(() => {
    const wh = (仓库 as string) || "";
    if (!wh) { setStock({}); return; }
    plasticInventoryApi.list(wh).then(list => {
      const m: Record<string, number> = {};
      for (const r of list) if (r.物料编号) m[r.物料编号] = r.库存数量;
      setStock(m);
    }).catch(() => setStock({}));
  }, [仓库]);

  const reset = () => {
    form.resetFields();
    form.setFieldsValue({ 日期: today(), 操作员: currentUser(), 领料备注: "生产领料" });
    setLines([]); setOpened(null);
  };
  useEffect(() => { reset(); /* 首次进入空白新建 */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openDoc = async (单号: string) => {
    try {
      const d = await plasticIssueApi.get(单号);
      const h = d.单头 ?? {} as PIHeader;
      form.setFieldsValue({
        领料部门: h.领料部门, 领料人: h.领料人, 仓库: h.仓库, 备注: h.备注,
        日期: h.日期?.slice(0, 10), 操作员: h.操作员, 电脑单号: h.电脑单号, 收件人: h.收件人, 领料备注: h.领料备注,
        胶箱数: h.胶箱数, 纸箱数: h.纸箱数, 钙塑箱数: h.钙塑箱数, 卡板数: h.卡板数,
      });
      setLines(d.明细 ?? []); setOpened(单号);
    } catch { message.error("打开领料单失败"); }
  };

  const save = async () => {
    if (readOnly) { message.info("查看模式:请先「新建」再录入"); return; }
    let v: Record<string, unknown>;
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => l.物料编号 && Number(l.数量) > 0);
    if (ok.length === 0) { message.error("请至少录入一行有效物料明细(物料编号+数量)"); return; }
    setSaving(true);
    try {
      await plasticIssueApi.create({ ...v, 明细: ok });
      message.success("塑胶领料单已创建"); reset(); loadRows();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建失败");
    } finally { setSaving(false); }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); loadRows(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  // 库存参考行:左侧明细去重物料 + 当前库存
  const stockRefRows = useMemo(() => {
    const seen = new Set<string>(); const out: { 物料编号: string; 物料名称?: string; 库存数量: number }[] = [];
    lines.forEach(l => { if (l.物料编号 && !seen.has(l.物料编号)) { seen.add(l.物料编号); out.push({ 物料编号: l.物料编号, 物料名称: l.物料名称, 库存数量: stock[l.物料编号] ?? 0 }); } });
    return out;
  }, [lines, stock]);

  const empField = (name: string, label: string, required?: boolean) => (
    <Form.Item name={name} label={label} rules={required ? [{ required: true, message: `请选${label}` }] : undefined}>
      <Input readOnly placeholder="点🔍选人"
        suffix={readOnly ? null : <SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={() => setEmpPickFor(name)} />} />
    </Form.Item>
  );

  const listColumns = [
    { title: "领料单号", dataIndex: "单号", key: "单号", render: (v: string) => <a onClick={() => openDoc(v)} className="erp-num">{v}</a> },
    { title: "领料部门", dataIndex: "领料部门", key: "领料部门" },
    { title: "领料人", dataIndex: "领料人", key: "领料人" },
    { title: "仓库", dataIndex: "仓库", key: "仓库" },
    { title: "数量", dataIndex: "数量", key: "数量" },
    { title: "日期", dataIndex: "日期", key: "日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "状态", dataIndex: "审核", key: "审核", render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: PIHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => plasticIssueApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => plasticIssueApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该领料单?" onConfirm={() => act(() => plasticIssueApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const numField = (name: string, label: string) => (
    <Form.Item name={name} label={label}><InputNumber min={0} precision={0} disabled={readOnly} style={{ width: "100%" }} /></Form.Item>
  );

  return (
    <Card title={`塑胶领料单${readOnly ? `（查看 ${opened}）` : "（新建）"}`} variant="borderless"
      extra={
        <Space wrap>
          <Button onClick={reset}>新建</Button>
          {can(perms, MENU, "保存") && <Button type="primary" loading={saving} disabled={readOnly} onClick={save}>保存</Button>}
          <Button onClick={() => window.print()}>打印</Button>
          <Checkbox checked={mergePrint} onChange={e => setMergePrint(e.target.checked)}>打印合并表格</Checkbox>
        </Space>
      }>
      <Form form={form} layout="vertical" size="small">
        <Row gutter={12}>
          <Col span={5}><Form.Item name="领料部门" label="部门"><Input disabled={readOnly} /></Form.Item></Col>
          <Col span={4}><Form.Item name="日期" label="日期"><Input disabled /></Form.Item></Col>
          <Col span={5}>{empField("领料人", "领料人", true)}</Col>
          <Col span={4}><Form.Item name="操作员" label="操作员"><Input disabled /></Form.Item></Col>
          <Col span={3}><Form.Item name="仓库" label="仓库" rules={[{ required: true, message: "请填仓库" }]}><Input disabled={readOnly} /></Form.Item></Col>
          <Col span={3}><Form.Item name="电脑单号" label="电脑单号"><Input disabled /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={3}>{numField("胶箱数", "胶箱数")}</Col>
          <Col span={3}>{numField("纸箱数", "纸箱")}</Col>
          <Col span={3}>{numField("钙塑箱数", "钙塑箱")}</Col>
          <Col span={3}>{numField("卡板数", "卡板数")}</Col>
          <Col span={5}>{empField("收件人", "收件人")}</Col>
          <Col span={4}>
            <Form.Item name="领料备注" label="领料备注">
              <Select disabled={readOnly} options={[{ value: "生产领料" }, { value: "样品领料" }, { value: "维修领料" }]} />
            </Form.Item>
          </Col>
          <Col span={3}><Form.Item name="备注" label="备注"><Input disabled={readOnly} /></Form.Item></Col>
        </Row>
      </Form>

      <Row gutter={12}>
        <Col span={17}>
          <PlasticIssueLineTable value={lines} onChange={setLines} readOnly={readOnly} />
        </Col>
        <Col span={7}>
          <Table size="small" pagination={false} rowKey="物料编号"
            title={() => "库存参考"}
            dataSource={stockRefRows}
            columns={[
              { title: "序号", key: "_i", width: 50, render: (_: unknown, __: unknown, i: number) => i + 1 },
              { title: "物料编号", dataIndex: "物料编号" },
              { title: "物料名称", dataIndex: "物料名称" },
              { title: "库存数量", dataIndex: "库存数量", align: "right" as const },
            ]} />
        </Col>
      </Row>

      <Space style={{ marginTop: 16 }} size={32}>
        <Statistic title="数量合计" value={lines.reduce((s, l) => s + Number(l.数量 ?? 0), 0)} />
        <Statistic title="重量合计" value={"0.0"} />
        <Statistic title="制单人" value={currentUser()} />
      </Space>

      <div style={{ marginTop: 24 }}>
        <Table rowKey="id" size="middle" dataSource={rows} columns={listColumns} pagination={{ pageSize: 10 }} />
      </div>

      <EmployeePicker open={empPickFor !== null}
        onPick={姓名 => { if (empPickFor) form.setFieldValue(empPickFor, 姓名); }}
        onClose={() => setEmpPickFor(null)} />
    </Card>
  );
}
```

- [ ] **Step 2: 换路由** 在 `web/src/App.tsx`:
  - 顶部加 import:`import PlasticIssueFormPage from "./pages/plastics/PlasticIssueFormPage";`(放其它塑胶页 import 附近)。
  - 把 `<Route path="plastic-issues" element={<PlasticDocPage cfg={PLASTIC_DOC_CONFIGS["plastic-issues"]} />} />` 改为:
    `<Route path="plastic-issues" element={<PlasticIssueFormPage />} />`

- [ ] **Step 3: 前端测试 + 构建**

Run: `npm --prefix web run test`
Expected: PASS(54,无回归)。

Run: `npm --prefix web run build`
Expected: tsc 干净 + 构建成功。

- [ ] **Step 4: Commit**

```powershell
git add web/src/pages/plastics/PlasticIssueFormPage.tsx web/src/App.tsx
git commit -m @'
feat(塑胶领料单保真): 全屏主从录入页(工具栏+表头+左明细+右库存参考+历史列表)+路由替换

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟(本地 API + 页面字段往返)**

重启后端(新代码,`-c Release`,`ASPNETCORE_URLS=http://127.0.0.1:5000`,env ERP_DB/ERP_JWT_KEY),待就绪。Node axios(`proxy:false`)脚本:admin 登录 → POST `/api/plastic-issues`(带 胶箱数=2/收件人/领料备注 + 明细 装配采购/生产单号/模具编号/物料编号 SMOKEPI/数量 8/仓库 塑胶仓)→ approve → GET 该单读回新字段一致 → GET `/api/plastic-inventory?keyword=SMOKEPI` 库存为 −8(若该物料无前序入仓则为 −8,或先建入仓 20 再领 8 验 12)→ 清理(反审核+删)。

Expected: 新字段往返一致、审核成功、库存按领料 − 变化。

- [ ] **Step 2: opus 全分支终审**

派 opus 子代理对 `feat-plastic-issue-form` 全分支 diff 终审:确认 DB 列幂等、Service INSERT/SELECT 列与 DTO 一致(无错列/漏列)、库存方向未变、前端 PILine 字段与 DTO 一致、明细网格列序保真、只读查看模式正确、路由替换无残留、其它五单未受影响。目标 READY TO MERGE。

- [ ] **Step 3: 合并 master**

```powershell
git checkout master
git merge --no-ff feat-plastic-issue-form -m @'
Merge branch 'feat-plastic-issue-form' into master

塑胶领料单保真重做(全屏主从录入页+头/明细补字段)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
git branch -d feat-plastic-issue-form
```

- [ ] **Step 4: worklog + MEMORY** Create `docs/worklogs/2026-06-26-plastic-issue-form.md`(做了什么/执行/测试/冒烟/合并/下一步=退料退仓报废入仓照此模板克隆);在塑胶记忆文件追加本次摘要。Commit。

```powershell
git add docs/worklogs/2026-06-26-plastic-issue-form.md
git commit -m @'
docs(worklog): 塑胶领料单保真重做 2026-06-26

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## 自审清单(已核对)

- **Spec 覆盖**:DB 列(头7+明细6)=Task1;DTO/Service 带新字段+往返测试=Task2;typed API+明细网格=Task3;全屏页(工具栏/表头/左明细/右库存参考/底部/历史列表)+路由=Task4;冒烟/终审/合并/worklog=Task5。右侧库存参考用现成 `api/plastic-inventory`。无遗漏。
- **类型一致**:`PIHeader`/`PILine`/`PIDetail` 前端字段与后端 `PlasticIssueHeaderDto`/`PlasticIssueLineDto`/`PlasticIssueCreateLineDto` 一致;`plasticIssueApi.create` 传 `{...表单, 明细}`;明细网格 `PILine` 与页面共用。
- **无占位**:每步含完整代码/命令/预期(重量合计 0.0 为有意占位,无逐行重量源)。
- **列名一致**:Service INSERT 列、SELECT 列、DTO 属性、DB ADD 列 四处对齐(头:胶箱数/纸箱数/钙塑箱数/卡板数/收件人/电脑单号/领料备注;明细:装配采购/生产单号/款号/模具编号/色粉号/用料名称)。
- **库存不变**:LedgerUnion 领料支(数量*-1)未动;明细新列不参与库存。
- **回归**:现有 `PlasticIssueReturnServiceDbTests` 不传新字段仍绿(新列可空);仓库必填校验不变。
- **路由替换**:`PLASTIC_DOC_CONFIGS["plastic-issues"]` 保留供其它复用(不被新页引用),只换 Route 元素。
