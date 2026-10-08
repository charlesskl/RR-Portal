# P3 物料侧（M5 采购→入仓→领料）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让物料库存真正动起来——实现物料库存汇总服务（算法1 首次正式落地，UNION 符号法），以及采购入仓单 / 领料单 / 退料单 三张动库存单据的录入与审核过账；审核后物料库存由汇总服务实时反映，并把 P2 生产制单的缺料计算接到这个统一的库存服务上。

**Architecture:** 核心是 `MaterialInventoryService`（引擎③物料口径）：物料库存 = 采购入仓明细(+) + 退料明细(+) − 领料明细(−)，按 `物料编号×仓库` 汇总，**只认审核='1'** 的单——单据本身不维护库存余额，库存是审核单的实时聚合（与 P0 成品库存引擎同哲学）。三张单据（单头+物料明细两层，明细主从 FK 串联）复用 P2 的 Dapper 事务服务模式（单号引擎①生成、审核走引擎②、权限审计走引擎④、成本保密后端落实）。前端因三张物料单据高度同构（同一套物料明细行），用**配置驱动的通用物料单据组件**承载，外加一个物料库存查询页。

**Tech Stack:** .NET 8 ASP.NET Core, Dapper（库存汇总/单据事务）, EF Core（无新增实体）, SQL Server LocalDB (erp/erp_test, Chinese_PRC_CI_AS), xUnit + WebApplicationFactory + Xunit.SkippableFact, React 18 + TS + Vite + Ant Design v6 + Vitest.

---

## 前置约定（所有任务通用）

- 工作目录 `D:\WebpageERP`，分支策略由执行技能决定（P0/P1/P2 都是建特性分支→合并 master）。Windows 用 PowerShell；`dotnet` 不在 PATH 时刷新：`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 集成测试需环境变量（shell 为空时）：`$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")`、`$env:ERP_JWT_KEY = [Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")`。开发库 `$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")`。
- 跑后端测试：仓库根 `dotnet test`；单类 `dotnet test --filter "FullyQualifiedName~MaterialInventoryDbTests"`。前端：`npm --prefix web run test`、`npm --prefix web run build`。
- **本机有系统代理 127.0.0.1:7892**：PowerShell `Invoke-RestMethod` 打本地 API 会被劫持失败；冒烟用 `HttpClientHandler.UseProxy=false` 的 .NET HttpClient 或 Node 脚本（axios 不走系统代理）。浏览器自动化不受影响。
- 提交规范：commit 末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。Windows 上 git 报 LF→CRLF 警告正常。
- **已有可复用件（P0–P2 交付，直接 DI 注入）**：
  - `ISqlConnectionFactory.Create()` → `SqlConnection`
  - `IDocumentNumberGenerator.NextAsync(docType, prefix, bizDate, conn, tx)` → `"前缀+yyyyMMdd+3位流水"`
  - `IPostingEngine.ApproveAsync(table, docNo, user)` / `UnapproveAsync(...)`（`成品入仓单`…`采购入仓单`/`领料单`/`退料单` 都在 `PostableDocuments` 白名单，单号列均为 `单号`）
  - `IPermissionService.HasAsync(user, menu, PermissionAction)`，`PermissionAction` = 打开/保存/删除/打印/单价/金额/审核/反审核/功能
  - `IAuditLogger.WriteAsync(表名, 行为, 操作员, 记录, SqlConnection, SqlTransaction?)`
  - `PagedResult<T>(IReadOnlyList<T> Items, int Total)`（namespace `ErpApi.Features.MasterData`）
  - 测试：`DbFixture`（`[Collection("db")]`、`fx.Open()`、`fx.ConnectionString`、`fx.Available`）、`JwtTokenService.Issue(user)`
  - 前端：`api`(axios)、`masterApi(resource)`、`Paged<T>`（`web/src/api/master.ts` 已导出）、`can`/`hidePrice`、`usePerms()`
  - **参考实现（照搬其模式）**：`src/ErpApi/Features/Orders/OrderService.cs` + `OrderController.cs`（两层单据 Dapper 事务 + REST + 审核 + 成本保密的范本）；`src/ErpApi/Engines/Inventory/InventorySummaryService.cs`（成品库存 UNION 符号法范本）；`src/ErpApi/Features/Production/ProductionService.cs` 的 `MaterialStockAsync`（P2 内联的物料库存查询，本计划 Task 2 把它接到新服务）；前端 `web/src/pages/orders/`（列表+抽屉范本）。
- **JSON 大小写**：C# `ID` → JSON `"id"`（camelCase）；中文属性名不受影响；`PagedResult` → `items`/`total`。前端 rowKey 用 `id`。

### P3 涉及表的真实结构（以 `db/01_rebuild_schema.sql` / `02_rebuild_relations.sql` 为准）

**三张单据都是「单头 + 物料明细」两层，明细 `单号` 主从 FK → 单头 `单号`（单头单号有 UNIQUE）。插入顺序：单头→明细；删除顺序：明细→单头。**

- `采购入仓单`(单头)：单号,订单单号,日期,供应商编号,供应商名称,生产单号,款号,付款方式,仓库,数量,金额,操作员,审核,备注（03脚本已加 审核人/审核日期）
- `采购入仓明细单`(明细)：单号,订单单号,生产单号,款号,合同号,客户款号,日期,供应商编号,供应商名称,仓库,物料类别,条码号,物料编号,物料名称,批号,规格,颜色,单位,数量,单价,金额,备注,付款方式,预算数量,预算单价（FK：单号主从→采购入仓单；款号→款号总表(可空)；生产单号→生产制单(可空)）
- `领料单`(单头)：单号,日期,生产单号,款号,领料部门,领料人,仓库,数量,金额,操作员,审核,备注（03脚本已加 审核人/审核日期）
- `领料明细单`(明细)：单号,日期,生产单号,款号,合同号,客户款号,领料部门,领料人,仓库,物料类别,条码号,物料编号,物料名称,批号,规格,颜色,单位,数量,库存单价,库存金额,单价,金额,备注,类型,预算数量,预算单价（FK：单号主从→领料单；款号→款号总表(可空)；生产单号→生产制单(可空)）
- `退料单`(单头)：单号,日期,生产单号,退料部门,退料人,仓库,数量,金额,操作员,审核,备注（03脚本已加 审核人/审核日期）
- `退料明细单`(明细)：单号,日期,生产单号,款号,合同号,客户款号,退料部门,退料人,仓库,物料类别,条码号,物料编号,物料名称,规格,颜色,单位,数量,库存单价,库存金额,单价,金额,备注,预算数量,预算单价（FK：单号主从→退料单；款号→款号总表(可空)；生产单号→生产制单(可空)）

**关键设计约束**：
1. 三张单据**不写任何库存余额表**。库存是 `MaterialInventoryService` 对已审核明细单的实时 UNION 聚合。"物料库存动起来"= 审核单据后汇总查询自动反映。
2. 库存方向（物料口径）：采购入仓明细 `+数量`、退料明细 `+数量`（生产退回的料回库）、领料明细 `−数量`（生产领走）。本计划范围（核心四件）不含采购退仓。
3. 库存维度：`物料编号 × 仓库`，规格/单位/物料名称 取 `MAX` 展示。
4. 明细的 `款号`/`生产单号` 是可空查找 FK——测试种子里**不填**（留 NULL）以免触发 FK；前端可选填。
5. 三单据明细行字段几乎相同（物料编号/名称/规格/颜色/单位/数量/单价/金额），共用一个 `MaterialDocLineDto`。单头差异：采购入仓有 供应商/付款方式；领料有 领料部门/领料人；退料有 退料部门/退料人。
6. 中文做 C# 标识符合法。路由 ASCII（`api/purchase-receipts`、`api/material-issues`、`api/material-returns`、`api/material-inventory`），菜单名/表名用中文。

---

## 文件结构

```
src/ErpApi/
├─ Engines/Inventory/
│  ├─ MaterialStockRow.cs          新:物料库存行(物料编号/名称/规格/单位/仓库/库存数量)
│  ├─ IMaterialInventoryService.cs 新:物料库存汇总接口
│  └─ MaterialInventoryService.cs  新:算法1物料口径(UNION符号法,StockOfAsync单物料+ListAsync列表)
├─ Features/
│  ├─ Materials/
│  │  ├─ MaterialDocLineDto.cs     新:物料明细行DTO(三单据共用)
│  │  ├─ PurchaseReceipt/          采购入仓单
│  │  │  ├─ PurchaseReceiptDtos.cs
│  │  │  ├─ PurchaseReceiptService.cs
│  │  │  └─ PurchaseReceiptController.cs
│  │  ├─ MaterialIssue/            领料单
│  │  │  ├─ MaterialIssueDtos.cs
│  │  │  ├─ MaterialIssueService.cs
│  │  │  └─ MaterialIssueController.cs
│  │  ├─ MaterialReturn/           退料单
│  │  │  ├─ MaterialReturnDtos.cs
│  │  │  ├─ MaterialReturnService.cs
│  │  │  └─ MaterialReturnController.cs
│  │  └─ MaterialInventoryController.cs  物料库存查询端点
│  └─ Production/ProductionService.cs    改:MaterialStockAsync 调用 MaterialInventoryService
└─ Program.cs                      改:注册 MaterialInventoryService + 3个单据Service

db/seed_p3_perms.sql               新:admin 授权 采购入仓/领料/退料/物料库存 菜单

web/src/
├─ api/
│  ├─ materialDocs.ts              新:通用物料单据API工厂(按resource)
│  └─ materialInventory.ts         新:物料库存查询API
├─ pages/materials/
│  ├─ materialDocConfigs.ts        新:采购入仓/领料/退料 的单头字段+resource+菜单配置
│  ├─ MaterialLineTable.tsx        新:物料明细行编辑表(三单据共用)
│  ├─ MaterialDocPage.tsx          新:配置驱动的物料单据列表页(列表+审核+删除)
│  ├─ MaterialDocCreateDrawer.tsx  新:配置驱动的新建抽屉(单头表单+明细行表)
│  ├─ MaterialDocDetailDrawer.tsx  新:配置驱动的详情抽屉
│  ├─ MaterialDocRouter.tsx        新:按 :doc 参数渲染对应配置的页面
│  └─ MaterialInventoryPage.tsx    新:物料库存查询页(按仓库/物料搜索)
├─ pages/MainLayout.tsx            改:业务单据组+物料管理组菜单
└─ App.tsx                         改:+物料单据/库存查询 路由

tests/ErpApi.Tests/
├─ MaterialInventoryDbTests.cs     新:算法1符号法(入+/退+/领−,仅审核单,分仓库)
├─ PurchaseReceiptServiceDbTests.cs 新
├─ MaterialIssueServiceDbTests.cs   新
├─ MaterialReturnServiceDbTests.cs  新
├─ P3TestData.cs                   新:P3测试种子(物料+三单据)+清理
└─ P3ApiIntegrationTests.cs        新:三单据API权限/审核/脱敏 + 库存查询API
web/src/__tests__/materialDocs.test.ts  新:明细行合计/校验纯函数测试
```

---

## Task 1: 物料库存汇总服务（算法1 物料口径，UNION 符号法）

P3 的核心引擎。`物料编号 × 仓库` 维度，只认审核='1'，采购入仓(+)/退料(+)/领料(−)。提供两个方法：`StockOfAsync`（单物料全仓库存，事务内，给 P2 缺料计算复用）和 `ListAsync`（库存查询页用，自开连接）。两者共享同一段 UNION 子查询常量（单一真相源）。

**Files:**
- Create: `src/ErpApi/Engines/Inventory/MaterialStockRow.cs`, `src/ErpApi/Engines/Inventory/IMaterialInventoryService.cs`, `src/ErpApi/Engines/Inventory/MaterialInventoryService.cs`
- Modify: `src/ErpApi/Program.cs`
- Test: `tests/ErpApi.Tests/MaterialInventoryDbTests.cs`

