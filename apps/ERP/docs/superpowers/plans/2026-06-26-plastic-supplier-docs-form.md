# 塑胶退料/报废/入仓 保真重做 + 退仓抽通用供应商单据页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 塑胶退料/报废/入仓 三单按退仓同款表头/明细保真;把退仓全屏页抽成 config 驱动的通用供应商单据页,四单(退仓/退料/报废/入仓)共用;后端三单补列,库存方向/单号/审核/脱敏不变。

**Architecture:** 后端 `PlasticReturn`/`PlasticScrap`/`PlasticReceipt` 三 service 各在头/明细两表 ALTER ADD 新列、DTO 与 INSERT/SELECT 带新列(退料/报废 改用供应商头,旧 部门/人 列保留弃用;入仓已有供应商头)。前端把退仓页/明细网格/API 通用化为 config 驱动四单共用,删旧退仓专用三文件。供应商选择与入仓带出复用已有件(SupplierPicker、PlasticReceiptPicker、plastic-receipts list/get、master/suppliers)。

**Tech Stack:** .NET 8 + Dapper + SQL Server LocalDB;React 18 + TS + Vite + Ant Design v6 + Vitest。

---

## 前置约定

- 工作目录 `D:\WebpageERP`,分支 `feat-plastic-supplier-docs-form`,完成 `--no-ff` 合并 master 删分支。PowerShell;`dotnet` 不在 PATH:`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 测试 env(空时)从 User 取:`$env:ERP_TEST_DB`/`$env:ERP_JWT_KEY`/`$env:ERP_DB`。后端测试 `dotnet test`(锁 DLL 用 `-c Release`)。前端 `npm --prefix web run test`/`build`。
- 提交末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。LF→CRLF 警告正常。
- 镜像源:`PlasticWarehouseReturn`(退仓·已是供应商头+新列的范本)、`web/src/pages/plastics/PlasticWarehouseReturnFormPage.tsx`/`PlasticWarehouseReturnLineTable.tsx`/`web/src/api/plasticWarehouseReturn.ts`(本任务通用化它们)。复用件:`SupplierPicker`、`PlasticReceiptPicker`、`PlasticMaterialPicker`、`ProductionPicker`。

## 文件结构

| 文件 | 责任 | 新建/改/删 |
|---|---|---|
| `db/24_plastic_supplier_docs_form.sql` | 退料/报废/入仓 头+明细 ALTER ADD | 新建 |
| `src/.../PlasticReturn/PlasticReturnDtos.cs`+`PlasticReturnService.cs` | 退料补供应商头+新列 | 改 |
| `src/.../PlasticScrap/PlasticScrapDtos.cs`+`PlasticScrapService.cs` | 报废补供应商头+新列 | 改 |
| `src/.../PlasticReceipt/PlasticReceiptDtos.cs`+`PlasticReceiptService.cs` | 入仓补出库/入仓/电脑+明细新列 | 改 |
| `tests/ErpApi.Tests/PlasticReturnSupplierFormDbTests.cs` 等×3 | 三单往返测试 | 新建 |
| `web/src/api/plasticSupplierDoc.ts` | 通用 typed API 工厂 | 新建 |
| `web/src/pages/plastics/PlasticSupplierDocLineTable.tsx` | 通用明细网格(= 退仓网格改名) | 新建(由旧改名) |
| `web/src/pages/plastics/PlasticSupplierDocFormPage.tsx` | 通用供应商单据页(cfg 参数化) | 新建(由旧参数化) |
| `web/src/pages/plastics/PlasticSupplierDocConfigs.ts` | 四单 config | 新建 |
| `web/src/App.tsx` | 四路由用通用页 | 改 |
| 旧 `PlasticWarehouseReturnFormPage.tsx`/`PlasticWarehouseReturnLineTable.tsx`/`api/plasticWarehouseReturn.ts` | 删 | 删 |

---

## Task 1: 建表脚本(三单头+明细 ALTER ADD)+ 应用两库

**Files:** Create `db/24_plastic_supplier_docs_form.sql`

- [ ] **Step 1: 写脚本** `db/24_plastic_supplier_docs_form.sql`:

```sql
-- 塑胶退料/报废/入仓 保真重做:统一退仓同款表头/明细。幂等(COL_LENGTH 判空再 ADD)。
-- 退料/报废 改用供应商头(旧 退料部门/退料人、报废部门/报废人 保留不动)。
SET XACT_ABORT ON;
-- 塑胶退料单(头)
IF COL_LENGTH(N'塑胶退料单', N'供应商编号') IS NULL ALTER TABLE [塑胶退料单] ADD [供应商编号] nvarchar(20) NULL;
IF COL_LENGTH(N'塑胶退料单', N'供应商名称') IS NULL ALTER TABLE [塑胶退料单] ADD [供应商名称] nvarchar(60) NULL;
IF COL_LENGTH(N'塑胶退料单', N'出库单号')   IS NULL ALTER TABLE [塑胶退料单] ADD [出库单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶退料单', N'入仓单号')   IS NULL ALTER TABLE [塑胶退料单] ADD [入仓单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶退料单', N'电脑单号')   IS NULL ALTER TABLE [塑胶退料单] ADD [电脑单号] nvarchar(30) NULL;
-- 塑胶报废单(头)
IF COL_LENGTH(N'塑胶报废单', N'供应商编号') IS NULL ALTER TABLE [塑胶报废单] ADD [供应商编号] nvarchar(20) NULL;
IF COL_LENGTH(N'塑胶报废单', N'供应商名称') IS NULL ALTER TABLE [塑胶报废单] ADD [供应商名称] nvarchar(60) NULL;
IF COL_LENGTH(N'塑胶报废单', N'出库单号')   IS NULL ALTER TABLE [塑胶报废单] ADD [出库单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶报废单', N'入仓单号')   IS NULL ALTER TABLE [塑胶报废单] ADD [入仓单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶报废单', N'电脑单号')   IS NULL ALTER TABLE [塑胶报废单] ADD [电脑单号] nvarchar(30) NULL;
-- 塑胶入仓单(头·供应商已有)
IF COL_LENGTH(N'塑胶入仓单', N'出库单号')   IS NULL ALTER TABLE [塑胶入仓单] ADD [出库单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶入仓单', N'入仓单号')   IS NULL ALTER TABLE [塑胶入仓单] ADD [入仓单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶入仓单', N'电脑单号')   IS NULL ALTER TABLE [塑胶入仓单] ADD [电脑单号] nvarchar(30) NULL;
-- 三明细表各补 生产单号/款号/塑胶货号
IF COL_LENGTH(N'塑胶退料明细单', N'生产单号') IS NULL ALTER TABLE [塑胶退料明细单] ADD [生产单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶退料明细单', N'款号')     IS NULL ALTER TABLE [塑胶退料明细单] ADD [款号] nvarchar(40) NULL;
IF COL_LENGTH(N'塑胶退料明细单', N'塑胶货号') IS NULL ALTER TABLE [塑胶退料明细单] ADD [塑胶货号] nvarchar(40) NULL;
IF COL_LENGTH(N'塑胶报废明细单', N'生产单号') IS NULL ALTER TABLE [塑胶报废明细单] ADD [生产单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶报废明细单', N'款号')     IS NULL ALTER TABLE [塑胶报废明细单] ADD [款号] nvarchar(40) NULL;
IF COL_LENGTH(N'塑胶报废明细单', N'塑胶货号') IS NULL ALTER TABLE [塑胶报废明细单] ADD [塑胶货号] nvarchar(40) NULL;
IF COL_LENGTH(N'塑胶入仓明细单', N'生产单号') IS NULL ALTER TABLE [塑胶入仓明细单] ADD [生产单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶入仓明细单', N'款号')     IS NULL ALTER TABLE [塑胶入仓明细单] ADD [款号] nvarchar(40) NULL;
IF COL_LENGTH(N'塑胶入仓明细单', N'塑胶货号') IS NULL ALTER TABLE [塑胶入仓明细单] ADD [塑胶货号] nvarchar(40) NULL;
```

- [ ] **Step 2: 应用两库**(PowerShell):

```powershell
foreach ($V in "ERP_DB","ERP_TEST_DB") {
  $cs = [Environment]::GetEnvironmentVariable($V,"User")
  $c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
  $cmd = $c.CreateCommand(); $cmd.CommandText = [IO.File]::ReadAllText((Resolve-Path "db/24_plastic_supplier_docs_form.sql")); $null = $cmd.ExecuteNonQuery()
  $c.Close(); Write-Output "$V ok"
}
```
Expected: `ERP_DB ok` 和 `ERP_TEST_DB ok`。

- [ ] **Step 3: 验证列**(PowerShell):

```powershell
$cs = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
$c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open()
$cmd = $c.CreateCommand()
$cmd.CommandText = @"
SELECT
 (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'塑胶退料单') AND name IN (N'供应商编号',N'供应商名称',N'出库单号',N'入仓单号',N'电脑单号')) AS tl,
 (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'塑胶报废单') AND name IN (N'供应商编号',N'供应商名称',N'出库单号',N'入仓单号',N'电脑单号')) AS bf,
 (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'塑胶入仓单') AND name IN (N'出库单号',N'入仓单号',N'电脑单号')) AS rk,
 (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'塑胶退料明细单') AND name IN (N'生产单号',N'款号',N'塑胶货号')) AS tld,
 (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'塑胶报废明细单') AND name IN (N'生产单号',N'款号',N'塑胶货号')) AS bfd,
 (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'塑胶入仓明细单') AND name IN (N'生产单号',N'款号',N'塑胶货号')) AS rkd
