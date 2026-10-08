# P5b 成品仓储补全（调拨 + 退货 + 退仓）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐成品仓储剩余三个单据族——成品调拨（源仓→目标仓，库存双腿）、成品退货（客户退回入仓 +）、成品退仓（退供应商出仓 −）——都汇入已有的 `FinishedGoodsAsync` 库存。

**Architecture:** 三个单据都是两层（单头 + 明细，明细 `单号` 主从 FK → 单头），完全复用 P5a 的 Dapper 事务服务 + 控制器 + `SyncLineApprovalAsync`（审核引擎②只翻单头审核位，库存按明细审核过滤，故审核/反审核后同步明细审核位）模式。调拨明细带 `源仓库`/`目标仓库`，库存引擎 `FinishedGoodsAsync` 加两段 UNION（目标仓库 +数量 / 源仓库 −数量）；退货(+)/退仓(−)明细本就在 UNION 中。成本保密、前缀单号、审核留痕列（07 脚本）均沿用 P5a 模式。前端在「成品仓储」菜单组追加三页。

**Tech Stack:** .NET 8 ASP.NET Core, Dapper, SQL Server LocalDB (erp/erp_test, Chinese_PRC_CI_AS), xUnit + WebApplicationFactory + Xunit.SkippableFact, React 18 + TS + Vite + Ant Design v6 + Vitest.

---

## 前置约定（所有任务通用）

- 工作目录 `D:\WebpageERP`，当前分支 `p5b-finished-transfer`（已建）。`dotnet` 不在 PATH 时刷新：`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 集成测试需环境变量：`$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")`、`$env:ERP_JWT_KEY = [Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")`；开发库 `$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")`。
- 跑测试：仓库根 `dotnet test`；单类 `dotnet test --filter "FullyQualifiedName~FinishedTransferServiceDbTests"`。前端 `npm --prefix web run test`、`npm --prefix web run build`。
- 若构建因二进制被占用失败：`Get-Process -Name ErpApi -ErrorAction SilentlyContinue | Stop-Process -Force`。
- 提交末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。LF→CRLF 警告正常。`tmp/dbquery`：`dotnet run --project tmp/dbquery -- "<连接串>" "<SQL>"` 打印 `列=值`。
- **P5a 已交付的模板（必读、照搬）**：
  - `src/ErpApi/Features/Warehouse/Finished/FinishedReceiptService.cs`（两层 Dapper 事务服务范本：CreateAsync 汇总+插单头插明细、ListAsync/GetAsync、DeleteAsync 用 `WITH (UPDLOCK, HOLDLOCK)`；`PagedResult<T>` 来自 `ErpApi.Features.MasterData`）
  - `src/ErpApi/Features/Warehouse/Finished/FinishedReceiptController.cs` 与 `FinishedIssueController.cs`（REST + 审核 + 成本保密 + 审计 + **`SyncLineApprovalAsync`** 同步明细审核位范本）
  - `src/ErpApi/Features/Warehouse/Finished/FinishedDtos.cs`（本期在此**追加** 调拨/退货/退仓 DTO）
  - `src/ErpApi/Engines/Inventory/InventorySummaryService.cs`（`FinishedGoodsAsync` 的 `Sql` 常量，本期加两段调拨 UNION）
  - `tests/ErpApi.Tests/P5TestData.cs`（种子；本期加 目标仓库 常量 + cleanup 覆盖三新表）、`FinishedReceiptServiceDbTests.cs`、`InventorySummaryDbTests.cs`、`P5ApiIntegrationTests.cs`、`PostingEngineDbTests.cs`
  - 前端：`web/src/api/finished.ts`（追加三 client）、`web/src/pages/warehouse/FinishedReceiptPage.tsx`+`FinishedReceiptCreateDrawer.tsx`（前端范本）、`web/src/utils/finishedLines.ts`（复用 sumQty/validLines）

### 本切片涉及表的真实结构（以 `db/01_rebuild_schema.sql` 为准，仅列本期读写列）

- `成品调拨单`(单头)：ID int, **单号 nvarchar(20) UNIQUE**, 日期, 客户编号, 客户名称, 操作员, 审核 nvarchar, 备注。**无 审核人/审核日期（Task 1 补）；无 仓库/数量 列**（源/目标仓库与数量都在明细）。
- `成品调拨明细单`(明细)：ID int, **单号 nvarchar(20)**, 出仓单号, 日期, 客户编号, 客户名称, **源仓库, 目标仓库**, 生产单号, 款号, 款式, 床号, 色号, 颜色, 尺码, 数量 decimal, 成本单价, 成本金额, 单价 decimal, 金额 decimal, 审核, 备注。FK：**单号→成品调拨单(主从, FK_97)**、款号→款号总表、生产单号→生产制单。
- `成品退货单`(单头)：ID int, **单号 nvarchar(20) UNIQUE**, 日期, 客户编号, 客户名称, 仓库, 操作员, 审核, 备注。**无 审核人/审核日期（Task 1 补）**。
- `成品退货明细单`(明细)：ID int, **单号 nvarchar(20)**, 出仓单号, 日期, 客户编号, 客户名称, 仓库, 生产单号, 款号, 款式, 床号, 色号, 颜色, 尺码, 数量 decimal, 成本单价, 成本金额, 单价 decimal, 金额 decimal, 审核, 备注。FK：**单号→成品退货单(主从, FK_113)**、款号→款号总表、生产单号→生产制单。
- `成品退仓单`(单头)：ID int, **单号 nvarchar(20) UNIQUE**, 日期, 供应商编号, 供应商名称, 仓库, 操作员, 审核, 备注。**无 审核人/审核日期（Task 1 补）**。
- `成品退仓明细单`(明细)：ID int, **单号 nvarchar(20)**, 入仓单号, 日期, 供应商编号, 供应商名称, 仓库, 生产单号, 款号, 款式, 床号, 色号, 颜色, 尺码, 数量 decimal, 单价 decimal, 金额 decimal, 审核, 备注。FK：**单号→成品退仓单(主从, FK_106)**、款号→款号总表、生产单号→生产制单。
- `FinishedGoodsAsync` 现 UNION：入仓(+)/退货(+)/出仓(−)/退仓(−)/盘点盈亏(±)，本期**加 调拨 目标仓库(+)/源仓库(−)**。
- PostableDocuments 白名单**已含** `成品调拨单`/`成品退货单`/`成品退仓单`（单号列="单号"）——无需改白名单。

**关键设计约束**：
1. 单号前缀：调拨 `CD`、退货 `TH`、退仓 `TC`。单头↔明细按"单号"串联且有主从 FK，插入 单头→明细、删除 明细→单头（仅未审核，删除前 `WITH (UPDLOCK, HOLDLOCK)` 锁单头）。
2. 调拨：单头无 仓库/数量；CreateDto 在**头层**带 源仓库/目标仓库（一张调拨单一组源→目标），服务把它们写入每条明细。库存：审核后 源仓库 −数量、目标仓库 +数量。
3. 单价手工默认 0，金额=数量×单价（服务端算）；不做加权成本。
4. **审核同步明细审核位**：三个控制器 Approve/Unapprove 在 `posting.ApproveAsync/UnapproveAsync` 之后，补 `UPDATE [对应明细单] SET [审核]='1'/'0' WHERE [单号]=@单号`（因 `FinishedGoodsAsync` 按明细审核过滤）。
5. 成本保密：明细 单价/金额/成本单价/成本金额 无"单价"权限置 null。
6. 路由 ASCII（`api/finished-transfers`、`api/finished-sales-returns`、`api/finished-vendor-returns`），菜单名/表名中文。

---

## 文件结构

```
src/ErpApi/
├─ Engines/Inventory/InventorySummaryService.cs   改:FinishedGoodsAsync 加调拨双腿 UNION
├─ Features/Warehouse/Finished/
│  ├─ FinishedDtos.cs                              改:追加 调拨/退货/退仓 DTO
│  ├─ FinishedTransferService.cs / FinishedTransferController.cs        成品调拨
│  ├─ FinishedSalesReturnService.cs / FinishedSalesReturnController.cs  成品退货
│  └─ FinishedVendorReturnService.cs / FinishedVendorReturnController.cs 成品退仓
└─ Program.cs                                      改:注册三服务
db/07_p5b_additions.sql / db/run-db.ps1 / db/seed_p5b_perms.sql
web/src/api/finished.ts                            改:追加三 client
web/src/pages/warehouse/{FinishedTransferPage,FinishedTransferCreateDrawer,FinishedSalesReturnPage,FinishedSalesReturnCreateDrawer,FinishedVendorReturnPage,FinishedVendorReturnCreateDrawer}.tsx
web/src/pages/MainLayout.tsx / App.tsx             改:成品仓储组加三项+路由
tests/ErpApi.Tests/{FinishedTransferServiceDbTests,FinishedSalesReturnServiceDbTests,FinishedVendorReturnServiceDbTests}.cs
tests/ErpApi.Tests/{P5TestData,InventorySummaryDbTests,P5ApiIntegrationTests,PostingEngineDbTests}.cs  改:追加
```

---

## Task 1: DB 07 脚本（审核留痕列）+ 审核引擎 DB 测试

**Files:** Create `db/07_p5b_additions.sql`; Modify `db/run-db.ps1`, `tests/ErpApi.Tests/PostingEngineDbTests.cs`

- [ ] **Step 1: 写 07 脚本** — Create `db/07_p5b_additions.sql`:

```sql
-- P5b 成品仓储：成品调拨单/退货单/退仓单 缺 审核人/审核日期 留痕列，补齐(供审核过账引擎②)。
-- 三张单的 单号 列已是 nvarchar(20)，无需扩宽。幂等。
SET XACT_ABORT ON;

IF COL_LENGTH(N'成品调拨单', N'审核人') IS NULL
    ALTER TABLE [成品调拨单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'成品调拨单', N'审核日期') IS NULL
    ALTER TABLE [成品调拨单] ADD [审核日期] datetime2(0) NULL;
IF COL_LENGTH(N'成品退货单', N'审核人') IS NULL
    ALTER TABLE [成品退货单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'成品退货单', N'审核日期') IS NULL
    ALTER TABLE [成品退货单] ADD [审核日期] datetime2(0) NULL;
IF COL_LENGTH(N'成品退仓单', N'审核人') IS NULL
    ALTER TABLE [成品退仓单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'成品退仓单', N'审核日期') IS NULL
    ALTER TABLE [成品退仓单] ADD [审核日期] datetime2(0) NULL;
```

- [ ] **Step 2: run-db.ps1 加载 07** — 读 `db/run-db.ps1`，在 06 那行之后按其结构追加一行 `(Join-Path $dir "07_p5b_additions.sql")`（与 06 同为非 lenient，保持尾部反引号续行），01–06 不变。

