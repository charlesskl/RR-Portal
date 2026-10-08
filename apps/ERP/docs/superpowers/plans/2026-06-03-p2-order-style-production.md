# P2 主线（M2 接单 + M3 款式&BOM + M4 生产制单）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通兴信B ERP 的价值主线——客户下单（成品客户订货单三层）→ 款式与 BOM 维护（款号/颜色/尺码/工序工价/物料用量）→ 生产制单（中心枢纽：算法3 工费展开 + 算法4 BOM 物料需求展开/缺料），并支持订单与生产制单关联、审核/反审核过账。

**Architecture:** 款式主数据（款号总表/款号明细表/款号物料明细表，皆 bigint IDENTITY）复用 P1 的 EF 泛型 CRUD 基座；款号颜色表/尺码表（无主键）与三张单据（订货单三层、生产制单及子表）走 Dapper 事务编排服务（OrderService / ProductionService / StyleService），单号用引擎①生成、审核走引擎②（需先扩展 PostingEngine 支持 `生产制单` 的 `生产单号` 列）、权限/审计沿用引擎④。成本保密在所有新控制器后端落实（无"单价"权限剥离价格字段）。前端复用 MasterDataPage 承载款号主档，新增 款式详情页（颜色/尺码/工序/BOM 四个 Tab）、客户订单页、生产制单页（色×码数量矩阵录入 + 审核操作）。

**Tech Stack:** .NET 8 ASP.NET Core, EF Core 8 (SqlServer), Dapper, SQL Server LocalDB (erp/erp_test, Chinese_PRC_CI_AS), xUnit + WebApplicationFactory + Xunit.SkippableFact, React 18 + TS + Ant Design v6 + Vitest.

---

## 前置约定（所有任务通用）

- 工作目录 `D:\WebpageERP`，分支策略由执行技能决定。Windows 用 PowerShell 跑 dotnet；`dotnet` 不在 PATH 时刷新：`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 集成测试需 `$env:ERP_TEST_DB`、`$env:ERP_JWT_KEY`（User 级已设；shell 为空时 `$env:ERP_TEST_DB=[Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")`，`$env:ERP_JWT_KEY=[Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")`）。
- 跑后端测试：`dotnet test`（在仓库根）。跑单个测试类：`dotnet test --filter "FullyQualifiedName~OrderServiceDbTests"`。
- 前端：`npm --prefix web run test`（vitest run）、`npm --prefix web run build`（tsc+vite）。
- 已有可复用件（P0/P1 已交付，直接 DI 注入）：
  - `ISqlConnectionFactory.Create()` → `SqlConnection`（连接串来自 ERP_DB 环境变量）
  - `IDocumentNumberGenerator.NextAsync(docType, prefix, bizDate, conn, tx)` → `"前缀+yyyyMMdd+3位流水"`
  - `IPostingEngine.ApproveAsync(table, docNo, user)` / `UnapproveAsync(...)`（本计划 Task 1 会扩展它）
  - `IPermissionService.HasAsync(user, menu, PermissionAction)`，`PermissionAction` 枚举 = 打开/保存/删除/打印/单价/金额/审核/反审核/功能
  - `IAuditLogger.WriteAsync(表名, 行为, 操作员, 记录, SqlConnection, SqlTransaction?)` → 写 `c操作记录`
  - `MasterCrudService<T>` / `MasterCrudController<T>`（T : MasterEntity，bigint ID）、`PagedResult<T>(Items, Total)`
  - `PriceFieldAttribute`：标在实体价格属性上，泛型控制器在无"单价"权限时自动置空
  - 测试：`DbFixture`（`[Collection("db")]`、`fx.Open()`、`fx.ConnectionString`、`fx.Available`）、`JwtTokenService.Issue(user)`
  - 前端：`api`(axios)、`masterApi(resource)`、`can`/`hidePrice`、`usePerms()`、`MasterDataPage`、`MASTER_CONFIGS`
- **JSON 大小写**：C# `ID` → JSON `"id"`（camelCase），中文属性名不受影响。`PagedResult` → `items`/`total`。前端 rowKey 用 `id`。
- **FK 已启用**：插子表前必须先有父行。本计划涉及的关键 FK：
  - `成品客户订货单.客户编号 → 客户资料.客户编号`
  - `成品客户订单总表.{客户编号,款号,生产单号}` → 客户资料/款号总表/生产制单；`成品客户订单明细表.单号 → 成品客户订单总表.单号`（主从）
  - `款号明细表.款号 / 款号颜色表.款号 / 款号尺码表.款号 / 款号物料明细表.{款号,物料编号,客户编号}` → 款号总表/物料资料/客户资料
  - `生产制单.{加工厂编号,客户编号,款号}` → 加工厂资料/客户资料/款号总表
  - `生产制单工序表/生产制单数量/生产BOM物料清单.{生产单号,款号,...}` → 生产制单/款号总表/物料资料/供应商资料/加工厂资料/客户资料
  - **插入顺序**：生产制单单头必须先插，子表（工序/数量/BOM）后插；删除顺序相反。
- **单据表的真实列名**（以 `db/01_rebuild_schema.sql` 为准，逆向文档有误差）：
  - `生产制单` 的单号列叫 **`生产单号`**（不是 `单号`）；`成品客户订货单`/`成品客户订单总表`/`成品客户订单明细表` 用 `单号`。
  - `成品客户订货单`三层的 `ID` 是 **int** IDENTITY（不是 bigint）→ 不能挂到 EF `MasterEntity`，单据全走 Dapper。
  - `款号颜色表`/`款号尺码表` **无主键**，`ID` 是可空 bigint 普通列 → 用 Dapper 整组替换，把 `ID` 当排序号写（1,2,3...）。
  - `成品客户订单总表.单号` 有 UNIQUE 约束 → 一张订单只对应一个款号（一单一款，原系统设计）。
  - `生产制单.生产单号` 有 UNIQUE 约束。
  - 03 脚本已给 `成品客户订货单`/`生产制单` 补了 `审核人`/`审核日期` 列。
- 中文做 C# 标识符合法。路由用 ASCII（`api/orders`、`api/production`、`api/styles`），菜单名/表名用中文。
- 提交规范：commit 末尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。Windows 上 git 报 LF→CRLF 警告是正常的。

---

## 文件结构

```
src/ErpApi/
├─ Engines/Posting/
│  ├─ PostableDocuments.cs        改:白名单从 Set 变 表名→单号列 映射(生产制单→生产单号)
│  └─ PostingEngine.cs            改:UPDATE 用映射出的单号列
├─ Data/
│  ├─ ErpDbContext.cs             改:+3 个 DbSet
│  └─ Entities/
│     ├─ 款号总表.cs               新:款式主档(4个价格列均 [PriceField])
│     ├─ 款号明细表.cs             新:款式工序工价(算法3数据源)
│     └─ 款号物料明细表.cs         新:款式BOM单件用量(算法4数据源)
├─ Features/
│  ├─ MasterData/Controllers.cs   改:+3 个薄控制器(styles/style-processes/style-bom-lines)
│  ├─ Styles/
│  │  ├─ StyleDtos.cs             新:颜色DTO/聚合DTO
│  │  ├─ StyleService.cs          新:聚合读 + 颜色/尺码整组替换(Dapper)
│  │  └─ StyleController.cs       新:GET full / PUT colors / PUT sizes
│  ├─ Orders/
│  │  ├─ OrderDtos.cs             新:创建DTO/表头DTO/详情DTO
│  │  ├─ OrderService.cs          新:三层创建/分页/详情/删除(Dapper+事务+单号生成)
│  │  └─ OrderController.cs       新:REST+审核/反审核+成本保密
│  └─ Production/
│     ├─ ProductionDtos.cs        新:创建DTO/表头DTO/详情DTO
│     ├─ ProductionService.cs     新:创建(算法3工序展开+算法4BOM展开)/分页/详情/删除
│     └─ ProductionController.cs  新:REST+审核/反审核+成本保密
└─ Program.cs                     改:注册 StyleService/OrderService/ProductionService

db/seed_p2_perms.sql              新:admin 授权 款号资料/成品客户订货单/生产制单 菜单

web/src/
├─ api/
│  ├─ styles.ts                   新:款式聚合API客户端
│  ├─ orders.ts                   新:订单API客户端
│  └─ production.ts               新:生产制单API客户端
├─ utils/matrix.ts                新:色×码数量矩阵 ↔ 明细行 转换(纯函数,可测)
├─ components/QtyMatrix.tsx       新:色×码数量矩阵录入组件(订单/制单共用)
├─ pages/
│  ├─ master/configs.ts           改:+款号资料 配置(带 detailLink)
│  ├─ master/MasterDataPage.tsx   改:支持 detailLink 列(跳款式详情)
│  ├─ styles/StyleDetailPage.tsx  新:款式详情(颜色/尺码/工序/BOM 四Tab)
│  ├─ orders/OrdersPage.tsx       新:订单列表+审核操作
│  ├─ orders/OrderCreateDrawer.tsx 新:新建订单(客户/款号/矩阵)
│  ├─ orders/OrderDetailDrawer.tsx 新:订单详情
│  ├─ production/ProductionPage.tsx        新:制单列表+审核操作
│  ├─ production/ProductionCreateDrawer.tsx 新:新建制单(从订单或款号)
│  ├─ production/ProductionDetailDrawer.tsx 新:制单详情(数量/工序/BOM Tab)
│  └─ MainLayout.tsx              改:+业务单据 菜单组,头部标题按路由变化
└─ App.tsx                        改:+3 条路由

tests/ErpApi.Tests/
├─ PostableDocumentsTests.cs      改:断言 单号列映射
├─ PostingEngineDbTests.cs        改:+生产制单(生产单号列)审核用例
├─ StyleEntityMappingDbTests.cs   新:3实体 Take(1) 映射校验
├─ StyleServiceDbTests.cs         新:聚合读/颜色尺码替换
├─ P2TestData.cs                  新:P2 测试种子(客户/物料/款号/工序/BOM/加工厂)+清理
├─ OrderServiceDbTests.cs         新:三层创建/汇总/删除/FK顺序
├─ ProductionServiceDbTests.cs    新:算法3/算法4 断言/从订单生成回写
└─ P2ApiIntegrationTests.cs       新:订单与制单 API 权限/审核/价格脱敏

web/src/__tests__/matrix.test.ts  新:矩阵转换纯函数测试
```

---

## Task 1: PostingEngine 支持按表映射单号列（生产制单用 `生产单号`）

`PostingEngine` 现在写死 `WHERE [单号]=@docNo`，但 `生产制单` 表的单号列叫 `生产单号`——不改的话生产制单永远无法审核。把白名单从 `HashSet<string>` 改成 `表名 → 单号列` 字典，保持 `Tables`/`IsAllowed` 兼容现有调用。

**Files:**
- Modify: `src/ErpApi/Engines/Posting/PostableDocuments.cs`
- Modify: `src/ErpApi/Engines/Posting/PostingEngine.cs`
- Modify: `tests/ErpApi.Tests/PostableDocumentsTests.cs`
- Modify: `tests/ErpApi.Tests/PostingEngineDbTests.cs`

- [ ] **Step 1: 先看现有测试内容**

Run: `Get-Content D:\WebpageERP\tests\ErpApi.Tests\PostableDocumentsTests.cs`（了解现有断言，保留它们仍然通过）

- [ ] **Step 2: 写失败的测试（单号列映射）**

在 `tests/ErpApi.Tests/PostableDocumentsTests.cs` 追加（保留原有测试方法不动）：

```csharp
[Fact]
public void DocNoColumn_defaults_to_单号_and_maps_生产制单_to_生产单号()
{
    Assert.Equal("单号", PostableDocuments.DocNoColumn("成品入仓单"));
    Assert.Equal("单号", PostableDocuments.DocNoColumn("成品客户订货单"));
    Assert.Equal("生产单号", PostableDocuments.DocNoColumn("生产制单"));
}

[Fact]
public void DocNoColumn_throws_for_non_whitelisted_table()
{
    Assert.Throws<InvalidOperationException>(() => PostableDocuments.DocNoColumn("不存在的表"));
}
```

注意：若原文件没有 `using ErpApi.Engines.Posting;` 和 `using Xunit;`，需要补上。

- [ ] **Step 3: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~PostableDocumentsTests"`
Expected: FAIL（编译错误 `DocNoColumn` 不存在）

- [ ] **Step 4: 改 PostableDocuments 为映射**

整体替换 `src/ErpApi/Engines/Posting/PostableDocuments.cs`：

```csharp
namespace ErpApi.Engines.Posting;

// 可审核的单头表白名单：表名只能来自此集合，杜绝拼接注入。
// 值 = 该表的单号列名（绝大多数表用 [单号]；生产制单 用 [生产单号]）。
public static class PostableDocuments
{
    private static readonly IReadOnlyDictionary<string, string> Map =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["成品入仓单"] = "单号", ["成品出仓单"] = "单号", ["成品调拨单"] = "单号",
            ["成品盘点单"] = "单号", ["成品退仓单"] = "单号", ["成品退货单"] = "单号",
            ["采购入仓单"] = "单号", ["采购付款单"] = "单号", ["采购退仓单"] = "单号",
            ["销售出货单"] = "单号", ["销售收款单"] = "单号", ["销售退货单"] = "单号",
            ["领料单"] = "单号", ["退料单"] = "单号", ["调拨单"] = "单号", ["盘点单"] = "单号",
            ["发外加工单"] = "单号", ["发外回收单"] = "单号", ["发外加工付款单"] = "单号",
            ["半成品入仓单"] = "单号", ["半成品领料单"] = "单号", ["半成品盘点单"] = "单号",
            ["成品客户订货单"] = "单号",
            ["生产制单"] = "生产单号"
            // 注：后续阶段可按需追加，但必须列入白名单才允许过账
        };

    public static readonly IReadOnlySet<string> Tables =
        new HashSet<string>(Map.Keys, StringComparer.Ordinal);

    public static bool IsAllowed(string table) => Map.ContainsKey(table);

    public static string DocNoColumn(string table) =>
        Map.TryGetValue(table, out var col)
            ? col
            : throw new InvalidOperationException($"表 [{table}] 不在可过账白名单内。");
}
```

- [ ] **Step 5: PostingEngine 用映射出的列**

修改 `src/ErpApi/Engines/Posting/PostingEngine.cs` 的 `SetAuditAsync`，把写死的 `[单号]` 换成映射列（其余不动）：

```csharp
    private async Task<bool> SetAuditAsync(string table, string docNo, string user,
        string from, string to, string behavior)
    {
        if (!PostableDocuments.IsAllowed(table))
            throw new InvalidOperationException($"表 [{table}] 不在可过账白名单内。");
        var docNoCol = PostableDocuments.DocNoColumn(table);

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        // 表名/列名来自白名单，安全可拼接；单号/状态参数化。仅当当前状态=from 才翻转（幂等、防重复）
        var sql = $@"
UPDATE [{table}]
   SET [审核]=@to,
       [审核人]=CASE WHEN @to='1' THEN @user ELSE NULL END,
       [审核日期]=CASE WHEN @to='1' THEN SYSDATETIME() ELSE NULL END
 WHERE [{docNoCol}]=@docNo AND ISNULL([审核],'0')=@from;";
        var affected = await c.ExecuteAsync(sql, new { to, from, user, docNo }, tx);
        if (affected == 0) { tx.Rollback(); return false; }

        await audit.WriteAsync(table, behavior, user, $"单号={docNo}", c, tx);
        tx.Commit();
        return true;
    }
```

- [ ] **Step 6: 跑单元测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~PostableDocumentsTests"`
Expected: PASS（含原有测试）

- [ ] **Step 7: 写生产制单审核的 DB 集成测试**

在 `tests/ErpApi.Tests/PostingEngineDbTests.cs` 追加测试方法（注意：`生产制单` 有 FK `款号→款号总表`，种数据要先插款号；清理顺序相反）：

```csharp
    [SkippableFact]
    public async Task Approve_生产制单_uses_生产单号_column()
    {
        using var c = fx.Open();
        // FK: 生产制单.款号 → 款号总表.款号，先种父行
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号]='P2POST01'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]='P2POSTK'");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'P2POSTK',N'过账测试款')");
        c.Execute("INSERT INTO [生产制单]([生产单号],[款号],[审核]) VALUES(N'P2POST01',N'P2POSTK','0')");

        var engine = new PostingEngine(Factory(), new AuditLogger());

        Assert.True(await engine.ApproveAsync("生产制单", "P2POST01", "tester"));
        Assert.Equal("1", c.ExecuteScalar<string>(
            "SELECT [审核] FROM [生产制单] WHERE [生产单号]='P2POST01'"));
        Assert.Equal("tester", c.ExecuteScalar<string>(
            "SELECT [审核人] FROM [生产制单] WHERE [生产单号]='P2POST01'"));

        Assert.True(await engine.UnapproveAsync("生产制单", "P2POST01", "tester"));
        Assert.Equal("0", c.ExecuteScalar<string>(
            "SELECT [审核] FROM [生产制单] WHERE [生产单号]='P2POST01'"));

        // 清理（FK 顺序：先子后父）
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号]='P2POST01'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]='P2POSTK'");
    }
```

- [ ] **Step 8: 跑 DB 集成测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~PostingEngineDbTests"`
Expected: PASS 2 个（原有 1 + 新增 1）；若未设 ERP_TEST_DB 则 Skip

- [ ] **Step 9: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Engines/Posting/ tests/ErpApi.Tests/PostableDocumentsTests.cs tests/ErpApi.Tests/PostingEngineDbTests.cs
git commit -m @'
feat(P2): 审核引擎支持按表映射单号列(生产制单用生产单号)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 款式主数据 EF 实体 ×3 + 泛型 CRUD 控制器

款号总表（主档+价格）、款号明细表（工序工价，算法3数据源）、款号物料明细表（BOM 单件用量，算法4数据源）都是 bigint IDENTITY，直接复用 P1 泛型基座。价格列全部标 `[PriceField]`（成本保密）。