- [ ] **Step 1: 写失败的测试**

Create `tests/ErpApi.Tests/MaterialInventoryDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.Inventory;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class MaterialInventoryDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private MaterialInventoryService Svc() => new(Factory());

    // 种 3 张已审核单据 + 1 张未审核单据，验证符号法与"只认审核"
    private void Seed(Microsoft.Data.SqlClient.SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位],[单价]) VALUES(N'P3M01',N'P3面料',N'规格A',N'米',10)");
        // 采购入仓 100(已审核) → 库存 +100
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核]) VALUES(N'P3RK01',N'物料仓','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'P3RK01',N'物料仓',N'P3M01',N'P3面料',N'规格A',N'米',100)");
        // 领料 30(已审核) → 库存 −30
        c.Execute("INSERT INTO [领料单]([单号],[仓库],[审核]) VALUES(N'P3LL01',N'物料仓','1')");
        c.Execute(@"INSERT INTO [领料明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'P3LL01',N'物料仓',N'P3M01',N'P3面料',N'规格A',N'米',30)");
        // 退料 5(已审核) → 库存 +5
        c.Execute("INSERT INTO [退料单]([单号],[仓库],[审核]) VALUES(N'P3TL01',N'物料仓','1')");
        c.Execute(@"INSERT INTO [退料明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'P3TL01',N'物料仓',N'P3M01',N'P3面料',N'规格A',N'米',5)");
        // 未审核领料 999(审核='0') → 不计入
        c.Execute("INSERT INTO [领料单]([单号],[仓库],[审核]) VALUES(N'P3LL99',N'物料仓','0')");
        c.Execute(@"INSERT INTO [领料明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'P3LL99',N'物料仓',N'P3M01',N'P3面料',N'规格A',N'米',999)");
    }

    private void Cleanup(Microsoft.Data.SqlClient.SqlConnection c)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号]=N'P3M01'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN (N'P3RK01')");
        c.Execute("DELETE FROM [领料明细单] WHERE [物料编号]=N'P3M01'");
        c.Execute("DELETE FROM [领料单] WHERE [单号] IN (N'P3LL01',N'P3LL99')");
        c.Execute("DELETE FROM [退料明细单] WHERE [物料编号]=N'P3M01'");
        c.Execute("DELETE FROM [退料单] WHERE [单号] IN (N'P3TL01')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'P3M01'");
    }

    [SkippableFact]
    public async Task StockOf_applies_signs_and_only_counts_approved()
    {
        using var c = fx.Open();
        Seed(c);
        // 库存 = 入100 + 退5 − 领30 = 75（未审核的领料 999 不计）
        var stock = await Svc().StockOfAsync("P3M01", null);
        Assert.Equal(75m, stock);
        Cleanup(c);
    }

    [SkippableFact]
    public async Task List_groups_by_material_and_warehouse_with_nonzero_filter()
    {
        using var c = fx.Open();
        Seed(c);
        var rows = await Svc().ListAsync(仓库: null, keyword: "P3M01");
        var row = Assert.Single(rows);
        Assert.Equal("P3M01", row.物料编号);
        Assert.Equal("物料仓", row.仓库);
        Assert.Equal(75m, row.库存数量);
        Assert.Equal("规格A", row.规格);
        Cleanup(c);
    }

    [SkippableFact]
    public async Task List_filters_by_warehouse()
    {
        using var c = fx.Open();
        Seed(c);
        Assert.Empty(await Svc().ListAsync(仓库: "不存在仓", keyword: "P3M01"));
        Assert.Single(await Svc().ListAsync(仓库: "物料仓", keyword: "P3M01"));
        Cleanup(c);
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~MaterialInventoryDbTests"`
Expected: FAIL（编译错误：MaterialInventoryService / MaterialStockRow 不存在）

- [ ] **Step 3: 写 MaterialStockRow**

Create `src/ErpApi/Engines/Inventory/MaterialStockRow.cs`:

```csharp
namespace ErpApi.Engines.Inventory;
public sealed class MaterialStockRow
{
    public string 物料编号 { get; set; } = "";
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public string? 仓库 { get; set; }
    public decimal 库存数量 { get; set; }
}
```

- [ ] **Step 4: 写接口**

Create `src/ErpApi/Engines/Inventory/IMaterialInventoryService.cs`:

```csharp
using Microsoft.Data.SqlClient;
namespace ErpApi.Engines.Inventory;
public interface IMaterialInventoryService
{
    // 单物料全仓库存（缺料计算用）；可传入已打开的连接+事务以参与上层事务，传 null 则自开连接。
    Task<decimal> StockOfAsync(string 物料编号, (SqlConnection conn, SqlTransaction tx)? scope);
    // 库存查询列表（按仓库/物料关键字过滤），物料编号×仓库 汇总，仅非零。
    Task<IReadOnlyList<MaterialStockRow>> ListAsync(string? 仓库, string? keyword);
}
```

- [ ] **Step 5: 实现服务**

Create `src/ErpApi/Engines/Inventory/MaterialInventoryService.cs`:

```csharp
using Dapper;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
namespace ErpApi.Engines.Inventory;

// 算法1（物料口径）：物料库存 = 采购入仓(+) + 退料(+) − 领料(−)，仅审核='1'，按 物料编号×仓库 汇总。
// 单据不维护余额——库存是已审核明细单的实时聚合（与成品库存引擎 InventorySummaryService 同哲学）。
public sealed class MaterialInventoryService(ISqlConnectionFactory factory) : IMaterialInventoryService
{
    // 三表符号法子查询（单一真相源；StockOfAsync 与 ListAsync 共用）。审核标志在单头，明细 JOIN 单头。
    private const string LedgerUnion = @"
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量] AS 数量
    FROM [采购入仓明细单] d JOIN [采购入仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]
    FROM [退料明细单] d JOIN [退料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [领料明细单] d JOIN [领料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'";

    public async Task<decimal> StockOfAsync(string 物料编号, (SqlConnection conn, SqlTransaction tx)? scope)
    {
        if (string.IsNullOrEmpty(物料编号)) return 0;
        var sql = $"SELECT ISNULL(SUM([数量]),0) FROM ({LedgerUnion}) t WHERE [物料编号]=@物料编号";
        if (scope is { } s)
            return await s.conn.ExecuteScalarAsync<decimal?>(sql, new { 物料编号 }, s.tx) ?? 0;
        using var c = factory.Create();
        return await c.ExecuteScalarAsync<decimal?>(sql, new { 物料编号 }) ?? 0;
    }

    public async Task<IReadOnlyList<MaterialStockRow>> ListAsync(string? 仓库, string? keyword)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var wh = string.IsNullOrWhiteSpace(仓库) ? null : 仓库.Trim();
        var sql = $@"
SELECT [物料编号], MAX([物料名称]) AS 物料名称, MAX([规格]) AS 规格, MAX([单位]) AS 单位,
       [仓库], SUM([数量]) AS 库存数量
FROM ({LedgerUnion}) t
WHERE (@wh IS NULL OR [仓库]=@wh)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw)
GROUP BY [物料编号],[仓库]
HAVING SUM([数量]) <> 0
ORDER BY [物料编号],[仓库]";
        using var c = factory.Create();
        var rows = await c.QueryAsync<MaterialStockRow>(sql, new { wh, kw });
        return rows.AsList();
    }
}
```

- [ ] **Step 6: Program.cs 注册**

在 `src/ErpApi/Program.cs` 的 `// 4 横切引擎` 区块（`builder.Services.AddScoped<IInventorySummaryService, InventorySummaryService>();` 之后）追加：

```csharp
builder.Services.AddScoped<IMaterialInventoryService, MaterialInventoryService>();
```

- [ ] **Step 7: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~MaterialInventoryDbTests"`
Expected: PASS 3 个

- [ ] **Step 8: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Engines/Inventory/ src/ErpApi/Program.cs tests/ErpApi.Tests/MaterialInventoryDbTests.cs
git commit -m @'
feat(P3): 物料库存汇总服务(算法1物料口径,UNION符号法,仅审核单)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 生产制单缺料计算接入物料库存服务（消除重复 SQL）

P2 的 `ProductionService.MaterialStockAsync` 内联了一段与 Task 1 完全相同符号的库存 SQL。本任务删掉它，改调 `IMaterialInventoryService.StockOfAsync`，统一真相源。库存符号不变（采购入仓+/退料+/领料−），P2 的缺料测试必须保持通过。

**Files:**
- Modify: `src/ErpApi/Features/Production/ProductionService.cs`
- Test: `tests/ErpApi.Tests/ProductionServiceDbTests.cs`（不改测试，靠它回归验证行为不变）

- [ ] **Step 1: 先确认现状**

Run: `Get-Content D:\WebpageERP\src\ErpApi\Features\Production\ProductionService.cs`
看清 `ProductionService` 的构造签名（当前 `(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)`）、`MaterialStockAsync` 的实现、`ExpandBomAsync` 里调用 `MaterialStockAsync(c, tx, b.物料编号)` 的位置。

- [ ] **Step 2: 改构造注入库存服务**

把 `ProductionService` 的主构造改为注入 `IMaterialInventoryService`：

```csharp
public sealed class ProductionService(
    ISqlConnectionFactory factory,
    IDocumentNumberGenerator docNo,
    ErpApi.Engines.Inventory.IMaterialInventoryService inventory)
{
```

（文件顶部已 `using ErpApi.Infrastructure.Db;` 等；`IMaterialInventoryService` 用全限定名或加 `using ErpApi.Engines.Inventory;`。）

- [ ] **Step 3: ExpandBomAsync 改调共享服务**

在 `ExpandBomAsync` 里，把原来的 `var 库存数量 = await MaterialStockAsync(c, tx, b.物料编号);` 改为：

```csharp
            var 库存数量 = await inventory.StockOfAsync(b.物料编号 ?? "", (c, tx));
```

- [ ] **Step 4: 删除内联的 MaterialStockAsync**

删掉 `ProductionService` 里整个 `private static async Task<decimal> MaterialStockAsync(SqlConnection c, SqlTransaction tx, string? 物料编号) { ... }` 方法（含其上方注释）。其符号逻辑已由 `MaterialInventoryService` 承载。

- [ ] **Step 5: 修测试里手动 new 的 ProductionService**

`tests/ErpApi.Tests/ProductionServiceDbTests.cs` 里 `Svc()` 手动 new 了 `ProductionService`。改为也传库存服务：

```csharp
    private ProductionService Svc() =>
        new(Factory(), new DocumentNumberGenerator(),
            new ErpApi.Engines.Inventory.MaterialInventoryService(Factory()));
```

（`OrderServiceDbTests` 里若也 new 了 ProductionService 需同样处理；其他 new OrderService 的不受影响。）

- [ ] **Step 6: 跑生产制单测试确认行为不变**

Run: `dotnet test --filter "FullyQualifiedName~ProductionServiceDbTests"`
Expected: PASS 6 个（含 `Create_bom_deducts_material_stock_when_available`——证明重构后缺料扣减仍正确）

- [ ] **Step 7: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Production/ProductionService.cs tests/ErpApi.Tests/ProductionServiceDbTests.cs
git commit -m @'
refactor(P3): 生产制单缺料计算复用物料库存服务(删除重复SQL)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 采购入仓单 Service + 共享明细 DTO + P3 测试种子

采购入仓是物料库存的 (+) 来源。两层单据（单头 `采购入仓单` + 明细 `采购入仓明细单`，明细主从 FK→单头）。Dapper 事务创建/分页/详情/删除，单号前缀 `CG`。本任务还建三单据共用的 `MaterialDocLineDto` 和 P3 测试种子 `P3TestData`。

