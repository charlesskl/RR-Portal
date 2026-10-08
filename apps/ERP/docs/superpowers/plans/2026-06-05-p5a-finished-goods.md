# P5a 成品仓储核心（入仓 → 库存 → 出仓 → 盘点）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让成品库存「动起来」——成品入仓（从生产）→ 成品库存实时汇总（款×色码×仓库）→ 成品出仓（减库存）→ 成品盘点（算法7 盈亏，审核后计入库存）。

**Architecture:** 三个单据（成品入仓/出仓/盘点）都是两层（单头 + 明细单，明细 `单号` 主从 FK → 单头），复用 P3/M7 的 Dapper 事务服务模式，审核走引擎②（三单已在 PostableDocuments 白名单，仅需 06 脚本补 审核人/审核日期 留痕列）。库存复用已存在的 `InventorySummaryService.FinishedGoodsAsync(仓库)`（算法1 UNION 符号法），本期为它**加一段 成品盘点明细单.盈亏数量(+)** 使盘点审核后计入库存。成本保密：入仓/出仓/盘点的价格列按"单价"权限后端剥离。前端新增"成品仓储"菜单组（成品入仓/出仓/盘点/库存）。

**Tech Stack:** .NET 8 ASP.NET Core, Dapper（单据事务/库存聚合）, EF Core（无新增实体）, SQL Server LocalDB (erp/erp_test, Chinese_PRC_CI_AS), xUnit + WebApplicationFactory + Xunit.SkippableFact, React 18 + TS + Vite + Ant Design v6 + Vitest.

---

## 前置约定（所有任务通用）

- 工作目录 `D:\WebpageERP`，当前分支 `p5a-finished-goods`（已建）。Windows 用 PowerShell；`dotnet` 不在 PATH 时刷新：`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 集成测试需环境变量（shell 为空时）：`$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")`、`$env:ERP_JWT_KEY = [Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")`。开发库 `$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")`。
- 跑后端测试：仓库根 `dotnet test`；单类 `dotnet test --filter "FullyQualifiedName~FinishedReceiptServiceDbTests"`。前端：`npm --prefix web run test`、`npm --prefix web run build`。
- 若 `dotnet test`/`dotnet run` 构建因二进制被占用失败，停掉残留开发服务：`Get-Process -Name ErpApi -ErrorAction SilentlyContinue | Stop-Process -Force`。
- **本机有系统代理 127.0.0.1:7892**：PowerShell `Invoke-RestMethod` 打本地 API 会被劫持；冒烟用 `HttpClientHandler{UseProxy=false}` 的 .NET HttpClient 或 Node。浏览器自动化（puppeteer-core 在 `tmp/shot`）不受影响。`tmp/dbquery` 是通用查询工具：`dotnet run --project tmp/dbquery -- "<连接串>" "<SQL>"` 打印 `列=值` 行。
- 提交规范：commit 末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。git 报 LF→CRLF 警告正常。
- **已有可复用件（P0–P4 交付，直接 DI 注入）**：
  - `ISqlConnectionFactory.Create()` → `SqlConnection`
  - `IDocumentNumberGenerator.NextAsync(docType, prefix, bizDate, conn, tx)` → `"前缀+yyyyMMdd+3位流水"`（如 `CR20260605001`，共 13 字符）
  - `IPostingEngine.ApproveAsync(table, docNo, user)` / `UnapproveAsync(...)`（成品入仓单/成品出仓单/成品盘点单 已在白名单，单号列="单号"）
  - `IPermissionService.HasAsync(user, menu, PermissionAction)`，`PermissionAction` = 打开/保存/删除/打印/单价/金额/审核/反审核/功能
  - `IAuditLogger.WriteAsync(表名, 行为, 操作员, 记录, SqlConnection, SqlTransaction?)`
  - `PagedResult<T>(IReadOnlyList<T> Items, int Total)`（namespace `ErpApi.Features.MasterData`）
  - **库存引擎**：`IInventorySummaryService.FinishedGoodsAsync(仓库)` → `IReadOnlyList<InventoryRow>`（`InventoryRow{款号,款式,色号,颜色,尺码,库存}`，namespace `ErpApi.Engines.Inventory`），已 DI 注册
  - 测试：`DbFixture`（`[Collection("db")]`、`fx.Open()`、`fx.ConnectionString`、`fx.Available`）、`JwtTokenService.Issue(user)`
  - 前端：`api`(axios)、`Paged<T>`、`can`/`usePerms()`、`productionApi.list/get`
  - **参考实现（照搬模式）**：`src/ErpApi/Features/Production/Outsourcing/OutsourceService.cs`+`OutsourceController.cs`（两层单据 Dapper 事务+REST+审核+成本保密+UPDLOCK删除范本，M7 刚交付）；`src/ErpApi/Features/Materials/MaterialInventoryController.cs`+`web/src/pages/materials/MaterialInventoryPage.tsx`+`web/src/api/materialInventory.ts`（库存查询端点+页面范本）；`db/05_p4m7_additions.sql`（幂等 ALTER 范本）；前端 `web/src/pages/workshop/`（M6/M7 列表+抽屉+明细行表）。

### M8 本切片涉及表的真实结构（以 `db/01_rebuild_schema.sql` 为准，仅列本期读写列）

- `成品入仓单`(入仓单头)：ID int, **单号 nvarchar(20) UNIQUE**, 日期, 供应商编号, 供应商名称, 仓库, 数量 decimal, 金额 decimal, 操作员, 审核 nvarchar, 备注。**无 审核人/审核日期（Task 1 补）**。
- `成品入仓明细单`(入仓明细)：ID int, **单号 nvarchar(20)**, 日期, 仓库, 生产单号, 款号, 款式, 床号, 色号, 颜色, 尺码, 数量 decimal, 单价 decimal, 金额 decimal, 审核, 备注。FK：**单号→成品入仓单(主从)**、款号→款号总表、生产单号→生产制单。
- `成品出仓单`(出仓单头)：ID int, **单号 nvarchar(20) UNIQUE**, 订单单号, 日期, 客户编号, 客户名称, 仓库, 数量 decimal, 金额 decimal, 操作员, 审核, 备注。**无 审核人/审核日期（Task 1 补）**。
- `成品出仓明细单`(出仓明细)：ID int, **单号 nvarchar(20)**, 日期, 仓库, 生产单号, 款号, 款式, 床号, 色号, 颜色, 尺码, 数量 decimal, 成本单价 decimal, 成本金额 decimal, 单价 decimal, 金额 decimal, 审核, 备注。FK：**单号→成品出仓单(主从)**、款号→款号总表、生产单号→生产制单。
- `成品盘点单`(盘点单头)：ID int, **单号 nvarchar(20) UNIQUE**, 日期, 仓库, 金额 decimal, 操作员, 审核, 备注。**无 审核人/审核日期（Task 1 补）**。
- `成品盘点明细单`(盘点明细)：ID int, **单号 nvarchar(20)**, 日期, 仓库, 生产单号, 款号, 款式, 床号, 色号, 颜色, 尺码, 系统数量 decimal, 盘点数量 decimal, 盈亏数量 decimal, 成本单价 decimal, 成本金额 decimal, 单价 decimal, 金额 decimal, 审核, 备注。FK：**单号→成品盘点单(主从)**、款号→款号总表、生产单号→生产制单。
- `InventorySummaryService.FinishedGoodsAsync` 现 UNION：成品入仓明细单(+)/成品退货明细单(+)/成品出仓明细单(−)/成品退仓明细单(−)，按 款号×色号×颜色×尺码 group，`HAVING SUM(库存)<>0`，审核='1'。

**关键设计约束**：
1. 单号前缀：成品入仓 `CR`、成品出仓 `CC`、成品盘点 `CP`。单头↔明细按"单号"串联且有主从 FK，插入顺序 单头→明细、删除顺序 明细→单头（仅未审核，删除前用 `WITH (UPDLOCK, HOLDLOCK)` 锁单头消审核-删除竞态）。
2. 入仓/出仓单价手工录入（默认0），金额=数量×单价（服务端算）；**不做加权出库成本**（成本单价留空/手工）。
3. 盘点：`BasisAsync(仓库)` 从 `FinishedGoodsAsync(仓库)` 取系统数量；创建时 盈亏数量=盘点数量−系统数量；审核后 `成品盘点明细单.盈亏数量(+)` 进入库存（Task 2 扩展 UNION）。
4. 成本保密：入仓明细 单价/金额、出仓明细 单价/金额/成本单价/成本金额、盘点明细 单价/金额/成本单价/成本金额 无"单价"权限时后端置 null。成品库存查询只含数量，无脱敏。
5. FK：明细 款号必须存在于款号总表、生产单号必须存在于生产制单——测试种子按 FK 顺序种父行。`仓库` 列为自由文本（无 FK）。
6. 路由 ASCII（`api/finished-receipts`、`api/finished-issues`、`api/finished-stocktakes`、`api/finished-inventory`），菜单名/表名用中文。

---

## 文件结构

```
src/ErpApi/
├─ Engines/Inventory/InventorySummaryService.cs   改:FinishedGoodsAsync 加盘点盈亏 UNION 项
├─ Features/Warehouse/Finished/                    新目录
│  ├─ FinishedDtos.cs                              入仓/出仓/盘点 DTO
│  ├─ FinishedReceiptService.cs / FinishedReceiptController.cs    成品入仓
│  ├─ FinishedIssueService.cs / FinishedIssueController.cs        成品出仓
│  ├─ FinishedStocktakeService.cs / FinishedStocktakeController.cs 成品盘点(+BasisAsync)
│  └─ FinishedInventoryController.cs               成品库存查询(复用FinishedGoodsAsync)
└─ Program.cs                                      改:注册三服务

db/06_p5_additions.sql / db/run-db.ps1 / db/seed_p5_perms.sql

web/src/
├─ api/finished.ts                                 入仓/出仓/盘点/库存 API
├─ utils/finishedLines.ts                          明细合计/过滤纯函数
├─ pages/warehouse/
│  ├─ FinishedReceiptPage.tsx / FinishedReceiptCreateDrawer.tsx / FinishedReceiptDetailDrawer.tsx
│  ├─ FinishedIssuePage.tsx / FinishedIssueCreateDrawer.tsx
│  ├─ FinishedStocktakePage.tsx                    (选仓库→带出系统数量→录盘点数量)
│  └─ FinishedInventoryPage.tsx                    (选仓库→款×色码×库存)
├─ pages/MainLayout.tsx / App.tsx                  改:成品仓储菜单组+路由

tests/ErpApi.Tests/
├─ PostingEngineDbTests.cs                         改:+成品入仓单/出仓单/盘点单 审核用例
├─ P5TestData.cs                                   新:种子(客户/款号/生产单 + 成品仓)
├─ InventorySummaryDbTests.cs                      新:库存 UNION 扩展(含盘点盈亏)
├─ FinishedReceiptServiceDbTests.cs / FinishedIssueServiceDbTests.cs / FinishedStocktakeServiceDbTests.cs
└─ P5ApiIntegrationTests.cs                        新(三单 API + 库存端点 + 全链路闭环)
web/src/__tests__/finished.test.ts                 新
```

---

## Task 1: DB 06 脚本（审核留痕列）+ 审核引擎 DB 测试

成品入仓单/出仓单/盘点单 已在 PostableDocuments 白名单（单号列="单号"），但缺 审核人/审核日期 列。本任务补列并验证审核引擎能审核这三张单。

**Files:** Create `db/06_p5_additions.sql`; Modify `db/run-db.ps1`, `tests/ErpApi.Tests/PostingEngineDbTests.cs`

- [ ] **Step 1: 写 06 脚本** — Create `db/06_p5_additions.sql`:

```sql
-- P5 成品仓储：成品入仓单/出仓单/盘点单 缺 审核人/审核日期 留痕列，补齐(供审核过账引擎②)。
-- 三张单的 单号 列已是 nvarchar(20)，无需扩宽。幂等。
SET XACT_ABORT ON;

IF COL_LENGTH(N'成品入仓单', N'审核人') IS NULL
    ALTER TABLE [成品入仓单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'成品入仓单', N'审核日期') IS NULL
    ALTER TABLE [成品入仓单] ADD [审核日期] datetime2(0) NULL;
IF COL_LENGTH(N'成品出仓单', N'审核人') IS NULL
    ALTER TABLE [成品出仓单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'成品出仓单', N'审核日期') IS NULL
    ALTER TABLE [成品出仓单] ADD [审核日期] datetime2(0) NULL;
IF COL_LENGTH(N'成品盘点单', N'审核人') IS NULL
    ALTER TABLE [成品盘点单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'成品盘点单', N'审核日期') IS NULL
    ALTER TABLE [成品盘点单] ADD [审核日期] datetime2(0) NULL;
```

- [ ] **Step 2: run-db.ps1 加载 06** — 在 05 那行之后追加 06（保持现有 01–05 不变；读实际文件按其结构追加一行，与 05 同为非 lenient 脚本）：

```powershell
  (Join-Path $dir "05_p4m7_additions.sql") `
  (Join-Path $dir "06_p5_additions.sql")
```

- [ ] **Step 3: 在开发库和测试库执行 06**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
dotnet run --project tools/DbDeploy -- "$env:ERP_DB" db/06_p5_additions.sql
dotnet run --project tools/DbDeploy -- "$env:ERP_TEST_DB" db/06_p5_additions.sql
```

验收（两库都应非 NULL）：`dotnet run --project tmp/dbquery -- "$env:ERP_TEST_DB" "SELECT COL_LENGTH('成品入仓单','审核人') a, COL_LENGTH('成品出仓单','审核人') b, COL_LENGTH('成品盘点单','审核日期') c"`。

- [ ] **Step 4: 写审核 DB 集成测试** — 在 `tests/ErpApi.Tests/PostingEngineDbTests.cs` 类内追加（成品入仓单无 FK 约束阻碍，直接种单头；读文件确认已有 `Factory()` / `fx` / usings）：

```csharp
    [SkippableFact]
    public async Task Approve_成品入仓单_uses_单号_column()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [成品入仓单] WHERE [单号]='P5RKPOST1'");
        c.Execute("INSERT INTO [成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5RKPOST1',N'P5成品仓','0')");
        var engine = new PostingEngine(Factory(), new AuditLogger());
        Assert.True(await engine.ApproveAsync("成品入仓单", "P5RKPOST1", "tester"));
        Assert.Equal("1", c.ExecuteScalar<string>("SELECT [审核] FROM [成品入仓单] WHERE [单号]='P5RKPOST1'"));
        Assert.Equal("tester", c.ExecuteScalar<string>("SELECT [审核人] FROM [成品入仓单] WHERE [单号]='P5RKPOST1'"));
        Assert.True(await engine.UnapproveAsync("成品入仓单", "P5RKPOST1", "tester"));
        c.Execute("DELETE FROM [成品入仓单] WHERE [单号]='P5RKPOST1'");
    }

    [SkippableFact]
    public async Task Approve_成品盘点单_uses_单号_column()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [成品盘点单] WHERE [单号]='P5PDPOST1'");
        c.Execute("INSERT INTO [成品盘点单]([单号],[仓库],[审核]) VALUES(N'P5PDPOST1',N'P5成品仓','0')");
        var engine = new PostingEngine(Factory(), new AuditLogger());
        Assert.True(await engine.ApproveAsync("成品盘点单", "P5PDPOST1", "tester"));
        Assert.Equal("tester", c.ExecuteScalar<string>("SELECT [审核人] FROM [成品盘点单] WHERE [单号]='P5PDPOST1'"));
        Assert.True(await engine.UnapproveAsync("成品盘点单", "P5PDPOST1", "tester"));
        c.Execute("DELETE FROM [成品盘点单] WHERE [单号]='P5PDPOST1'");
    }
```

- [ ] **Step 5: 跑 DB 测试确认通过** — `dotnet test --filter "FullyQualifiedName~PostingEngineDbTests"` → PASS。

- [ ] **Step 6: 全量回归 + 提交** — `dotnet test` → 全 PASS。

```powershell
git add db/06_p5_additions.sql db/run-db.ps1 tests/ErpApi.Tests/PostingEngineDbTests.cs
git commit -m @'
feat(P5): 06脚本(成品入仓/出仓/盘点单补审核留痕列)+审核引擎成品用例

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 库存引擎扩展（盘点盈亏入库存）+ 成品库存端点 + P5 测试种子

`FinishedGoodsAsync` 加一段盘点盈亏 UNION 项；新增成品库存查询端点；建本切片共用测试种子 `P5TestData`。

**Files:** Modify `src/ErpApi/Engines/Inventory/InventorySummaryService.cs`; Create `src/ErpApi/Features/Warehouse/Finished/FinishedInventoryController.cs`, `tests/ErpApi.Tests/P5TestData.cs`, `tests/ErpApi.Tests/InventorySummaryDbTests.cs`

- [ ] **Step 1: 写 P5 测试种子** — Create `tests/ErpApi.Tests/P5TestData.cs`:

```csharp
using Dapper;
using Microsoft.Data.SqlClient;

// P5 成品仓储测试种子：客户 P5C01 / 款号 P5K01 / 生产单 P5SC01(款P5K01) / 仓库 P5成品仓。
// 成品入仓/出仓/盘点单据由各测试用返回单号精确删，此处兜底按 仓库/生产单号 删。
public static class P5TestData
{
    public const string 客户编号 = "P5C01";
    public const string 款号 = "P5K01";
    public const string 生产单号 = "P5SC01";
    public const string 仓库 = "P5成品仓";