**Files:**
- Create: `src/ErpApi/Data/Entities/款号总表.cs`, `src/ErpApi/Data/Entities/款号明细表.cs`, `src/ErpApi/Data/Entities/款号物料明细表.cs`
- Modify: `src/ErpApi/Data/ErpDbContext.cs`, `src/ErpApi/Features/MasterData/Controllers.cs`
- Test: `tests/ErpApi.Tests/StyleEntityMappingDbTests.cs`

- [ ] **Step 1: 写失败的映射测试**

Create `tests/ErpApi.Tests/StyleEntityMappingDbTests.cs`:

```csharp
using ErpApi.Data;
using Microsoft.EntityFrameworkCore;
using Xunit;

[Collection("db")]
public class StyleEntityMappingDbTests(DbFixture fx)
{
    private ErpDbContext Ctx()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        return new ErpDbContext(new DbContextOptionsBuilder<ErpDbContext>()
            .UseSqlServer(fx.ConnectionString!).Options);
    }

    [SkippableFact]
    public async Task Style_entities_query_without_mapping_error()
    {
        using var db = Ctx();
        _ = await db.款号总表.Take(1).ToListAsync();
        _ = await db.款号明细表.Take(1).ToListAsync();
        _ = await db.款号物料明细表.Take(1).ToListAsync();
        Assert.True(true);
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~StyleEntityMappingDbTests"`
Expected: FAIL（编译错误：DbContext 上没有 款号总表 等属性）

- [ ] **Step 3: 写三个实体**

Create `src/ErpApi/Data/Entities/款号总表.cs`:

```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("款号总表")]
public sealed class 款号总表 : MasterEntity
{
    [Column("款号")] public string? 款号 { get; set; }
    [Column("款式")] public string? 款式 { get; set; }
    [Column("单价"), PriceField] public decimal? 单价 { get; set; }
    [Column("成本价"), PriceField] public decimal? 成本价 { get; set; }
    [Column("批发价"), PriceField] public decimal? 批发价 { get; set; }
    [Column("零售价"), PriceField] public decimal? 零售价 { get; set; }
}
```

Create `src/ErpApi/Data/Entities/款号明细表.cs`（款式工序工价，算法3数据源）:

```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("款号明细表")]
public sealed class 款号明细表 : MasterEntity
{
    [Column("款号")] public string? 款号 { get; set; }
    [Column("款式")] public string? 款式 { get; set; }
    [Column("工序号")] public string? 工序号 { get; set; }
    [Column("工序名称")] public string? 工序名称 { get; set; }
    [Column("单价"), PriceField] public decimal? 单价 { get; set; }
    [Column("工序类型")] public string? 工序类型 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
```

Create `src/ErpApi/Data/Entities/款号物料明细表.cs`（款式 BOM 单件用量，算法4数据源；表还有尺码1..15等列，本期不映射——EF 只映射声明过的属性）:

```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("款号物料明细表")]
public sealed class 款号物料明细表 : MasterEntity
{
    [Column("日期")] public DateTime? 日期 { get; set; }
    [Column("款号")] public string? 款号 { get; set; }
    [Column("款式")] public string? 款式 { get; set; }
    [Column("物料类别")] public string? 物料类别 { get; set; }
    [Column("物料编号")] public string? 物料编号 { get; set; }
    [Column("物料名称")] public string? 物料名称 { get; set; }
    [Column("规格")] public string? 规格 { get; set; }
    [Column("颜色")] public string? 颜色 { get; set; }
    [Column("单位")] public string? 单位 { get; set; }
    [Column("使用数量")] public decimal? 使用数量 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
```

- [ ] **Step 4: DbContext 注册**

在 `src/ErpApi/Data/ErpDbContext.cs` 的类体末尾追加三行：

```csharp
    public DbSet<款号总表> 款号总表 => Set<款号总表>();
    public DbSet<款号明细表> 款号明细表 => Set<款号明细表>();
    public DbSet<款号物料明细表> 款号物料明细表 => Set<款号物料明细表>();
```

- [ ] **Step 5: 加三个薄控制器**

在 `src/ErpApi/Features/MasterData/Controllers.cs` 末尾追加（菜单统一用 `款号资料`——款式主档及其工序/BOM 共用一个权限菜单）：

```csharp
[Route("api/master/styles")]
public sealed class StyleMasterController(
    MasterCrudService<款号总表> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<款号总表>(s, p, a, f)
{ protected override string Menu => "款号资料"; protected override string TableName => "款号总表"; }

[Route("api/master/style-processes")]
public sealed class StyleProcessController(
    MasterCrudService<款号明细表> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<款号明细表>(s, p, a, f)
{ protected override string Menu => "款号资料"; protected override string TableName => "款号明细表"; }

[Route("api/master/style-bom-lines")]
public sealed class StyleBomLineController(
    MasterCrudService<款号物料明细表> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<款号物料明细表>(s, p, a, f)
{ protected override string Menu => "款号资料"; protected override string TableName => "款号物料明细表"; }
```

- [ ] **Step 6: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~StyleEntityMappingDbTests"`
Expected: PASS

- [ ] **Step 7: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Data/ src/ErpApi/Features/MasterData/Controllers.cs tests/ErpApi.Tests/StyleEntityMappingDbTests.cs
git commit -m @'
feat(P2): 款式主数据实体(款号总表/工序工价/BOM)+泛型CRUD

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 款式聚合服务（颜色/尺码整组替换 + 聚合读）

款号颜色表/款号尺码表无主键（ID 是可空普通列），不能走 EF 泛型 CRUD。用 Dapper 整组替换（先删后插，ID 写成排序号），并提供"款式全貌"聚合读（主档+颜色+尺码+工序+BOM），供订单/制单页面带出数据。

**Files:**
- Create: `src/ErpApi/Features/Styles/StyleDtos.cs`, `src/ErpApi/Features/Styles/StyleService.cs`, `src/ErpApi/Features/Styles/StyleController.cs`
- Modify: `src/ErpApi/Program.cs`
- Test: `tests/ErpApi.Tests/StyleServiceDbTests.cs`

- [ ] **Step 1: 写 DTO**

Create `src/ErpApi/Features/Styles/StyleDtos.cs`:

```csharp
using ErpApi.Data.Entities;
namespace ErpApi.Features.Styles;

public sealed record StyleColorDto(string? 颜色编号, string? 颜色名称);

public sealed record StyleFullDto(
    款号总表 主档,
    IReadOnlyList<StyleColorDto> 颜色,
    IReadOnlyList<string> 尺码,
    IReadOnlyList<款号明细表> 工序,
    IReadOnlyList<款号物料明细表> 物料);
```

- [ ] **Step 2: 写失败的 Service 测试**

Create `tests/ErpApi.Tests/StyleServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Data;
using ErpApi.Features.Styles;
using ErpApi.Infrastructure.Db;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class StyleServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private ErpDbContext Ctx() => new(new DbContextOptionsBuilder<ErpDbContext>()
        .UseSqlServer(fx.ConnectionString!).Options);

    private StyleService Svc() => new(Factory(), Ctx());

    private void Cleanup()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [款号颜色表] WHERE [款号]='P2STYLE1'");
        c.Execute("DELETE FROM [款号尺码表] WHERE [款号]='P2STYLE1'");
        c.Execute("DELETE FROM [款号明细表] WHERE [款号]='P2STYLE1'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]='P2STYLE1'");
    }

    [SkippableFact]
    public async Task Replace_colors_and_sizes_then_get_full_aggregate()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Cleanup();
        using (var c = fx.Open())
        {
            c.Execute("INSERT INTO [款号总表]([款号],[款式],[单价]) VALUES(N'P2STYLE1',N'P2测试款',100)");
            c.Execute(@"INSERT INTO [款号明细表]([款号],[款式],[工序号],[工序名称],[单价],[工序类型])
                        VALUES(N'P2STYLE1',N'P2测试款',N'01',N'裁床',1.5,N'裁床')");
        }

        var svc = Svc();
        // 整组替换颜色（2个）和尺码（3个，顺序必须保持 S,M,L）
        await svc.ReplaceColorsAsync("P2STYLE1",
            [new StyleColorDto("C01", "黑色"), new StyleColorDto("C02", "白色")]);
        await svc.ReplaceSizesAsync("P2STYLE1", ["S", "M", "L"]);

        var full = await svc.GetFullAsync("P2STYLE1");
        Assert.NotNull(full);
        Assert.Equal("P2测试款", full!.主档.款式);
        Assert.Equal(2, full.颜色.Count);
        Assert.Equal(["S", "M", "L"], full.尺码);   // 顺序保持(按写入的ID排序)
        Assert.Single(full.工序);
        Assert.Equal("裁床", full.工序[0].工序名称);

        // 再次替换 = 覆盖（不是追加）
        await svc.ReplaceColorsAsync("P2STYLE1", [new StyleColorDto("C03", "红色")]);
        full = await svc.GetFullAsync("P2STYLE1");
        Assert.Single(full!.颜色);
        Assert.Equal("红色", full.颜色[0].颜色名称);

        Cleanup();
    }

    [SkippableFact]
    public async Task GetFull_returns_null_for_missing_style()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var full = await Svc().GetFullAsync("不存在的款号XX");
        Assert.Null(full);
    }
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~StyleServiceDbTests"`
Expected: FAIL（编译错误 StyleService 不存在）

- [ ] **Step 4: 实现 StyleService**

Create `src/ErpApi/Features/Styles/StyleService.cs`:

```csharp
using Dapper;
using ErpApi.Data;
using ErpApi.Infrastructure.Db;
using Microsoft.EntityFrameworkCore;
namespace ErpApi.Features.Styles;

public sealed class StyleService(ISqlConnectionFactory factory, ErpDbContext db)
{
    // 款式全貌：主档 + 颜色集 + 尺码集 + 工序工价 + BOM物料（订单/制单页面据此带出数据）
    public async Task<StyleFullDto?> GetFullAsync(string 款号)
    {
        var 主档 = await db.款号总表.AsNoTracking().FirstOrDefaultAsync(s => s.款号 == 款号);
        if (主档 is null) return null;

        using var c = factory.Create();
        var 颜色 = (await c.QueryAsync<StyleColorDto>(
            "SELECT [颜色编号],[颜色名称] FROM [款号颜色表] WHERE [款号]=@款号 ORDER BY [ID]",
            new { 款号 })).AsList();
        var 尺码 = (await c.QueryAsync<string>(
            "SELECT [尺码] FROM [款号尺码表] WHERE [款号]=@款号 ORDER BY [ID]",
            new { 款号 })).AsList();
        var 工序 = await db.款号明细表.AsNoTracking()
            .Where(x => x.款号 == 款号).OrderBy(x => x.工序号).ToListAsync();
        var 物料 = await db.款号物料明细表.AsNoTracking()
            .Where(x => x.款号 == 款号).OrderBy(x => x.ID).ToListAsync();
        return new StyleFullDto(主档, 颜色, 尺码, 工序, 物料);
    }

    // 整组替换颜色集（先删后插；ID 列无自增，写成排序号保证顺序稳定）
    public async Task ReplaceColorsAsync(string 款号, IReadOnlyList<StyleColorDto> colors)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 款式 = await c.ExecuteScalarAsync<string?>(
            "SELECT [款式] FROM [款号总表] WHERE [款号]=@款号", new { 款号 }, tx)
            ?? throw new InvalidOperationException($"款号 [{款号}] 不存在。");
        await c.ExecuteAsync("DELETE FROM [款号颜色表] WHERE [款号]=@款号", new { 款号 }, tx);
        for (var i = 0; i < colors.Count; i++)
            await c.ExecuteAsync(@"
INSERT INTO [款号颜色表]([款号],[款式],[颜色编号],[颜色名称],[ID])
VALUES(@款号,@款式,@颜色编号,@颜色名称,@ID)",
                new { 款号, 款式, colors[i].颜色编号, colors[i].颜色名称, ID = (long)(i + 1) }, tx);
        tx.Commit();
    }

    // 整组替换尺码集（顺序即穿着顺序 S/M/L/XL，用 ID 列保序）
    public async Task ReplaceSizesAsync(string 款号, IReadOnlyList<string> sizes)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 款式 = await c.ExecuteScalarAsync<string?>(
            "SELECT [款式] FROM [款号总表] WHERE [款号]=@款号", new { 款号 }, tx)
            ?? throw new InvalidOperationException($"款号 [{款号}] 不存在。");
        await c.ExecuteAsync("DELETE FROM [款号尺码表] WHERE [款号]=@款号", new { 款号 }, tx);
        for (var i = 0; i < sizes.Count; i++)
            await c.ExecuteAsync(@"
INSERT INTO [款号尺码表]([款号],[款式],[尺码],[ID]) VALUES(@款号,@款式,@尺码,@ID)",
                new { 款号, 款式, 尺码 = sizes[i], ID = (long)(i + 1) }, tx);
        tx.Commit();
    }
}
```

- [ ] **Step 5: 实现 StyleController**

Create `src/ErpApi/Features/Styles/StyleController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Styles;

[ApiController]
[Authorize]
[Route("api/styles")]
public sealed class StyleController(
    StyleService svc, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "款号资料";
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    private async Task AuditAsync(string table, string behavior, string record)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync(table, behavior, CurrentUser, record, c);
    }

    // 款式全貌（主档+颜色+尺码+工序+BOM）；无"单价"权限时剥离所有价格（成本保密）
    [HttpGet("{款号}/full")]
    public async Task<IActionResult> GetFull(string 款号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var dto = await svc.GetFullAsync(款号);
        if (dto is null) return NotFound();
        if (!await AllowAsync(PermissionAction.单价))
        {
            dto.主档.单价 = null; dto.主档.成本价 = null; dto.主档.批发价 = null; dto.主档.零售价 = null;
            foreach (var p in dto.工序) p.单价 = null;
        }
        return Ok(dto);
    }

    [HttpPut("{款号}/colors")]
    public async Task<IActionResult> PutColors(string 款号, [FromBody] List<StyleColorDto> colors)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await svc.ReplaceColorsAsync(款号, colors); }
        catch (InvalidOperationException ex) { return NotFound(new { 消息 = ex.Message }); }
        await AuditAsync("款号颜色表", "修改", $"款号={款号}");
        return NoContent();
    }

    [HttpPut("{款号}/sizes")]
    public async Task<IActionResult> PutSizes(string 款号, [FromBody] List<string> sizes)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await svc.ReplaceSizesAsync(款号, sizes); }
        catch (InvalidOperationException ex) { return NotFound(new { 消息 = ex.Message }); }
        await AuditAsync("款号尺码表", "修改", $"款号={款号}");
        return NoContent();
    }
}
```

- [ ] **Step 6: Program.cs 注册**

在 `src/ErpApi/Program.cs` 的 `// 业务` 区块（`builder.Services.AddScoped<AuthService>();` 之后）追加：

```csharp
builder.Services.AddScoped<ErpApi.Features.Styles.StyleService>();
```

- [ ] **Step 7: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~StyleServiceDbTests"`
Expected: PASS 2 个

- [ ] **Step 8: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Styles/ src/ErpApi/Program.cs tests/ErpApi.Tests/StyleServiceDbTests.cs
git commit -m @'
feat(P2): 款式聚合服务(颜色/尺码整组替换+全貌读取)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: P2 测试种子 + OrderService（订货单三层创建/分页/详情/删除）

接单是三层结构（同一 `单号` 串联）：`成品客户订货单`(财务头) ← `成品客户订单总表`(款号头，单号唯一=一单一款) ← `成品客户订单明细表`(色×码行)。三层 ID 都是 int IDENTITY，全部走 Dapper 事务；单号用引擎①生成。

**Files:**
- Create: `tests/ErpApi.Tests/P2TestData.cs`（P2 各测试共用的种子/清理）
- Create: `src/ErpApi/Features/Orders/OrderDtos.cs`, `src/ErpApi/Features/Orders/OrderService.cs`
- Modify: `src/ErpApi/Program.cs`
- Test: `tests/ErpApi.Tests/OrderServiceDbTests.cs`

- [ ] **Step 1: 写共用测试种子类**

Create `tests/ErpApi.Tests/P2TestData.cs`（订单/制单测试都要 客户/物料/款号/工序/BOM/加工厂 父行；统一管理，前缀 `P2T` 防冲突）：

```csharp
using Dapper;
using Microsoft.Data.SqlClient;

// P2 测试共用种子：客户 P2TC01 / 物料 P2TM01,P2TM02 / 加工厂 P2TF01 /
// 款号 P2TK01(两道工序 1.5+2.5、两种物料 单件用量2和0.5、颜色2、尺码3)
public static class P2TestData
{
    public const string 客户编号 = "P2TC01";
    public const string 加工厂编号 = "P2TF01";
    public const string 款号 = "P2TK01";
    public const string 物料1 = "P2TM01";
    public const string 物料2 = "P2TM02";

    public static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'P2TC01',N'P2测试客户')");
        c.Execute("INSERT INTO [加工厂资料]([加工厂编号],[加工厂名称]) VALUES(N'P2TF01',N'P2测试加工厂')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位],[单价]) VALUES(N'P2TM01',N'P2面料',N'米',10)");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位],[单价]) VALUES(N'P2TM02',N'P2纽扣',N'粒',0.2)");
        c.Execute("INSERT INTO [款号总表]([款号],[款式],[单价]) VALUES(N'P2TK01',N'P2测试款式',100)");
        c.Execute(@"INSERT INTO [款号明细表]([款号],[款式],[工序号],[工序名称],[单价],[工序类型])
                    VALUES(N'P2TK01',N'P2测试款式',N'01',N'裁床',1.5,N'裁床'),
                          (N'P2TK01',N'P2测试款式',N'02',N'车缝',2.5,N'车缝')");
        c.Execute(@"INSERT INTO [款号物料明细表]([款号],[款式],[物料编号],[物料名称],[单位],[使用数量])
                    VALUES(N'P2TK01',N'P2测试款式',N'P2TM01',N'P2面料',N'米',2),
                          (N'P2TK01',N'P2测试款式',N'P2TM02',N'P2纽扣',N'粒',0.5)");
        c.Execute(@"INSERT INTO [款号颜色表]([款号],[款式],[颜色编号],[颜色名称],[ID])
                    VALUES(N'P2TK01',N'P2测试款式',N'C1',N'黑色',1),(N'P2TK01',N'P2测试款式',N'C2',N'白色',2)");
        c.Execute(@"INSERT INTO [款号尺码表]([款号],[款式],[尺码],[ID])
                    VALUES(N'P2TK01',N'P2测试款式',N'S',1),(N'P2TK01',N'P2测试款式',N'M',2),(N'P2TK01',N'P2测试款式',N'L',3)");
    }

    // FK 顺序：先删单据子表→单头→款式子表→款式→物料/加工厂/客户
    public static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [生产BOM物料清单] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [生产制单工序表] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [生产制单数量] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [成品客户订单明细表] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [成品客户订单总表] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [成品客户订货单] WHERE [客户编号]=N'P2TC01'");
        c.Execute("DELETE FROM [生产制单] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [款号物料明细表] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [款号明细表] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [款号颜色表] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [款号尺码表] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'P2TM01',N'P2TM02')");
        c.Execute("DELETE FROM [加工厂资料] WHERE [加工厂编号]=N'P2TF01'");
        c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'P2TC01'");
    }
}
```