**Files:**
- Create: `src/ErpApi/Features/Materials/MaterialDocLineDto.cs`, `src/ErpApi/Features/Materials/PurchaseReceipt/PurchaseReceiptDtos.cs`, `src/ErpApi/Features/Materials/PurchaseReceipt/PurchaseReceiptService.cs`, `tests/ErpApi.Tests/P3TestData.cs`
- Modify: `src/ErpApi/Program.cs`
- Test: `tests/ErpApi.Tests/PurchaseReceiptServiceDbTests.cs`

- [ ] **Step 1: 写共享明细行 DTO**

Create `src/ErpApi/Features/Materials/MaterialDocLineDto.cs`:

```csharp
namespace ErpApi.Features.Materials;

// 物料明细行（采购入仓/领料/退料 三单据共用）
public sealed class MaterialDocLineDto
{
    public long ID { get; set; }            // 读出用；创建时忽略
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}
```

- [ ] **Step 2: 写采购入仓 DTO**

Create `src/ErpApi/Features/Materials/PurchaseReceipt/PurchaseReceiptDtos.cs`:

```csharp
using ErpApi.Features.Materials;
namespace ErpApi.Features.Materials.PurchaseReceipt;

public sealed class PurchaseReceiptCreateDto
{
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 付款方式 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public List<MaterialDocLineDto> 明细 { get; set; } = [];
}

public sealed class PurchaseReceiptHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 仓库 { get; set; }
    public string? 付款方式 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PurchaseReceiptDetailDto
{
    public PurchaseReceiptHeaderDto? 单头 { get; set; }
    public List<MaterialDocLineDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 3: 写 P3 测试种子**

Create `tests/ErpApi.Tests/P3TestData.cs`（物料无 FK 约束于明细，但种它便于库存查询与真实性；供应商单头无 FK，种它供前端选择参考）:

```csharp
using Dapper;
using Microsoft.Data.SqlClient;

// P3 测试共用种子：物料 P3M01(面料,单价10)/P3M02(纽扣,单价0.5)、供应商 P3S01。
// 三张物料单据(采购入仓/领料/退料)的明细 物料编号 非 FK，但用真实物料更贴近生产；
// 明细 款号/生产单号 是可空查找 FK，测试一律不填(NULL)避免触发。
public static class P3TestData
{
    public const string 物料1 = "P3M01";
    public const string 物料2 = "P3M02";
    public const string 供应商编号 = "P3S01";
    public const string 仓库 = "物料仓";

    public static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位],[单价]) VALUES(N'P3M01',N'P3面料',N'规格A',N'米',10)");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位],[单价]) VALUES(N'P3M02',N'P3纽扣',N'规格B',N'粒',0.5)");
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'P3S01',N'P3测试供应商')");
    }

    // 三单据单号前缀：采购入仓 CG / 领料 LL / 退料 TL。删单据(明细→单头)再删主数据。
    public static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号] LIKE N'CG%' AND [供应商编号]=N'P3S01'");
        c.Execute("DELETE FROM [领料明细单] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
        c.Execute("DELETE FROM [领料单] WHERE [单号] LIKE N'LL%'");
        c.Execute("DELETE FROM [退料明细单] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
        c.Execute("DELETE FROM [退料单] WHERE [单号] LIKE N'TL%'");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'P3S01'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
    }
}
```

注意：`Cleanup` 用 `[单号] LIKE N'CG%'` 等清理，可能误删其它 CG 前缀单。为隔离，测试种入的单号都用固定测试单号（见下），`Cleanup` 改为只删测试用到的固定单号更安全——但单号由引擎动态生成无法预知。折中：测试创建后记录返回的单号，自行精确删除该单号的明细+单头，`P3TestData.Cleanup` 只负责删主数据(物料/供应商)。**因此各测试模式为：`Seed` → 操作并记录单号 → 用记录的单号精确清理单据 → `Cleanup` 清主数据。** 把上面 `Cleanup` 里三段 `DELETE FROM [...明细单]/[...单]` 删除，只保留删 供应商资料 / 物料资料 两句（明细的物料编号过滤那两句保留作兜底亦可，但单头删除按前缀不可靠——移除单头的按前缀删除）。最终 `Cleanup` 如下：

```csharp
    public static void Cleanup(SqlConnection c)
    {
        // 单据由各测试用其返回的单号精确清理；此处兜底清明细(按测试物料)+删主数据
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
        c.Execute("DELETE FROM [领料明细单] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
        c.Execute("DELETE FROM [退料明细单] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'P3S01'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
    }
```

（兜底删明细在删主数据前，避免残留；单头由测试精确删。若某次测试异常未删单头，下次 Seed 不受影响，因为单头不引用 P3M01/供应商。）

- [ ] **Step 4: 写失败的 Service 测试**

Create `tests/ErpApi.Tests/PurchaseReceiptServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Materials;
using ErpApi.Features.Materials.PurchaseReceipt;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PurchaseReceiptServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PurchaseReceiptService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static PurchaseReceiptCreateDto Dto() => new()
    {
        供应商编号 = P3TestData.供应商编号, 供应商名称 = "P3测试供应商",
        仓库 = P3TestData.仓库, 付款方式 = "月结",
        明细 =
        [
            new MaterialDocLineDto { 物料编号 = "P3M01", 物料名称 = "P3面料", 规格 = "规格A", 单位 = "米", 数量 = 100, 单价 = 10 },
            new MaterialDocLineDto { 物料编号 = "P3M02", 物料名称 = "P3纽扣", 规格 = "规格B", 单位 = "粒", 数量 = 200, 单价 = 0.5m },
        ]
    };

    [SkippableFact]
    public async Task Create_writes_header_and_lines_with_totals()
    {
        using var c = fx.Open();
        P3TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("CG", 单号);
            // 数量合计 = 100+200 = 300；金额合计 = 100×10 + 200×0.5 = 1100
            Assert.Equal(300m, c.ExecuteScalar<decimal>("SELECT [数量] FROM [采购入仓单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal(1100m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [采购入仓单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal(2, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [采购入仓明细单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal(1000m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [采购入仓明细单] WHERE [单号]=@单号 AND [物料编号]=N'P3M01'", new { 单号 }));
            Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [采购入仓单] WHERE [单号]=@单号", new { 单号 }));
        }
        finally
        {
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c);
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
        P3TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            var page = await Svc().ListAsync(1, 20, 单号);
            Assert.Equal(1, page.Total);
            Assert.Equal(单号, page.Items[0].单号);

            var detail = await Svc().GetAsync(单号);
            Assert.NotNull(detail);
            Assert.Equal(2, detail!.明细.Count);

            // 已审核不能删
            c.Execute("UPDATE [采购入仓单] SET [审核]='1' WHERE [单号]=@单号", new { 单号 });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
            // 反审核后可删，两层全清
            c.Execute("UPDATE [采购入仓单] SET [审核]='0' WHERE [单号]=@单号", new { 单号 });
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [采购入仓单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [采购入仓明细单] WHERE [单号]=@单号", new { 单号 }));
            Assert.False(await Svc().DeleteAsync("CG不存在"));
        }
        finally
        {
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 5: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~PurchaseReceiptServiceDbTests"`
Expected: FAIL（编译错误 PurchaseReceiptService 不存在）

- [ ] **Step 6: 实现 PurchaseReceiptService**

Create `src/ErpApi/Features/Materials/PurchaseReceipt/PurchaseReceiptService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
namespace ErpApi.Features.Materials.PurchaseReceipt;

// 采购入仓单（物料库存 + 来源）。两层：采购入仓单 + 采购入仓明细单（明细主从 FK→单头）。
// 单据不写库存余额——审核后由 MaterialInventoryService 实时聚合。
public sealed class PurchaseReceiptService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "采购入仓单";
    public const string Prefix = "CG";   // 采购入仓单号 = CG + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(PurchaseReceiptCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("采购入仓单至少要有一行物料明细");

        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [采购入仓单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[付款方式],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@供应商编号,@供应商名称,@仓库,@付款方式,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.供应商编号, dto.供应商名称, dto.仓库, dto.付款方式,
                  数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [采购入仓明细单]([单号],[日期],[仓库],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@日期,@仓库,@物料类别,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, 日期 = now, dto.仓库, l.物料类别, l.物料编号, l.物料名称, l.规格, l.颜色, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注 }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PurchaseReceiptHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [采购入仓单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商编号] LIKE @kw OR [供应商名称] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[日期],[供应商编号],[供应商名称],[仓库],[付款方式],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [采购入仓单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商编号] LIKE @kw OR [供应商名称] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PurchaseReceiptHeaderDto>()).AsList();
        return new PagedResult<PurchaseReceiptHeaderDto>(items, total);
    }

    public async Task<PurchaseReceiptDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[供应商编号],[供应商名称],[仓库],[付款方式],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [采购入仓单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[物料类别],[规格],[颜色],[单位],[数量],[单价],[金额],[备注]
FROM [采购入仓明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PurchaseReceiptHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<MaterialDocLineDto>()).AsList();
        return new PurchaseReceiptDetailDto { 单头 = header, 明细 = lines };
    }

    // 删除：仅未审核可删；FK 顺序 明细→单头
    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [采购入仓单] WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的采购入仓单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [采购入仓明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [采购入仓单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 7: Program.cs 注册**

在 `src/ErpApi/Program.cs` 的 `// 业务` 区块追加：

```csharp
builder.Services.AddScoped<ErpApi.Features.Materials.PurchaseReceipt.PurchaseReceiptService>();
```

- [ ] **Step 8: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~PurchaseReceiptServiceDbTests"`
Expected: PASS 3 个

- [ ] **Step 9: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Materials/ src/ErpApi/Program.cs tests/ErpApi.Tests/P3TestData.cs tests/ErpApi.Tests/PurchaseReceiptServiceDbTests.cs
git commit -m @'
feat(P3): 采购入仓单服务(单头+明细Dapper事务)+共享明细DTO+P3种子

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: 采购入仓单 Controller（REST + 审核 + 成本保密）+ 库存联动集成测试

**Files:**
- Create: `src/ErpApi/Features/Materials/PurchaseReceipt/PurchaseReceiptController.cs`
- Test: `tests/ErpApi.Tests/P3ApiIntegrationTests.cs`

- [ ] **Step 1: 写失败的 API 集成测试（含"审核后库存动起来"验证）**

Create `tests/ErpApi.Tests/P3ApiIntegrationTests.cs`（仿 `P2ApiIntegrationTests.cs`）:

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
public class P3ApiIntegrationTests(DbFixture fx)
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
        供应商编号 = P3TestData.供应商编号, 供应商名称 = "P3测试供应商", 仓库 = P3TestData.仓库, 付款方式 = "月结",
        明细 = new[]
        {
            new { 物料编号 = "P3M01", 物料名称 = "P3面料", 规格 = "规格A", 单位 = "米", 数量 = 100, 单价 = 10 },
            new { 物料编号 = "P3M02", 物料名称 = "P3纽扣", 规格 = "规格B", 单位 = "粒", 数量 = 200, 单价 = 0.5 },
        }
    };

    [SkippableFact]
    public async Task Receipt_create_forbidden_without_save_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P3TestData.Seed(c); }
        SeedPerms("p3viewer", "采购入仓单", open: true, save: false);
        var resp = await Client(app, "p3viewer").PostAsJsonAsync("/api/purchase-receipts", ReceiptBody());
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P3TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Receipt_lifecycle_create_approve_unapprove_delete()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P3TestData.Seed(c); }
        SeedPerms("p3rk", "采购入仓单", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        var client = Client(app, "p3rk");

        var create = await client.PostAsJsonAsync("/api/purchase-receipts", ReceiptBody());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            var list = await client.GetFromJsonAsync<JsonElement>($"/api/purchase-receipts?keyword={单号}");
            Assert.Equal(1, list.GetProperty("total").GetInt32());
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/purchase-receipts/{单号}/approve", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsync($"/api/purchase-receipts/{单号}/approve", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/purchase-receipts/{单号}")).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/purchase-receipts/{单号}/unapprove", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/purchase-receipts/{单号}")).StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Receipt_amounts_masked_without_单价_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P3TestData.Seed(c); }
        SeedPerms("p3rkeditor", "采购入仓单", open: true, save: true, price: true);
        var editor = Client(app, "p3rkeditor");
        var create = await editor.PostAsJsonAsync("/api/purchase-receipts", ReceiptBody());
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            SeedPerms("p3rknoprice", "采购入仓单", open: true, price: false);
            var viewer = Client(app, "p3rknoprice");
            var list = await viewer.GetFromJsonAsync<JsonElement>($"/api/purchase-receipts?keyword={单号}");
            Assert.Equal(JsonValueKind.Null, list.GetProperty("items").EnumerateArray().First().GetProperty("金额").ValueKind);
            var detail = await viewer.GetFromJsonAsync<JsonElement>($"/api/purchase-receipts/{单号}");
            Assert.Equal(JsonValueKind.Null, detail.GetProperty("单头").GetProperty("金额").ValueKind);
            Assert.Equal(JsonValueKind.Null, detail.GetProperty("明细")[0].GetProperty("单价").ValueKind);
            // 有权限者可见
            var d2 = await editor.GetFromJsonAsync<JsonElement>($"/api/purchase-receipts/{单号}");
            Assert.Equal(10m, d2.GetProperty("明细")[0].GetProperty("单价").GetDecimal());
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c);
        }
    }
}
```

说明：本任务的 3 个测试只覆盖采购入仓 CRUD/审核/脱敏，**不依赖** `/api/material-inventory`。"审核后库存动起来"的端到端联动测试统一放在 Task 7（库存端点实现后）。

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~P3ApiIntegrationTests"`
Expected: 三个测试 FAIL（/api/purchase-receipts 404，控制器未实现）