    public static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'P5C01',N'P5测试客户')");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'P5K01',N'P5测试款式')");
        c.Execute(@"INSERT INTO [生产制单]([生产单号],[款号],[款式],[客户编号],[客户名称],[计划数量],[审核])
                    VALUES(N'P5SC01',N'P5K01',N'P5测试款式',N'P5C01',N'P5测试客户',100,'1')");
    }

    // 反 FK 顺序清理：明细(按生产单号) → 单头(按仓库) → 生产单 → 款号 → 客户
    public static void Cleanup(SqlConnection c)
    {
        foreach (var d in new[] { "成品盘点明细单", "成品出仓明细单", "成品入仓明细单" })
            c.Execute($"DELETE FROM [{d}] WHERE [生产单号]=N'P5SC01'");
        foreach (var h in new[] { "成品盘点单", "成品出仓单", "成品入仓单" })
            c.Execute($"DELETE FROM [{h}] WHERE [仓库]=N'P5成品仓'");
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'P5SC01'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'P5K01'");
        c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'P5C01'");
    }
}
```

- [ ] **Step 2: 写失败的库存扩展测试** — Create `tests/ErpApi.Tests/InventorySummaryDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.Inventory;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class InventorySummaryDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task FinishedGoods_includes_审核入仓_minus_出仓_plus_盘点盈亏()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        try
        {
            // 入仓 100(审核'1')、出仓 30(审核'1')、盘点盈亏 -2(审核'1')  → 库存 68
            c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                        VALUES(N'P5RKD',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',100,'1')");
            c.Execute(@"INSERT INTO [成品出仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                        VALUES(N'P5CKD',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',30,'1')");
            c.Execute(@"INSERT INTO [成品盘点明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[系统数量],[盘点数量],[盈亏数量],[审核])
                        VALUES(N'P5PDD',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',70,68,-2,'1')");

            var rows = await new InventorySummaryService(Factory()).FinishedGoodsAsync("P5成品仓");
            var r = Assert.Single(rows);
            Assert.Equal("P5K01", r.款号);
            Assert.Equal(68m, r.库存);
        }
        finally
        {
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]='P5RKD'");
            c.Execute("DELETE FROM [成品出仓明细单] WHERE [单号]='P5CKD'");
            c.Execute("DELETE FROM [成品盘点明细单] WHERE [单号]='P5PDD'");
            P5TestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 3: 跑测试确认失败** — `dotnet test --filter "FullyQualifiedName~InventorySummaryDbTests"` → FAIL（库存=70，盘点盈亏未计入）。

- [ ] **Step 4: 扩展 FinishedGoodsAsync** — 在 `src/ErpApi/Engines/Inventory/InventorySummaryService.cs` 的 `Sql` 常量里，`成品退仓明细单` 那段 UNION 之后、`) t` 之前追加一段（注意保持 UNION ALL 链）：

```sql
    UNION ALL
    SELECT 款号,款式,色号,颜色,尺码, 盈亏数量     AS 库存 FROM [成品盘点明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
```

并把第 8 行注释更新为：`// 成品口径：入仓(+)、退货(+客户退回)、出仓(-)、退仓(-)、盘点盈亏(±)。`

- [ ] **Step 5: 跑测试确认通过** — `dotnet test --filter "FullyQualifiedName~InventorySummaryDbTests"` → PASS。

- [ ] **Step 6: 写成品库存查询控制器** — Create `src/ErpApi/Features/Warehouse/Finished/FinishedInventoryController.cs`（仿 MaterialInventoryController；FinishedGoodsAsync 需仓库参数）:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Warehouse.Finished;

// 成品库存查询（算法1 实时聚合）。仅看库存数量，无价格字段，故只需"打开"权限。
[ApiController]
[Authorize]
[Route("api/finished-inventory")]
public sealed class FinishedInventoryController(
    IInventorySummaryService inventory, IPermissionService perms) : ControllerBase
{
    private const string Menu = "成品库存";
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List([FromQuery(Name = "仓库")] string? 仓库 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await inventory.FinishedGoodsAsync(仓库 ?? "");
        return Ok(rows);
    }
}
```

- [ ] **Step 7: 全量回归 + 提交** — `dotnet test` → 全 PASS。

```powershell
git add src/ErpApi/Engines/Inventory/InventorySummaryService.cs src/ErpApi/Features/Warehouse/Finished/FinishedInventoryController.cs tests/ErpApi.Tests/P5TestData.cs tests/ErpApi.Tests/InventorySummaryDbTests.cs
git commit -m @'
feat(P5): 库存引擎加盘点盈亏UNION项+成品库存查询端点+P5测试种子

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 成品入仓 Service + DTO

成品入仓两层（成品入仓单 + 成品入仓明细单，单号 主从 FK），Dapper 事务，前缀 `CR`。单价手工录入，金额=数量×单价（服务端算）。

**Files:** Create `src/ErpApi/Features/Warehouse/Finished/FinishedDtos.cs`, `src/ErpApi/Features/Warehouse/Finished/FinishedReceiptService.cs`; Modify `src/ErpApi/Program.cs`; Test `tests/ErpApi.Tests/FinishedReceiptServiceDbTests.cs`

- [ ] **Step 1: 写 DTO** — Create `src/ErpApi/Features/Warehouse/Finished/FinishedDtos.cs`（本文件含入仓/出仓/盘点全部 DTO；本任务只用到入仓部分，出仓/盘点 DTO 也一并写好，后续任务复用）:

```csharp
namespace ErpApi.Features.Warehouse.Finished;

// ---- 入仓 ----
public sealed class FinishedReceiptLineDto
{
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }   // 成本单价，手工，可空
}
public sealed class FinishedReceiptCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 床号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 备注 { get; set; }
    public List<FinishedReceiptLineDto> 明细 { get; set; } = [];
}
public sealed class FinishedReceiptHeaderDto
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
public sealed class FinishedReceiptLineRowDto
{
    public long ID { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
public sealed class FinishedReceiptDetailDto
{
    public FinishedReceiptHeaderDto? 单头 { get; set; }
    public List<FinishedReceiptLineRowDto> 明细 { get; set; } = [];
}

// ---- 出仓 ----
public sealed class FinishedIssueLineDto
{
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }   // 售价，手工，可空
}
public sealed class FinishedIssueCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 订单单号 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 床号 { get; set; }
    public string? 备注 { get; set; }
    public List<FinishedIssueLineDto> 明细 { get; set; } = [];
}
public sealed class FinishedIssueHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class FinishedIssueLineRowDto
{
    public long ID { get; set; }
    public string? 款号 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 成本单价 { get; set; }
    public decimal? 成本金额 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
public sealed class FinishedIssueDetailDto
{
    public FinishedIssueHeaderDto? 单头 { get; set; }
    public List<FinishedIssueLineRowDto> 明细 { get; set; } = [];
}

// ---- 盘点 ----
public sealed class FinishedStocktakeBasisRow
{
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 系统数量 { get; set; }
}
public sealed class FinishedStocktakeLineDto
{
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 系统数量 { get; set; }
    public decimal 盘点数量 { get; set; }
}
public sealed class FinishedStocktakeCreateDto
{
    public string 仓库 { get; set; } = "";
    public string? 备注 { get; set; }
    public List<FinishedStocktakeLineDto> 明细 { get; set; } = [];
}
public sealed class FinishedStocktakeHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class FinishedStocktakeLineRowDto
{
    public long ID { get; set; }
    public string? 款号 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 系统数量 { get; set; }
    public decimal? 盘点数量 { get; set; }
    public decimal? 盈亏数量 { get; set; }
}
public sealed class FinishedStocktakeDetailDto
{
    public FinishedStocktakeHeaderDto? 单头 { get; set; }
    public List<FinishedStocktakeLineRowDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 2: 写失败的 Service 测试** — Create `tests/ErpApi.Tests/FinishedReceiptServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Warehouse.Finished;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class FinishedReceiptServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private FinishedReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static FinishedReceiptCreateDto Dto() => new()
    {
        仓库 = P5TestData.仓库, 生产单号 = P5TestData.生产单号, 款号 = P5TestData.款号, 款式 = "P5测试款式", 床号 = "1",
        明细 =
        [
            new FinishedReceiptLineDto { 色号 = "01", 颜色 = "黑色", 尺码 = "M", 数量 = 60, 单价 = 10 },
            new FinishedReceiptLineDto { 色号 = "02", 颜色 = "白色", 尺码 = "L", 数量 = 40, 单价 = 10 },
        ]
    };

    [SkippableFact]
    public async Task Create_writes_header_and_lines_with_total()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("CR", 单号);
            Assert.Equal(100m, c.ExecuteScalar<decimal>("SELECT [数量] FROM [成品入仓单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(1000m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [成品入仓单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(2, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [成品入仓明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(600m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [成品入仓明细单] WHERE [单号]=@n AND [数量]=60", new { n = 单号 }));
            Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [成品入仓单] WHERE [单号]=@n", new { n = 单号 }));
        }
        finally
        {
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]=@n", new { n = 单号 });
            P5TestData.Cleanup(c);
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
        P5TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.Equal(1, (await Svc().ListAsync(1, 20, 单号)).Total);
            var detail = await Svc().GetAsync(单号);
            Assert.NotNull(detail);
            Assert.Equal(2, detail!.明细.Count);
            c.Execute("UPDATE [成品入仓单] SET [审核]='1' WHERE [单号]=@n", new { n = 单号 });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
            c.Execute("UPDATE [成品入仓单] SET [审核]='0' WHERE [单号]=@n", new { n = 单号 });
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [成品入仓明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.False(await Svc().DeleteAsync("CR不存在"));
        }
        finally
        {
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]=@n", new { n = 单号 });
            P5TestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 3: 跑测试确认失败** — `dotnet test --filter "FullyQualifiedName~FinishedReceiptServiceDbTests"` → FAIL（FinishedReceiptService 不存在）。

- [ ] **Step 4: 实现 FinishedReceiptService** — Create `src/ErpApi/Features/Warehouse/Finished/FinishedReceiptService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
namespace ErpApi.Features.Warehouse.Finished;

// 成品入仓（把生产完成的成品入成品仓）。两层：成品入仓单 + 成品入仓明细单(单号 主从 FK)。
// 单价手工录入，金额=数量×单价(服务端算)；不做加权成本。
public sealed class FinishedReceiptService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "成品入仓单";
    public const string Prefix = "CR";

    public async Task<string> CreateAsync(FinishedReceiptCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("成品入仓至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("仓库必填");
        var now = DateTime.Now;
        var 数量 = dto.明细.Sum(l => l.数量);
        var 金额 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0m));

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [成品入仓单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@供应商编号,@供应商名称,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.供应商编号, dto.供应商名称, dto.仓库, 数量, 金额, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [成品入仓明细单]([单号],[日期],[仓库],[生产单号],[款号],[款式],[床号],[色号],[颜色],[尺码],[数量],[单价],[金额],[审核])
VALUES(@单号,@日期,@仓库,@生产单号,@款号,@款式,@床号,@色号,@颜色,@尺码,@数量,@单价,@金额,'0')",
                new
                {
                    单号, 日期 = now, dto.仓库, dto.生产单号, dto.款号, dto.款式, dto.床号,
                    l.色号, l.颜色, l.尺码, l.数量, 单价 = l.单价 ?? 0m, 金额 = l.数量 * (l.单价 ?? 0m)
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<FinishedReceiptHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [成品入仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw;
SELECT [ID],[单号],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [成品入仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<FinishedReceiptHeaderDto>()).AsList();
        return new PagedResult<FinishedReceiptHeaderDto>(items, total);
    }

    public async Task<FinishedReceiptDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注] FROM [成品入仓单] WHERE [单号]=@单号;
SELECT [ID],[生产单号],[款号],[色号],[颜色],[尺码],[数量],[单价],[金额] FROM [成品入仓明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<FinishedReceiptHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<FinishedReceiptLineRowDto>()).AsList();
        return new FinishedReceiptDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [成品入仓单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的成品入仓单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [成品入仓明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [成品入仓单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 5: Program.cs 注册** — 在业务服务区（M7 的 Outsource 注册附近）追加：

```csharp
builder.Services.AddScoped<ErpApi.Features.Warehouse.Finished.FinishedReceiptService>();
```

- [ ] **Step 6: 跑测试确认通过** — `dotnet test --filter "FullyQualifiedName~FinishedReceiptServiceDbTests"` → PASS 3。

- [ ] **Step 7: 全量回归 + 提交** — `dotnet test` → 全 PASS。

```powershell
git add src/ErpApi/Features/Warehouse/Finished/FinishedDtos.cs src/ErpApi/Features/Warehouse/Finished/FinishedReceiptService.cs src/ErpApi/Program.cs tests/ErpApi.Tests/FinishedReceiptServiceDbTests.cs
git commit -m @'
feat(P5): 成品入仓服务(单头+明细Dapper事务,前缀CR,金额=数量×单价)+成品仓储DTO

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: 成品入仓 Controller（REST + 审核 + 成本保密 + 审计）

**Files:** Create `src/ErpApi/Features/Warehouse/Finished/FinishedReceiptController.cs`; Test `tests/ErpApi.Tests/P5ApiIntegrationTests.cs`

- [ ] **Step 1: 写失败的 API 集成测试** — Create `tests/ErpApi.Tests/P5ApiIntegrationTests.cs`（仿 P4M7ApiIntegrationTests；helper 与之同形）:

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
public class P5ApiIntegrationTests(DbFixture fx)
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
        仓库 = P5TestData.仓库, 生产单号 = P5TestData.生产单号, 款号 = P5TestData.款号, 款式 = "P5测试款式", 床号 = "1",
        明细 = new[]
        {
            new { 色号 = "01", 颜色 = "黑色", 尺码 = "M", 数量 = 60, 单价 = 10 },
            new { 色号 = "02", 颜色 = "白色", 尺码 = "L", 数量 = 40, 单价 = 10 },
        }
    };

    [SkippableFact]
    public async Task Receipt_create_forbidden_without_save()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5TestData.Seed(c); }
        SeedPerms("p5rkviewer", "成品入仓", open: true, save: false);
        var resp = await Client(app, "p5rkviewer").PostAsJsonAsync("/api/finished-receipts", ReceiptBody());
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Receipt_detail_strips_price_without_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5TestData.Seed(c); }
        SeedPerms("p5rknoprice", "成品入仓", open: true, save: true, price: false);
        var client = Client(app, "p5rknoprice");
        var create = await client.PostAsJsonAsync("/api/finished-receipts", ReceiptBody());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            var detail = await client.GetFromJsonAsync<JsonElement>($"/api/finished-receipts/{单号}");
            var line0 = detail.GetProperty("明细")[0];
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("单价").ValueKind);
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("金额").ValueKind);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]=@n", new { n = 单号 });
            P5TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Receipt_lifecycle_and_inventory()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5TestData.Seed(c); }
        SeedPerms("p5rk", "成品入仓", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p5rk", "成品库存", open: true);
        var client = Client(app, "p5rk");
        var create = await client.PostAsJsonAsync("/api/finished-receipts", ReceiptBody());
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            Assert.Equal(1, (await client.GetFromJsonAsync<JsonElement>($"/api/finished-receipts?keyword={单号}")).GetProperty("total").GetInt32());
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/finished-receipts/{单号}/approve", null)).StatusCode);
            // 入仓审核后，成品库存出现 60+40
            var inv = await client.GetFromJsonAsync<JsonElement>($"/api/finished-inventory?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5TestData.仓库)}");
            decimal sum = 0; foreach (var r in inv.EnumerateArray()) sum += r.GetProperty("库存").GetDecimal();
            Assert.Equal(100m, sum);
            Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/finished-receipts/{单号}")).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/finished-receipts/{单号}/unapprove", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/finished-receipts/{单号}")).StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]=@n", new { n = 单号 });
            P5TestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — `dotnet test --filter "FullyQualifiedName~P5ApiIntegrationTests"` → FAIL（/api/finished-receipts 404）。

- [ ] **Step 3: 实现 FinishedReceiptController** — Create `src/ErpApi/Features/Warehouse/Finished/FinishedReceiptController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Warehouse.Finished;

[ApiController]
[Authorize]
[Route("api/finished-receipts")]
public sealed class FinishedReceiptController(
    FinishedReceiptService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "成品入仓";
    private const string Table = "成品入仓单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create(); await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
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
    public async Task<IActionResult> Create([FromBody] FinishedReceiptCreateDto dto)
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
        return NoContent();
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        if (!await posting.UnapproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        return NoContent();
    }
}
```

- [ ] **Step 4: 跑测试确认通过** — `dotnet test --filter "FullyQualifiedName~P5ApiIntegrationTests"` → PASS 3。

- [ ] **Step 5: 全量回归 + 提交** — `dotnet test` → 全 PASS。