- [ ] **Step 2: 写订单 DTO**

Create `src/ErpApi/Features/Orders/OrderDtos.cs`:

```csharp
namespace ErpApi.Features.Orders;

// 一行色×码数量
public sealed class OrderLineDto
{
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 数量 { get; set; }
}

// 新建订单（一单一款：成品客户订单总表.单号 是 UNIQUE）
public sealed class OrderCreateDto
{
    public string 客户编号 { get; set; } = "";
    public string? 客户名称 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 仓库 { get; set; }
    public string 款号 { get; set; } = "";
    public string? 款式 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 合同号 { get; set; }
    public string? 客户款号 { get; set; }
    public string? 备注 { get; set; }
    public List<OrderLineDto> 明细 { get; set; } = [];
}

// 列表行（订货单财务头；Dapper 按列名映射）
public sealed class OrderHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 仓库 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

// 款号头（订单总表）
public sealed class OrderStyleDto
{
    public string? 单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 生产单号 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 颜色组 { get; set; }
    public string? 尺码组 { get; set; }
    public string? 合同号 { get; set; }
    public string? 客户款号 { get; set; }
}

// 明细行（色×码）
public sealed class OrderLineRowDto
{
    public long ID { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}

// 详情 = 财务头 + 款号头 + 明细行
public sealed class OrderDetailDto
{
    public OrderHeaderDto? 订货单 { get; set; }
    public OrderStyleDto? 总表 { get; set; }
    public List<OrderLineRowDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 3: 写失败的 OrderService 测试**

Create `tests/ErpApi.Tests/OrderServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Orders;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class OrderServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private OrderService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static OrderCreateDto Dto() => new()
    {
        客户编号 = P2TestData.客户编号, 客户名称 = "P2测试客户",
        款号 = P2TestData.款号, 款式 = "P2测试款式",
        单价 = 100m, 仓库 = "成品仓", 交货日期 = new DateTime(2026, 7, 1),
        明细 =
        [
            new OrderLineDto { 色号 = "C1", 颜色 = "黑色", 尺码 = "S", 数量 = 10 },
            new OrderLineDto { 色号 = "C1", 颜色 = "黑色", 尺码 = "M", 数量 = 20 },
            new OrderLineDto { 色号 = "C2", 颜色 = "白色", 尺码 = "L", 数量 = 30 },
        ]
    };

    [SkippableFact]
    public async Task Create_writes_three_layers_with_totals()
    {
        using var c = fx.Open();
        P2TestData.Seed(c);

        var 单号 = await Svc().CreateAsync(Dto(), "tester");
        Assert.StartsWith("DD", 单号);   // 前缀DD+yyyyMMdd+流水

        // 三层都写入，且汇总正确：数量 60，金额 6000
        Assert.Equal(60m, c.ExecuteScalar<decimal>(
            "SELECT [数量] FROM [成品客户订货单] WHERE [单号]=@单号", new { 单号 }));
        Assert.Equal(6000m, c.ExecuteScalar<decimal>(
            "SELECT [金额] FROM [成品客户订货单] WHERE [单号]=@单号", new { 单号 }));
        Assert.Equal(1, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [成品客户订单总表] WHERE [单号]=@单号", new { 单号 }));
        Assert.Equal(3, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [成品客户订单明细表] WHERE [单号]=@单号", new { 单号 }));
        // 明细行金额 = 行数量×单价
        Assert.Equal(3000m, c.ExecuteScalar<decimal>(
            "SELECT [金额] FROM [成品客户订单明细表] WHERE [单号]=@单号 AND [尺码]=N'L'", new { 单号 }));
        // 新单未审核
        Assert.Equal("0", c.ExecuteScalar<string>(
            "SELECT [审核] FROM [成品客户订货单] WHERE [单号]=@单号", new { 单号 }));

        P2TestData.Cleanup(c);
    }

    [SkippableFact]
    public async Task Create_rejects_empty_lines()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var dto = Dto();
        dto.明细 = [];
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(dto, "tester"));
    }

    [SkippableFact]
    public async Task List_and_Get_return_created_order()
    {
        using var c = fx.Open();
        P2TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");

        var page = await Svc().ListAsync(1, 20, 单号);
        Assert.Equal(1, page.Total);
        Assert.Equal(单号, page.Items[0].单号);

        var detail = await Svc().GetAsync(单号);
        Assert.NotNull(detail);
        Assert.Equal(P2TestData.款号, detail!.总表!.款号);
        Assert.Equal(3, detail.明细.Count);

        P2TestData.Cleanup(c);
    }

    [SkippableFact]
    public async Task Delete_unapproved_removes_three_layers_but_approved_throws()
    {
        using var c = fx.Open();
        P2TestData.Seed(c);
        var 单号 = await Svc().CreateAsync(Dto(), "tester");

        // 审核后删除应抛异常
        c.Execute("UPDATE [成品客户订货单] SET [审核]='1' WHERE [单号]=@单号", new { 单号 });
        await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));

        // 反审核后可删，三层全清
        c.Execute("UPDATE [成品客户订货单] SET [审核]='0' WHERE [单号]=@单号", new { 单号 });
        Assert.True(await Svc().DeleteAsync(单号));
        Assert.Equal(0, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [成品客户订货单] WHERE [单号]=@单号", new { 单号 }));
        Assert.Equal(0, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [成品客户订单总表] WHERE [单号]=@单号", new { 单号 }));
        Assert.Equal(0, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [成品客户订单明细表] WHERE [单号]=@单号", new { 单号 }));

        // 删除不存在的单 → false
        Assert.False(await Svc().DeleteAsync("DD不存在"));

        P2TestData.Cleanup(c);
    }
}
```

- [ ] **Step 4: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~OrderServiceDbTests"`
Expected: FAIL（编译错误 OrderService 不存在）

- [ ] **Step 5: 实现 OrderService**

Create `src/ErpApi/Features/Orders/OrderService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Orders;

public sealed class OrderService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "成品客户订货单";
    public const string Prefix = "DD";   // 订单单号 = DD + yyyyMMdd + 3位流水

    // 创建：同一事务内 生成单号 → 订货单(财务头) → 订单总表(款号头) → 订单明细(色×码行)
    public async Task<string> CreateAsync(OrderCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("订单至少要有一行色码数量明细");
        if (string.IsNullOrWhiteSpace(dto.客户编号)) throw new ArgumentException("客户编号必填");
        if (string.IsNullOrWhiteSpace(dto.款号)) throw new ArgumentException("款号必填");

        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 单价 = dto.单价 ?? 0m;
        var 金额合计 = 数量合计 * 单价;
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        // 1. 订货单（财务头）
        await c.ExecuteAsync(@"
INSERT INTO [成品客户订货单]([单号],[日期],[交货日期],[客户编号],[客户名称],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@交货日期,@客户编号,@客户名称,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new
            {
                单号, 日期 = now, dto.交货日期, dto.客户编号, dto.客户名称, dto.仓库,
                数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注
            }, tx);

        // 2. 订单总表（款号头，单号 UNIQUE = 一单一款）；颜色组/尺码组/数量组为原系统宽表习惯的冗余串
        var 颜色组 = string.Join(",", dto.明细.Select(l => l.颜色).Distinct());
        var 尺码组 = string.Join(",", dto.明细.Select(l => l.尺码).Distinct());
        var 数量组 = string.Join(",", dto.明细.Select(l => l.数量));
        await c.ExecuteAsync(@"
INSERT INTO [成品客户订单总表]([单号],[日期],[交货日期],[客户编号],[客户名称],[仓库],[款号],[款式],
    [数量],[单价],[金额],[颜色组],[尺码组],[数量组],[审核],[备注],[客户款号],[合同号])
VALUES(@单号,@日期,@交货日期,@客户编号,@客户名称,@仓库,@款号,@款式,
    @数量,@单价,@金额,@颜色组,@尺码组,@数量组,'0',@备注,@客户款号,@合同号)",
            new
            {
                单号, 日期 = now, dto.交货日期, dto.客户编号, dto.客户名称, dto.仓库, dto.款号, dto.款式,
                数量 = 数量合计, 单价, 金额 = 金额合计, 颜色组, 尺码组, 数量组, dto.备注, dto.客户款号, dto.合同号
            }, tx);

        // 3. 订单明细（色×码行，FK→总表.单号）
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [成品客户订单明细表]([单号],[日期],[交货日期],[客户编号],[客户名称],[仓库],[款号],[款式],
    [色号],[颜色],[尺码],[数量],[单价],[金额],[审核],[客户款号],[合同号])
VALUES(@单号,@日期,@交货日期,@客户编号,@客户名称,@仓库,@款号,@款式,
    @色号,@颜色,@尺码,@数量,@单价,@金额,'0',@客户款号,@合同号)",
                new
                {
                    单号, 日期 = now, dto.交货日期, dto.客户编号, dto.客户名称, dto.仓库, dto.款号, dto.款式,
                    l.色号, l.颜色, l.尺码, l.数量, 单价, 金额 = l.数量 * 单价, dto.客户款号, dto.合同号
                }, tx);

        tx.Commit();
        return 单号;
    }

    // 分页列表（订货单财务头；关键字模糊匹配 单号/客户编号/客户名称/备注）
    public async Task<PagedResult<OrderHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";

        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [成品客户订货单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [客户编号] LIKE @kw OR [客户名称] LIKE @kw OR [备注] LIKE @kw;
SELECT * FROM [成品客户订货单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [客户编号] LIKE @kw OR [客户名称] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC
OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<OrderHeaderDto>()).AsList();
        return new PagedResult<OrderHeaderDto>(items, total);
    }

    // 详情：财务头 + 款号头 + 色码明细
    public async Task<OrderDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT * FROM [成品客户订货单] WHERE [单号]=@单号;
SELECT * FROM [成品客户订单总表] WHERE [单号]=@单号;
SELECT * FROM [成品客户订单明细表] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<OrderHeaderDto>();
        if (header is null) return null;
        var style = await multi.ReadFirstOrDefaultAsync<OrderStyleDto>();
        var lines = (await multi.ReadAsync<OrderLineRowDto>()).AsList();
        return new OrderDetailDto { 订货单 = header, 总表 = style, 明细 = lines };
    }

    // 删除：仅未审核可删；FK 顺序 明细→总表→订货单
    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [成品客户订货单] WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) { tx.Rollback(); return false; }
        if (审核 == "1") throw new InvalidOperationException("已审核的订单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [成品客户订单明细表] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [成品客户订单总表] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [成品客户订货单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 6: Program.cs 注册**

在 `src/ErpApi/Program.cs` 的 `// 业务` 区块追加：

```csharp
builder.Services.AddScoped<ErpApi.Features.Orders.OrderService>();
```

- [ ] **Step 7: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~OrderServiceDbTests"`
Expected: PASS 4 个

- [ ] **Step 8: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Orders/ src/ErpApi/Program.cs tests/ErpApi.Tests/P2TestData.cs tests/ErpApi.Tests/OrderServiceDbTests.cs
git commit -m @'
feat(P2): 接单服务(订货单三层创建/分页/详情/删除)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: OrderController（REST + 审核/反审核 + 成本保密）

**Files:**
- Create: `src/ErpApi/Features/Orders/OrderController.cs`
- Test: `tests/ErpApi.Tests/P2ApiIntegrationTests.cs`

- [ ] **Step 1: 写失败的 API 集成测试**

Create `tests/ErpApi.Tests/P2ApiIntegrationTests.cs`（仿照 `MasterApiIntegrationTests.cs` 的 WebApplicationFactory 写法）：

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
public class P2ApiIntegrationTests(DbFixture fx)
{
    private static IConfiguration JwtCfg() => new ConfigurationBuilder().AddInMemoryCollection(
        new Dictionary<string, string?>
        {
            ["Erp:Jwt:Issuer"] = "ErpApi", ["Erp:Jwt:Audience"] = "ErpClient", ["Erp:Jwt:ExpireMinutes"] = "60"
        }).Build();

    private WebApplicationFactory<Program> Factory()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Environment.SetEnvironmentVariable("ERP_DB", fx.ConnectionString);
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        return new WebApplicationFactory<Program>();
    }

    private static string Token(string user) => new JwtTokenService(JwtCfg()).Issue(user);

    // 9位权限按位授权：打开/保存/删除/单价/审核/反审核
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

    private static object OrderBody() => new
    {
        客户编号 = P2TestData.客户编号, 客户名称 = "P2测试客户",
        款号 = P2TestData.款号, 款式 = "P2测试款式", 单价 = 100, 仓库 = "成品仓",
        明细 = new[]
        {
            new { 色号 = "C1", 颜色 = "黑色", 尺码 = "S", 数量 = 10 },
            new { 色号 = "C2", 颜色 = "白色", 尺码 = "M", 数量 = 5 },
        }
    };

    [SkippableFact]
    public async Task Order_create_forbidden_without_save_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Seed(c); }
        SeedPerms("p2viewer", "成品客户订货单", open: true, save: false);

        var resp = await Client(app, "p2viewer").PostAsJsonAsync("/api/orders", OrderBody());
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);

        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Order_full_lifecycle_create_approve_unapprove_delete()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Seed(c); }
        SeedPerms("p2editor", "成品客户订货单",
            open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        var client = Client(app, "p2editor");

        // 创建
        var create = await client.PostAsJsonAsync("/api/orders", OrderBody());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;

        // 列表能查到
        var list = await client.GetFromJsonAsync<JsonElement>($"/api/orders?keyword={单号}");
        Assert.Equal(1, list.GetProperty("total").GetInt32());

        // 审核 → 已审核单不能删 → 反审核 → 可删
        Assert.Equal(HttpStatusCode.NoContent,
            (await client.PostAsync($"/api/orders/{单号}/approve", null)).StatusCode);
        // 重复审核 → 409
        Assert.Equal(HttpStatusCode.Conflict,
            (await client.PostAsync($"/api/orders/{单号}/approve", null)).StatusCode);
        // 已审核删除 → 409
        Assert.Equal(HttpStatusCode.Conflict,
            (await client.DeleteAsync($"/api/orders/{单号}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await client.PostAsync($"/api/orders/{单号}/unapprove", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await client.DeleteAsync($"/api/orders/{单号}")).StatusCode);

        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Order_approve_forbidden_without_审核_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Seed(c); }
        SeedPerms("p2saver", "成品客户订货单", open: true, save: true, approve: false);
        var client = Client(app, "p2saver");

        var create = await client.PostAsJsonAsync("/api/orders", OrderBody());
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;

        var resp = await client.PostAsync($"/api/orders/{单号}/approve", null);
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);

        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Order_amounts_masked_without_单价_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Seed(c); }
        // 编辑者建单
        SeedPerms("p2editor2", "成品客户订货单", open: true, save: true, price: true);
        var editor = Client(app, "p2editor2");
        var create = await editor.PostAsJsonAsync("/api/orders", OrderBody());
        var 单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString()!;

        // 无"单价"权限者：列表金额/详情单价金额 全部为 null（成本保密后端落实）
        SeedPerms("p2noprice", "成品客户订货单", open: true, price: false);
        var viewer = Client(app, "p2noprice");

        var list = await viewer.GetFromJsonAsync<JsonElement>($"/api/orders?keyword={单号}");
        var row = list.GetProperty("items").EnumerateArray().First();
        Assert.Equal(JsonValueKind.Null, row.GetProperty("金额").ValueKind);

        var detail = await viewer.GetFromJsonAsync<JsonElement>($"/api/orders/{单号}");
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("总表").GetProperty("单价").ValueKind);
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("明细")[0].GetProperty("金额").ValueKind);

        // 有"单价"权限者能看到
        var detail2 = await editor.GetFromJsonAsync<JsonElement>($"/api/orders/{单号}");
        Assert.Equal(100m, detail2.GetProperty("总表").GetProperty("单价").GetDecimal());

        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Cleanup(c); }
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~P2ApiIntegrationTests"`
Expected: FAIL（/api/orders 返回 404，控制器不存在）

- [ ] **Step 3: 实现 OrderController**

