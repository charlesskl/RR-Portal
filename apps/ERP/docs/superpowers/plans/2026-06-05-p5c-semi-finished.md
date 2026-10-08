# P5c 半成品仓储（入仓 → 库存 → 领料 → 盘点）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 半成品库存「动起来」——半成品入仓（裁片/半成品入仓）→ 半成品库存（物料编号×颜色×仓库实时汇总）→ 半成品领料（领出到下道工序减库存）→ 半成品盘点（算法7 盈亏，审核后入库存）。

**Architecture:** 三个单据（半成品入仓/领料/盘点）都是两层（单头+明细，明细 `单号` 主从 FK → 单头），复用 P5a/P5b 的 Dapper 事务服务 + 控制器 + `SyncLineApprovalAsync`（审核引擎②只翻单头审核位，库存按明细审核过滤，故审核/反审核后同步明细审核位）模式。库存按**物料维度**：新增 `IInventorySummaryService.SemiFinishedAsync(仓库)`（算法1 UNION：入仓+/领料−/盘点盈亏±，按 物料编号×颜色 group；盘点数量列是 `real`，CAST 成 decimal 对齐）。前缀单号、审核留痕列（08 脚本）、成本保密均沿用前几期。前端新增「半成品仓储」菜单组。

**Tech Stack:** .NET 8 ASP.NET Core, Dapper, SQL Server LocalDB (erp/erp_test, Chinese_PRC_CI_AS), xUnit + WebApplicationFactory + Xunit.SkippableFact, React 18 + TS + Vite + Ant Design v6 + Vitest.

---

## 前置约定（所有任务通用）

- 工作目录 `D:\WebpageERP`，当前分支 `p5c-semi-finished`（已建）。`dotnet` 不在 PATH 时刷新：`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 测试环境变量：`$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")`、`$env:ERP_JWT_KEY = [Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")`；开发库 `$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")`。
- 跑测试：`dotnet test`；单类加 `--filter`。前端 `npm --prefix web run test` / `build`。
- 构建因二进制被占用失败时：`Get-Process -Name ErpApi -ErrorAction SilentlyContinue | Stop-Process -Force`。
- 提交末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。LF→CRLF 警告正常。`tmp/dbquery`：`dotnet run --project tmp/dbquery -- "<连接串>" "<SQL>"` 打印 `列=值`。
- **必读模板（照搬）**：
  - `src/ErpApi/Features/Warehouse/Finished/FinishedReceiptService.cs`+`FinishedReceiptController.cs`（两层 Dapper 事务服务 + REST + 审核 + 成本保密 + `SyncLineApprovalAsync` + UPDLOCK 删除范本；`PagedResult<T>` 来自 `ErpApi.Features.MasterData`）
  - `src/ErpApi/Features/Warehouse/Finished/FinishedStocktakeService.cs`+`FinishedStocktakeController.cs`（BasisAsync 从库存引擎快照系统数量、盈亏范本，构造注入 `IInventorySummaryService`）
  - `src/ErpApi/Features/Warehouse/Finished/FinishedInventoryController.cs`（库存查询端点范本）
  - `src/ErpApi/Engines/Inventory/InventorySummaryService.cs`+`IInventorySummaryService.cs`+`InventoryRow.cs`（`FinishedGoodsAsync` 范本；本期加 `SemiFinishedAsync`）
  - `tests/ErpApi.Tests/P5TestData.cs`、`FinishedReceiptServiceDbTests.cs`、`InventorySummaryDbTests.cs`、`P5ApiIntegrationTests.cs`、`PostingEngineDbTests.cs`
  - 前端 `web/src/api/finished.ts`、`web/src/pages/warehouse/FinishedReceiptPage.tsx`/`FinishedReceiptCreateDrawer.tsx`/`FinishedInventoryPage.tsx`、`web/src/pages/materials/MaterialInventoryPage.tsx`

### 本切片涉及表的真实结构（以 `db/01_rebuild_schema.sql` 为准，仅列本期读写列）

- `半成品入仓单`(单头)：ID bigint, **单号 nvarchar(20) UNIQUE**, 订单单号, 日期, 供应商编号, 供应商名称, 部门, 生产单号, 款号, 付款方式, 仓库, 数量 decimal, 金额 decimal, 操作员, 审核 nvarchar, 备注。**无 审核人/审核日期（Task 1 补）**。
- `半成品入仓明细单`(明细)：ID bigint, **单号 nvarchar(20)**, 日期, 仓库, 生产单号, 款号, 物料类别, 物料编号, 物料名称, 规格, 颜色, 单位, 数量 decimal(18,4), 单价 decimal(18,4), 金额, 审核, 备注。FK：**单号→半成品入仓单(主从, FK_7)**、款号→款号总表、物料编号→物料资料、生产单号→生产制单。
- `半成品领料单`(单头)：ID bigint, **单号 nvarchar(20) UNIQUE**, 日期, 供应商编号, 供应商名称, 部门, 领料人, 生产单号, 款号, 仓库, 数量 decimal, 金额 decimal, 操作员, 审核, 备注。**无 审核人/审核日期（Task 1 补）**。
- `半成品领料明细单`(明细)：ID bigint, **单号 nvarchar(20)**, 日期, 仓库, 生产单号, 款号, 物料编号, 物料名称, 规格, 颜色, 单位, 数量 decimal(18,4), 单价 decimal(18,4), 金额, 审核, 备注。FK：**单号→半成品领料单(主从, FK_19)**、款号→款号总表、物料编号→物料资料、生产单号→生产制单。
- `半成品盘点单`(单头)：ID bigint, **单号 nvarchar(20) UNIQUE**, 日期, 仓库, 部门, 操作员, 审核, 备注。**无 审核人/审核日期（Task 1 补）**。
- `半成品盘点明细单`(明细)：ID bigint, **单号 nvarchar(20)**, 日期, 仓库, 生产单号, 款号, 物料编号, 物料名称, 规格, 颜色, 单位, **系统数量 real, 盘点数量 real, 盈亏数量 real**, 单价 money, 金额 money, 审核, 备注。FK：**单号→半成品盘点单(主从, FK_11)**、款号→款号总表、物料编号→物料资料、生产单号→生产制单。
- `物料资料`(P1)：物料编号 nvarchar, 物料名称, 规格, 颜色, 单位…
- PostableDocuments 白名单**已含** `半成品入仓单`/`半成品领料单`/`半成品盘点单`（单号列="单号"）——无需改白名单。

**关键设计约束**：
1. 单号前缀：入仓 `BR`、领料 `BL`、盘点 `BP`。单头↔明细按"单号"串联且有主从 FK，插入 单头→明细、删除 明细→单头（仅未审核，删除前 `WITH (UPDLOCK, HOLDLOCK)` 锁单头）。
2. 单价手工默认 0，金额=数量×单价（服务端算），不做加权成本。
3. **审核同步明细审核位**：三个控制器 Approve/Unapprove 在 `posting.ApproveAsync/UnapproveAsync` 之后，补 `UPDATE [对应明细单] SET [审核]='1'/'0' WHERE [单号]=@单号`（因 `SemiFinishedAsync` 按明细审核过滤）。
4. 库存按 物料编号×颜色×仓库；`SemiFinishedAsync` 盘点盈亏列是 `real`，UNION 用 `CAST(盈亏数量 AS decimal(18,4))` 与入仓/领料 decimal 对齐。盘点明细的 real 数量列：服务端传 decimal（SQL 隐式转 real），GetAsync 读回时 `CAST(... AS decimal(18,4))` 避免 Dapper float→decimal 歧义。
5. 成本保密：明细 单价/金额 无"单价"权限置 null。
6. 路由 ASCII（`api/semi-receipts`、`api/semi-issues`、`api/semi-stocktakes`、`api/semi-inventory`），菜单名/表名中文。

---

## 文件结构

```
src/ErpApi/
├─ Engines/Inventory/IInventorySummaryService.cs   改:加 SemiFinishedAsync 签名
├─ Engines/Inventory/InventorySummaryService.cs    改:加 SemiFinishedAsync 实现
├─ Engines/Inventory/SemiFinishedRow.cs            新:物料编号/物料名称/规格/颜色/库存
├─ Features/Warehouse/Semi/                         新目录
│  ├─ SemiDtos.cs
│  ├─ SemiReceiptService.cs / SemiReceiptController.cs        半成品入仓
│  ├─ SemiIssueService.cs / SemiIssueController.cs            半成品领料
│  ├─ SemiStocktakeService.cs / SemiStocktakeController.cs    半成品盘点(+BasisAsync)
│  └─ SemiInventoryController.cs                              半成品库存查询
└─ Program.cs                                       改:注册三服务
db/08_p5c_additions.sql / db/run-db.ps1 / db/seed_p5c_perms.sql
web/src/api/semi.ts
web/src/pages/warehouse/{SemiReceiptPage,SemiReceiptCreateDrawer,SemiReceiptDetailDrawer,SemiIssuePage,SemiIssueCreateDrawer,SemiStocktakePage,SemiInventoryPage}.tsx
web/src/pages/MainLayout.tsx / App.tsx              改:半成品仓储菜单组+路由
tests/ErpApi.Tests/{P5cTestData,SemiReceiptServiceDbTests,SemiIssueServiceDbTests,SemiStocktakeServiceDbTests,P5cApiIntegrationTests}.cs
tests/ErpApi.Tests/{InventorySummaryDbTests,PostingEngineDbTests}.cs  改:追加
```

---

## Task 1: DB 08 脚本（审核留痕列）+ 审核引擎 DB 测试

**Files:** Create `db/08_p5c_additions.sql`; Modify `db/run-db.ps1`, `tests/ErpApi.Tests/PostingEngineDbTests.cs`

- [ ] **Step 1: 写 08 脚本** — Create `db/08_p5c_additions.sql`:

```sql
-- P5c 半成品仓储：半成品入仓单/领料单/盘点单 缺 审核人/审核日期 留痕列，补齐(供审核过账引擎②)。
-- 三张单的 单号 列已是 nvarchar(20)，无需扩宽。幂等。
SET XACT_ABORT ON;

IF COL_LENGTH(N'半成品入仓单', N'审核人') IS NULL
    ALTER TABLE [半成品入仓单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'半成品入仓单', N'审核日期') IS NULL
    ALTER TABLE [半成品入仓单] ADD [审核日期] datetime2(0) NULL;
IF COL_LENGTH(N'半成品领料单', N'审核人') IS NULL
    ALTER TABLE [半成品领料单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'半成品领料单', N'审核日期') IS NULL
    ALTER TABLE [半成品领料单] ADD [审核日期] datetime2(0) NULL;
IF COL_LENGTH(N'半成品盘点单', N'审核人') IS NULL
    ALTER TABLE [半成品盘点单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'半成品盘点单', N'审核日期') IS NULL
    ALTER TABLE [半成品盘点单] ADD [审核日期] datetime2(0) NULL;
```

- [ ] **Step 2: run-db.ps1 加载 08** — 读 `db/run-db.ps1`，在 07 那行之后按其结构追加 `(Join-Path $dir "08_p5c_additions.sql")`（与 07 同为非 lenient，保持尾部反引号续行），01–07 不变。