- [ ] **Step 3: 实现 PurchaseReceiptController**

Create `src/ErpApi/Features/Materials/PurchaseReceipt/PurchaseReceiptController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Materials.PurchaseReceipt;

[ApiController]
[Authorize]
[Route("api/purchase-receipts")]
public sealed class PurchaseReceiptController(
    PurchaseReceiptService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "采购入仓单";
    private const string Table = "采购入仓单";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    // 审计在业务事务提交后写入(不参与回滚)——与 MasterCrudController 同一项目级权衡
    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }

    // 成本保密：无"单价"权限剥离单头金额 + 明细单价/金额
    private static void MaskDetail(PurchaseReceiptDetailDto d)
    {
        if (d.单头 is not null) d.单头.金额 = null;
        foreach (var l in d.明细) { l.单价 = null; l.金额 = null; }
    }

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(page, size, keyword);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var h in result.Items) h.金额 = null;
        return Ok(result);
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号);
        if (d is null) return NotFound();
        if (!await AllowAsync(PermissionAction.单价)) MaskDetail(d);
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] PurchaseReceiptCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "关联数据不存在(供应商/款号/生产单号)。" }); }
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

- [ ] **Step 4: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~P3ApiIntegrationTests"`
Expected: PASS 3 个

- [ ] **Step 5: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Materials/PurchaseReceipt/PurchaseReceiptController.cs tests/ErpApi.Tests/P3ApiIntegrationTests.cs
git commit -m @'
feat(P3): 采购入仓单REST接口(审核过账+成本保密)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: 领料单 Service + Controller（物料库存 − 方向）

领料是物料库存的 (−) 去向。结构与采购入仓完全同构（两层、Dapper 事务、审核、成本保密），差异：单头字段是 领料部门/领料人（无供应商）、单号前缀 `LL`、表名/菜单为 `领料单`。库存方向由 `MaterialInventoryService` 统一处理（领料明细 `−数量`），单据本身不写库存。

**Files:**
- Create: `src/ErpApi/Features/Materials/MaterialIssue/MaterialIssueDtos.cs`, `src/ErpApi/Features/Materials/MaterialIssue/MaterialIssueService.cs`, `src/ErpApi/Features/Materials/MaterialIssue/MaterialIssueController.cs`
- Modify: `src/ErpApi/Program.cs`
- Test: `tests/ErpApi.Tests/MaterialIssueServiceDbTests.cs`, `tests/ErpApi.Tests/P3ApiIntegrationTests.cs`（追加）

- [ ] **Step 1: 写领料 DTO**

Create `src/ErpApi/Features/Materials/MaterialIssue/MaterialIssueDtos.cs`:

```csharp
using ErpApi.Features.Materials;
namespace ErpApi.Features.Materials.MaterialIssue;

public sealed class MaterialIssueCreateDto
{
    public string? 领料部门 { get; set; }
    public string? 领料人 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public List<MaterialDocLineDto> 明细 { get; set; } = [];
}

public sealed class MaterialIssueHeaderDto
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
}

public sealed class MaterialIssueDetailDto
{
    public MaterialIssueHeaderDto? 单头 { get; set; }
    public List<MaterialDocLineDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 2: 写失败的 Service 测试**

Create `tests/ErpApi.Tests/MaterialIssueServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Materials;
using ErpApi.Features.Materials.MaterialIssue;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class MaterialIssueServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private MaterialIssueService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static MaterialIssueCreateDto Dto() => new()
    {
        领料部门 = "车间一", 领料人 = "张三", 仓库 = P3TestData.仓库,
        明细 = [ new MaterialDocLineDto { 物料编号 = "P3M01", 物料名称 = "P3面料", 规格 = "规格A", 单位 = "米", 数量 = 30, 单价 = 10 } ]
    };

    [SkippableFact]
    public async Task Create_then_Get_then_Delete()
    {
        using var c = fx.Open();
        P3TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("LL", 单号);
            Assert.Equal(30m, c.ExecuteScalar<decimal>("SELECT [数量] FROM [领料单] WHERE [单号]=@单号", new { 单号 }));
            Assert.Equal(300m, c.ExecuteScalar<decimal>("SELECT [金额] FROM [领料单] WHERE [单号]=@单号", new { 单号 }));
            var detail = await Svc().GetAsync(单号);
            Assert.Single(detail!.明细);
            Assert.Equal("车间一", detail.单头!.领料部门);
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [领料明细单] WHERE [单号]=@单号", new { 单号 }));
        }
        finally
        {
            c.Execute("DELETE FROM [领料明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [领料单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Create_rejects_empty_lines()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var dto = Dto(); dto.明细 = [];
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(dto, "tester"));
    }
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~MaterialIssueServiceDbTests"`
Expected: FAIL（MaterialIssueService 不存在）

- [ ] **Step 4: 实现 MaterialIssueService**

Create `src/ErpApi/Features/Materials/MaterialIssue/MaterialIssueService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
namespace ErpApi.Features.Materials.MaterialIssue;

// 领料单（物料库存 − 去向）。两层：领料单 + 领料明细单。库存方向由 MaterialInventoryService 统一处理。
public sealed class MaterialIssueService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "领料单";
    public const string Prefix = "LL";   // 领料单号 = LL + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(MaterialIssueCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("领料单至少要有一行物料明细");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [领料单]([单号],[日期],[领料部门],[领料人],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@领料部门,@领料人,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.领料部门, dto.领料人, dto.仓库,
                  数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [领料明细单]([单号],[日期],[仓库],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@日期,@仓库,@物料类别,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, 日期 = now, dto.仓库, l.物料类别, l.物料编号, l.物料名称, l.规格, l.颜色, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注 }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<MaterialIssueHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [领料单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [领料部门] LIKE @kw OR [领料人] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[日期],[领料部门],[领料人],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [领料单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [领料部门] LIKE @kw OR [领料人] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<MaterialIssueHeaderDto>()).AsList();
        return new PagedResult<MaterialIssueHeaderDto>(items, total);
    }

    public async Task<MaterialIssueDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[领料部门],[领料人],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [领料单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[物料类别],[规格],[颜色],[单位],[数量],[单价],[金额],[备注]
FROM [领料明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<MaterialIssueHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<MaterialDocLineDto>()).AsList();
        return new MaterialIssueDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [领料单] WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的领料单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [领料明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [领料单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 5: 实现 MaterialIssueController**

Create `src/ErpApi/Features/Materials/MaterialIssue/MaterialIssueController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Materials.MaterialIssue;

[ApiController]
[Authorize]
[Route("api/material-issues")]
public sealed class MaterialIssueController(
    MaterialIssueService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "领料单";
    private const string Table = "领料单";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }

    private static void MaskDetail(MaterialIssueDetailDto d)
    {
        if (d.单头 is not null) d.单头.金额 = null;
        foreach (var l in d.明细) { l.单价 = null; l.金额 = null; }
    }

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(page, size, keyword);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var h in result.Items) h.金额 = null;
        return Ok(result);
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号);
        if (d is null) return NotFound();
        if (!await AllowAsync(PermissionAction.单价)) MaskDetail(d);
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] MaterialIssueCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
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

- [ ] **Step 6: Program.cs 注册**

在 `// 业务` 区块追加：

```csharp
builder.Services.AddScoped<ErpApi.Features.Materials.MaterialIssue.MaterialIssueService>();
```

- [ ] **Step 7: 追加领料 API 集成测试**

在 `tests/ErpApi.Tests/P3ApiIntegrationTests.cs` 追加（复用已有 Factory/SeedPerms/Client 辅助）：

```csharp
    private static object IssueBody() => new
    {
        领料部门 = "车间一", 领料人 = "张三", 仓库 = P3TestData.仓库,
        明细 = new[] { new { 物料编号 = "P3M01", 物料名称 = "P3面料", 规格 = "规格A", 单位 = "米", 数量 = 30, 单价 = 10 } }
    };

    [SkippableFact]
    public async Task Issue_lifecycle_with_permissions()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P3TestData.Seed(c); }
        SeedPerms("p3llviewer", "领料单", open: true, save: false);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await Client(app, "p3llviewer").PostAsJsonAsync("/api/material-issues", IssueBody())).StatusCode);

        SeedPerms("p3ll", "领料单", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        var client = Client(app, "p3ll");
        var create = await client.PostAsJsonAsync("/api/material-issues", IssueBody());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/material-issues/{单号}/approve", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/material-issues/{单号}")).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/material-issues/{单号}/unapprove", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/material-issues/{单号}")).StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [领料明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [领料单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c);
        }
    }
```

- [ ] **Step 8: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~MaterialIssueServiceDbTests|FullyQualifiedName~P3ApiIntegrationTests"`
Expected: 全 PASS（领料 Service 2 + P3Api 原 3 + 领料 1）

- [ ] **Step 9: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Materials/MaterialIssue/ src/ErpApi/Program.cs tests/ErpApi.Tests/MaterialIssueServiceDbTests.cs tests/ErpApi.Tests/P3ApiIntegrationTests.cs
git commit -m @'
feat(P3): 领料单服务+REST接口(物料库存−去向)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 6: 退料单 Service + Controller（物料库存 + 方向）

退料是生产退回物料、库存的 (+)。结构同采购入仓/领料，差异：单头字段 退料部门/退料人、单号前缀 `TL`、表名/菜单 `退料单`。