"@
$r = $cmd.ExecuteReader(); $r.Read(); Write-Output ("tl=$($r["tl"]) bf=$($r["bf"]) rk=$($r["rk"]) tld=$($r["tld"]) bfd=$($r["bfd"]) rkd=$($r["rkd"])"); $c.Close()
```
Expected: `tl=5 bf=5 rk=3 tld=3 bfd=3 rkd=3`。

- [ ] **Step 4: Commit**

```powershell
git add db/24_plastic_supplier_docs_form.sql
git commit -m @'
feat(塑胶供应商单据保真): 退料/报废/入仓 头+明细补字段(ALTER ADD 幂等)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 塑胶退料 后端补供应商头+新列+往返测试

**Files:** Modify `PlasticReturnDtos.cs`, `PlasticReturnService.cs`; Create `tests/ErpApi.Tests/PlasticReturnSupplierFormDbTests.cs`

- [ ] **Step 1: 替换整个 DTO** `src/ErpApi/Features/Plastics/PlasticReturn/PlasticReturnDtos.cs`:

```csharp
namespace ErpApi.Features.Plastics.PlasticReturn;

public sealed class PlasticReturnHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 退料部门 { get; set; }
    public string? 退料人 { get; set; }
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

public sealed class PlasticReturnLineDto
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

public sealed class PlasticReturnDetailDto
{
    public PlasticReturnHeaderDto? 单头 { get; set; }
    public List<PlasticReturnLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticReturnCreateLineDto
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

public sealed class PlasticReturnCreateDto
{
    public string? 退料部门 { get; set; }
    public string? 退料人 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public string? 出库单号 { get; set; }
    public string? 入仓单号 { get; set; }
    public string? 电脑单号 { get; set; }
    public List<PlasticReturnCreateLineDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 2: 改 Service 头 INSERT** 在 `PlasticReturnService.cs` 把头 INSERT 块替换为:

```csharp
        await c.ExecuteAsync(@"
INSERT INTO [塑胶退料单]([单号],[日期],[退料部门],[退料人],[仓库],[数量],[金额],[操作员],[审核],[备注],[供应商编号],[供应商名称],[出库单号],[入仓单号],[电脑单号])
VALUES(@单号,@日期,@退料部门,@退料人,@仓库,@数量,@金额,@操作员,'0',@备注,@供应商编号,@供应商名称,@出库单号,@入仓单号,@电脑单号)",
            new { 单号, 日期 = now, dto.退料部门, dto.退料人, dto.仓库, 数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注,
                  dto.供应商编号, dto.供应商名称, dto.出库单号, dto.入仓单号, dto.电脑单号 }, tx);