- [ ] **Step 3: 在开发库和测试库执行 08**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
dotnet run --project tools/DbDeploy -- "$env:ERP_DB" db/08_p5c_additions.sql
dotnet run --project tools/DbDeploy -- "$env:ERP_TEST_DB" db/08_p5c_additions.sql
```
验收：`dotnet run --project tmp/dbquery -- "$env:ERP_TEST_DB" "SELECT COL_LENGTH('半成品入仓单','审核人') a, COL_LENGTH('半成品领料单','审核人') b, COL_LENGTH('半成品盘点单','审核日期') c"`（均非 NULL）。

- [ ] **Step 4: 写审核 DB 集成测试** — 在 `tests/ErpApi.Tests/PostingEngineDbTests.cs` 类内追加（半成品入仓单 无阻碍 FK，直接种单头）：

```csharp
    [SkippableFact]
    public async Task Approve_半成品入仓单_uses_单号_column()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]='P5CBRPOST1'");
        c.Execute("INSERT INTO [半成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5CBRPOST1',N'P5c半成品仓','0')");
        var engine = new PostingEngine(Factory(), new AuditLogger());
        Assert.True(await engine.ApproveAsync("半成品入仓单", "P5CBRPOST1", "tester"));
        Assert.Equal("1", c.ExecuteScalar<string>("SELECT [审核] FROM [半成品入仓单] WHERE [单号]='P5CBRPOST1'"));
        Assert.Equal("tester", c.ExecuteScalar<string>("SELECT [审核人] FROM [半成品入仓单] WHERE [单号]='P5CBRPOST1'"));
        Assert.True(await engine.UnapproveAsync("半成品入仓单", "P5CBRPOST1", "tester"));
        c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]='P5CBRPOST1'");
    }
```

- [ ] **Step 5: 跑 DB 测试确认通过** — `dotnet test --filter "FullyQualifiedName~PostingEngineDbTests"` → PASS。

- [ ] **Step 6: 全量回归 + 提交** — `dotnet test` → 全 PASS。

```powershell
git add db/08_p5c_additions.sql db/run-db.ps1 tests/ErpApi.Tests/PostingEngineDbTests.cs
git commit -m @'
feat(P5): 08脚本(半成品入仓/领料/盘点单补审核留痕列)+审核引擎半成品用例

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 半成品库存引擎 SemiFinishedAsync + 查询端点 + P5c 测试种子

**Files:** Create `src/ErpApi/Engines/Inventory/SemiFinishedRow.cs`, `src/ErpApi/Features/Warehouse/Semi/SemiInventoryController.cs`, `tests/ErpApi.Tests/P5cTestData.cs`; Modify `src/ErpApi/Engines/Inventory/IInventorySummaryService.cs`, `src/ErpApi/Engines/Inventory/InventorySummaryService.cs`, `tests/ErpApi.Tests/InventorySummaryDbTests.cs`

- [ ] **Step 1: 写 SemiFinishedRow** — Create `src/ErpApi/Engines/Inventory/SemiFinishedRow.cs`:

```csharp
namespace ErpApi.Engines.Inventory;
public sealed class SemiFinishedRow
{
    public string 物料编号 { get; set; } = "";
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public decimal 库存 { get; set; }
}
```

- [ ] **Step 2: 写 P5c 测试种子** — Create `tests/ErpApi.Tests/P5cTestData.cs`:

```csharp
using Dapper;
using Microsoft.Data.SqlClient;

// P5c 半成品仓储测试种子：客户 P5cC01 / 款号 P5cK01 / 生产单 P5cSC01 / 物料 P5cM1(物料资料) / 仓库 P5c半成品仓。
public static class P5cTestData
{
    public const string 客户编号 = "P5cC01";
    public const string 款号 = "P5cK01";
    public const string 生产单号 = "P5cSC01";
    public const string 物料编号 = "P5cM1";
    public const string 仓库 = "P5c半成品仓";

    public static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'P5cC01',N'P5c测试客户')");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'P5cK01',N'P5c测试款式')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'P5cM1',N'P5c半成品料',N'规格A',N'件')");
        c.Execute(@"INSERT INTO [生产制单]([生产单号],[款号],[款式],[客户编号],[客户名称],[计划数量],[审核])
                    VALUES(N'P5cSC01',N'P5cK01',N'P5c测试款式',N'P5cC01',N'P5c测试客户',100,'1')");
    }

    public static void Cleanup(SqlConnection c)
    {
        foreach (var d in new[] { "半成品盘点明细单", "半成品领料明细单", "半成品入仓明细单" })
            c.Execute($"DELETE FROM [{d}] WHERE [生产单号]=N'P5cSC01'");
        foreach (var h in new[] { "半成品盘点单", "半成品领料单", "半成品入仓单" })
            c.Execute($"DELETE FROM [{h}] WHERE [仓库]=N'P5c半成品仓'");
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'P5cSC01'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'P5cM1'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'P5cK01'");
        c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'P5cC01'");
    }
}
```

- [ ] **Step 3: 写失败的库存引擎测试** — 在 `tests/ErpApi.Tests/InventorySummaryDbTests.cs` 类内追加（注意盘点明细 real 列；入仓/领料明细需 单头 master 满足主从 FK）：

```csharp
    [SkippableFact]
    public async Task SemiFinished_in_minus_issue_plus_盘点盈亏()
    {
        using var c = fx.Open();
        P5cTestData.Seed(c);
        try
        {
            c.Execute("INSERT INTO [半成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5CSRK',N'P5c半成品仓','1')");
            c.Execute(@"INSERT INTO [半成品入仓明细单]([单号],[仓库],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[数量],[审核])
                        VALUES(N'P5CSRK',N'P5c半成品仓',N'P5cSC01',N'P5cK01',N'P5cM1',N'P5c半成品料',N'规格A',N'黑色',100,'1')");
            c.Execute("INSERT INTO [半成品领料单]([单号],[仓库],[审核]) VALUES(N'P5CSLL',N'P5c半成品仓','1')");
            c.Execute(@"INSERT INTO [半成品领料明细单]([单号],[仓库],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[数量],[审核])
                        VALUES(N'P5CSLL',N'P5c半成品仓',N'P5cSC01',N'P5cK01',N'P5cM1',N'P5c半成品料',N'规格A',N'黑色',30,'1')");
            c.Execute("INSERT INTO [半成品盘点单]([单号],[仓库],[审核]) VALUES(N'P5CSPD',N'P5c半成品仓','1')");
            c.Execute(@"INSERT INTO [半成品盘点明细单]([单号],[仓库],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[系统数量],[盘点数量],[盈亏数量],[审核])
                        VALUES(N'P5CSPD',N'P5c半成品仓',N'P5cSC01',N'P5cK01',N'P5cM1',N'P5c半成品料',N'规格A',N'黑色',70,68,-2,'1')");

            var rows = await new InventorySummaryService(Factory()).SemiFinishedAsync("P5c半成品仓");
            var r = Assert.Single(rows);
            Assert.Equal("P5cM1", r.物料编号);
            Assert.Equal(68m, r.库存);   // 100 - 30 + (-2)
        }
        finally
        {
            c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]='P5CSRK'");
            c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]='P5CSRK'");
            c.Execute("DELETE FROM [半成品领料明细单] WHERE [单号]='P5CSLL'");
            c.Execute("DELETE FROM [半成品领料单] WHERE [单号]='P5CSLL'");
            c.Execute("DELETE FROM [半成品盘点明细单] WHERE [单号]='P5CSPD'");
            c.Execute("DELETE FROM [半成品盘点单] WHERE [单号]='P5CSPD'");
            P5cTestData.Cleanup(c);
        }
    }
```

- [ ] **Step 4: 跑测试确认失败** — `dotnet test --filter "FullyQualifiedName~InventorySummaryDbTests.SemiFinished"` → FAIL（SemiFinishedAsync 不存在，编译失败）。

- [ ] **Step 5: IInventorySummaryService 加签名** — 在 `src/ErpApi/Engines/Inventory/IInventorySummaryService.cs` 接口里追加（`FinishedGoodsAsync` 那行之后）：

```csharp
    Task<IReadOnlyList<SemiFinishedRow>> SemiFinishedAsync(string warehouse);
```

- [ ] **Step 6: 实现 SemiFinishedAsync** — 在 `src/ErpApi/Engines/Inventory/InventorySummaryService.cs` 类内追加常量 + 方法（与 `FinishedGoodsAsync` 同形）：

```csharp
    // 半成品口径：入仓(+)、领料(-)、盘点盈亏(±)，按 物料编号×颜色 group，仅审核'1'。盘点数量列为 real，CAST 对齐 decimal。
    private const string SemiSql = @"
SELECT 物料编号, MAX(物料名称) AS 物料名称, MAX(规格) AS 规格, 颜色, SUM(库存) AS 库存
FROM (
    SELECT 物料编号,物料名称,规格,颜色, 数量        AS 库存 FROM [半成品入仓明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL
    SELECT 物料编号,物料名称,规格,颜色, 数量*-1     AS 库存 FROM [半成品领料明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL
    SELECT 物料编号,物料名称,规格,颜色, CAST(盈亏数量 AS decimal(18,4)) AS 库存 FROM [半成品盘点明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
) t
GROUP BY 物料编号, 颜色
HAVING SUM(库存) <> 0;";

    public async Task<IReadOnlyList<SemiFinishedRow>> SemiFinishedAsync(string warehouse)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<SemiFinishedRow>(SemiSql, new { 仓 = warehouse });
        return rows.AsList();
    }
```
（`Dapper`/`AsList` 已在文件顶部 using。）

- [ ] **Step 7: 跑测试确认通过** — `dotnet test --filter "FullyQualifiedName~InventorySummaryDbTests"` → PASS（含原有 + 新半成品用例）。

- [ ] **Step 8: 写半成品库存查询控制器** — Create `src/ErpApi/Features/Warehouse/Semi/SemiInventoryController.cs`（仿 FinishedInventoryController）:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Warehouse.Semi;

// 半成品库存查询（算法1 实时聚合，物料维度）。仅看库存数量，无价格字段，只需"打开"权限。
[ApiController]
[Authorize]
[Route("api/semi-inventory")]
public sealed class SemiInventoryController(
    IInventorySummaryService inventory, IPermissionService perms) : ControllerBase
{
    private const string Menu = "半成品库存";
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List([FromQuery(Name = "仓库")] string? 仓库 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await inventory.SemiFinishedAsync(仓库 ?? "");
        return Ok(rows);
    }
}
```

- [ ] **Step 9: 全量回归 + 提交** — `dotnet test` → 全 PASS。

```powershell
git add src/ErpApi/Engines/Inventory/SemiFinishedRow.cs src/ErpApi/Engines/Inventory/IInventorySummaryService.cs src/ErpApi/Engines/Inventory/InventorySummaryService.cs src/ErpApi/Features/Warehouse/Semi/SemiInventoryController.cs tests/ErpApi.Tests/P5cTestData.cs tests/ErpApi.Tests/InventorySummaryDbTests.cs
git commit -m @'
feat(P5): 半成品库存引擎SemiFinishedAsync(物料×颜色,入+/领-/盘点盈亏±)+查询端点+P5c种子

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 半成品入仓 Service + DTO

**Files:** Create `src/ErpApi/Features/Warehouse/Semi/SemiDtos.cs`, `src/ErpApi/Features/Warehouse/Semi/SemiReceiptService.cs`; Modify `src/ErpApi/Program.cs`; Test `tests/ErpApi.Tests/SemiReceiptServiceDbTests.cs`

- [ ] **Step 1: 写 DTO（入仓/领料/盘点 全部，本任务用入仓，后续复用）** — Create `src/ErpApi/Features/Warehouse/Semi/SemiDtos.cs`:

```csharp
namespace ErpApi.Features.Warehouse.Semi;

// ---- 入仓 ----
public sealed class SemiReceiptLineDto
{ public string? 物料编号 { get; set; } public string? 物料名称 { get; set; } public string? 规格 { get; set; } public string? 颜色 { get; set; } public string? 单位 { get; set; } public decimal 数量 { get; set; } public decimal? 单价 { get; set; } }
public sealed class SemiReceiptCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 部门 { get; set; }
    public string? 备注 { get; set; }
    public List<SemiReceiptLineDto> 明细 { get; set; } = [];
}
public sealed class SemiReceiptHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SemiReceiptLineRowDto
{
    public long ID { get; set; }
    public string? 生产单号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
public sealed class SemiReceiptDetailDto
{ public SemiReceiptHeaderDto? 单头 { get; set; } public List<SemiReceiptLineRowDto> 明细 { get; set; } = []; }

// ---- 领料 ----
public sealed class SemiIssueLineDto
{ public string? 物料编号 { get; set; } public string? 物料名称 { get; set; } public string? 规格 { get; set; } public string? 颜色 { get; set; } public string? 单位 { get; set; } public decimal 数量 { get; set; } public decimal? 单价 { get; set; } }
public sealed class SemiIssueCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 部门 { get; set; }
    public string? 领料人 { get; set; }
    public string? 备注 { get; set; }
    public List<SemiIssueLineDto> 明细 { get; set; } = [];
}
public sealed class SemiIssueHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 仓库 { get; set; }
    public string? 部门 { get; set; }
    public string? 领料人 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SemiIssueLineRowDto
{
    public long ID { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
public sealed class SemiIssueDetailDto
{ public SemiIssueHeaderDto? 单头 { get; set; } public List<SemiIssueLineRowDto> 明细 { get; set; } = []; }

// ---- 盘点 ----
public sealed class SemiStocktakeBasisRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public decimal 系统数量 { get; set; }
}
public sealed class SemiStocktakeLineDto
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public decimal 系统数量 { get; set; }
    public decimal 盘点数量 { get; set; }
}
public sealed class SemiStocktakeCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 备注 { get; set; }
    public List<SemiStocktakeLineDto> 明细 { get; set; } = [];
}
public sealed class SemiStocktakeHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SemiStocktakeLineRowDto
{
    public long ID { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public decimal? 系统数量 { get; set; }
    public decimal? 盘点数量 { get; set; }
    public decimal? 盈亏数量 { get; set; }
}
public sealed class SemiStocktakeDetailDto
{ public SemiStocktakeHeaderDto? 单头 { get; set; } public List<SemiStocktakeLineRowDto> 明细 { get; set; } = []; }
```

- [ ] **Step 2: 写失败的 Service 测试** — Create `tests/ErpApi.Tests/SemiReceiptServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Warehouse.Semi;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class SemiReceiptServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private SemiReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());
    private static SemiReceiptCreateDto Dto() => new()
    {
        仓库 = P5cTestData.仓库, 生产单号 = P5cTestData.生产单号, 款号 = P5cTestData.款号,
        明细 =
        [
            new SemiReceiptLineDto { 物料编号 = P5cTestData.物料编号, 物料名称 = "P5c半成品料", 规格 = "规格A", 颜色 = "黑色", 单位 = "件", 数量 = 60, 单价 = 10 },
            new SemiReceiptLineDto { 物料编号 = P5cTestData.物料编号, 物料名称 = "P5c半成品料", 规格 = "规格A", 颜色 = "白色", 单位 = "件", 数量 = 40, 单价 = 10 },
        ]
    };

    [SkippableFact]
    public async Task Create_writes_header_and_lines_with_total()
    {
        using var c = fx.Open();
        P5cTestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("BR", 单号);
            Assert.Equal(100m, c.ExecuteScalar<decimal>("SELECT [数量] FROM [半成品入仓单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(1000m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [半成品入仓单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(2, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(600m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [半成品入仓明细单] WHERE [单号]=@n AND [数量]=60", new { n = 单号 }));
            Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [半成品入仓单] WHERE [单号]=@n", new { n = 单号 }));
        }
        finally
        {
            c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]=@n", new { n = 单号 });
            P5cTestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Create_rejects_empty_lines()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var dto = Dto(); dto.明细 = [];
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(dto, "tester"));
    }

    [SkippableFact]
    public async Task List_Get_Delete_lifecycle()
    {
        using var c = fx.Open();
        P5cTestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.Equal(1, (await Svc().ListAsync(1, 20, 单号)).Total);
            var detail = await Svc().GetAsync(单号);
            Assert.NotNull(detail);
            Assert.Equal(2, detail!.明细.Count);
            c.Execute("UPDATE [半成品入仓单] SET [审核]='1' WHERE [单号]=@n", new { n = 单号 });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
            c.Execute("UPDATE [半成品入仓单] SET [审核]='0' WHERE [单号]=@n", new { n = 单号 });
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.False(await Svc().DeleteAsync("BR不存在"));
        }
        finally
        {
            c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]=@n", new { n = 单号 });
            P5cTestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 3: 跑测试确认失败** — `dotnet test --filter "FullyQualifiedName~SemiReceiptServiceDbTests"` → FAIL（SemiReceiptService 不存在）。

- [ ] **Step 4: 实现 SemiReceiptService** — Create `src/ErpApi/Features/Warehouse/Semi/SemiReceiptService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
namespace ErpApi.Features.Warehouse.Semi;