- [ ] **Step 3: 在开发库和测试库执行 07**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
dotnet run --project tools/DbDeploy -- "$env:ERP_DB" db/07_p5b_additions.sql
dotnet run --project tools/DbDeploy -- "$env:ERP_TEST_DB" db/07_p5b_additions.sql
```
验收：`dotnet run --project tmp/dbquery -- "$env:ERP_TEST_DB" "SELECT COL_LENGTH('成品调拨单','审核人') a, COL_LENGTH('成品退货单','审核人') b, COL_LENGTH('成品退仓单','审核日期') c"`（均非 NULL）。

- [ ] **Step 4: 写审核 DB 集成测试** — 在 `tests/ErpApi.Tests/PostingEngineDbTests.cs` 类内追加（成品调拨单 无阻碍 FK，直接种单头）：

```csharp
    [SkippableFact]
    public async Task Approve_成品调拨单_uses_单号_column()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [成品调拨单] WHERE [单号]='P5BCDPOST1'");
        c.Execute("INSERT INTO [成品调拨单]([单号],[审核]) VALUES(N'P5BCDPOST1','0')");
        var engine = new PostingEngine(Factory(), new AuditLogger());
        Assert.True(await engine.ApproveAsync("成品调拨单", "P5BCDPOST1", "tester"));
        Assert.Equal("1", c.ExecuteScalar<string>("SELECT [审核] FROM [成品调拨单] WHERE [单号]='P5BCDPOST1'"));
        Assert.Equal("tester", c.ExecuteScalar<string>("SELECT [审核人] FROM [成品调拨单] WHERE [单号]='P5BCDPOST1'"));
        Assert.True(await engine.UnapproveAsync("成品调拨单", "P5BCDPOST1", "tester"));
        c.Execute("DELETE FROM [成品调拨单] WHERE [单号]='P5BCDPOST1'");
    }
```

- [ ] **Step 5: 跑 DB 测试确认通过** — `dotnet test --filter "FullyQualifiedName~PostingEngineDbTests"` → PASS。

- [ ] **Step 6: 全量回归 + 提交** — `dotnet test` → 全 PASS。

```powershell
git add db/07_p5b_additions.sql db/run-db.ps1 tests/ErpApi.Tests/PostingEngineDbTests.cs
git commit -m @'
feat(P5): 07脚本(成品调拨/退货/退仓单补审核留痕列)+审核引擎调拨用例

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 库存引擎扩展（调拨双腿）+ P5 种子扩展

**Files:** Modify `src/ErpApi/Engines/Inventory/InventorySummaryService.cs`, `tests/ErpApi.Tests/P5TestData.cs`, `tests/ErpApi.Tests/InventorySummaryDbTests.cs`

- [ ] **Step 1: P5TestData 加 目标仓库常量 + cleanup 覆盖三新表** — 在 `tests/ErpApi.Tests/P5TestData.cs`：
  - 在常量区加：`public const string 仓库2 = "P5半成品仓";`
  - 在 `Cleanup` 的明细删除数组里加 三新明细表、单头数组里加三新单头（删法：明细按 生产单号=P5SC01，单头按……调拨单无仓库列，按 单号 LIKE 不可靠——改为：明细按生产单号删，单头删除靠各测试 finally 精确删；此处 cleanup 仅补明细兜底）。具体：把 Cleanup 改为：

```csharp
    public static void Cleanup(SqlConnection c)
    {
        foreach (var d in new[] { "成品盘点明细单", "成品出仓明细单", "成品入仓明细单",
                                  "成品调拨明细单", "成品退货明细单", "成品退仓明细单" })
            c.Execute($"DELETE FROM [{d}] WHERE [生产单号]=N'P5SC01'");
        foreach (var h in new[] { "成品盘点单", "成品出仓单", "成品入仓单", "成品退货单", "成品退仓单" })
            c.Execute($"DELETE FROM [{h}] WHERE [仓库] IN (N'P5成品仓', N'P5半成品仓')");
        // 成品调拨单 无 仓库 列，按各测试 finally 精确删；兜底删 7 天内无主明细的孤儿(略)
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'P5SC01'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'P5K01'");
        c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'P5C01'");
    }
```
注：调拨单头删除由各调拨测试的 finally 精确按单号删（明细已删后单头无 FK 阻碍）。`Seed` 不变。

- [ ] **Step 2: 写失败的库存扩展测试** — 在 `tests/ErpApi.Tests/InventorySummaryDbTests.cs` 类内追加：

```csharp
    [SkippableFact]
    public async Task FinishedGoods_transfer_moves_qty_between_warehouses()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        try
        {
            // A仓(P5成品仓)入仓100(审核1)
            c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                        VALUES(N'P5BRK',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',100,'1')");
            // 调拨30 A→B(P5半成品仓)(审核1)
            c.Execute(@"INSERT INTO [成品调拨明细单]([单号],[源仓库],[目标仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                        VALUES(N'P5BCD',N'P5成品仓',N'P5半成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',30,'1')");
            var svc = new InventorySummaryService(Factory());
            Assert.Equal(70m, (await svc.FinishedGoodsAsync("P5成品仓"))[0].库存);     // 100-30
            Assert.Equal(30m, (await svc.FinishedGoodsAsync("P5半成品仓"))[0].库存);   // +30
        }
        finally
        {
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]='P5BRK'");
            c.Execute("DELETE FROM [成品调拨明细单] WHERE [单号]='P5BCD'");
            P5TestData.Cleanup(c);
        }
    }
```

- [ ] **Step 3: 跑测试确认失败** — `dotnet test --filter "FullyQualifiedName~InventorySummaryDbTests.FinishedGoods_transfer"` → FAIL（半成品仓库存=0，调拨未计入）。

- [ ] **Step 4: 扩展 FinishedGoodsAsync** — 在 `src/ErpApi/Engines/Inventory/InventorySummaryService.cs` 的 `Sql` 常量里，`成品盘点明细单` 那段 UNION 之后、`) t` 之前追加两段：

```sql
    UNION ALL
    SELECT 款号,款式,色号,颜色,尺码, 数量        AS 库存 FROM [成品调拨明细单] WHERE 目标仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL
    SELECT 款号,款式,色号,颜色,尺码, 数量*-1     AS 库存 FROM [成品调拨明细单] WHERE 源仓库=@仓 AND ISNULL(审核,'0')='1'
```
并更新第 8 行口径注释，追加 `、调拨(调入+/调出-)`。

- [ ] **Step 5: 跑测试确认通过** — `dotnet test --filter "FullyQualifiedName~InventorySummaryDbTests"` → PASS（含原盘点用例 + 新调拨用例）。

- [ ] **Step 6: 全量回归 + 提交** — `dotnet test` → 全 PASS。

```powershell
git add src/ErpApi/Engines/Inventory/InventorySummaryService.cs tests/ErpApi.Tests/P5TestData.cs tests/ErpApi.Tests/InventorySummaryDbTests.cs
git commit -m @'
feat(P5): 库存引擎加成品调拨双腿(目标仓+/源仓-)UNION项+P5种子扩展

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 成品调拨 Service + DTO

**Files:** Modify `src/ErpApi/Features/Warehouse/Finished/FinishedDtos.cs`; Create `src/ErpApi/Features/Warehouse/Finished/FinishedTransferService.cs`; Modify `src/ErpApi/Program.cs`; Test `tests/ErpApi.Tests/FinishedTransferServiceDbTests.cs`

- [ ] **Step 1: 追加调拨/退货/退仓 DTO** — 在 `src/ErpApi/Features/Warehouse/Finished/FinishedDtos.cs` 末尾追加（本任务用调拨，退货/退仓 Task 5/6 用，一并写好）:

```csharp
// ===== 成品调拨 =====
public sealed class FinishedTransferLineDto
{ public string? 色号 { get; set; } public string? 颜色 { get; set; } public string? 尺码 { get; set; } public decimal 数量 { get; set; } public decimal? 单价 { get; set; } }
public sealed class FinishedTransferCreateDto
{
    public string 源仓库 { get; set; } = "";
    public string 目标仓库 { get; set; } = "";
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 出仓单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 床号 { get; set; }
    public string? 备注 { get; set; }
    public List<FinishedTransferLineDto> 明细 { get; set; } = [];
}
public sealed class FinishedTransferHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 客户名称 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class FinishedTransferLineRowDto
{
    public long ID { get; set; }
    public string? 源仓库 { get; set; }
    public string? 目标仓库 { get; set; }
    public string? 款号 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
public sealed class FinishedTransferDetailDto
{ public FinishedTransferHeaderDto? 单头 { get; set; } public List<FinishedTransferLineRowDto> 明细 { get; set; } = []; }

// ===== 成品退货（客户退回，入仓库 +）=====
public sealed class FinishedSalesReturnLineDto
{ public string? 色号 { get; set; } public string? 颜色 { get; set; } public string? 尺码 { get; set; } public decimal 数量 { get; set; } public decimal? 单价 { get; set; } }
public sealed class FinishedSalesReturnCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 出仓单号 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 床号 { get; set; }
    public string? 备注 { get; set; }
    public List<FinishedSalesReturnLineDto> 明细 { get; set; } = [];
}
public sealed class FinishedSalesReturnHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class FinishedSalesReturnLineRowDto
{
    public long ID { get; set; }
    public string? 款号 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
public sealed class FinishedSalesReturnDetailDto
{ public FinishedSalesReturnHeaderDto? 单头 { get; set; } public List<FinishedSalesReturnLineRowDto> 明细 { get; set; } = []; }

// ===== 成品退仓（退供应商，出仓库 −）=====
public sealed class FinishedVendorReturnLineDto
{ public string? 色号 { get; set; } public string? 颜色 { get; set; } public string? 尺码 { get; set; } public decimal 数量 { get; set; } public decimal? 单价 { get; set; } }
public sealed class FinishedVendorReturnCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 入仓单号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 床号 { get; set; }
    public string? 备注 { get; set; }
    public List<FinishedVendorReturnLineDto> 明细 { get; set; } = [];
}
public sealed class FinishedVendorReturnHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class FinishedVendorReturnLineRowDto
{
    public long ID { get; set; }
    public string? 款号 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
public sealed class FinishedVendorReturnDetailDto
{ public FinishedVendorReturnHeaderDto? 单头 { get; set; } public List<FinishedVendorReturnLineRowDto> 明细 { get; set; } = []; }
```

- [ ] **Step 2: 写失败的 Service 测试** — Create `tests/ErpApi.Tests/FinishedTransferServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Warehouse.Finished;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class FinishedTransferServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private FinishedTransferService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static FinishedTransferCreateDto Dto() => new()
    {
        源仓库 = P5TestData.仓库, 目标仓库 = P5TestData.仓库2,
        生产单号 = P5TestData.生产单号, 款号 = P5TestData.款号, 款式 = "P5测试款式",
        明细 = [ new FinishedTransferLineDto { 色号 = "01", 颜色 = "黑色", 尺码 = "M", 数量 = 30, 单价 = 10 } ]
    };