Create `src/ErpApi/Features/Orders/OrderController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Orders;

[ApiController]
[Authorize]
[Route("api/orders")]
public sealed class OrderController(
    OrderService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "成品客户订货单";
    private const string Table = "成品客户订货单";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }

    // 成本保密：无"单价"权限时剥离单价/金额（后端落实，不只前端隐藏）
    private static void MaskPrices(OrderDetailDto d)
    {
        if (d.订货单 is not null) d.订货单.金额 = null;
        if (d.总表 is not null) { d.总表.单价 = null; d.总表.金额 = null; }
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
        if (!await AllowAsync(PermissionAction.单价)) MaskPrices(d);
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] OrderCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547)  // FK 违反：客户/款号不存在
        { return BadRequest(new { 消息 = "客户编号或款号不存在，请先在基础资料中建立。" }); }
        await AuditAsync("新增", $"单号={单号}");
        return CreatedAtAction(nameof(Get), new { 单号 }, new { 单号 });
    }

    [HttpDelete("{单号}")]
    public async Task<IActionResult> Delete(string 单号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try
        {
            if (!await svc.DeleteAsync(单号)) return NotFound();
        }
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

Run: `dotnet test --filter "FullyQualifiedName~P2ApiIntegrationTests"`
Expected: PASS 4 个

- [ ] **Step 5: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Orders/OrderController.cs tests/ErpApi.Tests/P2ApiIntegrationTests.cs
git commit -m @'
feat(P2): 订单REST接口(审核/反审核过账+成本保密)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 6: ProductionService 创建（单头 + 数量明细 + 算法3 工序展开）

生产制单是中心枢纽。创建时在同一事务内：生成 `生产单号` → 插单头 → 插数量明细（规范化色×码） → **算法3 工序展开**（把 `款号明细表` 的工序工价复制为 `生产制单工序表`，复制而非引用——下单后改款式工价不影响已下单据）。

**重要 FK 顺序**：`生产制单工序表`/`生产制单数量` 都 FK 到 `生产制单.生产单号`，单头必须先插。但单头的 `工序数`/`工序单价` 又来自工序汇总 → 先从 `款号明细表` SELECT 汇总值，再插单头，最后复制工序行。

**Files:**
- Create: `src/ErpApi/Features/Production/ProductionDtos.cs`, `src/ErpApi/Features/Production/ProductionService.cs`
- Modify: `src/ErpApi/Program.cs`
- Test: `tests/ErpApi.Tests/ProductionServiceDbTests.cs`

- [ ] **Step 1: 写生产制单 DTO**

Create `src/ErpApi/Features/Production/ProductionDtos.cs`:

```csharp
namespace ErpApi.Features.Production;

// 一行颜色×尺码数量
public sealed class ProductionQtyDto
{
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 数量 { get; set; }
}

// 新建生产制单（可从订单生成：传 订单单号 则回写关联）
public sealed class ProductionCreateDto
{
    public string 款号 { get; set; } = "";
    public string? 款式 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 合同号 { get; set; }
    public string? 客户款号 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 跟单员 { get; set; }
    public decimal? 出货单价 { get; set; }
    public string? 备注 { get; set; }
    public List<ProductionQtyDto> 数量明细 { get; set; } = [];
}

// 列表行（单头）
public sealed class ProductionHeaderDto
{
    public long ID { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 合同号 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public DateTime? 日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 制单人 { get; set; }
    public string? 跟单员 { get; set; }
    public decimal? 计划数量 { get; set; }
    public decimal? 工序数 { get; set; }
    public decimal? 工序单价 { get; set; }
    public decimal? 物料金额 { get; set; }
    public decimal? 出货单价 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 完成 { get; set; }
    public string? 备注 { get; set; }
}

// 工序行（算法3 展开结果）
public sealed class ProductionProcessDto
{
    public long ID { get; set; }
    public string? 工序号 { get; set; }
    public string? 工序名称 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 工序类型 { get; set; }
}

// 数量行（规范化色×码）
public sealed class ProductionQtyRowDto
{
    public long ID { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 数量 { get; set; }
}

// BOM 行（算法4 展开结果）
public sealed class ProductionBomDto
{
    public long ID { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 总数量 { get; set; }
    public decimal? 库存数量 { get; set; }
    public decimal? 可用库存 { get; set; }
    public decimal? 需订数量 { get; set; }
    public decimal? 预算单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
}

// 详情 = 单头 + 数量 + 工序 + BOM
public sealed class ProductionDetailDto
{
    public ProductionHeaderDto? 单头 { get; set; }
    public List<ProductionQtyRowDto> 数量 { get; set; } = [];
    public List<ProductionProcessDto> 工序 { get; set; } = [];
    public List<ProductionBomDto> 物料 { get; set; } = [];
}

// BOM 展开的内部数据源行（款号物料明细表 LEFT JOIN 物料资料/供应商资料）
public sealed class BomSourceRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 使用数量 { get; set; }
    public decimal? 预算单价 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
}
```

- [ ] **Step 2: 写失败的测试（创建 + 算法3）**

Create `tests/ErpApi.Tests/ProductionServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Production;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class ProductionServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private ProductionService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static ProductionCreateDto Dto() => new()
    {
        款号 = P2TestData.款号, 款式 = "P2测试款式",
        客户编号 = P2TestData.客户编号, 客户名称 = "P2测试客户",
        加工厂编号 = P2TestData.加工厂编号, 加工厂名称 = "P2测试加工厂",
        交货日期 = new DateTime(2026, 8, 1), 出货单价 = 120m,
        数量明细 =
        [
            new ProductionQtyDto { 颜色 = "黑色", 尺码 = "S", 数量 = 40 },
            new ProductionQtyDto { 颜色 = "黑色", 尺码 = "M", 数量 = 30 },
            new ProductionQtyDto { 颜色 = "白色", 尺码 = "L", 数量 = 30 },
        ]
    };