**Files:**
- Create: `src/ErpApi/Features/Materials/MaterialReturn/MaterialReturnDtos.cs`, `src/ErpApi/Features/Materials/MaterialReturn/MaterialReturnService.cs`, `src/ErpApi/Features/Materials/MaterialReturn/MaterialReturnController.cs`
- Modify: `src/ErpApi/Program.cs`
- Test: `tests/ErpApi.Tests/MaterialReturnServiceDbTests.cs`, `tests/ErpApi.Tests/P3ApiIntegrationTests.cs`（追加）

- [ ] **Step 1: 写退料 DTO**

Create `src/ErpApi/Features/Materials/MaterialReturn/MaterialReturnDtos.cs`:

```csharp
using ErpApi.Features.Materials;
namespace ErpApi.Features.Materials.MaterialReturn;

public sealed class MaterialReturnCreateDto
{
    public string? 退料部门 { get; set; }
    public string? 退料人 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public List<MaterialDocLineDto> 明细 { get; set; } = [];
}

public sealed class MaterialReturnHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 退料部门 { get; set; }
    public string? 退料人 { get; set; }
    public string? 仓库 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class MaterialReturnDetailDto
{
    public MaterialReturnHeaderDto? 单头 { get; set; }
    public List<MaterialDocLineDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 2: 写失败的 Service 测试**

Create `tests/ErpApi.Tests/MaterialReturnServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Materials;
using ErpApi.Features.Materials.MaterialReturn;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class MaterialReturnServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private MaterialReturnService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static MaterialReturnCreateDto Dto() => new()
    {
        退料部门 = "车间一", 退料人 = "李四", 仓库 = P3TestData.仓库,
        明细 = [ new MaterialDocLineDto { 物料编号 = "P3M01", 物料名称 = "P3面料", 规格 = "规格A", 单位 = "米", 数量 = 5, 单价 = 10 } ]
    };

    [SkippableFact]
    public async Task Create_then_Get_then_Delete()
    {
        using var c = fx.Open();
        P3TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("TL", 单号);
            Assert.Equal(5m, c.ExecuteScalar<decimal>("SELECT [数量] FROM [退料单] WHERE [单号]=@单号", new { 单号 }));
            var detail = await Svc().GetAsync(单号);
            Assert.Single(detail!.明细);
            Assert.Equal("车间一", detail.单头!.退料部门);
            Assert.True(await Svc().DeleteAsync(单号));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [退料明细单] WHERE [单号]=@单号", new { 单号 }));
        }
        finally
        {
            c.Execute("DELETE FROM [退料明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [退料单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Create_rejects_empty_lines()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var dto = Dto(); dto.明细 = [];
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(dto, "tester"));
    }
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~MaterialReturnServiceDbTests"`
Expected: FAIL（MaterialReturnService 不存在）

- [ ] **Step 4: 实现 MaterialReturnService**

Create `src/ErpApi/Features/Materials/MaterialReturn/MaterialReturnService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
namespace ErpApi.Features.Materials.MaterialReturn;

// 退料单（物料库存 + 回库）。两层：退料单 + 退料明细单。库存方向由 MaterialInventoryService 统一处理。
public sealed class MaterialReturnService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "退料单";
    public const string Prefix = "TL";   // 退料单号 = TL + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(MaterialReturnCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("退料单至少要有一行物料明细");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [退料单]([单号],[日期],[退料部门],[退料人],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@退料部门,@退料人,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.退料部门, dto.退料人, dto.仓库,
                  数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [退料明细单]([单号],[日期],[仓库],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@日期,@仓库,@物料类别,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, 日期 = now, dto.仓库, l.物料类别, l.物料编号, l.物料名称, l.规格, l.颜色, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注 }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<MaterialReturnHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [退料单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [退料部门] LIKE @kw OR [退料人] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[日期],[退料部门],[退料人],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [退料单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [退料部门] LIKE @kw OR [退料人] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<MaterialReturnHeaderDto>()).AsList();
        return new PagedResult<MaterialReturnHeaderDto>(items, total);
    }

    public async Task<MaterialReturnDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[退料部门],[退料人],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [退料单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[物料类别],[规格],[颜色],[单位],[数量],[单价],[金额],[备注]
FROM [退料明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<MaterialReturnHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<MaterialDocLineDto>()).AsList();
        return new MaterialReturnDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [退料单] WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的退料单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [退料明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [退料单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 5: 实现 MaterialReturnController**

Create `src/ErpApi/Features/Materials/MaterialReturn/MaterialReturnController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Materials.MaterialReturn;

[ApiController]
[Authorize]
[Route("api/material-returns")]
public sealed class MaterialReturnController(
    MaterialReturnService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "退料单";
    private const string Table = "退料单";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }

    private static void MaskDetail(MaterialReturnDetailDto d)
    {
        if (d.单头 is not null) d.单头.金额 = null;
        foreach (var l in d.明细) { l.单价 = null; l.金额 = null; }
    }

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(page, size, keyword);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var h in result.Items) h.金额 = null;
        return Ok(result);
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号);
        if (d is null) return NotFound();
        if (!await AllowAsync(PermissionAction.单价)) MaskDetail(d);
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] MaterialReturnCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
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

- [ ] **Step 6: Program.cs 注册**

在 `// 业务` 区块追加：

```csharp
builder.Services.AddScoped<ErpApi.Features.Materials.MaterialReturn.MaterialReturnService>();
```

- [ ] **Step 7: 追加退料 API 集成测试**

在 `tests/ErpApi.Tests/P3ApiIntegrationTests.cs` 追加：

```csharp
    private static object ReturnBody() => new
    {
        退料部门 = "车间一", 退料人 = "李四", 仓库 = P3TestData.仓库,
        明细 = new[] { new { 物料编号 = "P3M01", 物料名称 = "P3面料", 规格 = "规格A", 单位 = "米", 数量 = 5, 单价 = 10 } }
    };

    [SkippableFact]
    public async Task Return_lifecycle_with_permissions()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P3TestData.Seed(c); }
        SeedPerms("p3tlviewer", "退料单", open: true, save: false);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await Client(app, "p3tlviewer").PostAsJsonAsync("/api/material-returns", ReturnBody())).StatusCode);

        SeedPerms("p3tl", "退料单", open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        var client = Client(app, "p3tl");
        var create = await client.PostAsJsonAsync("/api/material-returns", ReturnBody());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;
        try
        {
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/material-returns/{单号}/approve", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/material-returns/{单号}/unapprove", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/material-returns/{单号}")).StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [退料明细单] WHERE [单号]=@单号", new { 单号 });
            c.Execute("DELETE FROM [退料单] WHERE [单号]=@单号", new { 单号 });
            P3TestData.Cleanup(c);
        }
    }
```

- [ ] **Step 8: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~MaterialReturnServiceDbTests|FullyQualifiedName~P3ApiIntegrationTests"`
Expected: 全 PASS

- [ ] **Step 9: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Materials/MaterialReturn/ src/ErpApi/Program.cs tests/ErpApi.Tests/MaterialReturnServiceDbTests.cs tests/ErpApi.Tests/P3ApiIntegrationTests.cs
git commit -m @'
feat(P3): 退料单服务+REST接口(物料库存+回库)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 7: 物料库存查询端点 + 三单据库存联动测试 + 权限种子 + 后端收尾

把 `MaterialInventoryService` 暴露为查询端点；用一个端到端测试证明 P3 的核心命题——"审核单据后物料库存动起来"（入+领−退+，反审核回退）；给 admin 授权 P3 四个菜单。

**Files:**
- Create: `src/ErpApi/Features/Materials/MaterialInventoryController.cs`, `db/seed_p3_perms.sql`
- Test: `tests/ErpApi.Tests/P3ApiIntegrationTests.cs`（追加库存联动测试）

- [ ] **Step 1: 写失败的库存联动集成测试**

在 `tests/ErpApi.Tests/P3ApiIntegrationTests.cs` 追加（依赖前面已实现的三单据 + 本任务的库存端点）：

```csharp
    [SkippableFact]
    public async Task Material_inventory_reflects_approved_documents()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P3TestData.Seed(c); }
        const string u = "p3stock";
        SeedPerms(u, "采购入仓单", open: true, save: true, approve: true, unapprove: true);
        SeedPerms(u, "领料单", open: true, save: true, approve: true, unapprove: true);
        SeedPerms(u, "退料单", open: true, save: true, approve: true, unapprove: true);
        SeedPerms(u, "物料库存", open: true);
        var client = Client(app, u);
        string? rk = null, ll = null, tl = null;
        try
        {
            // 采购入仓 100、领料 30、退料 5，全部审核 → 库存 = 100 − 30 + 5 = 75
            rk = (await (await client.PostAsJsonAsync("/api/purchase-receipts", new {
                供应商编号 = P3TestData.供应商编号, 仓库 = P3TestData.仓库,
                明细 = new[] { new { 物料编号 = "P3M01", 物料名称 = "P3面料", 单位 = "米", 数量 = 100, 单价 = 10 } }
            })).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString();
            ll = (await (await client.PostAsJsonAsync("/api/material-issues", new {
                领料部门 = "车间一", 仓库 = P3TestData.仓库,
                明细 = new[] { new { 物料编号 = "P3M01", 物料名称 = "P3面料", 单位 = "米", 数量 = 30, 单价 = 10 } }
            })).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString();
            tl = (await (await client.PostAsJsonAsync("/api/material-returns", new {
                退料部门 = "车间一", 仓库 = P3TestData.仓库,
                明细 = new[] { new { 物料编号 = "P3M01", 物料名称 = "P3面料", 单位 = "米", 数量 = 5, 单价 = 10 } }
            })).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString();

            // 全未审核 → 库存查询无 P3M01
            var none = await client.GetFromJsonAsync<JsonElement>("/api/material-inventory?keyword=P3M01");
            Assert.Equal(0, none.GetArrayLength());

            await client.PostAsync($"/api/purchase-receipts/{rk}/approve", null);
            await client.PostAsync($"/api/material-issues/{ll}/approve", null);
            await client.PostAsync($"/api/material-returns/{tl}/approve", null);

            var stock = await client.GetFromJsonAsync<JsonElement>("/api/material-inventory?仓库=物料仓&keyword=P3M01");
            var row = stock.EnumerateArray().First(e => e.GetProperty("物料编号").GetString() == "P3M01");
            Assert.Equal(75m, row.GetProperty("库存数量").GetDecimal());
            Assert.Equal("物料仓", row.GetProperty("仓库").GetString());

            // 反审核领料 → 库存回到 105
            await client.PostAsync($"/api/material-issues/{ll}/unapprove", null);
            var stock2 = await client.GetFromJsonAsync<JsonElement>("/api/material-inventory?keyword=P3M01");
            Assert.Equal(105m, stock2.EnumerateArray().First().GetProperty("库存数量").GetDecimal());
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            foreach (var (tbl, det, no) in new[] { ("采购入仓单", "采购入仓明细单", rk), ("领料单", "领料明细单", ll), ("退料单", "退料明细单", tl) })
                if (no is not null)
                {
                    c.Execute($"DELETE FROM [{det}] WHERE [单号]=@no", new { no });
                    c.Execute($"DELETE FROM [{tbl}] WHERE [单号]=@no", new { no });
                }
            P3TestData.Cleanup(c);
        }
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~P3ApiIntegrationTests"`
Expected: `Material_inventory_reflects_approved_documents` FAIL（/api/material-inventory 404）；其余 PASS

- [ ] **Step 3: 实现 MaterialInventoryController**

Create `src/ErpApi/Features/Materials/MaterialInventoryController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Materials;

// 物料库存查询（算法1 实时聚合）。仅看库存数量，无价格字段，故只需"打开"权限。
[ApiController]
[Authorize]
[Route("api/material-inventory")]
public sealed class MaterialInventoryController(
    IMaterialInventoryService inventory, IPermissionService perms) : ControllerBase
{
    private const string Menu = "物料库存";
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(string? 仓库 = null, string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await inventory.ListAsync(仓库, keyword);
        return Ok(rows);
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~P3ApiIntegrationTests"`
Expected: 全 PASS（含库存联动）

