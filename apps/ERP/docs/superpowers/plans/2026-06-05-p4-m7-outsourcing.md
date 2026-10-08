# P4 M7 发外加工（派工 → 回收 → 对数）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通服装厂厂外协作闭环——发外派工（把裁好的片/半成品按 加工厂×款×加工项目×色码 发给加工厂做某工序）→ 发外回收（加工厂交回成品，记回收数量/欠数）→ 发外对数（按 发外单×款×加工项目 核对 发外/回收/相差/金额），这是 P6 应付对账与加工费结算的源头。

**Architecture:** 派工/回收都是两层单据（单头 + 明细，明细 `单号` 主从 FK → 单头，与 P3 物料单据同构），复用 P2/P3/M6 的 Dapper 事务服务模式，审核走引擎②（`发外加工单`/`发外回收单` 已在 PostableDocuments 白名单，仅需 05 脚本补 审核人/审核日期 留痕列）。发外单价取自 `发外加工项目`（全局费率主数据，走 P1 泛型 EF CRUD），服务端按加工项目查价、金额=数量×单价，不信任前端。回收按发外单号关联派工（无 FK，约定串联），欠数=发外数量−累计已审核回收。对数用 Dapper GROUP BY 实时聚合（只读，独立菜单）。成本保密：派工明细/回收明细/对数 的 单价/金额 按"单价"权限后端剥离。前端新增"发外加工"菜单组（发外派工/发外回收/发外对数）+ 基础资料组加发外加工项目。

**Tech Stack:** .NET 8 ASP.NET Core, Dapper（单据事务/对数聚合）, EF Core（1 新增主数据实体）, SQL Server LocalDB (erp/erp_test, Chinese_PRC_CI_AS), xUnit + WebApplicationFactory + Xunit.SkippableFact, React 18 + TS + Vite + Ant Design v6 + Vitest.

---

## 前置约定（所有任务通用）

- 工作目录 `D:\WebpageERP`，当前分支 `p4-m7-outsourcing`（已建）。Windows 用 PowerShell；`dotnet` 不在 PATH 时刷新：`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 集成测试需环境变量（shell 为空时）：`$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")`、`$env:ERP_JWT_KEY = [Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")`。开发库 `$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")`。
- 跑后端测试：仓库根 `dotnet test`；单类 `dotnet test --filter "FullyQualifiedName~OutsourceServiceDbTests"`。前端：`npm --prefix web run test`、`npm --prefix web run build`。
- **本机有系统代理 127.0.0.1:7892**：PowerShell `Invoke-RestMethod` 打本地 API 会被劫持失败；冒烟用 `HttpClientHandler{UseProxy=false}` 的 .NET HttpClient 或 Node 脚本。浏览器自动化（puppeteer-core 在 `tmp/shot`）不受影响。
- 提交规范：commit 末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。git 报 LF→CRLF 警告正常。
- **已有可复用件（P0–P4 M6 交付，直接 DI 注入）**：
  - `ISqlConnectionFactory.Create()` → `SqlConnection`
  - `IDocumentNumberGenerator.NextAsync(docType, prefix, bizDate, conn, tx)` → `"前缀+yyyyMMdd+3位流水"`（如 `FW20260605001`，共 13 字符）
  - `IPostingEngine.ApproveAsync(table, docNo, user)` / `UnapproveAsync(...)`（`发外加工单`/`发外回收单` 已在白名单，单号列="单号"）
  - `IPermissionService.HasAsync(user, menu, PermissionAction)`，`PermissionAction` = 打开/保存/删除/打印/单价/金额/审核/反审核/功能
  - `IAuditLogger.WriteAsync(表名, 行为, 操作员, 记录, SqlConnection, SqlTransaction?)`
  - `PagedResult<T>(IReadOnlyList<T> Items, int Total)`（namespace `ErpApi.Features.MasterData`）
  - P1 主数据：`MasterEntity` 基类、`MasterCrudService<T>`（开放泛型已 DI 注册）、`MasterCrudController<T>`、`[PriceField]` 成本保密属性、`ErpDbContext`（加 `DbSet<T>`）
  - 测试：`DbFixture`（`[Collection("db")]`、`fx.Open()`、`fx.ConnectionString`、`fx.Available`）、`JwtTokenService.Issue(user)`、`P4TestData`（种 客户 P4C01/加工厂 P4F01/款号 P4K01/生产单 P4SC01/工序表）
  - 前端：`api`(axios)、`masterApi(resource)`（含 `factories` 加工厂；本计划加 `outsource-items` 发外加工项目）、`productionApi.list/get`、`Paged<T>`、`can`/`usePerms()`、`MASTER_CONFIGS`（基础资料组自动渲染）
  - **参考实现（照搬模式）**：`src/ErpApi/Features/Production/Cutting/CuttingService.cs`+`CuttingController.cs`（两层单据 Dapper 事务+REST+审核范本）；`src/ErpApi/Features/Production/Piecework/PieceworkService.cs`（服务端取价+金额计算+GROUP BY 聚合范本）；`src/ErpApi/Features/MasterData/Controllers.cs`（P1 主数据控制器范本）；`db/04_p4_additions.sql`（幂等 ALTER 范本）；前端 `web/src/pages/workshop/`（M6 列表+抽屉+明细行表）。

### M7 涉及表的真实结构（以 `db/01_rebuild_schema.sql` 为准，仅列本期读写列）

- `发外加工项目`(费率主数据)：ID bigint, 加工项目 nvarchar, 单价 decimal, 备注 nvarchar。无 FK。
- `发外加工单`(派工单头)：ID int, **单号 nvarchar(20) UNIQUE**, 日期, 加工厂编号, 加工厂名称, 付款方式, 仓库, 数量 decimal, 金额 decimal, 操作员, 审核 nvarchar, 备注, 计算帐款。**无 审核人/审核日期（Task 1 补）**。FK：加工厂编号→加工厂资料。
- `发外加工明细单`(派工明细)：ID int, **单号 nvarchar(20)**, 日期, 加工厂编号, 加工厂名称, 仓库, 生产单号, 款号, 款式, 床号, 加工项目, 色号, 颜色, 尺码, 数量 decimal, 单价 decimal, 金额 decimal, 审核, 备注。FK：**单号→发外加工单(主从)**、加工厂编号→加工厂资料、款号→款号总表、生产单号→生产制单。
- `发外回收单`(回收单头)：ID int, **单号 nvarchar(20) UNIQUE**, 发外单号 nvarchar(20), 日期, 加工厂编号, 加工厂名称, 付款方式, 仓库, 发外数量 decimal, 回收数量 decimal, 相差数量 decimal, 金额 decimal, 操作员, 审核, 备注。**无 审核人/审核日期（Task 1 补）**。FK：加工厂编号→加工厂资料。**无 发外单号→发外加工单 FK**（约定串联）。
- `发外回收明细单`(回收明细)：ID int, **单号 nvarchar(20)**, 发外单号 nvarchar(20), 日期, 加工厂编号, 加工厂名称, 仓库, 生产单号, 款号, 款式, 床号, 加工项目, 色号, 颜色, 尺码, 发外数量 decimal, 数量 decimal(=本次回收), 欠数 decimal, 单价 decimal, 金额 decimal, 审核, 备注。FK：**单号→发外回收单(主从)**、加工厂编号→加工厂资料、款号→款号总表、生产单号→生产制单。

**关键设计约束**：
1. 派工单号前缀 `FW`、回收单号前缀 `FH`；单头↔明细按"单号"串联且有主从 FK，插入顺序 单头→明细、删除顺序 明细→单头。
2. 发外单价 = 该加工项目的 `发外加工项目.单价`（录入时服务端按加工项目查单价并算金额，不信任前端传的单价）。
3. 回收按 `发外单号` 关联派工（无 FK）；欠数 = 该(发外单+加工项目+颜色+尺码)的 发外数量 − 累计已审核回收数量。
4. 对数只读聚合（不写 `发外加工对数表`）：按 发外单号×款号×加工项目 归集 发外/回收/相差/金额（金额按回收数量×单价）。
5. 成本保密：派工明细 单价/金额、回收明细 单价/金额、对数 单价/金额 在无"单价"权限时后端置 null；发外加工项目 单价走 `[PriceField]`。
6. FK：派工/回收的 加工厂编号必须存在于加工厂资料、生产单号必须存在于生产制单、款号必须存在于款号总表——测试种子按 FK 顺序种父行。
7. 中文做 C# 标识符合法。路由 ASCII（`api/outsourcing`、`api/outsourcing/returns`、`api/outsourcing/reconcile`、`api/master/outsource-items`），菜单名/表名用中文。

---

## 文件结构

```
src/ErpApi/
├─ Data/Entities/发外加工项目.cs                      新:费率主数据实体
├─ Data/ErpDbContext.cs                              改:加 DbSet<发外加工项目>
├─ Features/MasterData/Controllers.cs                改:加 OutsourceItemController
├─ Features/Production/Outsourcing/                  新目录
│  ├─ OutsourceDtos.cs                               派工+回收+对数 DTO
│  ├─ OutsourceService.cs                            派工(录入/查询/删除) + 对数聚合
│  ├─ OutsourceReturnService.cs                      回收(带出基准/录入/查询/删除)
│  ├─ OutsourceController.cs                          派工 REST + 审核 + 对数端点 + 成本保密
│  └─ OutsourceReturnController.cs                    回收 REST + 审核 + 成本保密
└─ Program.cs                                        改:注册 OutsourceService/OutsourceReturnService

db/05_p4m7_additions.sql                             新:发外加工单/发外回收单 补审核留痕列
db/run-db.ps1                                         改:加载 05
db/seed_p4m7_perms.sql                               新:授权 发外加工项目/发外加工/发外回收/发外对数

web/src/
├─ api/outsourcing.ts                                新:派工/回收/对数 API
├─ utils/outsourceLines.ts                           新:明细合计/过滤纯函数
├─ pages/workshop/
│  ├─ OutsourcePage.tsx                              发外派工列表+审核
│  ├─ OutsourceCreateDrawer.tsx                      新建派工(选生产单/加工厂→录加工项目×色码明细)
│  ├─ OutsourceDetailDrawer.tsx                      派工详情
│  ├─ OutsourceReturnPage.tsx                        发外回收(选发外单→带出基准录回收数量)+审核
│  └─ OutsourceReconcilePage.tsx                     发外对数查询
├─ pages/master/configs.ts                           改:加 发外加工项目
├─ pages/MainLayout.tsx                              改:加"发外加工"菜单组
└─ App.tsx                                           改:+派工/回收/对数 路由

tests/ErpApi.Tests/
├─ PostingEngineDbTests.cs                           改:+发外加工单/发外回收单 审核用例
├─ P4M7TestData.cs                                   新:M7 测试种子(复用 P4TestData + 发外加工项目)
├─ OutsourceServiceDbTests.cs                        新(派工取价/删除/List/Get)
├─ OutsourceReturnServiceDbTests.cs                  新(回收带出基准/欠数/累计)
├─ OutsourceReconcileDbTests.cs                      新(对数聚合)
└─ P4M7ApiIntegrationTests.cs                        新(派工/回收 API 权限/审核/脱敏 + 对数 + 发外加工项目)
web/src/__tests__/outsourcing.test.ts                新:明细合计/过滤纯函数
```

---

## Task 1: DB 05 脚本（审核留痕列）+ 审核引擎 DB 测试

`发外加工单`/`发外回收单` 已在 PostableDocuments 白名单（单号列="单号"），但缺 审核人/审核日期 列（审核引擎②要写留痕）。本任务补列并验证审核引擎能审核这两张单。

**Files:**
- Create: `db/05_p4m7_additions.sql`
- Modify: `db/run-db.ps1`, `tests/ErpApi.Tests/PostingEngineDbTests.cs`

- [ ] **Step 1: 写 05 脚本**

Create `db/05_p4m7_additions.sql`:

```sql
-- P4 M7 发外：发外加工单/发外回收单 缺 审核人/审核日期 留痕列，补齐(供审核过账引擎②)。
-- 这两张单的 单号 列已是 nvarchar(20)(容得下 FW/FH+yyyyMMdd+3位=13字符)，无需扩宽。幂等。
SET XACT_ABORT ON;

IF COL_LENGTH(N'发外加工单', N'审核人') IS NULL
    ALTER TABLE [发外加工单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'发外加工单', N'审核日期') IS NULL
    ALTER TABLE [发外加工单] ADD [审核日期] datetime2(0) NULL;
IF COL_LENGTH(N'发外回收单', N'审核人') IS NULL
    ALTER TABLE [发外回收单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'发外回收单', N'审核日期') IS NULL
    ALTER TABLE [发外回收单] ADD [审核日期] datetime2(0) NULL;
```

- [ ] **Step 2: run-db.ps1 加载 05**

修改 `db/run-db.ps1`，在 04 那行之后追加 05（保持现有 01–04 不变）：

```powershell
dotnet run --project (Join-Path $root "tools\DbDeploy") -- $ConnectionString `
  ("lenient:" + (Join-Path $dir "01_rebuild_schema.sql")) `
  ("lenient:" + (Join-Path $dir "02_rebuild_relations.sql")) `
  (Join-Path $dir "03_p0_additions.sql") `
  (Join-Path $dir "04_p4_additions.sql") `
  (Join-Path $dir "05_p4m7_additions.sql")
```

- [ ] **Step 3: 在开发库和测试库执行 05**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
dotnet run --project tools/DbDeploy -- "$env:ERP_DB" db/05_p4m7_additions.sql
dotnet run --project tools/DbDeploy -- "$env:ERP_TEST_DB" db/05_p4m7_additions.sql
```

验收（两库都应非 NULL）：`SELECT COL_LENGTH('发外加工单','审核人'), COL_LENGTH('发外回收单','审核日期')`。

- [ ] **Step 4: 写裁审核的 DB 集成测试**

在 `tests/ErpApi.Tests/PostingEngineDbTests.cs` 追加（发外加工单 FK：加工厂编号→加工厂资料，先种父行）：

```csharp
    [SkippableFact]
    public async Task Approve_发外加工单_uses_单号_column()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [发外加工单] WHERE [单号]='P4FWPOST1'");
        c.Execute("DELETE FROM [加工厂资料] WHERE [加工厂编号]='P4FWF'");
        c.Execute("INSERT INTO [加工厂资料]([加工厂编号],[加工厂名称]) VALUES(N'P4FWF',N'发外过账测试厂')");
        c.Execute("INSERT INTO [发外加工单]([单号],[加工厂编号],[审核]) VALUES(N'P4FWPOST1',N'P4FWF','0')");

        var engine = new PostingEngine(Factory(), new AuditLogger());

        Assert.True(await engine.ApproveAsync("发外加工单", "P4FWPOST1", "tester"));
        Assert.Equal("1", c.ExecuteScalar<string>("SELECT [审核] FROM [发外加工单] WHERE [单号]='P4FWPOST1'"));
        Assert.Equal("tester", c.ExecuteScalar<string>("SELECT [审核人] FROM [发外加工单] WHERE [单号]='P4FWPOST1'"));
        Assert.False(await engine.ApproveAsync("发外加工单", "P4FWPOST1", "tester"));
        Assert.True(await engine.UnapproveAsync("发外加工单", "P4FWPOST1", "tester"));
        Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [发外加工单] WHERE [单号]='P4FWPOST1'"));

        c.Execute("DELETE FROM [发外加工单] WHERE [单号]='P4FWPOST1'");
        c.Execute("DELETE FROM [加工厂资料] WHERE [加工厂编号]='P4FWF'");
    }
```

- [ ] **Step 5: 跑 DB 测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~PostingEngineDbTests"`
Expected: PASS（含原有 + 新增发外用例；证明 05 补的留痕列可写、白名单已含发外加工单）

- [ ] **Step 6: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add db/05_p4m7_additions.sql db/run-db.ps1 tests/ErpApi.Tests/PostingEngineDbTests.cs
git commit -m @'
feat(P4): 05脚本(发外加工单/发外回收单补审核留痕列)+审核引擎发外用例

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 发外加工项目 费率主数据（P1 泛型 CRUD）

发外单价来源。复用 P1 主数据机制：EF 实体 + DbSet + 控制器路由 + 前端 MASTER_CONFIGS（基础资料组自动渲染）。

**Files:**
- Create: `src/ErpApi/Data/Entities/发外加工项目.cs`
- Modify: `src/ErpApi/Data/ErpDbContext.cs`, `src/ErpApi/Features/MasterData/Controllers.cs`, `web/src/pages/master/configs.ts`
- Test: `tests/ErpApi.Tests/P4M7ApiIntegrationTests.cs`（仅本任务的 CRUD 用例；文件在 Task 4 完整建，这里先建含本用例的最小版）

- [ ] **Step 1: 写实体**

Create `src/ErpApi/Data/Entities/发外加工项目.cs`:

```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("发外加工项目")]
public sealed class 发外加工项目 : MasterEntity
{
    [Column("加工项目")] public string? 加工项目 { get; set; }
    [Column("单价"), PriceField] public decimal? 单价 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
```

- [ ] **Step 2: DbContext 加 DbSet**

在 `src/ErpApi/Data/ErpDbContext.cs` 的 DbSet 区块末尾（`款号物料明细表` 那行之后）追加：

```csharp
    public DbSet<发外加工项目> 发外加工项目 => Set<发外加工项目>();
```

- [ ] **Step 3: 加控制器**

在 `src/ErpApi/Features/MasterData/Controllers.cs` 末尾追加：

```csharp
[Route("api/master/outsource-items")]
public sealed class OutsourceItemController(
    MasterCrudService<发外加工项目> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<发外加工项目>(s, p, a, f)
{ protected override string Menu => "发外加工项目"; protected override string TableName => "发外加工项目"; }
```

- [ ] **Step 4: 前端 MASTER_CONFIGS 加发外加工项目**

在 `web/src/pages/master/configs.ts` 的 `MASTER_CONFIGS` 对象里（`款号资料` 之后、闭合 `}` 之前）追加：

```typescript
  发外加工项目: { menu: "发外加工项目", resource: "outsource-items", title: "发外加工项目",
    fields: [
      { name: "加工项目", label: "加工项目" },
      { name: "单价", label: "单价", price: true },
      { name: "备注", label: "备注" }] },
```

- [ ] **Step 5: 写失败的 CRUD API 测试**

Create `tests/ErpApi.Tests/P4M7ApiIntegrationTests.cs`（仿 P4ApiIntegrationTests；本任务先建含发外加工项目 CRUD 一个用例的版本，Task 4/6/7 再追加派工/回收/对数用例）:

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
public class P4M7ApiIntegrationTests(DbFixture fx)
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

    [SkippableFact]
    public async Task OutsourceItem_crud_roundtrip()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); c.Execute("DELETE FROM [发外加工项目] WHERE [加工项目]='APITEST车缝'"); }
        SeedPerms("p4osi", "发外加工项目", open: true, save: true, del: true, price: true);
        var client = Client(app, "p4osi");

        var create = await client.PostAsJsonAsync("/api/master/outsource-items", new { 加工项目 = "APITEST车缝", 单价 = 2.5, 备注 = "x" });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var list = await client.GetFromJsonAsync<JsonElement>("/api/master/outsource-items?keyword=APITEST车缝");
        Assert.True(list.GetProperty("total").GetInt32() >= 1);

        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); c.Execute("DELETE FROM [发外加工项目] WHERE [加工项目]='APITEST车缝'"); }
    }
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~P4M7ApiIntegrationTests"`
Expected: PASS 1 个（证明发外加工项目主数据 CRUD + 路由 + 权限可用）

- [ ] **Step 7: 前端构建确认**

Run: `npm --prefix web run build`
Expected: tsc 0 错误（发外加工项目自动出现在"基础资料"菜单组）

- [ ] **Step 8: 提交**

```powershell
git add src/ErpApi/Data/Entities/发外加工项目.cs src/ErpApi/Data/ErpDbContext.cs src/ErpApi/Features/MasterData/Controllers.cs web/src/pages/master/configs.ts tests/ErpApi.Tests/P4M7ApiIntegrationTests.cs
git commit -m @'
feat(P4): 发外加工项目费率主数据(P1泛型CRUD,单价成本保密)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 发外派工 Service + DTO + P4M7 测试种子

派工两层（发外加工单 + 发外加工明细单，单号 主从 FK），Dapper 事务，前缀 `FW`，单价取自发外加工项目。建 M7 共用测试种子 `P4M7TestData`。

**Files:**
- Create: `src/ErpApi/Features/Production/Outsourcing/OutsourceDtos.cs`, `src/ErpApi/Features/Production/Outsourcing/OutsourceService.cs`, `tests/ErpApi.Tests/P4M7TestData.cs`
- Modify: `src/ErpApi/Program.cs`
- Test: `tests/ErpApi.Tests/OutsourceServiceDbTests.cs`

- [ ] **Step 1: 写 DTO**

Create `src/ErpApi/Features/Production/Outsourcing/OutsourceDtos.cs`:

```csharp
namespace ErpApi.Features.Production.Outsourcing;

// 一行派工明细（单价服务端按加工项目取，不收前端的）
public sealed class OutsourceLineDto
{
    public string 加工项目 { get; set; } = "";
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 数量 { get; set; }
}

// 派工录入（单头 + 明细）
public sealed class OutsourceCreateDto
{
    public string 加工厂编号 { get; set; } = "";
    public string? 加工厂名称 { get; set; }
    public string? 仓库 { get; set; }
    public string? 付款方式 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 床号 { get; set; }
    public string? 备注 { get; set; }
    public List<OutsourceLineDto> 明细 { get; set; } = [];
}

// 派工单头读出
public sealed class OutsourceHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

// 派工明细读出
public sealed class OutsourceLineRowDto
{
    public long ID { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 加工项目 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}

public sealed class OutsourceDetailDto
{
    public OutsourceHeaderDto? 单头 { get; set; }
    public List<OutsourceLineRowDto> 明细 { get; set; } = [];
}

// 对数行（按 款号×加工项目 归集，发外/回收/相差/金额）
public sealed class OutsourceReconcileRow
{
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 加工项目 { get; set; }
    public decimal? 发外数量 { get; set; }
    public decimal? 回收数量 { get; set; }
    public decimal? 相差数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
```

- [ ] **Step 2: 写 P4M7 测试种子**

Create `tests/ErpApi.Tests/P4M7TestData.cs`:

```csharp
using Dapper;
using Microsoft.Data.SqlClient;

// P4 M7 测试种子：复用 P4TestData(客户 P4C01/加工厂 P4F01/款号 P4K01/生产单 P4SC01) +
// 发外加工项目 P4车缝(单价2.5)。发外派工/回收单据由各测试用返回单号精确删，此处兜底按加工厂/生产单删。
public static class P4M7TestData
{
    public const string 加工项目 = "P4车缝";
    public const decimal 单价 = 2.5m;

    public static void Seed(SqlConnection c)
    {
        Cleanup(c);
        P4TestData.Seed(c);   // 客户/加工厂/款号/人事/生产制单/工序表
        c.Execute("INSERT INTO [发外加工项目]([加工项目],[单价],[备注]) VALUES(N'P4车缝',2.5,N'P4测试发外项目')");
    }

    // 反 FK 顺序清理
    public static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [发外回收明细单] WHERE [生产单号]=N'P4SC01'");
        c.Execute("DELETE FROM [发外回收单] WHERE [加工厂编号]=N'P4F01'");
        c.Execute("DELETE FROM [发外加工明细单] WHERE [生产单号]=N'P4SC01'");
        c.Execute("DELETE FROM [发外加工单] WHERE [加工厂编号]=N'P4F01'");
        c.Execute("DELETE FROM [发外加工项目] WHERE [加工项目]=N'P4车缝'");
        P4TestData.Cleanup(c);
    }
}
```

注：`发外加工单` 无 生产单号 列（生产单号在明细），故兜底按 加工厂编号 删派工/回收单头。测试库 P4F01 仅本套用，安全。

- [ ] **Step 3: 写失败的 Service 测试**

Create `tests/ErpApi.Tests/OutsourceServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Production.Outsourcing;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class OutsourceServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private OutsourceService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static OutsourceCreateDto Dto() => new()
    {
        加工厂编号 = P4TestData.加工厂编号, 加工厂名称 = "P4测试加工厂", 仓库 = "成品仓",
        生产单号 = P4TestData.生产单号, 款号 = P4TestData.款号, 款式 = "P4测试款式", 床号 = "1",
        明细 =
        [
            new OutsourceLineDto { 加工项目 = P4M7TestData.加工项目, 颜色 = "黑色", 尺码 = "M", 数量 = 60 },
            new OutsourceLineDto { 加工项目 = P4M7TestData.加工项目, 颜色 = "白色", 尺码 = "L", 数量 = 40 },
        ]
    };