    [SkippableFact]
    public async Task Create_writes_源目标仓库_to_lines_and_moves_inventory()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        // A仓入仓100(审核1)
        c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                    VALUES(N'P5BTRK',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',100,'1')");
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("CD", 单号);
            Assert.Equal("P5成品仓", c.ExecuteScalar<string>("SELECT [源仓库] FROM [成品调拨明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal("P5半成品仓", c.ExecuteScalar<string>("SELECT [目标仓库] FROM [成品调拨明细单] WHERE [单号]=@n", new { n = 单号 }));
            // 审核明细位后看库存(服务不翻审核位,这里直接置1模拟控制器同步)
            c.Execute("UPDATE [成品调拨明细单] SET [审核]='1' WHERE [单号]=@n", new { n = 单号 });
            var svc = new InventorySummaryService(Factory());
            Assert.Equal(70m, (await svc.FinishedGoodsAsync("P5成品仓"))[0].库存);
            Assert.Equal(30m, (await svc.FinishedGoodsAsync("P5半成品仓"))[0].库存);
        }
        finally
        {
            c.Execute("DELETE FROM [成品调拨明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [成品调拨单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]='P5BTRK'");
            P5TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task List_Get_Delete_lifecycle()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.Equal(1, (await Svc().ListAsync(1, 20, 单号)).Total);
            Assert.Equal(1, (await Svc().GetAsync(单号))!.明细.Count);
            c.Execute("UPDATE [成品调拨单] SET [审核]='1' WHERE [单号]=@n", new { n = 单号 });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
            c.Execute("UPDATE [成品调拨单] SET [审核]='0' WHERE [单号]=@n", new { n = 单号 });
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.False(await Svc().DeleteAsync("CD不存在"));
        }
        finally
        {
            c.Execute("DELETE FROM [成品调拨明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [成品调拨单] WHERE [单号]=@n", new { n = 单号 });
            P5TestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 3: 跑测试确认失败** — `dotnet test --filter "FullyQualifiedName~FinishedTransferServiceDbTests"` → FAIL（FinishedTransferService 不存在）。

- [ ] **Step 4: 实现 FinishedTransferService** — Create `src/ErpApi/Features/Warehouse/Finished/FinishedTransferService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
namespace ErpApi.Features.Warehouse.Finished;

// 成品调拨（跨仓转移）。两层：成品调拨单 + 成品调拨明细单(单号 主从 FK)。
// 单头无 仓库/数量；源/目标仓库在头层 DTO，写入每条明细。审核后 源仓库−数量、目标仓库+数量(FinishedGoodsAsync 双腿)。
public sealed class FinishedTransferService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "成品调拨单";
    public const string Prefix = "CD";

    public async Task<string> CreateAsync(FinishedTransferCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("成品调拨至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.源仓库) || string.IsNullOrWhiteSpace(dto.目标仓库)) throw new ArgumentException("源仓库/目标仓库必填");
        if (dto.源仓库 == dto.目标仓库) throw new ArgumentException("源仓库与目标仓库不能相同");
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [成品调拨单]([单号],[日期],[客户编号],[客户名称],[操作员],[审核],[备注])
VALUES(@单号,@日期,@客户编号,@客户名称,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.客户编号, dto.客户名称, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [成品调拨明细单]([单号],[出仓单号],[日期],[客户编号],[客户名称],[源仓库],[目标仓库],[生产单号],[款号],[款式],[床号],[色号],[颜色],[尺码],[数量],[单价],[金额],[审核])
VALUES(@单号,@出仓单号,@日期,@客户编号,@客户名称,@源仓库,@目标仓库,@生产单号,@款号,@款式,@床号,@色号,@颜色,@尺码,@数量,@单价,@金额,'0')",
                new
                {
                    单号, dto.出仓单号, 日期 = now, dto.客户编号, dto.客户名称, dto.源仓库, dto.目标仓库,
                    dto.生产单号, dto.款号, dto.款式, dto.床号, l.色号, l.颜色, l.尺码,
                    l.数量, 单价 = l.单价 ?? 0m, 金额 = l.数量 * (l.单价 ?? 0m)
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<FinishedTransferHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [成品调拨单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [客户名称] LIKE @kw;
SELECT [ID],[单号],[客户名称],[日期],[操作员],[审核],[审核人],[备注]
FROM [成品调拨单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [客户名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<FinishedTransferHeaderDto>()).AsList();
        return new PagedResult<FinishedTransferHeaderDto>(items, total);
    }

    public async Task<FinishedTransferDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[客户名称],[日期],[操作员],[审核],[审核人],[备注] FROM [成品调拨单] WHERE [单号]=@单号;
SELECT [ID],[源仓库],[目标仓库],[款号],[色号],[颜色],[尺码],[数量],[单价],[金额] FROM [成品调拨明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<FinishedTransferHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<FinishedTransferLineRowDto>()).AsList();
        return new FinishedTransferDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [成品调拨单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的成品调拨单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [成品调拨明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [成品调拨单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 5: Program.cs 注册** — 在 P5a 的 Finished 服务注册附近追加：

```csharp
builder.Services.AddScoped<ErpApi.Features.Warehouse.Finished.FinishedTransferService>();
```

- [ ] **Step 6: 跑测试确认通过** — `dotnet test --filter "FullyQualifiedName~FinishedTransferServiceDbTests"` → PASS 2。

- [ ] **Step 7: 全量回归 + 提交** — `dotnet test` → 全 PASS。

```powershell
git add src/ErpApi/Features/Warehouse/Finished/FinishedDtos.cs src/ErpApi/Features/Warehouse/Finished/FinishedTransferService.cs src/ErpApi/Program.cs tests/ErpApi.Tests/FinishedTransferServiceDbTests.cs
git commit -m @'
feat(P5): 成品调拨服务(前缀CD,源/目标仓库写入明细,双腿库存)+调拨/退货/退仓DTO

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: 成品调拨 Controller（REST + 审核同步明细 + 成本保密）

**Files:** Create `src/ErpApi/Features/Warehouse/Finished/FinishedTransferController.cs`; Modify `tests/ErpApi.Tests/P5ApiIntegrationTests.cs`

- [ ] **Step 1: 追加调拨 API 测试** — 在 `tests/ErpApi.Tests/P5ApiIntegrationTests.cs` 类内追加（`Factory/Token/SeedPerms/Client` helper 已存在）：

```csharp
    [SkippableFact]
    public async Task Transfer_lifecycle_moves_inventory_between_warehouses()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5TestData.Seed(c);
            // A仓入仓100(审核1)直插，模拟既有库存
            c.Execute(@"INSERT INTO [成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5BAPIRK',N'P5成品仓','1')");
            c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                        VALUES(N'P5BAPIRK',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',100,'1')"); }
        SeedPerms("p5btr", "成品调拨", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p5btr", "成品库存", open: true);
        var client = Client(app, "p5btr");
        string? cd = null;
        async Task<decimal> Inv(string wh) {
            var inv = await client.GetFromJsonAsync<JsonElement>($"/api/finished-inventory?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(wh)}");
            decimal s = 0; foreach (var r in inv.EnumerateArray()) s += r.GetProperty("库存").GetDecimal(); return s;
        }
        try
        {
            Assert.Equal(100m, await Inv("P5成品仓"));
            var cr = await client.PostAsJsonAsync("/api/finished-transfers", new {
                源仓库 = "P5成品仓", 目标仓库 = "P5半成品仓",
                生产单号 = P5TestData.生产单号, 款号 = P5TestData.款号, 款式 = "P5测试款式",
                明细 = new[] { new { 色号 = "01", 颜色 = "黑色", 尺码 = "M", 数量 = 30, 单价 = 10 } } });
            Assert.Equal(HttpStatusCode.Created, cr.StatusCode);
            cd = (await cr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/finished-transfers/{cd}/approve", null)).StatusCode);
            Assert.Equal(70m, await Inv("P5成品仓"));      // 100-30
            Assert.Equal(30m, await Inv("P5半成品仓"));    // +30
            Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/finished-transfers/{cd}")).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/finished-transfers/{cd}/unapprove", null)).StatusCode);
            Assert.Equal(100m, await Inv("P5成品仓"));      // 反审核后回到100
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (cd != null) { c.Execute("DELETE FROM [成品调拨明细单] WHERE [单号]=@n", new { n = cd }); c.Execute("DELETE FROM [成品调拨单] WHERE [单号]=@n", new { n = cd }); }
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]='P5BAPIRK'");
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]='P5BAPIRK'");
            P5TestData.Cleanup(c);
        }
    }
```

- [ ] **Step 2: 跑测试确认失败** — `dotnet test --filter "FullyQualifiedName~P5ApiIntegrationTests.Transfer_lifecycle"` → FAIL（404）。

- [ ] **Step 3: 实现 FinishedTransferController** — Create `src/ErpApi/Features/Warehouse/Finished/FinishedTransferController.cs`（仿 `FinishedReceiptController`，含 `SyncLineApprovalAsync` 指向 `成品调拨明细单`）:

```csharp
using System.Security.Claims;
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Warehouse.Finished;

[ApiController]
[Authorize]
[Route("api/finished-transfers")]
public sealed class FinishedTransferController(
    FinishedTransferService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "成品调拨";
    private const string Table = "成品调拨单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create(); await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }
    private async Task SyncLineApprovalAsync(string 单号, string 审核)
    {
        using var c = factory.Create(); await c.OpenAsync();
        await c.ExecuteAsync("UPDATE [成品调拨明细单] SET [审核]=@审核 WHERE [单号]=@单号", new { 单号, 审核 });
    }

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(page, size, keyword));
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号);
        if (d is null) return NotFound();
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var l in d.明细) { l.单价 = null; l.金额 = null; }
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] FinishedTransferCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "生产单号/款号不存在。" }); }
        await AuditAsync("新增", $"单号={单号}");
        return CreatedAtAction(nameof(Get), new { 单号 }, new { 单号 });
    }

    [HttpDelete("{单号}")]
    public async Task<IActionResult> Delete(string 单号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try { if (!await svc.DeleteAsync(单号)) return NotFound(); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("删除", $"单号={单号}");
        return NoContent();
    }

    [HttpPost("{单号}/approve")]
    public async Task<IActionResult> Approve(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        if (!await posting.ApproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        await SyncLineApprovalAsync(单号, "1");
        return NoContent();
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        if (!await posting.UnapproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        await SyncLineApprovalAsync(单号, "0");
        return NoContent();
    }
}
```

- [ ] **Step 4: 跑测试确认通过** — `dotnet test --filter "FullyQualifiedName~P5ApiIntegrationTests"` → PASS（含原 P5a 用例 + 调拨闭环）。

- [ ] **Step 5: 全量回归 + 提交** — `dotnet test` → 全 PASS。

```powershell
git add src/ErpApi/Features/Warehouse/Finished/FinishedTransferController.cs tests/ErpApi.Tests/P5ApiIntegrationTests.cs
git commit -m @'
feat(P5): 成品调拨REST接口(审核同步明细+成本保密)+跨仓库存闭环测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: 成品退货 Service + Controller（客户退回，入仓库 +）

**Files:** Create `src/ErpApi/Features/Warehouse/Finished/FinishedSalesReturnService.cs`, `FinishedSalesReturnController.cs`; Modify `src/ErpApi/Program.cs`; Test `tests/ErpApi.Tests/FinishedSalesReturnServiceDbTests.cs` + 追加 `P5ApiIntegrationTests.cs`

- [ ] **Step 1: 写失败的 Service 测试** — Create `tests/ErpApi.Tests/FinishedSalesReturnServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Warehouse.Finished;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class FinishedSalesReturnServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private FinishedSalesReturnService Svc() => new(Factory(), new DocumentNumberGenerator());
    private static FinishedSalesReturnCreateDto Dto() => new()
    {
        仓库 = P5TestData.仓库, 客户编号 = P5TestData.客户编号, 客户名称 = "P5测试客户",
        生产单号 = P5TestData.生产单号, 款号 = P5TestData.款号, 款式 = "P5测试款式",
        明细 = [ new FinishedSalesReturnLineDto { 色号 = "01", 颜色 = "黑色", 尺码 = "M", 数量 = 5, 单价 = 20 } ]
    };

    [SkippableFact]
    public async Task Create_then_delete_lifecycle()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("TH", 单号);
            Assert.Equal(100m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [成品退货明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(1, (await Svc().ListAsync(1, 20, 单号)).Total);
            Assert.Equal(1, (await Svc().GetAsync(单号))!.明细.Count);
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.False(await Svc().DeleteAsync("TH不存在"));
        }
        finally
        {
            c.Execute("DELETE FROM [成品退货明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [成品退货单] WHERE [单号]=@n", new { n = 单号 });
            P5TestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — `dotnet test --filter "FullyQualifiedName~FinishedSalesReturnServiceDbTests"` → FAIL。

- [ ] **Step 3: 实现 FinishedSalesReturnService** — Create `src/ErpApi/Features/Warehouse/Finished/FinishedSalesReturnService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
namespace ErpApi.Features.Warehouse.Finished;

// 成品退货（客户退回，入仓库 +）。两层：成品退货单 + 成品退货明细单(单号 主从 FK)。
public sealed class FinishedSalesReturnService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "成品退货单";
    public const string Prefix = "TH";

    public async Task<string> CreateAsync(FinishedSalesReturnCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("成品退货至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("仓库必填");
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [成品退货单]([单号],[日期],[客户编号],[客户名称],[仓库],[操作员],[审核],[备注])
VALUES(@单号,@日期,@客户编号,@客户名称,@仓库,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.客户编号, dto.客户名称, dto.仓库, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [成品退货明细单]([单号],[出仓单号],[日期],[客户编号],[客户名称],[仓库],[生产单号],[款号],[款式],[床号],[色号],[颜色],[尺码],[数量],[单价],[金额],[审核])
VALUES(@单号,@出仓单号,@日期,@客户编号,@客户名称,@仓库,@生产单号,@款号,@款式,@床号,@色号,@颜色,@尺码,@数量,@单价,@金额,'0')",
                new
                {
                    单号, dto.出仓单号, 日期 = now, dto.客户编号, dto.客户名称, dto.仓库,
                    dto.生产单号, dto.款号, dto.款式, dto.床号, l.色号, l.颜色, l.尺码,
                    l.数量, 单价 = l.单价 ?? 0m, 金额 = l.数量 * (l.单价 ?? 0m)
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<FinishedSalesReturnHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [成品退货单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [客户名称] LIKE @kw;
SELECT [ID],[单号],[客户名称],[仓库],[日期],[操作员],[审核],[审核人],[备注]
FROM [成品退货单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [客户名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<FinishedSalesReturnHeaderDto>()).AsList();
        return new PagedResult<FinishedSalesReturnHeaderDto>(items, total);
    }

    public async Task<FinishedSalesReturnDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[客户名称],[仓库],[日期],[操作员],[审核],[审核人],[备注] FROM [成品退货单] WHERE [单号]=@单号;
SELECT [ID],[款号],[色号],[颜色],[尺码],[数量],[单价],[金额] FROM [成品退货明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<FinishedSalesReturnHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<FinishedSalesReturnLineRowDto>()).AsList();
        return new FinishedSalesReturnDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [成品退货单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的成品退货单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [成品退货明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [成品退货单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 4: Program.cs 注册** — 追加 `builder.Services.AddScoped<ErpApi.Features.Warehouse.Finished.FinishedSalesReturnService>();`

- [ ] **Step 5: 实现 FinishedSalesReturnController** — Create `src/ErpApi/Features/Warehouse/Finished/FinishedSalesReturnController.cs`（与 FinishedTransferController 同构：`Route("api/finished-sales-returns")`、`Menu="成品退货"`、`Table="成品退货单"`、`SyncLineApprovalAsync` 指向 `成品退货明细单`、Get 脱敏 单价/金额。Create 的 SqlException 547 文案 `"客户/生产单号/款号不存在。"`。完整代码逐字复制 Task 4 的 FinishedTransferController，仅替换：类名→FinishedSalesReturnController、构造函数服务类型→FinishedSalesReturnService、Route/Menu/Table 三常量、SyncLineApprovalAsync 的表名→成品退货明细单、Create 的 DTO 类型→FinishedSalesReturnCreateDto）:

```csharp
using System.Security.Claims;
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Warehouse.Finished;

[ApiController]
[Authorize]
[Route("api/finished-sales-returns")]
public sealed class FinishedSalesReturnController(
    FinishedSalesReturnService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "成品退货";
    private const string Table = "成品退货单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create(); await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }
    private async Task SyncLineApprovalAsync(string 单号, string 审核)
    {
        using var c = factory.Create(); await c.OpenAsync();
        await c.ExecuteAsync("UPDATE [成品退货明细单] SET [审核]=@审核 WHERE [单号]=@单号", new { 单号, 审核 });
    }

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(page, size, keyword));
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号);
        if (d is null) return NotFound();
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var l in d.明细) { l.单价 = null; l.金额 = null; }
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] FinishedSalesReturnCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "客户/生产单号/款号不存在。" }); }
        await AuditAsync("新增", $"单号={单号}");
        return CreatedAtAction(nameof(Get), new { 单号 }, new { 单号 });
    }

    [HttpDelete("{单号}")]
    public async Task<IActionResult> Delete(string 单号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try { if (!await svc.DeleteAsync(单号)) return NotFound(); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("删除", $"单号={单号}");
        return NoContent();
    }

    [HttpPost("{单号}/approve")]
    public async Task<IActionResult> Approve(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        if (!await posting.ApproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        await SyncLineApprovalAsync(单号, "1");
        return NoContent();
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        if (!await posting.UnapproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        await SyncLineApprovalAsync(单号, "0");
        return NoContent();
    }
}
```

- [ ] **Step 6: 追加退货 API 测试** — 在 `tests/ErpApi.Tests/P5ApiIntegrationTests.cs` 追加（退货入仓库 +）：

```csharp
    [SkippableFact]
    public async Task SalesReturn_lifecycle_adds_inventory()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5TestData.Seed(c); }
        SeedPerms("p5bth", "成品退货", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p5bth", "成品库存", open: true);
        var client = Client(app, "p5bth");
        string? th = null;
        async Task<decimal> Inv() {
            var inv = await client.GetFromJsonAsync<JsonElement>($"/api/finished-inventory?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5TestData.仓库)}");
            decimal s = 0; foreach (var r in inv.EnumerateArray()) s += r.GetProperty("库存").GetDecimal(); return s;
        }
        try
        {
            var cr = await client.PostAsJsonAsync("/api/finished-sales-returns", new {
                仓库 = P5TestData.仓库, 客户编号 = P5TestData.客户编号, 客户名称 = "P5测试客户",
                生产单号 = P5TestData.生产单号, 款号 = P5TestData.款号, 款式 = "P5测试款式",
                明细 = new[] { new { 色号 = "01", 颜色 = "黑色", 尺码 = "M", 数量 = 5, 单价 = 20 } } });
            Assert.Equal(HttpStatusCode.Created, cr.StatusCode);
            th = (await cr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/finished-sales-returns/{th}/approve", null)).StatusCode);
            Assert.Equal(5m, await Inv());  // 客户退回入仓 +5
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (th != null) { c.Execute("DELETE FROM [成品退货明细单] WHERE [单号]=@n", new { n = th }); c.Execute("DELETE FROM [成品退货单] WHERE [单号]=@n", new { n = th }); }
            P5TestData.Cleanup(c);
        }
    }
```

- [ ] **Step 7: 跑测试 + 全量回归 + 提交** — `dotnet test --filter "FullyQualifiedName~FinishedSalesReturnServiceDbTests"` PASS；`dotnet test --filter "FullyQualifiedName~P5ApiIntegrationTests"` PASS；`dotnet test` 全 PASS。

```powershell
git add src/ErpApi/Features/Warehouse/Finished/FinishedSalesReturnService.cs src/ErpApi/Features/Warehouse/Finished/FinishedSalesReturnController.cs src/ErpApi/Program.cs tests/ErpApi.Tests/FinishedSalesReturnServiceDbTests.cs tests/ErpApi.Tests/P5ApiIntegrationTests.cs
git commit -m @'
feat(P5): 成品退货服务+REST(前缀TH,审核同步明细入仓+)+退货后库存验证

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 6: 成品退仓 Service + Controller（退供应商，出仓库 −）

**Files:** Create `src/ErpApi/Features/Warehouse/Finished/FinishedVendorReturnService.cs`, `FinishedVendorReturnController.cs`; Modify `src/ErpApi/Program.cs`; Test `tests/ErpApi.Tests/FinishedVendorReturnServiceDbTests.cs` + 追加 `P5ApiIntegrationTests.cs`

- [ ] **Step 1: 写失败的 Service 测试** — Create `tests/ErpApi.Tests/FinishedVendorReturnServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Warehouse.Finished;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class FinishedVendorReturnServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private FinishedVendorReturnService Svc() => new(Factory(), new DocumentNumberGenerator());
    private static FinishedVendorReturnCreateDto Dto() => new()
    {
        仓库 = P5TestData.仓库, 生产单号 = P5TestData.生产单号, 款号 = P5TestData.款号, 款式 = "P5测试款式",
        明细 = [ new FinishedVendorReturnLineDto { 色号 = "01", 颜色 = "黑色", 尺码 = "M", 数量 = 3, 单价 = 10 } ]
    };

    [SkippableFact]
    public async Task Create_then_delete_lifecycle()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("TC", 单号);
            Assert.Equal(30m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [成品退仓明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(1, (await Svc().ListAsync(1, 20, 单号)).Total);
            Assert.Equal(1, (await Svc().GetAsync(单号))!.明细.Count);
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.False(await Svc().DeleteAsync("TC不存在"));
        }
        finally
        {
            c.Execute("DELETE FROM [成品退仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [成品退仓单] WHERE [单号]=@n", new { n = 单号 });
            P5TestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — `dotnet test --filter "FullyQualifiedName~FinishedVendorReturnServiceDbTests"` → FAIL。

- [ ] **Step 3: 实现 FinishedVendorReturnService** — Create `src/ErpApi/Features/Warehouse/Finished/FinishedVendorReturnService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
namespace ErpApi.Features.Warehouse.Finished;

// 成品退仓（退供应商，出仓库 −）。两层：成品退仓单 + 成品退仓明细单(单号 主从 FK)。
public sealed class FinishedVendorReturnService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "成品退仓单";
    public const string Prefix = "TC";

    public async Task<string> CreateAsync(FinishedVendorReturnCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("成品退仓至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("仓库必填");
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [成品退仓单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[操作员],[审核],[备注])
VALUES(@单号,@日期,@供应商编号,@供应商名称,@仓库,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.供应商编号, dto.供应商名称, dto.仓库, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [成品退仓明细单]([单号],[入仓单号],[日期],[供应商编号],[供应商名称],[仓库],[生产单号],[款号],[款式],[床号],[色号],[颜色],[尺码],[数量],[单价],[金额],[审核])
VALUES(@单号,@入仓单号,@日期,@供应商编号,@供应商名称,@仓库,@生产单号,@款号,@款式,@床号,@色号,@颜色,@尺码,@数量,@单价,@金额,'0')",
                new
                {
                    单号, dto.入仓单号, 日期 = now, dto.供应商编号, dto.供应商名称, dto.仓库,
                    dto.生产单号, dto.款号, dto.款式, dto.床号, l.色号, l.颜色, l.尺码,
                    l.数量, 单价 = l.单价 ?? 0m, 金额 = l.数量 * (l.单价 ?? 0m)
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<FinishedVendorReturnHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [成品退仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [供应商名称] LIKE @kw;
SELECT [ID],[单号],[供应商名称],[仓库],[日期],[操作员],[审核],[审核人],[备注]
FROM [成品退仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [供应商名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<FinishedVendorReturnHeaderDto>()).AsList();
        return new PagedResult<FinishedVendorReturnHeaderDto>(items, total);
    }

    public async Task<FinishedVendorReturnDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[供应商名称],[仓库],[日期],[操作员],[审核],[审核人],[备注] FROM [成品退仓单] WHERE [单号]=@单号;
SELECT [ID],[款号],[色号],[颜色],[尺码],[数量],[单价],[金额] FROM [成品退仓明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<FinishedVendorReturnHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<FinishedVendorReturnLineRowDto>()).AsList();
        return new FinishedVendorReturnDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [成品退仓单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的成品退仓单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [成品退仓明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [成品退仓单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 4: Program.cs 注册** — 追加 `builder.Services.AddScoped<ErpApi.Features.Warehouse.Finished.FinishedVendorReturnService>();`

- [ ] **Step 5: 实现 FinishedVendorReturnController** — Create `src/ErpApi/Features/Warehouse/Finished/FinishedVendorReturnController.cs`（与 FinishedSalesReturnController 同构，逐字复制并替换：类名→FinishedVendorReturnController、服务类型→FinishedVendorReturnService、`Route("api/finished-vendor-returns")`、`Menu="成品退仓"`、`Table="成品退仓单"`、SyncLineApprovalAsync 表名→成品退仓明细单、Create DTO→FinishedVendorReturnCreateDto、547 文案 `"供应商/生产单号/款号不存在。"`）:

```csharp
using System.Security.Claims;
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Warehouse.Finished;

[ApiController]
[Authorize]
[Route("api/finished-vendor-returns")]
public sealed class FinishedVendorReturnController(
    FinishedVendorReturnService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "成品退仓";
    private const string Table = "成品退仓单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create(); await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }
    private async Task SyncLineApprovalAsync(string 单号, string 审核)
    {
        using var c = factory.Create(); await c.OpenAsync();
        await c.ExecuteAsync("UPDATE [成品退仓明细单] SET [审核]=@审核 WHERE [单号]=@单号", new { 单号, 审核 });
    }

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(page, size, keyword));
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号);
        if (d is null) return NotFound();
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var l in d.明细) { l.单价 = null; l.金额 = null; }
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] FinishedVendorReturnCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "供应商/生产单号/款号不存在。" }); }
        await AuditAsync("新增", $"单号={单号}");
        return CreatedAtAction(nameof(Get), new { 单号 }, new { 单号 });
    }

    [HttpDelete("{单号}")]
    public async Task<IActionResult> Delete(string 单号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try { if (!await svc.DeleteAsync(单号)) return NotFound(); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("删除", $"单号={单号}");
        return NoContent();
    }

    [HttpPost("{单号}/approve")]
    public async Task<IActionResult> Approve(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        if (!await posting.ApproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        await SyncLineApprovalAsync(单号, "1");
        return NoContent();
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        if (!await posting.UnapproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        await SyncLineApprovalAsync(单号, "0");
        return NoContent();
    }
}
```

- [ ] **Step 6: 追加退仓 API 测试 + 三单全链路** — 在 `tests/ErpApi.Tests/P5ApiIntegrationTests.cs` 追加（退仓出仓库 −，先入仓建底）：

```csharp
    [SkippableFact]
    public async Task VendorReturn_lifecycle_reduces_inventory()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5TestData.Seed(c);
            c.Execute(@"INSERT INTO [成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5BTCRK',N'P5成品仓','1')");
            c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                        VALUES(N'P5BTCRK',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',10,'1')"); }
        SeedPerms("p5btc", "成品退仓", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p5btc", "成品库存", open: true);
        var client = Client(app, "p5btc");
        string? tc = null;
        async Task<decimal> Inv() {
            var inv = await client.GetFromJsonAsync<JsonElement>($"/api/finished-inventory?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5TestData.仓库)}");
            decimal s = 0; foreach (var r in inv.EnumerateArray()) s += r.GetProperty("库存").GetDecimal(); return s;
        }
        try
        {
            Assert.Equal(10m, await Inv());
            var cr = await client.PostAsJsonAsync("/api/finished-vendor-returns", new {
                仓库 = P5TestData.仓库, 生产单号 = P5TestData.生产单号, 款号 = P5TestData.款号, 款式 = "P5测试款式",
                明细 = new[] { new { 色号 = "01", 颜色 = "黑色", 尺码 = "M", 数量 = 3, 单价 = 10 } } });
            Assert.Equal(HttpStatusCode.Created, cr.StatusCode);
            tc = (await cr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/finished-vendor-returns/{tc}/approve", null)).StatusCode);
            Assert.Equal(7m, await Inv());  // 10 - 3
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (tc != null) { c.Execute("DELETE FROM [成品退仓明细单] WHERE [单号]=@n", new { n = tc }); c.Execute("DELETE FROM [成品退仓单] WHERE [单号]=@n", new { n = tc }); }
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]='P5BTCRK'");
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]='P5BTCRK'");
            P5TestData.Cleanup(c);
        }
    }
```

- [ ] **Step 7: 跑测试 + 全量回归 + 提交** — `dotnet test --filter "FullyQualifiedName~FinishedVendorReturnServiceDbTests"` PASS；`dotnet test --filter "FullyQualifiedName~P5ApiIntegrationTests"` PASS；`dotnet test` 全 PASS。

```powershell
git add src/ErpApi/Features/Warehouse/Finished/FinishedVendorReturnService.cs src/ErpApi/Features/Warehouse/Finished/FinishedVendorReturnController.cs src/ErpApi/Program.cs tests/ErpApi.Tests/FinishedVendorReturnServiceDbTests.cs tests/ErpApi.Tests/P5ApiIntegrationTests.cs
git commit -m @'
feat(P5): 成品退仓服务+REST(前缀TC,审核同步明细出仓-)+退仓后库存验证

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 7: 权限种子 + 后端收尾回归 + 冒烟

**Files:** Create `db/seed_p5b_perms.sql`

- [ ] **Step 1: 写权限种子** — Create `db/seed_p5b_perms.sql`:

```sql
-- 开发用:给某用户授予 P5b 成品仓储菜单权限(调拨/退货/退仓)。用法:把 @用户 改成登录名,在目标库执行。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'成品调拨',N'成品退货',N'成品退仓');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'成品调拨',1,1,1,1,1,1,1,1,1),
       (@用户,N'成品退货',1,1,1,1,1,1,1,1,1),
       (@用户,N'成品退仓',1,1,1,1,1,1,1,1,1);
```

- [ ] **Step 2: 在两库执行 + 验收(各应返回 3)**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
dotnet run --project tools/DbDeploy -- "$env:ERP_DB" db/seed_p5b_perms.sql
dotnet run --project tools/DbDeploy -- "$env:ERP_TEST_DB" db/seed_p5b_perms.sql
dotnet run --project tmp/dbquery -- "$env:ERP_DB" "SELECT COUNT(*) n FROM userbqrpower WHERE 用户='admin' AND 菜单 IN (N'成品调拨',N'成品退货',N'成品退仓')"
```

- [ ] **Step 3: 后端全量回归** — `dotnet test` → 全 PASS，0 跳过。

- [ ] **Step 4: API 冒烟（绕代理）** — 启后端，复用 `tmp/smoke_p4`（tmp/ gitignored）改 URL 验证 200（admin/admin123）：

```
GET /api/finished-transfers?page=1&size=5         → 200 {items,total}
GET /api/finished-sales-returns?page=1&size=5     → 200 {items,total}
GET /api/finished-vendor-returns?page=1&size=5    → 200 {items,total}
```
冒烟后停后端。

- [ ] **Step 5: 提交**

```powershell
git add db/seed_p5b_perms.sql
git commit -m @'
feat(P5): P5b菜单权限种子(成品调拨/退货/退仓)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 8: 前端 — 成品调拨页（API client + 列表 + 新建[源/目标仓库]）

**前端规范**：异步 try/catch + `message.error(err.response?.data?.消息 ?? 默认)`；函数式 setState；TS 严格、build 0 错误。

**先读**：`web/src/api/finished.ts`（追加 client）、`web/src/pages/warehouse/FinishedReceiptPage.tsx`+`FinishedReceiptCreateDrawer.tsx`（范本）、`web/src/api/production.ts`、`web/src/auth/permissions.ts`/`PermissionContext.tsx`。

**Files:** Modify `web/src/api/finished.ts`; Create `web/src/pages/warehouse/FinishedTransferCreateDrawer.tsx`, `web/src/pages/warehouse/FinishedTransferPage.tsx`

- [ ] **Step 1: 追加三 client + 类型** — 在 `web/src/api/finished.ts` 末尾追加:

```typescript
// ---- 调拨 ----
export interface FTLine { 色号?: string; 颜色?: string; 尺码?: string; 数量: number; 单价?: number }
export interface FTCreate { 源仓库: string; 目标仓库: string; 客户编号?: string; 客户名称?: string; 出仓单号?: string; 生产单号?: string; 款号?: string; 款式?: string; 床号?: string; 备注?: string; 明细: FTLine[] }
export interface FTHeader { id: number; 单号?: string; 客户名称?: string; 日期?: string; 审核?: string; 备注?: string }
export interface FTDetail { 单头: FTHeader | null; 明细: { id: number; 源仓库?: string; 目标仓库?: string; 款号?: string; 色号?: string; 颜色?: string; 尺码?: string; 数量?: number; 单价?: number | null; 金额?: number | null }[] }
// ---- 退货 ----
export interface FSRLine { 色号?: string; 颜色?: string; 尺码?: string; 数量: number; 单价?: number }
export interface FSRCreate { 仓库: string; 出仓单号?: string; 客户编号?: string; 客户名称?: string; 生产单号?: string; 款号?: string; 款式?: string; 床号?: string; 备注?: string; 明细: FSRLine[] }
export interface FSRHeader { id: number; 单号?: string; 客户名称?: string; 仓库?: string; 日期?: string; 审核?: string; 备注?: string }
// ---- 退仓 ----
export interface FVRLine { 色号?: string; 颜色?: string; 尺码?: string; 数量: number; 单价?: number }
export interface FVRCreate { 仓库: string; 入仓单号?: string; 供应商编号?: string; 供应商名称?: string; 生产单号?: string; 款号?: string; 款式?: string; 床号?: string; 备注?: string; 明细: FVRLine[] }
export interface FVRHeader { id: number; 单号?: string; 供应商名称?: string; 仓库?: string; 日期?: string; 审核?: string; 备注?: string }

export const finishedTransferApi = {
  list: (page = 1, size = 20, keyword = "") => api.get<Paged<FTHeader>>("/finished-transfers", { params: { page, size, keyword } }).then(r => r.data),
  get: (单号: string) => api.get<FTDetail>(`/finished-transfers/${enc(单号)}`).then(r => r.data),
  create: (body: FTCreate) => api.post<{ 单号: string }>("/finished-transfers", body).then(r => r.data),
  remove: (单号: string) => api.delete(`/finished-transfers/${enc(单号)}`),
  approve: (单号: string) => api.post(`/finished-transfers/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/finished-transfers/${enc(单号)}/unapprove`),
};
export const finishedSalesReturnApi = {
  list: (page = 1, size = 20, keyword = "") => api.get<Paged<FSRHeader>>("/finished-sales-returns", { params: { page, size, keyword } }).then(r => r.data),
  create: (body: FSRCreate) => api.post<{ 单号: string }>("/finished-sales-returns", body).then(r => r.data),
  remove: (单号: string) => api.delete(`/finished-sales-returns/${enc(单号)}`),
  approve: (单号: string) => api.post(`/finished-sales-returns/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/finished-sales-returns/${enc(单号)}/unapprove`),
};
export const finishedVendorReturnApi = {
  list: (page = 1, size = 20, keyword = "") => api.get<Paged<FVRHeader>>("/finished-vendor-returns", { params: { page, size, keyword } }).then(r => r.data),
  create: (body: FVRCreate) => api.post<{ 单号: string }>("/finished-vendor-returns", body).then(r => r.data),
  remove: (单号: string) => api.delete(`/finished-vendor-returns/${enc(单号)}`),
  approve: (单号: string) => api.post(`/finished-vendor-returns/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/finished-vendor-returns/${enc(单号)}/unapprove`),
};
```
（`enc`/`api`/`Paged` 已在文件顶部，沿用。）

- [ ] **Step 2: 调拨新建抽屉** — Create `web/src/pages/warehouse/FinishedTransferCreateDrawer.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Button, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Statistic, Table, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { productionApi, type ProductionHeader } from "../../api/production";
import { finishedTransferApi, type FTLine } from "../../api/finished";

interface Picked { 款号?: string; 款式?: string }

export default function FinishedTransferCreateDrawer({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [form] = Form.useForm<{ 源仓库: string; 目标仓库: string; 生产单号?: string; 备注?: string }>();
  const [orders, setOrders] = useState<ProductionHeader[]>([]);
  const [picked, setPicked] = useState<Picked>({});
  const [lines, setLines] = useState<FTLine[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try { setOrders((await productionApi.list(1, 200)).items); }
      catch { message.error("加载生产制单失败"); }
    })();
    form.resetFields(); setPicked({}); setLines([]);
  }, [open, form]);

  const onOrderChange = async (生产单号: string) => {
    try { const d = await productionApi.get(生产单号); setPicked({ 款号: d.单头?.款号, 款式: d.单头?.款式 }); }
    catch { message.error("加载生产制单详情失败"); }
  };
  const setLine = (i: number, patch: Partial<FTLine>) =>
    setLines(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    let v: { 源仓库: string; 目标仓库: string; 生产单号?: string; 备注?: string };
    try { v = await form.validateFields(); } catch { return; }
    if (v.源仓库 === v.目标仓库) { message.error("源仓库与目标仓库不能相同"); return; }
    const ok = lines.filter(l => Number(l.数量) > 0);
    if (ok.length === 0) { message.error("请至少录入一行有数量的明细"); return; }
    setSaving(true);
    try {
      await finishedTransferApi.create({ ...v, ...picked, 明细: ok });
      message.success("成品调拨单已创建"); onClose(); onCreated();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建调拨单失败");
    } finally { setSaving(false); }
  };

  const columns = [
    { title: "颜色", dataIndex: "颜色", width: 110, render: (_: unknown, r: FTLine, i: number) =>
      <Input style={{ width: 96 }} value={r.颜色 ?? ""} onChange={e => setLine(i, { 颜色: e.target.value })} /> },
    { title: "尺码", dataIndex: "尺码", width: 90, render: (_: unknown, r: FTLine, i: number) =>
      <Input style={{ width: 80 }} value={r.尺码 ?? ""} onChange={e => setLine(i, { 尺码: e.target.value })} /> },
    { title: "数量", dataIndex: "数量", width: 110, render: (_: unknown, r: FTLine, i: number) =>
      <InputNumber min={0} precision={0} style={{ width: 96 }} value={r.数量 ?? 0} onChange={n => setLine(i, { 数量: Number(n ?? 0) })} /> },
    { title: "", key: "_op", width: 50, render: (_: unknown, __: FTLine, i: number) =>
      <a onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>删除</a> },
  ];
  const 数量合计 = lines.reduce((a, l) => a + Number(l.数量 ?? 0), 0);

  return (
    <Drawer title="新建成品调拨单" width={900} open={open} onClose={onClose}
      extra={<Button type="primary" loading={saving} onClick={submit}>保存</Button>}>
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={8}><Form.Item name="源仓库" label="源仓库" rules={[{ required: true, message: "请填源仓库" }]}><Input placeholder="如 成品仓" /></Form.Item></Col>
          <Col span={8}><Form.Item name="目标仓库" label="目标仓库" rules={[{ required: true, message: "请填目标仓库" }]}><Input placeholder="如 半成品仓" /></Form.Item></Col>
          <Col span={8}>
            <Form.Item name="生产单号" label="生产制单">
              <Select showSearch allowClear optionFilterProp="label" onChange={onOrderChange}
                options={orders.map(o => ({ value: String(o.生产单号), label: `${o.生产单号} ${o.款式 ?? ""}` }))} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={8}><Form.Item label="款号"><Input value={`${picked.款号 ?? ""} ${picked.款式 ?? ""}`} disabled /></Form.Item></Col>
          <Col span={16}><Form.Item name="备注" label="备注"><Input /></Form.Item></Col>
        </Row>
      </Form>
      <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={lines} columns={columns} />
      <Space style={{ marginTop: 12 }} size={24}>
        <Button icon={<PlusOutlined />} onClick={() => setLines(prev => [...prev, { 数量: 0 }])}>加一行</Button>
        <Statistic title="调拨数量合计" value={数量合计} />
      </Space>
    </Drawer>
  );
}
```

- [ ] **Step 3: 调拨列表页** — Create `web/src/pages/warehouse/FinishedTransferPage.tsx`（仿 `FinishedReceiptPage`，MENU="成品调拨"，api=finishedTransferApi，列：单号/客户/日期/状态/操作；单号不可点[无详情抽屉]）:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Popconfirm, Space, Table, Tag, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { finishedTransferApi, type FTHeader } from "../../api/finished";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import FinishedTransferCreateDrawer from "./FinishedTransferCreateDrawer";

const MENU = "成品调拨";

export default function FinishedTransferPage() {
  const perms = usePerms();
  const [rows, setRows] = useState<FTHeader[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try { const r = await finishedTransferApi.list(page, 10, keyword); setRows(r.items); setTotal(r.total); }
    catch { message.error("加载成品调拨单失败"); }
  }, [page, keyword]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); load(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const columns = [
    { title: "单号", dataIndex: "单号", key: "单号", render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "客户", dataIndex: "客户名称", key: "客户名称" },
    { title: "日期", dataIndex: "日期", key: "日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "状态", dataIndex: "审核", key: "审核",
      render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: FTHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => finishedTransferApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => finishedTransferApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该调拨单?" onConfirm={() => act(() => finishedTransferApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title="成品调拨" variant="borderless"
      extra={
        <Space>
          <Input.Search placeholder="搜索单号/客户" allowClear onSearch={v => { setPage(1); setKeyword(v); }} style={{ width: 220 }} />
          {can(perms, MENU, "保存") && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建调拨单</Button>}
        </Space>
      }>
      <Table rowKey="id" size="middle" dataSource={rows} columns={columns} scroll={{ x: true }}
        pagination={{ current: page, pageSize: 10, total, onChange: setPage, showTotal: t => `共 ${t} 条` }} />
      <FinishedTransferCreateDrawer open={creating} onClose={() => setCreating(false)} onCreated={load} />
    </Card>
  );
}
```

- [ ] **Step 4: 构建 + 测试 + 提交** — `npm --prefix web run test`(PASS)；`npm --prefix web run build`(0 错误)。

```powershell
git add web/src/api/finished.ts web/src/pages/warehouse/FinishedTransferPage.tsx web/src/pages/warehouse/FinishedTransferCreateDrawer.tsx
git commit -m @'
feat(P5): 前端成品调拨页(源/目标仓库+录色码数量)+调拨/退货/退仓API client

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 9: 前端 — 成品退货页 + 成品退仓页

**Files:** Create `web/src/pages/warehouse/FinishedSalesReturnCreateDrawer.tsx`, `FinishedSalesReturnPage.tsx`, `FinishedVendorReturnCreateDrawer.tsx`, `FinishedVendorReturnPage.tsx`

- [ ] **Step 1: 退货新建抽屉** — Create `web/src/pages/warehouse/FinishedSalesReturnCreateDrawer.tsx`（仿 `FinishedReceiptCreateDrawer`：选生产单带款+客户、仓库必填、色码数量行、售价列；提交 `finishedSalesReturnApi.create`）:

```tsx
import { useEffect, useState } from "react";
import { Button, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Statistic, Table, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { productionApi, type ProductionHeader } from "../../api/production";
import { finishedSalesReturnApi, type FSRLine } from "../../api/finished";

interface Picked { 款号?: string; 款式?: string; 客户编号?: string; 客户名称?: string }

export default function FinishedSalesReturnCreateDrawer({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [form] = Form.useForm<{ 仓库: string; 生产单号?: string; 出仓单号?: string; 备注?: string }>();
  const [orders, setOrders] = useState<ProductionHeader[]>([]);
  const [picked, setPicked] = useState<Picked>({});
  const [lines, setLines] = useState<FSRLine[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try { setOrders((await productionApi.list(1, 200)).items); }
      catch { message.error("加载生产制单失败"); }
    })();
    form.resetFields(); setPicked({}); setLines([]);
  }, [open, form]);

  const onOrderChange = async (生产单号: string) => {
    try { const d = await productionApi.get(生产单号);
      setPicked({ 款号: d.单头?.款号, 款式: d.单头?.款式, 客户编号: d.单头?.客户编号, 客户名称: d.单头?.客户名称 }); }
    catch { message.error("加载生产制单详情失败"); }
  };
  const setLine = (i: number, patch: Partial<FSRLine>) =>
    setLines(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    let v: { 仓库: string; 生产单号?: string; 出仓单号?: string; 备注?: string };
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => Number(l.数量) > 0);
    if (ok.length === 0) { message.error("请至少录入一行有数量的明细"); return; }
    setSaving(true);
    try {
      await finishedSalesReturnApi.create({ ...v, ...picked, 明细: ok });
      message.success("成品退货单已创建"); onClose(); onCreated();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建退货单失败");
    } finally { setSaving(false); }
  };

  const columns = [
    { title: "颜色", dataIndex: "颜色", width: 110, render: (_: unknown, r: FSRLine, i: number) =>
      <Input style={{ width: 96 }} value={r.颜色 ?? ""} onChange={e => setLine(i, { 颜色: e.target.value })} /> },
    { title: "尺码", dataIndex: "尺码", width: 90, render: (_: unknown, r: FSRLine, i: number) =>
      <Input style={{ width: 80 }} value={r.尺码 ?? ""} onChange={e => setLine(i, { 尺码: e.target.value })} /> },
    { title: "数量", dataIndex: "数量", width: 110, render: (_: unknown, r: FSRLine, i: number) =>
      <InputNumber min={0} precision={0} style={{ width: 96 }} value={r.数量 ?? 0} onChange={n => setLine(i, { 数量: Number(n ?? 0) })} /> },
    { title: "售价", dataIndex: "单价", width: 120, render: (_: unknown, r: FSRLine, i: number) =>
      <InputNumber min={0} style={{ width: 100 }} value={r.单价 ?? 0} onChange={n => setLine(i, { 单价: Number(n ?? 0) })} /> },
    { title: "", key: "_op", width: 50, render: (_: unknown, __: FSRLine, i: number) =>
      <a onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>删除</a> },
  ];
  const 数量合计 = lines.reduce((a, l) => a + Number(l.数量 ?? 0), 0);

  return (
    <Drawer title="新建成品退货单" width={900} open={open} onClose={onClose}
      extra={<Button type="primary" loading={saving} onClick={submit}>保存</Button>}>
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={8}><Form.Item name="仓库" label="仓库" rules={[{ required: true, message: "请填仓库" }]}><Input placeholder="如 成品仓" /></Form.Item></Col>
          <Col span={8}>
            <Form.Item name="生产单号" label="生产制单">
              <Select showSearch allowClear optionFilterProp="label" onChange={onOrderChange}
                options={orders.map(o => ({ value: String(o.生产单号), label: `${o.生产单号} ${o.款式 ?? ""}` }))} />
            </Form.Item>
          </Col>
          <Col span={8}><Form.Item label="客户"><Input value={picked.客户名称 ?? ""} disabled /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={8}><Form.Item name="出仓单号" label="原出仓单号"><Input /></Form.Item></Col>
          <Col span={16}><Form.Item name="备注" label="备注"><Input /></Form.Item></Col>
        </Row>
      </Form>
      <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={lines} columns={columns} />
      <Space style={{ marginTop: 12 }} size={24}>
        <Button icon={<PlusOutlined />} onClick={() => setLines(prev => [...prev, { 数量: 0 }])}>加一行</Button>
        <Statistic title="退货数量合计" value={数量合计} />
      </Space>
    </Drawer>
  );
}
```

- [ ] **Step 2: 退货列表页** — Create `web/src/pages/warehouse/FinishedSalesReturnPage.tsx`（仿 Task 8 `FinishedTransferPage`，MENU="成品退货"，api=finishedSalesReturnApi，列：单号/客户/仓库/日期/状态/操作）:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Popconfirm, Space, Table, Tag, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { finishedSalesReturnApi, type FSRHeader } from "../../api/finished";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import FinishedSalesReturnCreateDrawer from "./FinishedSalesReturnCreateDrawer";

const MENU = "成品退货";

export default function FinishedSalesReturnPage() {
  const perms = usePerms();
  const [rows, setRows] = useState<FSRHeader[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try { const r = await finishedSalesReturnApi.list(page, 10, keyword); setRows(r.items); setTotal(r.total); }
    catch { message.error("加载成品退货单失败"); }
  }, [page, keyword]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); load(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const columns = [
    { title: "单号", dataIndex: "单号", key: "单号", render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "客户", dataIndex: "客户名称", key: "客户名称" },
    { title: "仓库", dataIndex: "仓库", key: "仓库" },
    { title: "日期", dataIndex: "日期", key: "日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "状态", dataIndex: "审核", key: "审核",
      render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: FSRHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => finishedSalesReturnApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => finishedSalesReturnApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该退货单?" onConfirm={() => act(() => finishedSalesReturnApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title="成品退货" variant="borderless"
      extra={
        <Space>
          <Input.Search placeholder="搜索单号/客户/仓库" allowClear onSearch={v => { setPage(1); setKeyword(v); }} style={{ width: 240 }} />
          {can(perms, MENU, "保存") && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建退货单</Button>}
        </Space>
      }>
      <Table rowKey="id" size="middle" dataSource={rows} columns={columns} scroll={{ x: true }}
        pagination={{ current: page, pageSize: 10, total, onChange: setPage, showTotal: t => `共 ${t} 条` }} />
      <FinishedSalesReturnCreateDrawer open={creating} onClose={() => setCreating(false)} onCreated={load} />
    </Card>
  );
}
```

- [ ] **Step 3: 退仓新建抽屉** — Create `web/src/pages/warehouse/FinishedVendorReturnCreateDrawer.tsx`（同退货抽屉，但去客户、改"原入仓单号"，提交 `finishedVendorReturnApi.create`，类型 `FVRLine`/`FVRCreate`；选生产单只带款不带客户；标题"新建成品退仓单"）:

```tsx
import { useEffect, useState } from "react";
import { Button, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Statistic, Table, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { productionApi, type ProductionHeader } from "../../api/production";
import { finishedVendorReturnApi, type FVRLine } from "../../api/finished";

interface Picked { 款号?: string; 款式?: string }

export default function FinishedVendorReturnCreateDrawer({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [form] = Form.useForm<{ 仓库: string; 生产单号?: string; 入仓单号?: string; 供应商名称?: string; 备注?: string }>();
  const [orders, setOrders] = useState<ProductionHeader[]>([]);
  const [picked, setPicked] = useState<Picked>({});
  const [lines, setLines] = useState<FVRLine[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try { setOrders((await productionApi.list(1, 200)).items); }
      catch { message.error("加载生产制单失败"); }
    })();
    form.resetFields(); setPicked({}); setLines([]);
  }, [open, form]);

  const onOrderChange = async (生产单号: string) => {
    try { const d = await productionApi.get(生产单号); setPicked({ 款号: d.单头?.款号, 款式: d.单头?.款式 }); }
    catch { message.error("加载生产制单详情失败"); }
  };
  const setLine = (i: number, patch: Partial<FVRLine>) =>
    setLines(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    let v: { 仓库: string; 生产单号?: string; 入仓单号?: string; 供应商名称?: string; 备注?: string };
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => Number(l.数量) > 0);
    if (ok.length === 0) { message.error("请至少录入一行有数量的明细"); return; }
    setSaving(true);
    try {
      await finishedVendorReturnApi.create({ ...v, ...picked, 明细: ok });
      message.success("成品退仓单已创建"); onClose(); onCreated();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建退仓单失败");
    } finally { setSaving(false); }
  };

  const columns = [
    { title: "颜色", dataIndex: "颜色", width: 110, render: (_: unknown, r: FVRLine, i: number) =>
      <Input style={{ width: 96 }} value={r.颜色 ?? ""} onChange={e => setLine(i, { 颜色: e.target.value })} /> },
    { title: "尺码", dataIndex: "尺码", width: 90, render: (_: unknown, r: FVRLine, i: number) =>
      <Input style={{ width: 80 }} value={r.尺码 ?? ""} onChange={e => setLine(i, { 尺码: e.target.value })} /> },
    { title: "数量", dataIndex: "数量", width: 110, render: (_: unknown, r: FVRLine, i: number) =>
      <InputNumber min={0} precision={0} style={{ width: 96 }} value={r.数量 ?? 0} onChange={n => setLine(i, { 数量: Number(n ?? 0) })} /> },
    { title: "单价", dataIndex: "单价", width: 120, render: (_: unknown, r: FVRLine, i: number) =>
      <InputNumber min={0} style={{ width: 100 }} value={r.单价 ?? 0} onChange={n => setLine(i, { 单价: Number(n ?? 0) })} /> },
    { title: "", key: "_op", width: 50, render: (_: unknown, __: FVRLine, i: number) =>
      <a onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>删除</a> },
  ];
  const 数量合计 = lines.reduce((a, l) => a + Number(l.数量 ?? 0), 0);

  return (
    <Drawer title="新建成品退仓单" width={900} open={open} onClose={onClose}
      extra={<Button type="primary" loading={saving} onClick={submit}>保存</Button>}>
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={8}><Form.Item name="仓库" label="仓库" rules={[{ required: true, message: "请填仓库" }]}><Input placeholder="如 成品仓" /></Form.Item></Col>
          <Col span={8}><Form.Item name="供应商名称" label="供应商"><Input /></Form.Item></Col>
          <Col span={8}>
            <Form.Item name="生产单号" label="生产制单">
              <Select showSearch allowClear optionFilterProp="label" onChange={onOrderChange}
                options={orders.map(o => ({ value: String(o.生产单号), label: `${o.生产单号} ${o.款式 ?? ""}` }))} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={8}><Form.Item label="款号"><Input value={`${picked.款号 ?? ""} ${picked.款式 ?? ""}`} disabled /></Form.Item></Col>
          <Col span={8}><Form.Item name="入仓单号" label="原入仓单号"><Input /></Form.Item></Col>
          <Col span={8}><Form.Item name="备注" label="备注"><Input /></Form.Item></Col>
        </Row>
      </Form>
      <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={lines} columns={columns} />
      <Space style={{ marginTop: 12 }} size={24}>
        <Button icon={<PlusOutlined />} onClick={() => setLines(prev => [...prev, { 数量: 0 }])}>加一行</Button>
        <Statistic title="退仓数量合计" value={数量合计} />
      </Space>
    </Drawer>
  );
}
```

- [ ] **Step 4: 退仓列表页** — Create `web/src/pages/warehouse/FinishedVendorReturnPage.tsx`（仿退货列表页，MENU="成品退仓"，api=finishedVendorReturnApi，列 客户→供应商）:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Popconfirm, Space, Table, Tag, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { finishedVendorReturnApi, type FVRHeader } from "../../api/finished";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import FinishedVendorReturnCreateDrawer from "./FinishedVendorReturnCreateDrawer";

const MENU = "成品退仓";

export default function FinishedVendorReturnPage() {
  const perms = usePerms();
  const [rows, setRows] = useState<FVRHeader[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try { const r = await finishedVendorReturnApi.list(page, 10, keyword); setRows(r.items); setTotal(r.total); }
    catch { message.error("加载成品退仓单失败"); }
  }, [page, keyword]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); load(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const columns = [
    { title: "单号", dataIndex: "单号", key: "单号", render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "供应商", dataIndex: "供应商名称", key: "供应商名称" },
    { title: "仓库", dataIndex: "仓库", key: "仓库" },
    { title: "日期", dataIndex: "日期", key: "日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "状态", dataIndex: "审核", key: "审核",
      render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: FVRHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => finishedVendorReturnApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => finishedVendorReturnApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该退仓单?" onConfirm={() => act(() => finishedVendorReturnApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title="成品退仓" variant="borderless"
      extra={
        <Space>
          <Input.Search placeholder="搜索单号/供应商/仓库" allowClear onSearch={v => { setPage(1); setKeyword(v); }} style={{ width: 240 }} />
          {can(perms, MENU, "保存") && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建退仓单</Button>}
        </Space>
      }>
      <Table rowKey="id" size="middle" dataSource={rows} columns={columns} scroll={{ x: true }}
        pagination={{ current: page, pageSize: 10, total, onChange: setPage, showTotal: t => `共 ${t} 条` }} />
      <FinishedVendorReturnCreateDrawer open={creating} onClose={() => setCreating(false)} onCreated={load} />
    </Card>
  );
}
```

- [ ] **Step 5: 构建 + 测试 + 提交** — `npm --prefix web run test`(PASS)；`npm --prefix web run build`(0 错误)。

```powershell
git add web/src/pages/warehouse/FinishedSalesReturnPage.tsx web/src/pages/warehouse/FinishedSalesReturnCreateDrawer.tsx web/src/pages/warehouse/FinishedVendorReturnPage.tsx web/src/pages/warehouse/FinishedVendorReturnCreateDrawer.tsx
git commit -m @'
feat(P5): 前端成品退货页+成品退仓页(选生产单+录色码数量+审核)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 10: 前端 — 路由 + 成品仓储菜单组追加三项

**Files:** Modify `web/src/App.tsx`, `web/src/pages/MainLayout.tsx`

- [ ] **Step 1: App.tsx 加路由** — import 三页面（在 P5a 的 Finished* import 之后），在 `finished-inventory` 路由之后加：

```tsx
import FinishedTransferPage from "./pages/warehouse/FinishedTransferPage";
import FinishedSalesReturnPage from "./pages/warehouse/FinishedSalesReturnPage";
import FinishedVendorReturnPage from "./pages/warehouse/FinishedVendorReturnPage";
```
```tsx
          <Route path="finished-transfers" element={<FinishedTransferPage />} />
          <Route path="finished-sales-returns" element={<FinishedSalesReturnPage />} />
          <Route path="finished-vendor-returns" element={<FinishedVendorReturnPage />} />
```

- [ ] **Step 2: MainLayout 在 fgChildren 追加三项** — 修改 `web/src/pages/MainLayout.tsx`：
  (a) import 图标加 `SwapOutlined, RollbackOutlined, UndoOutlined`（`RollbackOutlined` 可能已被 M7 import，去重；只加未存在的）。
  (b) 在 `fgChildren` 数组的"成品库存"项**之后**追加三项：

```tsx
    ...(can(perms, "成品调拨", "打开") ? [{ key: "/finished-transfers", label: "成品调拨", icon: <SwapOutlined /> }] : []),
    ...(can(perms, "成品退货", "打开") ? [{ key: "/finished-sales-returns", label: "成品退货", icon: <RollbackOutlined /> }] : []),
    ...(can(perms, "成品退仓", "打开") ? [{ key: "/finished-vendor-returns", label: "成品退仓", icon: <UndoOutlined /> }] : []),
```
  (c) Header 标题链在 `/finished-inventory` 分支之后追加（互不为前缀，顺序无碍，置于 `: "基础资料"` 前）：

```tsx
              : loc.pathname.startsWith("/finished-transfers") ? "成品调拨"
              : loc.pathname.startsWith("/finished-sales-returns") ? "成品退货"
              : loc.pathname.startsWith("/finished-vendor-returns") ? "成品退仓"
```

- [ ] **Step 3: 构建 + 测试 + 提交** — `npm --prefix web run test`(PASS)；`npm --prefix web run build`(0 错误)。

```powershell
git add web/src/App.tsx web/src/pages/MainLayout.tsx
git commit -m @'
feat(P5): 成品仓储菜单组追加 成品调拨/退货/退仓 + 路由

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 11: 端到端验证（调拨 → 退货 → 退仓 + 截图）

无新功能代码（发现 bug 才修）。

**Files:** 无（操作性任务）

- [ ] **Step 1: 全量回归**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
$env:ERP_JWT_KEY = [Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")
dotnet test ; npm --prefix web run test ; npm --prefix web run build
```
Expected: 后端全 PASS（0 跳过）、前端全 PASS、构建 0 错误。

- [ ] **Step 2: 启动前后端**（停残留后台启动 ErpApi --urls http://localhost:5000、vite 5173，等 15 秒）。

- [ ] **Step 3: API 全链路 E2E（绕代理）** — 复用/改写 `tmp/smoke_p4`（tmp/ gitignored）：登录 admin/admin123 → 成品仓既有库存（沿用 P5a 演示数据，K001 黑M 28；若已被清，先入仓100黑M并审核作底）→ 调拨 10 件 成品仓→半成品仓 并审核 → `GET /api/finished-inventory?仓库=成品仓` 减10、`?仓库=半成品仓` 加10 → 退货 5 件入成品仓并审核 → 成品仓 +5 → 退仓 3 件出成品仓并审核 → 成品仓 −3。全 PASS 后记录单号。

- [ ] **Step 4: puppeteer 截图** — 写 `tmp/shot/p5b-e2e.cjs`（headless:'new'，1440×900，Chrome 路径双反斜杠）：登录 → 成品仓储 → 成品调拨列表(截图 `tmp/p5b-1-transfer.png`) → 成品退货列表(截图 `tmp/p5b-2-salesreturn.png`) → 成品退仓列表(截图 `tmp/p5b-3-vendorreturn.png`)。失败先截图存档。核心命题以 API E2E 为准。

- [ ] **Step 5: 数据库验证调拨跨仓** — `dotnet run --project tmp/dbquery -- "$env:ERP_DB"` 查成品仓与半成品仓 K001 库存（UNION 含调拨双腿），记录实际值。

- [ ] **Step 6: 清理 + 收尾** — 停服务。确认 `git status` 干净（tmp/ 不计）、`git log --oneline master..HEAD` 约 11 提交。汇报后由 finishing-a-development-branch 决定合并。

---

## Self-Review 结论

**Spec 覆盖**（对照 `2026-06-05-p5b-finished-transfer-design.md`）：
- ✅ 库存引擎调拨双腿（目标仓+/源仓−）：Task 2
- ✅ 成品调拨（前缀 CD，源/目标仓库写入明细，两层 Dapper）：Task 3（Service）+ Task 4（Controller+跨仓库存闭环）+ Task 8（前端）
- ✅ 成品退货（前缀 TH，入仓库+）：Task 5（Service+Controller）+ Task 9（前端）
- ✅ 成品退仓（前缀 TC，出仓库−）：Task 6（Service+Controller）+ Task 9（前端）
- ✅ DB 07 脚本（三单补审核留痕列）+ 审核引擎用例：Task 1
- ✅ 审核同步明细审核位：三控制器 SyncLineApprovalAsync（Task 4/5/6）
- ✅ 成本保密、权限种子（Task 7）、菜单组追加+路由（Task 10）、端到端（Task 11）

**关键实现注记**：与 P5a 同——`FinishedGoodsAsync` 按各明细单 `审核` 过滤，审核引擎②只翻单头，故三控制器 Approve/Unapprove 必须 `SyncLineApprovalAsync` 同步明细审核位（库存断言依赖）。调拨双腿：源仓库 −数量、目标仓库 +数量。

**类型/签名一致性**：
- 三服务 `CreateAsync/ListAsync/GetAsync/DeleteAsync`（Task 3/5/6 定义，控制器调用一致）✅
- DocType/前缀：CD/TH/TC，PostableDocuments 白名单（成品调拨单/退货单/退仓单，单号列="单号"）一致 ✅
- 调拨明细写入 源仓库/目标仓库（头层 DTO 复制到每行）；FinishedGoodsAsync 双腿用 源仓库/目标仓库 列——一致 ✅
- 前端 `finishedTransferApi/finishedSalesReturnApi/finishedVendorReturnApi`（Task 8）字段与后端 DTO 对齐 ✅
- P5TestData 加 `仓库2="P5半成品仓"`，调拨测试用之；cleanup 覆盖三新明细表 ✅

**已知简化**：退货/退仓自由录入（不带出原单）、调拨不校验源仓库库存是否足够（可超调成负库存，与 P3/P5a 出库不校验一致）、加权成本延后、三层总单矩阵层延后。