```

- [ ] **Step 3: 改 Service 明细 INSERT** 替换为:

```csharp
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [塑胶退料明细单]([单号],[日期],[仓库],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[塑胶货号],[仓位号],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@日期,@仓库,@生产单号,@款号,@物料编号,@物料名称,@规格,@颜色,@塑胶货号,@仓位号,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, 日期 = now, dto.仓库, l.生产单号, l.款号, l.物料编号, l.物料名称, l.规格, l.颜色, l.塑胶货号, l.仓位号, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注 }, tx);
```

- [ ] **Step 4: 改 Service GetAsync SELECT** 把 GetAsync 的 QueryMultipleAsync 替换为:

```csharp
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[退料部门],[退料人],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注],[出库单号],[入仓单号],[电脑单号]
FROM [塑胶退料单] WHERE [单号]=@单号;
SELECT [ID],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[塑胶货号],[仓位号],[单位],[数量],[单价],[金额],[备注]
FROM [塑胶退料明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
```

(ListAsync/DeleteAsync 不改。)

- [ ] **Step 5: 写往返测试** Create `tests/ErpApi.Tests/PlasticReturnSupplierFormDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticReturn;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticReturnSupplierFormDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticReturnService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Create_persists_supplier_header_and_new_line_fields_then_Get_reads_back()
    {
        using var c = fx.Open();
        var 单号 = await Svc().CreateAsync(new PlasticReturnCreateDto
        {
            供应商编号 = "S01", 供应商名称 = "宏达塑料", 仓库 = "塑胶仓",
            出库单号 = "CK-10", 入仓单号 = "SR-OLD-10", 电脑单号 = "PC-10",
            明细 = [ new PlasticReturnCreateLineDto { 生产单号 = "MO-T", 款号 = "K-T", 物料编号 = "PRSM01", 物料名称 = "PP", 颜色 = "白", 塑胶货号 = "H-T", 单位 = "kg", 数量 = 3, 单价 = 6 } ]
        }, "tester");
        try
        {
            Assert.StartsWith("STL", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.Equal("宏达塑料", d!.单头!.供应商名称);
            Assert.Equal("CK-10", d.单头!.出库单号);
            Assert.Equal("SR-OLD-10", d.单头!.入仓单号);
            var l = Assert.Single(d.明细);
            Assert.Equal("MO-T", l.生产单号);
            Assert.Equal("H-T", l.塑胶货号);
            Assert.Equal(18m, l.金额);
        }
        finally { c.Execute("DELETE FROM [塑胶退料明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶退料单] WHERE [单号]=@n", new { n = 单号 }); }
    }
}
```

- [ ] **Step 6: 跑测试 + 提交**

Run: `dotnet test --filter "FullyQualifiedName~PlasticReturnSupplierFormDbTests"` → PASS 1。

```powershell
git add src/ErpApi/Features/Plastics/PlasticReturn tests/ErpApi.Tests/PlasticReturnSupplierFormDbTests.cs
git commit -m @'
feat(塑胶供应商单据保真): 塑胶退料 后端供应商头+新列+往返测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 塑胶报废 后端补供应商头+新列+往返测试

**Files:** Modify `PlasticScrapDtos.cs`, `PlasticScrapService.cs`; Create `tests/ErpApi.Tests/PlasticScrapSupplierFormDbTests.cs`

镜像 Task 2,把「退料/退料部门/退料人/塑胶退料单/塑胶退料明细单/PlasticReturn/STL」换成「报废/报废部门/报废人/塑胶报废单/塑胶报废明细单/PlasticScrap/SBF」。

- [ ] **Step 1: 替换整个 DTO** `src/ErpApi/Features/Plastics/PlasticScrap/PlasticScrapDtos.cs`:

```csharp
namespace ErpApi.Features.Plastics.PlasticScrap;

public sealed class PlasticScrapHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 报废部门 { get; set; }
    public string? 报废人 { get; set; }
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

public sealed class PlasticScrapLineDto
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

public sealed class PlasticScrapDetailDto
{
    public PlasticScrapHeaderDto? 单头 { get; set; }
    public List<PlasticScrapLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticScrapCreateLineDto
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

public sealed class PlasticScrapCreateDto
{
    public string? 报废部门 { get; set; }
    public string? 报废人 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public string? 出库单号 { get; set; }
    public string? 入仓单号 { get; set; }
    public string? 电脑单号 { get; set; }
    public List<PlasticScrapCreateLineDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 2: 改 Service 头 INSERT** 在 `PlasticScrapService.cs` 把头 INSERT 块替换为:

```csharp
        await c.ExecuteAsync(@"
INSERT INTO [塑胶报废单]([单号],[日期],[报废部门],[报废人],[仓库],[数量],[金额],[操作员],[审核],[备注],[供应商编号],[供应商名称],[出库单号],[入仓单号],[电脑单号])
VALUES(@单号,@日期,@报废部门,@报废人,@仓库,@数量,@金额,@操作员,'0',@备注,@供应商编号,@供应商名称,@出库单号,@入仓单号,@电脑单号)",
            new { 单号, 日期 = now, dto.报废部门, dto.报废人, dto.仓库, 数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注,
                  dto.供应商编号, dto.供应商名称, dto.出库单号, dto.入仓单号, dto.电脑单号 }, tx);
```

- [ ] **Step 3: 改 Service 明细 INSERT** 替换为:

```csharp
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [塑胶报废明细单]([单号],[日期],[仓库],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[塑胶货号],[仓位号],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@日期,@仓库,@生产单号,@款号,@物料编号,@物料名称,@规格,@颜色,@塑胶货号,@仓位号,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, 日期 = now, dto.仓库, l.生产单号, l.款号, l.物料编号, l.物料名称, l.规格, l.颜色, l.塑胶货号, l.仓位号, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注 }, tx);
```

- [ ] **Step 4: 改 Service GetAsync SELECT** 替换为:

```csharp
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[报废部门],[报废人],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注],[出库单号],[入仓单号],[电脑单号]
FROM [塑胶报废单] WHERE [单号]=@单号;
SELECT [ID],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[塑胶货号],[仓位号],[单位],[数量],[单价],[金额],[备注]
FROM [塑胶报废明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
```

- [ ] **Step 5: 写往返测试** Create `tests/ErpApi.Tests/PlasticScrapSupplierFormDbTests.cs`(同 Task2 测试,换 报废/PlasticScrap/SBF/塑胶报废明细单/塑胶报废单,物料 PSSM01):

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticScrap;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticScrapSupplierFormDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticScrapService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Create_persists_supplier_header_and_new_line_fields_then_Get_reads_back()
    {
        using var c = fx.Open();
        var 单号 = await Svc().CreateAsync(new PlasticScrapCreateDto
        {
            供应商编号 = "S01", 供应商名称 = "宏达塑料", 仓库 = "塑胶仓",
            出库单号 = "CK-11", 入仓单号 = "SR-OLD-11", 电脑单号 = "PC-11",
            明细 = [ new PlasticScrapCreateLineDto { 生产单号 = "MO-S", 款号 = "K-S", 物料编号 = "PSSM01", 物料名称 = "PP", 颜色 = "白", 塑胶货号 = "H-S", 单位 = "kg", 数量 = 4, 单价 = 5 } ]
        }, "tester");
        try
        {
            Assert.StartsWith("SBF", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.Equal("宏达塑料", d!.单头!.供应商名称);
            Assert.Equal("CK-11", d.单头!.出库单号);
            var l = Assert.Single(d.明细);
            Assert.Equal("MO-S", l.生产单号);
            Assert.Equal("H-S", l.塑胶货号);
            Assert.Equal(20m, l.金额);
        }
        finally { c.Execute("DELETE FROM [塑胶报废明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶报废单] WHERE [单号]=@n", new { n = 单号 }); }
    }
}
```

- [ ] **Step 6: 跑测试 + 提交**

Run: `dotnet test --filter "FullyQualifiedName~PlasticScrapSupplierFormDbTests"` → PASS 1。

```powershell
git add src/ErpApi/Features/Plastics/PlasticScrap tests/ErpApi.Tests/PlasticScrapSupplierFormDbTests.cs
git commit -m @'
feat(塑胶供应商单据保真): 塑胶报废 后端供应商头+新列+往返测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: 塑胶入仓 后端补出库/入仓/电脑+明细新列+往返测试

**Files:** Modify `PlasticReceiptDtos.cs`, `PlasticReceiptService.cs`; Create `tests/ErpApi.Tests/PlasticReceiptSupplierFormDbTests.cs`

入仓头已有供应商;只加 出库单号/入仓单号/电脑单号 + 明细 生产单号/款号/塑胶货号。

- [ ] **Step 1: 改 DTO** 在 `src/ErpApi/Features/Plastics/PlasticReceipt/PlasticReceiptDtos.cs`:
  - `PlasticReceiptHeaderDto` 末尾(`备注` 后)加:`public string? 出库单号 { get; set; } public string? 入仓单号 { get; set; } public string? 电脑单号 { get; set; }`
  - `PlasticReceiptCreateDto` 在 `备注` 后加同三字段。
  - `PlasticReceiptLineDto` 顶部(`物料编号` 前)加:`public string? 生产单号 { get; set; } public string? 款号 { get; set; }`,并在合适处加 `public string? 塑胶货号 { get; set; }`(放 颜色 后)。
  - `PlasticReceiptCreateLineDto` 同样加 `生产单号`/`款号`/`塑胶货号`。

  完整替换 `PlasticReceiptDtos.cs` 为:

```csharp
namespace ErpApi.Features.Plastics.PlasticReceipt;

public sealed class PlasticReceiptHeaderDto
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

public sealed class PlasticReceiptLineDto
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

public sealed class PlasticReceiptDetailDto
{
    public PlasticReceiptHeaderDto? 单头 { get; set; }
    public List<PlasticReceiptLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticReceiptCreateLineDto
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

public sealed class PlasticReceiptCreateDto
{
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public string? 出库单号 { get; set; }
    public string? 入仓单号 { get; set; }
    public string? 电脑单号 { get; set; }
    public List<PlasticReceiptCreateLineDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 2: 改 Service 头 INSERT** 在 `PlasticReceiptService.cs` 把头 INSERT 块替换为:

```csharp
        await c.ExecuteAsync(@"
INSERT INTO [塑胶入仓单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[备注],[出库单号],[入仓单号],[电脑单号])
VALUES(@单号,@日期,@供应商编号,@供应商名称,@仓库,@数量,@金额,@操作员,'0',@备注,@出库单号,@入仓单号,@电脑单号)",
            new { 单号, 日期 = now, dto.供应商编号, dto.供应商名称, dto.仓库, 数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注,
                  dto.出库单号, dto.入仓单号, dto.电脑单号 }, tx);
```
(注:原参数对象可能跨多行,确保保留原 数量合计/金额合计 变量名——若原变量名不同,按原文件实际名替换 `数量 = 数量合计, 金额 = 金额合计`。)

- [ ] **Step 3: 改 Service 明细 INSERT** 替换为:

```csharp
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [塑胶入仓明细单]([单号],[日期],[仓库],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[塑胶货号],[仓位号],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@日期,@仓库,@生产单号,@款号,@物料编号,@物料名称,@规格,@颜色,@塑胶货号,@仓位号,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, 日期 = now, dto.仓库, l.生产单号, l.款号, l.物料编号, l.物料名称, l.规格, l.颜色, l.塑胶货号, l.仓位号, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注 }, tx);
```

- [ ] **Step 4: 改 Service GetAsync SELECT** 把 GetAsync 的 QueryMultipleAsync 替换为:

```csharp
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注],[出库单号],[入仓单号],[电脑单号]
FROM [塑胶入仓单] WHERE [单号]=@单号;
SELECT [ID],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[塑胶货号],[仓位号],[单位],[数量],[单价],[金额],[备注]
FROM [塑胶入仓明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
```

- [ ] **Step 5: 写往返测试** Create `tests/ErpApi.Tests/PlasticReceiptSupplierFormDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticReceiptSupplierFormDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());

    [SkippableFact]
    public async Task Create_persists_new_header_and_line_fields_then_Get_reads_back()
    {
        using var c = fx.Open();
        var 单号 = await Svc().CreateAsync(new PlasticReceiptCreateDto
        {
            供应商编号 = "S01", 供应商名称 = "宏达塑料", 仓库 = "塑胶仓",
            出库单号 = "CK-12", 入仓单号 = "SR-REF-12", 电脑单号 = "PC-12",
            明细 = [ new PlasticReceiptCreateLineDto { 生产单号 = "MO-R", 款号 = "K-R", 物料编号 = "PRCM01", 物料名称 = "ABS", 颜色 = "黑", 塑胶货号 = "H-R", 单位 = "kg", 数量 = 5, 单价 = 8 } ]
        }, "tester");
        try
        {
            Assert.StartsWith("SR", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.Equal("CK-12", d!.单头!.出库单号);
            Assert.Equal("SR-REF-12", d.单头!.入仓单号);
            var l = Assert.Single(d.明细);
            Assert.Equal("MO-R", l.生产单号);
            Assert.Equal("H-R", l.塑胶货号);
            Assert.Equal(40m, l.金额);
        }
        finally { c.Execute("DELETE FROM [塑胶入仓明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶入仓单] WHERE [单号]=@n", new { n = 单号 }); }
    }
}
```

- [ ] **Step 6: 跑三单测试 + 全量回归 + 提交**

Run: `dotnet test --filter "FullyQualifiedName~PlasticReceiptSupplierFormDbTests"` → PASS 1。
Run: `dotnet test` → 全绿(358 → 约 361;现有 `PlasticIssueReturnServiceDbTests`/`PlasticReturnScrapServiceDbTests`/`PlasticInventoryServiceDbTests` 仍绿)。报告总数行。

```powershell
git add src/ErpApi/Features/Plastics/PlasticReceipt tests/ErpApi.Tests/PlasticReceiptSupplierFormDbTests.cs
git commit -m @'
feat(塑胶供应商单据保真): 塑胶入仓 后端出库/入仓/电脑+明细新列+往返测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: 前端抽通用供应商单据页 + 四路由

**Files:** Create `web/src/api/plasticSupplierDoc.ts`, `web/src/pages/plastics/PlasticSupplierDocLineTable.tsx`, `web/src/pages/plastics/PlasticSupplierDocFormPage.tsx`, `web/src/pages/plastics/PlasticSupplierDocConfigs.ts`; Modify `web/src/App.tsx`; Delete `PlasticWarehouseReturnFormPage.tsx`/`PlasticWarehouseReturnLineTable.tsx`/`api/plasticWarehouseReturn.ts`

- [ ] **Step 1: 通用 API** `web/src/api/plasticSupplierDoc.ts`:

```typescript
import { api } from "./client";
import type { Paged } from "./master";

export interface PSDLine {
  id?: number;
  生产单号?: string; 款号?: string; 物料编号?: string; 物料名称?: string; 规格?: string; 颜色?: string;
  塑胶货号?: string; 仓位号?: string; 单位?: string; 数量?: number; 单价?: number | null; 金额?: number | null; 备注?: string;
}
export interface PSDHeader {
  id: number; 单号?: string; 日期?: string; 供应商编号?: string; 供应商名称?: string; 仓库?: string;
  数量?: number | null; 金额?: number | null; 操作员?: string; 审核?: string; 审核人?: string; 备注?: string;
  出库单号?: string; 入仓单号?: string; 电脑单号?: string;
}
export interface PSDDetail { 单头?: PSDHeader; 明细: PSDLine[] }

const enc = encodeURIComponent;
export function plasticSupplierDocApi(resource: string) {
  const base = `/${resource}`;
  return {
    list: (page = 1, size = 10, keyword = "") => api.get<Paged<PSDHeader>>(base, { params: { page, size, keyword } }).then(r => r.data),
    get: (单号: string) => api.get<PSDDetail>(`${base}/${enc(单号)}`).then(r => r.data),
    create: (body: Record<string, unknown>) => api.post<{ 单号: string }>(base, body).then(r => r.data),
    remove: (单号: string) => api.delete(`${base}/${enc(单号)}`),
    approve: (单号: string) => api.post(`${base}/${enc(单号)}/approve`),
    unapprove: (单号: string) => api.post(`${base}/${enc(单号)}/unapprove`),
  };
}
```

- [ ] **Step 2: 明细网格改名** 用 git 移动并改类型来源:把 `web/src/pages/plastics/PlasticWarehouseReturnLineTable.tsx` 复制为 `web/src/pages/plastics/PlasticSupplierDocLineTable.tsx`,改动:
  - 组件名 `PlasticWarehouseReturnLineTable` → `PlasticSupplierDocLineTable`。
  - import 类型 `import type { PWRLine } from "../../api/plasticWarehouseReturn";` → `import type { PSDLine } from "../../api/plasticSupplierDoc";`。
  - 文件内所有 `PWRLine` → `PSDLine`(props 类型、render 参数、lineAmt 参数)。
  - 其余内容(列定义/选择器/逻辑)不变。

- [ ] **Step 3: 通用页参数化** 复制 `PlasticWarehouseReturnFormPage.tsx` 为 `web/src/pages/plastics/PlasticSupplierDocFormPage.tsx`,改动:
  - import 改:`import { plasticSupplierDocApi, type PSDHeader, type PSDLine } from "../../api/plasticSupplierDoc";` 与 `import PlasticSupplierDocLineTable from "./PlasticSupplierDocLineTable";`(删 PlasticWarehouseReturn* import)。
  - 组件签名:`export default function PlasticSupplierDocFormPage({ cfg }: { cfg: { resource: string; menu: string; title: string } }) {`。
  - 删 `const MENU = "塑胶退仓单";`,改用 `const MENU = cfg.menu;`(放函数体首行)。
  - 新增本地 api 实例:`const docApi = plasticSupplierDocApi(cfg.resource);`(放 perms 行后)。把文件内所有 `plasticWarehouseReturnApi.` 替换为 `docApi.`。
  - 类型 `PWRHeader`/`PWRLine` → `PSDHeader`/`PSDLine`;`<PlasticWarehouseReturnLineTable ...>` → `<PlasticSupplierDocLineTable ...>`。
  - 标题:`title={`${cfg.title}单${readOnly ? ... }`}`(把硬编码「塑胶退仓单」换成 `${cfg.title}单`;列表列标题「退仓单号」改为「单号」,删除提示「删除该退仓单?」改为「删除该单据?」)。
  - 入仓带出 `bringFromReceipt` 内 `plasticDocApi("plastic-receipts")` 保持不变。

- [ ] **Step 4: 四单 config** `web/src/pages/plastics/PlasticSupplierDocConfigs.ts`:

```typescript
export interface PlasticSupplierDocCfg { resource: string; menu: string; title: string }
export const PLASTIC_SUPPLIER_DOC_CONFIGS: Record<string, PlasticSupplierDocCfg> = {
  "plastic-warehouse-returns": { resource: "plastic-warehouse-returns", menu: "塑胶退仓单", title: "塑胶退仓" },
  "plastic-returns":           { resource: "plastic-returns",           menu: "塑胶退料单", title: "塑胶退料" },
  "plastic-scraps":            { resource: "plastic-scraps",            menu: "塑胶报废单", title: "塑胶报废" },
  "plastic-receipts":          { resource: "plastic-receipts",          menu: "塑胶入仓单", title: "塑胶入仓" },
};
```

- [ ] **Step 5: 换路由** 在 `web/src/App.tsx`:
  - 加 import:`import PlasticSupplierDocFormPage from "./pages/plastics/PlasticSupplierDocFormPage";` 与 `import { PLASTIC_SUPPLIER_DOC_CONFIGS } from "./pages/plastics/PlasticSupplierDocConfigs";`
  - 删 `import PlasticWarehouseReturnFormPage ...`。
  - 把以下四条路由的 element 改为通用页:
    - `plastic-receipts` → `<PlasticSupplierDocFormPage cfg={PLASTIC_SUPPLIER_DOC_CONFIGS["plastic-receipts"]} />`
    - `plastic-warehouse-returns` → `...["plastic-warehouse-returns"]`
    - `plastic-returns` → `...["plastic-returns"]`
    - `plastic-scraps` → `...["plastic-scraps"]`
  - (`plastic-issues` 领料保持 `PlasticIssueFormPage` 不动;`plastic-inventory`/`plastic-stocktakes` 不动。)
  - 若 `PLASTIC_DOC_CONFIGS` 在这四条路由后不再被任何路由引用,删除其 import 与 `PlasticDocPage` import(用 grep 确认 `PLASTIC_DOC_CONFIGS`/`PlasticDocPage` 无其它使用后再删;若仍被引用则保留)。

- [ ] **Step 6: 删旧文件**

```powershell
git rm web/src/pages/plastics/PlasticWarehouseReturnFormPage.tsx web/src/pages/plastics/PlasticWarehouseReturnLineTable.tsx web/src/api/plasticWarehouseReturn.ts
```

- [ ] **Step 7: 测试 + 构建**

Run: `npm --prefix web run test` → 54 不减。
Run: `npm --prefix web run build` → tsc 干净(无悬空 import / 未用变量)+ 构建成功。

- [ ] **Step 8: Commit**

```powershell
git add web/src
git commit -m @'
feat(塑胶供应商单据保真): 抽通用供应商单据页(四单共用)+四路由,删退仓专用件

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 6: 冒烟(四单)+ 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟**

重启后端(新代码,`-c Release`,`ASPNETCORE_URLS=http://127.0.0.1:5000`,env ERP_DB/ERP_JWT_KEY),待就绪。Node axios(`proxy:false`):admin 登录,对四单各建一张带新字段(供应商/出库单号/入仓单号/电脑单号 + 明细 生产单号/塑胶货号/物料 SMOKE4/数量/单价)→ approve → GET 读回新字段一致 → 验库存方向:先入仓 30 审核(库存+30),退仓 5 审核(−5→25),退料 4 审核(+4→29),报废 3 审核(−3→26)。GET `/api/plastic-inventory?keyword=SMOKE4` 最终=26。清理(反审核+删四单)。

Expected: 四单新字段往返一致;库存 30→25→29→26(入仓+/退仓−/退料+/报废−)。

- [ ] **Step 2: opus 全分支终审**

派 opus 对 `feat-plastic-supplier-docs-form` 全分支终审:三单四处列名对齐(DB/DTO/INSERT列+参/SELECT)、退料/报废 旧 部门/人 列保留未破坏、库存四方向未变(LedgerUnion 未动)、单号前缀(STL/SBF/SR)未变、成本脱敏保留、前端通用页四单参数化正确(MENU/resource/title 随 cfg)、入仓带出复用正常、四路由替换且 plastic-issues 领料未被波及、旧三文件已删无悬空 import。目标 READY TO MERGE。

- [ ] **Step 3: 合并 master**

```powershell
git checkout master
git merge --no-ff feat-plastic-supplier-docs-form -m @'
Merge branch 'feat-plastic-supplier-docs-form' into master

塑胶退料/报废/入仓保真重做+退仓抽通用供应商单据页(四单共用)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
git branch -d feat-plastic-supplier-docs-form
```

- [ ] **Step 4: worklog + MEMORY** Create `docs/worklogs/2026-06-26-plastic-supplier-docs-form.md`;更新塑胶保真记忆(四单全保真·通用件 PlasticSupplierDocFormPage)。Commit。

```powershell
git add docs/worklogs/2026-06-26-plastic-supplier-docs-form.md
git commit -m @'
docs(worklog): 塑胶退料/报废/入仓保真+退仓抽通用件 2026-06-26

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## 自审清单(已核对)

- **Spec 覆盖**:DB(三头+三明细)=Task1;退料/报废/入仓 后端各 DTO+Service+往返测试=Task2/3/4;前端通用件(api 工厂/网格/页/config/四路由/删旧)=Task5;冒烟四单+终审+合并+worklog=Task6。领料单不动。无遗漏。
- **类型一致**:`PSDHeader`/`PSDLine` 通用前端字段 = 三后端 DTO 并集(供应商+出库/入仓/电脑+生产单号/款号/塑胶货号);通用页用 `plasticSupplierDocApi(cfg.resource)`。
- **无占位**:DB/后端给全码;前端通用化给精确改名/参数化指令(基于现有退仓文件,确定性高)。
- **列名一致**:三单各自 DB ADD / DTO / INSERT 列+@参 / SELECT 四处对齐(退料/报废 保留旧 部门/人 列于 INSERT+SELECT+DTO,新增供应商+出库/入仓/电脑;入仓只加 出库/入仓/电脑)。
- **库存/前缀/脱敏不变**:LedgerUnion 四支未动;STL/SBF/SR 不变;Controller 脱敏不动;金额=Σ数量×单价 不变。
- **回归**:旧测试(`PlasticIssueReturnServiceDbTests` 退料部分、`PlasticReturnScrapServiceDbTests`)用旧 部门/人 字段创建仍可——DTO 保留旧字段、INSERT 保留旧列。
- **删旧无悬空**:删 3 个退仓专用文件后,App.tsx 不再 import 它们;`PlasticDocPage`/`PLASTIC_DOC_CONFIGS` 仅在确认无引用后删。