    [SkippableFact]
    public async Task Create_writes_header_qty_and_expands_processes_算法3()
    {
        using var c = fx.Open();
        P2TestData.Seed(c);

        var 生产单号 = await Svc().CreateAsync(Dto(), "tester");
        Assert.StartsWith("SC", 生产单号);   // 前缀SC+yyyyMMdd+流水

        // 单头：计划数量 = 100
        Assert.Equal(100m, c.ExecuteScalar<decimal>(
            "SELECT [计划数量] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }));

        // 数量明细 3 行
        Assert.Equal(3, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [生产制单数量] WHERE [生产单号]=@生产单号", new { 生产单号 }));

        // === 算法3 工序展开断言 ===
        // 款号有 2 道工序(裁床1.5 + 车缝2.5) → 复制到生产制单工序表
        Assert.Equal(2, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [生产制单工序表] WHERE [生产单号]=@生产单号", new { 生产单号 }));
        // 单头汇总：工序数=2，工序单价=4.0（单件工费）
        Assert.Equal(2m, c.ExecuteScalar<decimal>(
            "SELECT [工序数] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }));
        Assert.Equal(4.0m, c.ExecuteScalar<decimal>(
            "SELECT [工序单价] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }));
        // 计划工费 = 计划数量 × 单件工费 = 100 × 4 = 400（口径校验，不落库，由前端/报表算）
        var 工序单价 = c.ExecuteScalar<decimal>(
            "SELECT [工序单价] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 });
        var 计划数量 = c.ExecuteScalar<decimal>(
            "SELECT [计划数量] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 });
        Assert.Equal(400m, 工序单价 * 计划数量);
        // 复制的工序内容正确
        Assert.Equal(1.5m, c.ExecuteScalar<decimal>(
            "SELECT [单价] FROM [生产制单工序表] WHERE [生产单号]=@生产单号 AND [工序名称]=N'裁床'", new { 生产单号 }));

        // 新单未审核
        Assert.Equal("0", c.ExecuteScalar<string>(
            "SELECT [审核] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }));

        P2TestData.Cleanup(c);
    }

    [SkippableFact]
    public async Task Create_rejects_empty_qty_lines()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var dto = Dto();
        dto.数量明细 = [];
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(dto, "tester"));
    }
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~ProductionServiceDbTests"`
Expected: FAIL（编译错误 ProductionService 不存在）

- [ ] **Step 4: 实现 ProductionService（本任务先实现 CreateAsync 的 单头+数量+算法3 部分）**

Create `src/ErpApi/Features/Production/ProductionService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Production;

public sealed class ProductionService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "生产制单";
    public const string Prefix = "SC";   // 生产单号 = SC + yyyyMMdd + 3位流水

    // 创建：生成单号 → 算汇总 → 插单头 → 插数量明细 → 算法3工序展开 → (Task 7: 算法4 BOM展开 + 订单回写)
    public async Task<string> CreateAsync(ProductionCreateDto dto, string user)
    {
        if (dto.数量明细.Count == 0) throw new ArgumentException("生产制单至少要有一行颜色尺码数量");
        if (string.IsNullOrWhiteSpace(dto.款号)) throw new ArgumentException("款号必填");

        var 计划数量 = dto.数量明细.Sum(q => q.数量);
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        var 生产单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        // 先从款式工序工价里取汇总（单头要用），FK 要求单头先插再插工序行
        var 工序汇总 = await c.QueryFirstAsync<(int 工序数, decimal 工序单价)>(@"
SELECT COUNT(*) AS 工序数, ISNULL(SUM([单价]),0) AS 工序单价
FROM [款号明细表] WHERE [款号]=@款号", new { dto.款号 }, tx);

        // 1. 单头
        await c.ExecuteAsync(@"
INSERT INTO [生产制单]([生产单号],[款号],[款式],[合同号],[客户款号],[客户编号],[客户名称],
    [加工厂编号],[加工厂名称],[日期],[交货日期],[制单人],[跟单员],[操作员],
    [计划数量],[工序数],[工序单价],[物料金额],[出货单价],
    [审核],[完成],[工序审核],[BOM审核],[下单日期],[备注])
VALUES(@生产单号,@款号,@款式,@合同号,@客户款号,@客户编号,@客户名称,
    @加工厂编号,@加工厂名称,@日期,@交货日期,@制单人,@跟单员,@制单人,
    @计划数量,@工序数,@工序单价,0,@出货单价,
    '0',N'否','0','0',@日期,@备注)",
            new
            {
                生产单号, dto.款号, dto.款式, dto.合同号, dto.客户款号, dto.客户编号, dto.客户名称,
                dto.加工厂编号, dto.加工厂名称, 日期 = now, dto.交货日期, 制单人 = user, dto.跟单员,
                计划数量, 工序汇总.工序数, 工序汇总.工序单价, dto.出货单价, dto.备注
            }, tx);

        // 2. 数量明细（规范化色×码行）
        foreach (var q in dto.数量明细)
            await c.ExecuteAsync(@"
INSERT INTO [生产制单数量]([生产单号],[款号],[款式],[客户款号],[合同号],[日期],
    [客户编号],[客户名称],[加工厂编号],[加工厂名称],[颜色],[尺码],[数量])
VALUES(@生产单号,@款号,@款式,@客户款号,@合同号,@日期,
    @客户编号,@客户名称,@加工厂编号,@加工厂名称,@颜色,@尺码,@数量)",
                new
                {
                    生产单号, dto.款号, dto.款式, dto.客户款号, dto.合同号, 日期 = now,
                    dto.客户编号, dto.客户名称, dto.加工厂编号, dto.加工厂名称, q.颜色, q.尺码, q.数量
                }, tx);

        // 3. === 算法3 工费展开 ===
        // 把款式工序工价复制为本单工序表（复制而非引用：下单后改款式工价不影响已下单据）。
        // 计划工费 = 计划数量 × Σ(工序单价)；实做工费按工票实际完成数量算（P4 落地）。
        await c.ExecuteAsync(@"
INSERT INTO [生产制单工序表]([生产单号],[款号],[款式],[客户款号],[合同号],
    [工序号],[工序名称],[单价],[工序类型],[备注],[审核])
SELECT @生产单号,[款号],[款式],@客户款号,@合同号,
    [工序号],[工序名称],[单价],[工序类型],[备注],'0'
FROM [款号明细表] WHERE [款号]=@款号",
            new { 生产单号, dto.款号, dto.客户款号, dto.合同号 }, tx);

        // 4. 算法4 BOM 展开 + 订单回写（Task 7 实现）
        await ExpandBomAsync(c, tx, 生产单号, dto, 计划数量, now);
        await LinkOrderAsync(c, tx, 生产单号, dto.订单单号);

        tx.Commit();
        return 生产单号;
    }

    // 算法4 BOM展开（Task 7 实现；本任务先留空壳保证编译/测试通过）
    private Task ExpandBomAsync(SqlConnection c, SqlTransaction tx,
        string 生产单号, ProductionCreateDto dto, decimal 计划数量, DateTime now)
        => Task.CompletedTask;

    // 订单回写（Task 7 实现）
    private Task LinkOrderAsync(SqlConnection c, SqlTransaction tx, string 生产单号, string? 订单单号)
        => Task.CompletedTask;
}
```

- [ ] **Step 5: Program.cs 注册**

在 `src/ErpApi/Program.cs` 的 `// 业务` 区块追加：

```csharp
builder.Services.AddScoped<ErpApi.Features.Production.ProductionService>();
```

- [ ] **Step 6: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~ProductionServiceDbTests"`
Expected: PASS 2 个

- [ ] **Step 7: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Production/ src/ErpApi/Program.cs tests/ErpApi.Tests/ProductionServiceDbTests.cs
git commit -m @'
feat(P2): 生产制单创建(单头+数量明细+算法3工序展开)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 7: 算法4 BOM 物料需求展开/缺料 + 从订单生成回写

补全 `ExpandBomAsync`（算法4）和 `LinkOrderAsync`（订单↔制单关联）。

**算法4**：对款式 BOM（`款号物料明细表`）的每一行：
- `总数量` = `使用数量` × `计划数量`（物料需求）
- `库存数量` = 该物料的当前库存（采购入仓(+) + 退料(+) − 领料(−)，只认已审核单；P3 物料侧落地前自然为 0）
- `需订数量` = max(0, 总数量 − 库存数量)（缺料）
- `预算单价` = `物料资料.单价`，`金额` = 总数量 × 预算单价
- 供应商从 `物料资料.供应商编号` 带出，但必须在 `供应商资料` 中存在才写（FK 约束）
- 单头 `物料金额` = Σ(金额)

**Files:**
- Modify: `src/ErpApi/Features/Production/ProductionService.cs`
- Test: `tests/ErpApi.Tests/ProductionServiceDbTests.cs`（追加）

- [ ] **Step 1: 写失败的测试（算法4 + 订单回写）**

在 `tests/ErpApi.Tests/ProductionServiceDbTests.cs` 追加（文件头部需补 `using ErpApi.Features.Orders;`）：

```csharp
    [SkippableFact]
    public async Task Create_expands_bom_with_shortage_算法4()
    {
        using var c = fx.Open();
        P2TestData.Seed(c);

        var 生产单号 = await Svc().CreateAsync(Dto(), "tester");
        // 计划数量 = 100；BOM: 面料用量2(单价10)、纽扣用量0.5(单价0.2)

        // === 算法4 断言 ===
        // 面料需求 = 2 × 100 = 200；库存 0 → 需订 200；金额 = 200×10 = 2000
        var 面料 = c.QueryFirst(
            "SELECT * FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'P2TM01'",
            new { 生产单号 });
        Assert.Equal(200m, (decimal)面料.总数量);
        Assert.Equal(0m, (decimal)面料.库存数量);
        Assert.Equal(200m, (decimal)面料.需订数量);
        Assert.Equal(10m, (decimal)面料.预算单价);
        Assert.Equal(2000m, (decimal)面料.金额);

        // 纽扣需求 = 0.5 × 100 = 50；金额 = 50×0.2 = 10
        var 纽扣 = c.QueryFirst(
            "SELECT * FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'P2TM02'",
            new { 生产单号 });
        Assert.Equal(50m, (decimal)纽扣.总数量);
        Assert.Equal(10m, (decimal)纽扣.金额);

        // 单头物料金额 = 2000 + 10 = 2010
        Assert.Equal(2010m, c.ExecuteScalar<decimal>(
            "SELECT [物料金额] FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }));

        P2TestData.Cleanup(c);
    }

    [SkippableFact]
    public async Task Create_bom_deducts_material_stock_when_available()
    {
        using var c = fx.Open();
        P2TestData.Seed(c);

        // 模拟已审核采购入仓 120 米面料（库存扣减验证：需求200 - 库存120 = 需订80）
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号]=N'P2TCG01'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=N'P2TCG01'");
        c.Execute("INSERT INTO [采购入仓单]([单号],[审核]) VALUES(N'P2TCG01','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[物料编号],[物料名称],[数量])
                    VALUES(N'P2TCG01',N'P2TM01',N'P2面料',120)");

        var 生产单号 = await Svc().CreateAsync(Dto(), "tester");

        var 面料 = c.QueryFirst(
            "SELECT * FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 AND [物料编号]=N'P2TM01'",
            new { 生产单号 });
        Assert.Equal(200m, (decimal)面料.总数量);
        Assert.Equal(120m, (decimal)面料.库存数量);
        Assert.Equal(80m, (decimal)面料.需订数量);   // 缺料 = 需求 - 库存

        c.Execute("DELETE FROM [采购入仓明细单] WHERE [单号]=N'P2TCG01'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=N'P2TCG01'");
        P2TestData.Cleanup(c);
    }

    [SkippableFact]
    public async Task Create_from_order_links_生产单号_back_to_order()
    {
        using var c = fx.Open();
        P2TestData.Seed(c);

        // 先建一张订单
        var orderSvc = new OrderService(Factory(), new DocumentNumberGenerator());
        var 订单单号 = await orderSvc.CreateAsync(new OrderCreateDto
        {
            客户编号 = P2TestData.客户编号, 客户名称 = "P2测试客户",
            款号 = P2TestData.款号, 款式 = "P2测试款式", 单价 = 100m,
            明细 = [new OrderLineDto { 颜色 = "黑色", 尺码 = "S", 数量 = 100 }]
        }, "tester");

        // 从订单生成生产制单
        var dto = Dto();
        dto.订单单号 = 订单单号;
        var 生产单号 = await Svc().CreateAsync(dto, "tester");

        // 回写：订单总表/明细表 的 生产单号 字段被填上
        Assert.Equal(生产单号, c.ExecuteScalar<string>(
            "SELECT [生产单号] FROM [成品客户订单总表] WHERE [单号]=@订单单号", new { 订单单号 }));
        Assert.Equal(生产单号, c.ExecuteScalar<string>(
            "SELECT TOP 1 [生产单号] FROM [成品客户订单明细表] WHERE [单号]=@订单单号", new { 订单单号 }));

        P2TestData.Cleanup(c);
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~ProductionServiceDbTests"`
Expected: 新增 3 个 FAIL（BOM 表无行 / 回写为 NULL），原有 2 个 PASS

- [ ] **Step 3: 实现 ExpandBomAsync 和 LinkOrderAsync**

替换 `src/ErpApi/Features/Production/ProductionService.cs` 中两个空壳方法：

```csharp
    // === 算法4 BOM 物料需求展开/缺料 ===
    // 需求(总数量) = 款号物料明细表.使用数量 × 计划数量
    // 库存数量 = 采购入仓(+) + 退料(+) − 领料(−)，只认已审核单（P3 物料侧落地前自然为 0）
    // 需订数量(缺料) = max(0, 总数量 − 库存数量)
    // 预算单价 = 物料资料.单价；金额 = 总数量 × 预算单价；单头.物料金额 = Σ(金额)
    private async Task ExpandBomAsync(SqlConnection c, SqlTransaction tx,
        string 生产单号, ProductionCreateDto dto, decimal 计划数量, DateTime now)
    {
        // 供应商 LEFT JOIN 供应商资料 校验：FK 要求 生产BOM物料清单.供应商编号 必须存在于供应商资料
        var rows = (await c.QueryAsync<BomSourceRow>(@"
SELECT b.[物料编号], b.[物料名称], b.[物料类别], b.[规格], b.[颜色], b.[单位], b.[使用数量],
       m.[单价] AS 预算单价, s.[供应商编号], s.[供应商名称]
FROM [款号物料明细表] b
LEFT JOIN [物料资料] m ON m.[物料编号] = b.[物料编号]
LEFT JOIN [供应商资料] s ON s.[供应商编号] = m.[供应商编号]
WHERE b.[款号]=@款号", new { dto.款号 }, tx)).AsList();

        decimal 物料金额合计 = 0;
        foreach (var b in rows)
        {
            var 总数量 = (b.使用数量 ?? 0) * 计划数量;
            var 库存数量 = await MaterialStockAsync(c, tx, b.物料编号);
            var 需订数量 = Math.Max(0, 总数量 - 库存数量);
            var 金额 = 总数量 * (b.预算单价 ?? 0);
            物料金额合计 += 金额;

            await c.ExecuteAsync(@"
INSERT INTO [生产BOM物料清单]([日期],[制单日期],[生产单号],[款号],[款式],[客户款号],[合同号],
    [物料编号],[物料名称],[规格],[颜色],[单位],
    [总数量],[库存数量],[可用库存],[需订数量],[订货数量],[预算单价],[金额],
    [供应商编号],[供应商名称],[审核])
VALUES(@日期,@日期,@生产单号,@款号,@款式,@客户款号,@合同号,
    @物料编号,@物料名称,@规格,@颜色,@单位,
    @总数量,@库存数量,@库存数量,@需订数量,0,@预算单价,@金额,
    @供应商编号,@供应商名称,'0')",
                new
                {
                    日期 = now, 生产单号, dto.款号, dto.款式, dto.客户款号, dto.合同号,
                    b.物料编号, b.物料名称, b.规格, b.颜色, b.单位,
                    总数量, 库存数量, 需订数量, b.预算单价, 金额, b.供应商编号, b.供应商名称
                }, tx);
        }

        await c.ExecuteAsync(
            "UPDATE [生产制单] SET [物料金额]=@物料金额 WHERE [生产单号]=@生产单号",
            new { 物料金额 = 物料金额合计, 生产单号 }, tx);
    }

    // 物料当前库存：明细表 JOIN 单头（审核标志在单头），符号法 UNION
    private static async Task<decimal> MaterialStockAsync(
        SqlConnection c, SqlTransaction tx, string? 物料编号)
    {
        if (string.IsNullOrEmpty(物料编号)) return 0;
        return await c.ExecuteScalarAsync<decimal?>(@"
SELECT ISNULL(SUM(t.qty), 0) FROM (
    SELECT d.[数量] AS qty FROM [采购入仓明细单] d
        JOIN [采购入仓单] h ON h.[单号]=d.[单号]
        WHERE d.[物料编号]=@物料编号 AND ISNULL(h.[审核],'0')='1'
    UNION ALL
    SELECT d.[数量] FROM [退料明细单] d
        JOIN [退料单] h ON h.[单号]=d.[单号]
        WHERE d.[物料编号]=@物料编号 AND ISNULL(h.[审核],'0')='1'
    UNION ALL
    SELECT d.[数量] * -1 FROM [领料明细单] d
        JOIN [领料单] h ON h.[单号]=d.[单号]
        WHERE d.[物料编号]=@物料编号 AND ISNULL(h.[审核],'0')='1'
) t", new { 物料编号 }, tx) ?? 0;
    }

    // 从订单生成：把 生产单号 回写到订单总表/明细表（FK: 订单表.生产单号 → 生产制单.生产单号，单头已插所以安全）
    private static async Task LinkOrderAsync(
        SqlConnection c, SqlTransaction tx, string 生产单号, string? 订单单号)
    {
        if (string.IsNullOrWhiteSpace(订单单号)) return;
        var n = await c.ExecuteAsync(
            "UPDATE [成品客户订单总表] SET [生产单号]=@生产单号 WHERE [单号]=@订单单号",
            new { 生产单号, 订单单号 }, tx);
        if (n == 0) throw new ArgumentException($"订单 [{订单单号}] 不存在，无法关联生产制单。");
        await c.ExecuteAsync(
            "UPDATE [成品客户订单明细表] SET [生产单号]=@生产单号 WHERE [单号]=@订单单号",
            new { 生产单号, 订单单号 }, tx);
    }
```

同时把 `LinkOrderAsync`/`MaterialStockAsync` 的调用处改为静态调用一致（`ExpandBomAsync` 是实例方法、其余两个是静态方法，签名按上面的来）。`CreateAsync` 中两处调用保持不变：

```csharp
        await ExpandBomAsync(c, tx, 生产单号, dto, 计划数量, now);
        await LinkOrderAsync(c, tx, 生产单号, dto.订单单号);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~ProductionServiceDbTests"`
Expected: PASS 5 个

- [ ] **Step 5: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Production/ tests/ErpApi.Tests/ProductionServiceDbTests.cs
git commit -m @'
feat(P2): 算法4 BOM物料需求展开/缺料 + 订单关联回写

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 8: ProductionService 查询/删除 + ProductionController（REST + 审核 + 成本保密）

**Files:**
- Modify: `src/ErpApi/Features/Production/ProductionService.cs`（追加 List/Get/Delete）
- Create: `src/ErpApi/Features/Production/ProductionController.cs`
- Test: `tests/ErpApi.Tests/ProductionServiceDbTests.cs`（追加）, `tests/ErpApi.Tests/P2ApiIntegrationTests.cs`（追加）

- [ ] **Step 1: 写失败的 Service 查询/删除测试**

在 `tests/ErpApi.Tests/ProductionServiceDbTests.cs` 追加：

```csharp
    [SkippableFact]
    public async Task List_Get_and_Delete_production_order()
    {
        using var c = fx.Open();
        P2TestData.Seed(c);
        var 生产单号 = await Svc().CreateAsync(Dto(), "tester");

        // 列表
        var page = await Svc().ListAsync(1, 20, 生产单号);
        Assert.Equal(1, page.Total);
        Assert.Equal(生产单号, page.Items[0].生产单号);

        // 详情：单头 + 3行数量 + 2道工序 + 2行BOM
        var detail = await Svc().GetAsync(生产单号);
        Assert.NotNull(detail);
        Assert.Equal(P2TestData.款号, detail!.单头!.款号);
        Assert.Equal(3, detail.数量.Count);
        Assert.Equal(2, detail.工序.Count);
        Assert.Equal(2, detail.物料.Count);

        // 已审核不能删
        c.Execute("UPDATE [生产制单] SET [审核]='1' WHERE [生产单号]=@生产单号", new { 生产单号 });
        await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(生产单号));

        // 反审核后可删，全部子表清空
        c.Execute("UPDATE [生产制单] SET [审核]='0' WHERE [生产单号]=@生产单号", new { 生产单号 });
        Assert.True(await Svc().DeleteAsync(生产单号));
        Assert.Equal(0, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }));
        Assert.Equal(0, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [生产制单工序表] WHERE [生产单号]=@生产单号", new { 生产单号 }));
        Assert.Equal(0, c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号", new { 生产单号 }));

        Assert.False(await Svc().DeleteAsync("SC不存在"));

        P2TestData.Cleanup(c);
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~ProductionServiceDbTests"`
Expected: 新增 1 个 FAIL（编译错误 ListAsync 不存在）

- [ ] **Step 3: 实现 List/Get/Delete**

在 `src/ErpApi/Features/Production/ProductionService.cs` 追加方法：

```csharp
    // 分页列表（单头；关键字模糊匹配 生产单号/款号/款式/客户名称/合同号）
    public async Task<PagedResult<ProductionHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";

        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [生产制单]
WHERE @kw IS NULL OR [生产单号] LIKE @kw OR [款号] LIKE @kw OR [款式] LIKE @kw
   OR [客户名称] LIKE @kw OR [合同号] LIKE @kw;
SELECT * FROM [生产制单]
WHERE @kw IS NULL OR [生产单号] LIKE @kw OR [款号] LIKE @kw OR [款式] LIKE @kw
   OR [客户名称] LIKE @kw OR [合同号] LIKE @kw
ORDER BY [ID] DESC
OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<ProductionHeaderDto>()).AsList();
        return new PagedResult<ProductionHeaderDto>(items, total);
    }

    // 详情：单头 + 数量 + 工序 + BOM
    public async Task<ProductionDetailDto?> GetAsync(string 生产单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT * FROM [生产制单] WHERE [生产单号]=@生产单号;
SELECT * FROM [生产制单数量] WHERE [生产单号]=@生产单号 ORDER BY [ID];
SELECT * FROM [生产制单工序表] WHERE [生产单号]=@生产单号 ORDER BY [工序号];
SELECT * FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 ORDER BY [ID];",
            new { 生产单号 });
        var header = await multi.ReadFirstOrDefaultAsync<ProductionHeaderDto>();
        if (header is null) return null;
        return new ProductionDetailDto
        {
            单头 = header,
            数量 = (await multi.ReadAsync<ProductionQtyRowDto>()).AsList(),
            工序 = (await multi.ReadAsync<ProductionProcessDto>()).AsList(),
            物料 = (await multi.ReadAsync<ProductionBomDto>()).AsList(),
        };
    }

    // 删除：仅未审核可删；先清订单回写引用 → 删子表 → 删单头
    public async Task<bool> DeleteAsync(string 生产单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        if (审核 is null) { tx.Rollback(); return false; }
        if (审核 == "1") throw new InvalidOperationException("已审核的生产制单不能删除，请先反审核。");

        // 清除订单上的关联引用（FK 不允许删被引用的单头）
        await c.ExecuteAsync("UPDATE [成品客户订单总表] SET [生产单号]=NULL WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        await c.ExecuteAsync("UPDATE [成品客户订单明细表] SET [生产单号]=NULL WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        // 删子表（FK→单头）
        await c.ExecuteAsync("DELETE FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [生产制单工序表] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [生产制单数量] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        // 删单头
        await c.ExecuteAsync("DELETE FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        tx.Commit();
        return true;
    }
```

- [ ] **Step 4: 跑 Service 测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~ProductionServiceDbTests"`
Expected: PASS 6 个

- [ ] **Step 5: 写失败的 API 集成测试**

在 `tests/ErpApi.Tests/P2ApiIntegrationTests.cs` 追加：

```csharp
    private static object ProductionBody() => new
    {
        款号 = P2TestData.款号, 款式 = "P2测试款式",
        客户编号 = P2TestData.客户编号, 客户名称 = "P2测试客户",
        加工厂编号 = P2TestData.加工厂编号, 加工厂名称 = "P2测试加工厂",
        出货单价 = 120,
        数量明细 = new[]
        {
            new { 颜色 = "黑色", 尺码 = "S", 数量 = 50 },
            new { 颜色 = "白色", 尺码 = "M", 数量 = 50 },
        }
    };

    [SkippableFact]
    public async Task Production_lifecycle_create_detail_approve_with_permissions()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Seed(c); }
        SeedPerms("p2prod", "生产制单",
            open: true, save: true, del: true, price: true, approve: true, unapprove: true);
        var client = Client(app, "p2prod");

        // 创建（算法3+4 自动展开）
        var create = await client.PostAsJsonAsync("/api/production", ProductionBody());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 生产单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("生产单号").GetString()!;

        // 详情含 工序/物料 展开结果
        var detail = await client.GetFromJsonAsync<JsonElement>($"/api/production/{生产单号}");
        Assert.Equal(2, detail.GetProperty("工序").GetArrayLength());
        Assert.Equal(2, detail.GetProperty("物料").GetArrayLength());

        // 审核 → 反审核 → 删除
        Assert.Equal(HttpStatusCode.NoContent,
            (await client.PostAsync($"/api/production/{生产单号}/approve", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await client.PostAsync($"/api/production/{生产单号}/unapprove", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await client.DeleteAsync($"/api/production/{生产单号}")).StatusCode);

        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Production_prices_masked_without_单价_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Seed(c); }
        SeedPerms("p2prodeditor", "生产制单", open: true, save: true, price: true);
        var editor = Client(app, "p2prodeditor");
        var create = await editor.PostAsJsonAsync("/api/production", ProductionBody());
        var 生产单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("生产单号").GetString()!;

        SeedPerms("p2prodviewer", "生产制单", open: true, price: false);
        var viewer = Client(app, "p2prodviewer");

        // 列表：工序单价/物料金额/出货单价 被剥离
        var list = await viewer.GetFromJsonAsync<JsonElement>($"/api/production?keyword={生产单号}");
        var row = list.GetProperty("items").EnumerateArray().First();
        Assert.Equal(JsonValueKind.Null, row.GetProperty("工序单价").ValueKind);
        Assert.Equal(JsonValueKind.Null, row.GetProperty("物料金额").ValueKind);
        Assert.Equal(JsonValueKind.Null, row.GetProperty("出货单价").ValueKind);

        // 详情：工序.单价 / 物料.预算单价/金额 被剥离
        var detail = await viewer.GetFromJsonAsync<JsonElement>($"/api/production/{生产单号}");
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("工序")[0].GetProperty("单价").ValueKind);
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("物料")[0].GetProperty("预算单价").ValueKind);

        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P2TestData.Cleanup(c); }
    }
```

- [ ] **Step 6: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~P2ApiIntegrationTests"`
Expected: 新增 2 个 FAIL（/api/production 404），原有 4 个 PASS

- [ ] **Step 7: 实现 ProductionController**

Create `src/ErpApi/Features/Production/ProductionController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Production;

[ApiController]
[Authorize]
[Route("api/production")]
public sealed class ProductionController(
    ProductionService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "生产制单";
    private const string Table = "生产制单";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }

    // 成本保密：无"单价"权限时剥离一切价格/金额字段（后端落实）
    private static void MaskHeader(ProductionHeaderDto h)
    { h.工序单价 = null; h.物料金额 = null; h.出货单价 = null; }

    private static void MaskDetail(ProductionDetailDto d)
    {
        if (d.单头 is not null) MaskHeader(d.单头);
        foreach (var p in d.工序) p.单价 = null;
        foreach (var b in d.物料) { b.预算单价 = null; b.金额 = null; }
    }

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(page, size, keyword);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var h in result.Items) MaskHeader(h);
        return Ok(result);
    }

    [HttpGet("{生产单号}")]
    public async Task<IActionResult> Get(string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(生产单号);
        if (d is null) return NotFound();
        if (!await AllowAsync(PermissionAction.单价)) MaskDetail(d);
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] ProductionCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 生产单号;
        try { 生产单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547)  // FK 违反
        { return BadRequest(new { 消息 = "款号/客户/加工厂不存在，请先在基础资料中建立。" }); }
        await AuditAsync("新增", $"单号={生产单号}");
        return CreatedAtAction(nameof(Get), new { 生产单号 }, new { 生产单号 });
    }

    [HttpDelete("{生产单号}")]
    public async Task<IActionResult> Delete(string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try
        {
            if (!await svc.DeleteAsync(生产单号)) return NotFound();
        }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("删除", $"单号={生产单号}");
        return NoContent();
    }

    [HttpPost("{生产单号}/approve")]
    public async Task<IActionResult> Approve(string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        if (!await posting.ApproveAsync(Table, 生产单号, CurrentUser))
            return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        return NoContent();
    }

    [HttpPost("{生产单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        if (!await posting.UnapproveAsync(Table, 生产单号, CurrentUser))
            return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        return NoContent();
    }
}
```

- [ ] **Step 8: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~P2ApiIntegrationTests"`
Expected: PASS 6 个

- [ ] **Step 9: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Production/ tests/ErpApi.Tests/
git commit -m @'
feat(P2): 生产制单REST接口(查询/删除/审核+成本保密)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 9: 权限种子脚本 + 后端收尾回归

**Files:**
- Create: `db/seed_p2_perms.sql`
- Modify: 无代码改动；本任务以脚本+回归为主

- [ ] **Step 1: 写 P2 权限种子脚本**

Create `db/seed_p2_perms.sql`（仿照 `db/seed_p1_perms.sql`；P2 是单据菜单，审核/反审核位 = 1）:

```sql
-- 开发用:给某用户授予 P2 业务菜单(款号资料/成品客户订货单/生产制单)的全部权限。
-- 用法:把 @用户 改成你的登录名,在目标库执行。
DECLARE @用户 nvarchar(30) = N'admin';
DECLARE @menus TABLE([菜单] nvarchar(40));
INSERT INTO @menus VALUES (N'款号资料'),(N'成品客户订货单'),(N'生产制单');
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (SELECT [菜单] FROM @menus);
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
SELECT @用户,[菜单],1,1,1,1,1,1,1,1,1 FROM @menus;
```

- [ ] **Step 2: 在开发库和测试库执行种子**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
# 用 sqlcmd 不行(连不上LocalDB)，用 DbDeploy 或直接 Invoke-Sqlcmd；最简单：临时 .NET 脚本或复用 DbDeploy
dotnet run --project tools/DbDeploy -- "$env:ERP_DB" db/seed_p2_perms.sql
```

注意：先查看 `tools/DbDeploy` 的用法（`Get-Content tools/DbDeploy/Program.cs` 看参数约定），若它只支持固定的 01/02/03 脚本列表，则改用以下 PowerShell 内联方式执行：

```powershell
Add-Type -AssemblyName "Microsoft.Data.SqlClient" -ErrorAction SilentlyContinue
# 最稳妥:写一个一次性 C# 脚本放 tmp/ 执行,或临时把 seed 内容用 Dapper 跑(子代理自行选择最简单可行方式)
# 验收标准:SELECT COUNT(*) FROM userbqrpower WHERE 用户='admin' AND 菜单 IN (N'款号资料',N'成品客户订货单',N'生产制单') 返回 3
```

Expected: 开发库（erp）和测试库（erp_test）的 `userbqrpower` 各多 3 行 admin 权限

- [ ] **Step 3: 后端全量回归**

Run: `dotnet test`
Expected: 全部 PASS，0 失败；有 ERP_TEST_DB 时 0 跳过

- [ ] **Step 4: 启动后端冒烟**

```powershell
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
$env:ERP_JWT_KEY = [Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")
# 后台启动后用 curl 冒烟（登录 → 列表）
dotnet run --project src/ErpApi --urls http://localhost:5000
```

另开 shell：

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/login -ContentType "application/json" -Body '{"用户":"admin","密码":"admin123"}'
$h = @{ Authorization = "Bearer $($login.令牌)" }
Invoke-RestMethod -Uri "http://localhost:5000/api/orders?page=1&size=5" -Headers $h
Invoke-RestMethod -Uri "http://localhost:5000/api/production?page=1&size=5" -Headers $h
Invoke-RestMethod -Uri "http://localhost:5000/api/master/styles?page=1&size=5" -Headers $h
```

Expected: 三个请求都返回 `{items:[], total:0}`（HTTP 200，无 403/500）

- [ ] **Step 5: 提交**

```powershell
git add db/seed_p2_perms.sql
git commit -m @'
feat(P2): P2业务菜单权限种子脚本

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 10: 前端 — 矩阵工具函数 + 款号资料页 + 款式详情页

前端遵循已定稿的「彩色仪表盘」风格（浅色+靛蓝、圆角、Tag 彩色）。本任务交付：色×码矩阵纯函数（可测）、款号资料进 MASTER_CONFIGS（自动出现在基础资料菜单）、款式详情页（颜色/尺码/工序/BOM 四个 Tab）。

**Files:**
- Create: `web/src/utils/matrix.ts`, `web/src/api/styles.ts`, `web/src/pages/styles/StyleDetailPage.tsx`
- Modify: `web/src/pages/master/configs.ts`, `web/src/pages/master/MasterDataPage.tsx`, `web/src/App.tsx`
- Test: `web/src/__tests__/matrix.test.ts`

- [ ] **Step 1: 写失败的矩阵函数测试**

Create `web/src/__tests__/matrix.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { cellKey, linesToMatrix, matrixToLines, sumMatrix } from "../utils/matrix";

describe("色×码数量矩阵", () => {
  it("matrixToLines 只导出数量>0的格子,保持 颜色×尺码 顺序", () => {
    const qty = { [cellKey("黑色", "S")]: 10, [cellKey("黑色", "M")]: 0, [cellKey("白色", "L")]: 5 };
    const lines = matrixToLines(["黑色", "白色"], ["S", "M", "L"], qty);
    expect(lines).toEqual([
      { 颜色: "黑色", 尺码: "S", 数量: 10 },
      { 颜色: "白色", 尺码: "L", 数量: 5 },
    ]);
  });

  it("sumMatrix 合计全部格子", () => {
    const qty = { [cellKey("黑色", "S")]: 10, [cellKey("白色", "L")]: 5 };
    expect(sumMatrix(qty)).toBe(15);
  });

  it("linesToMatrix 反向转换(详情页回显)", () => {
    const qty = linesToMatrix([
      { 颜色: "黑色", 尺码: "S", 数量: 10 },
      { 颜色: "白色", 尺码: "L", 数量: 5 },
    ]);
    expect(qty[cellKey("黑色", "S")]).toBe(10);
    expect(qty[cellKey("白色", "L")]).toBe(5);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm --prefix web run test`
Expected: FAIL（matrix.ts 不存在）

- [ ] **Step 3: 实现矩阵纯函数**

Create `web/src/utils/matrix.ts`:

```typescript
// 色×码数量矩阵 ↔ 明细行 转换（订单/生产制单共用）
export interface QtyLine { 颜色: string; 尺码: string; 数量: number }
export type QtyMap = Record<string, number>;

export const cellKey = (颜色: string, 尺码: string) => `${颜色}|${尺码}`;

// 矩阵 → 明细行（只导出数量>0的格子，按 颜色 外层、尺码 内层 顺序）
export function matrixToLines(颜色s: string[], 尺码s: string[], qty: QtyMap): QtyLine[] {
  const lines: QtyLine[] = [];
  for (const c of 颜色s)
    for (const s of 尺码s) {
      const n = qty[cellKey(c, s)] ?? 0;
      if (n > 0) lines.push({ 颜色: c, 尺码: s, 数量: n });
    }
  return lines;
}

// 明细行 → 矩阵（详情回显）
export function linesToMatrix(lines: { 颜色?: string | null; 尺码?: string | null; 数量?: number | null }[]): QtyMap {
  const qty: QtyMap = {};
  for (const l of lines)
    if (l.颜色 && l.尺码) qty[cellKey(l.颜色, l.尺码)] = Number(l.数量 ?? 0);
  return qty;
}

export const sumMatrix = (qty: QtyMap) => Object.values(qty).reduce((a, n) => a + n, 0);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm --prefix web run test`
Expected: PASS（含原有 master/permissions 测试）

- [ ] **Step 5: 款式 API 客户端**

Create `web/src/api/styles.ts`:

```typescript
import { api } from "./client";

export interface StyleColor { 颜色编号?: string | null; 颜色名称?: string | null }
export interface StyleProcess { id: number; 工序号?: string; 工序名称?: string; 单价?: number | null; 工序类型?: string; [k: string]: unknown }
export interface StyleBomLine { id: number; 物料编号?: string; 物料名称?: string; 单位?: string; 使用数量?: number | null; [k: string]: unknown }
export interface StyleFull {
  主档: Record<string, unknown>;
  颜色: StyleColor[];
  尺码: string[];
  工序: StyleProcess[];
  物料: StyleBomLine[];
}

const enc = encodeURIComponent;

export const stylesApi = {
  full: (款号: string) => api.get<StyleFull>(`/styles/${enc(款号)}/full`).then(r => r.data),
  saveColors: (款号: string, colors: StyleColor[]) => api.put(`/styles/${enc(款号)}/colors`, colors),
  saveSizes: (款号: string, sizes: string[]) => api.put(`/styles/${enc(款号)}/sizes`, sizes),
};
```

- [ ] **Step 6: 款号资料进 MASTER_CONFIGS（带详情跳转）**

修改 `web/src/pages/master/configs.ts`：

`MasterCfg` 接口加可选字段 `detailLink`：

```typescript
export interface MasterCfg {
  menu: string; resource: string; title: string; fields: FieldCfg[];
  // 行级"明细"跳转(如 款号 → /styles/:款号 详情页)
  detailLink?: (row: Record<string, unknown>) => string | null;
}
```

`MASTER_CONFIGS` 末尾追加：

```typescript
  款号资料: {
    menu: "款号资料", resource: "styles", title: "款号资料",
    fields: [
      { name: "款号", label: "款号" }, { name: "款式", label: "款式" },
      { name: "单价", label: "单价", price: true }, { name: "成本价", label: "成本价", price: true },
      { name: "批发价", label: "批发价", price: true }, { name: "零售价", label: "零售价", price: true },
    ],
    detailLink: (row) => (row.款号 ? `/styles/${encodeURIComponent(String(row.款号))}` : null),
  },
```

- [ ] **Step 7: MasterDataPage 支持 detailLink**

修改 `web/src/pages/master/MasterDataPage.tsx`：

顶部 import 加：

```typescript
import { useNavigate } from "react-router-dom";
```

组件内（`const perms = usePerms();` 之后）加：

```typescript
  const nav = useNavigate();
```

"操作"列的 `<Space>` 内、"编辑"链接之前，加"明细"链接：

```tsx
          {cfg.detailLink && cfg.detailLink(row) && (
            <a onClick={() => nav(cfg.detailLink!(row)!)}>明细</a>
          )}
```

- [ ] **Step 8: 款式详情页（四 Tab）**

Create `web/src/pages/styles/StyleDetailPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button, Card, Descriptions, Form, Input, InputNumber, Modal, Popconfirm,
  Space, Table, Tabs, Tag, message,
} from "antd";
import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
import { stylesApi, type StyleColor, type StyleFull } from "../../api/styles";
import { masterApi } from "../../api/master";
import { hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "款号资料";

// 颜色 Tab：整组编辑后一次保存
function ColorsTab({ 款号, colors, onSaved }: { 款号: string; colors: StyleColor[]; onSaved: () => void }) {
  const [rows, setRows] = useState<StyleColor[]>(colors);
  useEffect(() => setRows(colors), [colors]);
  const set = (i: number, k: keyof StyleColor, v: string) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async () => {
    await stylesApi.saveColors(款号, rows.filter(r => r.颜色名称));
    message.success("颜色已保存"); onSaved();
  };
  return (
    <div>
      <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={rows}
        columns={[
          { title: "颜色编号", render: (_, r, i) => <Input value={r.颜色编号 ?? ""} onChange={e => set(i, "颜色编号", e.target.value)} /> },
          { title: "颜色名称", render: (_, r, i) => <Input value={r.颜色名称 ?? ""} onChange={e => set(i, "颜色名称", e.target.value)} /> },
          { title: "", width: 60, render: (_, __, i) => <a onClick={() => setRows(rows.filter((_, j) => j !== i))}>删除</a> },
        ]} />
      <Space style={{ marginTop: 12 }}>
        <Button icon={<PlusOutlined />} onClick={() => setRows([...rows, {}])}>加一行</Button>
        <Button type="primary" onClick={save}>保存颜色</Button>
      </Space>
    </div>
  );
}

// 尺码 Tab：整组编辑后一次保存（顺序即穿着顺序）
function SizesTab({ 款号, sizes, onSaved }: { 款号: string; sizes: string[]; onSaved: () => void }) {
  const [text, setText] = useState(sizes.join(","));
  useEffect(() => setText(sizes.join(",")), [sizes]);
  const save = async () => {
    const arr = text.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
    await stylesApi.saveSizes(款号, arr);
    message.success("尺码已保存"); onSaved();
  };
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <div>
        {sizes.map(s => <Tag key={s} color="geekblue" style={{ borderRadius: 6 }}>{s}</Tag>)}
      </div>
      <Input placeholder="用逗号分隔，如 S,M,L,XL（顺序即穿着顺序）"
        value={text} onChange={e => setText(e.target.value)} style={{ maxWidth: 420 }} />
      <Button type="primary" onClick={save}>保存尺码</Button>
    </Space>
  );
}

// 工序/BOM Tab：走泛型主数据 CRUD（resource: style-processes / style-bom-lines），按款号过滤
function LinesTab({ 款号, resource, fields, hidePriceCols, onSaved }: {
  款号: string; resource: string;
  fields: { name: string; label: string; price?: boolean; number?: boolean }[];
  hidePriceCols: boolean; onSaved: () => void;
}) {
  const apiRes = masterApi(resource);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form] = Form.useForm();
  const visible = fields.filter(f => !(f.price && hidePriceCols));

  const load = useCallback(async () => {
    // 泛型接口的 keyword 对所有字符串列模糊匹配,用款号过滤足够(款号是行里最长的唯一串)
    const r = await apiRes.list(1, 200, 款号);
    setRows((r.items as Record<string, unknown>[]).filter(x => x.款号 === 款号));
  }, [款号, resource]);
  useEffect(() => { load(); }, [load]);

  const onSave = async () => {
    const v = await form.validateFields();
    const body = { ...v, 款号 };
    if (editing && editing.id) await apiRes.update(editing.id as number, body);
    else await apiRes.create(body);
    message.success("已保存"); setEditing(null); form.resetFields(); load(); onSaved();
  };

  return (
    <div>
      <Table size="small" rowKey="id" pagination={false} dataSource={rows}
        columns={[
          ...visible.map(f => ({ title: f.label, dataIndex: f.name, key: f.name })),
          {
            title: "操作", key: "_op", width: 120,
            render: (_: unknown, row: Record<string, unknown>) => (
              <Space>
                <a onClick={() => { setEditing(row); form.setFieldsValue(row); }}>编辑</a>
                <Popconfirm title="确认删除?" onConfirm={async () => { await apiRes.remove(row.id as number); load(); onSaved(); }}>
                  <a>删除</a>
                </Popconfirm>
              </Space>
            ),
          },
        ]} />
      <Button icon={<PlusOutlined />} style={{ marginTop: 12 }}
        onClick={() => { setEditing({ id: 0 }); form.resetFields(); }}>新增</Button>
      <Modal open={!!editing} title={editing?.id ? "编辑" : "新增"} destroyOnHidden
        onOk={onSave} onCancel={() => { setEditing(null); form.resetFields(); }}>
        <Form form={form} layout="vertical">
          {visible.map(f => (
            <Form.Item key={f.name} name={f.name} label={f.label}>
              {f.number ? <InputNumber style={{ width: "100%" }} /> : <Input />}
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </div>
  );
}

export default function StyleDetailPage() {
  const { styleNo } = useParams();
  const 款号 = styleNo ? decodeURIComponent(styleNo) : "";
  const perms = usePerms();
  const nav = useNavigate();
  const [full, setFull] = useState<StyleFull | null>(null);
  const priceHidden = hidePrice(perms, MENU);

  const load = useCallback(async () => {
    if (款号) setFull(await stylesApi.full(款号));
  }, [款号]);
  useEffect(() => { load(); }, [load]);

  if (!full) return <Card variant="borderless" loading title={`款式 ${款号}`} />;

  return (
    <Card
      variant="borderless"
      title={
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => nav(-1)} />
          <span>款式 {款号}</span>
          <Tag color="blue" style={{ borderRadius: 6 }}>{String(full.主档.款式 ?? "")}</Tag>
        </Space>
      }
    >
      {!priceHidden && (
        <Descriptions size="small" column={4} style={{ marginBottom: 16 }}
          items={[
            { key: "1", label: "单价", children: String(full.主档.单价 ?? "-") },
            { key: "2", label: "成本价", children: String(full.主档.成本价 ?? "-") },
            { key: "3", label: "批发价", children: String(full.主档.批发价 ?? "-") },
            { key: "4", label: "零售价", children: String(full.主档.零售价 ?? "-") },
          ]} />
      )}
      <Tabs
        items={[
          { key: "colors", label: `颜色 (${full.颜色.length})`,
            children: <ColorsTab 款号={款号} colors={full.颜色} onSaved={load} /> },
          { key: "sizes", label: `尺码 (${full.尺码.length})`,
            children: <SizesTab 款号={款号} sizes={full.尺码} onSaved={load} /> },
          { key: "processes", label: `工序工价 (${full.工序.length})`,
            children: <LinesTab 款号={款号} resource="style-processes" hidePriceCols={priceHidden} onSaved={load}
              fields={[
                { name: "工序号", label: "工序号" }, { name: "工序名称", label: "工序名称" },
                { name: "单价", label: "工价", price: true, number: true }, { name: "工序类型", label: "工序类型" },
              ]} /> },
          { key: "bom", label: `物料BOM (${full.物料.length})`,
            children: <LinesTab 款号={款号} resource="style-bom-lines" hidePriceCols={priceHidden} onSaved={load}
              fields={[
                { name: "物料编号", label: "物料编号" }, { name: "物料名称", label: "物料名称" },
                { name: "规格", label: "规格" }, { name: "颜色", label: "颜色" },
                { name: "单位", label: "单位" }, { name: "使用数量", label: "单件用量", number: true },
              ]} /> },
        ]} />
    </Card>
  );
}
```

- [ ] **Step 9: App.tsx 加路由**

修改 `web/src/App.tsx`，import 并在 `<Route path="master/:menu" ...>` 之后加：

```tsx
import StyleDetailPage from "./pages/styles/StyleDetailPage";
// ...
          <Route path="styles/:styleNo" element={<StyleDetailPage />} />
```

- [ ] **Step 10: 构建 + 测试 + 提交**

Run: `npm --prefix web run test` → Expected: PASS
Run: `npm --prefix web run build` → Expected: 构建成功（tsc 0 错误）

```powershell
git add web/src/
git commit -m @'
feat(P2): 前端款号资料+款式详情页(颜色/尺码/工序/BOM)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 11: 前端 — 客户订单页（列表 + 色码矩阵新建 + 详情 + 审核）

**Files:**
- Create: `web/src/api/orders.ts`, `web/src/components/QtyMatrix.tsx`, `web/src/pages/orders/OrdersPage.tsx`, `web/src/pages/orders/OrderCreateDrawer.tsx`, `web/src/pages/orders/OrderDetailDrawer.tsx`
- Modify: `web/src/App.tsx`, `web/src/pages/MainLayout.tsx`

- [ ] **Step 1: 订单 API 客户端**

Create `web/src/api/orders.ts`:

```typescript
import { api } from "./client";
import type { Paged } from "./master";

export interface OrderLine { 色号?: string; 颜色?: string; 尺码?: string; 数量: number }
export interface OrderCreate {
  客户编号: string; 客户名称?: string; 交货日期?: string; 仓库?: string;
  款号: string; 款式?: string; 单价?: number; 合同号?: string; 客户款号?: string; 备注?: string;
  明细: OrderLine[];
}
export interface OrderHeader {
  id: number; 单号?: string; 日期?: string; 交货日期?: string;
  客户编号?: string; 客户名称?: string; 仓库?: string;
  数量?: number | null; 金额?: number | null; 操作员?: string; 审核?: string; 备注?: string;
}
export interface OrderDetail {
  订货单: OrderHeader | null;
  总表: { 款号?: string; 款式?: string; 生产单号?: string | null; 数量?: number; 单价?: number | null; 金额?: number | null } | null;
  明细: { id: number; 色号?: string; 颜色?: string; 尺码?: string; 数量?: number; 单价?: number | null; 金额?: number | null }[];
}

export const ordersApi = {
  list: (page = 1, size = 20, keyword = "") =>
    api.get<Paged<OrderHeader>>("/orders", { params: { page, size, keyword } }).then(r => r.data),
  get: (单号: string) => api.get<OrderDetail>(`/orders/${encodeURIComponent(单号)}`).then(r => r.data),
  create: (body: OrderCreate) => api.post<{ 单号: string }>("/orders", body).then(r => r.data),
  remove: (单号: string) => api.delete(`/orders/${encodeURIComponent(单号)}`),
  approve: (单号: string) => api.post(`/orders/${encodeURIComponent(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/orders/${encodeURIComponent(单号)}/unapprove`),
};
```

- [ ] **Step 2: 色×码矩阵录入组件（订单/制单共用）**

Create `web/src/components/QtyMatrix.tsx`:

```tsx
import { InputNumber, Table } from "antd";
import { cellKey, type QtyMap } from "../utils/matrix";

// 行=颜色 列=尺码 的数量矩阵；value 的 key 用 cellKey(颜色,尺码)
export default function QtyMatrix({ 颜色s, 尺码s, value, onChange }: {
  颜色s: string[]; 尺码s: string[]; value: QtyMap; onChange: (v: QtyMap) => void;
}) {
  const columns = [
    { title: "颜色 \\ 尺码", dataIndex: "颜色", key: "颜色", fixed: "left" as const, width: 120 },
    ...尺码s.map(s => ({
      title: s, key: s, width: 90,
      render: (_: unknown, row: { 颜色: string }) => (
        <InputNumber min={0} precision={0} style={{ width: 76 }}
          value={value[cellKey(row.颜色, s)] ?? 0}
          onChange={n => onChange({ ...value, [cellKey(row.颜色, s)]: Number(n ?? 0) })} />
      ),
    })),
    {
      title: "小计", key: "_sum", width: 80,
      render: (_: unknown, row: { 颜色: string }) =>
        尺码s.reduce((a, s) => a + (value[cellKey(row.颜色, s)] ?? 0), 0),
    },
  ];
  return (
    <Table size="small" rowKey="颜色" pagination={false} scroll={{ x: true }}
      dataSource={颜色s.map(c => ({ 颜色: c }))} columns={columns} />
  );
}
```

- [ ] **Step 3: 新建订单抽屉**

Create `web/src/pages/orders/OrderCreateDrawer.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Button, Col, DatePicker, Drawer, Form, Input, InputNumber, Row, Select, Space, Statistic, message } from "antd";
import { masterApi } from "../../api/master";
import { ordersApi } from "../../api/orders";
import { stylesApi } from "../../api/styles";
import { matrixToLines, sumMatrix, type QtyMap } from "../../utils/matrix";
import { hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import QtyMatrix from "../../components/QtyMatrix";

const MENU = "成品客户订货单";

export default function OrderCreateDrawer({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const perms = usePerms();
  const priceHidden = hidePrice(perms, MENU);
  const [form] = Form.useForm();
  const [customers, setCustomers] = useState<Record<string, unknown>[]>([]);
  const [styles, setStyles] = useState<Record<string, unknown>[]>([]);
  const [颜色s, set颜色s] = useState<string[]>([]);
  const [尺码s, set尺码s] = useState<string[]>([]);
  const [qty, setQty] = useState<QtyMap>({});

  useEffect(() => {
    if (!open) return;
    masterApi("customers").list(1, 200).then(r => setCustomers(r.items as Record<string, unknown>[]));
    masterApi("styles").list(1, 200).then(r => setStyles(r.items as Record<string, unknown>[]));
    form.resetFields(); set颜色s([]); set尺码s([]); setQty({});
  }, [open]);

  // 选款号 → 带出颜色/尺码集生成矩阵
  const onStyleChange = async (款号: string) => {
    const st = styles.find(s => s.款号 === 款号);
    form.setFieldsValue({ 款式: st?.款式 });
    const full = await stylesApi.full(款号);
    set颜色s(full.颜色.map(c => c.颜色名称 ?? "").filter(Boolean));
    set尺码s(full.尺码);
    setQty({});
    if (full.颜色.length === 0 || full.尺码.length === 0)
      message.warning("该款号还没维护颜色/尺码，请先到款式详情页维护。");
  };

  const submit = async () => {
    const v = await form.validateFields();
    const lines = matrixToLines(颜色s, 尺码s, qty);
    if (lines.length === 0) { message.error("请至少录入一格数量"); return; }
    const customer = customers.find(c => c.客户编号 === v.客户编号);
    await ordersApi.create({
      客户编号: v.客户编号, 客户名称: String(customer?.客户名称 ?? ""),
      款号: v.款号, 款式: v.款式, 单价: v.单价, 仓库: v.仓库, 备注: v.备注,
      合同号: v.合同号, 客户款号: v.客户款号,
      交货日期: v.交货日期 ? v.交货日期.format("YYYY-MM-DD") : undefined,
      明细: lines,
    });
    message.success("订单已创建");
    onClose(); onCreated();
  };

  const 数量合计 = sumMatrix(qty);

  return (
    <Drawer title="新建客户订单" width={860} open={open} onClose={onClose}
      extra={<Button type="primary" onClick={submit}>保存订单</Button>}>
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="客户编号" label="客户" rules={[{ required: true, message: "请选择客户" }]}>
              <Select showSearch optionFilterProp="label"
                options={customers.map(c => ({
                  value: String(c.客户编号), label: `${c.客户编号} ${c.客户名称 ?? ""}`,
                }))} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="款号" label="款号" rules={[{ required: true, message: "请选择款号" }]}>
              <Select showSearch optionFilterProp="label" onChange={onStyleChange}
                options={styles.map(s => ({
                  value: String(s.款号), label: `${s.款号} ${s.款式 ?? ""}`,
                }))} />
            </Form.Item>
          </Col>
          <Col span={8}><Form.Item name="款式" label="款式"><Input disabled /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          {!priceHidden && (
            <Col span={6}><Form.Item name="单价" label="单价"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
          )}
          <Col span={6}><Form.Item name="仓库" label="仓库"><Input placeholder="成品仓" /></Form.Item></Col>
          <Col span={6}><Form.Item name="交货日期" label="交货日期"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
          <Col span={6}><Form.Item name="合同号" label="合同号"><Input /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}><Form.Item name="客户款号" label="客户款号"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="备注" label="备注"><Input /></Form.Item></Col>
        </Row>
      </Form>

      {颜色s.length > 0 && 尺码s.length > 0 && (
        <>
          <QtyMatrix 颜色s={颜色s} 尺码s={尺码s} value={qty} onChange={setQty} />
          <Space style={{ marginTop: 16 }} size={32}>
            <Statistic title="数量合计" value={数量合计} />
          </Space>
        </>
      )}
    </Drawer>
  );
}
```

- [ ] **Step 4: 订单详情抽屉**

Create `web/src/pages/orders/OrderDetailDrawer.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Descriptions, Drawer, Table, Tag } from "antd";
import { ordersApi, type OrderDetail } from "../../api/orders";

export default function OrderDetailDrawer({ 单号, onClose }: { 单号: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);

  useEffect(() => {
    if (单号) ordersApi.get(单号).then(setDetail);
    else setDetail(null);
  }, [单号]);

  const h = detail?.订货单;
  const s = detail?.总表;

  return (
    <Drawer title={`订单 ${单号 ?? ""}`} width={760} open={!!单号} onClose={onClose}>
      {detail && (
        <>
          <Descriptions size="small" column={3} bordered style={{ marginBottom: 16 }}
            items={[
              { key: "1", label: "客户", children: `${h?.客户编号 ?? ""} ${h?.客户名称 ?? ""}` },
              { key: "2", label: "款号", children: `${s?.款号 ?? ""} ${s?.款式 ?? ""}` },
              { key: "3", label: "状态", children: h?.审核 === "1" ? <Tag color="green">已审核</Tag> : <Tag>未审核</Tag> },
              { key: "4", label: "数量", children: String(h?.数量 ?? "-") },
              { key: "5", label: "金额", children: h?.金额 == null ? "***" : String(h.金额) },
              { key: "6", label: "交货日期", children: h?.交货日期?.slice(0, 10) ?? "-" },
              { key: "7", label: "生产单号", children: s?.生产单号 ?? "未排产" },
              { key: "8", label: "仓库", children: h?.仓库 ?? "-" },
              { key: "9", label: "备注", children: h?.备注 ?? "-" },
            ]} />
          <Table size="small" rowKey="id" pagination={false} dataSource={detail.明细}
            columns={[
              { title: "色号", dataIndex: "色号" }, { title: "颜色", dataIndex: "颜色" },
              { title: "尺码", dataIndex: "尺码" }, { title: "数量", dataIndex: "数量" },
              { title: "单价", dataIndex: "单价", render: v => (v == null ? "***" : v) },
              { title: "金额", dataIndex: "金额", render: v => (v == null ? "***" : v) },
            ]} />
        </>
      )}
    </Drawer>
  );
}
```

- [ ] **Step 5: 订单列表页**

Create `web/src/pages/orders/OrdersPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Popconfirm, Space, Table, Tag, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { ordersApi, type OrderHeader } from "../../api/orders";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import OrderCreateDrawer from "./OrderCreateDrawer";
import OrderDetailDrawer from "./OrderDetailDrawer";

const MENU = "成品客户订货单";

export default function OrdersPage() {
  const perms = usePerms();
  const [rows, setRows] = useState<OrderHeader[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await ordersApi.list(page, 10, keyword);
    setRows(r.items); setTotal(r.total);
  }, [page, keyword]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); load(); }
    catch (e) {
      const msg = (e as { response?: { data?: { 消息?: string } } }).response?.data?.消息;
      message.error(msg ?? "操作失败");
    }
  };

  const columns = [
    { title: "单号", dataIndex: "单号", render: (v: string) => <a className="erp-num" onClick={() => setViewing(v)}>{v}</a> },
    { title: "日期", dataIndex: "日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "客户", dataIndex: "客户名称" },
    { title: "数量", dataIndex: "数量" },
    { title: "金额", dataIndex: "金额", render: (v?: number | null) => (v == null ? "***" : v) },
    { title: "交货日期", dataIndex: "交货日期", render: (v?: string) => v?.slice(0, 10) },
    {
      title: "状态", dataIndex: "审核",
      render: (v?: string) => v === "1"
        ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag>
        : <Tag style={{ borderRadius: 6 }}>未审核</Tag>,
    },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: OrderHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && (
            <a onClick={() => act(() => ordersApi.approve(row.单号!), "已审核")}>审核</a>
          )}
          {row.审核 === "1" && can(perms, MENU, "反审核") && (
            <a onClick={() => act(() => ordersApi.unapprove(row.单号!), "已反审核")}>反审核</a>
          )}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该订单?" onConfirm={() => act(() => ordersApi.remove(row.单号!), "已删除")}>
              <a>删除</a>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title="客户订单" variant="borderless"
      extra={
        <Space>
          <Input.Search placeholder="搜索单号/客户" allowClear
            onSearch={v => { setPage(1); setKeyword(v); }} style={{ width: 220 }} />
          {can(perms, MENU, "保存") && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建订单</Button>
          )}
        </Space>
      }>
      <Table rowKey="id" size="middle" dataSource={rows} columns={columns}
        pagination={{ current: page, pageSize: 10, total, onChange: setPage, showTotal: t => `共 ${t} 条` }} />
      <OrderCreateDrawer open={creating} onClose={() => setCreating(false)} onCreated={load} />
      <OrderDetailDrawer 单号={viewing} onClose={() => setViewing(null)} />
    </Card>
  );
}
```

- [ ] **Step 6: 路由 + 菜单**

修改 `web/src/App.tsx`，加 import 和路由：

```tsx
import OrdersPage from "./pages/orders/OrdersPage";
// ...
          <Route path="orders" element={<OrdersPage />} />
```

修改 `web/src/pages/MainLayout.tsx`：

import 增加图标：

```tsx
import {
  TeamOutlined, ShopOutlined, ToolOutlined, AppstoreOutlined,
  ApartmentOutlined, IdcardOutlined, TagsOutlined, ProfileOutlined,
  DatabaseOutlined, SkinOutlined, ShoppingCartOutlined, BuildOutlined, FileTextOutlined,
} from "@ant-design/icons";
```

`iconFor` 函数加款号判断（`if (menu.includes("款号")) return <SkinOutlined />;` 放在 `if (menu.includes("客户"))` 之前——注意"款号资料"不含"客户"所以顺序不敏感，但放前面最稳）。

菜单 items 改为两组（`const items = [...]` 整段替换）：

```tsx
  const bizChildren = [
    ...(can(perms, "成品客户订货单", "打开")
      ? [{ key: "/orders", label: "客户订单", icon: <ShoppingCartOutlined /> }] : []),
    ...(can(perms, "生产制单", "打开")
      ? [{ key: "/production", label: "生产制单", icon: <BuildOutlined /> }] : []),
  ];
  const items = [
    { key: "base", label: "基础资料", icon: <DatabaseOutlined />, children },
    ...(bizChildren.length
      ? [{ key: "biz", label: "业务单据", icon: <FileTextOutlined />, children: bizChildren }] : []),
  ];
```

`openKeys` 初始值改为 `["base", "biz"]`。

Header 的固定标题 `基础资料` 改为按路由显示：

```tsx
          <span style={{ fontSize: 15, fontWeight: 700, color: theme.headerColor }}>
            {loc.pathname.startsWith("/orders") ? "客户订单"
              : loc.pathname.startsWith("/production") ? "生产制单"
              : loc.pathname.startsWith("/styles") ? "款式详情"
              : "基础资料"}
          </span>
```

- [ ] **Step 7: 构建 + 测试 + 提交**

Run: `npm --prefix web run test` → Expected: PASS
Run: `npm --prefix web run build` → Expected: 构建成功

```powershell
git add web/src/
git commit -m @'
feat(P2): 前端客户订单页(色码矩阵下单+审核+成本保密)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 12: 前端 — 生产制单页（列表 + 新建[可从订单生成] + 详情 Tabs + 审核）

**Files:**
- Create: `web/src/api/production.ts`, `web/src/pages/production/ProductionPage.tsx`, `web/src/pages/production/ProductionCreateDrawer.tsx`, `web/src/pages/production/ProductionDetailDrawer.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: 生产制单 API 客户端**

Create `web/src/api/production.ts`:

```typescript
import { api } from "./client";
import type { Paged } from "./master";

export interface ProductionQty { 颜色?: string; 尺码?: string; 数量: number }
export interface ProductionCreate {
  款号: string; 款式?: string; 订单单号?: string; 合同号?: string; 客户款号?: string;
  客户编号?: string; 客户名称?: string; 加工厂编号?: string; 加工厂名称?: string;
  交货日期?: string; 跟单员?: string; 出货单价?: number; 备注?: string;
  数量明细: ProductionQty[];
}
export interface ProductionHeader {
  id: number; 生产单号?: string; 款号?: string; 款式?: string; 合同号?: string;
  客户编号?: string; 客户名称?: string; 加工厂编号?: string; 加工厂名称?: string;
  日期?: string; 交货日期?: string; 制单人?: string;
  计划数量?: number | null; 工序数?: number | null; 工序单价?: number | null;
  物料金额?: number | null; 出货单价?: number | null; 审核?: string; 完成?: string;
}
export interface ProductionDetail {
  单头: ProductionHeader | null;
  数量: { id: number; 颜色?: string; 尺码?: string; 数量?: number }[];
  工序: { id: number; 工序号?: string; 工序名称?: string; 单价?: number | null; 工序类型?: string }[];
  物料: {
    id: number; 物料编号?: string; 物料名称?: string; 规格?: string; 单位?: string;
    总数量?: number; 库存数量?: number; 需订数量?: number;
    预算单价?: number | null; 金额?: number | null; 供应商名称?: string;
  }[];
}

const enc = encodeURIComponent;

export const productionApi = {
  list: (page = 1, size = 20, keyword = "") =>
    api.get<Paged<ProductionHeader>>("/production", { params: { page, size, keyword } }).then(r => r.data),
  get: (生产单号: string) => api.get<ProductionDetail>(`/production/${enc(生产单号)}`).then(r => r.data),
  create: (body: ProductionCreate) => api.post<{ 生产单号: string }>("/production", body).then(r => r.data),
  remove: (生产单号: string) => api.delete(`/production/${enc(生产单号)}`),
  approve: (生产单号: string) => api.post(`/production/${enc(生产单号)}/approve`),
  unapprove: (生产单号: string) => api.post(`/production/${enc(生产单号)}/unapprove`),
};
```

- [ ] **Step 2: 新建生产制单抽屉（支持从订单生成）**

Create `web/src/pages/production/ProductionCreateDrawer.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Button, Col, DatePicker, Drawer, Form, Input, InputNumber, Row, Select, Space, Statistic, message } from "antd";
import { masterApi } from "../../api/master";
import { ordersApi } from "../../api/orders";
import { productionApi } from "../../api/production";
import { stylesApi } from "../../api/styles";
import { linesToMatrix, matrixToLines, sumMatrix, type QtyMap } from "../../utils/matrix";
import { hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import QtyMatrix from "../../components/QtyMatrix";

const MENU = "生产制单";

export default function ProductionCreateDrawer({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const perms = usePerms();
  const priceHidden = hidePrice(perms, MENU);
  const [form] = Form.useForm();
  const [orders, setOrders] = useState<{ 单号?: string; 客户编号?: string; 客户名称?: string }[]>([]);
  const [styles, setStyles] = useState<Record<string, unknown>[]>([]);
  const [factories, setFactories] = useState<Record<string, unknown>[]>([]);
  const [颜色s, set颜色s] = useState<string[]>([]);
  const [尺码s, set尺码s] = useState<string[]>([]);
  const [qty, setQty] = useState<QtyMap>({});

  useEffect(() => {
    if (!open) return;
    ordersApi.list(1, 200).then(r => setOrders(r.items));
    masterApi("styles").list(1, 200).then(r => setStyles(r.items as Record<string, unknown>[]));
    masterApi("factories").list(1, 200).then(r => setFactories(r.items as Record<string, unknown>[]));
    form.resetFields(); set颜色s([]); set尺码s([]); setQty({});
  }, [open]);

  // 选款号 → 带出颜色/尺码矩阵
  const loadStyleMatrix = async (款号: string) => {
    const full = await stylesApi.full(款号);
    set颜色s(full.颜色.map(c => c.颜色名称 ?? "").filter(Boolean));
    set尺码s(full.尺码);
    if (full.颜色.length === 0 || full.尺码.length === 0)
      message.warning("该款号还没维护颜色/尺码，请先到款式详情页维护。");
    return full;
  };

  const onStyleChange = async (款号: string) => {
    const st = styles.find(s => s.款号 === 款号);
    form.setFieldsValue({ 款式: st?.款式 });
    await loadStyleMatrix(款号);
    setQty({});
  };

  // 从订单生成：带出客户/款号/数量矩阵
  const onOrderChange = async (订单单号: string) => {
    if (!订单单号) return;
    const detail = await ordersApi.get(订单单号);
    const 款号 = detail.总表?.款号 ?? "";
    form.setFieldsValue({
      款号, 款式: detail.总表?.款式,
      客户编号: detail.订货单?.客户编号, 客户名称: detail.订货单?.客户名称,
    });
    await loadStyleMatrix(款号);
    setQty(linesToMatrix(detail.明细));   // 订单的色码数量直接回填矩阵
  };

  const submit = async () => {
    const v = await form.validateFields();
    const lines = matrixToLines(颜色s, 尺码s, qty);
    if (lines.length === 0) { message.error("请至少录入一格数量"); return; }
    const factory = factories.find(f => f.加工厂编号 === v.加工厂编号);
    await productionApi.create({
      款号: v.款号, 款式: v.款式, 订单单号: v.订单单号 || undefined,
      客户编号: v.客户编号 || undefined, 客户名称: v.客户名称 || undefined,
      加工厂编号: v.加工厂编号 || undefined, 加工厂名称: String(factory?.加工厂名称 ?? "") || undefined,
      合同号: v.合同号, 跟单员: v.跟单员, 出货单价: v.出货单价, 备注: v.备注,
      交货日期: v.交货日期 ? v.交货日期.format("YYYY-MM-DD") : undefined,
      数量明细: lines,
    });
    message.success("生产制单已创建（工序/物料已自动展开）");
    onClose(); onCreated();
  };

  return (
    <Drawer title="新建生产制单" width={900} open={open} onClose={onClose}
      extra={<Button type="primary" onClick={submit}>保存制单</Button>}>
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="订单单号" label="从订单生成（可选）">
              <Select allowClear showSearch optionFilterProp="label" onChange={onOrderChange}
                options={orders.map(o => ({
                  value: String(o.单号), label: `${o.单号} ${o.客户名称 ?? ""}`,
                }))} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="款号" label="款号" rules={[{ required: true, message: "请选择款号" }]}>
              <Select showSearch optionFilterProp="label" onChange={onStyleChange}
                options={styles.map(s => ({
                  value: String(s.款号), label: `${s.款号} ${s.款式 ?? ""}`,
                }))} />
            </Form.Item>
          </Col>
          <Col span={8}><Form.Item name="款式" label="款式"><Input disabled /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={8}><Form.Item name="客户编号" label="客户编号"><Input /></Form.Item></Col>
          <Col span={8}><Form.Item name="客户名称" label="客户名称"><Input /></Form.Item></Col>
          <Col span={8}>
            <Form.Item name="加工厂编号" label="加工厂">
              <Select allowClear showSearch optionFilterProp="label"
                options={factories.map(f => ({
                  value: String(f.加工厂编号), label: `${f.加工厂编号} ${f.加工厂名称 ?? ""}`,
                }))} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={6}><Form.Item name="合同号" label="合同号"><Input /></Form.Item></Col>
          <Col span={6}><Form.Item name="跟单员" label="跟单员"><Input /></Form.Item></Col>
          {!priceHidden && (
            <Col span={6}><Form.Item name="出货单价" label="出货单价"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
          )}
          <Col span={6}><Form.Item name="交货日期" label="交货日期"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
        </Row>
        <Form.Item name="备注" label="备注"><Input /></Form.Item>
      </Form>

      {颜色s.length > 0 && 尺码s.length > 0 && (
        <>
          <QtyMatrix 颜色s={颜色s} 尺码s={尺码s} value={qty} onChange={setQty} />
          <Space style={{ marginTop: 16 }} size={32}>
            <Statistic title="计划数量" value={sumMatrix(qty)} />
          </Space>
        </>
      )}
    </Drawer>
  );
}
```

- [ ] **Step 3: 生产制单详情抽屉（数量/工序/BOM Tabs）**

Create `web/src/pages/production/ProductionDetailDrawer.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Descriptions, Drawer, Table, Tabs, Tag } from "antd";
import { productionApi, type ProductionDetail } from "../../api/production";

const money = (v?: number | null) => (v == null ? "***" : v);

export default function ProductionDetailDrawer({ 生产单号, onClose }: {
  生产单号: string | null; onClose: () => void;
}) {
  const [detail, setDetail] = useState<ProductionDetail | null>(null);

  useEffect(() => {
    if (生产单号) productionApi.get(生产单号).then(setDetail);
    else setDetail(null);
  }, [生产单号]);

  const h = detail?.单头;

  return (
    <Drawer title={`生产制单 ${生产单号 ?? ""}`} width={860} open={!!生产单号} onClose={onClose}>
      {detail && (
        <>
          <Descriptions size="small" column={3} bordered style={{ marginBottom: 16 }}
            items={[
              { key: "1", label: "款号", children: `${h?.款号 ?? ""} ${h?.款式 ?? ""}` },
              { key: "2", label: "客户", children: h?.客户名称 ?? "-" },
              { key: "3", label: "状态", children: h?.审核 === "1" ? <Tag color="green">已审核</Tag> : <Tag>未审核</Tag> },
              { key: "4", label: "加工厂", children: h?.加工厂名称 ?? "-" },
              { key: "5", label: "计划数量", children: String(h?.计划数量 ?? "-") },
              { key: "6", label: "交货日期", children: h?.交货日期?.slice(0, 10) ?? "-" },
              { key: "7", label: "工序数", children: String(h?.工序数 ?? "-") },
              { key: "8", label: "单件工费", children: money(h?.工序单价) },
              { key: "9", label: "物料金额", children: money(h?.物料金额) },
            ]} />
          <Tabs
            items={[
              {
                key: "qty", label: `数量明细 (${detail.数量.length})`,
                children: (
                  <Table size="small" rowKey="id" pagination={false} dataSource={detail.数量}
                    columns={[
                      { title: "颜色", dataIndex: "颜色" }, { title: "尺码", dataIndex: "尺码" },
                      { title: "数量", dataIndex: "数量" },
                    ]} />
                ),
              },
              {
                key: "proc", label: `工序工费 (${detail.工序.length})`,
                children: (
                  <Table size="small" rowKey="id" pagination={false} dataSource={detail.工序}
                    columns={[
                      { title: "工序号", dataIndex: "工序号" }, { title: "工序名称", dataIndex: "工序名称" },
                      { title: "工价", dataIndex: "单价", render: money },
                      { title: "工序类型", dataIndex: "工序类型", render: (v?: string) => v && <Tag style={{ borderRadius: 6 }}>{v}</Tag> },
                    ]} />
                ),
              },
              {
                key: "bom", label: `物料需求 BOM (${detail.物料.length})`,
                children: (
                  <Table size="small" rowKey="id" pagination={false} dataSource={detail.物料} scroll={{ x: true }}
                    columns={[
                      { title: "物料编号", dataIndex: "物料编号" }, { title: "物料名称", dataIndex: "物料名称" },
                      { title: "单位", dataIndex: "单位" },
                      { title: "需求数量", dataIndex: "总数量" },
                      { title: "库存", dataIndex: "库存数量" },
                      {
                        title: "需订(缺料)", dataIndex: "需订数量",
                        render: (v?: number) => (v && v > 0 ? <span style={{ color: "#cf1322", fontWeight: 600 }}>{v}</span> : v),
                      },
                      { title: "预算单价", dataIndex: "预算单价", render: money },
                      { title: "金额", dataIndex: "金额", render: money },
                      { title: "供应商", dataIndex: "供应商名称" },
                    ]} />
                ),
              },
            ]} />
        </>
      )}
    </Drawer>
  );
}
```

- [ ] **Step 4: 生产制单列表页**

Create `web/src/pages/production/ProductionPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Popconfirm, Space, Table, Tag, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { productionApi, type ProductionHeader } from "../../api/production";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import ProductionCreateDrawer from "./ProductionCreateDrawer";
import ProductionDetailDrawer from "./ProductionDetailDrawer";

const MENU = "生产制单";

export default function ProductionPage() {
  const perms = usePerms();
  const [rows, setRows] = useState<ProductionHeader[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await productionApi.list(page, 10, keyword);
    setRows(r.items); setTotal(r.total);
  }, [page, keyword]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); load(); }
    catch (e) {
      const msg = (e as { response?: { data?: { 消息?: string } } }).response?.data?.消息;
      message.error(msg ?? "操作失败");
    }
  };

  const columns = [
    { title: "生产单号", dataIndex: "生产单号", render: (v: string) => <a className="erp-num" onClick={() => setViewing(v)}>{v}</a> },
    { title: "款号", dataIndex: "款号", render: (v?: string) => v && <span className="erp-num">{v}</span> },
    { title: "款式", dataIndex: "款式" },
    { title: "客户", dataIndex: "客户名称" },
    { title: "加工厂", dataIndex: "加工厂名称" },
    { title: "计划数量", dataIndex: "计划数量" },
    { title: "物料金额", dataIndex: "物料金额", render: (v?: number | null) => (v == null ? "***" : v) },
    { title: "交货日期", dataIndex: "交货日期", render: (v?: string) => v?.slice(0, 10) },
    {
      title: "状态", dataIndex: "审核",
      render: (v?: string) => v === "1"
        ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag>
        : <Tag style={{ borderRadius: 6 }}>未审核</Tag>,
    },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: ProductionHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && (
            <a onClick={() => act(() => productionApi.approve(row.生产单号!), "已审核")}>审核</a>
          )}
          {row.审核 === "1" && can(perms, MENU, "反审核") && (
            <a onClick={() => act(() => productionApi.unapprove(row.生产单号!), "已反审核")}>反审核</a>
          )}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该制单?" onConfirm={() => act(() => productionApi.remove(row.生产单号!), "已删除")}>
              <a>删除</a>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title="生产制单" variant="borderless"
      extra={
        <Space>
          <Input.Search placeholder="搜索单号/款号/客户" allowClear
            onSearch={v => { setPage(1); setKeyword(v); }} style={{ width: 240 }} />
          {can(perms, MENU, "保存") && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建制单</Button>
          )}
        </Space>
      }>
      <Table rowKey="id" size="middle" dataSource={rows} columns={columns} scroll={{ x: true }}
        pagination={{ current: page, pageSize: 10, total, onChange: setPage, showTotal: t => `共 ${t} 条` }} />
      <ProductionCreateDrawer open={creating} onClose={() => setCreating(false)} onCreated={load} />
      <ProductionDetailDrawer 生产单号={viewing} onClose={() => setViewing(null)} />
    </Card>
  );
}
```

- [ ] **Step 5: App.tsx 加路由**

修改 `web/src/App.tsx`，加 import 和路由：

```tsx
import ProductionPage from "./pages/production/ProductionPage";
// ...
          <Route path="production" element={<ProductionPage />} />
```

- [ ] **Step 6: 构建 + 测试 + 提交**

Run: `npm --prefix web run test` → Expected: PASS
Run: `npm --prefix web run build` → Expected: 构建成功

```powershell
git add web/src/
git commit -m @'
feat(P2): 前端生产制单页(从订单生成+工序/BOM展开展示+审核)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 13: 端到端验证（前后端联调 + 截图留档）

**Files:**
- 无新代码；操作性任务，验证主线闭环

- [ ] **Step 1: 全量回归**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
$env:ERP_JWT_KEY = [Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")
dotnet test
npm --prefix web run test
npm --prefix web run build
```

Expected: 后端全 PASS（0 跳过）、前端全 PASS、构建成功

- [ ] **Step 2: 启动前后端**

```powershell
# 后端（后台运行）
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
dotnet run --project src/ErpApi --urls http://localhost:5000
# 前端（另一个后台 shell）
npm --prefix web run dev -- --host --port 5173
```

- [ ] **Step 3: 走一遍主线业务（API 或浏览器）**

用 admin/admin123 登录后依次：
1. 基础资料 → 款号资料 → 新增款号（如 K001 连衣裙，单价 100）
2. 款号行点"明细" → 款式详情页：维护 2 个颜色、3 个尺码、2 道工序（裁床 1.5 / 车缝 2.5）、2 行物料 BOM（需要物料资料里已有 M001/M002）
3. 业务单据 → 客户订单 → 新建订单：选客户 C001、款号 K001 → 矩阵录数量 → 保存 → 列表出现未审核单 → 点"审核"
4. 业务单据 → 生产制单 → 新建制单：选"从订单生成"刚才的订单 → 矩阵自动回填 → 保存
5. 打开制单详情：确认 工序 Tab 有 2 道工序、物料BOM Tab 有 2 行且"需订数量"= 用量×计划数量（缺料红色显示）
6. 制单"审核" → 状态变已审核
7. 用一个无"单价"权限的账号（可临时去掉 admin 某菜单的单价位验证）确认价格列显示 `***`

- [ ] **Step 4: 截图留档**

用 `tmp/shot` 里的 puppeteer-core 截图脚本（驱动本机 Chrome 无头）截取：订单列表页、新建订单矩阵、生产制单详情 BOM Tab 三张图，存 `tmp/p2-*.png`（已 gitignore，不提交，仅供人工查验）。

- [ ] **Step 5: 确认工作树干净后汇报**

```powershell
git status
git log --oneline master..HEAD
```

Expected: 工作树干净；P2 分支领先 master 约 11 个提交。
汇报后由 superpowers:finishing-a-development-branch 决定合并方式。

---

## Self-Review 结论

**Spec 覆盖检查**（对照蓝图 P2 行：接单→款式BOM→生产制单；BOM展开(算4)、工费展开(算3)）：
- ✅ M2 接单：Task 4/5（三层单据 + 审核过账 + 成本保密）、Task 11（前端下单矩阵）
- ✅ M3 款式&BOM：Task 2/3（主档/工序/BOM/颜色/尺码）、Task 10（前端款式详情页）
- ✅ M4 生产制单：Task 6/7/8（单头/数量/工序展开/BOM展开/缺料/订单回写）、Task 12（前端）
- ✅ 算法3 工费展开：Task 6（复制工序 + 工序数/工序单价汇总；计划工费=计划数量×Σ工价 由测试断言口径）
- ✅ 算法4 BOM展开：Task 7（需求=用量×计划数量、缺料=需求−库存、预算金额、缺料扣库存测试）
- ✅ 横切引擎复用：单号生成（Task 4/6）、审核过账（Task 1 扩展 + Task 5/8）、权限+审计（所有控制器）
- ✅ 成本保密：款号价格 [PriceField]（Task 2）、订单金额（Task 5）、制单工费/物料金额（Task 8）、前端隐藏（Task 10-12）
- ⏭ 明确延后（按"最小可用主线"裁剪）：款号图片/工艺、头办单、委托发外、生产制单尺码宽表（用规范化的 生产制单数量 代替）、在途采购扣减（P3）

**已知简化与理由**：
1. 一单一款：`成品客户订单总表.单号` 是 UNIQUE（schema 约束），与原系统一致。
2. BOM 的 `预算单价` 直接取 `物料资料.单价`，不走报价类别取价（算法8 需要报价类别上下文，单据上没有；P3 采购时再接）。
3. 物料库存在 P3 之前自然为 0，但算法4 的扣减逻辑已完整实现并被测试覆盖（Task 7 Step 1 第二个测试模拟了已审核采购入仓）。
4. 订单审核只翻订货单（财务头）的审核位；总表/明细表的审核位在 P2 无下游读取方，不联动。

**类型一致性检查**：
- `PagedResult<T>(Items, Total)` 跨 Task 4/8 复用 ✅
- `PostableDocuments.DocNoColumn` 在 Task 1 定义、Task 5/8 间接使用（经 PostingEngine）✅
- `P2TestData.Seed/Cleanup` 在 Task 4 定义，Task 5/6/7/8 测试复用 ✅
- 前端 `cellKey/matrixToLines/linesToMatrix/sumMatrix` 在 Task 10 定义，Task 11/12 复用 ✅
- `OrderService`/`OrderCreateDto`/`OrderLineDto` 在 Task 7 的测试中跨模块引用（`using ErpApi.Features.Orders;`）✅

---

## 执行交接

计划已保存到 `docs/superpowers/plans/2026-06-03-p2-order-style-production.md`。两种执行方式：

**1. Subagent-Driven（推荐）** — 每个任务派一个全新子代理实现，任务间做规格审查+质量审查，迭代快
（REQUIRED SUB-SKILL: superpowers:subagent-driven-development）

**2. Inline Execution** — 在当前会话用 superpowers:executing-plans 按批次执行、设检查点

选哪种？