// 半成品入仓（裁片/半成品入半成品仓）。两层：半成品入仓单 + 半成品入仓明细单(单号 主从 FK)。
// 单价手工，金额=数量×单价(服务端算)；不做加权成本。物料维度。
public sealed class SemiReceiptService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "半成品入仓单";
    public const string Prefix = "BR";

    public async Task<string> CreateAsync(SemiReceiptCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("半成品入仓至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("仓库必填");
        var now = DateTime.Now;
        var 数量 = dto.明细.Sum(l => l.数量);
        var 金额 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0m));

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [半成品入仓单]([单号],[日期],[供应商编号],[供应商名称],[部门],[生产单号],[款号],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@供应商编号,@供应商名称,@部门,@生产单号,@款号,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.供应商编号, dto.供应商名称, dto.部门, dto.生产单号, dto.款号, dto.仓库, 数量, 金额, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [半成品入仓明细单]([单号],[日期],[仓库],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[审核])
VALUES(@单号,@日期,@仓库,@生产单号,@款号,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,@单价,@金额,'0')",
                new
                {
                    单号, 日期 = now, dto.仓库, dto.生产单号, dto.款号,
                    l.物料编号, l.物料名称, l.规格, l.颜色, l.单位, l.数量, 单价 = l.单价 ?? 0m, 金额 = l.数量 * (l.单价 ?? 0m)
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<SemiReceiptHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [半成品入仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw;
SELECT [ID],[单号],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [半成品入仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<SemiReceiptHeaderDto>()).AsList();
        return new PagedResult<SemiReceiptHeaderDto>(items, total);
    }

    public async Task<SemiReceiptDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注] FROM [半成品入仓单] WHERE [单号]=@单号;
SELECT [ID],[生产单号],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额] FROM [半成品入仓明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<SemiReceiptHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<SemiReceiptLineRowDto>()).AsList();
        return new SemiReceiptDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [半成品入仓单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的半成品入仓单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [半成品入仓明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [半成品入仓单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 5: Program.cs 注册** — 在 P5a/P5b 的 Finished 服务注册附近追加：

```csharp
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiReceiptService>();
```

- [ ] **Step 6: 跑测试确认通过** — `dotnet test --filter "FullyQualifiedName~SemiReceiptServiceDbTests"` → PASS 3。

- [ ] **Step 7: 全量回归 + 提交** — `dotnet test` → 全 PASS。

```powershell
git add src/ErpApi/Features/Warehouse/Semi/SemiDtos.cs src/ErpApi/Features/Warehouse/Semi/SemiReceiptService.cs src/ErpApi/Program.cs tests/ErpApi.Tests/SemiReceiptServiceDbTests.cs
git commit -m @'
feat(P5): 半成品入仓服务(单头+明细Dapper事务,前缀BR,物料维度)+半成品DTO

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: 半成品入仓 Controller（REST + 审核同步明细 + 成本保密）

**Files:** Create `src/ErpApi/Features/Warehouse/Semi/SemiReceiptController.cs`; Test `tests/ErpApi.Tests/P5cApiIntegrationTests.cs`

- [ ] **Step 1: 写失败的 API 集成测试** — Create `tests/ErpApi.Tests/P5cApiIntegrationTests.cs`（仿 P5ApiIntegrationTests）:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using ErpApi.Infrastructure.Security;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class P5cApiIntegrationTests(DbFixture fx)
{
    private static IConfiguration JwtCfg() => new ConfigurationBuilder().AddInMemoryCollection(
        new Dictionary<string, string?>
        { ["Erp:Jwt:Issuer"] = "ErpApi", ["Erp:Jwt:Audience"] = "ErpClient", ["Erp:Jwt:ExpireMinutes"] = "60" }).Build();

    private WebApplicationFactory<Program> Factory()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Environment.SetEnvironmentVariable("ERP_DB", fx.ConnectionString);
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        return new WebApplicationFactory<Program>();
    }
    private static string Token(string user) => new JwtTokenService(JwtCfg()).Issue(user);
    private void SeedPerms(string user, string menu,
        bool open = true, bool save = false, bool del = false,
        bool price = false, bool approve = false, bool unapprove = false)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=@menu", new { user, menu });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[单价],[审核],[反审核])
                    VALUES(@user,@menu,@open,@save,@del,@price,@approve,@unapprove)",
            new { user, menu, open, save, del, price, approve, unapprove });
    }
    private HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }

    private static object ReceiptBody() => new
    {
        仓库 = P5cTestData.仓库, 生产单号 = P5cTestData.生产单号, 款号 = P5cTestData.款号,
        明细 = new[]
        {
            new { 物料编号 = P5cTestData.物料编号, 物料名称 = "P5c半成品料", 规格 = "规格A", 颜色 = "黑色", 单位 = "件", 数量 = 60, 单价 = 10 },
            new { 物料编号 = P5cTestData.物料编号, 物料名称 = "P5c半成品料", 规格 = "规格A", 颜色 = "白色", 单位 = "件", 数量 = 40, 单价 = 10 },
        }
    };

    [SkippableFact]
    public async Task Receipt_create_forbidden_without_save()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5cTestData.Seed(c); }
        SeedPerms("p5crk_v", "半成品入仓", open: true, save: false);
        var resp = await Client(app, "p5crk_v").PostAsJsonAsync("/api/semi-receipts", ReceiptBody());
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5cTestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Receipt_detail_strips_price_without_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5cTestData.Seed(c); }
        SeedPerms("p5crk_np", "半成品入仓", open: true, save: true, price: false);
        var client = Client(app, "p5crk_np");
        var create = await client.PostAsJsonAsync("/api/semi-receipts", ReceiptBody());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            var detail = await client.GetFromJsonAsync<JsonElement>($"/api/semi-receipts/{单号}");
            var line0 = detail.GetProperty("明细")[0];
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("单价").ValueKind);
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("金额").ValueKind);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]=@n", new { n = 单号 });
            P5cTestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Receipt_lifecycle_and_inventory()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5cTestData.Seed(c); }
        SeedPerms("p5crk", "半成品入仓", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p5crk", "半成品库存", open: true);
        var client = Client(app, "p5crk");
        var create = await client.PostAsJsonAsync("/api/semi-receipts", ReceiptBody());
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            Assert.Equal(1, (await client.GetFromJsonAsync<JsonElement>($"/api/semi-receipts?keyword={单号}")).GetProperty("total").GetInt32());
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/semi-receipts/{单号}/approve", null)).StatusCode);
            var inv = await client.GetFromJsonAsync<JsonElement>($"/api/semi-inventory?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5cTestData.仓库)}");
            decimal sum = 0; foreach (var r in inv.EnumerateArray()) sum += r.GetProperty("库存").GetDecimal();
            Assert.Equal(100m, sum);
            Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/semi-receipts/{单号}")).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/semi-receipts/{单号}/unapprove", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/semi-receipts/{单号}")).StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]=@n", new { n = 单号 });
            P5cTestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — `dotnet test --filter "FullyQualifiedName~P5cApiIntegrationTests"` → FAIL（/api/semi-receipts 404）。

- [ ] **Step 3: 实现 SemiReceiptController** — Create `src/ErpApi/Features/Warehouse/Semi/SemiReceiptController.cs`（含 `SyncLineApprovalAsync` 指向 `半成品入仓明细单`）:

```csharp
using System.Security.Claims;
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Warehouse.Semi;

[ApiController]
[Authorize]
[Route("api/semi-receipts")]
public sealed class SemiReceiptController(
    SemiReceiptService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "半成品入仓";
    private const string Table = "半成品入仓单";
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
        await c.ExecuteAsync("UPDATE [半成品入仓明细单] SET [审核]=@审核 WHERE [单号]=@单号", new { 单号, 审核 });
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
    public async Task<IActionResult> Create([FromBody] SemiReceiptCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "物料/生产单号/款号不存在。" }); }
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

- [ ] **Step 4: 跑测试确认通过** — `dotnet test --filter "FullyQualifiedName~P5cApiIntegrationTests"` → PASS 3。

- [ ] **Step 5: 全量回归 + 提交** — `dotnet test` → 全 PASS。

```powershell
git add src/ErpApi/Features/Warehouse/Semi/SemiReceiptController.cs tests/ErpApi.Tests/P5cApiIntegrationTests.cs
git commit -m @'
feat(P5): 半成品入仓REST接口(审核同步明细+成本保密+审计)+入仓后库存验证

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: 半成品领料 Service + Controller（领出，库存 −）

**Files:** Create `src/ErpApi/Features/Warehouse/Semi/SemiIssueService.cs`, `SemiIssueController.cs`; Modify `src/ErpApi/Program.cs`; Test `tests/ErpApi.Tests/SemiIssueServiceDbTests.cs` + 追加 `P5cApiIntegrationTests.cs`

- [ ] **Step 1: 写失败的 Service 测试** — Create `tests/ErpApi.Tests/SemiIssueServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Warehouse.Semi;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class SemiIssueServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private SemiIssueService Svc() => new(Factory(), new DocumentNumberGenerator());
    private static SemiIssueCreateDto Dto() => new()
    {
        仓库 = P5cTestData.仓库, 生产单号 = P5cTestData.生产单号, 款号 = P5cTestData.款号, 部门 = "车间一", 领料人 = "张三",
        明细 = [ new SemiIssueLineDto { 物料编号 = P5cTestData.物料编号, 物料名称 = "P5c半成品料", 规格 = "规格A", 颜色 = "黑色", 单位 = "件", 数量 = 30, 单价 = 10 } ]
    };

    [SkippableFact]
    public async Task Create_then_delete_lifecycle()
    {
        using var c = fx.Open();
        P5cTestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("BL", 单号);
            Assert.Equal(30m, c.ExecuteScalar<decimal>("SELECT [数量] FROM [半成品领料单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(300m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [半成品领料明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(1, (await Svc().ListAsync(1, 20, 单号)).Total);
            Assert.Equal(1, (await Svc().GetAsync(单号))!.明细.Count);
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.False(await Svc().DeleteAsync("BL不存在"));
        }
        finally
        {
            c.Execute("DELETE FROM [半成品领料明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [半成品领料单] WHERE [单号]=@n", new { n = 单号 });
            P5cTestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — `dotnet test --filter "FullyQualifiedName~SemiIssueServiceDbTests"` → FAIL。

- [ ] **Step 3: 实现 SemiIssueService** — Create `src/ErpApi/Features/Warehouse/Semi/SemiIssueService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
namespace ErpApi.Features.Warehouse.Semi;

// 半成品领料（领出到下道工序，库存 −）。两层：半成品领料单 + 半成品领料明细单(单号 主从 FK)。
public sealed class SemiIssueService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "半成品领料单";
    public const string Prefix = "BL";

    public async Task<string> CreateAsync(SemiIssueCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("半成品领料至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("仓库必填");
        var now = DateTime.Now;
        var 数量 = dto.明细.Sum(l => l.数量);
        var 金额 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0m));

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [半成品领料单]([单号],[日期],[部门],[领料人],[生产单号],[款号],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@部门,@领料人,@生产单号,@款号,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.部门, dto.领料人, dto.生产单号, dto.款号, dto.仓库, 数量, 金额, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [半成品领料明细单]([单号],[日期],[仓库],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[审核])
VALUES(@单号,@日期,@仓库,@生产单号,@款号,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,@单价,@金额,'0')",
                new
                {
                    单号, 日期 = now, dto.仓库, dto.生产单号, dto.款号,
                    l.物料编号, l.物料名称, l.规格, l.颜色, l.单位, l.数量, 单价 = l.单价 ?? 0m, 金额 = l.数量 * (l.单价 ?? 0m)
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<SemiIssueHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [半成品领料单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [领料人] LIKE @kw;
SELECT [ID],[单号],[仓库],[部门],[领料人],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [半成品领料单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [领料人] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<SemiIssueHeaderDto>()).AsList();
        return new PagedResult<SemiIssueHeaderDto>(items, total);
    }

    public async Task<SemiIssueDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[仓库],[部门],[领料人],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注] FROM [半成品领料单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额] FROM [半成品领料明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<SemiIssueHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<SemiIssueLineRowDto>()).AsList();
        return new SemiIssueDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [半成品领料单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的半成品领料单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [半成品领料明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [半成品领料单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 4: Program.cs 注册** — 追加 `builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiIssueService>();`

- [ ] **Step 5: 实现 SemiIssueController** — Create `src/ErpApi/Features/Warehouse/Semi/SemiIssueController.cs`（与 SemiReceiptController 同构，仅 Route `api/semi-issues`、Menu="半成品领料"、Table="半成品领料单"、svc 类型 SemiIssueService、Create DTO SemiIssueCreateDto、SyncLineApprovalAsync 表名 `半成品领料明细单`、547 文案 `"物料/生产单号/款号不存在。"`。逐字复制 Task 4 控制器并替换这些）:

```csharp
using System.Security.Claims;
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Warehouse.Semi;

[ApiController]
[Authorize]
[Route("api/semi-issues")]
public sealed class SemiIssueController(
    SemiIssueService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "半成品领料";
    private const string Table = "半成品领料单";
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
        await c.ExecuteAsync("UPDATE [半成品领料明细单] SET [审核]=@审核 WHERE [单号]=@单号", new { 单号, 审核 });
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
    public async Task<IActionResult> Create([FromBody] SemiIssueCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "物料/生产单号/款号不存在。" }); }
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

- [ ] **Step 6: 追加领料 API 测试** — 在 `tests/ErpApi.Tests/P5cApiIntegrationTests.cs` 追加（入仓100→领料30→库存70）:

```csharp
    [SkippableFact]
    public async Task Issue_lifecycle_reduces_inventory()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5cTestData.Seed(c); }
        SeedPerms("p5cll", "半成品入仓", open: true, save: true, approve: true);
        SeedPerms("p5cll", "半成品领料", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p5cll", "半成品库存", open: true);
        var client = Client(app, "p5cll");
        string? rk = null, ll = null;
        async Task<decimal> Inv() {
            var inv = await client.GetFromJsonAsync<JsonElement>($"/api/semi-inventory?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5cTestData.仓库)}");
            decimal s = 0; foreach (var r in inv.EnumerateArray()) s += r.GetProperty("库存").GetDecimal(); return s;
        }
        try
        {
            var cr = await client.PostAsJsonAsync("/api/semi-receipts", ReceiptBody());
            rk = (await cr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            await client.PostAsync($"/api/semi-receipts/{rk}/approve", null);
            var ci = await client.PostAsJsonAsync("/api/semi-issues", new {
                仓库 = P5cTestData.仓库, 生产单号 = P5cTestData.生产单号, 款号 = P5cTestData.款号, 部门 = "车间一", 领料人 = "张三",
                明细 = new[] { new { 物料编号 = P5cTestData.物料编号, 物料名称 = "P5c半成品料", 规格 = "规格A", 颜色 = "黑色", 单位 = "件", 数量 = 30, 单价 = 10 } } });
            Assert.Equal(HttpStatusCode.Created, ci.StatusCode);
            ll = (await ci.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/semi-issues/{ll}/approve", null)).StatusCode);
            Assert.Equal(70m, await Inv());  // 100 - 30
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (ll != null) { c.Execute("DELETE FROM [半成品领料明细单] WHERE [单号]=@n", new { n = ll }); c.Execute("DELETE FROM [半成品领料单] WHERE [单号]=@n", new { n = ll }); }
            if (rk != null) { c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = rk }); c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]=@n", new { n = rk }); }
            P5cTestData.Cleanup(c);
        }
    }
```

- [ ] **Step 7: 跑测试 + 全量回归 + 提交** — `dotnet test --filter "FullyQualifiedName~SemiIssueServiceDbTests"` PASS；`dotnet test --filter "FullyQualifiedName~P5cApiIntegrationTests"` PASS 4；`dotnet test` 全 PASS。

```powershell
git add src/ErpApi/Features/Warehouse/Semi/SemiIssueService.cs src/ErpApi/Features/Warehouse/Semi/SemiIssueController.cs src/ErpApi/Program.cs tests/ErpApi.Tests/SemiIssueServiceDbTests.cs tests/ErpApi.Tests/P5cApiIntegrationTests.cs
git commit -m @'
feat(P5): 半成品领料服务+REST接口(前缀BL,审核同步明细减库存)+领料后库存验证

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 6: 半成品盘点 Service + Controller（BasisAsync 快照 + 盈亏 + 全链路闭环）

**Files:** Create `src/ErpApi/Features/Warehouse/Semi/SemiStocktakeService.cs`, `SemiStocktakeController.cs`; Modify `src/ErpApi/Program.cs`; Test `tests/ErpApi.Tests/SemiStocktakeServiceDbTests.cs` + 追加 `P5cApiIntegrationTests.cs`

- [ ] **Step 1: 写失败的 Service 测试** — Create `tests/ErpApi.Tests/SemiStocktakeServiceDbTests.cs`（注意盘点明细 real 列，断言盈亏用 CAST）:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Warehouse.Semi;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class SemiStocktakeServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private SemiStocktakeService Svc() => new(Factory(), new DocumentNumberGenerator(), new InventorySummaryService(Factory()));

    [SkippableFact]
    public async Task Basis_snapshots_system_qty_then_create_computes_盈亏()
    {
        using var c = fx.Open();
        P5cTestData.Seed(c);
        // 先造库存：入仓70(单头+明细审核'1')
        c.Execute("INSERT INTO [半成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5CSBASE',N'P5c半成品仓','1')");
        c.Execute(@"INSERT INTO [半成品入仓明细单]([单号],[仓库],[生产单号],[款号],[物料编号],[物料名称],[规格],[颜色],[数量],[审核])
                    VALUES(N'P5CSBASE',N'P5c半成品仓',N'P5cSC01',N'P5cK01',N'P5cM1',N'P5c半成品料',N'规格A',N'黑色',70,'1')");
        string? pd = null;
        try
        {
            var basis = await Svc().BasisAsync(P5cTestData.仓库);
            Assert.Single(basis);
            Assert.Equal(70m, basis[0].系统数量);

            pd = await Svc().CreateAsync(new SemiStocktakeCreateDto
            {
                仓库 = P5cTestData.仓库,
                明细 = [ new SemiStocktakeLineDto {
                    物料编号 = "P5cM1", 物料名称 = "P5c半成品料", 规格 = "规格A", 颜色 = "黑色",
                    系统数量 = 70, 盘点数量 = 68 } ]
            }, "tester");
            Assert.StartsWith("BP", pd);
            Assert.Equal(-2m, c.ExecuteScalar<decimal>("SELECT CAST([盈亏数量] AS decimal(18,4)) FROM [半成品盘点明细单] WHERE [单号]=@n", new { n = pd }));

            // 审核盘点(单头+明细)后，库存 = 70 + (-2) = 68
            c.Execute("UPDATE [半成品盘点单] SET [审核]='1' WHERE [单号]=@n", new { n = pd });
            c.Execute("UPDATE [半成品盘点明细单] SET [审核]='1' WHERE [单号]=@n", new { n = pd });
            var inv = await new InventorySummaryService(Factory()).SemiFinishedAsync(P5cTestData.仓库);
            Assert.Equal(68m, inv[0].库存);
        }
        finally
        {
            if (pd != null) { c.Execute("DELETE FROM [半成品盘点明细单] WHERE [单号]=@n", new { n = pd }); c.Execute("DELETE FROM [半成品盘点单] WHERE [单号]=@n", new { n = pd }); }
            c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]='P5CSBASE'");
            c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]='P5CSBASE'");
            P5cTestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — `dotnet test --filter "FullyQualifiedName~SemiStocktakeServiceDbTests"` → FAIL。

- [ ] **Step 3: 实现 SemiStocktakeService** — Create `src/ErpApi/Features/Warehouse/Semi/SemiStocktakeService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.MasterData;
namespace ErpApi.Features.Warehouse.Semi;

// 半成品盘点（算法7 盈亏）。两层：半成品盘点单 + 半成品盘点明细单(单号 主从 FK)。
// BasisAsync 从 SemiFinishedAsync 取系统数量；盈亏=盘点−系统；审核后盈亏入库存。盘点数量列为 real，服务端传 decimal(SQL 隐式转)。
public sealed class SemiStocktakeService(
    ISqlConnectionFactory factory, IDocumentNumberGenerator docNo, IInventorySummaryService inventory)
{
    public const string DocType = "半成品盘点单";
    public const string Prefix = "BP";

    public async Task<IReadOnlyList<SemiStocktakeBasisRow>> BasisAsync(string 仓库)
    {
        var inv = await inventory.SemiFinishedAsync(仓库);
        return inv.Select(r => new SemiStocktakeBasisRow
        {
            物料编号 = r.物料编号, 物料名称 = r.物料名称, 规格 = r.规格, 颜色 = r.颜色, 系统数量 = r.库存
        }).ToList();
    }

    public async Task<string> CreateAsync(SemiStocktakeCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("半成品盘点至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("仓库必填");
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [半成品盘点单]([单号],[日期],[仓库],[操作员],[审核],[备注])
VALUES(@单号,@日期,@仓库,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.仓库, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [半成品盘点明细单]([单号],[日期],[仓库],[物料编号],[物料名称],[规格],[颜色],[系统数量],[盘点数量],[盈亏数量],[审核])
VALUES(@单号,@日期,@仓库,@物料编号,@物料名称,@规格,@颜色,@系统数量,@盘点数量,@盈亏数量,'0')",
                new
                {
                    单号, 日期 = now, dto.仓库, l.物料编号, l.物料名称, l.规格, l.颜色,
                    l.系统数量, l.盘点数量, 盈亏数量 = l.盘点数量 - l.系统数量
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<SemiStocktakeHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [半成品盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw;
SELECT [ID],[单号],[仓库],[日期],[操作员],[审核],[审核人],[备注]
FROM [半成品盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<SemiStocktakeHeaderDto>()).AsList();
        return new PagedResult<SemiStocktakeHeaderDto>(items, total);
    }

    public async Task<SemiStocktakeDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[仓库],[日期],[操作员],[审核],[审核人],[备注] FROM [半成品盘点单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[规格],[颜色],
       CAST([系统数量] AS decimal(18,4)) AS 系统数量, CAST([盘点数量] AS decimal(18,4)) AS 盘点数量, CAST([盈亏数量] AS decimal(18,4)) AS 盈亏数量
FROM [半成品盘点明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<SemiStocktakeHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<SemiStocktakeLineRowDto>()).AsList();
        return new SemiStocktakeDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [半成品盘点单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的半成品盘点单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [半成品盘点明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [半成品盘点单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 4: Program.cs 注册** — 追加 `builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiStocktakeService>();`

- [ ] **Step 5: 实现 SemiStocktakeController** — Create `src/ErpApi/Features/Warehouse/Semi/SemiStocktakeController.cs`（含 basis 端点 + 同步 `半成品盘点明细单` 审核位；盘点无价格脱敏）:

```csharp
using System.Security.Claims;
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Warehouse.Semi;

[ApiController]
[Authorize]
[Route("api/semi-stocktakes")]
public sealed class SemiStocktakeController(
    SemiStocktakeService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "半成品盘点";
    private const string Table = "半成品盘点单";
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
        await c.ExecuteAsync("UPDATE [半成品盘点明细单] SET [审核]=@审核 WHERE [单号]=@单号", new { 单号, 审核 });
    }

    [HttpGet("basis")]
    public async Task<IActionResult> Basis([FromQuery(Name = "仓库")] string 仓库)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.BasisAsync(仓库));
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
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] SemiStocktakeCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "物料不存在。" }); }
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

- [ ] **Step 6: 追加全链路 API 测试** — 在 `tests/ErpApi.Tests/P5cApiIntegrationTests.cs` 追加:

```csharp
    [SkippableFact]
    public async Task FullLoop_receipt_issue_stocktake_inventory()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5cTestData.Seed(c); }
        foreach (var m in new[] { "半成品入仓", "半成品领料", "半成品盘点" })
            SeedPerms("p5cloop", m, open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p5cloop", "半成品库存", open: true);
        var client = Client(app, "p5cloop");
        string? rk = null, ll = null, pd = null;
        async Task<decimal> Inv() {
            var inv = await client.GetFromJsonAsync<JsonElement>($"/api/semi-inventory?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5cTestData.仓库)}");
            decimal s = 0; foreach (var r in inv.EnumerateArray()) s += r.GetProperty("库存").GetDecimal(); return s;
        }
        try
        {
            var cr = await client.PostAsJsonAsync("/api/semi-receipts", ReceiptBody());
            rk = (await cr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            await client.PostAsync($"/api/semi-receipts/{rk}/approve", null);
            Assert.Equal(100m, await Inv());

            var ci = await client.PostAsJsonAsync("/api/semi-issues", new {
                仓库 = P5cTestData.仓库, 生产单号 = P5cTestData.生产单号, 款号 = P5cTestData.款号, 部门 = "车间一", 领料人 = "张三",
                明细 = new[] { new { 物料编号 = P5cTestData.物料编号, 物料名称 = "P5c半成品料", 规格 = "规格A", 颜色 = "黑色", 单位 = "件", 数量 = 30, 单价 = 10 } } });
            ll = (await ci.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            await client.PostAsync($"/api/semi-issues/{ll}/approve", null);
            Assert.Equal(70m, await Inv());

            // 盘点基准：黑色系统70；实盘68 → 盈亏-2
            var basis = await client.GetFromJsonAsync<JsonElement>($"/api/semi-stocktakes/basis?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5cTestData.仓库)}");
            decimal basisSum = 0; foreach (var b in basis.EnumerateArray()) basisSum += b.GetProperty("系统数量").GetDecimal();
            Assert.Equal(70m, basisSum);
            var cp = await client.PostAsJsonAsync("/api/semi-stocktakes", new {
                仓库 = P5cTestData.仓库,
                明细 = new[] { new { 物料编号 = P5cTestData.物料编号, 物料名称 = "P5c半成品料", 规格 = "规格A", 颜色 = "黑色", 系统数量 = 70, 盘点数量 = 68 } } });
            pd = (await cp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            await client.PostAsync($"/api/semi-stocktakes/{pd}/approve", null);
            Assert.Equal(68m, await Inv());  // 70 + (-2)
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (pd != null) { c.Execute("DELETE FROM [半成品盘点明细单] WHERE [单号]=@n", new { n = pd }); c.Execute("DELETE FROM [半成品盘点单] WHERE [单号]=@n", new { n = pd }); }
            if (ll != null) { c.Execute("DELETE FROM [半成品领料明细单] WHERE [单号]=@n", new { n = ll }); c.Execute("DELETE FROM [半成品领料单] WHERE [单号]=@n", new { n = ll }); }
            if (rk != null) { c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = rk }); c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]=@n", new { n = rk }); }
            P5cTestData.Cleanup(c);
        }
    }
```

- [ ] **Step 7: 跑测试 + 全量回归 + 提交** — `dotnet test --filter "FullyQualifiedName~SemiStocktakeServiceDbTests"` PASS；`dotnet test --filter "FullyQualifiedName~P5cApiIntegrationTests"` PASS 5；`dotnet test` 全 PASS。

```powershell
git add src/ErpApi/Features/Warehouse/Semi/SemiStocktakeService.cs src/ErpApi/Features/Warehouse/Semi/SemiStocktakeController.cs src/ErpApi/Program.cs tests/ErpApi.Tests/SemiStocktakeServiceDbTests.cs tests/ErpApi.Tests/P5cApiIntegrationTests.cs
git commit -m @'
feat(P5): 半成品盘点服务+REST(BasisAsync快照/盈亏,real CAST)+审核同步明细+入领盘全链路闭环

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 7: 权限种子 + 后端收尾回归 + 冒烟

**Files:** Create `db/seed_p5c_perms.sql`

- [ ] **Step 1: 写权限种子** — Create `db/seed_p5c_perms.sql`:

```sql
-- 开发用:给某用户授予 P5c 半成品仓储菜单权限。用法:把 @用户 改成登录名,在目标库执行。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'半成品入仓',N'半成品领料',N'半成品盘点',N'半成品库存');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'半成品入仓',1,1,1,1,1,1,1,1,1),
       (@用户,N'半成品领料',1,1,1,1,1,1,1,1,1),
       (@用户,N'半成品盘点',1,1,1,1,1,1,1,1,1),
       (@用户,N'半成品库存',1,0,0,1,0,0,0,0,1);
```

- [ ] **Step 2: 在两库执行 + 验收(各应返回 4)**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
dotnet run --project tools/DbDeploy -- "$env:ERP_DB" db/seed_p5c_perms.sql
dotnet run --project tools/DbDeploy -- "$env:ERP_TEST_DB" db/seed_p5c_perms.sql
dotnet run --project tmp/dbquery -- "$env:ERP_DB" "SELECT COUNT(*) n FROM userbqrpower WHERE 用户='admin' AND 菜单 IN (N'半成品入仓',N'半成品领料',N'半成品盘点',N'半成品库存')"
```

- [ ] **Step 3: 后端全量回归** — `dotnet test` → 全 PASS，0 跳过。

- [ ] **Step 4: API 冒烟（绕代理）** — 启后端，复用 `tmp/smoke_p4`（tmp/ gitignored）改 URL 验证 200（admin/admin123）：

```
GET /api/semi-receipts?page=1&size=5      → 200 {items,total}
GET /api/semi-issues?page=1&size=5        → 200 {items,total}
GET /api/semi-stocktakes?page=1&size=5    → 200 {items,total}
GET /api/semi-inventory?仓库=P5c半成品仓  → 200 [] (空数组)
```
冒烟后停后端。

- [ ] **Step 5: 提交**

```powershell
git add db/seed_p5c_perms.sql
git commit -m @'
feat(P5): P5c半成品仓储菜单权限种子(半成品入仓/领料/盘点/库存)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 8: 前端 — 半成品入仓页（API client + 列表 + 新建[选生产单/物料] + 详情）

**前端规范**：异步 try/catch + `message.error(err.response?.data?.消息 ?? 默认)`；函数式 setState；TS 严格、build 0 错误。

**先读**：`web/src/api/finished.ts`（client 风格）、`web/src/pages/warehouse/FinishedReceiptPage.tsx`/`FinishedReceiptCreateDrawer.tsx`/`FinishedReceiptDetailDrawer.tsx`（范本）、`web/src/api/production.ts`、`web/src/auth/permissions.ts`/`PermissionContext.tsx`。

**Files:** Create `web/src/api/semi.ts`, `web/src/pages/warehouse/SemiReceiptCreateDrawer.tsx`, `SemiReceiptDetailDrawer.tsx`, `SemiReceiptPage.tsx`

- [ ] **Step 1: 写 API client** — Create `web/src/api/semi.ts`（含 入仓/领料/盘点/库存 全部）:

```typescript
import { api } from "./client";
import type { Paged } from "./master";

// ---- 入仓 ----
export interface SRLine { 物料编号?: string; 物料名称?: string; 规格?: string; 颜色?: string; 单位?: string; 数量: number; 单价?: number }
export interface SRCreate { 仓库: string; 生产单号?: string; 款号?: string; 供应商编号?: string; 供应商名称?: string; 部门?: string; 备注?: string; 明细: SRLine[] }
export interface SRHeader { id: number; 单号?: string; 仓库?: string; 日期?: string; 数量?: number; 金额?: number | null; 审核?: string; 备注?: string }
export interface SRDetail { 单头: SRHeader | null; 明细: { id: number; 生产单号?: string; 物料编号?: string; 物料名称?: string; 规格?: string; 颜色?: string; 单位?: string; 数量?: number; 单价?: number | null; 金额?: number | null }[] }

// ---- 领料 ----
export interface SILine { 物料编号?: string; 物料名称?: string; 规格?: string; 颜色?: string; 单位?: string; 数量: number; 单价?: number }
export interface SICreate { 仓库: string; 生产单号?: string; 款号?: string; 部门?: string; 领料人?: string; 备注?: string; 明细: SILine[] }
export interface SIHeader { id: number; 单号?: string; 仓库?: string; 部门?: string; 领料人?: string; 日期?: string; 数量?: number; 金额?: number | null; 审核?: string; 备注?: string }

// ---- 盘点 ----
export interface SSBasisRow { 物料编号?: string; 物料名称?: string; 规格?: string; 颜色?: string; 系统数量: number }
export interface SSLine { 物料编号?: string; 物料名称?: string; 规格?: string; 颜色?: string; 系统数量: number; 盘点数量: number }
export interface SSCreate { 仓库: string; 备注?: string; 明细: SSLine[] }
export interface SSHeader { id: number; 单号?: string; 仓库?: string; 日期?: string; 审核?: string; 备注?: string }

// ---- 库存 ----
export interface SemiStockRow { 物料编号: string; 物料名称?: string; 规格?: string; 颜色?: string; 库存: number }

const enc = encodeURIComponent;
export const semiReceiptApi = {
  list: (page = 1, size = 20, keyword = "") => api.get<Paged<SRHeader>>("/semi-receipts", { params: { page, size, keyword } }).then(r => r.data),
  get: (单号: string) => api.get<SRDetail>(`/semi-receipts/${enc(单号)}`).then(r => r.data),
  create: (body: SRCreate) => api.post<{ 单号: string }>("/semi-receipts", body).then(r => r.data),
  remove: (单号: string) => api.delete(`/semi-receipts/${enc(单号)}`),
  approve: (单号: string) => api.post(`/semi-receipts/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/semi-receipts/${enc(单号)}/unapprove`),
};
export const semiIssueApi = {
  list: (page = 1, size = 20, keyword = "") => api.get<Paged<SIHeader>>("/semi-issues", { params: { page, size, keyword } }).then(r => r.data),
  create: (body: SICreate) => api.post<{ 单号: string }>("/semi-issues", body).then(r => r.data),
  remove: (单号: string) => api.delete(`/semi-issues/${enc(单号)}`),
  approve: (单号: string) => api.post(`/semi-issues/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/semi-issues/${enc(单号)}/unapprove`),
};
export const semiStocktakeApi = {
  basis: (仓库: string) => api.get<SSBasisRow[]>("/semi-stocktakes/basis", { params: { 仓库 } }).then(r => r.data),
  list: (page = 1, size = 20, keyword = "") => api.get<Paged<SSHeader>>("/semi-stocktakes", { params: { page, size, keyword } }).then(r => r.data),
  create: (body: SSCreate) => api.post<{ 单号: string }>("/semi-stocktakes", body).then(r => r.data),
  remove: (单号: string) => api.delete(`/semi-stocktakes/${enc(单号)}`),
  approve: (单号: string) => api.post(`/semi-stocktakes/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/semi-stocktakes/${enc(单号)}/unapprove`),
};
export const semiInventoryApi = {
  list: (仓库: string) => api.get<SemiStockRow[]>("/semi-inventory", { params: { 仓库 } }).then(r => r.data),
};
```

- [ ] **Step 2: 新建入仓抽屉** — Create `web/src/pages/warehouse/SemiReceiptCreateDrawer.tsx`（仿 FinishedReceiptCreateDrawer，明细列改 物料编号/物料名称/规格/颜色/数量/成本单价）:

```tsx
import { useEffect, useState } from "react";
import { Button, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Statistic, Table, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { productionApi, type ProductionHeader } from "../../api/production";
import { semiReceiptApi, type SRLine } from "../../api/semi";

interface Picked { 款号?: string }

export default function SemiReceiptCreateDrawer({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [form] = Form.useForm<{ 仓库: string; 生产单号?: string; 部门?: string; 备注?: string }>();
  const [orders, setOrders] = useState<ProductionHeader[]>([]);
  const [picked, setPicked] = useState<Picked>({});
  const [lines, setLines] = useState<SRLine[]>([]);
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
    try { const d = await productionApi.get(生产单号); setPicked({ 款号: d.单头?.款号 }); }
    catch { message.error("加载生产制单详情失败"); }
  };
  const setLine = (i: number, patch: Partial<SRLine>) =>
    setLines(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    let v: { 仓库: string; 生产单号?: string; 部门?: string; 备注?: string };
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => !!l.物料编号 && Number(l.数量) > 0);
    if (ok.length === 0) { message.error("请至少录入一行有物料和数量的明细"); return; }
    setSaving(true);
    try {
      await semiReceiptApi.create({ ...v, ...picked, 明细: ok });
      message.success("半成品入仓单已创建"); onClose(); onCreated();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建入仓单失败");
    } finally { setSaving(false); }
  };

  const columns = [
    { title: "物料编号", dataIndex: "物料编号", width: 130, render: (_: unknown, r: SRLine, i: number) =>
      <Input style={{ width: 116 }} value={r.物料编号 ?? ""} onChange={e => setLine(i, { 物料编号: e.target.value })} /> },
    { title: "物料名称", dataIndex: "物料名称", width: 130, render: (_: unknown, r: SRLine, i: number) =>
      <Input style={{ width: 116 }} value={r.物料名称 ?? ""} onChange={e => setLine(i, { 物料名称: e.target.value })} /> },
    { title: "规格", dataIndex: "规格", width: 100, render: (_: unknown, r: SRLine, i: number) =>
      <Input style={{ width: 88 }} value={r.规格 ?? ""} onChange={e => setLine(i, { 规格: e.target.value })} /> },
    { title: "颜色", dataIndex: "颜色", width: 90, render: (_: unknown, r: SRLine, i: number) =>
      <Input style={{ width: 80 }} value={r.颜色 ?? ""} onChange={e => setLine(i, { 颜色: e.target.value })} /> },
    { title: "数量", dataIndex: "数量", width: 100, render: (_: unknown, r: SRLine, i: number) =>
      <InputNumber min={0} precision={0} style={{ width: 88 }} value={r.数量 ?? 0} onChange={n => setLine(i, { 数量: Number(n ?? 0) })} /> },
    { title: "成本单价", dataIndex: "单价", width: 110, render: (_: unknown, r: SRLine, i: number) =>
      <InputNumber min={0} style={{ width: 96 }} value={r.单价 ?? 0} onChange={n => setLine(i, { 单价: Number(n ?? 0) })} /> },
    { title: "", key: "_op", width: 50, render: (_: unknown, __: SRLine, i: number) =>
      <a onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>删除</a> },
  ];
  const 数量合计 = lines.reduce((a, l) => a + Number(l.数量 ?? 0), 0);

  return (
    <Drawer title="新建半成品入仓单" width={960} open={open} onClose={onClose}
      extra={<Button type="primary" loading={saving} onClick={submit}>保存</Button>}>
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={8}><Form.Item name="仓库" label="仓库" rules={[{ required: true, message: "请填仓库" }]}><Input placeholder="如 半成品仓" /></Form.Item></Col>
          <Col span={8}>
            <Form.Item name="生产单号" label="生产制单">
              <Select showSearch allowClear optionFilterProp="label" onChange={onOrderChange}
                options={orders.map(o => ({ value: String(o.生产单号), label: `${o.生产单号} ${o.款式 ?? ""}` }))} />
            </Form.Item>
          </Col>
          <Col span={8}><Form.Item name="部门" label="部门"><Input /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={8}><Form.Item label="款号"><Input value={picked.款号 ?? ""} disabled /></Form.Item></Col>
          <Col span={16}><Form.Item name="备注" label="备注"><Input /></Form.Item></Col>
        </Row>
      </Form>
      <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={lines} columns={columns} />
      <Space style={{ marginTop: 12 }} size={24}>
        <Button icon={<PlusOutlined />} onClick={() => setLines(prev => [...prev, { 数量: 0 }])}>加一行</Button>
        <Statistic title="入仓数量合计" value={数量合计} />
      </Space>
    </Drawer>
  );
}
```

- [ ] **Step 3: 入仓详情抽屉** — Create `web/src/pages/warehouse/SemiReceiptDetailDrawer.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Descriptions, Drawer, Table, Tag, message } from "antd";
import { semiReceiptApi, type SRDetail } from "../../api/semi";

export default function SemiReceiptDetailDrawer({ 单号, onClose }: { 单号: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<SRDetail | null>(null);
  useEffect(() => {
    if (!单号) { setDetail(null); return; }
    (async () => { try { setDetail(await semiReceiptApi.get(单号)); } catch { message.error("加载入仓详情失败"); } })();
  }, [单号]);
  const h = detail?.单头;
  return (
    <Drawer title={`半成品入仓单 ${单号 ?? ""}`} width={820} open={!!单号} onClose={onClose}>
      {detail && (
        <>
          <Descriptions size="small" column={3} bordered style={{ marginBottom: 16 }}
            items={[
              { key: "no", label: "单号", children: h?.单号 ?? "-" },
              { key: "wh", label: "仓库", children: h?.仓库 ?? "-" },
              { key: "st", label: "状态", children: h?.审核 === "1" ? <Tag color="green">已审核</Tag> : <Tag>未审核</Tag> },
              { key: "qty", label: "入仓数量", children: String(h?.数量 ?? "-") },
              { key: "amt", label: "金额", children: h?.金额 == null ? "***" : String(h?.金额) },
              { key: "memo", label: "备注", children: h?.备注 ?? "-" },
            ]} />
          <Table size="small" rowKey="id" pagination={false} dataSource={detail.明细}
            columns={[
              { title: "物料编号", dataIndex: "物料编号" }, { title: "物料名称", dataIndex: "物料名称" },
              { title: "规格", dataIndex: "规格" }, { title: "颜色", dataIndex: "颜色" },
              { title: "数量", dataIndex: "数量" },
              { title: "单价", dataIndex: "单价", render: (v?: number | null) => (v == null ? "***" : v) },
              { title: "金额", dataIndex: "金额", render: (v?: number | null) => (v == null ? "***" : v) },
            ]} />
        </>
      )}
    </Drawer>
  );
}
```

- [ ] **Step 4: 入仓列表页** — Create `web/src/pages/warehouse/SemiReceiptPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Popconfirm, Space, Table, Tag, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { semiReceiptApi, type SRHeader } from "../../api/semi";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import SemiReceiptCreateDrawer from "./SemiReceiptCreateDrawer";
import SemiReceiptDetailDrawer from "./SemiReceiptDetailDrawer";

const MENU = "半成品入仓";

export default function SemiReceiptPage() {
  const perms = usePerms();
  const [rows, setRows] = useState<SRHeader[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await semiReceiptApi.list(page, 10, keyword); setRows(r.items); setTotal(r.total); }
    catch { message.error("加载半成品入仓单失败"); }
  }, [page, keyword]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); load(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const columns = [
    { title: "单号", dataIndex: "单号", key: "单号", render: (v: string) => <a className="erp-num" onClick={() => setViewing(v)}>{v}</a> },
    { title: "仓库", dataIndex: "仓库", key: "仓库" },
    { title: "入仓数量", dataIndex: "数量", key: "数量" },
    { title: "金额", dataIndex: "金额", key: "金额", render: (v?: number | null) => (v == null ? "***" : v) },
    { title: "日期", dataIndex: "日期", key: "日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "状态", dataIndex: "审核", key: "审核",
      render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: SRHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => semiReceiptApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => semiReceiptApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该入仓单?" onConfirm={() => act(() => semiReceiptApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title="半成品入仓" variant="borderless"
      extra={
        <Space>
          <Input.Search placeholder="搜索单号/仓库" allowClear onSearch={v => { setPage(1); setKeyword(v); }} style={{ width: 220 }} />
          {can(perms, MENU, "保存") && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建入仓单</Button>}
        </Space>
      }>
      <Table rowKey="id" size="middle" dataSource={rows} columns={columns} scroll={{ x: true }}
        pagination={{ current: page, pageSize: 10, total, onChange: setPage, showTotal: t => `共 ${t} 条` }} />
      <SemiReceiptCreateDrawer open={creating} onClose={() => setCreating(false)} onCreated={load} />
      <SemiReceiptDetailDrawer 单号={viewing} onClose={() => setViewing(null)} />
    </Card>
  );
}
```

- [ ] **Step 5: 构建 + 测试 + 提交** — `npm --prefix web run test`(PASS)；`npm --prefix web run build`(0 错误)。

```powershell
git add web/src/api/semi.ts web/src/pages/warehouse/SemiReceiptPage.tsx web/src/pages/warehouse/SemiReceiptCreateDrawer.tsx web/src/pages/warehouse/SemiReceiptDetailDrawer.tsx
git commit -m @'
feat(P5): 前端半成品入仓页(选生产单+录物料色数量成本+审核)+半成品API client

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 9: 前端 — 半成品领料页 + 半成品盘点页

**Files:** Create `web/src/pages/warehouse/SemiIssueCreateDrawer.tsx`, `SemiIssuePage.tsx`, `SemiStocktakePage.tsx`

- [ ] **Step 1: 领料新建抽屉** — Create `web/src/pages/warehouse/SemiIssueCreateDrawer.tsx`（仿入仓抽屉，去成本改单价、加 部门/领料人；提交 semiIssueApi.create）:

```tsx
import { useEffect, useState } from "react";
import { Button, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Statistic, Table, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { productionApi, type ProductionHeader } from "../../api/production";
import { semiIssueApi, type SILine } from "../../api/semi";

interface Picked { 款号?: string }

export default function SemiIssueCreateDrawer({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [form] = Form.useForm<{ 仓库: string; 生产单号?: string; 部门?: string; 领料人?: string; 备注?: string }>();
  const [orders, setOrders] = useState<ProductionHeader[]>([]);
  const [picked, setPicked] = useState<Picked>({});
  const [lines, setLines] = useState<SILine[]>([]);
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
    try { const d = await productionApi.get(生产单号); setPicked({ 款号: d.单头?.款号 }); }
    catch { message.error("加载生产制单详情失败"); }
  };
  const setLine = (i: number, patch: Partial<SILine>) =>
    setLines(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    let v: { 仓库: string; 生产单号?: string; 部门?: string; 领料人?: string; 备注?: string };
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => !!l.物料编号 && Number(l.数量) > 0);
    if (ok.length === 0) { message.error("请至少录入一行有物料和数量的明细"); return; }
    setSaving(true);
    try {
      await semiIssueApi.create({ ...v, ...picked, 明细: ok });
      message.success("半成品领料单已创建"); onClose(); onCreated();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建领料单失败");
    } finally { setSaving(false); }
  };

  const columns = [
    { title: "物料编号", dataIndex: "物料编号", width: 130, render: (_: unknown, r: SILine, i: number) =>
      <Input style={{ width: 116 }} value={r.物料编号 ?? ""} onChange={e => setLine(i, { 物料编号: e.target.value })} /> },
    { title: "物料名称", dataIndex: "物料名称", width: 130, render: (_: unknown, r: SILine, i: number) =>
      <Input style={{ width: 116 }} value={r.物料名称 ?? ""} onChange={e => setLine(i, { 物料名称: e.target.value })} /> },
    { title: "规格", dataIndex: "规格", width: 100, render: (_: unknown, r: SILine, i: number) =>
      <Input style={{ width: 88 }} value={r.规格 ?? ""} onChange={e => setLine(i, { 规格: e.target.value })} /> },
    { title: "颜色", dataIndex: "颜色", width: 90, render: (_: unknown, r: SILine, i: number) =>
      <Input style={{ width: 80 }} value={r.颜色 ?? ""} onChange={e => setLine(i, { 颜色: e.target.value })} /> },
    { title: "数量", dataIndex: "数量", width: 100, render: (_: unknown, r: SILine, i: number) =>
      <InputNumber min={0} precision={0} style={{ width: 88 }} value={r.数量 ?? 0} onChange={n => setLine(i, { 数量: Number(n ?? 0) })} /> },
    { title: "单价", dataIndex: "单价", width: 110, render: (_: unknown, r: SILine, i: number) =>
      <InputNumber min={0} style={{ width: 96 }} value={r.单价 ?? 0} onChange={n => setLine(i, { 单价: Number(n ?? 0) })} /> },
    { title: "", key: "_op", width: 50, render: (_: unknown, __: SILine, i: number) =>
      <a onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>删除</a> },
  ];
  const 数量合计 = lines.reduce((a, l) => a + Number(l.数量 ?? 0), 0);

  return (
    <Drawer title="新建半成品领料单" width={960} open={open} onClose={onClose}
      extra={<Button type="primary" loading={saving} onClick={submit}>保存</Button>}>
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={6}><Form.Item name="仓库" label="仓库" rules={[{ required: true, message: "请填仓库" }]}><Input placeholder="如 半成品仓" /></Form.Item></Col>
          <Col span={6}><Form.Item name="部门" label="领料部门"><Input /></Form.Item></Col>
          <Col span={6}><Form.Item name="领料人" label="领料人"><Input /></Form.Item></Col>
          <Col span={6}>
            <Form.Item name="生产单号" label="生产制单">
              <Select showSearch allowClear optionFilterProp="label" onChange={onOrderChange}
                options={orders.map(o => ({ value: String(o.生产单号), label: `${o.生产单号} ${o.款式 ?? ""}` }))} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={8}><Form.Item label="款号"><Input value={picked.款号 ?? ""} disabled /></Form.Item></Col>
          <Col span={16}><Form.Item name="备注" label="备注"><Input /></Form.Item></Col>
        </Row>
      </Form>
      <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={lines} columns={columns} />
      <Space style={{ marginTop: 12 }} size={24}>
        <Button icon={<PlusOutlined />} onClick={() => setLines(prev => [...prev, { 数量: 0 }])}>加一行</Button>
        <Statistic title="领料数量合计" value={数量合计} />
      </Space>
    </Drawer>
  );
}
```

- [ ] **Step 2: 领料列表页** — Create `web/src/pages/warehouse/SemiIssuePage.tsx`（仿 SemiReceiptPage，MENU="半成品领料"，api=semiIssueApi，列 仓库/部门/领料人/数量/状态/操作；单号不可点）:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Popconfirm, Space, Table, Tag, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { semiIssueApi, type SIHeader } from "../../api/semi";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import SemiIssueCreateDrawer from "./SemiIssueCreateDrawer";

const MENU = "半成品领料";

export default function SemiIssuePage() {
  const perms = usePerms();
  const [rows, setRows] = useState<SIHeader[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try { const r = await semiIssueApi.list(page, 10, keyword); setRows(r.items); setTotal(r.total); }
    catch { message.error("加载半成品领料单失败"); }
  }, [page, keyword]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); load(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const columns = [
    { title: "单号", dataIndex: "单号", key: "单号", render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "仓库", dataIndex: "仓库", key: "仓库" },
    { title: "领料部门", dataIndex: "部门", key: "部门" },
    { title: "领料人", dataIndex: "领料人", key: "领料人" },
    { title: "领料数量", dataIndex: "数量", key: "数量" },
    { title: "状态", dataIndex: "审核", key: "审核",
      render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: SIHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => semiIssueApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => semiIssueApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该领料单?" onConfirm={() => act(() => semiIssueApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title="半成品领料" variant="borderless"
      extra={
        <Space>
          <Input.Search placeholder="搜索单号/仓库/领料人" allowClear onSearch={v => { setPage(1); setKeyword(v); }} style={{ width: 240 }} />
          {can(perms, MENU, "保存") && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建领料单</Button>}
        </Space>
      }>
      <Table rowKey="id" size="middle" dataSource={rows} columns={columns} scroll={{ x: true }}
        pagination={{ current: page, pageSize: 10, total, onChange: setPage, showTotal: t => `共 ${t} 条` }} />
      <SemiIssueCreateDrawer open={creating} onClose={() => setCreating(false)} onCreated={load} />
    </Card>
  );
}
```

- [ ] **Step 3: 盘点页** — Create `web/src/pages/warehouse/SemiStocktakePage.tsx`（仿 FinishedStocktakePage，物料维度：选仓库→带出库存→录盘点数量→提交+列表+审核）:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, InputNumber, Popconfirm, Space, Table, Tag, message } from "antd";
import { semiStocktakeApi, type SSBasisRow, type SSHeader, type SSLine } from "../../api/semi";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "半成品盘点";
interface BasisRow extends SSBasisRow { 盘点数量?: number }

export default function SemiStocktakePage() {
  const perms = usePerms();
  const [仓库, set仓库] = useState("");
  const [basis, setBasis] = useState<BasisRow[]>([]);
  const [rows, setRows] = useState<SSHeader[]>([]);
  const [saving, setSaving] = useState(false);

  const loadRows = useCallback(async () => {
    try { setRows((await semiStocktakeApi.list(1, 50, 仓库)).items); }
    catch { message.error("加载盘点单失败"); }
  }, [仓库]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const loadBasis = async () => {
    if (!仓库) { message.error("请先填仓库"); return; }
    try { const b = await semiStocktakeApi.basis(仓库); setBasis(b.map(x => ({ ...x, 盘点数量: x.系统数量 }))); }
    catch { message.error("加载库存基准失败"); }
  };
  const setQty = (i: number, val: number) =>
    setBasis(prev => prev.map((b, j) => (j === i ? { ...b, 盘点数量: val } : b)));

  const submit = async () => {
    if (!仓库) { message.error("请先填仓库"); return; }
    const 明细: SSLine[] = basis.map(b => ({
      物料编号: b.物料编号, 物料名称: b.物料名称, 规格: b.规格, 颜色: b.颜色,
      系统数量: b.系统数量, 盘点数量: Number(b.盘点数量 ?? b.系统数量),
    }));
    if (明细.length === 0) { message.error("无库存可盘点"); return; }
    setSaving(true);
    try {
      await semiStocktakeApi.create({ 仓库, 明细 });
      message.success("半成品盘点单已创建"); setBasis([]); loadRows();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建盘点单失败");
    } finally { setSaving(false); }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); loadRows(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const basisColumns = [
    { title: "物料编号", dataIndex: "物料编号" }, { title: "物料名称", dataIndex: "物料名称" },
    { title: "规格", dataIndex: "规格" }, { title: "颜色", dataIndex: "颜色" },
    { title: "系统数量", dataIndex: "系统数量" },
    { title: "盘点数量", key: "盘点数量", render: (_: unknown, r: BasisRow, i: number) =>
      <InputNumber min={0} precision={0} value={r.盘点数量 ?? 0} onChange={n => setQty(i, Number(n ?? 0))} /> },
    { title: "盈亏", key: "盈亏", render: (_: unknown, r: BasisRow) => Number(r.盘点数量 ?? r.系统数量) - r.系统数量 },
  ];
  const listColumns = [
    { title: "盘点单号", dataIndex: "单号", key: "单号", render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "仓库", dataIndex: "仓库", key: "仓库" },
    { title: "日期", dataIndex: "日期", key: "日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "状态", dataIndex: "审核", key: "审核",
      render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: SSHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => semiStocktakeApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => semiStocktakeApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该盘点单?" onConfirm={() => act(() => semiStocktakeApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title="半成品盘点" variant="borderless"
      extra={
        <Space>
          <Input placeholder="仓库" value={仓库} onChange={e => set仓库(e.target.value)} style={{ width: 140 }} />
          <Button onClick={loadBasis}>带出库存</Button>
        </Space>
      }>
      {can(perms, MENU, "保存") && basis.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={basis} columns={basisColumns} />
          <Space style={{ marginTop: 12 }}>
            <Button type="primary" loading={saving} onClick={submit}>提交盘点</Button>
          </Space>
        </div>
      )}
      <Table rowKey="id" size="middle" dataSource={rows} columns={listColumns} pagination={{ pageSize: 10 }} />
    </Card>
  );
}
```

- [ ] **Step 4: 构建 + 测试 + 提交** — `npm --prefix web run test`(PASS)；`npm --prefix web run build`(0 错误)。

```powershell
git add web/src/pages/warehouse/SemiIssuePage.tsx web/src/pages/warehouse/SemiIssueCreateDrawer.tsx web/src/pages/warehouse/SemiStocktakePage.tsx
git commit -m @'
feat(P5): 前端半成品领料页+半成品盘点页(选仓库带出库存录盘点数量)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 10: 前端 — 半成品库存页 + 半成品仓储菜单组/路由

**Files:** Create `web/src/pages/warehouse/SemiInventoryPage.tsx`; Modify `web/src/App.tsx`, `web/src/pages/MainLayout.tsx`

- [ ] **Step 1: 半成品库存页** — Create `web/src/pages/warehouse/SemiInventoryPage.tsx`（仿 FinishedInventoryPage，物料维度）:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Card, Input, Table, message } from "antd";
import { semiInventoryApi, type SemiStockRow } from "../../api/semi";

export default function SemiInventoryPage() {
  const [rows, setRows] = useState<SemiStockRow[]>([]);
  const [仓库, set仓库] = useState("");

  const load = useCallback(async () => {
    if (!仓库) { setRows([]); return; }
    try { setRows(await semiInventoryApi.list(仓库)); }
    catch { message.error("加载半成品库存失败"); }
  }, [仓库]);
  useEffect(() => { load(); }, [load]);

  const columns = [
    { title: "物料编号", dataIndex: "物料编号", render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "物料名称", dataIndex: "物料名称" },
    { title: "规格", dataIndex: "规格" },
    { title: "颜色", dataIndex: "颜色" },
    { title: "库存", dataIndex: "库存",
      render: (v: number) => <span style={{ fontWeight: 600, color: v < 0 ? "#cf1322" : undefined }}>{v}</span> },
  ];

  return (
    <Card title="半成品库存" variant="borderless"
      extra={<Input.Search placeholder="输入仓库查询" allowClear onSearch={set仓库} style={{ width: 220 }} />}>
      <Table rowKey={r => `${r.物料编号}|${r.颜色}`} size="middle" dataSource={rows} columns={columns}
        pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }} />
    </Card>
  );
}
```

- [ ] **Step 2: App.tsx 加路由** — import 4 个页面（在成品 Finished* import 之后），在 `finished-vendor-returns` 路由之后加：

```tsx
import SemiReceiptPage from "./pages/warehouse/SemiReceiptPage";
import SemiIssuePage from "./pages/warehouse/SemiIssuePage";
import SemiStocktakePage from "./pages/warehouse/SemiStocktakePage";
import SemiInventoryPage from "./pages/warehouse/SemiInventoryPage";
```

```tsx
          <Route path="semi-receipts" element={<SemiReceiptPage />} />
          <Route path="semi-issues" element={<SemiIssuePage />} />
          <Route path="semi-stocktakes" element={<SemiStocktakePage />} />
          <Route path="semi-inventory" element={<SemiInventoryPage />} />
```

- [ ] **Step 3: MainLayout 加"半成品仓储"菜单组** — 修改 `web/src/pages/MainLayout.tsx`：
  (a) import 图标 `InboxOutlined`(已有)，加 `ExportOutlined`(已有)/`AuditOutlined`(已有)/`DatabaseOutlined`(已有)。半成品组复用这些图标即可（无需新增 import；若需区分可加 `DropboxOutlined`，但优先复用已有避免重复 import）。
  (b) 在成品仓储 `fgChildren` 之后新增 `sfChildren`：

```tsx
  const sfChildren = [
    ...(can(perms, "半成品入仓", "打开") ? [{ key: "/semi-receipts", label: "半成品入仓", icon: <InboxOutlined /> }] : []),
    ...(can(perms, "半成品领料", "打开") ? [{ key: "/semi-issues", label: "半成品领料", icon: <ExportOutlined /> }] : []),
    ...(can(perms, "半成品盘点", "打开") ? [{ key: "/semi-stocktakes", label: "半成品盘点", icon: <AuditOutlined /> }] : []),
    ...(can(perms, "半成品库存", "打开") ? [{ key: "/semi-inventory", label: "半成品库存", icon: <DatabaseOutlined /> }] : []),
  ];
```

  `items` 末尾追加（在成品仓储组 `fg` 之后）：

```tsx
    ...(sfChildren.length ? [{ key: "sf", label: "半成品仓储", icon: <InboxOutlined />, children: sfChildren }] : []),
```

  Header 标题链追加（在成品 `/finished-*` 分支之后，`: "基础资料"` 之前）：

```tsx
              : loc.pathname.startsWith("/semi-receipts") ? "半成品入仓"
              : loc.pathname.startsWith("/semi-issues") ? "半成品领料"
              : loc.pathname.startsWith("/semi-stocktakes") ? "半成品盘点"
              : loc.pathname.startsWith("/semi-inventory") ? "半成品库存"
```

- [ ] **Step 4: 构建 + 测试 + 提交** — `npm --prefix web run test`(PASS)；`npm --prefix web run build`(0 错误)。

```powershell
git add web/src/pages/warehouse/SemiInventoryPage.tsx web/src/App.tsx web/src/pages/MainLayout.tsx
git commit -m @'
feat(P5): 前端半成品库存页+半成品仓储菜单组/路由(入仓/领料/盘点/库存)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 11: 端到端验证（入仓 → 库存 → 领料 → 盘点 + 截图）

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

- [ ] **Step 2: 确保开发库演示前置数据** — E2E 需一个物料（物料资料）。若 erp 库无 M1，先种：

```powershell
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
Set-Content -Path tmp/seed-semi.sql -Encoding UTF8 -Value "IF NOT EXISTS(SELECT 1 FROM [物料资料] WHERE [物料编号]=N'SM1') INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'SM1',N'演示半成品',N'规格A',N'件');"
dotnet run --project tools/DbDeploy -- "$env:ERP_DB" tmp/seed-semi.sql
```
半成品仓用自由文本 `半成品仓`。

- [ ] **Step 3: 启动前后端**（停残留后台启动 ErpApi --urls http://localhost:5000、vite 5173，等 15 秒）。

- [ ] **Step 4: API 全链路 E2E（绕代理）** — 复用/改写 `tmp/smoke_p4`（tmp/ gitignored）：登录 admin/admin123 → 半成品入仓（仓库 半成品仓，物料 SM1 黑 100）→ 审核 → `GET /api/semi-inventory?仓库=半成品仓` 库存合计=100 → 领料 30 → 审核 → 库存=70 → 盘点带出基准(系统70)→实盘68→审核 → 库存=68。全 PASS 后记录单号。

- [ ] **Step 5: puppeteer 截图** — 写 `tmp/shot/p5c-e2e.cjs`（headless:'new'，1440×900，Chrome 路径双反斜杠）：登录 → 半成品仓储 → 半成品入仓列表(截图 `tmp/p5c-1-receipt.png`)→ 半成品库存(输入仓库 半成品仓 查询，截图 `tmp/p5c-2-inventory.png`)→ 半成品盘点(带出库存，截图 `tmp/p5c-3-stocktake.png`)。失败先截图。

- [ ] **Step 6: 数据库验证库存口径**

```powershell
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
dotnet run --project tmp/dbquery -- "$env:ERP_DB" "SELECT 物料编号, SUM(库存) 库存 FROM (SELECT 物料编号,数量 库存 FROM 半成品入仓明细单 WHERE 仓库='半成品仓' AND ISNULL(审核,'0')='1' UNION ALL SELECT 物料编号,数量*-1 FROM 半成品领料明细单 WHERE 仓库='半成品仓' AND ISNULL(审核,'0')='1' UNION ALL SELECT 物料编号,CAST(盈亏数量 AS decimal(18,4)) FROM 半成品盘点明细单 WHERE 仓库='半成品仓' AND ISNULL(审核,'0')='1') t GROUP BY 物料编号"
```
记录实际结果（SM1 库存 68）。

- [ ] **Step 7: 清理 + 收尾** — 停服务。删 `tmp/seed-semi.sql`。确认 `git status` 干净（tmp/ 不计）、`git log --oneline master..HEAD` 约 11 提交。汇报后由 finishing-a-development-branch 决定合并。

---

## Self-Review 结论

**Spec 覆盖**（对照 `2026-06-05-p5c-semi-finished-design.md`）：
- ✅ 半成品库存引擎 SemiFinishedAsync（物料编号×颜色，入+/领−/盘点盈亏±，real CAST decimal）：Task 2
- ✅ 半成品入仓（前缀 BR，物料维度，两层 Dapper）：Task 3（Service）+ Task 4（Controller+入仓后库存）+ Task 8（前端）
- ✅ 半成品领料（前缀 BL，库存−）：Task 5（Service+Controller）+ Task 9（前端）
- ✅ 半成品盘点（前缀 BP，BasisAsync 快照+盈亏，算法7）：Task 6（Service+Controller+全链路）+ Task 9（前端）
- ✅ 半成品库存查询（复用 SemiFinishedAsync，独立菜单）：Task 2（端点）+ Task 10（前端）
- ✅ DB 08 脚本（三单补审核留痕列）+ 审核引擎用例：Task 1
- ✅ 横切复用：单号①（BR/BL/BP）、审核②（白名单已含，08 补留痕列，控制器同步明细审核位）、库存汇总③（新增 SemiFinishedAsync）、权限审计④、成本保密
- ✅ 权限种子：Task 7；菜单组+路由：Task 10；端到端：Task 11

**关键实现注记**：①审核引擎②只翻单头审核位，库存按各明细单审核过滤 → 三控制器 Approve/Unapprove 用 `SyncLineApprovalAsync` 同步各自明细审核位。②半成品盘点明细单 系统/盘点/盈亏数量是 `real` 列：服务端写 decimal（SQL 隐式转），GetAsync/断言读回用 `CAST(... AS decimal(18,4))` 避免 Dapper float→decimal 歧义；SemiFinishedAsync 的盘点盈亏 leg 用 `CAST(盈亏数量 AS decimal(18,4))` 与入仓/领料 decimal 对齐 UNION。

**类型/签名一致性**：
- `SemiReceiptService`/`SemiIssueService`/`SemiStocktakeService`（CreateAsync/ListAsync/GetAsync/DeleteAsync，盘点加 BasisAsync）——Task 3/5/6 定义，控制器调用一致 ✅
- `SemiStocktakeService` 注入 `IInventorySummaryService`（Task 6 构造），其 `SemiFinishedAsync`（Task 2）已 DI ✅
- DocType/前缀：BR/BL/BP，PostableDocuments 白名单（半成品入仓单/领料单/盘点单，单号列="单号"）一致 ✅
- 前端 `semiReceiptApi/semiIssueApi/semiStocktakeApi/semiInventoryApi`（Task 8）字段与后端 DTO 对齐；`SemiStockRow`={物料编号,物料名称,规格,颜色,库存} 与 `SemiFinishedRow` 对齐 ✅
- 库存断言自洽：入100→库存100、领料30→70、盘点盈亏−2→68（Task 2/4/5/6 + Task 11 E2E）✅

**已知简化**：领料不校验库存是否足够（可领成负，与 P3/P5 出库一致）、加权出库成本延后、月结快照延后、按原单带出基准延后。