- [ ] **Step 5: 写 P3 权限种子脚本**

Create `db/seed_p3_perms.sql`（仿 `db/seed_p2_perms.sql`；单据菜单审核/反审核位=1，物料库存只读给打开位）:

```sql
-- 开发用:给某用户授予 P3 物料菜单(采购入仓单/领料单/退料单/物料库存)权限。
-- 用法:把 @用户 改成你的登录名,在目标库执行。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'采购入仓单',N'领料单',N'退料单',N'物料库存');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'采购入仓单',1,1,1,1,1,1,1,1,1),
       (@用户,N'领料单',1,1,1,1,1,1,1,1,1),
       (@用户,N'退料单',1,1,1,1,1,1,1,1,1),
       (@用户,N'物料库存',1,0,0,1,1,1,0,0,1);
```

- [ ] **Step 6: 在开发库和测试库执行种子**

用 `tools/DbDeploy`（接受 `<连接串> <脚本路径>`）分别对两个库执行：

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
dotnet run --project tools/DbDeploy -- "$env:ERP_DB" db/seed_p3_perms.sql
dotnet run --project tools/DbDeploy -- "$env:ERP_TEST_DB" db/seed_p3_perms.sql
```

验收（两库都应返回 4）：`SELECT COUNT(*) FROM userbqrpower WHERE 用户='admin' AND 菜单 IN (N'采购入仓单',N'领料单',N'退料单',N'物料库存')`

- [ ] **Step 7: 后端全量回归**

Run: `dotnet test`
Expected: 全部 PASS，0 跳过（设了 ERP_TEST_DB 时）

- [ ] **Step 8: API 冒烟（绕过系统代理）**

后台启动后端（先 `Get-Process -Name ErpApi -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`），用 `HttpClientHandler{UseProxy=false}` 的 .NET HttpClient（或 Node axios）以 admin/admin123 登录后请求：

```
GET /api/purchase-receipts?page=1&size=5   → 200 {items,total}
GET /api/material-issues?page=1&size=5      → 200
GET /api/material-returns?page=1&size=5     → 200
GET /api/material-inventory                 → 200 []（空库存数组）
```

任何 403 都说明权限种子没在 erp 库生效——回 Step 6 检查。冒烟后停后端进程。

- [ ] **Step 9: 提交**

```powershell
git add src/ErpApi/Features/Materials/MaterialInventoryController.cs db/seed_p3_perms.sql tests/ErpApi.Tests/P3ApiIntegrationTests.cs
git commit -m @'
feat(P3): 物料库存查询端点+审核库存联动测试+P3权限种子

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 8: 前端 — 明细合计纯函数 + 通用物料单据组件 + 采购入仓配置

三张物料单据（采购入仓/领料/退料）UI 高度同构（同一套物料明细行），用**配置驱动的通用组件**承载：一份 `MaterialDocPage`/`CreateDrawer`/`DetailDrawer`，靠 `MATERIAL_DOC_CONFIGS[doc]` 区分单头字段/资源/菜单。本任务建全部通用件 + 三单据配置，路由接入留到 Task 9。

**前端编码规范（沿用 P2 沉淀）**：所有异步 try/catch + `message.error(err.response?.data?.消息 ?? 默认文案)`；基于前值的 setState 用函数式更新；不在渲染体重建 API 对象；TS 严格、`npm --prefix web run build` 0 错误。

**先读**：`web/src/api/master.ts`（`masterApi`/`Paged`）、`web/src/api/client.ts`、`web/src/pages/orders/OrdersPage.tsx` + `OrderCreateDrawer.tsx` + `OrderDetailDrawer.tsx`（列表/抽屉/审核/脱敏模式基准）、`web/src/auth/permissions.ts`、`web/src/components/QtyMatrix.tsx`。

**Files:**
- Create: `web/src/utils/materialLines.ts`, `web/src/api/materialDocs.ts`, `web/src/api/materialInventory.ts`, `web/src/pages/materials/materialDocConfigs.ts`, `web/src/pages/materials/MaterialLineTable.tsx`, `web/src/pages/materials/MaterialDocCreateDrawer.tsx`, `web/src/pages/materials/MaterialDocDetailDrawer.tsx`, `web/src/pages/materials/MaterialDocPage.tsx`
- Test: `web/src/__tests__/materialDocs.test.ts`

- [ ] **Step 1: 写失败的明细合计测试**

Create `web/src/__tests__/materialDocs.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { lineAmount, sumAmount, sumQty, validLines } from "../utils/materialLines";

describe("物料明细合计", () => {
  it("lineAmount = 数量×单价(单价空记0)", () => {
    expect(lineAmount({ 数量: 100, 单价: 10 })).toBe(1000);
    expect(lineAmount({ 数量: 5 })).toBe(0);
  });
  it("sumQty / sumAmount", () => {
    const lines = [{ 数量: 100, 单价: 10 }, { 数量: 200, 单价: 0.5 }];
    expect(sumQty(lines)).toBe(300);
    expect(sumAmount(lines)).toBe(1100);
  });
  it("validLines 过滤无物料编号或数量<=0 的行", () => {
    const lines = [
      { 物料编号: "M1", 数量: 1 }, { 物料编号: "", 数量: 5 }, { 物料编号: "M2", 数量: 0 },
    ];
    expect(validLines(lines)).toHaveLength(1);
    expect(validLines(lines)[0].物料编号).toBe("M1");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm --prefix web run test`
Expected: FAIL（materialLines 不存在）

- [ ] **Step 3: 实现明细合计纯函数**

Create `web/src/utils/materialLines.ts`:

```typescript
// 物料单据明细行（采购入仓/领料/退料 共用）
export interface DocLine {
  物料编号?: string; 物料名称?: string; 物料类别?: string;
  规格?: string; 颜色?: string; 单位?: string;
  数量?: number; 单价?: number | null; 金额?: number | null;
}

export const lineAmount = (l: { 数量?: number; 单价?: number | null }) =>
  Number(l.数量 ?? 0) * Number(l.单价 ?? 0);

export const sumQty = (lines: { 数量?: number }[]) =>
  lines.reduce((a, l) => a + Number(l.数量 ?? 0), 0);

export const sumAmount = (lines: { 数量?: number; 单价?: number | null }[]) =>
  lines.reduce((a, l) => a + lineAmount(l), 0);

// 提交前过滤：必须有物料编号且数量>0
export const validLines = (lines: DocLine[]) =>
  lines.filter(l => !!l.物料编号 && Number(l.数量 ?? 0) > 0);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm --prefix web run test`
Expected: PASS（原有 + materialDocs 3 个）

- [ ] **Step 5: 物料单据 API 工厂 + 库存 API**

Create `web/src/api/materialDocs.ts`:

```typescript
import { api } from "./client";
import type { Paged } from "./master";

export interface MaterialDocHeader {
  id: number; 单号?: string; 日期?: string;
  数量?: number | null; 金额?: number | null; 操作员?: string; 审核?: string; 审核人?: string; 备注?: string;
  [k: string]: unknown;   // 单头特有字段(供应商/领料部门/退料部门...)按配置读取
}
export interface MaterialDocDetail {
  单头: MaterialDocHeader | null;
  明细: {
    id: number; 物料编号?: string; 物料名称?: string; 物料类别?: string;
    规格?: string; 颜色?: string; 单位?: string; 数量?: number; 单价?: number | null; 金额?: number | null; 备注?: string;
  }[];
}

const enc = encodeURIComponent;

export function materialDocApi(resource: string) {
  const base = `/${resource}`;
  return {
    list: (page = 1, size = 20, keyword = "") =>
      api.get<Paged<MaterialDocHeader>>(base, { params: { page, size, keyword } }).then(r => r.data),
    get: (单号: string) => api.get<MaterialDocDetail>(`${base}/${enc(单号)}`).then(r => r.data),
    create: (body: Record<string, unknown>) => api.post<{ 单号: string }>(base, body).then(r => r.data),
    remove: (单号: string) => api.delete(`${base}/${enc(单号)}`),
    approve: (单号: string) => api.post(`${base}/${enc(单号)}/approve`),
    unapprove: (单号: string) => api.post(`${base}/${enc(单号)}/unapprove`),
  };
}
```

Create `web/src/api/materialInventory.ts`:

```typescript
import { api } from "./client";

export interface MaterialStockRow {
  物料编号: string; 物料名称?: string; 规格?: string; 单位?: string; 仓库?: string; 库存数量: number;
}

export const materialInventoryApi = {
  list: (仓库?: string, keyword?: string) =>
    api.get<MaterialStockRow[]>("/material-inventory", { params: { 仓库, keyword } }).then(r => r.data),
};
```

- [ ] **Step 6: 三单据配置**

Create `web/src/pages/materials/materialDocConfigs.ts`:

```typescript
export interface DocFieldCfg { name: string; label: string }
export interface MaterialDocCfg {
  resource: string;   // 路由段 + API 资源(purchase-receipts/material-issues/material-returns)
  menu: string;       // 权限菜单(采购入仓单/领料单/退料单)
  title: string;      // 采购入仓/领料/退料
  headerFields: DocFieldCfg[];   // 新建抽屉的单头字段
  listExtra: DocFieldCfg[];      // 列表里单头特有的额外列
}

export const MATERIAL_DOC_CONFIGS: Record<string, MaterialDocCfg> = {
  "purchase-receipts": {
    resource: "purchase-receipts", menu: "采购入仓单", title: "采购入仓",
    headerFields: [
      { name: "供应商编号", label: "供应商编号" }, { name: "供应商名称", label: "供应商名称" },
      { name: "付款方式", label: "付款方式" }, { name: "仓库", label: "仓库" }, { name: "备注", label: "备注" },
    ],
    listExtra: [{ name: "供应商名称", label: "供应商" }, { name: "仓库", label: "仓库" }],
  },
  "material-issues": {
    resource: "material-issues", menu: "领料单", title: "领料",
    headerFields: [
      { name: "领料部门", label: "领料部门" }, { name: "领料人", label: "领料人" },
      { name: "仓库", label: "仓库" }, { name: "备注", label: "备注" },
    ],
    listExtra: [{ name: "领料部门", label: "领料部门" }, { name: "领料人", label: "领料人" }, { name: "仓库", label: "仓库" }],
  },
  "material-returns": {
    resource: "material-returns", menu: "退料单", title: "退料",
    headerFields: [
      { name: "退料部门", label: "退料部门" }, { name: "退料人", label: "退料人" },
      { name: "仓库", label: "仓库" }, { name: "备注", label: "备注" },
    ],
    listExtra: [{ name: "退料部门", label: "退料部门" }, { name: "退料人", label: "退料人" }, { name: "仓库", label: "仓库" }],
  },
};
```

- [ ] **Step 7: 物料明细行编辑表（共用）**

Create `web/src/pages/materials/MaterialLineTable.tsx`:

```tsx
import { Button, InputNumber, Select, Table } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { lineAmount, type DocLine } from "../../utils/materialLines";

type MaterialOption = Record<string, unknown>;

// 受控物料明细行编辑表；物料编号选择后带出名称/规格/单位/单价
export default function MaterialLineTable({ materials, value, onChange, hidePriceCols }: {
  materials: MaterialOption[];
  value: DocLine[];
  onChange: (lines: DocLine[]) => void;
  hidePriceCols: boolean;
}) {
  const setLine = (i: number, patch: Partial<DocLine>) =>
    onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const pickMaterial = (i: number, 物料编号: string) => {
    const m = materials.find(x => String(x.物料编号) === 物料编号);
    setLine(i, {
      物料编号,
      物料名称: m?.物料名称 as string | undefined,
      物料类别: m?.物料类别 as string | undefined,
      规格: m?.规格 as string | undefined,
      单位: m?.单位 as string | undefined,
      单价: hidePriceCols ? null : ((m?.单价 as number | undefined) ?? null),
    });
  };

  const columns = [
    {
      title: "物料", dataIndex: "物料编号", width: 220,
      render: (_: unknown, r: DocLine, i: number) => (
        <Select showSearch optionFilterProp="label" style={{ width: 200 }} value={r.物料编号 || undefined}
          placeholder="选择物料" onChange={(v: string) => pickMaterial(i, v)}
          options={materials.map(m => ({ value: String(m.物料编号), label: `${m.物料编号} ${m.物料名称 ?? ""}` }))} />
      ),
    },
    { title: "规格", dataIndex: "规格", width: 110, render: (v: string) => v ?? "" },
    {
      title: "颜色", dataIndex: "颜色", width: 100,
      render: (_: unknown, r: DocLine, i: number) => (
        <Select allowClear style={{ width: 90 }} value={r.颜色 || undefined}
          onChange={(v?: string) => setLine(i, { 颜色: v })} options={[]} mode="tags" maxTagCount={1} />
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
      render: (_: unknown, __: DocLine, i: number) => <a onClick={() => onChange(value.filter((_, j) => j !== i))}>删除</a>,
    },
  ];

  return (
    <div>
      <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={value} columns={columns} />
      <Button icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={() => onChange([...value, { 数量: 0 }])}>加一行</Button>
    </div>
  );
}
```

注意：上面颜色列用 `mode="tags"` 不合适（颜色应是自由文本）。改用普通 `Input`：把颜色列的 render 换为 `<Input style={{ width: 90 }} value={r.颜色 ?? ""} onChange={e => setLine(i, { 颜色: e.target.value })} />`，并 `import { Input } from "antd"`。子代理实现时用 Input，不要用上面注释里的 Select tags（那是反例）。

- [ ] **Step 8: 新建抽屉（配置驱动）**

Create `web/src/pages/materials/MaterialDocCreateDrawer.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Button, Col, Drawer, Form, Input, Row, Space, Statistic, message } from "antd";
import { masterApi } from "../../api/master";
import { materialDocApi } from "../../api/materialDocs";
import { sumAmount, sumQty, validLines, type DocLine } from "../../utils/materialLines";
import { hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import type { MaterialDocCfg } from "./materialDocConfigs";
import MaterialLineTable from "./MaterialLineTable";

export default function MaterialDocCreateDrawer({ cfg, open, onClose, onCreated }: {
  cfg: MaterialDocCfg; open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const perms = usePerms();
  const priceHidden = hidePrice(perms, cfg.menu);
  const [form] = Form.useForm<Record<string, string>>();
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

  const submit = async () => {
    let v: Record<string, string>;
    try { v = await form.validateFields(); } catch { return; }
    const ok = validLines(lines);
    if (ok.length === 0) { message.error("请至少录入一行有效物料明细"); return; }
    setSaving(true);
    try {
      await materialDocApi(cfg.resource).create({ ...v, 明细: ok });
      message.success(`${cfg.title}单已创建`);
      onClose(); onCreated();
    } catch (e) {
      const msg = (e as { response?: { data?: { 消息?: string } } }).response?.data?.消息;
      message.error(msg ?? "创建失败");
    } finally { setSaving(false); }
  };

  return (
    <Drawer title={`新建${cfg.title}单`} width={920} open={open} onClose={onClose}
      extra={<Button type="primary" loading={saving} onClick={submit}>保存</Button>}>
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          {cfg.headerFields.map(f => (
            <Col span={8} key={f.name}>
              <Form.Item name={f.name} label={f.label}><Input /></Form.Item>
            </Col>
          ))}
        </Row>
      </Form>
      <MaterialLineTable materials={materials} value={lines} onChange={setLines} hidePriceCols={priceHidden} />
      <Space style={{ marginTop: 16 }} size={32}>
        <Statistic title="数量合计" value={sumQty(lines)} />
        {!priceHidden && <Statistic title="金额合计" value={sumAmount(lines).toFixed(2)} />}
      </Space>
    </Drawer>
  );
}
```

- [ ] **Step 9: 详情抽屉（配置驱动）**

Create `web/src/pages/materials/MaterialDocDetailDrawer.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Descriptions, Drawer, Table, Tag, message } from "antd";
import { materialDocApi, type MaterialDocDetail } from "../../api/materialDocs";
import type { MaterialDocCfg } from "./materialDocConfigs";

const money = (v?: number | null) => (v == null ? "***" : v);

export default function MaterialDocDetailDrawer({ cfg, 单号, onClose }: {
  cfg: MaterialDocCfg; 单号: string | null; onClose: () => void;
}) {
  const [detail, setDetail] = useState<MaterialDocDetail | null>(null);

  useEffect(() => {
    if (!单号) { setDetail(null); return; }
    (async () => {
      try { setDetail(await materialDocApi(cfg.resource).get(单号)); }
      catch { message.error("加载单据详情失败"); }
    })();
  }, [单号, cfg.resource]);

  const h = detail?.单头;

  return (
    <Drawer title={`${cfg.title}单 ${单号 ?? ""}`} width={820} open={!!单号} onClose={onClose}>
      {detail && (
        <>
          <Descriptions size="small" column={3} bordered style={{ marginBottom: 16 }}
            items={[
              { key: "no", label: "单号", children: h?.单号 ?? "-" },
              { key: "st", label: "状态", children: h?.审核 === "1" ? <Tag color="green">已审核</Tag> : <Tag>未审核</Tag> },
              { key: "qty", label: "数量", children: String(h?.数量 ?? "-") },
              { key: "amt", label: "金额", children: money(h?.金额) },
              { key: "date", label: "日期", children: h?.日期?.slice(0, 10) ?? "-" },
              ...cfg.listExtra.map(f => ({ key: f.name, label: f.label, children: String(h?.[f.name] ?? "-") })),
              { key: "memo", label: "备注", children: h?.备注 ?? "-" },
            ]} />
          <Table size="small" rowKey="id" pagination={false} dataSource={detail.明细} scroll={{ x: true }}
            columns={[
              { title: "物料编号", dataIndex: "物料编号" }, { title: "物料名称", dataIndex: "物料名称" },
              { title: "规格", dataIndex: "规格" }, { title: "颜色", dataIndex: "颜色" }, { title: "单位", dataIndex: "单位" },
              { title: "数量", dataIndex: "数量" },
              { title: "单价", dataIndex: "单价", render: money },
              { title: "金额", dataIndex: "金额", render: money },
            ]} />
        </>
      )}
    </Drawer>
  );
}
```

- [ ] **Step 10: 列表页（配置驱动）**

Create `web/src/pages/materials/MaterialDocPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Popconfirm, Space, Table, Tag, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { materialDocApi, type MaterialDocHeader } from "../../api/materialDocs";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import type { MaterialDocCfg } from "./materialDocConfigs";
import MaterialDocCreateDrawer from "./MaterialDocCreateDrawer";
import MaterialDocDetailDrawer from "./MaterialDocDetailDrawer";

export default function MaterialDocPage({ cfg }: { cfg: MaterialDocCfg }) {
  const perms = usePerms();
  const dapi = materialDocApi(cfg.resource);
  const [rows, setRows] = useState<MaterialDocHeader[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await materialDocApi(cfg.resource).list(page, 10, keyword); setRows(r.items); setTotal(r.total); }
    catch { message.error("加载列表失败"); }
  }, [page, keyword, cfg.resource]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); load(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const columns = [
    { title: "单号", dataIndex: "单号", key: "单号", render: (v: string) => <a className="erp-num" onClick={() => setViewing(v)}>{v}</a> },
    { title: "日期", dataIndex: "日期", key: "日期", render: (v?: string) => v?.slice(0, 10) },
    ...cfg.listExtra.map(f => ({ title: f.label, dataIndex: f.name, key: f.name })),
    { title: "数量", dataIndex: "数量", key: "数量" },
    { title: "金额", dataIndex: "金额", key: "金额", render: (v?: number | null) => (v == null ? "***" : v) },
    {
      title: "状态", dataIndex: "审核", key: "审核",
      render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag>,
    },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: MaterialDocHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, cfg.menu, "审核") && <a onClick={() => act(() => dapi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, cfg.menu, "反审核") && <a onClick={() => act(() => dapi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, cfg.menu, "删除") && (
            <Popconfirm title="确认删除?" onConfirm={() => act(() => dapi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title={`${cfg.title}单`} variant="borderless"
      extra={
        <Space>
          <Input.Search placeholder="搜索单号" allowClear onSearch={v => { setPage(1); setKeyword(v); }} style={{ width: 220 }} />
          {can(perms, cfg.menu, "保存") && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建{cfg.title}单</Button>}
        </Space>
      }>
      <Table rowKey="id" size="middle" dataSource={rows} columns={columns} scroll={{ x: true }}
        pagination={{ current: page, pageSize: 10, total, onChange: setPage, showTotal: t => `共 ${t} 条` }} />
      <MaterialDocCreateDrawer cfg={cfg} open={creating} onClose={() => setCreating(false)} onCreated={load} />
      <MaterialDocDetailDrawer cfg={cfg} 单号={viewing} onClose={() => setViewing(null)} />
    </Card>
  );
}
```

- [ ] **Step 11: 构建 + 测试 + 提交**

Run: `npm --prefix web run test` → Expected: PASS
Run: `npm --prefix web run build` → Expected: tsc 0 错误（注意 Step 7 的颜色列必须用 Input 而非 Select tags）

```powershell
git add web/src/utils/materialLines.ts web/src/api/materialDocs.ts web/src/api/materialInventory.ts web/src/pages/materials/ web/src/__tests__/materialDocs.test.ts
git commit -m @'
feat(P3): 前端配置驱动的通用物料单据组件(采购入仓/领料/退料共用)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 9: 前端 — 路由/菜单接入 + 物料库存查询页

把通用物料单据组件接到路由和菜单（三单据共用一个 router），新增物料库存查询页。

**Files:**
- Create: `web/src/pages/materials/MaterialDocRouter.tsx`, `web/src/pages/materials/MaterialInventoryPage.tsx`
- Modify: `web/src/App.tsx`, `web/src/pages/MainLayout.tsx`

- [ ] **Step 1: 单据路由分发器**

Create `web/src/pages/materials/MaterialDocRouter.tsx`:

```tsx
import { useParams } from "react-router-dom";
import { MATERIAL_DOC_CONFIGS } from "./materialDocConfigs";
import MaterialDocPage from "./MaterialDocPage";

export default function MaterialDocRouter() {
  const { doc } = useParams();
  const cfg = doc ? MATERIAL_DOC_CONFIGS[doc] : undefined;
  if (!cfg) return <div>未知的物料单据类型</div>;
  return <MaterialDocPage key={cfg.resource} cfg={cfg} />;
}
```

- [ ] **Step 2: 物料库存查询页**

Create `web/src/pages/materials/MaterialInventoryPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Card, Input, Space, Table, message } from "antd";
import { materialInventoryApi, type MaterialStockRow } from "../../api/materialInventory";