```powershell
git add src/ErpApi/Features/Warehouse/Finished/FinishedReceiptController.cs tests/ErpApi.Tests/P5ApiIntegrationTests.cs
git commit -m @'
feat(P5): 成品入仓REST接口(审核过账+成本保密+审计)+入仓后库存验证

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: 成品出仓 Service + Controller

成品出仓两层，前缀 `CC`，结构同入仓（单价=售价）。审核后库存减少。

**Files:** Create `src/ErpApi/Features/Warehouse/Finished/FinishedIssueService.cs`, `src/ErpApi/Features/Warehouse/Finished/FinishedIssueController.cs`; Modify `src/ErpApi/Program.cs`; Test `tests/ErpApi.Tests/FinishedIssueServiceDbTests.cs` + 追加 `P5ApiIntegrationTests.cs`

- [ ] **Step 1: 写失败的 Service 测试** — Create `tests/ErpApi.Tests/FinishedIssueServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Warehouse.Finished;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class FinishedIssueServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private FinishedIssueService Svc() => new(Factory(), new DocumentNumberGenerator());
    private static FinishedIssueCreateDto Dto() => new()
    {
        仓库 = P5TestData.仓库, 客户编号 = P5TestData.客户编号, 客户名称 = "P5测试客户",
        生产单号 = P5TestData.生产单号, 款号 = P5TestData.款号, 款式 = "P5测试款式",
        明细 = [ new FinishedIssueLineDto { 色号 = "01", 颜色 = "黑色", 尺码 = "M", 数量 = 30, 单价 = 20 } ]
    };

    [SkippableFact]
    public async Task Create_then_delete_lifecycle()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("CC", 单号);
            Assert.Equal(30m, c.ExecuteScalar<decimal>("SELECT [数量] FROM [成品出仓单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(600m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [成品出仓明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(1, (await Svc().ListAsync(1, 20, 单号)).Total);
            Assert.Equal(1, (await Svc().GetAsync(单号))!.明细.Count);
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.False(await Svc().DeleteAsync("CC不存在"));
        }
        finally
        {
            c.Execute("DELETE FROM [成品出仓明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [成品出仓单] WHERE [单号]=@n", new { n = 单号 });
            P5TestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — `dotnet test --filter "FullyQualifiedName~FinishedIssueServiceDbTests"` → FAIL。

- [ ] **Step 3: 实现 FinishedIssueService** — Create `src/ErpApi/Features/Warehouse/Finished/FinishedIssueService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
namespace ErpApi.Features.Warehouse.Finished;

// 成品出仓（出库/发货）。两层：成品出仓单 + 成品出仓明细单(单号 主从 FK)。审核后库存减少(FinishedGoodsAsync 出仓项=-数量)。
public sealed class FinishedIssueService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "成品出仓单";
    public const string Prefix = "CC";

    public async Task<string> CreateAsync(FinishedIssueCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("成品出仓至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("仓库必填");
        var now = DateTime.Now;
        var 数量 = dto.明细.Sum(l => l.数量);
        var 金额 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0m));

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [成品出仓单]([单号],[订单单号],[日期],[客户编号],[客户名称],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@订单单号,@日期,@客户编号,@客户名称,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, dto.订单单号, 日期 = now, dto.客户编号, dto.客户名称, dto.仓库, 数量, 金额, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [成品出仓明细单]([单号],[日期],[仓库],[生产单号],[款号],[款式],[床号],[色号],[颜色],[尺码],[数量],[单价],[金额],[审核])
VALUES(@单号,@日期,@仓库,@生产单号,@款号,@款式,@床号,@色号,@颜色,@尺码,@数量,@单价,@金额,'0')",
                new
                {
                    单号, 日期 = now, dto.仓库, dto.生产单号, dto.款号, dto.款式, dto.床号,
                    l.色号, l.颜色, l.尺码, l.数量, 单价 = l.单价 ?? 0m, 金额 = l.数量 * (l.单价 ?? 0m)
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<FinishedIssueHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [成品出仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [客户名称] LIKE @kw;
SELECT [ID],[单号],[订单单号],[客户名称],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [成品出仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [客户名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<FinishedIssueHeaderDto>()).AsList();
        return new PagedResult<FinishedIssueHeaderDto>(items, total);
    }

    public async Task<FinishedIssueDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[订单单号],[客户名称],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注] FROM [成品出仓单] WHERE [单号]=@单号;
SELECT [ID],[款号],[色号],[颜色],[尺码],[数量],[成本单价],[成本金额],[单价],[金额] FROM [成品出仓明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<FinishedIssueHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<FinishedIssueLineRowDto>()).AsList();
        return new FinishedIssueDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [成品出仓单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的成品出仓单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [成品出仓明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [成品出仓单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 4: Program.cs 注册** — 追加 `builder.Services.AddScoped<ErpApi.Features.Warehouse.Finished.FinishedIssueService>();`

- [ ] **Step 5: 实现 FinishedIssueController** — Create `src/ErpApi/Features/Warehouse/Finished/FinishedIssueController.cs`（与 FinishedReceiptController 同构，仅 Menu/Table/Route/DTO 不同）:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Warehouse.Finished;

[ApiController]
[Authorize]
[Route("api/finished-issues")]
public sealed class FinishedIssueController(
    FinishedIssueService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "成品出仓";
    private const string Table = "成品出仓单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create(); await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
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
            foreach (var l in d.明细) { l.单价 = null; l.金额 = null; l.成本单价 = null; l.成本金额 = null; }
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] FinishedIssueCreateDto dto)
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
        return NoContent();
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        if (!await posting.UnapproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        return NoContent();
    }
}
```

- [ ] **Step 6: 追加出仓 API 测试** — 在 `tests/ErpApi.Tests/P5ApiIntegrationTests.cs` 类内追加：

```csharp
    [SkippableFact]
    public async Task Issue_lifecycle_reduces_inventory()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5TestData.Seed(c); }
        SeedPerms("p5ck", "成品入仓", open: true, save: true, approve: true);
        SeedPerms("p5ck", "成品出仓", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p5ck", "成品库存", open: true);
        var client = Client(app, "p5ck");
        string? rk = null, ck = null;
        try
        {
            // 先入仓100并审核
            var cr = await client.PostAsJsonAsync("/api/finished-receipts", ReceiptBody());
            rk = (await cr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            await client.PostAsync($"/api/finished-receipts/{rk}/approve", null);
            // 出仓30并审核
            var ci = await client.PostAsJsonAsync("/api/finished-issues", new {
                仓库 = P5TestData.仓库, 客户编号 = P5TestData.客户编号, 客户名称 = "P5测试客户",
                生产单号 = P5TestData.生产单号, 款号 = P5TestData.款号, 款式 = "P5测试款式",
                明细 = new[] { new { 色号 = "01", 颜色 = "黑色", 尺码 = "M", 数量 = 30, 单价 = 20 } } });
            Assert.Equal(HttpStatusCode.Created, ci.StatusCode);
            ck = (await ci.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/finished-issues/{ck}/approve", null)).StatusCode);
            // 库存 = 100 - 30 = 70
            var inv = await client.GetFromJsonAsync<JsonElement>($"/api/finished-inventory?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5TestData.仓库)}");
            decimal sum = 0; foreach (var r in inv.EnumerateArray()) sum += r.GetProperty("库存").GetDecimal();
            Assert.Equal(70m, sum);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (ck != null) { c.Execute("DELETE FROM [成品出仓明细单] WHERE [单号]=@n", new { n = ck }); c.Execute("DELETE FROM [成品出仓单] WHERE [单号]=@n", new { n = ck }); }
            if (rk != null) { c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]=@n", new { n = rk }); c.Execute("DELETE FROM [成品入仓单] WHERE [单号]=@n", new { n = rk }); }
            P5TestData.Cleanup(c);
        }
    }
```

- [ ] **Step 7: 跑测试 + 全量回归 + 提交** — `dotnet test --filter "FullyQualifiedName~FinishedIssueServiceDbTests"` PASS；`dotnet test --filter "FullyQualifiedName~P5ApiIntegrationTests"` PASS 4；`dotnet test` 全 PASS。

```powershell
git add src/ErpApi/Features/Warehouse/Finished/FinishedIssueService.cs src/ErpApi/Features/Warehouse/Finished/FinishedIssueController.cs src/ErpApi/Program.cs tests/ErpApi.Tests/FinishedIssueServiceDbTests.cs tests/ErpApi.Tests/P5ApiIntegrationTests.cs
git commit -m @'
feat(P5): 成品出仓服务+REST接口(前缀CC,审核减库存)+出仓后库存验证

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 6: 成品盘点 Service + Controller（BasisAsync 快照 + 盈亏 + 全链路闭环）

盘点两层，前缀 `CP`。`BasisAsync(仓库)` 从 `FinishedGoodsAsync` 取系统数量；创建时 盈亏=盘点−系统；审核后盈亏入库存（Task 2 已扩展）。

**Files:** Create `src/ErpApi/Features/Warehouse/Finished/FinishedStocktakeService.cs`, `src/ErpApi/Features/Warehouse/Finished/FinishedStocktakeController.cs`; Modify `src/ErpApi/Program.cs`; Test `tests/ErpApi.Tests/FinishedStocktakeServiceDbTests.cs` + 追加 `P5ApiIntegrationTests.cs`

- [ ] **Step 1: 写失败的 Service 测试** — Create `tests/ErpApi.Tests/FinishedStocktakeServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Warehouse.Finished;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class FinishedStocktakeServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private FinishedStocktakeService Svc() => new(Factory(), new DocumentNumberGenerator(), new InventorySummaryService(Factory()));

    [SkippableFact]
    public async Task Basis_snapshots_system_qty_then_create_computes_盈亏()
    {
        using var c = fx.Open();
        P5TestData.Seed(c);
        // 先造库存：入仓70(审核'1')
        c.Execute(@"INSERT INTO [成品入仓明细单]([单号],[仓库],[生产单号],[款号],[款式],[色号],[颜色],[尺码],[数量],[审核])
                    VALUES(N'P5RKBASE',N'P5成品仓',N'P5SC01',N'P5K01',N'P5测试款式',N'01',N'黑色',N'M',70,'1')");
        c.Execute("INSERT INTO [成品入仓单]([单号],[仓库],[审核]) VALUES(N'P5RKBASE',N'P5成品仓','1')");
        string? pd = null;
        try
        {
            var basis = await Svc().BasisAsync(P5TestData.仓库);
            Assert.Single(basis);
            Assert.Equal(70m, basis[0].系统数量);

            pd = await Svc().CreateAsync(new FinishedStocktakeCreateDto
            {
                仓库 = P5TestData.仓库,
                明细 = [ new FinishedStocktakeLineDto {
                    款号 = "P5K01", 款式 = "P5测试款式", 色号 = "01", 颜色 = "黑色", 尺码 = "M",
                    系统数量 = 70, 盘点数量 = 68 } ]
            }, "tester");
            Assert.StartsWith("CP", pd);
            // 盈亏 = 68 - 70 = -2
            Assert.Equal(-2m, c.ExecuteScalar<decimal>("SELECT [盈亏数量] FROM [成品盘点明细单] WHERE [单号]=@n", new { n = pd }));

            // 审核盘点后，库存 = 70 + (-2) = 68
            c.Execute("UPDATE [成品盘点单] SET [审核]='1' WHERE [单号]=@n", new { n = pd });
            c.Execute("UPDATE [成品盘点明细单] SET [审核]='1' WHERE [单号]=@n", new { n = pd });
            var inv = await new InventorySummaryService(Factory()).FinishedGoodsAsync(P5TestData.仓库);
            Assert.Equal(68m, inv[0].库存);
        }
        finally
        {
            if (pd != null) { c.Execute("DELETE FROM [成品盘点明细单] WHERE [单号]=@n", new { n = pd }); c.Execute("DELETE FROM [成品盘点单] WHERE [单号]=@n", new { n = pd }); }
            c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]='P5RKBASE'");
            c.Execute("DELETE FROM [成品入仓单] WHERE [单号]='P5RKBASE'");
            P5TestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — `dotnet test --filter "FullyQualifiedName~FinishedStocktakeServiceDbTests"` → FAIL。

- [ ] **Step 3: 实现 FinishedStocktakeService** — Create `src/ErpApi/Features/Warehouse/Finished/FinishedStocktakeService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.MasterData;
namespace ErpApi.Features.Warehouse.Finished;

// 成品盘点（算法7 盈亏）。两层：成品盘点单 + 成品盘点明细单(单号 主从 FK)。
// BasisAsync 从 FinishedGoodsAsync 取系统数量；创建时 盈亏=盘点−系统；审核后盈亏入库存(已扩展 UNION)。
public sealed class FinishedStocktakeService(
    ISqlConnectionFactory factory, IDocumentNumberGenerator docNo, IInventorySummaryService inventory)
{
    public const string DocType = "成品盘点单";
    public const string Prefix = "CP";

    // 带出基准：当前库存作为每 (款,色号,颜色,尺码) 的系统数量
    public async Task<IReadOnlyList<FinishedStocktakeBasisRow>> BasisAsync(string 仓库)
    {
        var inv = await inventory.FinishedGoodsAsync(仓库);
        return inv.Select(r => new FinishedStocktakeBasisRow
        {
            款号 = r.款号, 款式 = r.款式, 色号 = r.色号, 颜色 = r.颜色, 尺码 = r.尺码, 系统数量 = r.库存
        }).ToList();
    }

    public async Task<string> CreateAsync(FinishedStocktakeCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("成品盘点至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("仓库必填");
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [成品盘点单]([单号],[日期],[仓库],[操作员],[审核],[备注])
VALUES(@单号,@日期,@仓库,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.仓库, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [成品盘点明细单]([单号],[日期],[仓库],[款号],[款式],[色号],[颜色],[尺码],[系统数量],[盘点数量],[盈亏数量],[审核])
VALUES(@单号,@日期,@仓库,@款号,@款式,@色号,@颜色,@尺码,@系统数量,@盘点数量,@盈亏数量,'0')",
                new
                {
                    单号, 日期 = now, dto.仓库, l.款号, l.款式, l.色号, l.颜色, l.尺码,
                    l.系统数量, l.盘点数量, 盈亏数量 = l.盘点数量 - l.系统数量
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<FinishedStocktakeHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [成品盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw;
SELECT [ID],[单号],[仓库],[日期],[金额],[操作员],[审核],[审核人],[备注]
FROM [成品盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<FinishedStocktakeHeaderDto>()).AsList();
        return new PagedResult<FinishedStocktakeHeaderDto>(items, total);
    }

    public async Task<FinishedStocktakeDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[仓库],[日期],[金额],[操作员],[审核],[审核人],[备注] FROM [成品盘点单] WHERE [单号]=@单号;
SELECT [ID],[款号],[色号],[颜色],[尺码],[系统数量],[盘点数量],[盈亏数量] FROM [成品盘点明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<FinishedStocktakeHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<FinishedStocktakeLineRowDto>()).AsList();
        return new FinishedStocktakeDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [成品盘点单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的成品盘点单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [成品盘点明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [成品盘点单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 4: Program.cs 注册** — 追加 `builder.Services.AddScoped<ErpApi.Features.Warehouse.Finished.FinishedStocktakeService>();`

- [ ] **Step 5: 实现 FinishedStocktakeController** — Create `src/ErpApi/Features/Warehouse/Finished/FinishedStocktakeController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Warehouse.Finished;

[ApiController]
[Authorize]
[Route("api/finished-stocktakes")]
public sealed class FinishedStocktakeController(
    FinishedStocktakeService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "成品盘点";
    private const string Table = "成品盘点单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create(); await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
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
    public async Task<IActionResult> Create([FromBody] FinishedStocktakeCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "款号不存在。" }); }
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
        return NoContent();
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        if (!await posting.UnapproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        return NoContent();
    }
}
```

注：盘点明细审核位需随单头审核翻转才能进库存 UNION。本期审核引擎只翻转单头 `成品盘点单.审核`，而 FinishedGoodsAsync 过滤的是 `成品盘点明细单.审核`。**为保证盘点审核后盈亏入库存**，盘点的审核须同时翻转明细审核位——在 Approve/Unapprove 端点里，调用 posting 之后补一条 UPDATE 把 `成品盘点明细单.审核` 同步为单头审核值。修改 Approve/Unapprove 如下（替换上面 Approve/Unapprove 两个方法体）：

```csharp
    [HttpPost("{单号}/approve")]
    public async Task<IActionResult> Approve(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        if (!await posting.ApproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        using (var c = factory.Create()) { await c.OpenAsync();
            await c.ExecuteAsync("UPDATE [成品盘点明细单] SET [审核]='1' WHERE [单号]=@单号", new { 单号 }); }
        return NoContent();
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        if (!await posting.UnapproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        using (var c = factory.Create()) { await c.OpenAsync();
            await c.ExecuteAsync("UPDATE [成品盘点明细单] SET [审核]='0' WHERE [单号]=@单号", new { 单号 }); }
        return NoContent();
    }
```

（需 `using Dapper;` 顶部加入。其它单据[入仓/出仓]的明细审核位本期不参与 FinishedGoodsAsync 过滤吗？——会：FinishedGoodsAsync 过滤的是各明细单的 `审核`。所以入仓/出仓也需同样同步明细审核位。**在 FinishedReceiptController 和 FinishedIssueController 的 Approve/Unapprove 里同样补 UPDATE 明细审核位**——这是 Task 4/5 的修正，见下方 Step 6。）

- [ ] **Step 6: 修正 入仓/出仓 控制器审核同步明细审核位** — 这是让 Task 4/5 的库存断言成立的关键。修改 `FinishedReceiptController` 的 Approve/Unapprove：approve 后 `UPDATE [成品入仓明细单] SET [审核]='1' WHERE [单号]=@单号`；unapprove 后置 '0'。同理 `FinishedIssueController` 改 `成品出仓明细单`。两个控制器顶部加 `using Dapper;`。模式与上面盘点 Approve/Unapprove 完全一致（仅明细表名不同）。

> **重要**：Task 4 的 `Receipt_lifecycle_and_inventory` 与 Task 5 的 `Issue_lifecycle_reduces_inventory` 断言「审核后库存变化」，依赖明细审核位被同步。若按原始 Task 4/5 控制器（未同步明细审核位），这两个库存断言会失败。执行 Task 4/5 时**就应包含这条明细审核位同步**（即 Task 4/5 的 Approve/Unapprove 从一开始就带 `UPDATE 明细 SET 审核` 同步）。本 Step 6 是兜底说明：确认三个控制器的 Approve/Unapprove 都同步了各自明细表的审核位。

- [ ] **Step 7: 追加盘点全链路 API 测试** — 在 `tests/ErpApi.Tests/P5ApiIntegrationTests.cs` 追加：

```csharp
    [SkippableFact]
    public async Task FullLoop_receipt_issue_stocktake_inventory()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P5TestData.Seed(c); }
        foreach (var m in new[] { "成品入仓", "成品出仓", "成品盘点" })
            SeedPerms("p5loop", m, open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p5loop", "成品库存", open: true);
        var client = Client(app, "p5loop");
        string? rk = null, ck = null, pd = null;
        async Task<decimal> Inv() {
            var inv = await client.GetFromJsonAsync<JsonElement>($"/api/finished-inventory?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5TestData.仓库)}");
            decimal s = 0; foreach (var r in inv.EnumerateArray()) s += r.GetProperty("库存").GetDecimal(); return s;
        }
        try
        {
            var cr = await client.PostAsJsonAsync("/api/finished-receipts", ReceiptBody());
            rk = (await cr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            await client.PostAsync($"/api/finished-receipts/{rk}/approve", null);
            Assert.Equal(100m, await Inv());

            var ci = await client.PostAsJsonAsync("/api/finished-issues", new {
                仓库 = P5TestData.仓库, 客户编号 = P5TestData.客户编号, 客户名称 = "P5测试客户",
                生产单号 = P5TestData.生产单号, 款号 = P5TestData.款号, 款式 = "P5测试款式",
                明细 = new[] { new { 色号 = "01", 颜色 = "黑色", 尺码 = "M", 数量 = 30, 单价 = 20 } } });
            ck = (await ci.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            await client.PostAsync($"/api/finished-issues/{ck}/approve", null);
            Assert.Equal(70m, await Inv());

            // 盘点基准应为库存70；实盘68 → 盈亏-2
            var basis = await client.GetFromJsonAsync<JsonElement>($"/api/finished-stocktakes/basis?{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(P5TestData.仓库)}");
            Assert.Equal(70m, basis[0].GetProperty("系统数量").GetDecimal());
            var cp = await client.PostAsJsonAsync("/api/finished-stocktakes", new {
                仓库 = P5TestData.仓库,
                明细 = new[] { new { 款号 = "P5K01", 款式 = "P5测试款式", 色号 = "01", 颜色 = "黑色", 尺码 = "M", 系统数量 = 70, 盘点数量 = 68 } } });
            pd = (await cp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            await client.PostAsync($"/api/finished-stocktakes/{pd}/approve", null);
            Assert.Equal(68m, await Inv());  // 70 + (-2)
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (pd != null) { c.Execute("DELETE FROM [成品盘点明细单] WHERE [单号]=@n", new { n = pd }); c.Execute("DELETE FROM [成品盘点单] WHERE [单号]=@n", new { n = pd }); }
            if (ck != null) { c.Execute("DELETE FROM [成品出仓明细单] WHERE [单号]=@n", new { n = ck }); c.Execute("DELETE FROM [成品出仓单] WHERE [单号]=@n", new { n = ck }); }
            if (rk != null) { c.Execute("DELETE FROM [成品入仓明细单] WHERE [单号]=@n", new { n = rk }); c.Execute("DELETE FROM [成品入仓单] WHERE [单号]=@n", new { n = rk }); }
            P5TestData.Cleanup(c);
        }
    }
```

- [ ] **Step 8: 跑测试 + 全量回归 + 提交** — `dotnet test --filter "FullyQualifiedName~FinishedStocktakeServiceDbTests"` PASS；`dotnet test --filter "FullyQualifiedName~P5ApiIntegrationTests"` PASS 5；`dotnet test` 全 PASS。

```powershell
git add src/ErpApi/Features/Warehouse/Finished/FinishedStocktakeService.cs src/ErpApi/Features/Warehouse/Finished/FinishedStocktakeController.cs src/ErpApi/Features/Warehouse/Finished/FinishedReceiptController.cs src/ErpApi/Features/Warehouse/Finished/FinishedIssueController.cs src/ErpApi/Program.cs tests/ErpApi.Tests/FinishedStocktakeServiceDbTests.cs tests/ErpApi.Tests/P5ApiIntegrationTests.cs
git commit -m @'
feat(P5): 成品盘点服务+REST(BasisAsync快照/盈亏)+审核同步明细审核位+入出仓盘点全链路闭环

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 7: 权限种子 + 后端收尾回归 + 冒烟

**Files:** Create `db/seed_p5_perms.sql`

- [ ] **Step 1: 写 P5 权限种子** — Create `db/seed_p5_perms.sql`:

```sql
-- 开发用:给某用户授予 P5 成品仓储菜单权限。用法:把 @用户 改成登录名,在目标库执行。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'成品入仓',N'成品出仓',N'成品盘点',N'成品库存');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'成品入仓',1,1,1,1,1,1,1,1,1),
       (@用户,N'成品出仓',1,1,1,1,1,1,1,1,1),
       (@用户,N'成品盘点',1,1,1,1,1,1,1,1,1),
       (@用户,N'成品库存',1,0,0,1,0,0,0,0,1);
```

- [ ] **Step 2: 在两库执行 + 验收(各应返回 4)**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
dotnet run --project tools/DbDeploy -- "$env:ERP_DB" db/seed_p5_perms.sql
dotnet run --project tools/DbDeploy -- "$env:ERP_TEST_DB" db/seed_p5_perms.sql
dotnet run --project tmp/dbquery -- "$env:ERP_DB" "SELECT COUNT(*) n FROM userbqrpower WHERE 用户='admin' AND 菜单 IN (N'成品入仓',N'成品出仓',N'成品盘点',N'成品库存')"
```

- [ ] **Step 3: 后端全量回归** — `dotnet test` → 全 PASS，0 跳过。

- [ ] **Step 4: API 冒烟（绕代理）** — 清残留进程并后台启动后端，用 `HttpClientHandler{UseProxy=false}` 的 .NET HttpClient（可复用 `tmp/smoke_p4` 改 URL，tmp/ gitignored）以 admin/admin123 登录后请求，确认 200：

```
GET /api/finished-receipts?page=1&size=5      → 200 {items,total}
GET /api/finished-issues?page=1&size=5        → 200 {items,total}
GET /api/finished-stocktakes?page=1&size=5    → 200 {items,total}
GET /api/finished-inventory?仓库=P5成品仓     → 200 [] (空数组)
```
任何 403 说明种子没在 erp 库生效——回 Step 2。冒烟后停后端。

- [ ] **Step 5: 提交**

```powershell
git add db/seed_p5_perms.sql
git commit -m @'
feat(P5): P5成品仓储菜单权限种子(成品入仓/出仓/盘点/库存)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 8: 前端 — 成品入仓页（列表 + 新建[选生产单] + 详情 + 审核）

**前端编码规范（P2/P3/M6/M7 沉淀，必须遵守）**：所有异步 try/catch + `message.error(err.response?.data?.消息 ?? 默认文案)`；基于前值的 setState 用函数式更新 `setX(prev => ...)`；不在组件渲染体重建 API 对象；TS 严格、`npm --prefix web run build` 0 错误。

**先读**：`web/src/api/production.ts`（选生产单带款）、`web/src/pages/workshop/OutsourceCreateDrawer.tsx`+`OutsourcePage.tsx`+`OutsourceDetailDrawer.tsx`（M7 列表/抽屉/明细行表/审核范本，最接近）、`web/src/api/cuttings.ts`（import 风格）、`web/src/auth/permissions.ts`/`PermissionContext.tsx`。

**Files:** Create `web/src/api/finished.ts`, `web/src/utils/finishedLines.ts`, `web/src/__tests__/finished.test.ts`, `web/src/pages/warehouse/FinishedReceiptCreateDrawer.tsx`, `web/src/pages/warehouse/FinishedReceiptDetailDrawer.tsx`, `web/src/pages/warehouse/FinishedReceiptPage.tsx`

- [ ] **Step 1: 写失败的纯函数测试** — Create `web/src/__tests__/finished.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { sumQty, validLines } from "../utils/finishedLines";

describe("成品明细", () => {
  it("sumQty 合计数量", () => {
    expect(sumQty([{ 数量: 60 }, { 数量: 40 }])).toBe(100);
    expect(sumQty([])).toBe(0);
  });
  it("validLines 过滤数量<=0 的行", () => {
    expect(validLines([{ 数量: 60 }, { 数量: 0 }, { 数量: -1 }])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm --prefix web run test` → FAIL。

- [ ] **Step 3: 写纯函数** — Create `web/src/utils/finishedLines.ts`:

```typescript
export const sumQty = (lines: { 数量?: number }[]) =>
  lines.reduce((a, l) => a + Number(l.数量 ?? 0), 0);

// 提交前过滤：数量>0
export const validLines = <T extends { 数量?: number }>(lines: T[]) =>
  lines.filter(l => Number(l.数量 ?? 0) > 0);
```

- [ ] **Step 4: 跑测试确认通过** — `npm --prefix web run test` → PASS。

- [ ] **Step 5: 写 API 客户端** — Create `web/src/api/finished.ts`（含入仓/出仓/盘点/库存 全部，后续任务复用）:

```typescript
import { api } from "./client";
import type { Paged } from "./master";

// ---- 入仓 ----
export interface FRLine { 色号?: string; 颜色?: string; 尺码?: string; 数量: number; 单价?: number }
export interface FRCreate { 仓库: string; 生产单号?: string; 款号?: string; 款式?: string; 床号?: string; 供应商编号?: string; 供应商名称?: string; 备注?: string; 明细: FRLine[] }
export interface FRHeader { id: number; 单号?: string; 仓库?: string; 日期?: string; 数量?: number; 金额?: number | null; 审核?: string; 备注?: string }
export interface FRDetail { 单头: FRHeader | null; 明细: { id: number; 生产单号?: string; 款号?: string; 色号?: string; 颜色?: string; 尺码?: string; 数量?: number; 单价?: number | null; 金额?: number | null }[] }

// ---- 出仓 ----
export interface FILine { 色号?: string; 颜色?: string; 尺码?: string; 数量: number; 单价?: number }
export interface FICreate { 仓库: string; 订单单号?: string; 客户编号?: string; 客户名称?: string; 生产单号?: string; 款号?: string; 款式?: string; 床号?: string; 备注?: string; 明细: FILine[] }
export interface FIHeader { id: number; 单号?: string; 订单单号?: string; 客户名称?: string; 仓库?: string; 日期?: string; 数量?: number; 金额?: number | null; 审核?: string; 备注?: string }
export interface FIDetail { 单头: FIHeader | null; 明细: { id: number; 款号?: string; 色号?: string; 颜色?: string; 尺码?: string; 数量?: number; 成本单价?: number | null; 成本金额?: number | null; 单价?: number | null; 金额?: number | null }[] }

// ---- 盘点 ----
export interface FSBasisRow { 款号?: string; 款式?: string; 色号?: string; 颜色?: string; 尺码?: string; 系统数量: number }
export interface FSLine { 款号?: string; 款式?: string; 色号?: string; 颜色?: string; 尺码?: string; 系统数量: number; 盘点数量: number }
export interface FSCreate { 仓库: string; 备注?: string; 明细: FSLine[] }
export interface FSHeader { id: number; 单号?: string; 仓库?: string; 日期?: string; 审核?: string; 备注?: string }
export interface FSDetail { 单头: FSHeader | null; 明细: { id: number; 款号?: string; 色号?: string; 颜色?: string; 尺码?: string; 系统数量?: number; 盘点数量?: number; 盈亏数量?: number }[] }

// ---- 库存 ----
export interface FinishedStockRow { 款号: string; 款式?: string; 色号?: string; 颜色?: string; 尺码?: string; 库存: number }

const enc = encodeURIComponent;
export const finishedReceiptApi = {
  list: (page = 1, size = 20, keyword = "") => api.get<Paged<FRHeader>>("/finished-receipts", { params: { page, size, keyword } }).then(r => r.data),
  get: (单号: string) => api.get<FRDetail>(`/finished-receipts/${enc(单号)}`).then(r => r.data),
  create: (body: FRCreate) => api.post<{ 单号: string }>("/finished-receipts", body).then(r => r.data),
  remove: (单号: string) => api.delete(`/finished-receipts/${enc(单号)}`),
  approve: (单号: string) => api.post(`/finished-receipts/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/finished-receipts/${enc(单号)}/unapprove`),
};
export const finishedIssueApi = {
  list: (page = 1, size = 20, keyword = "") => api.get<Paged<FIHeader>>("/finished-issues", { params: { page, size, keyword } }).then(r => r.data),
  get: (单号: string) => api.get<FIDetail>(`/finished-issues/${enc(单号)}`).then(r => r.data),
  create: (body: FICreate) => api.post<{ 单号: string }>("/finished-issues", body).then(r => r.data),
  remove: (单号: string) => api.delete(`/finished-issues/${enc(单号)}`),
  approve: (单号: string) => api.post(`/finished-issues/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/finished-issues/${enc(单号)}/unapprove`),
};
export const finishedStocktakeApi = {
  basis: (仓库: string) => api.get<FSBasisRow[]>("/finished-stocktakes/basis", { params: { 仓库 } }).then(r => r.data),
  list: (page = 1, size = 20, keyword = "") => api.get<Paged<FSHeader>>("/finished-stocktakes", { params: { page, size, keyword } }).then(r => r.data),
  get: (单号: string) => api.get<FSDetail>(`/finished-stocktakes/${enc(单号)}`).then(r => r.data),
  create: (body: FSCreate) => api.post<{ 单号: string }>("/finished-stocktakes", body).then(r => r.data),
  remove: (单号: string) => api.delete(`/finished-stocktakes/${enc(单号)}`),
  approve: (单号: string) => api.post(`/finished-stocktakes/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/finished-stocktakes/${enc(单号)}/unapprove`),
};
export const finishedInventoryApi = {
  list: (仓库: string) => api.get<FinishedStockRow[]>("/finished-inventory", { params: { 仓库 } }).then(r => r.data),
};
```

- [ ] **Step 6: 新建入仓抽屉** — Create `web/src/pages/warehouse/FinishedReceiptCreateDrawer.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Button, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Statistic, Table, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { productionApi, type ProductionHeader } from "../../api/production";
import { finishedReceiptApi, type FRLine } from "../../api/finished";

interface Picked { 款号?: string; 款式?: string }

export default function FinishedReceiptCreateDrawer({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [form] = Form.useForm<{ 仓库: string; 生产单号?: string; 床号?: string; 备注?: string }>();
  const [orders, setOrders] = useState<ProductionHeader[]>([]);
  const [picked, setPicked] = useState<Picked>({});
  const [lines, setLines] = useState<FRLine[]>([]);
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
  const setLine = (i: number, patch: Partial<FRLine>) =>
    setLines(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    let v: { 仓库: string; 生产单号?: string; 床号?: string; 备注?: string };
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => Number(l.数量) > 0);
    if (ok.length === 0) { message.error("请至少录入一行有数量的明细"); return; }
    setSaving(true);
    try {
      await finishedReceiptApi.create({ ...v, ...picked, 明细: ok });
      message.success("成品入仓单已创建"); onClose(); onCreated();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建入仓单失败");
    } finally { setSaving(false); }
  };

  const columns = [
    { title: "颜色", dataIndex: "颜色", width: 110, render: (_: unknown, r: FRLine, i: number) =>
      <Input style={{ width: 96 }} value={r.颜色 ?? ""} onChange={e => setLine(i, { 颜色: e.target.value })} /> },
    { title: "尺码", dataIndex: "尺码", width: 90, render: (_: unknown, r: FRLine, i: number) =>
      <Input style={{ width: 80 }} value={r.尺码 ?? ""} onChange={e => setLine(i, { 尺码: e.target.value })} /> },
    { title: "数量", dataIndex: "数量", width: 110, render: (_: unknown, r: FRLine, i: number) =>
      <InputNumber min={0} precision={0} style={{ width: 96 }} value={r.数量 ?? 0} onChange={n => setLine(i, { 数量: Number(n ?? 0) })} /> },
    { title: "成本单价", dataIndex: "单价", width: 120, render: (_: unknown, r: FRLine, i: number) =>
      <InputNumber min={0} style={{ width: 100 }} value={r.单价 ?? 0} onChange={n => setLine(i, { 单价: Number(n ?? 0) })} /> },
    { title: "", key: "_op", width: 50, render: (_: unknown, __: FRLine, i: number) =>
      <a onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>删除</a> },
  ];
  const 数量合计 = lines.reduce((a, l) => a + Number(l.数量 ?? 0), 0);

  return (
    <Drawer title="新建成品入仓单" width={900} open={open} onClose={onClose}
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
          <Col span={8}><Form.Item label="款号"><Input value={`${picked.款号 ?? ""} ${picked.款式 ?? ""}`} disabled /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={6}><Form.Item name="床号" label="床号"><Input /></Form.Item></Col>
          <Col span={18}><Form.Item name="备注" label="备注"><Input /></Form.Item></Col>
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

- [ ] **Step 7: 入仓详情抽屉** — Create `web/src/pages/warehouse/FinishedReceiptDetailDrawer.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Descriptions, Drawer, Table, Tag, message } from "antd";
import { finishedReceiptApi, type FRDetail } from "../../api/finished";

export default function FinishedReceiptDetailDrawer({ 单号, onClose }: { 单号: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<FRDetail | null>(null);
  useEffect(() => {
    if (!单号) { setDetail(null); return; }
    (async () => { try { setDetail(await finishedReceiptApi.get(单号)); } catch { message.error("加载入仓详情失败"); } })();
  }, [单号]);
  const h = detail?.单头;
  return (
    <Drawer title={`成品入仓单 ${单号 ?? ""}`} width={780} open={!!单号} onClose={onClose}>
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
              { title: "款号", dataIndex: "款号" }, { title: "颜色", dataIndex: "颜色" }, { title: "尺码", dataIndex: "尺码" },
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

- [ ] **Step 8: 入仓列表页** — Create `web/src/pages/warehouse/FinishedReceiptPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Popconfirm, Space, Table, Tag, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { finishedReceiptApi, type FRHeader } from "../../api/finished";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import FinishedReceiptCreateDrawer from "./FinishedReceiptCreateDrawer";
import FinishedReceiptDetailDrawer from "./FinishedReceiptDetailDrawer";

const MENU = "成品入仓";

export default function FinishedReceiptPage() {
  const perms = usePerms();
  const [rows, setRows] = useState<FRHeader[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await finishedReceiptApi.list(page, 10, keyword); setRows(r.items); setTotal(r.total); }
    catch { message.error("加载成品入仓单失败"); }
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
      render: (_: unknown, row: FRHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => finishedReceiptApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => finishedReceiptApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该入仓单?" onConfirm={() => act(() => finishedReceiptApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title="成品入仓" variant="borderless"
      extra={
        <Space>
          <Input.Search placeholder="搜索单号/仓库" allowClear onSearch={v => { setPage(1); setKeyword(v); }} style={{ width: 220 }} />
          {can(perms, MENU, "保存") && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建入仓单</Button>}
        </Space>
      }>
      <Table rowKey="id" size="middle" dataSource={rows} columns={columns} scroll={{ x: true }}
        pagination={{ current: page, pageSize: 10, total, onChange: setPage, showTotal: t => `共 ${t} 条` }} />
      <FinishedReceiptCreateDrawer open={creating} onClose={() => setCreating(false)} onCreated={load} />
      <FinishedReceiptDetailDrawer 单号={viewing} onClose={() => setViewing(null)} />
    </Card>
  );
}
```

- [ ] **Step 9: 构建 + 测试** — `npm --prefix web run test`（PASS，含 finished 2）；`npm --prefix web run build`（0 错误）。

- [ ] **Step 10: 提交**

```powershell
git add web/src/api/finished.ts web/src/utils/finishedLines.ts web/src/__tests__/finished.test.ts web/src/pages/warehouse/FinishedReceiptPage.tsx web/src/pages/warehouse/FinishedReceiptCreateDrawer.tsx web/src/pages/warehouse/FinishedReceiptDetailDrawer.tsx
git commit -m @'
feat(P5): 前端成品入仓页(选生产单+录色码数量成本+审核)+成品仓储API/纯函数

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 9: 前端 — 成品出仓页 + 成品盘点页

**Files:** Create `web/src/pages/warehouse/FinishedIssueCreateDrawer.tsx`, `web/src/pages/warehouse/FinishedIssuePage.tsx`, `web/src/pages/warehouse/FinishedStocktakePage.tsx`

- [ ] **Step 1: 出仓新建抽屉** — Create `web/src/pages/warehouse/FinishedIssueCreateDrawer.tsx`（仿入仓抽屉，去掉成本改售价、加客户字段）:

```tsx
import { useEffect, useState } from "react";
import { Button, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Statistic, Table, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { productionApi, type ProductionHeader } from "../../api/production";
import { finishedIssueApi, type FILine } from "../../api/finished";

interface Picked { 款号?: string; 款式?: string; 客户编号?: string; 客户名称?: string }

export default function FinishedIssueCreateDrawer({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [form] = Form.useForm<{ 仓库: string; 生产单号?: string; 订单单号?: string; 备注?: string }>();
  const [orders, setOrders] = useState<ProductionHeader[]>([]);
  const [picked, setPicked] = useState<Picked>({});
  const [lines, setLines] = useState<FILine[]>([]);
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
  const setLine = (i: number, patch: Partial<FILine>) =>
    setLines(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    let v: { 仓库: string; 生产单号?: string; 订单单号?: string; 备注?: string };
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => Number(l.数量) > 0);
    if (ok.length === 0) { message.error("请至少录入一行有数量的明细"); return; }
    setSaving(true);
    try {
      await finishedIssueApi.create({ ...v, ...picked, 明细: ok });
      message.success("成品出仓单已创建"); onClose(); onCreated();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建出仓单失败");
    } finally { setSaving(false); }
  };

  const columns = [
    { title: "颜色", dataIndex: "颜色", width: 110, render: (_: unknown, r: FILine, i: number) =>
      <Input style={{ width: 96 }} value={r.颜色 ?? ""} onChange={e => setLine(i, { 颜色: e.target.value })} /> },
    { title: "尺码", dataIndex: "尺码", width: 90, render: (_: unknown, r: FILine, i: number) =>
      <Input style={{ width: 80 }} value={r.尺码 ?? ""} onChange={e => setLine(i, { 尺码: e.target.value })} /> },
    { title: "数量", dataIndex: "数量", width: 110, render: (_: unknown, r: FILine, i: number) =>
      <InputNumber min={0} precision={0} style={{ width: 96 }} value={r.数量 ?? 0} onChange={n => setLine(i, { 数量: Number(n ?? 0) })} /> },
    { title: "售价", dataIndex: "单价", width: 120, render: (_: unknown, r: FILine, i: number) =>
      <InputNumber min={0} style={{ width: 100 }} value={r.单价 ?? 0} onChange={n => setLine(i, { 单价: Number(n ?? 0) })} /> },
    { title: "", key: "_op", width: 50, render: (_: unknown, __: FILine, i: number) =>
      <a onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>删除</a> },
  ];
  const 数量合计 = lines.reduce((a, l) => a + Number(l.数量 ?? 0), 0);

  return (
    <Drawer title="新建成品出仓单" width={900} open={open} onClose={onClose}
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
          <Col span={8}><Form.Item name="订单单号" label="订单单号"><Input /></Form.Item></Col>
          <Col span={16}><Form.Item name="备注" label="备注"><Input /></Form.Item></Col>
        </Row>
      </Form>
      <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={lines} columns={columns} />
      <Space style={{ marginTop: 12 }} size={24}>
        <Button icon={<PlusOutlined />} onClick={() => setLines(prev => [...prev, { 数量: 0 }])}>加一行</Button>
        <Statistic title="出仓数量合计" value={数量合计} />
      </Space>
    </Drawer>
  );
}
```

- [ ] **Step 2: 出仓列表页** — Create `web/src/pages/warehouse/FinishedIssuePage.tsx`（仿入仓列表页，MENU="成品出仓"，api=finishedIssueApi，列含 客户/订单单号；无详情抽屉，单号不可点）:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Popconfirm, Space, Table, Tag, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { finishedIssueApi, type FIHeader } from "../../api/finished";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import FinishedIssueCreateDrawer from "./FinishedIssueCreateDrawer";

const MENU = "成品出仓";

export default function FinishedIssuePage() {
  const perms = usePerms();
  const [rows, setRows] = useState<FIHeader[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try { const r = await finishedIssueApi.list(page, 10, keyword); setRows(r.items); setTotal(r.total); }
    catch { message.error("加载成品出仓单失败"); }
  }, [page, keyword]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); load(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const columns = [
    { title: "单号", dataIndex: "单号", key: "单号", render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "客户", dataIndex: "客户名称", key: "客户名称" },
    { title: "订单单号", dataIndex: "订单单号", key: "订单单号" },
    { title: "仓库", dataIndex: "仓库", key: "仓库" },
    { title: "出仓数量", dataIndex: "数量", key: "数量" },
    { title: "金额", dataIndex: "金额", key: "金额", render: (v?: number | null) => (v == null ? "***" : v) },
    { title: "状态", dataIndex: "审核", key: "审核",
      render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: FIHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => finishedIssueApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => finishedIssueApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该出仓单?" onConfirm={() => act(() => finishedIssueApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title="成品出仓" variant="borderless"
      extra={
        <Space>
          <Input.Search placeholder="搜索单号/仓库/客户" allowClear onSearch={v => { setPage(1); setKeyword(v); }} style={{ width: 240 }} />
          {can(perms, MENU, "保存") && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建出仓单</Button>}
        </Space>
      }>
      <Table rowKey="id" size="middle" dataSource={rows} columns={columns} scroll={{ x: true }}
        pagination={{ current: page, pageSize: 10, total, onChange: setPage, showTotal: t => `共 ${t} 条` }} />
      <FinishedIssueCreateDrawer open={creating} onClose={() => setCreating(false)} onCreated={load} />
    </Card>
  );
}
```

- [ ] **Step 3: 盘点页** — Create `web/src/pages/warehouse/FinishedStocktakePage.tsx`（选仓库→带出系统数量→录盘点数量→提交；列表+审核）:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, InputNumber, Popconfirm, Space, Table, Tag, message } from "antd";
import { finishedStocktakeApi, type FSBasisRow, type FSHeader, type FSLine } from "../../api/finished";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "成品盘点";
interface BasisRow extends FSBasisRow { 盘点数量?: number }

export default function FinishedStocktakePage() {
  const perms = usePerms();
  const [仓库, set仓库] = useState("");
  const [basis, setBasis] = useState<BasisRow[]>([]);
  const [rows, setRows] = useState<FSHeader[]>([]);
  const [saving, setSaving] = useState(false);

  const loadRows = useCallback(async () => {
    try { setRows((await finishedStocktakeApi.list(1, 50, 仓库)).items); }
    catch { message.error("加载盘点单失败"); }
  }, [仓库]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const loadBasis = async () => {
    if (!仓库) { message.error("请先填仓库"); return; }
    try { const b = await finishedStocktakeApi.basis(仓库); setBasis(b.map(x => ({ ...x, 盘点数量: x.系统数量 }))); }
    catch { message.error("加载库存基准失败"); }
  };
  const setQty = (i: number, val: number) =>
    setBasis(prev => prev.map((b, j) => (j === i ? { ...b, 盘点数量: val } : b)));

  const submit = async () => {
    if (!仓库) { message.error("请先填仓库"); return; }
    const 明细: FSLine[] = basis.map(b => ({
      款号: b.款号, 款式: b.款式, 色号: b.色号, 颜色: b.颜色, 尺码: b.尺码,
      系统数量: b.系统数量, 盘点数量: Number(b.盘点数量 ?? b.系统数量),
    }));
    if (明细.length === 0) { message.error("无库存可盘点"); return; }
    setSaving(true);
    try {
      await finishedStocktakeApi.create({ 仓库, 明细 });
      message.success("成品盘点单已创建"); setBasis([]); loadRows();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建盘点单失败");
    } finally { setSaving(false); }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); loadRows(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const basisColumns = [
    { title: "款号", dataIndex: "款号" }, { title: "颜色", dataIndex: "颜色" }, { title: "尺码", dataIndex: "尺码" },
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
      render: (_: unknown, row: FSHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => finishedStocktakeApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => finishedStocktakeApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该盘点单?" onConfirm={() => act(() => finishedStocktakeApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title="成品盘点" variant="borderless"
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

- [ ] **Step 4: 构建 + 测试** — `npm --prefix web run test`（PASS）；`npm --prefix web run build`（0 错误）。

- [ ] **Step 5: 提交**

```powershell
git add web/src/pages/warehouse/FinishedIssuePage.tsx web/src/pages/warehouse/FinishedIssueCreateDrawer.tsx web/src/pages/warehouse/FinishedStocktakePage.tsx
git commit -m @'
feat(P5): 前端成品出仓页+成品盘点页(选仓库带出库存录盘点数量)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 10: 前端 — 成品库存页 + 路由/菜单

**Files:** Create `web/src/pages/warehouse/FinishedInventoryPage.tsx`; Modify `web/src/App.tsx`, `web/src/pages/MainLayout.tsx`

- [ ] **Step 1: 成品库存页** — Create `web/src/pages/warehouse/FinishedInventoryPage.tsx`（仿 MaterialInventoryPage，款×色码×库存，需先填仓库）:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Card, Input, Table, message } from "antd";
import { finishedInventoryApi, type FinishedStockRow } from "../../api/finished";

export default function FinishedInventoryPage() {
  const [rows, setRows] = useState<FinishedStockRow[]>([]);
  const [仓库, set仓库] = useState("");

  const load = useCallback(async () => {
    if (!仓库) { setRows([]); return; }
    try { setRows(await finishedInventoryApi.list(仓库)); }
    catch { message.error("加载成品库存失败"); }
  }, [仓库]);
  useEffect(() => { load(); }, [load]);

  const columns = [
    { title: "款号", dataIndex: "款号", render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "款式", dataIndex: "款式" },
    { title: "颜色", dataIndex: "颜色" },
    { title: "尺码", dataIndex: "尺码" },
    { title: "库存", dataIndex: "库存",
      render: (v: number) => <span style={{ fontWeight: 600, color: v < 0 ? "#cf1322" : undefined }}>{v}</span> },
  ];

  return (
    <Card title="成品库存" variant="borderless"
      extra={<Input.Search placeholder="输入仓库查询" allowClear onSearch={set仓库} style={{ width: 220 }} />}>
      <Table rowKey={r => `${r.款号}|${r.色号}|${r.颜色}|${r.尺码}`} size="middle" dataSource={rows} columns={columns}
        pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }} />
    </Card>
  );
}
```

- [ ] **Step 2: App.tsx 加路由** — import 4 个页面（在物料/M7 import 之后），在 outsourcing 路由之后加：

```tsx
import FinishedReceiptPage from "./pages/warehouse/FinishedReceiptPage";
import FinishedIssuePage from "./pages/warehouse/FinishedIssuePage";
import FinishedStocktakePage from "./pages/warehouse/FinishedStocktakePage";
import FinishedInventoryPage from "./pages/warehouse/FinishedInventoryPage";
```

```tsx
          <Route path="finished-receipts" element={<FinishedReceiptPage />} />
          <Route path="finished-issues" element={<FinishedIssuePage />} />
          <Route path="finished-stocktakes" element={<FinishedStocktakePage />} />
          <Route path="finished-inventory" element={<FinishedInventoryPage />} />
```

- [ ] **Step 3: MainLayout 加"成品仓储"菜单组** — import 图标 `InboxOutlined, ExportOutlined, AuditOutlined, DatabaseOutlined`（`ExportOutlined`/`DatabaseOutlined` 可能已 import，去重）。在 `osChildren`（发外加工组）之后加 `fgChildren`：

```tsx
  const fgChildren = [
    ...(can(perms, "成品入仓", "打开") ? [{ key: "/finished-receipts", label: "成品入仓", icon: <InboxOutlined /> }] : []),
    ...(can(perms, "成品出仓", "打开") ? [{ key: "/finished-issues", label: "成品出仓", icon: <ExportOutlined /> }] : []),
    ...(can(perms, "成品盘点", "打开") ? [{ key: "/finished-stocktakes", label: "成品盘点", icon: <AuditOutlined /> }] : []),
    ...(can(perms, "成品库存", "打开") ? [{ key: "/finished-inventory", label: "成品库存", icon: <DatabaseOutlined /> }] : []),
  ];
```

`items` 末尾追加（在发外加工组 `os` 之后）：

```tsx
    ...(fgChildren.length ? [{ key: "fg", label: "成品仓储", icon: <InboxOutlined />, children: fgChildren }] : []),
```

Header 标题链追加（在发外加工分支之后；`/finished-inventory`、`/finished-stocktakes`、`/finished-issues`、`/finished-receipts` 各一条，因互不为前缀，顺序无碍，但放在 `: "基础资料"` 之前）：

```tsx
              : loc.pathname.startsWith("/finished-receipts") ? "成品入仓"
              : loc.pathname.startsWith("/finished-issues") ? "成品出仓"
              : loc.pathname.startsWith("/finished-stocktakes") ? "成品盘点"
              : loc.pathname.startsWith("/finished-inventory") ? "成品库存"
```

（注：`DatabaseOutlined` 在 MainLayout 已用于"基础资料"组，复用同一 import 即可，勿重复 import。）

- [ ] **Step 4: 构建 + 测试** — `npm --prefix web run test`（PASS 全部）；`npm --prefix web run build`（0 错误）。

- [ ] **Step 5: 提交**

```powershell
git add web/src/pages/warehouse/FinishedInventoryPage.tsx web/src/App.tsx web/src/pages/MainLayout.tsx
git commit -m @'
feat(P5): 前端成品库存页+成品仓储菜单组/路由(入仓/出仓/盘点/库存)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 11: 端到端验证（入仓 → 库存 → 出仓 → 盘点 + 截图）

无新功能代码（发现 bug 才修）。验证成品库存「动起来」闭环。

**Files:** 无（操作性任务）

- [ ] **Step 1: 全量回归**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
$env:ERP_JWT_KEY = [Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")
dotnet test ; npm --prefix web run test ; npm --prefix web run build
```
Expected: 后端全 PASS（0 跳过）、前端全 PASS、构建 0 错误。

- [ ] **Step 2: 确保开发库演示前置数据** — E2E 复用生产制单 `SC20260603001`（款 K001）。成品入仓选它即可，无需额外种子（款 K001 已存在）。仓库用自由文本 `成品仓`。

- [ ] **Step 3: 启动前后端**

```powershell
Get-Process -Name ErpApi -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Process -FilePath "dotnet" -ArgumentList "run --project src/ErpApi --urls http://localhost:5000" -WorkingDirectory "D:\WebpageERP" -WindowStyle Hidden
Start-Process -FilePath "cmd" -ArgumentList "/c npm --prefix web run dev -- --host --port 5173" -WorkingDirectory "D:\WebpageERP" -WindowStyle Hidden
Start-Sleep -Seconds 15
```

- [ ] **Step 4: API 全链路 E2E（绕代理）** — 复用/改写 `tmp/smoke_p4`（tmp/ gitignored）做：登录 admin/admin123 → 成品入仓（仓库 成品仓，生产单 SC20260603001，款 K001 黑M 数量100 单价10）→ 审核 → `GET /api/finished-inventory?仓库=成品仓` 库存合计=100 → 出仓 30 → 审核 → 库存=70 → 盘点带出基准（系统70）→ 实盘68 → 审核 → 库存=68。全部 PASS 后记录单号。

- [ ] **Step 5: puppeteer 截图（每步）** — 写 `tmp/shot/p5-e2e.cjs`（headless:'new'，viewport 1440×900，executablePath `C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe`，`.cjs`）：登录 → 成品仓储 → 成品入仓列表（截图 `tmp/p5-1-receipt.png`）→ 成品库存（输入仓库 成品仓 查询，截图 `tmp/p5-2-inventory.png`）→ 成品盘点（带出库存，截图 `tmp/p5-3-stocktake.png`）。antd v6 Select/Input 操作后 `await new Promise(r=>setTimeout(r,800))`；失败先截图再退。UI 卡住时记录卡点，用绕代理 API 补验核心命题，确保核心被证实后如实报告。

- [ ] **Step 6: 数据库验证库存口径**

```powershell
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
dotnet run --project tmp/dbquery -- "$env:ERP_DB" "SELECT 款号, SUM(库存) 库存 FROM (SELECT 款号,数量 库存 FROM 成品入仓明细单 WHERE 仓库='成品仓' AND ISNULL(审核,'0')='1' UNION ALL SELECT 款号,数量*-1 FROM 成品出仓明细单 WHERE 仓库='成品仓' AND ISNULL(审核,'0')='1' UNION ALL SELECT 款号,盈亏数量 FROM 成品盘点明细单 WHERE 仓库='成品仓' AND ISNULL(审核,'0')='1') t GROUP BY 款号"
```
记录实际结果（K001 库存 68）。

- [ ] **Step 7: 清理 + 收尾** — 停服务（Stop-Process ErpApi；关 node dev）。演示单据保留在 erp 开发库。确认：

```powershell
git status
git log --oneline master..HEAD
```
Expected: 工作树干净（tmp/ 截图不计）；分支领先 master 约 12 个提交。汇报后由 finishing-a-development-branch 决定合并。

---

## Self-Review 结论

**Spec 覆盖检查**（对照 `2026-06-05-p5a-finished-goods-design.md`）：
- ✅ 库存引擎扩展（FinishedGoodsAsync 加盘点盈亏项）：Task 2
- ✅ 成品入仓（成品入仓单+明细，两层，前缀 CR，审核走引擎②）：Task 3（Service）+ Task 4（Controller）+ Task 8（前端）
- ✅ 成品出仓（成品出仓单+明细，前缀 CC）：Task 5（Service+Controller）+ Task 9（前端）
- ✅ 成品盘点（BasisAsync 快照系统数量+盈亏+审核入库存，算法7）：Task 6（Service+Controller）+ Task 9（前端）
- ✅ 成品库存查询（复用 FinishedGoodsAsync，独立菜单）：Task 2（端点）+ Task 10（前端）
- ✅ DB 06 脚本（三单补审核留痕列）+ 审核引擎用例：Task 1
- ✅ 横切复用：单号①（CR/CC/CP）、审核②（白名单已含，06 补留痕列，审核同步明细审核位）、库存汇总③（FinishedGoodsAsync 扩展）、权限审计④、成本保密
- ✅ 权限种子（成品入仓/出仓/盘点/库存）：Task 7；菜单组+路由：Task 10；端到端：Task 11

**关键实现注记（审核同步明细审核位）**：`FinishedGoodsAsync` 过滤的是各「明细单.审核」，而审核引擎②只翻转「单头.审核」。故三个控制器的 Approve/Unapprove 在调用 posting 后须补一条 `UPDATE [对应明细单] SET [审核]=...`（Task 4/5/6 已写入）。这是库存断言成立的前提，执行时务必包含。

**明确延后**：成品调拨/退货/退仓（FinishedGoodsAsync 已含退货/退仓项，本期表空）、半成品、月结快照、加权出库成本、三层总单矩阵层。

**类型/签名一致性**：
- `FinishedReceiptService.CreateAsync/ListAsync/GetAsync/DeleteAsync`、`FinishedIssueService` 同形、`FinishedStocktakeService.BasisAsync/CreateAsync/...`（Task 3/5/6 定义，控制器调用一致）✅
- `FinishedStocktakeService` 注入 `IInventorySummaryService`（Task 6 构造），其 `FinishedGoodsAsync` 已 DI ✅
- DocType/前缀：CR/CC/CP，PostableDocuments 白名单（成品入仓单/出仓单/盘点单，单号列="单号"）一致 ✅
- 前端 `finishedReceiptApi/finishedIssueApi/finishedStocktakeApi/finishedInventoryApi`（Task 8）字段与后端 DTO 对齐 ✅
- 库存断言自洽：入仓100→库存100、出仓30→70、盘点盈亏-2→68（Task 2/4/5/6 用例 + Task 11 E2E）✅

**已知简化与理由**：
1. 三单只做 头+明细两层，跳过总单矩阵层。
2. 审核同步明细审核位（而非改审核引擎按表联动明细）——最小侵入，仅本切片三单需要；将来若多单据共需，可把"审核联动明细"上提到引擎②。
3. 加权出库成本延后，成本单价手工/留空。
4. 盘点 BasisAsync 取实时库存为系统数量；盘点单创建到审核间若库存又变，盈亏以创建时快照为准（符合盘点语义）。