    [SkippableFact]
    public async Task Create_takes_price_from_item_and_computes_total()
    {
        using var c = fx.Open();
        P4M7TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("FW", 单号);
            // 单价取自发外加工项目(2.5)，明细金额=数量×单价
            Assert.Equal(2.5m, c.ExecuteScalar<decimal>("SELECT TOP 1 [单价] FROM [发外加工明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(150m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [发外加工明细单] WHERE [单号]=@n AND [数量]=60", new { n = 单号 }));
            // 单头汇总 数量=100 金额=250
            Assert.Equal(100m, c.ExecuteScalar<decimal>("SELECT [数量] FROM [发外加工单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal(250m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [发外加工单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [发外加工单] WHERE [单号]=@n", new { n = 单号 }));
        }
        finally
        {
            c.Execute("DELETE FROM [发外加工明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [发外加工单] WHERE [单号]=@n", new { n = 单号 });
            P4M7TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Create_rejects_item_not_in_rate_table()
    {
        using var c = fx.Open();
        P4M7TestData.Seed(c);
        try
        {
            var dto = Dto();
            dto.明细 = [ new OutsourceLineDto { 加工项目 = "不存在项目", 颜色 = "黑", 尺码 = "M", 数量 = 10 } ];
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(dto, "tester"));
        }
        finally { P4M7TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_Get_Delete_lifecycle()
    {
        using var c = fx.Open();
        P4M7TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            var page = await Svc().ListAsync(1, 20, 单号);
            Assert.Equal(1, page.Total);

            var detail = await Svc().GetAsync(单号);
            Assert.NotNull(detail);
            Assert.Equal(2, detail!.明细.Count);

            c.Execute("UPDATE [发外加工单] SET [审核]='1' WHERE [单号]=@n", new { n = 单号 });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
            c.Execute("UPDATE [发外加工单] SET [审核]='0' WHERE [单号]=@n", new { n = 单号 });
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [发外加工明细单] WHERE [单号]=@n", new { n = 单号 }));
            Assert.False(await Svc().DeleteAsync("FW不存在"));
        }
        finally
        {
            c.Execute("DELETE FROM [发外加工明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [发外加工单] WHERE [单号]=@n", new { n = 单号 });
            P4M7TestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 4: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~OutsourceServiceDbTests"`
Expected: FAIL（OutsourceService 不存在）

- [ ] **Step 5: 实现 OutsourceService**

Create `src/ErpApi/Features/Production/Outsourcing/OutsourceService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
namespace ErpApi.Features.Production.Outsourcing;

// 发外派工（把生产制单按 加工厂×加工项目×色码 发给加工厂）。两层：发外加工单 + 发外加工明细单(单号 主从 FK)。
// 单价取自 发外加工项目.单价（服务端查，不信任前端）；金额=数量×单价。
public sealed class OutsourceService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "发外加工单";
    public const string Prefix = "FW";   // 发外加工单号 = FW + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(OutsourceCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("发外派工至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.加工厂编号)) throw new ArgumentException("加工厂必填");
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        // 先按加工项目查单价并算各行金额（不信前端）
        var 行 = new List<(OutsourceLineDto l, decimal price)>();
        foreach (var l in dto.明细)
        {
            if (string.IsNullOrWhiteSpace(l.加工项目)) throw new ArgumentException("加工项目必填");
            if (l.数量 <= 0) throw new ArgumentException("发外数量必须大于0");
            var price = await c.ExecuteScalarAsync<decimal?>(
                "SELECT TOP 1 [单价] FROM [发外加工项目] WHERE [加工项目]=@加工项目", new { l.加工项目 }, tx);
            if (price is null) throw new ArgumentException($"加工项目 [{l.加工项目}] 不在发外加工项目费率表中");
            行.Add((l, price.Value));
        }
        var 数量 = 行.Sum(x => x.l.数量);
        var 金额 = 行.Sum(x => x.l.数量 * x.price);

        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [发外加工单]([单号],[日期],[加工厂编号],[加工厂名称],[付款方式],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@加工厂编号,@加工厂名称,@付款方式,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.加工厂编号, dto.加工厂名称, dto.付款方式, dto.仓库, 数量, 金额, 操作员 = user, dto.备注 }, tx);

        foreach (var (l, price) in 行)
            await c.ExecuteAsync(@"
INSERT INTO [发外加工明细单]([单号],[日期],[加工厂编号],[加工厂名称],[仓库],[生产单号],[款号],[款式],[床号],
    [加工项目],[色号],[颜色],[尺码],[数量],[单价],[金额],[审核])
VALUES(@单号,@日期,@加工厂编号,@加工厂名称,@仓库,@生产单号,@款号,@款式,@床号,
    @加工项目,@色号,@颜色,@尺码,@数量,@单价,@金额,'0')",
                new
                {
                    单号, 日期 = now, dto.加工厂编号, dto.加工厂名称, dto.仓库, dto.生产单号, dto.款号, dto.款式, dto.床号,
                    l.加工项目, l.色号, l.颜色, l.尺码, l.数量, 单价 = price, 金额 = l.数量 * price
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<OutsourceHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [发外加工单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [加工厂编号] LIKE @kw OR [加工厂名称] LIKE @kw;
SELECT [ID],[单号],[加工厂编号],[加工厂名称],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [发外加工单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [加工厂编号] LIKE @kw OR [加工厂名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<OutsourceHeaderDto>()).AsList();
        return new PagedResult<OutsourceHeaderDto>(items, total);
    }

    public async Task<OutsourceDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[加工厂编号],[加工厂名称],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [发外加工单] WHERE [单号]=@单号;
SELECT [ID],[生产单号],[款号],[加工项目],[色号],[颜色],[尺码],[数量],[单价],[金额]
FROM [发外加工明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<OutsourceHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<OutsourceLineRowDto>()).AsList();
        return new OutsourceDetailDto { 单头 = header, 明细 = lines };
    }

    // 删除：仅未审核可删；单号 主从 FK，先删明细后删单头
    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [发外加工单] WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的发外派工单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [发外加工明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [发外加工单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }

    // 对数（只读聚合）：按 款号×加工项目 归集该发外单的 发外/回收/相差/金额。
    // 发外数量取派工明细(单头审核'1')；回收数量取回收明细(回收单头审核'1')；金额=回收数量×派工单价。
    public async Task<IReadOnlyList<OutsourceReconcileRow>> ReconcileAsync(string 发外单号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<OutsourceReconcileRow>(@"
SELECT d.[款号], MAX(d.[款式]) AS 款式, d.[加工项目],
       SUM(d.[数量]) AS 发外数量,
       ISNULL(r.[回收数量],0) AS 回收数量,
       SUM(d.[数量]) - ISNULL(r.[回收数量],0) AS 相差数量,
       MAX(d.[单价]) AS 单价,
       ISNULL(r.[回收数量],0) * MAX(d.[单价]) AS 金额
FROM [发外加工明细单] d
JOIN [发外加工单] h ON h.[单号]=d.[单号] AND ISNULL(h.[审核],'0')='1'
LEFT JOIN (
    SELECT rd.[款号], rd.[加工项目], SUM(rd.[数量]) AS 回收数量
    FROM [发外回收明细单] rd
    JOIN [发外回收单] rh ON rh.[单号]=rd.[单号] AND ISNULL(rh.[审核],'0')='1'
    WHERE rd.[发外单号]=@发外单号
    GROUP BY rd.[款号], rd.[加工项目]
) r ON r.[款号]=d.[款号] AND r.[加工项目]=d.[加工项目]
WHERE d.[单号]=@发外单号
GROUP BY d.[款号], d.[加工项目], r.[回收数量]
ORDER BY d.[款号], d.[加工项目]", new { 发外单号 });
        return rows.AsList();
    }
}
```

- [ ] **Step 6: Program.cs 注册**

在 `src/ErpApi/Program.cs` 的 `// 业务` 区块（M6 的 `CuttingService`/`PieceworkService` 注册附近）追加：

```csharp
builder.Services.AddScoped<ErpApi.Features.Production.Outsourcing.OutsourceService>();
```

- [ ] **Step 7: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~OutsourceServiceDbTests"`
Expected: PASS 3 个

- [ ] **Step 8: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Production/Outsourcing/OutsourceDtos.cs src/ErpApi/Features/Production/Outsourcing/OutsourceService.cs src/ErpApi/Program.cs tests/ErpApi.Tests/P4M7TestData.cs tests/ErpApi.Tests/OutsourceServiceDbTests.cs
git commit -m @'
feat(P4): 发外派工服务(单头+明细Dapper事务,前缀FW,单价取发外加工项目)+对数聚合+P4M7种子

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: 发外派工 Controller（REST + 审核 + 成本保密 + 审计）+ 对数端点

**Files:**
- Create: `src/ErpApi/Features/Production/Outsourcing/OutsourceController.cs`
- Modify: `tests/ErpApi.Tests/P4M7ApiIntegrationTests.cs`（追加派工 + 对数用例）

- [ ] **Step 1: 在 P4M7ApiIntegrationTests 追加派工/对数测试**

在 `tests/ErpApi.Tests/P4M7ApiIntegrationTests.cs` 类内追加 helper 与用例（Seed 用 `P4M7TestData`）：

```csharp
    private static object OutsourceBody() => new
    {
        加工厂编号 = P4TestData.加工厂编号, 加工厂名称 = "P4测试加工厂", 仓库 = "成品仓",
        生产单号 = P4TestData.生产单号, 款号 = P4TestData.款号, 款式 = "P4测试款式", 床号 = "1",
        明细 = new[]
        {
            new { 加工项目 = P4M7TestData.加工项目, 颜色 = "黑色", 尺码 = "M", 数量 = 60 },
            new { 加工项目 = P4M7TestData.加工项目, 颜色 = "白色", 尺码 = "L", 数量 = 40 },
        }
    };

    [SkippableFact]
    public async Task Outsource_create_forbidden_without_save_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4M7TestData.Seed(c); }
        SeedPerms("p4osviewer", "发外加工", open: true, save: false);
        var resp = await Client(app, "p4osviewer").PostAsJsonAsync("/api/outsourcing", OutsourceBody());
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4M7TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Outsource_detail_strips_price_without_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4M7TestData.Seed(c); }
        SeedPerms("p4osnoprice", "发外加工", open: true, save: true, price: false);
        var client = Client(app, "p4osnoprice");
        var create = await client.PostAsJsonAsync("/api/outsourcing", OutsourceBody());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            var detail = await client.GetFromJsonAsync<JsonElement>($"/api/outsourcing/{单号}");
            var line0 = detail.GetProperty("明细")[0];
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("单价").ValueKind);
            Assert.Equal(JsonValueKind.Null, line0.GetProperty("金额").ValueKind);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [发外加工明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [发外加工单] WHERE [单号]=@n", new { n = 单号 });
            P4M7TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Outsource_lifecycle_create_approve_unapprove_delete()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4M7TestData.Seed(c); }
        SeedPerms("p4os", "发外加工", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        var client = Client(app, "p4os");

        var create = await client.PostAsJsonAsync("/api/outsourcing", OutsourceBody());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            var list = await client.GetFromJsonAsync<JsonElement>($"/api/outsourcing?keyword={单号}");
            Assert.Equal(1, list.GetProperty("total").GetInt32());
            var detail = await client.GetFromJsonAsync<JsonElement>($"/api/outsourcing/{单号}");
            Assert.Equal(2, detail.GetProperty("明细").GetArrayLength());
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/outsourcing/{单号}/approve", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/outsourcing/{单号}")).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/outsourcing/{单号}/unapprove", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/outsourcing/{单号}")).StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [发外加工明细单] WHERE [单号]=@n", new { n = 单号 });
            c.Execute("DELETE FROM [发外加工单] WHERE [单号]=@n", new { n = 单号 });
            P4M7TestData.Cleanup(c);
        }
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~P4M7ApiIntegrationTests"`
Expected: FAIL（/api/outsourcing 404）

- [ ] **Step 3: 实现 OutsourceController**

Create `src/ErpApi/Features/Production/Outsourcing/OutsourceController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Production.Outsourcing;

[ApiController]
[Authorize]
[Route("api/outsourcing")]
public sealed class OutsourceController(
    OutsourceService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "发外加工";
    private const string ReconcileMenu = "发外对数";
    private const string Table = "发外加工单";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create();
        await c.OpenAsync();
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
    public async Task<IActionResult> Create([FromBody] OutsourceCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "加工厂/生产单号/款号不存在。" }); }
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

    // 发外对数（只读聚合）。独立"发外对数"菜单控权；金额/单价按"单价"权限脱敏。
    [HttpGet("reconcile")]
    public async Task<IActionResult> Reconcile([FromQuery(Name = "发外单号")] string 发外单号)
    {
        if (!await perms.HasAsync(CurrentUser, ReconcileMenu, PermissionAction.打开)) return Forbid();
        var rows = await svc.ReconcileAsync(发外单号);
        if (!await perms.HasAsync(CurrentUser, ReconcileMenu, PermissionAction.单价))
            foreach (var r in rows) { r.单价 = null; r.金额 = null; }
        return Ok(rows);
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~P4M7ApiIntegrationTests"`
Expected: PASS（发外加工项目 CRUD 1 + 派工 3）

- [ ] **Step 5: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Production/Outsourcing/OutsourceController.cs tests/ErpApi.Tests/P4M7ApiIntegrationTests.cs
git commit -m @'
feat(P4): 发外派工REST接口(审核过账+成本保密+审计)+发外对数端点

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: 发外回收 Service + DTO（带出基准 / 欠数 / 累计回收）

回收两层（发外回收单 + 发外回收明细单），按 `发外单号` 关联派工。带出基准 = 派工明细按(加工项目,颜色,尺码)汇总的发外数量 − 累计已审核回收 = 欠数；录回收数量后单价取自派工明细。

**Files:**
- Modify: `src/ErpApi/Features/Production/Outsourcing/OutsourceDtos.cs`（追加回收 DTO）
- Create: `src/ErpApi/Features/Production/Outsourcing/OutsourceReturnService.cs`
- Modify: `src/ErpApi/Program.cs`
- Test: `tests/ErpApi.Tests/OutsourceReturnServiceDbTests.cs`

- [ ] **Step 1: 追加回收 DTO**

在 `src/ErpApi/Features/Production/Outsourcing/OutsourceDtos.cs` 末尾追加：

```csharp
// 回收基准行（按发外单带出：发外数量/已回收/欠数；单价/款/项目/色码）
public sealed class OutsourceReturnBasisRow
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 加工项目 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 发外数量 { get; set; }
    public decimal 已回收 { get; set; }
    public decimal 欠数 { get; set; }
    public decimal? 单价 { get; set; }
}

// 一行回收明细（前端按基准带出后填回收数量）
public sealed class OutsourceReturnLineDto
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string 加工项目 { get; set; } = "";
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 发外数量 { get; set; }
    public decimal 回收数量 { get; set; }
}

public sealed class OutsourceReturnCreateDto
{
    public string 发外单号 { get; set; } = "";
    public string 加工厂编号 { get; set; } = "";
    public string? 加工厂名称 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public List<OutsourceReturnLineDto> 明细 { get; set; } = [];
}

public sealed class OutsourceReturnHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 发外单号 { get; set; }
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 发外数量 { get; set; }
    public decimal? 回收数量 { get; set; }
    public decimal? 相差数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class OutsourceReturnLineRowDto
{
    public long ID { get; set; }
    public string? 款号 { get; set; }
    public string? 加工项目 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 发外数量 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 欠数 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}

public sealed class OutsourceReturnDetailDto
{
    public OutsourceReturnHeaderDto? 单头 { get; set; }
    public List<OutsourceReturnLineRowDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 2: 写失败的 Service 测试**

Create `tests/ErpApi.Tests/OutsourceReturnServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Production.Outsourcing;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class OutsourceReturnServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private OutsourceService Out() => new(Factory(), new DocumentNumberGenerator());
    private OutsourceReturnService Ret() => new(Factory(), new DocumentNumberGenerator());

    private static OutsourceCreateDto OutDto() => new()
    {
        加工厂编号 = P4TestData.加工厂编号, 加工厂名称 = "P4测试加工厂", 仓库 = "成品仓",
        生产单号 = P4TestData.生产单号, 款号 = P4TestData.款号, 款式 = "P4测试款式", 床号 = "1",
        明细 = [ new OutsourceLineDto { 加工项目 = P4M7TestData.加工项目, 颜色 = "黑色", 尺码 = "M", 数量 = 100 } ]
    };

    [SkippableFact]
    public async Task Basis_then_receive_computes_owed_and_amount()
    {
        using var c = fx.Open();
        P4M7TestData.Seed(c);
        var 发外单号 = await Out().CreateAsync(OutDto(), "tester");
        c.Execute("UPDATE [发外加工单] SET [审核]='1' WHERE [单号]=@n", new { n = 发外单号 });
        string? 回收单号 = null;
        try
        {
            // 基准：发外100 已回收0 欠数100，单价2.5
            var basis = await Ret().BasisAsync(发外单号);
            Assert.Single(basis);
            Assert.Equal(100m, basis[0].发外数量);
            Assert.Equal(0m, basis[0].已回收);
            Assert.Equal(100m, basis[0].欠数);
            Assert.Equal(2.5m, basis[0].单价);

            // 回收95件
            回收单号 = await Ret().CreateAsync(new OutsourceReturnCreateDto
            {
                发外单号 = 发外单号, 加工厂编号 = P4TestData.加工厂编号, 加工厂名称 = "P4测试加工厂", 仓库 = "成品仓",
                明细 = [ new OutsourceReturnLineDto {
                    生产单号 = P4TestData.生产单号, 款号 = P4TestData.款号, 款式 = "P4测试款式",
                    加工项目 = P4M7TestData.加工项目, 颜色 = "黑色", 尺码 = "M", 发外数量 = 100, 回收数量 = 95 } ]
            }, "tester");

            Assert.StartsWith("FH", 回收单号);
            // 明细 欠数=100-95=5，单价取派工单价2.5，金额=95×2.5=237.5
            Assert.Equal(5m, c.ExecuteScalar<decimal>("SELECT [欠数] FROM [发外回收明细单] WHERE [单号]=@n", new { n = 回收单号 }));
            Assert.Equal(2.5m, c.ExecuteScalar<decimal>("SELECT [单价] FROM [发外回收明细单] WHERE [单号]=@n", new { n = 回收单号 }));
            Assert.Equal(237.5m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [发外回收明细单] WHERE [单号]=@n", new { n = 回收单号 }));
            // 单头：发外100 回收95 相差5
            Assert.Equal(95m, c.ExecuteScalar<decimal>("SELECT [回收数量] FROM [发外回收单] WHERE [单号]=@n", new { n = 回收单号 }));
            Assert.Equal(5m, c.ExecuteScalar<decimal>("SELECT [相差数量] FROM [发外回收单] WHERE [单号]=@n", new { n = 回收单号 }));

            // 审核该回收单后，基准的已回收应=95、欠数=5
            c.Execute("UPDATE [发外回收单] SET [审核]='1' WHERE [单号]=@n", new { n = 回收单号 });
            var basis2 = await Ret().BasisAsync(发外单号);
            Assert.Equal(95m, basis2[0].已回收);
            Assert.Equal(5m, basis2[0].欠数);
        }
        finally
        {
            if (回收单号 != null)
            {
                c.Execute("DELETE FROM [发外回收明细单] WHERE [单号]=@n", new { n = 回收单号 });
                c.Execute("DELETE FROM [发外回收单] WHERE [单号]=@n", new { n = 回收单号 });
            }
            c.Execute("DELETE FROM [发外加工明细单] WHERE [单号]=@n", new { n = 发外单号 });
            c.Execute("DELETE FROM [发外加工单] WHERE [单号]=@n", new { n = 发外单号 });
            P4M7TestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~OutsourceReturnServiceDbTests"`
Expected: FAIL（OutsourceReturnService 不存在）

- [ ] **Step 4: 实现 OutsourceReturnService**

Create `src/ErpApi/Features/Production/Outsourcing/OutsourceReturnService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
namespace ErpApi.Features.Production.Outsourcing;

// 发外回收（加工厂交回成品）。两层：发外回收单 + 发外回收明细单(单号 主从 FK)。
// 按 发外单号 关联派工(无 FK，约定串联)；欠数=该(发外单+加工项目+颜色+尺码)发外数量−累计已审核回收。
public sealed class OutsourceReturnService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "发外回收单";
    public const string Prefix = "FH";   // 发外回收单号 = FH + yyyyMMdd + 3位流水

    // 带出基准：派工明细(单头审核'1')按(生产单,款,项目,色号,颜色,尺码)汇总发外数量，减累计已审核回收=欠数
    public async Task<IReadOnlyList<OutsourceReturnBasisRow>> BasisAsync(string 发外单号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<OutsourceReturnBasisRow>(@"
SELECT d.[生产单号], d.[款号], MAX(d.[款式]) AS 款式, d.[加工项目], d.[色号], d.[颜色], d.[尺码],
       SUM(d.[数量]) AS 发外数量,
       ISNULL(r.[已回收],0) AS 已回收,
       SUM(d.[数量]) - ISNULL(r.[已回收],0) AS 欠数,
       MAX(d.[单价]) AS 单价
FROM [发外加工明细单] d
JOIN [发外加工单] h ON h.[单号]=d.[单号] AND ISNULL(h.[审核],'0')='1'
LEFT JOIN (
    SELECT rd.[款号], rd.[加工项目], ISNULL(rd.[颜色],'') AS 颜色k, ISNULL(rd.[尺码],'') AS 尺码k, SUM(rd.[数量]) AS 已回收
    FROM [发外回收明细单] rd
    JOIN [发外回收单] rh ON rh.[单号]=rd.[单号] AND ISNULL(rh.[审核],'0')='1'
    WHERE rd.[发外单号]=@发外单号
    GROUP BY rd.[款号], rd.[加工项目], ISNULL(rd.[颜色],''), ISNULL(rd.[尺码],'')
) r ON r.[款号]=d.[款号] AND r.[加工项目]=d.[加工项目]
      AND r.[颜色k]=ISNULL(d.[颜色],'') AND r.[尺码k]=ISNULL(d.[尺码],'')
WHERE d.[单号]=@发外单号
GROUP BY d.[生产单号], d.[款号], d.[加工项目], d.[色号], d.[颜色], d.[尺码], r.[已回收]
ORDER BY d.[款号], d.[加工项目], d.[颜色], d.[尺码]", new { 发外单号 });
        return rows.AsList();
    }

    public async Task<string> CreateAsync(OutsourceReturnCreateDto dto, string user)
    {
        var 明细 = dto.明细.Where(l => l.回收数量 > 0).ToList();
        if (明细.Count == 0) throw new ArgumentException("回收至少要有一行回收数量大于0的明细");
        if (string.IsNullOrWhiteSpace(dto.发外单号)) throw new ArgumentException("发外单号必填");
        if (string.IsNullOrWhiteSpace(dto.加工厂编号)) throw new ArgumentException("加工厂必填");
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        // 校验发外单存在且已审核
        var 发外审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [发外加工单] WHERE [单号]=@发外单号", new { dto.发外单号 }, tx);
        if (发外审核 is null) throw new ArgumentException($"发外单 [{dto.发外单号}] 不存在");
        if (发外审核 != "1") throw new ArgumentException($"发外单 [{dto.发外单号}] 未审核，不能回收");

        var 回收单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);
        var 发外数量合计 = 明细.Sum(l => l.发外数量);
        var 回收数量合计 = 明细.Sum(l => l.回收数量);

        // 每行单价取该(发外单+加工项目)的派工单价
        var lines = new List<(OutsourceReturnLineDto l, decimal price, decimal owed)>();
        foreach (var l in 明细)
        {
            var price = await c.ExecuteScalarAsync<decimal?>(@"
SELECT TOP 1 [单价] FROM [发外加工明细单]
WHERE [单号]=@发外单号 AND [加工项目]=@加工项目 AND ISNULL([颜色],'')=ISNULL(@颜色,'') AND ISNULL([尺码],'')=ISNULL(@尺码,'')",
                new { dto.发外单号, l.加工项目, l.颜色, l.尺码 }, tx) ?? 0m;
            // 累计已审核回收(不含本单) + 本次 → 欠数
            var 已回收 = await c.ExecuteScalarAsync<decimal?>(@"
SELECT ISNULL(SUM(rd.[数量]),0) FROM [发外回收明细单] rd
JOIN [发外回收单] rh ON rh.[单号]=rd.[单号] AND ISNULL(rh.[审核],'0')='1'
WHERE rd.[发外单号]=@发外单号 AND rd.[加工项目]=@加工项目
  AND ISNULL(rd.[颜色],'')=ISNULL(@颜色,'') AND ISNULL(rd.[尺码],'')=ISNULL(@尺码,'')",
                new { dto.发外单号, l.加工项目, l.颜色, l.尺码 }, tx) ?? 0m;
            var owed = l.发外数量 - (已回收 + l.回收数量);
            lines.Add((l, price, owed));
        }

        await c.ExecuteAsync(@"
INSERT INTO [发外回收单]([单号],[发外单号],[日期],[加工厂编号],[加工厂名称],[仓库],[发外数量],[回收数量],[相差数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@发外单号,@日期,@加工厂编号,@加工厂名称,@仓库,@发外数量,@回收数量,@相差数量,@金额,@操作员,'0',@备注)",
            new
            {
                单号 = 回收单号, dto.发外单号, 日期 = now, dto.加工厂编号, dto.加工厂名称, dto.仓库,
                发外数量 = 发外数量合计, 回收数量 = 回收数量合计, 相差数量 = 发外数量合计 - 回收数量合计,
                金额 = lines.Sum(x => x.l.回收数量 * x.price), 操作员 = user, dto.备注
            }, tx);

        foreach (var (l, price, owed) in lines)
            await c.ExecuteAsync(@"
INSERT INTO [发外回收明细单]([单号],[发外单号],[日期],[加工厂编号],[加工厂名称],[仓库],[生产单号],[款号],[款式],
    [加工项目],[色号],[颜色],[尺码],[发外数量],[数量],[欠数],[单价],[金额],[审核])
VALUES(@单号,@发外单号,@日期,@加工厂编号,@加工厂名称,@仓库,@生产单号,@款号,@款式,
    @加工项目,@色号,@颜色,@尺码,@发外数量,@数量,@欠数,@单价,@金额,'0')",
                new
                {
                    单号 = 回收单号, dto.发外单号, 日期 = now, dto.加工厂编号, dto.加工厂名称, dto.仓库,
                    l.生产单号, l.款号, l.款式, l.加工项目, l.色号, l.颜色, l.尺码,
                    l.发外数量, 数量 = l.回收数量, 欠数 = owed, 单价 = price, 金额 = l.回收数量 * price
                }, tx);

        tx.Commit();
        return 回收单号;
    }

    public async Task<PagedResult<OutsourceReturnHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [发外回收单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [发外单号] LIKE @kw OR [加工厂名称] LIKE @kw;
SELECT [ID],[单号],[发外单号],[加工厂编号],[加工厂名称],[日期],[发外数量],[回收数量],[相差数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [发外回收单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [发外单号] LIKE @kw OR [加工厂名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<OutsourceReturnHeaderDto>()).AsList();
        return new PagedResult<OutsourceReturnHeaderDto>(items, total);
    }

    public async Task<OutsourceReturnDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[发外单号],[加工厂编号],[加工厂名称],[日期],[发外数量],[回收数量],[相差数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [发外回收单] WHERE [单号]=@单号;
SELECT [ID],[款号],[加工项目],[颜色],[尺码],[发外数量],[数量],[欠数],[单价],[金额]
FROM [发外回收明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<OutsourceReturnHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<OutsourceReturnLineRowDto>()).AsList();
        return new OutsourceReturnDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [发外回收单] WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的发外回收单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [发外回收明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [发外回收单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 5: Program.cs 注册**

在 `src/ErpApi/Program.cs` 的 `OutsourceService` 注册那行之后追加：

```csharp
builder.Services.AddScoped<ErpApi.Features.Production.Outsourcing.OutsourceReturnService>();
```

- [ ] **Step 6: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~OutsourceReturnServiceDbTests"`
Expected: PASS 1 个

- [ ] **Step 7: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Production/Outsourcing/OutsourceDtos.cs src/ErpApi/Features/Production/Outsourcing/OutsourceReturnService.cs src/ErpApi/Program.cs tests/ErpApi.Tests/OutsourceReturnServiceDbTests.cs
git commit -m @'
feat(P4): 发外回收服务(按发外单带出基准/欠数/累计回收,单价取派工)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 6: 发外回收 Controller（REST + 审核 + 成本保密）

**Files:**
- Create: `src/ErpApi/Features/Production/Outsourcing/OutsourceReturnController.cs`
- Modify: `tests/ErpApi.Tests/P4M7ApiIntegrationTests.cs`（追加回收 + 对数闭环用例）

- [ ] **Step 1: 在 P4M7ApiIntegrationTests 追加回收+对数闭环测试**

在 `tests/ErpApi.Tests/P4M7ApiIntegrationTests.cs` 类内追加：

```csharp
    [SkippableFact]
    public async Task Outsource_full_loop_dispatch_receive_reconcile()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4M7TestData.Seed(c); }
        // 三个菜单都授全权(含单价)
        SeedPerms("p4loop", "发外加工", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p4loop", "发外回收", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        SeedPerms("p4loop", "发外对数", open: true, save: false, del: false, price: true);
        var client = Client(app, "p4loop");
        string? fw = null, fh = null;
        try
        {
            // 派工100 → 审核
            var cr = await client.PostAsJsonAsync("/api/outsourcing", new {
                加工厂编号 = P4TestData.加工厂编号, 加工厂名称 = "P4测试加工厂", 仓库 = "成品仓",
                生产单号 = P4TestData.生产单号, 款号 = P4TestData.款号, 款式 = "P4测试款式", 床号 = "1",
                明细 = new[] { new { 加工项目 = P4M7TestData.加工项目, 颜色 = "黑色", 尺码 = "M", 数量 = 100 } }
            });
            fw = (await cr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/outsourcing/{fw}/approve", null)).StatusCode);

            // 回收基准
            var basis = await client.GetFromJsonAsync<JsonElement>($"/api/outsourcing/returns/basis?发外单号={fw}");
            Assert.Equal(1, basis.GetArrayLength());
            Assert.Equal(100, basis[0].GetProperty("欠数").GetDecimal());

            // 回收95 → 审核
            var rr = await client.PostAsJsonAsync("/api/outsourcing/returns", new {
                发外单号 = fw, 加工厂编号 = P4TestData.加工厂编号, 加工厂名称 = "P4测试加工厂", 仓库 = "成品仓",
                明细 = new[] { new {
                    生产单号 = P4TestData.生产单号, 款号 = P4TestData.款号, 款式 = "P4测试款式",
                    加工项目 = P4M7TestData.加工项目, 颜色 = "黑色", 尺码 = "M", 发外数量 = 100, 回收数量 = 95 } }
            });
            Assert.Equal(HttpStatusCode.Created, rr.StatusCode);
            fh = (await rr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/outsourcing/returns/{fh}/approve", null)).StatusCode);

            // 对数：发外100 回收95 相差5 金额=95×2.5=237.5
            var rec = await client.GetFromJsonAsync<JsonElement>($"/api/outsourcing/reconcile?发外单号={fw}");
            Assert.Equal(1, rec.GetArrayLength());
            Assert.Equal(100, rec[0].GetProperty("发外数量").GetDecimal());
            Assert.Equal(95, rec[0].GetProperty("回收数量").GetDecimal());
            Assert.Equal(5, rec[0].GetProperty("相差数量").GetDecimal());
            Assert.Equal(237.5m, rec[0].GetProperty("金额").GetDecimal());
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            if (fh != null) { c.Execute("DELETE FROM [发外回收明细单] WHERE [单号]=@n", new { n = fh }); c.Execute("DELETE FROM [发外回收单] WHERE [单号]=@n", new { n = fh }); }
            if (fw != null) { c.Execute("DELETE FROM [发外加工明细单] WHERE [单号]=@n", new { n = fw }); c.Execute("DELETE FROM [发外加工单] WHERE [单号]=@n", new { n = fw }); }
            P4M7TestData.Cleanup(c);
        }
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~P4M7ApiIntegrationTests.Outsource_full_loop"`
Expected: FAIL（/api/outsourcing/returns 404）

- [ ] **Step 3: 实现 OutsourceReturnController**

Create `src/ErpApi/Features/Production/Outsourcing/OutsourceReturnController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Production.Outsourcing;

[ApiController]
[Authorize]
[Route("api/outsourcing/returns")]
public sealed class OutsourceReturnController(
    OutsourceReturnService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "发外回收";
    private const string Table = "发外回收单";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }

    private void StripPriceBasis(IReadOnlyList<OutsourceReturnBasisRow> rows, bool hasPrice)
    {
        if (hasPrice) return;
        foreach (var r in rows) r.单价 = null;
    }

    [HttpGet("basis")]
    public async Task<IActionResult> Basis([FromQuery(Name = "发外单号")] string 发外单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var rows = await svc.BasisAsync(发外单号);
        StripPriceBasis(rows, await AllowAsync(PermissionAction.单价));
        return Ok(rows);
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
    public async Task<IActionResult> Create([FromBody] OutsourceReturnCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "加工厂/生产单号/款号不存在。" }); }
        await AuditAsync("新增", $"单号={单号},发外单={dto.发外单号}");
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

注：路由 `api/outsourcing/returns` 中 `basis`/`approve` 等字面段与 `{单号}` 不冲突（ASP.NET 路由模板字面段优先匹配）。

- [ ] **Step 4: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~P4M7ApiIntegrationTests"`
Expected: PASS（发外加工项目1 + 派工3 + 回收对数闭环1）

- [ ] **Step 5: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Production/Outsourcing/OutsourceReturnController.cs tests/ErpApi.Tests/P4M7ApiIntegrationTests.cs
git commit -m @'
feat(P4): 发外回收REST接口(带出基准+审核+成本保密)+派工→回收→对数闭环测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 7: 权限种子 + 后端收尾回归 + 冒烟

**Files:**
- Create: `db/seed_p4m7_perms.sql`

- [ ] **Step 1: 写 P4 M7 权限种子脚本**

Create `db/seed_p4m7_perms.sql`（仿 `db/seed_p4_perms.sql`；发外加工项目=主数据，派工/回收=单据含审核，对数只读）:

```sql
-- 开发用:给某用户授予 P4 M7 菜单权限。用法:把 @用户 改成登录名,在目标库执行。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'发外加工项目',N'发外加工',N'发外回收',N'发外对数');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'发外加工项目',1,1,1,1,1,1,0,0,1),
       (@用户,N'发外加工',1,1,1,1,1,1,1,1,1),
       (@用户,N'发外回收',1,1,1,1,1,1,1,1,1),
       (@用户,N'发外对数',1,0,0,1,1,1,0,0,1);
```

- [ ] **Step 2: 在开发库和测试库执行种子**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
dotnet run --project tools/DbDeploy -- "$env:ERP_DB" db/seed_p4m7_perms.sql
dotnet run --project tools/DbDeploy -- "$env:ERP_TEST_DB" db/seed_p4m7_perms.sql
```

验收（两库都应返回 4）：`SELECT COUNT(*) FROM userbqrpower WHERE 用户='admin' AND 菜单 IN (N'发外加工项目',N'发外加工',N'发外回收',N'发外对数')`

- [ ] **Step 3: 后端全量回归**

Run: `dotnet test`
Expected: 全部 PASS，0 跳过（设了 ERP_TEST_DB 时）

- [ ] **Step 4: API 冒烟（绕过系统代理）**

清残留进程并后台启动后端（`Get-Process -Name ErpApi -ErrorAction SilentlyContinue | Stop-Process -Force` 后 `Start-Process ... dotnet run --project src/ErpApi --urls http://localhost:5000`），用 `HttpClientHandler{UseProxy=false}` 的 .NET HttpClient（或 Node axios）以 admin/admin123 登录后请求：

```
GET /api/outsourcing?page=1&size=5                    → 200 {items,total}
GET /api/outsourcing/returns?page=1&size=5            → 200 {items,total}
GET /api/outsourcing/reconcile?发外单号=不存在        → 200 []（空数组）
GET /api/master/outsource-items?page=1&size=5         → 200 {items,total}
```

任何 403 都说明权限种子没在 erp 库生效——回 Step 2 检查。冒烟后停后端进程。

- [ ] **Step 5: 提交**

```powershell
git add db/seed_p4m7_perms.sql
git commit -m @'
feat(P4): P4 M7菜单权限种子(发外加工项目/发外加工/发外回收/发外对数)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 8: 前端 — 发外派工页（列表 + 新建[选生产单/加工厂→录加工项目×色码] + 详情 + 审核）

**前端编码规范（P2/P3/M6 沉淀，必须遵守）**：所有异步 try/catch + `message.error(err.response?.data?.消息 ?? 默认文案)`；基于前值的 setState 用函数式更新 `setX(prev => ...)`；不在组件渲染体重建 API 对象；TS 严格、`npm --prefix web run build` 0 错误。

**先读**：`web/src/api/production.ts`（选生产单带款）、`web/src/api/master.ts`（`masterApi("factories")` 加工厂、`masterApi("outsource-items")` 加工项目）、`web/src/pages/workshop/CuttingPage.tsx`+`CuttingCreateDrawer.tsx`+`CuttingDetailDrawer.tsx`（M6 列表/抽屉/明细行表/审核范本）、`web/src/auth/permissions.ts`、`web/src/auth/PermissionContext.tsx`。

**Files:**
- Create: `web/src/api/outsourcing.ts`, `web/src/utils/outsourceLines.ts`, `web/src/pages/workshop/OutsourceCreateDrawer.tsx`, `web/src/pages/workshop/OutsourceDetailDrawer.tsx`, `web/src/pages/workshop/OutsourcePage.tsx`
- Test: `web/src/__tests__/outsourcing.test.ts`

- [ ] **Step 1: 写失败的纯函数测试**

Create `web/src/__tests__/outsourcing.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { sumQty, validOutsourceLines } from "../utils/outsourceLines";

describe("发外明细", () => {
  it("sumQty 合计数量", () => {
    expect(sumQty([{ 数量: 60 }, { 数量: 40 }])).toBe(100);
    expect(sumQty([])).toBe(0);
  });
  it("validOutsourceLines 过滤缺加工项目/数量<=0 的行", () => {
    const lines = [
      { 加工项目: "车缝", 数量: 60 },
      { 加工项目: "", 数量: 5 },
      { 加工项目: "车缝", 数量: 0 },
    ];
    expect(validOutsourceLines(lines)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm --prefix web run test`
Expected: FAIL（outsourceLines 不存在）

- [ ] **Step 3: 写纯函数**

Create `web/src/utils/outsourceLines.ts`:

```typescript
export interface OutLine { 加工项目?: string; 数量?: number; 颜色?: string; 尺码?: string; 色号?: string }

export const sumQty = (lines: { 数量?: number }[]) =>
  lines.reduce((a, l) => a + Number(l.数量 ?? 0), 0);

// 提交前过滤：加工项目必填且数量>0
export const validOutsourceLines = (lines: OutLine[]) =>
  lines.filter(l => !!l.加工项目 && Number(l.数量 ?? 0) > 0);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm --prefix web run test`
Expected: PASS

- [ ] **Step 5: 发外 API 客户端**

Create `web/src/api/outsourcing.ts`:

```typescript
import { api } from "./client";
import type { Paged } from "./master";

export interface OutLineDto { 加工项目: string; 色号?: string; 颜色?: string; 尺码?: string; 数量: number }
export interface OutCreate {
  加工厂编号: string; 加工厂名称?: string; 仓库?: string; 付款方式?: string;
  生产单号?: string; 款号?: string; 款式?: string; 床号?: string; 备注?: string;
  明细: OutLineDto[];
}
export interface OutHeader {
  id: number; 单号?: string; 加工厂编号?: string; 加工厂名称?: string; 仓库?: string;
  日期?: string; 数量?: number; 金额?: number | null; 操作员?: string; 审核?: string; 备注?: string;
}
export interface OutDetail {
  单头: OutHeader | null;
  明细: { id: number; 生产单号?: string; 款号?: string; 加工项目?: string; 色号?: string; 颜色?: string; 尺码?: string; 数量?: number; 单价?: number | null; 金额?: number | null }[];
}

// 回收
export interface OutReturnBasisRow {
  生产单号?: string; 款号?: string; 款式?: string; 加工项目?: string; 色号?: string; 颜色?: string; 尺码?: string;
  发外数量: number; 已回收: number; 欠数: number; 单价?: number | null;
}
export interface OutReturnLineDto {
  生产单号?: string; 款号?: string; 款式?: string; 加工项目: string; 色号?: string; 颜色?: string; 尺码?: string;
  发外数量: number; 回收数量: number;
}
export interface OutReturnCreate {
  发外单号: string; 加工厂编号: string; 加工厂名称?: string; 仓库?: string; 备注?: string;
  明细: OutReturnLineDto[];
}
export interface OutReturnHeader {
  id: number; 单号?: string; 发外单号?: string; 加工厂名称?: string; 日期?: string;
  发外数量?: number; 回收数量?: number; 相差数量?: number; 金额?: number | null; 审核?: string;
}
export interface OutReturnDetail {
  单头: OutReturnHeader | null;
  明细: { id: number; 款号?: string; 加工项目?: string; 颜色?: string; 尺码?: string; 发外数量?: number; 数量?: number; 欠数?: number; 单价?: number | null; 金额?: number | null }[];
}
export interface OutReconcileRow {
  款号?: string; 款式?: string; 加工项目?: string;
  发外数量?: number; 回收数量?: number; 相差数量?: number; 单价?: number | null; 金额?: number | null;
}

const enc = encodeURIComponent;
export const outsourcingApi = {
  list: (page = 1, size = 20, keyword = "") =>
    api.get<Paged<OutHeader>>("/outsourcing", { params: { page, size, keyword } }).then(r => r.data),
  get: (单号: string) => api.get<OutDetail>(`/outsourcing/${enc(单号)}`).then(r => r.data),
  create: (body: OutCreate) => api.post<{ 单号: string }>("/outsourcing", body).then(r => r.data),
  remove: (单号: string) => api.delete(`/outsourcing/${enc(单号)}`),
  approve: (单号: string) => api.post(`/outsourcing/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/outsourcing/${enc(单号)}/unapprove`),
  reconcile: (发外单号: string) =>
    api.get<OutReconcileRow[]>("/outsourcing/reconcile", { params: { 发外单号 } }).then(r => r.data),
};
export const outReturnApi = {
  basis: (发外单号: string) =>
    api.get<OutReturnBasisRow[]>("/outsourcing/returns/basis", { params: { 发外单号 } }).then(r => r.data),
  list: (page = 1, size = 20, keyword = "") =>
    api.get<Paged<OutReturnHeader>>("/outsourcing/returns", { params: { page, size, keyword } }).then(r => r.data),
  get: (单号: string) => api.get<OutReturnDetail>(`/outsourcing/returns/${enc(单号)}`).then(r => r.data),
  create: (body: OutReturnCreate) => api.post<{ 单号: string }>("/outsourcing/returns", body).then(r => r.data),
  remove: (单号: string) => api.delete(`/outsourcing/returns/${enc(单号)}`),
  approve: (单号: string) => api.post(`/outsourcing/returns/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/outsourcing/returns/${enc(单号)}/unapprove`),
};
```

- [ ] **Step 6: 新建派工抽屉**

Create `web/src/pages/workshop/OutsourceCreateDrawer.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Button, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Statistic, Table, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { productionApi, type ProductionHeader } from "../../api/production";
import { masterApi } from "../../api/master";
import { outsourcingApi, type OutLineDto } from "../../api/outsourcing";

interface Factory { 加工厂编号?: string; 加工厂名称?: string }
interface Item { 加工项目?: string }
interface Picked { 款号?: string; 款式?: string }

export default function OutsourceCreateDrawer({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [form] = Form.useForm<{ 生产单号?: string; 加工厂编号: string; 仓库?: string; 床号?: string; 备注?: string }>();
  const [orders, setOrders] = useState<ProductionHeader[]>([]);
  const [factories, setFactories] = useState<Factory[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [picked, setPicked] = useState<Picked>({});
  const [lines, setLines] = useState<OutLineDto[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setOrders((await productionApi.list(1, 200)).items);
        setFactories((await masterApi("factories").list(1, 500)).items as Factory[]);
        setItems((await masterApi("outsource-items").list(1, 500)).items as Item[]);
      } catch { message.error("加载生产制单/加工厂/加工项目失败"); }
    })();
    form.resetFields(); setPicked({}); setLines([]);
  }, [open, form]);

  const onOrderChange = async (生产单号: string) => {
    try {
      const d = await productionApi.get(生产单号);
      setPicked({ 款号: d.单头?.款号, 款式: d.单头?.款式 });
    } catch { message.error("加载生产制单详情失败"); }
  };

  const setLine = (i: number, patch: Partial<OutLineDto>) =>
    setLines(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    let v: { 生产单号?: string; 加工厂编号: string; 仓库?: string; 床号?: string; 备注?: string };
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => !!l.加工项目 && Number(l.数量) > 0);
    if (ok.length === 0) { message.error("请至少录入一行有加工项目和数量的明细"); return; }
    const 加工厂名称 = factories.find(f => String(f.加工厂编号) === v.加工厂编号)?.加工厂名称;
    setSaving(true);
    try {
      await outsourcingApi.create({ ...v, 加工厂名称, ...picked, 明细: ok });
      message.success("发外派工单已创建"); onClose(); onCreated();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建派工单失败");
    } finally { setSaving(false); }
  };

  const columns = [
    { title: "加工项目", dataIndex: "加工项目", width: 170, render: (_: unknown, r: OutLineDto, i: number) =>
      <Select style={{ width: 160 }} value={r.加工项目 || undefined} placeholder="加工项目"
        onChange={(val: string) => setLine(i, { 加工项目: val })}
        options={items.map(it => ({ value: String(it.加工项目), label: String(it.加工项目) }))} /> },
    { title: "颜色", dataIndex: "颜色", width: 100, render: (_: unknown, r: OutLineDto, i: number) =>
      <Input style={{ width: 90 }} value={r.颜色 ?? ""} onChange={e => setLine(i, { 颜色: e.target.value })} /> },
    { title: "尺码", dataIndex: "尺码", width: 90, render: (_: unknown, r: OutLineDto, i: number) =>
      <Input style={{ width: 80 }} value={r.尺码 ?? ""} onChange={e => setLine(i, { 尺码: e.target.value })} /> },
    { title: "数量", dataIndex: "数量", width: 110, render: (_: unknown, r: OutLineDto, i: number) =>
      <InputNumber min={0} precision={0} style={{ width: 96 }} value={r.数量 ?? 0} onChange={n => setLine(i, { 数量: Number(n ?? 0) })} /> },
    { title: "", key: "_op", width: 50, render: (_: unknown, __: OutLineDto, i: number) =>
      <a onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>删除</a> },
  ];

  const 数量合计 = lines.reduce((a, l) => a + Number(l.数量 ?? 0), 0);

  return (
    <Drawer title="新建发外派工单" width={920} open={open} onClose={onClose}
      extra={<Button type="primary" loading={saving} onClick={submit}>保存</Button>}>
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="加工厂编号" label="加工厂" rules={[{ required: true, message: "请选择加工厂" }]}>
              <Select showSearch optionFilterProp="label"
                options={factories.map(f => ({ value: String(f.加工厂编号), label: `${f.加工厂编号} ${f.加工厂名称 ?? ""}` }))} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="生产单号" label="生产制单">
              <Select showSearch allowClear optionFilterProp="label" onChange={onOrderChange}
                options={orders.map(o => ({ value: String(o.生产单号), label: `${o.生产单号} ${o.款式 ?? ""}` }))} />
            </Form.Item>
          </Col>
          <Col span={8}><Form.Item label="款号"><Input value={`${picked.款号 ?? ""} ${picked.款式 ?? ""}`} disabled /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={6}><Form.Item name="仓库" label="仓库"><Input /></Form.Item></Col>
          <Col span={6}><Form.Item name="床号" label="床号"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="备注" label="备注"><Input /></Form.Item></Col>
        </Row>
      </Form>
      <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={lines} columns={columns} />
      <Space style={{ marginTop: 12 }} size={24}>
        <Button icon={<PlusOutlined />} onClick={() => setLines(prev => [...prev, { 加工项目: "", 数量: 0 }])}>加一行</Button>
        <Statistic title="发外数量合计" value={数量合计} />
      </Space>
    </Drawer>
  );
}
```

- [ ] **Step 7: 派工详情抽屉**

Create `web/src/pages/workshop/OutsourceDetailDrawer.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Descriptions, Drawer, Table, Tag, message } from "antd";
import { outsourcingApi, type OutDetail } from "../../api/outsourcing";

export default function OutsourceDetailDrawer({ 单号, onClose }: { 单号: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<OutDetail | null>(null);

  useEffect(() => {
    if (!单号) { setDetail(null); return; }
    (async () => {
      try { setDetail(await outsourcingApi.get(单号)); }
      catch { message.error("加载派工详情失败"); }
    })();
  }, [单号]);

  const h = detail?.单头;
  return (
    <Drawer title={`发外派工单 ${单号 ?? ""}`} width={820} open={!!单号} onClose={onClose}>
      {detail && (
        <>
          <Descriptions size="small" column={3} bordered style={{ marginBottom: 16 }}
            items={[
              { key: "no", label: "单号", children: h?.单号 ?? "-" },
              { key: "f", label: "加工厂", children: h?.加工厂名称 ?? h?.加工厂编号 ?? "-" },
              { key: "st", label: "状态", children: h?.审核 === "1" ? <Tag color="green">已审核</Tag> : <Tag>未审核</Tag> },
              { key: "wh", label: "仓库", children: h?.仓库 ?? "-" },
              { key: "qty", label: "发外数量", children: String(h?.数量 ?? "-") },
              { key: "amt", label: "金额", children: h?.金额 == null ? "***" : String(h?.金额) },
              { key: "memo", label: "备注", children: h?.备注 ?? "-" },
            ]} />
          <Table size="small" rowKey="id" pagination={false} dataSource={detail.明细}
            columns={[
              { title: "款号", dataIndex: "款号" }, { title: "加工项目", dataIndex: "加工项目" },
              { title: "颜色", dataIndex: "颜色" }, { title: "尺码", dataIndex: "尺码" },
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

- [ ] **Step 8: 派工列表页**

Create `web/src/pages/workshop/OutsourcePage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Popconfirm, Space, Table, Tag, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { outsourcingApi, type OutHeader } from "../../api/outsourcing";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import OutsourceCreateDrawer from "./OutsourceCreateDrawer";
import OutsourceDetailDrawer from "./OutsourceDetailDrawer";

const MENU = "发外加工";

export default function OutsourcePage() {
  const perms = usePerms();
  const [rows, setRows] = useState<OutHeader[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await outsourcingApi.list(page, 10, keyword); setRows(r.items); setTotal(r.total); }
    catch { message.error("加载发外派工单失败"); }
  }, [page, keyword]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); load(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const columns = [
    { title: "单号", dataIndex: "单号", key: "单号", render: (v: string) => <a className="erp-num" onClick={() => setViewing(v)}>{v}</a> },
    { title: "加工厂", dataIndex: "加工厂名称", key: "加工厂名称", render: (v?: string, r?: OutHeader) => v ?? r?.加工厂编号 },
    { title: "仓库", dataIndex: "仓库", key: "仓库" },
    { title: "发外数量", dataIndex: "数量", key: "数量" },
    { title: "金额", dataIndex: "金额", key: "金额", render: (v?: number | null) => (v == null ? "***" : v) },
    { title: "日期", dataIndex: "日期", key: "日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "状态", dataIndex: "审核", key: "审核",
      render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: OutHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => outsourcingApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => outsourcingApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该派工单?" onConfirm={() => act(() => outsourcingApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title="发外派工" variant="borderless"
      extra={
        <Space>
          <Input.Search placeholder="搜索单号/加工厂" allowClear onSearch={v => { setPage(1); setKeyword(v); }} style={{ width: 240 }} />
          {can(perms, MENU, "保存") && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建派工单</Button>}
        </Space>
      }>
      <Table rowKey="id" size="middle" dataSource={rows} columns={columns} scroll={{ x: true }}
        pagination={{ current: page, pageSize: 10, total, onChange: setPage, showTotal: t => `共 ${t} 条` }} />
      <OutsourceCreateDrawer open={creating} onClose={() => setCreating(false)} onCreated={load} />
      <OutsourceDetailDrawer 单号={viewing} onClose={() => setViewing(null)} />
    </Card>
  );
}
```

- [ ] **Step 9: 构建 + 测试**

Run: `npm --prefix web run test` → Expected: PASS（含 outsourcing 2 个）
Run: `npm --prefix web run build` → Expected: tsc 0 错误

（注：本任务页面尚未挂路由/菜单，Task 11 统一接线。tsc 仍会编译这些文件，0 错误即通过。）

- [ ] **Step 10: 提交**

```powershell
git add web/src/api/outsourcing.ts web/src/utils/outsourceLines.ts web/src/__tests__/outsourcing.test.ts web/src/pages/workshop/OutsourcePage.tsx web/src/pages/workshop/OutsourceCreateDrawer.tsx web/src/pages/workshop/OutsourceDetailDrawer.tsx
git commit -m @'
feat(P4): 前端发外派工页(选生产单/加工厂+录加工项目×色码明细+审核)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 9: 前端 — 发外回收页（选发外单 → 带出基准录回收数量 + 审核）

**Files:**
- Create: `web/src/pages/workshop/OutsourceReturnPage.tsx`

- [ ] **Step 1: 回收页**

Create `web/src/pages/workshop/OutsourceReturnPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, InputNumber, Popconfirm, Select, Space, Table, Tag, message } from "antd";
import { outsourcingApi, outReturnApi, type OutHeader, type OutReturnBasisRow, type OutReturnHeader, type OutReturnLineDto } from "../../api/outsourcing";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "发外回收";

interface BasisRow extends OutReturnBasisRow { 本次回收?: number }

export default function OutsourceReturnPage() {
  const perms = usePerms();
  const [dispatched, setDispatched] = useState<OutHeader[]>([]);   // 已审核派工单
  const [发外单号, set发外单号] = useState<string>();
  const [basis, setBasis] = useState<BasisRow[]>([]);
  const [rows, setRows] = useState<OutReturnHeader[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await outsourcingApi.list(1, 200);
        setDispatched(r.items.filter(o => o.审核 === "1"));
      } catch { message.error("加载派工单失败"); }
    })();
  }, []);

  const loadRows = useCallback(async () => {
    try { setRows((await outReturnApi.list(1, 50, 发外单号 ?? "")).items); }
    catch { message.error("加载回收单失败"); }
  }, [发外单号]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const onDispatchChange = async (v: string) => {
    set发外单号(v); setBasis([]);
    try {
      const b = await outReturnApi.basis(v);
      setBasis(b.map(x => ({ ...x, 本次回收: x.欠数 })));   // 默认回收数=欠数
    } catch { message.error("加载发外基准失败"); }
  };

  const setBasisQty = (i: number, val: number) =>
    setBasis(prev => prev.map((b, j) => (j === i ? { ...b, 本次回收: val } : b)));

  const submit = async () => {
    if (!发外单号) { message.error("请先选择发外单"); return; }
    const picked = dispatched.find(o => o.单号 === 发外单号);
    const 明细: OutReturnLineDto[] = basis
      .filter(b => Number(b.本次回收 ?? 0) > 0)
      .map(b => ({
        生产单号: b.生产单号, 款号: b.款号, 款式: b.款式, 加工项目: b.加工项目 ?? "",
        色号: b.色号, 颜色: b.颜色, 尺码: b.尺码, 发外数量: b.发外数量, 回收数量: Number(b.本次回收),
      }));
    if (明细.length === 0) { message.error("请录入至少一行回收数量"); return; }
    setSaving(true);
    try {
      await outReturnApi.create({
        发外单号, 加工厂编号: picked?.加工厂编号 ?? "", 加工厂名称: picked?.加工厂名称, 仓库: picked?.仓库, 明细,
      });
      message.success("发外回收单已创建"); setBasis([]); set发外单号(undefined); loadRows();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建回收单失败");
    } finally { setSaving(false); }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); loadRows(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const basisColumns = [
    { title: "款号", dataIndex: "款号" }, { title: "加工项目", dataIndex: "加工项目" },
    { title: "颜色", dataIndex: "颜色" }, { title: "尺码", dataIndex: "尺码" },
    { title: "发外数量", dataIndex: "发外数量" }, { title: "已回收", dataIndex: "已回收" },
    { title: "欠数", dataIndex: "欠数" },
    { title: "本次回收", key: "本次回收", render: (_: unknown, r: BasisRow, i: number) =>
      <InputNumber min={0} precision={0} value={r.本次回收 ?? 0} onChange={n => setBasisQty(i, Number(n ?? 0))} /> },
  ];

  const listColumns = [
    { title: "回收单号", dataIndex: "单号", key: "单号", render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "发外单号", dataIndex: "发外单号", key: "发外单号", render: (v?: string) => v && <span className="erp-num">{v}</span> },
    { title: "发外数量", dataIndex: "发外数量", key: "发外数量" },
    { title: "回收数量", dataIndex: "回收数量", key: "回收数量" },
    { title: "相差", dataIndex: "相差数量", key: "相差数量" },
    { title: "状态", dataIndex: "审核", key: "审核",
      render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: OutReturnHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => outReturnApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => outReturnApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该回收单?" onConfirm={() => act(() => outReturnApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title="发外回收" variant="borderless"
      extra={
        <Select showSearch optionFilterProp="label" placeholder="选择已审核发外单" style={{ width: 300 }}
          value={发外单号} onChange={onDispatchChange}
          options={dispatched.map(o => ({ value: String(o.单号), label: `${o.单号} ${o.加工厂名称 ?? ""}` }))} />
      }>
      {发外单号 && can(perms, MENU, "保存") && basis.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={basis} columns={basisColumns} />
          <Space style={{ marginTop: 12 }}>
            <Button type="primary" loading={saving} onClick={submit}>提交回收</Button>
          </Space>
        </div>
      )}
      <Table rowKey="id" size="middle" dataSource={rows} columns={listColumns} pagination={{ pageSize: 10 }} />
    </Card>
  );
}
```

- [ ] **Step 2: 构建确认**

Run: `npm --prefix web run build`
Expected: tsc 0 错误

- [ ] **Step 3: 提交**

```powershell
git add web/src/pages/workshop/OutsourceReturnPage.tsx
git commit -m @'
feat(P4): 前端发外回收页(选发外单带出基准+录回收数量+审核)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 10: 前端 — 发外对数页

**Files:**
- Create: `web/src/pages/workshop/OutsourceReconcilePage.tsx`

- [ ] **Step 1: 对数页**

Create `web/src/pages/workshop/OutsourceReconcilePage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Card, Select, Table, message } from "antd";
import { outsourcingApi, type OutHeader, type OutReconcileRow } from "../../api/outsourcing";

export default function OutsourceReconcilePage() {
  const [dispatched, setDispatched] = useState<OutHeader[]>([]);
  const [发外单号, set发外单号] = useState<string>();
  const [rows, setRows] = useState<OutReconcileRow[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await outsourcingApi.list(1, 200);
        setDispatched(r.items.filter(o => o.审核 === "1"));
      } catch { message.error("加载派工单失败"); }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!发外单号) { setRows([]); return; }
    try { setRows(await outsourcingApi.reconcile(发外单号)); }
    catch { message.error("加载发外对数失败"); }
  }, [发外单号]);
  useEffect(() => { load(); }, [load]);

  const columns = [
    { title: "款号", dataIndex: "款号" },
    { title: "加工项目", dataIndex: "加工项目" },
    { title: "发外数量", dataIndex: "发外数量" },
    { title: "回收数量", dataIndex: "回收数量" },
    { title: "相差数量", dataIndex: "相差数量" },
    { title: "单价", dataIndex: "单价", render: (v?: number | null) => (v == null ? "***" : v) },
    { title: "金额", dataIndex: "金额", render: (v?: number | null) => (v == null ? "***" : v) },
  ];

  return (
    <Card title="发外对数（按发外单 款×加工项目 核对发外/回收/相差）" variant="borderless"
      extra={
        <Select showSearch optionFilterProp="label" placeholder="选择已审核发外单" style={{ width: 300 }}
          value={发外单号} onChange={set发外单号}
          options={dispatched.map(o => ({ value: String(o.单号), label: `${o.单号} ${o.加工厂名称 ?? ""}` }))} />
      }>
      <Table rowKey={(r) => `${r.款号}|${r.加工项目}`} size="middle" dataSource={rows} columns={columns}
        pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }} />
    </Card>
  );
}
```

- [ ] **Step 2: 构建确认**

Run: `npm --prefix web run build`
Expected: tsc 0 错误

- [ ] **Step 3: 提交**

```powershell
git add web/src/pages/workshop/OutsourceReconcilePage.tsx
git commit -m @'
feat(P4): 前端发外对数页(选发外单看款×项目发外/回收/相差/金额)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 11: 前端 — 路由 + 发外加工菜单组

**Files:**
- Modify: `web/src/App.tsx`, `web/src/pages/MainLayout.tsx`

- [ ] **Step 1: App.tsx 加路由**

修改 `web/src/App.tsx`，import 三个页面（在 M6 的 workshop import 之后），并在 `piecework-summary` 路由之后加三条路由：

```tsx
import OutsourcePage from "./pages/workshop/OutsourcePage";
import OutsourceReturnPage from "./pages/workshop/OutsourceReturnPage";
import OutsourceReconcilePage from "./pages/workshop/OutsourceReconcilePage";
```

```tsx
          <Route path="outsourcing" element={<OutsourcePage />} />
          <Route path="outsourcing-returns" element={<OutsourceReturnPage />} />
          <Route path="outsourcing-reconcile" element={<OutsourceReconcilePage />} />
```

- [ ] **Step 2: MainLayout 加"发外加工"菜单组**

修改 `web/src/pages/MainLayout.tsx`：

import 加图标（在现有 `@ant-design/icons` import 里追加）：`SendOutlined, RollbackOutlined, ReconciliationOutlined`。

在现有 `wsChildren`（生产车间组）之后新增 `osChildren`，并把 `items` 数组追加"发外加工"组（在生产车间组之后）：

```tsx
  const osChildren = [
    ...(can(perms, "发外加工", "打开") ? [{ key: "/outsourcing", label: "发外派工", icon: <SendOutlined /> }] : []),
    ...(can(perms, "发外回收", "打开") ? [{ key: "/outsourcing-returns", label: "发外回收", icon: <RollbackOutlined /> }] : []),
    ...(can(perms, "发外对数", "打开") ? [{ key: "/outsourcing-reconcile", label: "发外对数", icon: <ReconciliationOutlined /> }] : []),
  ];
```

`items` 末尾追加（在生产车间组 `ws` 之后）：

```tsx
    ...(osChildren.length ? [{ key: "os", label: "发外加工", icon: <SendOutlined />, children: osChildren }] : []),
```

Header 标题判断链追加（在 M6 的 `/piecework` 分支之后）：

```tsx
              : loc.pathname.startsWith("/outsourcing-reconcile") ? "发外对数"
              : loc.pathname.startsWith("/outsourcing-returns") ? "发外回收"
              : loc.pathname.startsWith("/outsourcing") ? "发外派工"
```

（注意 `/outsourcing-reconcile` 与 `/outsourcing-returns` 判断要在 `/outsourcing` 之前，因为后者是前者的前缀。）

- [ ] **Step 3: 构建 + 测试**

Run: `npm --prefix web run test` → Expected: PASS（全部，含 outsourcing 2）
Run: `npm --prefix web run build` → Expected: tsc 0 错误

- [ ] **Step 4: 提交**

```powershell
git add web/src/App.tsx web/src/pages/MainLayout.tsx
git commit -m @'
feat(P4): 发外加工菜单组+路由(发外派工/发外回收/发外对数)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 12: 端到端验证（派工 → 回收 → 对数 + 截图）

无新功能代码（发现 bug 才修）。验证 M7 闭环：发外派工 → 发外回收 → 发外对数。

**Files:** 无（操作性任务）

- [ ] **Step 1: 全量回归**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
$env:ERP_JWT_KEY = [Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")
dotnet test
npm --prefix web run test
npm --prefix web run build
```
Expected: 后端全 PASS（0 跳过）、前端全 PASS、构建 0 错误。

- [ ] **Step 2: 确保开发库有演示前置数据**

E2E 复用生产制单 `SC20260603001`（款号 K001）。发外需要发外加工项目：

```powershell
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
Set-Content -Path tmp/seed-os-item.sql -Encoding UTF8 -Value "IF NOT EXISTS(SELECT 1 FROM [发外加工项目] WHERE [加工项目]=N'外发车缝') INSERT INTO [发外加工项目]([加工项目],[单价],[备注]) VALUES(N'外发车缝',2.5,N'演示');"
dotnet run --project tools/DbDeploy -- "$env:ERP_DB" tmp/seed-os-item.sql
```

确认 `SELECT COUNT(*) FROM 加工厂资料` ≥ 1（派工要选加工厂；若空，先经基础资料→加工厂资料 UI 建一个，或种一行 `INSERT INTO 加工厂资料([加工厂编号],[加工厂名称]) VALUES(N'F001',N'演示加工厂')`）。记录实际所用加工厂编号。

- [ ] **Step 3: 启动前后端**

```powershell
Get-Process -Name ErpApi -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Process -FilePath "dotnet" -ArgumentList "run --project src/ErpApi --urls http://localhost:5000" -WorkingDirectory "D:\WebpageERP" -WindowStyle Hidden
Start-Process -FilePath "cmd" -ArgumentList "/c npm --prefix web run dev -- --host --port 5173" -WorkingDirectory "D:\WebpageERP" -WindowStyle Hidden
Start-Sleep -Seconds 15
```

- [ ] **Step 4: puppeteer 走 M7 主线（每步截图）**

写 `tmp/shot/p4m7-e2e.cjs`（headless:'new'，viewport 1440×900，executablePath 指向本机 Chrome；`.cjs` 扩展名）完成（admin/admin123，Task 7 已授权 P4 M7 四菜单）：
1. 登录 → 发外加工 → 发外派工 → 新建：选加工厂 → 选生产制单 SC20260603001 → 加一行（加工项目"外发车缝"/颜色黑色/尺码M/数量100）→ 保存 → 列表点"审核" → 截图 `tmp/p4m7-1-dispatch.png`
2. 发外加工 → 发外回收 → 选刚才的发外单 → 基准带出（欠数100）→ 本次回收改 95 → 提交回收 → 列表点"审核" → 截图 `tmp/p4m7-2-return.png`
3. 发外加工 → 发外对数 → 选该发外单 → 显示 外发车缝/发外100/回收95/相差5/金额237.5 → 截图 `tmp/p4m7-3-reconcile.png`

puppeteer 要点（照搬 `tmp/shot/p4-e2e.cjs`）：antd v6 Select 先 mousedown 控件再等 `.ant-select-item-option` 渲染再点；每步操作后 `await new Promise(r=>setTimeout(r,800))`；失败先截图存档再退出。CHROME 路径用双反斜杠 `C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe`。UI 卡住时记录卡点，用绕过代理的 .NET HttpClient/Node 经 API 补验 M7 核心命题（派工创建+审核、回收+审核、对数 GROUP BY），确保核心被证实后如实报告。

- [ ] **Step 5: 数据库验证对数口径**

对 erp 库（dbquery 工具直连，不受代理影响）验证该发外单的对数：
```powershell
dotnet run --project tmp/dbquery -- "$env:ERP_DB" "SELECT d.单号 发外单, SUM(d.数量) 发外, (SELECT ISNULL(SUM(rd.数量),0) FROM 发外回收明细单 rd JOIN 发外回收单 rh ON rh.单号=rd.单号 AND ISNULL(rh.审核,'0')='1' WHERE rd.发外单号=d.单号) 回收 FROM 发外加工明细单 d JOIN 发外加工单 h ON h.单号=d.单号 AND ISNULL(h.审核,'0')='1' GROUP BY d.单号"
```
记录实际结果（发外 100、回收 95、相差 5）。

- [ ] **Step 6: 清理 + 收尾**

停服务（Stop-Process ErpApi；关 node dev）。删 `tmp/seed-os-item.sql`（临时）。演示单据保留在 erp 开发库。确认：
```powershell
git status
git log --oneline master..HEAD
```
Expected: 工作树干净（tmp/ 截图不计）；分支领先 master 约 13 个提交（spec 1 + Task 1–11 各 1 + 本任务 0）。汇报后由 finishing-a-development-branch 决定合并。

---

## Self-Review 结论

**Spec 覆盖检查**（对照 `2026-06-05-p4-m7-outsourcing-design.md`）：
- ✅ 发外加工项目费率主数据（P1 泛型 CRUD，单价成本保密）：Task 2
- ✅ 发外派工（发外加工单+明细，两层 Dapper 事务，前缀 FW，单价取发外加工项目）：Task 3（Service）+ Task 4（Controller）+ Task 8（前端）
- ✅ 发外回收（发外回收单+明细，按发外单带出基准/欠数/累计回收）：Task 5（Service）+ Task 6（Controller）+ Task 9（前端）
- ✅ 发外对数（只读 GROUP BY 聚合，独立菜单脱敏）：Task 3（ReconcileAsync）+ Task 4（端点）+ Task 10（前端）
- ✅ DB 05 脚本（发外加工单/发外回收单补审核留痕列）+ 审核引擎用例：Task 1
- ✅ 横切复用：单号①（FW/FH）、审核②（白名单已含，05 补留痕列）、权限审计④（所有端点）、成本保密（派工/回收明细+对数 单价/金额脱敏）
- ✅ 权限种子（发外加工项目/发外加工/发外回收/发外对数）：Task 7
- ✅ 菜单组+路由：Task 11；端到端验证：Task 12

**明确延后（spec 已记录）**：加工费付款/扣款/结款（→P6）、三层总单矩阵层、委托发外加工单扎号条码、回写生产单（无对应列）。

**类型/签名一致性检查**：
- `OutsourceService`：`CreateAsync/ListAsync/GetAsync/DeleteAsync/ReconcileAsync`（Task 3 定义，Task 4 控制器调用一致）✅
- `OutsourceReturnService`：`BasisAsync/CreateAsync/ListAsync/GetAsync/DeleteAsync`（Task 5 定义，Task 6 控制器调用一致）✅
- DocType/前缀：派工 `发外加工单`/`FW`、回收 `发外回收单`/`FH`，与 PostableDocuments 白名单（单号列="单号"）一致 ✅
- 单价来源 `发外加工项目`（Task 2 主数据）：Task 3 取价 SQL 与 P4M7TestData 种的 P4车缝(2.5) 一致；测试断言 60×2.5=150、100×2.5、95×2.5=237.5 自洽 ✅
- 前端 `outsourcingApi`/`outReturnApi`（Task 8）字段与后端 DTO 对齐；`productionApi.get().单头`、`masterApi("factories"/"outsource-items")` 复用 ✅
- `sumQty/validOutsourceLines`（Task 8 utils）被测试共用 ✅
- 菜单名一致：权限菜单 `发外加工`(派工)/`发外回收`/`发外对数`/`发外加工项目`，前后端 + 种子脚本统一 ✅

**已知简化与理由**：
1. 派工/回收只做 头+明细 两层，跳过遗留「总单」矩阵层——两层足以表达 加工项目×色码 发外，矩阵打包列属展示优化。
2. 对数只读聚合（不写 `发外加工对数表`）——核对口径用实时 GROUP BY 表达，扣款/结款属结算（P6）。
3. 回收按 发外单号 约定串联派工（无 FK，schema 既有）；欠数=发外−累计已审核回收，按 (加工项目,颜色,尺码) 匹配。
4. 单头按加工厂编号兜底清理（发外加工单无生产单号列），测试库加工厂 P4F01 仅本套用。