export default function MaterialInventoryPage() {
  const [rows, setRows] = useState<MaterialStockRow[]>([]);
  const [仓库, set仓库] = useState("");
  const [keyword, setKeyword] = useState("");

  const load = useCallback(async () => {
    try { setRows(await materialInventoryApi.list(仓库 || undefined, keyword || undefined)); }
    catch { message.error("加载物料库存失败"); }
  }, [仓库, keyword]);
  useEffect(() => { load(); }, [load]);

  const columns = [
    { title: "物料编号", dataIndex: "物料编号", render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "物料名称", dataIndex: "物料名称" },
    { title: "规格", dataIndex: "规格" },
    { title: "单位", dataIndex: "单位" },
    { title: "仓库", dataIndex: "仓库" },
    {
      title: "库存数量", dataIndex: "库存数量",
      render: (v: number) => <span style={{ fontWeight: 600, color: v < 0 ? "#cf1322" : undefined }}>{v}</span>,
    },
  ];

  return (
    <Card title="物料库存" variant="borderless"
      extra={
        <Space>
          <Input placeholder="仓库" allowClear value={仓库} onChange={e => set仓库(e.target.value)} style={{ width: 140 }} />
          <Input.Search placeholder="物料编号/名称" allowClear onSearch={setKeyword} style={{ width: 220 }} />
        </Space>
      }>
      <Table rowKey={r => `${r.物料编号}|${r.仓库}`} size="middle" dataSource={rows} columns={columns}
        pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }} />
    </Card>
  );
}
```

- [ ] **Step 3: App.tsx 加路由**

修改 `web/src/App.tsx`，import 两个新页面，在 production 路由之后加：

```tsx
import MaterialDocRouter from "./pages/materials/MaterialDocRouter";
import MaterialInventoryPage from "./pages/materials/MaterialInventoryPage";
// ...
          <Route path="materials/:doc" element={<MaterialDocRouter />} />
          <Route path="material-inventory" element={<MaterialInventoryPage />} />
```

- [ ] **Step 4: MainLayout 加菜单**

修改 `web/src/pages/MainLayout.tsx`：

import 加图标：`ShoppingOutlined, ExportOutlined, ImportOutlined, ContainerOutlined`（从 @ant-design/icons，保留原有）。

`bizChildren`（业务单据组）后新增一个"物料管理"组。找到 `const items = [...]` 那段，改为：

```tsx
  const matChildren = [
    ...(can(perms, "采购入仓单", "打开") ? [{ key: "/materials/purchase-receipts", label: "采购入仓", icon: <ImportOutlined /> }] : []),
    ...(can(perms, "领料单", "打开") ? [{ key: "/materials/material-issues", label: "领料单", icon: <ExportOutlined /> }] : []),
    ...(can(perms, "退料单", "打开") ? [{ key: "/materials/material-returns", label: "退料单", icon: <ImportOutlined /> }] : []),
    ...(can(perms, "物料库存", "打开") ? [{ key: "/material-inventory", label: "物料库存", icon: <ContainerOutlined /> }] : []),
  ];
  const items = [
    { key: "base", label: "基础资料", icon: <DatabaseOutlined />, children },
    ...(bizChildren.length ? [{ key: "biz", label: "业务单据", icon: <FileTextOutlined />, children: bizChildren }] : []),
    ...(matChildren.length ? [{ key: "mat", label: "物料管理", icon: <ShoppingOutlined />, children: matChildren }] : []),
  ];
```

`openKeys` 初始值加 `"mat"`：`useState<string[]>(["base", "biz", "mat"])`。

Header 标题判断链加物料分支（在现有链里追加）：

```tsx
            {loc.pathname.startsWith("/orders") ? "客户订单"
              : loc.pathname.startsWith("/production") ? "生产制单"
              : loc.pathname.startsWith("/styles") ? "款式详情"
              : loc.pathname.startsWith("/material-inventory") ? "物料库存"
              : loc.pathname.startsWith("/materials/") ? "物料单据"
              : "基础资料"}
```

- [ ] **Step 5: 构建 + 测试 + 提交**

Run: `npm --prefix web run test` → Expected: PASS
Run: `npm --prefix web run build` → Expected: tsc 0 错误

```powershell
git add web/src/
git commit -m @'
feat(P3): 前端物料单据路由/菜单接入 + 物料库存查询页

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 10: 端到端验证（全量回归 + 前后端联调"库存动起来" + 截图留档）

无新代码（发现 bug 才修）。验证 P3 核心命题：录入并审核 采购入仓/领料/退料 后，物料库存查询页实时反映 入−领+退。

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

- [ ] **Step 2: 启动前后端**

```powershell
Get-Process -Name ErpApi -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
Start-Process -FilePath "dotnet" -ArgumentList "run --project src/ErpApi --urls http://localhost:5000" -WorkingDirectory "D:\WebpageERP" -WindowStyle Hidden
Start-Process -FilePath "cmd" -ArgumentList "/c npm --prefix web run dev -- --host --port 5173" -WorkingDirectory "D:\WebpageERP" -WindowStyle Hidden
Start-Sleep -Seconds 15
```

- [ ] **Step 3: 用 puppeteer 走主线（每步截图，复用 `tmp/shot` 里 P2 的 puppeteer-core）**

写 `tmp/shot/p3-e2e.js` 完成（用 admin/admin123，已由 Task 7 种子授权 P3 四菜单；P2 已有物料 M001/M002）：
1. 登录 → 物料管理 → 采购入仓 → 新建：供应商编号填任意、仓库 `物料仓`、明细选 M001 数量 100 单价 10 → 保存 → 审核 → 截图 `tmp/p3-1-receipt.png`
2. 物料管理 → 物料库存：搜 M001 → 应显示 库存数量 100（物料仓）→ 截图 `tmp/p3-2-stock-100.png`
3. 物料管理 → 领料单 → 新建：领料部门 `车间一`、仓库 `物料仓`、明细 M001 数量 30 → 保存 → 审核
4. 回物料库存：M001 应变 70 → 截图 `tmp/p3-3-stock-70.png`
5. 退料单 → 新建：退料部门 `车间一`、仓库 `物料仓`、明细 M001 数量 5 → 保存 → 审核 → 物料库存 M001 应变 75 → 截图 `tmp/p3-4-stock-75.png`

puppeteer 要点：`headless:'new'`、viewport 1440×900、antd Select 先 click 再等 `.ant-select-item-option` 再点、每步操作后 `await new Promise(r=>setTimeout(r,800))`、失败先截图存档。

- [ ] **Step 4: 数据库验证库存口径**

对 erp 库（绕过代理或直接 Dapper/DbDeploy 跑只读 SQL）验证：
```sql
-- 物料库存查询应等于 入100 − 领30 + 退5 = 75（仅审核单）
SELECT 物料编号, 仓库, SUM(数量) FROM (
  SELECT d.物料编号,d.仓库,d.数量 FROM 采购入仓明细单 d JOIN 采购入仓单 h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1' AND d.物料编号='M001'
  UNION ALL SELECT d.物料编号,d.仓库,d.数量 FROM 退料明细单 d JOIN 退料单 h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1' AND d.物料编号='M001'
  UNION ALL SELECT d.物料编号,d.仓库,d.数量*-1 FROM 领料明细单 d JOIN 领料单 h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1' AND d.物料编号='M001'
) t GROUP BY 物料编号,仓库;
```
记录实际结果（应 M001/物料仓/75）。

- [ ] **Step 5: 清理 + 收尾**

停服务（`Get-Process -Name ErpApi ... Stop-Process`、关 node dev）。测试产生的演示单据保留在 erp 开发库。确认：
```powershell
git status
git log --oneline master..HEAD
```
Expected: 工作树干净；P3 分支领先 master 约 10 个提交。汇报后由 finishing-a-development-branch 决定合并。

---

## Self-Review 结论

**Spec 覆盖检查**（对照蓝图 P3 行：采购→入仓→领料，物料库存动起来；库存汇总(算1)首落地、缺料计算）：
- ✅ 算法1 物料口径首落地：Task 1（`MaterialInventoryService` UNION 符号法，物料编号×仓库，仅审核单）
- ✅ 缺料计算接入：Task 2（P2 `ProductionService.MaterialStockAsync` 重构为复用 `StockOfAsync`，消除重复 SQL）
- ✅ 采购入仓（库存+来源）：Task 3（Service）+ Task 4（Controller/审核/脱敏）
- ✅ 领料（库存−去向）：Task 5
- ✅ 退料（库存+回库）：Task 6
- ✅ 物料库存查询 + "审核后库存动起来"端到端验证：Task 7（端点 + 联动测试 + 权限种子）
- ✅ 前端：Task 8（配置驱动通用物料单据组件）+ Task 9（路由/菜单 + 库存查询页）+ Task 10（E2E 联调截图）
- ✅ 横切引擎复用：单号引擎①（CG/LL/TL 前缀）、审核引擎②（三单据已在白名单，单号列均"单号"）、权限审计引擎④（编程式控权 + c操作记录）、库存引擎③（本阶段物料口径落地）
- ✅ 成本保密：单头金额 + 明细单价/金额，无"单价"权限后端剥离（采购入仓/领料/退料三 Controller）；物料库存查询无价格字段故只需"打开"权限

**明确延后（按"核心四件"裁剪，记录在案）**：
1. **采购订单 / 采购退仓**：用户选定的范围不含。采购退仓是库存(−)的另一来源，将来纳入时在 `MaterialInventoryService.LedgerUnion` 加一段 `采购退仓明细单(−)` 即可（单一真相源的好处）。
2. **领料/退料的库存成本（库存单价/库存金额、加权平均出库价）**：本期明细只写录入单价，不算移动加权成本——成本核算属后续阶段（P 后期）。
3. **单据关联生产单号/款号**：领料/退料/采购入仓的 生产单号/款号 是可空查找 FK，本期不填（前端不选）；将来"按生产单号领料/退料"时再放开（需保证所选生产单存在以满足 FK）。
4. **月结快照层**：`IInventorySnapshotProvider` 仍是 `NullSnapshotProvider`（全量实时）。物料库存量级小，实时聚合够用；月结快照属 P5 仓储阶段。

**类型/签名一致性检查**：
- `MaterialDocLineDto`（Task 3 定义）跨采购入仓/领料/退料 三 Service 复用 ✅
- `IMaterialInventoryService.StockOfAsync(物料编号, (conn,tx)?)`（Task 1）被 Task 2 的 `ProductionService` 以 `(c, tx)` 调用 ✅
- 三单据 Service 的 `DocType`/`Prefix` 互不冲突（采购入仓单/CG、领料单/LL、退料单/TL）✅
- 前端 `materialDocApi(resource)`（Task 8）+ `MATERIAL_DOC_CONFIGS`（Task 8）被 Task 9 的 router 按 `:doc` 取 ✅
- `validLines/sumQty/sumAmount/lineAmount`（Task 8 utils）被 CreateDrawer/测试共用 ✅
- 库存方向常量集中在 `MaterialInventoryService.LedgerUnion`（Task 1）——三单据 Service 不各自定义符号，避免不一致 ✅

**已知简化与理由**：
1. 库存维度 `物料编号×仓库`，规格/单位 取 MAX 展示——同一物料同仓库不同规格会被合并到一行（原系统物料编号通常已含规格区分）。若需按规格细分，后续在 GROUP BY 加 规格 即可。
2. `P3TestData.Cleanup` 兜底删明细（按测试物料）+ 删主数据；单头由各测试用返回单号精确删除（单号引擎动态生成无法预先 LIKE 精确匹配，故不在 Cleanup 按前缀删单头，避免误删）。
3. 物料库存查询端点返回数组（非分页）——筛选后量小；与单据列表的分页风格不同但合理。

---

## 执行交接

计划已保存到 `docs/superpowers/plans/2026-06-04-p3-material-side.md`。两种执行方式：

**1. Subagent-Driven（推荐）** — 每个任务派全新子代理实现，任务间做规格审查+质量审查，迭代快（与 P0/P1/P2 一致）。REQUIRED SUB-SKILL: superpowers:subagent-driven-development。

**2. Inline Execution** — 当前会话用 superpowers:executing-plans 按批次执行、设检查点。

选哪种？





