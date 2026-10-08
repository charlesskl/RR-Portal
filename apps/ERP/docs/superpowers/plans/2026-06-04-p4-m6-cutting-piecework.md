# P4 M6 厂内生产（裁床 → 工票 → 计件源头）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通服装厂厂内核心生产环节——裁床单（把已下生产制单按床/扎/色码裁剪）→ 计件录入（按工序×工人×数量记录车缝完成量，单价取自生产制单工序工价，这是 P7 工资归集的源头）→ 计件汇总（按工人/工序统计数量与计件工资，算法2 的前身）。

**Architecture:** 裁床单是两层单据（裁床总表单头 + 裁床明细表，按"裁床单号"约定串联，无主从 FK），复用 P2/P3 的 Dapper 事务服务模式，审核走引擎②（需扩展 PostableDocuments 加"裁床总表"→单号列"裁床单号"，并用 04 脚本扩宽该列+补审核留痕列）。计件表是**扁平记录表**（无单号头，每条=工序×工人×一次完成量），不走单据三层模式：批量录入/按生产单查询/批量审核/删除单条；单价取自 P2 的生产制单工序表。计件汇总用 Dapper GROUP BY（LEFT JOIN 人事档案取姓名）。成本保密：计件单价/金额、汇总金额按"单价"权限后端剥离。前端新增"生产车间"菜单组（裁床单/计件录入/计件汇总）。

**Tech Stack:** .NET 8 ASP.NET Core, Dapper（单据事务/计件/汇总）, EF Core（无新增实体）, SQL Server LocalDB (erp/erp_test, Chinese_PRC_CI_AS), xUnit + WebApplicationFactory + Xunit.SkippableFact, React 18 + TS + Vite + Ant Design v6 + Vitest.

---

## 前置约定（所有任务通用）

- 工作目录 `D:\WebpageERP`，分支策略由执行技能决定（P0–P3 都建特性分支→合并 master）。Windows 用 PowerShell；`dotnet` 不在 PATH 时刷新：`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 集成测试需环境变量（shell 为空时）：`$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")`、`$env:ERP_JWT_KEY = [Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")`。开发库 `$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")`。
- 跑后端测试：仓库根 `dotnet test`；单类 `dotnet test --filter "FullyQualifiedName~CuttingServiceDbTests"`。前端：`npm --prefix web run test`、`npm --prefix web run build`。
- **本机有系统代理 127.0.0.1:7892**：PowerShell `Invoke-RestMethod` 打本地 API 会被劫持失败；冒烟用 `HttpClientHandler{UseProxy=false}` 的 .NET HttpClient 或 Node 脚本。浏览器自动化（puppeteer-core 在 `tmp/shot`）不受影响。
- 提交规范：commit 末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。git 报 LF→CRLF 警告正常。
- **已有可复用件（P0–P3 交付，直接 DI 注入）**：
  - `ISqlConnectionFactory.Create()` → `SqlConnection`
  - `IDocumentNumberGenerator.NextAsync(docType, prefix, bizDate, conn, tx)` → `"前缀+yyyyMMdd+3位流水"`（如 `CB20260604001`，共 13 字符）
  - `IPostingEngine.ApproveAsync(table, docNo, user)` / `UnapproveAsync(...)`（本计划 Task 1 把"裁床总表"加入白名单）
  - `IPermissionService.HasAsync(user, menu, PermissionAction)`，`PermissionAction` = 打开/保存/删除/打印/单价/金额/审核/反审核/功能
  - `IAuditLogger.WriteAsync(表名, 行为, 操作员, 记录, SqlConnection, SqlTransaction?)`
  - `PagedResult<T>(IReadOnlyList<T> Items, int Total)`（namespace `ErpApi.Features.MasterData`）
  - 测试：`DbFixture`（`[Collection("db")]`、`fx.Open()`、`fx.ConnectionString`、`fx.Available`）、`JwtTokenService.Issue(user)`
  - 前端：`api`(axios)、`masterApi(resource)`（含 `employees` 人事档案）、`Paged<T>`、`can`/`hidePrice`、`usePerms()`
  - **参考实现（照搬模式）**：`src/ErpApi/Features/Orders/OrderService.cs`+`OrderController.cs`（两层单据 Dapper 事务+REST+审核+成本保密范本）；`src/ErpApi/Engines/Posting/PostableDocuments.cs`+`PostingEngine.cs`（P2 已把白名单改为 表名→单号列 字典，生产制单用"生产单号"——裁床同理用"裁床单号"）；`db/04` 风格参考 `db/03_p0_additions.sql`（幂等 ALTER）；前端 `web/src/pages/orders/`、`web/src/pages/materials/`（列表+抽屉+明细行表+配置驱动）。
- **JSON 大小写**：C# `ID` → JSON `"id"`（camelCase）；中文属性名不受影响；`PagedResult` → `items`/`total`。前端 rowKey 用 `id`。

### M6 涉及表的真实结构（以 `db/01_rebuild_schema.sql` 为准）

- `裁床总表`(单头)：ID(bigint identity), **裁床单号 nvarchar(10)**（太短，Task 1 扩到 20）, 生产单号, 客户编号, 客户名称, 加工厂编号, 加工厂名称, 款号, 款式, 客户款号, 合同号, 日期, 床号, 开始扎号(real), 结束扎号(real), 裁床数量 decimal, 布种, 操作员, 审核 nvarchar(5), 备注。**无 审核人/审核日期 列（Task 1 补）**。FK：款号→款号总表、生产单号→生产制单。
- `裁床明细表`(明细)：ID, **裁床单号 nvarchar(10)**（Task 1 扩到 20）, 生产单号, 客户编号, 客户名称, 加工厂编号, 加工厂名称, 款号, 款式, 客户款号, 合同号, 日期, 床号, 行数(real), 列数(real), 扎号(real), 缸号, 颜色, 尺码, 数量 decimal, 计件数量 decimal, 备注, 有效。FK：款号→款号总表、生产单号→生产制单。**无 裁床单号→裁床总表 主从 FK**（靠"裁床单号"约定串联）。注：schema 有一条 `CREATE INDEX IX_114_单号 ON [裁床明细表]([单号])` 引用了不存在的"单号"列，是既有瑕疵（建库 lenient 已跳过），与本计划无关。
- `计件表`(扁平记录，无单号头)：ID, 条码号 nvarchar(20), 生产单号 nvarchar(30), 裁床单号 nvarchar(15)（Task 1 扩到 20）, 床号, 裁床日期, 颜色, 尺码, 扎号(real), 工序号, 数量 decimal, 单价 decimal, 金额 decimal, 操作员, 员工号, 日期, 原数量, 扫描手工, 计件类型, 计件单位(real), 审核 nvarchar(6), 张数(real), 有效。FK：生产单号→生产制单。无 审核人/审核日期 列（计件按记录批量审核，不走引擎②留痕）。
- `生产制单工序表`(P2 已建，计件单价来源)：生产单号, 款号, 工序号, 工序名称, 单价 decimal, 工序类型, 审核。
- `人事档案`(P1 已建，计件工人来源)：编号 nvarchar(10), 姓名, 工序类型, 部门编号, 基本工资…
- `生产制单`(P2 已建)：生产单号(UNIQUE), 款号, 款式, 客户编号, 客户名称, 加工厂编号, 加工厂名称, 计划数量…

**关键设计约束**：
1. 裁床单号前缀 `CB`（裁床）；裁床总表↔明细按"裁床单号"串联，插入顺序 总表→明细、删除顺序 明细→总表（无 FK 但保持逻辑顺序）。
2. 计件表是扁平记录：计件录入=批量 INSERT 多条计件记录（每条 工序×工人×数量），无单号头；审核=按生产单批量 UPDATE 审核位（不写审核人/审核日期，计件表无此列）；删除=按 ID 删单条。
3. 计件单价 = 该生产单该工序的 `生产制单工序表.单价`；金额 = 数量 × 单价（录入时服务端按工序号查单价并算金额，不信任前端传的单价）。
4. 成本保密：计件 单价/金额、计件汇总 金额 在无"单价"权限时后端置 null。裁床单本期不含敏感价格（裁床工资是另一张表，本计划不做）。
5. FK：裁床/计件的 生产单号 必须是已存在的生产制单，款号必须存在于款号总表——测试种子按 FK 顺序种父行。
6. 中文做 C# 标识符合法。路由 ASCII（`api/cuttings`、`api/piecework`、`api/piecework/summary`），菜单名/表名用中文。

---

## 文件结构

```
src/ErpApi/
├─ Engines/Posting/PostableDocuments.cs   改:白名单加 "裁床总表"→"裁床单号"
├─ Features/Production/                    (P2 已有 ProductionService 等)
│  ├─ Cutting/                             裁床单
│  │  ├─ CuttingDtos.cs
│  │  ├─ CuttingService.cs
│  │  └─ CuttingController.cs
│  └─ Piecework/                           计件
│     ├─ PieceworkDtos.cs
│     ├─ PieceworkService.cs               批量录入/查询/删除/批量审核 + 汇总
│     └─ PieceworkController.cs            计件 REST + 计件汇总端点
└─ Program.cs                             改:注册 CuttingService / PieceworkService

db/04_p4_additions.sql                    新:裁床单号列扩宽到20 + 裁床总表补审核人/审核日期
db/run-db.ps1                             改:加载 04
db/seed_p4_perms.sql                      新:admin 授权 裁床单/计件/计件汇总 菜单

web/src/
├─ api/cuttings.ts                         新:裁床单 API
├─ api/piecework.ts                        新:计件 + 计件汇总 API
├─ pages/workshop/
│  ├─ CuttingPage.tsx                      裁床单列表+审核
│  ├─ CuttingCreateDrawer.tsx             新建裁床(选生产单→录床/扎明细)
│  ├─ CuttingDetailDrawer.tsx             裁床详情
│  ├─ PieceworkPage.tsx                   计件录入(选生产单→工序/工人/数量批量录入)+审核
│  └─ PieceworkSummaryPage.tsx           计件汇总查询(按工人/工序)
├─ pages/MainLayout.tsx                   改:加"生产车间"菜单组
└─ App.tsx                                改:+裁床/计件/计件汇总 路由

tests/ErpApi.Tests/
├─ PostableDocumentsTests.cs              改:断言 裁床总表→裁床单号
├─ PostingEngineDbTests.cs                改:+裁床总表审核用例
├─ P4TestData.cs                          新:M6 测试种子(客户/款号/工序/加工厂/人事/生产制单+工序表)+清理
├─ CuttingServiceDbTests.cs              新
├─ PieceworkServiceDbTests.cs            新(录入/单价取数/汇总/批量审核)
└─ P4ApiIntegrationTests.cs              新(裁床/计件 API 权限/审核/脱敏 + 计件汇总)
web/src/__tests__/piecework.test.ts      新:计件金额合计纯函数
```

---

## Task 1: 扩展审核白名单 + DB 04 脚本（裁床单号扩宽 + 审核留痕列）

裁床单要走审核过账引擎，但①`裁床总表`不在白名单，②其`裁床单号`列只有 nvarchar(10)（容不下 13 字符的单号），③缺审核人/审核日期列。本任务一次补齐。

**Files:**
- Create: `db/04_p4_additions.sql`
- Modify: `db/run-db.ps1`, `src/ErpApi/Engines/Posting/PostableDocuments.cs`, `tests/ErpApi.Tests/PostableDocumentsTests.cs`, `tests/ErpApi.Tests/PostingEngineDbTests.cs`

- [ ] **Step 1: 写 04 脚本**

Create `db/04_p4_additions.sql`:

```sql
-- P4 M6 裁床：裁床单号列原为 nvarchar(10)，容不下单号(前缀+yyyyMMdd+3位=13字符)，扩到 20；
-- 裁床总表 不在 P0 可过账白名单，缺 审核人/审核日期 留痕列，补齐(供审核过账引擎②)。幂等。
SET XACT_ABORT ON;

IF COL_LENGTH(N'裁床总表', N'裁床单号') < 40   -- nvarchar(20) 的字节长度=40；<40 说明还是10(=20字节)
    ALTER TABLE [裁床总表] ALTER COLUMN [裁床单号] nvarchar(20);
IF COL_LENGTH(N'裁床明细表', N'裁床单号') < 40
    ALTER TABLE [裁床明细表] ALTER COLUMN [裁床单号] nvarchar(20);
IF COL_LENGTH(N'计件表', N'裁床单号') < 40
    ALTER TABLE [计件表] ALTER COLUMN [裁床单号] nvarchar(20);

IF COL_LENGTH(N'裁床总表', N'审核人') IS NULL
    ALTER TABLE [裁床总表] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'裁床总表', N'审核日期') IS NULL
    ALTER TABLE [裁床总表] ADD [审核日期] datetime2(0) NULL;
```

注意 `COL_LENGTH` 返回的是字节长度：`nvarchar(10)`=20，`nvarchar(20)`=40。用 `< 40` 判断"还没扩宽"使其幂等。

- [ ] **Step 2: run-db.ps1 加载 04**

修改 `db/run-db.ps1`，在 03 那行之后追加 04（保持现有 01/02/03 不变）：

```powershell
dotnet run --project (Join-Path $root "tools\DbDeploy") -- $ConnectionString `
  ("lenient:" + (Join-Path $dir "01_rebuild_schema.sql")) `
  ("lenient:" + (Join-Path $dir "02_rebuild_relations.sql")) `
  (Join-Path $dir "03_p0_additions.sql") `
  (Join-Path $dir "04_p4_additions.sql")
```

- [ ] **Step 3: 在开发库和测试库执行 04**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
dotnet run --project tools/DbDeploy -- "$env:ERP_DB" db/04_p4_additions.sql
dotnet run --project tools/DbDeploy -- "$env:ERP_TEST_DB" db/04_p4_additions.sql
```

验收（两库都应返回 40，即 nvarchar(20)）：`SELECT COL_LENGTH('裁床总表','裁床单号')`；并确认 `COL_LENGTH('裁床总表','审核人')` 非 NULL。

- [ ] **Step 4: 写失败的白名单测试**

在 `tests/ErpApi.Tests/PostableDocumentsTests.cs` 追加：

```csharp
[Fact]
public void DocNoColumn_maps_裁床总表_to_裁床单号()
{
    Assert.Equal("裁床单号", PostableDocuments.DocNoColumn("裁床总表"));
    Assert.True(PostableDocuments.IsAllowed("裁床总表"));
}
```

- [ ] **Step 5: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~PostableDocumentsTests"`
Expected: FAIL（裁床总表 不在白名单，DocNoColumn 抛异常）

- [ ] **Step 6: 白名单加裁床总表**

在 `src/ErpApi/Engines/Posting/PostableDocuments.cs` 的 `Map` 字典里，`["生产制单"] = "生产单号"` 那行之后追加（注意它前面那行末尾要补逗号）：

```csharp
            ["生产制单"] = "生产单号",
            ["裁床总表"] = "裁床单号"
```

- [ ] **Step 7: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~PostableDocumentsTests"`
Expected: PASS

- [ ] **Step 8: 写裁床审核的 DB 集成测试**

在 `tests/ErpApi.Tests/PostingEngineDbTests.cs` 追加（裁床总表 FK：款号→款号总表，先种父行）：

```csharp
    [SkippableFact]
    public async Task Approve_裁床总表_uses_裁床单号_column()
    {
        using var c = fx.Open();
        c.Execute("DELETE FROM [裁床总表] WHERE [裁床单号]='P4CBPOST1'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]='P4CBK'");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'P4CBK',N'裁床过账测试款')");
        c.Execute("INSERT INTO [裁床总表]([裁床单号],[款号],[审核]) VALUES(N'P4CBPOST1',N'P4CBK','0')");

        var engine = new PostingEngine(Factory(), new AuditLogger());

        Assert.True(await engine.ApproveAsync("裁床总表", "P4CBPOST1", "tester"));
        Assert.Equal("1", c.ExecuteScalar<string>("SELECT [审核] FROM [裁床总表] WHERE [裁床单号]='P4CBPOST1'"));
        Assert.Equal("tester", c.ExecuteScalar<string>("SELECT [审核人] FROM [裁床总表] WHERE [裁床单号]='P4CBPOST1'"));
        Assert.False(await engine.ApproveAsync("裁床总表", "P4CBPOST1", "tester"));  // 重复审核返回false
        Assert.True(await engine.UnapproveAsync("裁床总表", "P4CBPOST1", "tester"));
        Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [裁床总表] WHERE [裁床单号]='P4CBPOST1'"));

        c.Execute("DELETE FROM [裁床总表] WHERE [裁床单号]='P4CBPOST1'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]='P4CBK'");
    }
```

- [ ] **Step 9: 跑 DB 测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~PostingEngineDbTests"`
Expected: PASS（含原有 + 新增裁床用例；证明扩宽后的裁床单号列能存 13 字符单号并被审核引擎匹配）

- [ ] **Step 10: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add db/04_p4_additions.sql db/run-db.ps1 src/ErpApi/Engines/Posting/PostableDocuments.cs tests/ErpApi.Tests/PostableDocumentsTests.cs tests/ErpApi.Tests/PostingEngineDbTests.cs
git commit -m @'
feat(P4): 裁床总表纳入审核白名单 + 04脚本(裁床单号扩宽20/补审核留痕列)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 裁床单 Service + DTO + P4 测试种子

裁床单两层（裁床总表 + 裁床明细表，按"裁床单号"串联），Dapper 事务，单号前缀 `CB`，从生产制单带款/客户/加工厂。本任务建 M6 共用测试种子 `P4TestData`。

**Files:**
- Create: `src/ErpApi/Features/Production/Cutting/CuttingDtos.cs`, `src/ErpApi/Features/Production/Cutting/CuttingService.cs`, `tests/ErpApi.Tests/P4TestData.cs`
- Modify: `src/ErpApi/Program.cs`
- Test: `tests/ErpApi.Tests/CuttingServiceDbTests.cs`

- [ ] **Step 1: 写裁床 DTO**

Create `src/ErpApi/Features/Production/Cutting/CuttingDtos.cs`:

```csharp
namespace ErpApi.Features.Production.Cutting;

public sealed class CuttingLineDto
{
    public long ID { get; set; }
    public int? 扎号 { get; set; }
    public string? 缸号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 计件数量 { get; set; }   // 该扎应计件数量；空则取数量
    public string? 备注 { get; set; }
}

public sealed class CuttingCreateDto
{
    public string 生产单号 { get; set; } = "";
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public string? 客户款号 { get; set; }
    public string? 合同号 { get; set; }
    public string? 床号 { get; set; }
    public string? 布种 { get; set; }
    public string? 备注 { get; set; }
    public List<CuttingLineDto> 明细 { get; set; } = [];
}

public sealed class CuttingHeaderDto
{
    public long ID { get; set; }
    public string? 裁床单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 加工厂名称 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 床号 { get; set; }
    public decimal? 裁床数量 { get; set; }
    public string? 布种 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class CuttingDetailDto
{
    public CuttingHeaderDto? 单头 { get; set; }
    public List<CuttingLineDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 2: 写 P4 测试种子**

Create `tests/ErpApi.Tests/P4TestData.cs`:

```csharp
using Dapper;
using Microsoft.Data.SqlClient;

// P4 M6 测试种子：客户 P4C01 / 加工厂 P4F01 / 款号 P4K01 / 人事 P4E01(车缝工张三) /
// 生产制单 P4SC01(款号P4K01,计划数量100) + 生产制单工序表(01裁床1.5 / 02车缝2.5,计件单价来源)。
public static class P4TestData
{
    public const string 客户编号 = "P4C01";
    public const string 加工厂编号 = "P4F01";
    public const string 款号 = "P4K01";
    public const string 生产单号 = "P4SC01";
    public const string 员工号 = "P4E01";

    public static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'P4C01',N'P4测试客户')");
        c.Execute("INSERT INTO [加工厂资料]([加工厂编号],[加工厂名称]) VALUES(N'P4F01',N'P4测试加工厂')");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'P4K01',N'P4测试款式')");
        c.Execute(@"INSERT INTO [人事档案]([编号],[姓名],[工序类型]) VALUES(N'P4E01',N'张三',N'车缝')");
        c.Execute(@"INSERT INTO [生产制单]([生产单号],[款号],[款式],[客户编号],[客户名称],[加工厂编号],[加工厂名称],[计划数量],[审核])
                    VALUES(N'P4SC01',N'P4K01',N'P4测试款式',N'P4C01',N'P4测试客户',N'P4F01',N'P4测试加工厂',100,'1')");
        c.Execute(@"INSERT INTO [生产制单工序表]([生产单号],[款号],[款式],[工序号],[工序名称],[单价],[工序类型])
                    VALUES(N'P4SC01',N'P4K01',N'P4测试款式',N'01',N'裁床',1.5,N'裁床'),
                          (N'P4SC01',N'P4K01',N'P4测试款式',N'02',N'车缝',2.5,N'车缝')");
    }

    // 反 FK 顺序清理；裁床/计件由各测试用返回单号精确删，此处兜底按生产单号删。
    public static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [计件表] WHERE [生产单号]=N'P4SC01'");
        c.Execute("DELETE FROM [裁床明细表] WHERE [生产单号]=N'P4SC01'");
        c.Execute("DELETE FROM [裁床总表] WHERE [生产单号]=N'P4SC01'");
        c.Execute("DELETE FROM [生产制单工序表] WHERE [生产单号]=N'P4SC01'");
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'P4SC01'");
        c.Execute("DELETE FROM [人事档案] WHERE [编号]=N'P4E01'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'P4K01'");
        c.Execute("DELETE FROM [加工厂资料] WHERE [加工厂编号]=N'P4F01'");
        c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'P4C01'");
    }
}
```

- [ ] **Step 3: 写失败的 Service 测试**

Create `tests/ErpApi.Tests/CuttingServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Production.Cutting;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class CuttingServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private CuttingService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static CuttingCreateDto Dto() => new()
    {
        生产单号 = P4TestData.生产单号, 款号 = P4TestData.款号, 款式 = "P4测试款式",
        客户编号 = P4TestData.客户编号, 客户名称 = "P4测试客户",
        加工厂编号 = P4TestData.加工厂编号, 加工厂名称 = "P4测试加工厂",
        床号 = "1", 布种 = "全棉",
        明细 =
        [
            new CuttingLineDto { 扎号 = 1, 缸号 = "G1", 颜色 = "黑色", 尺码 = "M", 数量 = 40 },
            new CuttingLineDto { 扎号 = 2, 缸号 = "G1", 颜色 = "白色", 尺码 = "L", 数量 = 30 },
        ]
    };

    [SkippableFact]
    public async Task Create_writes_header_and_lines_with_total()
    {
        using var c = fx.Open();
        P4TestData.Seed(c);
        var 裁床单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            Assert.StartsWith("CB", 裁床单号);
            // 裁床数量 = 40+30 = 70
            Assert.Equal(70m, c.ExecuteScalar<decimal>("SELECT [裁床数量] FROM [裁床总表] WHERE [裁床单号]=@n", new { n = 裁床单号 }));
            Assert.Equal(2, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [裁床明细表] WHERE [裁床单号]=@n", new { n = 裁床单号 }));
            // 计件数量 未传时默认=数量
            Assert.Equal(40m, c.ExecuteScalar<decimal>("SELECT [计件数量] FROM [裁床明细表] WHERE [裁床单号]=@n AND [扎号]=1", new { n = 裁床单号 }));
            Assert.Equal("0", c.ExecuteScalar<string>("SELECT [审核] FROM [裁床总表] WHERE [裁床单号]=@n", new { n = 裁床单号 }));
        }
        finally
        {
            c.Execute("DELETE FROM [裁床明细表] WHERE [裁床单号]=@n", new { n = 裁床单号 });
            c.Execute("DELETE FROM [裁床总表] WHERE [裁床单号]=@n", new { n = 裁床单号 });
            P4TestData.Cleanup(c);
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
        P4TestData.Seed(c);
        var 裁床单号 = await Svc().CreateAsync(Dto(), "tester");
        try
        {
            var page = await Svc().ListAsync(1, 20, 裁床单号);
            Assert.Equal(1, page.Total);

            var detail = await Svc().GetAsync(裁床单号);
            Assert.NotNull(detail);
            Assert.Equal(2, detail!.明细.Count);
            Assert.Equal("1", detail.单头!.床号);

            c.Execute("UPDATE [裁床总表] SET [审核]='1' WHERE [裁床单号]=@n", new { n = 裁床单号 });
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(裁床单号));
            c.Execute("UPDATE [裁床总表] SET [审核]='0' WHERE [裁床单号]=@n", new { n = 裁床单号 });
            Assert.True(await Svc().DeleteAsync(裁床单号));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [裁床明细表] WHERE [裁床单号]=@n", new { n = 裁床单号 }));
            Assert.False(await Svc().DeleteAsync("CB不存在"));
        }
        finally
        {
            c.Execute("DELETE FROM [裁床明细表] WHERE [裁床单号]=@n", new { n = 裁床单号 });
            c.Execute("DELETE FROM [裁床总表] WHERE [裁床单号]=@n", new { n = 裁床单号 });
            P4TestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 4: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~CuttingServiceDbTests"`
Expected: FAIL（CuttingService 不存在）

- [ ] **Step 5: 实现 CuttingService**

Create `src/ErpApi/Features/Production/Cutting/CuttingService.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
namespace ErpApi.Features.Production.Cutting;

// 裁床单（把生产制单按床/扎/色码裁剪）。两层：裁床总表 + 裁床明细表，按"裁床单号"串联(无主从FK)。
public sealed class CuttingService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "裁床总表";
    public const string Prefix = "CB";   // 裁床单号 = CB + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(CuttingCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("裁床单至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.生产单号)) throw new ArgumentException("生产单号必填");

        var 裁床数量 = dto.明细.Sum(l => l.数量);
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        var 裁床单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [裁床总表]([裁床单号],[生产单号],[客户编号],[客户名称],[加工厂编号],[加工厂名称],
    [款号],[款式],[客户款号],[合同号],[日期],[床号],[裁床数量],[布种],[操作员],[审核],[备注])
VALUES(@裁床单号,@生产单号,@客户编号,@客户名称,@加工厂编号,@加工厂名称,
    @款号,@款式,@客户款号,@合同号,@日期,@床号,@裁床数量,@布种,@操作员,'0',@备注)",
            new
            {
                裁床单号, dto.生产单号, dto.客户编号, dto.客户名称, dto.加工厂编号, dto.加工厂名称,
                dto.款号, dto.款式, dto.客户款号, dto.合同号, 日期 = now, dto.床号,
                裁床数量, dto.布种, 操作员 = user, dto.备注
            }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [裁床明细表]([裁床单号],[生产单号],[客户编号],[客户名称],[款号],[款式],[日期],[床号],
    [扎号],[缸号],[颜色],[尺码],[数量],[计件数量],[备注],[有效])
VALUES(@裁床单号,@生产单号,@客户编号,@客户名称,@款号,@款式,@日期,@床号,
    @扎号,@缸号,@颜色,@尺码,@数量,@计件数量,@备注,'1')",
                new
                {
                    裁床单号, dto.生产单号, dto.客户编号, dto.客户名称, dto.款号, dto.款式, 日期 = now, dto.床号,
                    l.扎号, l.缸号, l.颜色, l.尺码, l.数量, 计件数量 = l.计件数量 ?? l.数量, l.备注
                }, tx);

        tx.Commit();
        return 裁床单号;
    }

    public async Task<PagedResult<CuttingHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [裁床总表]
WHERE @kw IS NULL OR [裁床单号] LIKE @kw OR [生产单号] LIKE @kw OR [款号] LIKE @kw OR [床号] LIKE @kw;
SELECT [ID],[裁床单号],[生产单号],[款号],[款式],[客户名称],[加工厂名称],[日期],[床号],[裁床数量],[布种],[操作员],[审核],[审核人],[备注]
FROM [裁床总表]
WHERE @kw IS NULL OR [裁床单号] LIKE @kw OR [生产单号] LIKE @kw OR [款号] LIKE @kw OR [床号] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<CuttingHeaderDto>()).AsList();
        return new PagedResult<CuttingHeaderDto>(items, total);
    }

    public async Task<CuttingDetailDto?> GetAsync(string 裁床单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[裁床单号],[生产单号],[款号],[款式],[客户名称],[加工厂名称],[日期],[床号],[裁床数量],[布种],[操作员],[审核],[审核人],[备注]
FROM [裁床总表] WHERE [裁床单号]=@裁床单号;
SELECT [ID],[扎号],[缸号],[颜色],[尺码],[数量],[计件数量],[备注]
FROM [裁床明细表] WHERE [裁床单号]=@裁床单号 ORDER BY [ID];",
            new { 裁床单号 });
        var header = await multi.ReadFirstOrDefaultAsync<CuttingHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<CuttingLineDto>()).AsList();
        return new CuttingDetailDto { 单头 = header, 明细 = lines };
    }

    // 删除：仅未审核可删；裁床单号串联(无FK)，先删明细后删总表
    public async Task<bool> DeleteAsync(string 裁床单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [裁床总表] WHERE [裁床单号]=@裁床单号", new { 裁床单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的裁床单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [裁床明细表] WHERE [裁床单号]=@裁床单号", new { 裁床单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [裁床总表] WHERE [裁床单号]=@裁床单号", new { 裁床单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 6: Program.cs 注册**

在 `src/ErpApi/Program.cs` 的 `// 业务` 区块追加：

```csharp
builder.Services.AddScoped<ErpApi.Features.Production.Cutting.CuttingService>();
```

- [ ] **Step 7: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~CuttingServiceDbTests"`
Expected: PASS 3 个

- [ ] **Step 8: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Production/Cutting/CuttingDtos.cs src/ErpApi/Features/Production/Cutting/CuttingService.cs src/ErpApi/Program.cs tests/ErpApi.Tests/P4TestData.cs tests/ErpApi.Tests/CuttingServiceDbTests.cs
git commit -m @'
feat(P4): 裁床单服务(总表+明细Dapper事务,前缀CB)+P4测试种子

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 裁床单 Controller（REST + 审核 + 权限审计）

裁床单本期不含敏感价格（裁床工资是另一张表，不在 M6 范围），故无成本保密脱敏。

**Files:**
- Create: `src/ErpApi/Features/Production/Cutting/CuttingController.cs`
- Test: `tests/ErpApi.Tests/P4ApiIntegrationTests.cs`

- [ ] **Step 1: 写失败的 API 集成测试**

Create `tests/ErpApi.Tests/P4ApiIntegrationTests.cs`（仿 P3ApiIntegrationTests）:

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
public class P4ApiIntegrationTests(DbFixture fx)
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

    private static object CuttingBody() => new
    {
        生产单号 = P4TestData.生产单号, 款号 = P4TestData.款号, 款式 = "P4测试款式",
        客户编号 = P4TestData.客户编号, 客户名称 = "P4测试客户",
        加工厂编号 = P4TestData.加工厂编号, 加工厂名称 = "P4测试加工厂", 床号 = "1", 布种 = "全棉",
        明细 = new[]
        {
            new { 扎号 = 1, 缸号 = "G1", 颜色 = "黑色", 尺码 = "M", 数量 = 40 },
            new { 扎号 = 2, 缸号 = "G1", 颜色 = "白色", 尺码 = "L", 数量 = 30 },
        }
    };

    [SkippableFact]
    public async Task Cutting_create_forbidden_without_save_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4TestData.Seed(c); }
        SeedPerms("p4cbviewer", "裁床单", open: true, save: false);
        var resp = await Client(app, "p4cbviewer").PostAsJsonAsync("/api/cuttings", CuttingBody());
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Cutting_lifecycle_create_approve_unapprove_delete()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4TestData.Seed(c); }
        SeedPerms("p4cb", "裁床单", open: true, save: true, del: true, approve: true, unapprove: true);
        var client = Client(app, "p4cb");

        var create = await client.PostAsJsonAsync("/api/cuttings", CuttingBody());
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var 裁床单号 = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("裁床单号").GetString()!;
        try
        {
            var list = await client.GetFromJsonAsync<JsonElement>($"/api/cuttings?keyword={裁床单号}");
            Assert.Equal(1, list.GetProperty("total").GetInt32());
            var detail = await client.GetFromJsonAsync<JsonElement>($"/api/cuttings/{裁床单号}");
            Assert.Equal(2, detail.GetProperty("明细").GetArrayLength());
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/cuttings/{裁床单号}/approve", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync($"/api/cuttings/{裁床单号}")).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/cuttings/{裁床单号}/unapprove", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/cuttings/{裁床单号}")).StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [裁床明细表] WHERE [裁床单号]=@n", new { n = 裁床单号 });
            c.Execute("DELETE FROM [裁床总表] WHERE [裁床单号]=@n", new { n = 裁床单号 });
            P4TestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~P4ApiIntegrationTests"`
Expected: FAIL（/api/cuttings 404）

- [ ] **Step 3: 实现 CuttingController**

Create `src/ErpApi/Features/Production/Cutting/CuttingController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Production.Cutting;

[ApiController]
[Authorize]
[Route("api/cuttings")]
public sealed class CuttingController(
    CuttingService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "裁床单";
    private const string Table = "裁床总表";

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

    [HttpGet("{裁床单号}")]
    public async Task<IActionResult> Get(string 裁床单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(裁床单号);
        if (d is null) return NotFound();
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CuttingCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 裁床单号;
        try { 裁床单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "生产单号/款号不存在。" }); }
        await AuditAsync("新增", $"单号={裁床单号}");
        return CreatedAtAction(nameof(Get), new { 裁床单号 }, new { 裁床单号 });
    }

    [HttpDelete("{裁床单号}")]
    public async Task<IActionResult> Delete(string 裁床单号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try { if (!await svc.DeleteAsync(裁床单号)) return NotFound(); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("删除", $"单号={裁床单号}");
        return NoContent();
    }

    [HttpPost("{裁床单号}/approve")]
    public async Task<IActionResult> Approve(string 裁床单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        if (!await posting.ApproveAsync(Table, 裁床单号, CurrentUser))
            return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        return NoContent();
    }

    [HttpPost("{裁床单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 裁床单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        if (!await posting.UnapproveAsync(Table, 裁床单号, CurrentUser))
            return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        return NoContent();
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~P4ApiIntegrationTests"`
Expected: PASS 2 个

- [ ] **Step 5: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Production/Cutting/CuttingController.cs tests/ErpApi.Tests/P4ApiIntegrationTests.cs
git commit -m @'
feat(P4): 裁床单REST接口(审核过账+权限审计)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: 计件 Service（批量录入 / 查询 / 删除 / 批量审核）

计件表是**扁平记录**（无单号头）。计件录入=批量插入多条记录，每条单价取自该生产单该工序的 `生产制单工序表.单价`（服务端查，不信任前端），金额=数量×单价。审核按生产单批量翻转审核位。

**Files:**
- Create: `src/ErpApi/Features/Production/Piecework/PieceworkDtos.cs`, `src/ErpApi/Features/Production/Piecework/PieceworkService.cs`
- Modify: `src/ErpApi/Program.cs`
- Test: `tests/ErpApi.Tests/PieceworkServiceDbTests.cs`

- [ ] **Step 1: 写计件 DTO**

Create `src/ErpApi/Features/Production/Piecework/PieceworkDtos.cs`:

```csharp
namespace ErpApi.Features.Production.Piecework;

// 一条计件：某工人做某工序若干件
public sealed class PieceworkLineDto
{
    public string 工序号 { get; set; } = "";
    public string 员工号 { get; set; } = "";
    public decimal 数量 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public int? 扎号 { get; set; }
}

// 批量录入（一次提交多条计件，共享生产单/裁床单上下文）
public sealed class PieceworkRecordDto
{
    public string 生产单号 { get; set; } = "";
    public string? 裁床单号 { get; set; }
    public string? 床号 { get; set; }
    public DateTime? 裁床日期 { get; set; }
    public List<PieceworkLineDto> 明细 { get; set; } = [];
}

// 查询行（读出，含工序名称/姓名）
public sealed class PieceworkRowDto
{
    public long ID { get; set; }
    public string? 生产单号 { get; set; }
    public string? 裁床单号 { get; set; }
    public string? 工序号 { get; set; }
    public string? 工序名称 { get; set; }
    public string? 员工号 { get; set; }
    public string? 姓名 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public int? 扎号 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 审核 { get; set; }
}

// 计件汇总行（按 员工×工序 归集；算法2 前身）
public sealed class PieceworkSummaryRow
{
    public string? 员工号 { get; set; }
    public string? 姓名 { get; set; }
    public string? 工序号 { get; set; }
    public string? 工序名称 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
}
```

- [ ] **Step 2: 写失败的 Service 测试**

Create `tests/ErpApi.Tests/PieceworkServiceDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Features.Production.Piecework;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PieceworkServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PieceworkService Svc() => new(Factory());

    private static PieceworkRecordDto Dto() => new()
    {
        生产单号 = P4TestData.生产单号, 床号 = "1",
        明细 =
        [
            // 车缝工序(02,单价2.5) × 员工P4E01，做 40 件 → 金额 100
            new PieceworkLineDto { 工序号 = "02", 员工号 = P4TestData.员工号, 颜色 = "黑色", 尺码 = "M", 数量 = 40 },
            // 同工人车缝再做 30 件 → 金额 75
            new PieceworkLineDto { 工序号 = "02", 员工号 = P4TestData.员工号, 颜色 = "白色", 尺码 = "L", 数量 = 30 },
        ]
    };

    [SkippableFact]
    public async Task Record_takes_price_from_process_and_computes_amount()
    {
        using var c = fx.Open();
        P4TestData.Seed(c);
        try
        {
            var n = await Svc().RecordAsync(Dto(), "tester");
            Assert.Equal(2, n);
            // 单价取自工序表(02车缝=2.5)，金额=数量×单价
            Assert.Equal(2.5m, c.ExecuteScalar<decimal>(
                "SELECT TOP 1 [单价] FROM [计件表] WHERE [生产单号]=@s AND [工序号]='02'", new { s = P4TestData.生产单号 }));
            Assert.Equal(100m, c.ExecuteScalar<decimal>(
                "SELECT [金额] FROM [计件表] WHERE [生产单号]=@s AND [数量]=40", new { s = P4TestData.生产单号 }));
            // 新计件未审核
            Assert.Equal("0", c.ExecuteScalar<string>(
                "SELECT TOP 1 [审核] FROM [计件表] WHERE [生产单号]=@s", new { s = P4TestData.生产单号 }));
        }
        finally { P4TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Record_rejects_process_not_in_order()
    {
        using var c = fx.Open();
        P4TestData.Seed(c);
        try
        {
            var dto = Dto();
            dto.明细 = [ new PieceworkLineDto { 工序号 = "99", 员工号 = P4TestData.员工号, 数量 = 10 } ];
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().RecordAsync(dto, "tester"));
        }
        finally { P4TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_Approve_Delete_and_Summary()
    {
        using var c = fx.Open();
        P4TestData.Seed(c);
        try
        {
            await Svc().RecordAsync(Dto(), "tester");
            var rows = await Svc().ListByOrderAsync(P4TestData.生产单号);
            Assert.Equal(2, rows.Count);
            Assert.Equal("车缝", rows[0].工序名称);   // JOIN 工序表带出
            Assert.Equal("张三", rows[0].姓名);        // JOIN 人事带出

            // 汇总前未审核 → 空（汇总只认已审核计件）
            Assert.Empty(await Svc().SummaryAsync(P4TestData.生产单号));

            // 批量审核 → 汇总出现：员工P4E01 车缝 数量70 金额175
            var approved = await Svc().ApproveByOrderAsync(P4TestData.生产单号, "tester");
            Assert.Equal(2, approved);
            var sum = await Svc().SummaryAsync(P4TestData.生产单号);
            var row = Assert.Single(sum);
            Assert.Equal(P4TestData.员工号, row.员工号);
            Assert.Equal(70m, row.数量);
            Assert.Equal(175m, row.金额);   // 40×2.5 + 30×2.5

            // 删除单条（已审核计件不可删）
            var first = (await Svc().ListByOrderAsync(P4TestData.生产单号))[0];
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(first.ID));
        }
        finally { P4TestData.Cleanup(c); }
    }
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~PieceworkServiceDbTests"`
Expected: FAIL（PieceworkService 不存在）

- [ ] **Step 4: 实现 PieceworkService**

Create `src/ErpApi/Features/Production/Piecework/PieceworkService.cs`:

```csharp
using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Production.Piecework;

// 计件（车缝完成量，P7 工资归集源头）。计件表为扁平记录，无单号头。
// 单价取自该生产单该工序的 生产制单工序表.单价（服务端查，不信任前端）；金额=数量×单价。
public sealed class PieceworkService(ISqlConnectionFactory factory)
{
    // 批量录入；返回录入条数
    public async Task<int> RecordAsync(PieceworkRecordDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("计件至少要有一行");
        if (string.IsNullOrWhiteSpace(dto.生产单号)) throw new ArgumentException("生产单号必填");
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        var n = 0;
        foreach (var l in dto.明细)
        {
            if (string.IsNullOrWhiteSpace(l.工序号)) throw new ArgumentException("工序号必填");
            if (string.IsNullOrWhiteSpace(l.员工号)) throw new ArgumentException("员工号必填");
            if (l.数量 <= 0) throw new ArgumentException("计件数量必须大于0");

            var 单价 = await c.ExecuteScalarAsync<decimal?>(
                "SELECT [单价] FROM [生产制单工序表] WHERE [生产单号]=@生产单号 AND [工序号]=@工序号",
                new { dto.生产单号, l.工序号 }, tx);
            if (单价 is null)
                throw new ArgumentException($"工序 [{l.工序号}] 不在生产单 [{dto.生产单号}] 的工序表中");

            await c.ExecuteAsync(@"
INSERT INTO [计件表]([生产单号],[裁床单号],[床号],[裁床日期],[颜色],[尺码],[扎号],
    [工序号],[数量],[单价],[金额],[操作员],[员工号],[日期],[审核],[有效])
VALUES(@生产单号,@裁床单号,@床号,@裁床日期,@颜色,@尺码,@扎号,
    @工序号,@数量,@单价,@金额,@操作员,@员工号,@日期,'0','1')",
                new
                {
                    dto.生产单号, dto.裁床单号, dto.床号, dto.裁床日期, l.颜色, l.尺码, l.扎号,
                    l.工序号, l.数量, 单价, 金额 = l.数量 * 单价.Value, 操作员 = user, l.员工号, 日期 = now
                }, tx);
            n++;
        }
        tx.Commit();
        return n;
    }

    // 列出某生产单的有效计件（JOIN 工序表带工序名称、JOIN 人事带姓名）
    public async Task<IReadOnlyList<PieceworkRowDto>> ListByOrderAsync(string 生产单号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<PieceworkRowDto>(@"
SELECT j.[ID],j.[生产单号],j.[裁床单号],j.[工序号],p.[工序名称],j.[员工号],e.[姓名],
       j.[颜色],j.[尺码],j.[扎号],j.[数量],j.[单价],j.[金额],j.[审核]
FROM [计件表] j
LEFT JOIN [生产制单工序表] p ON p.[生产单号]=j.[生产单号] AND p.[工序号]=j.[工序号]
LEFT JOIN [人事档案] e ON e.[编号]=j.[员工号]
WHERE j.[生产单号]=@生产单号 AND ISNULL(j.[有效],'1')<>'0'
ORDER BY j.[ID] DESC", new { 生产单号 });
        return rows.AsList();
    }

    // 批量审核某生产单的未审核计件；返回审核条数
    public async Task<int> ApproveByOrderAsync(string 生产单号, string user)
    {
        using var c = factory.Create();
        return await c.ExecuteAsync(
            "UPDATE [计件表] SET [审核]='1' WHERE [生产单号]=@生产单号 AND ISNULL([审核],'0')='0' AND ISNULL([有效],'1')<>'0'",
            new { 生产单号 });
    }

    // 删除单条计件（仅未审核）
    public async Task<bool> DeleteAsync(long id)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [计件表] WHERE [ID]=@id", new { id });
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的计件不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [计件表] WHERE [ID]=@id", new { id });
        return true;
    }

    // 计件汇总（算法2 前身）：按 员工×工序 归集已审核计件的数量与金额
    public async Task<IReadOnlyList<PieceworkSummaryRow>> SummaryAsync(string 生产单号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<PieceworkSummaryRow>(@"
SELECT j.[员工号], MAX(e.[姓名]) AS 姓名, j.[工序号], MAX(p.[工序名称]) AS 工序名称,
       SUM(j.[数量]) AS 数量, SUM(j.[金额]) AS 金额
FROM [计件表] j
LEFT JOIN [生产制单工序表] p ON p.[生产单号]=j.[生产单号] AND p.[工序号]=j.[工序号]
LEFT JOIN [人事档案] e ON e.[编号]=j.[员工号]
WHERE j.[生产单号]=@生产单号 AND ISNULL(j.[审核],'0')='1'
GROUP BY j.[员工号], j.[工序号]
ORDER BY j.[员工号], j.[工序号]", new { 生产单号 });
        return rows.AsList();
    }
}
```

- [ ] **Step 5: Program.cs 注册**

在 `// 业务` 区块追加：

```csharp
builder.Services.AddScoped<ErpApi.Features.Production.Piecework.PieceworkService>();
```

- [ ] **Step 6: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~PieceworkServiceDbTests"`
Expected: PASS 3 个

- [ ] **Step 7: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Production/Piecework/PieceworkDtos.cs src/ErpApi/Features/Production/Piecework/PieceworkService.cs src/ErpApi/Program.cs tests/ErpApi.Tests/PieceworkServiceDbTests.cs
git commit -m @'
feat(P4): 计件服务(批量录入/单价取工序表/查询/批量审核/汇总)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: 计件 Controller（录入/查询/删除/批量审核 REST + 成本保密）

**Files:**
- Create: `src/ErpApi/Features/Production/Piecework/PieceworkController.cs`
- Test: `tests/ErpApi.Tests/P4ApiIntegrationTests.cs`（追加）

- [ ] **Step 1: 写失败的 API 集成测试**

在 `tests/ErpApi.Tests/P4ApiIntegrationTests.cs` 追加（复用已有 Factory/SeedPerms/Client）:

```csharp
    private static object PieceworkBody() => new
    {
        生产单号 = P4TestData.生产单号, 床号 = "1",
        明细 = new[]
        {
            new { 工序号 = "02", 员工号 = P4TestData.员工号, 颜色 = "黑色", 尺码 = "M", 数量 = 40 },
            new { 工序号 = "02", 员工号 = P4TestData.员工号, 颜色 = "白色", 尺码 = "L", 数量 = 30 },
        }
    };

    [SkippableFact]
    public async Task Piecework_record_forbidden_without_save_permission()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4TestData.Seed(c); }
        SeedPerms("p4pwviewer", "计件", open: true, save: false);
        var resp = await Client(app, "p4pwviewer").PostAsJsonAsync("/api/piecework", PieceworkBody());
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Piecework_record_approve_and_amounts_masked_without_单价()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4TestData.Seed(c); }
        SeedPerms("p4pw", "计件", open: true, save: true, del: true, price: true, approve: true);
        var editor = Client(app, "p4pw");
        try
        {
            var rec = await editor.PostAsJsonAsync("/api/piecework", PieceworkBody());
            Assert.Equal(HttpStatusCode.Created, rec.StatusCode);
            Assert.Equal(2, (await rec.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("录入条数").GetInt32());

            // 有"单价"权限：查询能看到单价/金额
            var list = await editor.GetFromJsonAsync<JsonElement>($"/api/piecework?生产单号={P4TestData.生产单号}");
            Assert.Equal(2, list.GetArrayLength());
            Assert.Equal(2.5m, list[0].GetProperty("单价").GetDecimal());

            // 批量审核
            Assert.Equal(HttpStatusCode.NoContent,
                (await editor.PostAsync($"/api/piecework/approve?生产单号={P4TestData.生产单号}", null)).StatusCode);

            // 无"单价"权限：单价/金额被剥离
            SeedPerms("p4pwnoprice", "计件", open: true, price: false);
            var viewer = Client(app, "p4pwnoprice");
            var masked = await viewer.GetFromJsonAsync<JsonElement>($"/api/piecework?生产单号={P4TestData.生产单号}");
            Assert.Equal(JsonValueKind.Null, masked[0].GetProperty("单价").ValueKind);
            Assert.Equal(JsonValueKind.Null, masked[0].GetProperty("金额").ValueKind);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open(); P4TestData.Cleanup(c);
        }
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~P4ApiIntegrationTests"`
Expected: 计件相关 FAIL（/api/piecework 404）；裁床相关仍 PASS

- [ ] **Step 3: 实现 PieceworkController**

Create `src/ErpApi/Features/Production/Piecework/PieceworkController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Production.Piecework;

[ApiController]
[Authorize]
[Route("api/piecework")]
public sealed class PieceworkController(
    PieceworkService svc, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "计件";
    private const string Table = "计件表";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }

    // 录入计件（批量）
    [HttpPost]
    public async Task<IActionResult> Record([FromBody] PieceworkRecordDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        int 录入条数;
        try { 录入条数 = await svc.RecordAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        await AuditAsync("新增", $"生产单={dto.生产单号},{录入条数}条");
        return StatusCode(StatusCodes.Status201Created, new { 录入条数 });
    }

    // 查询某生产单的计件（成本保密：无"单价"权限剥离 单价/金额）
    [HttpGet]
    public async Task<IActionResult> List([FromQuery(Name = "生产单号")] string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var rows = await svc.ListByOrderAsync(生产单号);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in rows) { r.单价 = null; r.金额 = null; }
        return Ok(rows);
    }

    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try { if (!await svc.DeleteAsync(id)) return NotFound(); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("删除", $"计件ID={id}");
        return NoContent();
    }

    // 批量审核某生产单的未审核计件
    [HttpPost("approve")]
    public async Task<IActionResult> Approve([FromQuery(Name = "生产单号")] string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        var n = await svc.ApproveByOrderAsync(生产单号, CurrentUser);
        await AuditAsync("审核", $"生产单={生产单号},计件{n}条");
        return NoContent();
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~P4ApiIntegrationTests"`
Expected: PASS（裁床 2 + 计件 2）

- [ ] **Step 5: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Production/Piecework/PieceworkController.cs tests/ErpApi.Tests/P4ApiIntegrationTests.cs
git commit -m @'
feat(P4): 计件REST接口(批量录入/查询/删除/批量审核+成本保密)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 6: 计件汇总端点（算法2 前身，独立"计件汇总"菜单）

`PieceworkService.SummaryAsync`（Task 4 已实现）暴露为查询端点，用独立菜单"计件汇总"控权（给管理者看计件工资归集预览），金额按"单价"权限脱敏。

**Files:**
- Modify: `src/ErpApi/Features/Production/Piecework/PieceworkController.cs`
- Test: `tests/ErpApi.Tests/P4ApiIntegrationTests.cs`（追加）

- [ ] **Step 1: 写失败的汇总集成测试**

在 `tests/ErpApi.Tests/P4ApiIntegrationTests.cs` 追加：

```csharp
    [SkippableFact]
    public async Task Piecework_summary_groups_by_worker_and_masks_amount()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); P4TestData.Seed(c); }
        // 录入并审核计件
        SeedPerms("p4sumrec", "计件", open: true, save: true, approve: true, price: true);
        var rec = Client(app, "p4sumrec");
        try
        {
            await rec.PostAsJsonAsync("/api/piecework", PieceworkBody());
            await rec.PostAsync($"/api/piecework/approve?生产单号={P4TestData.生产单号}", null);

            // 无"计件汇总"菜单打开权限 → 403
            SeedPerms("p4sumdenied", "计件", open: true);   // 只有"计件"菜单,没有"计件汇总"
            var denied = Client(app, "p4sumdenied");
            Assert.Equal(HttpStatusCode.Forbidden,
                (await denied.GetAsync($"/api/piecework/summary?生产单号={P4TestData.生产单号}")).StatusCode);

            // 有"计件汇总"+"单价"权限 → 看到归集金额 175
            SeedPerms("p4sum", "计件汇总", open: true, price: true);
            var viewer = Client(app, "p4sum");
            var sum = await viewer.GetFromJsonAsync<JsonElement>($"/api/piecework/summary?生产单号={P4TestData.生产单号}");
            var row = sum.EnumerateArray().First();
            Assert.Equal(P4TestData.员工号, row.GetProperty("员工号").GetString());
            Assert.Equal(70m, row.GetProperty("数量").GetDecimal());
            Assert.Equal(175m, row.GetProperty("金额").GetDecimal());

            // 有"计件汇总"但无"单价" → 金额脱敏
            SeedPerms("p4sumnoprice", "计件汇总", open: true, price: false);
            var np = Client(app, "p4sumnoprice");
            var sum2 = await np.GetFromJsonAsync<JsonElement>($"/api/piecework/summary?生产单号={P4TestData.生产单号}");
            Assert.Equal(JsonValueKind.Null, sum2.EnumerateArray().First().GetProperty("金额").ValueKind);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open(); P4TestData.Cleanup(c);
        }
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~P4ApiIntegrationTests"`
Expected: `Piecework_summary_*` FAIL（/api/piecework/summary 404）；其余 PASS

- [ ] **Step 3: 在 PieceworkController 加汇总端点**

在 `src/ErpApi/Features/Production/Piecework/PieceworkController.cs` 的 `Approve` 方法之后追加（注意菜单是"计件汇总"，不是"计件"）：

```csharp
    // 计件汇总（算法2 前身）：按 员工×工序 归集已审核计件。独立"计件汇总"菜单控权；金额按"单价"权限脱敏。
    [HttpGet("summary")]
    public async Task<IActionResult> Summary([FromQuery(Name = "生产单号")] string 生产单号)
    {
        const string summaryMenu = "计件汇总";
        if (!await perms.HasAsync(CurrentUser, summaryMenu, PermissionAction.打开)) return Forbid();
        var rows = await svc.SummaryAsync(生产单号);
        if (!await perms.HasAsync(CurrentUser, summaryMenu, PermissionAction.单价))
            foreach (var r in rows) r.金额 = null;
        return Ok(rows);
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~P4ApiIntegrationTests"`
Expected: PASS（裁床 2 + 计件 2 + 汇总 1）

- [ ] **Step 5: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Production/Piecework/PieceworkController.cs tests/ErpApi.Tests/P4ApiIntegrationTests.cs
git commit -m @'
feat(P4): 计件汇总端点(算法2前身,按员工×工序归集,独立菜单+金额脱敏)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 7: 权限种子 + 后端收尾回归 + 冒烟

**Files:**
- Create: `db/seed_p4_perms.sql`
- Test: 无新代码；脚本 + 回归

- [ ] **Step 1: 写 P4 权限种子脚本**

Create `db/seed_p4_perms.sql`（仿 `db/seed_p3_perms.sql`；裁床/计件是单据菜单，审核/反审核=1；计件汇总只读）:

```sql
-- 开发用:给某用户授予 P4 M6 菜单(裁床单/计件/计件汇总)权限。用法:把 @用户 改成登录名,在目标库执行。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'裁床单',N'计件',N'计件汇总');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'裁床单',1,1,1,1,1,1,1,1,1),
       (@用户,N'计件',1,1,1,1,1,1,1,1,1),
       (@用户,N'计件汇总',1,0,0,1,1,1,0,0,1);
```

- [ ] **Step 2: 在开发库和测试库执行种子**

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")
dotnet run --project tools/DbDeploy -- "$env:ERP_DB" db/seed_p4_perms.sql
dotnet run --project tools/DbDeploy -- "$env:ERP_TEST_DB" db/seed_p4_perms.sql
```

验收（两库都应返回 3）：`SELECT COUNT(*) FROM userbqrpower WHERE 用户='admin' AND 菜单 IN (N'裁床单',N'计件',N'计件汇总')`

- [ ] **Step 3: 后端全量回归**

Run: `dotnet test`
Expected: 全部 PASS，0 跳过（设了 ERP_TEST_DB 时）

- [ ] **Step 4: API 冒烟（绕过系统代理）**

清残留进程并后台启动后端（`Get-Process -Name ErpApi -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue` 后 `Start-Process ... dotnet run --project src/ErpApi --urls http://localhost:5000`），用 `HttpClientHandler{UseProxy=false}` 的 .NET HttpClient（或 Node axios）以 admin/admin123 登录后请求：

```
GET /api/cuttings?page=1&size=5                  → 200 {items,total}
GET /api/piecework?生产单号=不存在               → 200 []（空数组）
GET /api/piecework/summary?生产单号=不存在       → 200 []（空数组）
```

任何 403 都说明权限种子没在 erp 库生效——回 Step 2 检查。冒烟后停后端进程。

- [ ] **Step 5: 提交**

```powershell
git add db/seed_p4_perms.sql
git commit -m @'
feat(P4): P4 M6菜单权限种子(裁床单/计件/计件汇总)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 8: 前端 — 裁床单页（列表 + 新建[从生产制单选款] + 详情 + 审核）

**前端编码规范（P2/P3 沉淀，必须遵守）**：所有异步 try/catch + `message.error(err.response?.data?.消息 ?? 默认文案)`；基于前值的 setState 用函数式更新 `setX(prev => ...)`；不在组件渲染体重建 API 对象；TS 严格、`npm --prefix web run build` 0 错误。

**先读**：`web/src/api/production.ts`（P2 的 `productionApi.list/get`——选生产单带出款号/客户/加工厂）、`web/src/api/master.ts`、`web/src/pages/orders/OrderCreateDrawer.tsx` + `OrdersPage.tsx`（列表/抽屉/审核模式）、`web/src/pages/materials/MaterialLineTable.tsx`（明细行编辑表模式）、`web/src/auth/permissions.ts`、`web/src/pages/MainLayout.tsx`。

**Files:**
- Create: `web/src/api/cuttings.ts`, `web/src/pages/workshop/CuttingCreateDrawer.tsx`, `web/src/pages/workshop/CuttingDetailDrawer.tsx`, `web/src/pages/workshop/CuttingPage.tsx`

- [ ] **Step 1: 裁床 API 客户端**

Create `web/src/api/cuttings.ts`:

```typescript
import { api } from "./client";
import type { Paged } from "./master";

export interface CuttingLine { 扎号?: number; 缸号?: string; 颜色?: string; 尺码?: string; 数量: number; 计件数量?: number }
export interface CuttingCreate {
  生产单号: string; 款号?: string; 款式?: string; 客户编号?: string; 客户名称?: string;
  加工厂编号?: string; 加工厂名称?: string; 床号?: string; 布种?: string; 备注?: string;
  明细: CuttingLine[];
}
export interface CuttingHeader {
  id: number; 裁床单号?: string; 生产单号?: string; 款号?: string; 款式?: string;
  客户名称?: string; 加工厂名称?: string; 日期?: string; 床号?: string; 裁床数量?: number; 布种?: string; 审核?: string; 备注?: string;
}
export interface CuttingDetail {
  单头: CuttingHeader | null;
  明细: { id: number; 扎号?: number; 缸号?: string; 颜色?: string; 尺码?: string; 数量?: number; 计件数量?: number; 备注?: string }[];
}

const enc = encodeURIComponent;
export const cuttingsApi = {
  list: (page = 1, size = 20, keyword = "") =>
    api.get<Paged<CuttingHeader>>("/cuttings", { params: { page, size, keyword } }).then(r => r.data),
  get: (裁床单号: string) => api.get<CuttingDetail>(`/cuttings/${enc(裁床单号)}`).then(r => r.data),
  create: (body: CuttingCreate) => api.post<{ 裁床单号: string }>("/cuttings", body).then(r => r.data),
  remove: (裁床单号: string) => api.delete(`/cuttings/${enc(裁床单号)}`),
  approve: (裁床单号: string) => api.post(`/cuttings/${enc(裁床单号)}/approve`),
  unapprove: (裁床单号: string) => api.post(`/cuttings/${enc(裁床单号)}/unapprove`),
};
```

- [ ] **Step 2: 新建裁床抽屉（选生产单 → 录床/扎明细）**

Create `web/src/pages/workshop/CuttingCreateDrawer.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Button, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Statistic, Table, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { productionApi, type ProductionHeader } from "../../api/production";
import { cuttingsApi, type CuttingLine } from "../../api/cuttings";

interface Header { 款号?: string; 款式?: string; 客户编号?: string; 客户名称?: string; 加工厂编号?: string; 加工厂名称?: string }

export default function CuttingCreateDrawer({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [form] = Form.useForm<{ 生产单号: string; 床号?: string; 布种?: string; 备注?: string }>();
  const [orders, setOrders] = useState<ProductionHeader[]>([]);
  const [picked, setPicked] = useState<Header>({});
  const [lines, setLines] = useState<CuttingLine[]>([]);
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
    try {
      const d = await productionApi.get(生产单号);
      const h = d.单头;
      setPicked({
        款号: h?.款号, 款式: h?.款式, 客户编号: h?.客户编号, 客户名称: h?.客户名称,
        加工厂编号: h?.加工厂编号, 加工厂名称: h?.加工厂名称,
      });
    } catch { message.error("加载生产制单详情失败"); }
  };

  const setLine = (i: number, patch: Partial<CuttingLine>) =>
    setLines(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    let v: { 生产单号: string; 床号?: string; 布种?: string; 备注?: string };
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => Number(l.数量) > 0);
    if (ok.length === 0) { message.error("请至少录入一行有数量的扎"); return; }
    setSaving(true);
    try {
      await cuttingsApi.create({ ...v, ...picked, 明细: ok });
      message.success("裁床单已创建"); onClose(); onCreated();
    } catch (e) {
      const msg = (e as { response?: { data?: { 消息?: string } } }).response?.data?.消息;
      message.error(msg ?? "创建裁床单失败");
    } finally { setSaving(false); }
  };

  const columns = [
    { title: "扎号", dataIndex: "扎号", width: 90, render: (_: unknown, r: CuttingLine, i: number) =>
      <InputNumber min={0} precision={0} style={{ width: 76 }} value={r.扎号 ?? undefined} onChange={n => setLine(i, { 扎号: n == null ? undefined : Number(n) })} /> },
    { title: "缸号", dataIndex: "缸号", width: 100, render: (_: unknown, r: CuttingLine, i: number) =>
      <Input style={{ width: 90 }} value={r.缸号 ?? ""} onChange={e => setLine(i, { 缸号: e.target.value })} /> },
    { title: "颜色", dataIndex: "颜色", width: 100, render: (_: unknown, r: CuttingLine, i: number) =>
      <Input style={{ width: 90 }} value={r.颜色 ?? ""} onChange={e => setLine(i, { 颜色: e.target.value })} /> },
    { title: "尺码", dataIndex: "尺码", width: 90, render: (_: unknown, r: CuttingLine, i: number) =>
      <Input style={{ width: 80 }} value={r.尺码 ?? ""} onChange={e => setLine(i, { 尺码: e.target.value })} /> },
    { title: "数量", dataIndex: "数量", width: 110, render: (_: unknown, r: CuttingLine, i: number) =>
      <InputNumber min={0} precision={0} style={{ width: 96 }} value={r.数量 ?? 0} onChange={n => setLine(i, { 数量: Number(n ?? 0) })} /> },
    { title: "", key: "_op", width: 50, render: (_: unknown, __: CuttingLine, i: number) =>
      <a onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>删除</a> },
  ];

  const 数量合计 = lines.reduce((a, l) => a + Number(l.数量 ?? 0), 0);

  return (
    <Drawer title="新建裁床单" width={900} open={open} onClose={onClose}
      extra={<Button type="primary" loading={saving} onClick={submit}>保存</Button>}>
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="生产单号" label="生产制单" rules={[{ required: true, message: "请选择生产制单" }]}>
              <Select showSearch optionFilterProp="label" onChange={onOrderChange}
                options={orders.map(o => ({ value: String(o.生产单号), label: `${o.生产单号} ${o.款式 ?? ""}` }))} />
            </Form.Item>
          </Col>
          <Col span={8}><Form.Item label="款号"><Input value={picked.款号 ?? ""} disabled /></Form.Item></Col>
          <Col span={8}><Form.Item label="客户"><Input value={picked.客户名称 ?? ""} disabled /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={6}><Form.Item name="床号" label="床号"><Input /></Form.Item></Col>
          <Col span={6}><Form.Item name="布种" label="布种"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="备注" label="备注"><Input /></Form.Item></Col>
        </Row>
      </Form>
      <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={lines} columns={columns} />
      <Space style={{ marginTop: 12 }} size={24}>
        <Button icon={<PlusOutlined />} onClick={() => setLines(prev => [...prev, { 数量: 0 }])}>加一扎</Button>
        <Statistic title="裁床数量合计" value={数量合计} />
      </Space>
    </Drawer>
  );
}
```

- [ ] **Step 3: 裁床详情抽屉**

Create `web/src/pages/workshop/CuttingDetailDrawer.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Descriptions, Drawer, Table, Tag, message } from "antd";
import { cuttingsApi, type CuttingDetail } from "../../api/cuttings";

export default function CuttingDetailDrawer({ 裁床单号, onClose }: { 裁床单号: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<CuttingDetail | null>(null);

  useEffect(() => {
    if (!裁床单号) { setDetail(null); return; }
    (async () => {
      try { setDetail(await cuttingsApi.get(裁床单号)); }
      catch { message.error("加载裁床详情失败"); }
    })();
  }, [裁床单号]);

  const h = detail?.单头;

  return (
    <Drawer title={`裁床单 ${裁床单号 ?? ""}`} width={780} open={!!裁床单号} onClose={onClose}>
      {detail && (
        <>
          <Descriptions size="small" column={3} bordered style={{ marginBottom: 16 }}
            items={[
              { key: "no", label: "裁床单号", children: h?.裁床单号 ?? "-" },
              { key: "po", label: "生产单号", children: h?.生产单号 ?? "-" },
              { key: "st", label: "状态", children: h?.审核 === "1" ? <Tag color="green">已审核</Tag> : <Tag>未审核</Tag> },
              { key: "k", label: "款号", children: `${h?.款号 ?? ""} ${h?.款式 ?? ""}` },
              { key: "bed", label: "床号", children: h?.床号 ?? "-" },
              { key: "qty", label: "裁床数量", children: String(h?.裁床数量 ?? "-") },
              { key: "cust", label: "客户", children: h?.客户名称 ?? "-" },
              { key: "fab", label: "布种", children: h?.布种 ?? "-" },
              { key: "memo", label: "备注", children: h?.备注 ?? "-" },
            ]} />
          <Table size="small" rowKey="id" pagination={false} dataSource={detail.明细}
            columns={[
              { title: "扎号", dataIndex: "扎号" }, { title: "缸号", dataIndex: "缸号" },
              { title: "颜色", dataIndex: "颜色" }, { title: "尺码", dataIndex: "尺码" },
              { title: "数量", dataIndex: "数量" }, { title: "计件数量", dataIndex: "计件数量" },
            ]} />
        </>
      )}
    </Drawer>
  );
}
```

- [ ] **Step 4: 裁床列表页**

Create `web/src/pages/workshop/CuttingPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Popconfirm, Space, Table, Tag, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { cuttingsApi, type CuttingHeader } from "../../api/cuttings";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import CuttingCreateDrawer from "./CuttingCreateDrawer";
import CuttingDetailDrawer from "./CuttingDetailDrawer";

const MENU = "裁床单";

export default function CuttingPage() {
  const perms = usePerms();
  const [rows, setRows] = useState<CuttingHeader[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await cuttingsApi.list(page, 10, keyword); setRows(r.items); setTotal(r.total); }
    catch { message.error("加载裁床单失败"); }
  }, [page, keyword]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); load(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const columns = [
    { title: "裁床单号", dataIndex: "裁床单号", key: "裁床单号", render: (v: string) => <a className="erp-num" onClick={() => setViewing(v)}>{v}</a> },
    { title: "生产单号", dataIndex: "生产单号", key: "生产单号", render: (v?: string) => v && <span className="erp-num">{v}</span> },
    { title: "款号", dataIndex: "款号", key: "款号" },
    { title: "床号", dataIndex: "床号", key: "床号" },
    { title: "裁床数量", dataIndex: "裁床数量", key: "裁床数量" },
    { title: "日期", dataIndex: "日期", key: "日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "状态", dataIndex: "审核", key: "审核",
      render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: CuttingHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => cuttingsApi.approve(row.裁床单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => cuttingsApi.unapprove(row.裁床单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该裁床单?" onConfirm={() => act(() => cuttingsApi.remove(row.裁床单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title="裁床单" variant="borderless"
      extra={
        <Space>
          <Input.Search placeholder="搜索裁床单号/生产单号/款号" allowClear onSearch={v => { setPage(1); setKeyword(v); }} style={{ width: 260 }} />
          {can(perms, MENU, "保存") && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建裁床单</Button>}
        </Space>
      }>
      <Table rowKey="id" size="middle" dataSource={rows} columns={columns} scroll={{ x: true }}
        pagination={{ current: page, pageSize: 10, total, onChange: setPage, showTotal: t => `共 ${t} 条` }} />
      <CuttingCreateDrawer open={creating} onClose={() => setCreating(false)} onCreated={load} />
      <CuttingDetailDrawer 裁床单号={viewing} onClose={() => setViewing(null)} />
    </Card>
  );
}
```

- [ ] **Step 5: 构建 + 测试 + 提交**

Run: `npm --prefix web run test` → Expected: PASS（无回归）
Run: `npm --prefix web run build` → Expected: tsc 0 错误

```powershell
git add web/src/api/cuttings.ts web/src/pages/workshop/
git commit -m @'
feat(P4): 前端裁床单页(从生产制单选款+录扎明细+审核)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 9: 前端 — 计件录入页 + 计件汇总页 + 路由/菜单

**Files:**
- Create: `web/src/utils/pieceLines.ts`, `web/src/api/piecework.ts`, `web/src/pages/workshop/PieceworkPage.tsx`, `web/src/pages/workshop/PieceworkSummaryPage.tsx`
- Modify: `web/src/App.tsx`, `web/src/pages/MainLayout.tsx`
- Test: `web/src/__tests__/piecework.test.ts`

- [ ] **Step 1: 写失败的合计纯函数测试**

Create `web/src/__tests__/piecework.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { sumPieceQty, validPieceLines } from "../utils/pieceLines";

describe("计件明细", () => {
  it("sumPieceQty 合计数量", () => {
    expect(sumPieceQty([{ 数量: 40 }, { 数量: 30 }])).toBe(70);
    expect(sumPieceQty([])).toBe(0);
  });
  it("validPieceLines 过滤缺工序/工人/数量<=0 的行", () => {
    const lines = [
      { 工序号: "02", 员工号: "E1", 数量: 40 },
      { 工序号: "", 员工号: "E1", 数量: 5 },
      { 工序号: "02", 员工号: "", 数量: 5 },
      { 工序号: "02", 员工号: "E1", 数量: 0 },
    ];
    expect(validPieceLines(lines)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm --prefix web run test`
Expected: FAIL（pieceLines 不存在）

- [ ] **Step 3: 计件明细纯函数**

Create `web/src/utils/pieceLines.ts`:

```typescript
export interface PieceLine { 工序号?: string; 员工号?: string; 数量?: number; 颜色?: string; 尺码?: string; 扎号?: number }

export const sumPieceQty = (lines: { 数量?: number }[]) =>
  lines.reduce((a, l) => a + Number(l.数量 ?? 0), 0);

// 提交前过滤：工序号/员工号 必填且数量>0
export const validPieceLines = (lines: PieceLine[]) =>
  lines.filter(l => !!l.工序号 && !!l.员工号 && Number(l.数量 ?? 0) > 0);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm --prefix web run test`
Expected: PASS

- [ ] **Step 5: 计件 API 客户端**

Create `web/src/api/piecework.ts`:

```typescript
import { api } from "./client";

export interface PieceLineDto { 工序号: string; 员工号: string; 数量: number; 颜色?: string; 尺码?: string; 扎号?: number }
export interface PieceRecord { 生产单号: string; 裁床单号?: string; 床号?: string; 明细: PieceLineDto[] }
export interface PieceRow {
  id: number; 生产单号?: string; 裁床单号?: string; 工序号?: string; 工序名称?: string;
  员工号?: string; 姓名?: string; 颜色?: string; 尺码?: string; 扎号?: number;
  数量?: number; 单价?: number | null; 金额?: number | null; 审核?: string;
}
export interface PieceSummaryRow { 员工号?: string; 姓名?: string; 工序号?: string; 工序名称?: string; 数量?: number; 金额?: number | null }

export const pieceworkApi = {
  record: (body: PieceRecord) => api.post<{ 录入条数: number }>("/piecework", body).then(r => r.data),
  list: (生产单号: string) => api.get<PieceRow[]>("/piecework", { params: { 生产单号 } }).then(r => r.data),
  remove: (id: number) => api.delete(`/piecework/${id}`),
  approve: (生产单号: string) => api.post("/piecework/approve", null, { params: { 生产单号 } }),
  summary: (生产单号: string) => api.get<PieceSummaryRow[]>("/piecework/summary", { params: { 生产单号 } }).then(r => r.data),
};
```

- [ ] **Step 6: 计件录入页**

Create `web/src/pages/workshop/PieceworkPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, InputNumber, Popconfirm, Select, Space, Table, Tag, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { productionApi, type ProductionHeader } from "../../api/production";
import { masterApi } from "../../api/master";
import { pieceworkApi, type PieceLineDto, type PieceRow } from "../../api/piecework";
import { validPieceLines } from "../../utils/pieceLines";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "计件";
interface Proc { 工序号?: string; 工序名称?: string }
interface Emp { 编号?: string; 姓名?: string }

export default function PieceworkPage() {
  const perms = usePerms();
  const [orders, setOrders] = useState<ProductionHeader[]>([]);
  const [生产单号, set生产单号] = useState<string>();
  const [procs, setProcs] = useState<Proc[]>([]);
  const [emps, setEmps] = useState<Emp[]>([]);
  const [lines, setLines] = useState<PieceLineDto[]>([]);
  const [rows, setRows] = useState<PieceRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setOrders((await productionApi.list(1, 200)).items);
        setEmps((await masterApi("employees").list(1, 500)).items as Emp[]);
      } catch { message.error("加载生产制单/人事失败"); }
    })();
  }, []);

  const loadRows = useCallback(async () => {
    if (!生产单号) { setRows([]); return; }
    try { setRows(await pieceworkApi.list(生产单号)); }
    catch { message.error("加载计件记录失败"); }
  }, [生产单号]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const onOrderChange = async (v: string) => {
    set生产单号(v); setLines([]);
    try {
      const d = await productionApi.get(v);
      setProcs(d.工序.map(p => ({ 工序号: p.工序号, 工序名称: p.工序名称 })));
    } catch { message.error("加载工序失败"); }
  };

  const setLine = (i: number, patch: Partial<PieceLineDto>) =>
    setLines(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    if (!生产单号) { message.error("请先选择生产制单"); return; }
    const ok = validPieceLines(lines) as PieceLineDto[];
    if (ok.length === 0) { message.error("请录入工序/工人/数量"); return; }
    setSaving(true);
    try {
      const r = await pieceworkApi.record({ 生产单号, 明细: ok });
      message.success(`已录入 ${r.录入条数} 条计件`); setLines([]); loadRows();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "录入失败");
    } finally { setSaving(false); }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); loadRows(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const priceHidden = !can(perms, MENU, "单价");
  const editColumns = [
    { title: "工序", dataIndex: "工序号", width: 160, render: (_: unknown, r: PieceLineDto, i: number) =>
      <Select style={{ width: 150 }} value={r.工序号 || undefined} placeholder="工序"
        onChange={(v: string) => setLine(i, { 工序号: v })}
        options={procs.map(p => ({ value: String(p.工序号), label: `${p.工序号} ${p.工序名称 ?? ""}` }))} /> },
    { title: "工人", dataIndex: "员工号", width: 160, render: (_: unknown, r: PieceLineDto, i: number) =>
      <Select showSearch optionFilterProp="label" style={{ width: 150 }} value={r.员工号 || undefined} placeholder="工人"
        onChange={(v: string) => setLine(i, { 员工号: v })}
        options={emps.map(e => ({ value: String(e.编号), label: `${e.编号} ${e.姓名 ?? ""}` }))} /> },
    { title: "颜色", dataIndex: "颜色", width: 100, render: (_: unknown, r: PieceLineDto, i: number) =>
      <Select allowClear style={{ width: 90 }} value={r.颜色 || undefined} options={[]} open={false}
        onChange={() => undefined} dropdownStyle={{ display: "none" }}
        // 颜色自由文本：用 InputNumber 不合适，这里用一个文本输入更简单——见下方替换说明
      /> },
    { title: "数量", dataIndex: "数量", width: 110, render: (_: unknown, r: PieceLineDto, i: number) =>
      <InputNumber min={0} precision={0} style={{ width: 96 }} value={r.数量 ?? 0} onChange={n => setLine(i, { 数量: Number(n ?? 0) })} /> },
    { title: "", key: "_op", width: 50, render: (_: unknown, __: PieceLineDto, i: number) =>
      <a onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>删除</a> },
  ];

  const listColumns = [
    { title: "工序", dataIndex: "工序名称", key: "工序名称", render: (v: string, r: PieceRow) => v ?? r.工序号 },
    { title: "工人", dataIndex: "姓名", key: "姓名", render: (v: string, r: PieceRow) => v ?? r.员工号 },
    { title: "颜色", dataIndex: "颜色", key: "颜色" },
    { title: "尺码", dataIndex: "尺码", key: "尺码" },
    { title: "数量", dataIndex: "数量", key: "数量" },
    ...(priceHidden ? [] : [
      { title: "单价", dataIndex: "单价", key: "单价" },
      { title: "金额", dataIndex: "金额", key: "金额" },
    ]),
    { title: "状态", dataIndex: "审核", key: "审核",
      render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: PieceRow) => (row.审核 !== "1" && can(perms, MENU, "删除")
        ? <Popconfirm title="确认删除该计件?" onConfirm={() => act(() => pieceworkApi.remove(row.id), "已删除")}><a>删除</a></Popconfirm>
        : null),
    },
  ];

  return (
    <Card title="计件录入" variant="borderless"
      extra={
        <Space>
          <Select showSearch optionFilterProp="label" placeholder="选择生产制单" style={{ width: 280 }}
            value={生产单号} onChange={onOrderChange}
            options={orders.map(o => ({ value: String(o.生产单号), label: `${o.生产单号} ${o.款式 ?? ""}` }))} />
          {生产单号 && can(perms, MENU, "审核") && (
            <Button onClick={() => act(() => pieceworkApi.approve(生产单号), "已批量审核")}>批量审核</Button>
          )}
        </Space>
      }>
      {生产单号 && can(perms, MENU, "保存") && (
        <div style={{ marginBottom: 16 }}>
          <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={lines} columns={editColumns} />
          <Space style={{ marginTop: 12 }}>
            <Button icon={<PlusOutlined />} onClick={() => setLines(prev => [...prev, { 工序号: "", 员工号: "", 数量: 0 }])}>加一行</Button>
            <Button type="primary" loading={saving} onClick={submit}>提交计件</Button>
          </Space>
        </div>
      )}
      <Table rowKey="id" size="middle" dataSource={rows} columns={listColumns} pagination={{ pageSize: 15 }} />
    </Card>
  );
}
```

**Step 6 修正说明（必做）**：上面 `editColumns` 的"颜色"列示意代码用了不可用的 Select 占位写法。实现时把"颜色"列改成普通文本输入（需 `import { Input } from "antd"`）：

```tsx
    { title: "颜色", dataIndex: "颜色", width: 100, render: (_: unknown, r: PieceLineDto, i: number) =>
      <Input style={{ width: 90 }} value={r.颜色 ?? ""} onChange={e => setLine(i, { 颜色: e.target.value })} /> },
    { title: "尺码", dataIndex: "尺码", width: 90, render: (_: unknown, r: PieceLineDto, i: number) =>
      <Input style={{ width: 80 }} value={r.尺码 ?? ""} onChange={e => setLine(i, { 尺码: e.target.value })} /> },
```

（即颜色、尺码两列都用 `Input` 自由文本；不要用 Select。`Input` 已在 import 中加入。）

- [ ] **Step 7: 计件汇总页**

Create `web/src/pages/workshop/PieceworkSummaryPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Card, Select, Table, message } from "antd";
import { productionApi, type ProductionHeader } from "../../api/production";
import { pieceworkApi, type PieceSummaryRow } from "../../api/piecework";

export default function PieceworkSummaryPage() {
  const [orders, setOrders] = useState<ProductionHeader[]>([]);
  const [生产单号, set生产单号] = useState<string>();
  const [rows, setRows] = useState<PieceSummaryRow[]>([]);

  useEffect(() => {
    (async () => {
      try { setOrders((await productionApi.list(1, 200)).items); }
      catch { message.error("加载生产制单失败"); }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!生产单号) { setRows([]); return; }
    try { setRows(await pieceworkApi.summary(生产单号)); }
    catch { message.error("加载计件汇总失败"); }
  }, [生产单号]);
  useEffect(() => { load(); }, [load]);

  const columns = [
    { title: "员工号", dataIndex: "员工号", render: (v: string) => <span className="erp-num">{v}</span> },
    { title: "姓名", dataIndex: "姓名" },
    { title: "工序", dataIndex: "工序名称", render: (v: string, r: PieceSummaryRow) => v ?? r.工序号 },
    { title: "计件数量", dataIndex: "数量" },
    { title: "计件金额", dataIndex: "金额", render: (v?: number | null) => (v == null ? "***" : v) },
  ];

  return (
    <Card title="计件汇总（已审核计件按工人×工序归集）" variant="borderless"
      extra={
        <Select showSearch optionFilterProp="label" placeholder="选择生产制单" style={{ width: 280 }}
          value={生产单号} onChange={set生产单号}
          options={orders.map(o => ({ value: String(o.生产单号), label: `${o.生产单号} ${o.款式 ?? ""}` }))} />
      }>
      <Table rowKey={(r) => `${r.员工号}|${r.工序号}`} size="middle" dataSource={rows} columns={columns}
        pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }} />
    </Card>
  );
}
```

- [ ] **Step 8: App.tsx 加路由**

修改 `web/src/App.tsx`，import 三个页面，在物料路由之后加：

```tsx
import CuttingPage from "./pages/workshop/CuttingPage";
import PieceworkPage from "./pages/workshop/PieceworkPage";
import PieceworkSummaryPage from "./pages/workshop/PieceworkSummaryPage";
// ...
          <Route path="cuttings" element={<CuttingPage />} />
          <Route path="piecework" element={<PieceworkPage />} />
          <Route path="piecework-summary" element={<PieceworkSummaryPage />} />
```

- [ ] **Step 9: MainLayout 加"生产车间"菜单组**

修改 `web/src/pages/MainLayout.tsx`：

import 加图标：`ScissorOutlined, FormOutlined, BarChartOutlined`（从 @ant-design/icons，保留现有）。

在现有 `matChildren`（物料管理组）之后新增 `wsChildren`，并把 `items` 数组追加"生产车间"组：

```tsx
  const wsChildren = [
    ...(can(perms, "裁床单", "打开") ? [{ key: "/cuttings", label: "裁床单", icon: <ScissorOutlined /> }] : []),
    ...(can(perms, "计件", "打开") ? [{ key: "/piecework", label: "计件录入", icon: <FormOutlined /> }] : []),
    ...(can(perms, "计件汇总", "打开") ? [{ key: "/piecework-summary", label: "计件汇总", icon: <BarChartOutlined /> }] : []),
  ];
```

`items` 末尾追加（在物料管理组之后）：

```tsx
    ...(wsChildren.length ? [{ key: "ws", label: "生产车间", icon: <ScissorOutlined />, children: wsChildren }] : []),
```

Header 标题判断链追加（在现有链里加分支）：

```tsx
              : loc.pathname.startsWith("/cuttings") ? "裁床单"
              : loc.pathname.startsWith("/piecework-summary") ? "计件汇总"
              : loc.pathname.startsWith("/piecework") ? "计件录入"
```

（注意 `/piecework-summary` 判断要在 `/piecework` 之前，因为前者以后者为前缀。`openKeys` 保持默认 `[]`，点击展开。）

- [ ] **Step 10: 构建 + 测试 + 提交**

Run: `npm --prefix web run test` → Expected: PASS（含 piecework 2 个）
Run: `npm --prefix web run build` → Expected: tsc 0 错误（颜色/尺码列务必用 Input）

```powershell
git add web/src/
git commit -m @'
feat(P4): 前端计件录入页+计件汇总页+生产车间菜单/路由

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 10: 端到端验证（裁床 → 计件 → 审核 → 汇总 + 截图）

无新功能代码（发现 bug 才修）。验证 M6 闭环：生产制单 → 裁床 → 计件（计件源头）→ 计件汇总（工资归集预览）。

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

E2E 复用 P2 端到端遗留的生产制单 `SC20260603001`（款号 K001，工序表含 裁床1.5 / 车缝2.5）。计件需要至少一个工人（人事档案）——若 erp 库无员工，先种一个演示工人：

```powershell
$env:ERP_DB = [Environment]::GetEnvironmentVariable("ERP_DB","User")
# 用 DbDeploy 跑一句内联 SQL 不方便；写一行临时脚本 tmp/seed-emp.sql 再执行：
Set-Content -Path tmp/seed-emp.sql -Encoding UTF8 -Value "IF NOT EXISTS(SELECT 1 FROM [人事档案] WHERE [编号]=N'E001') INSERT INTO [人事档案]([编号],[姓名],[工序类型]) VALUES(N'E001',N'演示工人',N'车缝');"
dotnet run --project tools/DbDeploy -- "$env:ERP_DB" tmp/seed-emp.sql
```

确认 `SELECT COUNT(*) FROM 生产制单 WHERE 生产单号='SC20260603001'` = 1；`SELECT COUNT(*) FROM 生产制单工序表 WHERE 生产单号='SC20260603001'` ≥ 1。若 SC20260603001 不存在（演示数据被清），改用 P2 流程先建一张生产制单（或在 E2E 脚本里经 UI 建）；记录实际所用生产单号。

- [ ] **Step 3: 启动前后端**

```powershell
Get-Process -Name ErpApi -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Process -FilePath "dotnet" -ArgumentList "run --project src/ErpApi --urls http://localhost:5000" -WorkingDirectory "D:\WebpageERP" -WindowStyle Hidden
Start-Process -FilePath "cmd" -ArgumentList "/c npm --prefix web run dev -- --host --port 5173" -WorkingDirectory "D:\WebpageERP" -WindowStyle Hidden
Start-Sleep -Seconds 15
```

- [ ] **Step 4: puppeteer 走 M6 主线（每步截图）**

写 `tmp/shot/p4-e2e.cjs`（headless:'new'，viewport 1440×900，executablePath 指向本机 Chrome；`tmp/shot` 是 ESM 包，用 `.cjs` 扩展名）完成（admin/admin123，Task 7 已授权 P4 三菜单）：
1. 登录 → 生产车间 → 裁床单 → 新建：选生产制单 SC20260603001 → 床号 `1` → 加一扎（扎号1/颜色黑色/尺码M/数量40）→ 保存 → 列表点"审核" → 截图 `tmp/p4-1-cutting.png`
2. 生产车间 → 计件录入 → 选生产制单 SC20260603001 → 加一行（工序选"车缝"、工人选 演示工人、数量 40）→ 提交计件 → 列表出现 1 条（单价 2.5、金额 100）→ 点"批量审核" → 截图 `tmp/p4-2-piecework.png`
3. 生产车间 → 计件汇总 → 选 SC20260603001 → 显示 演示工人/车缝/数量40/金额100 → 截图 `tmp/p4-3-summary.png`

puppeteer 要点（参考 P2/P3 经验）：antd v6 Select 先 click 控件再等 `.ant-select-item-option` 渲染再点；每步操作后 `await new Promise(r=>setTimeout(r,800))`；失败先截图存档再退出。UI 卡住时记录卡点，用绕过代理的 .NET HttpClient/Node axios 经 API 补验 M6 核心命题（裁床创建+审核、计件录入+审核、汇总 GROUP BY），确保核心被证实后如实报告。

- [ ] **Step 5: 数据库验证计件口径**

对 erp 库（Dapper/临时脚本直连，不受代理影响）验证 SC20260603001 的计件汇总：
```sql
SELECT j.员工号, SUM(j.数量) AS 数量, SUM(j.金额) AS 金额
FROM 计件表 j WHERE j.生产单号='SC20260603001' AND ISNULL(j.审核,'0')='1'
GROUP BY j.员工号;
```
记录实际结果（车缝 40 件 × 单价 2.5 = 金额 100）。

- [ ] **Step 6: 清理 + 收尾**

停服务（Stop-Process ErpApi；关 node dev）。删 `tmp/seed-emp.sql`（临时）。演示单据保留在 erp 开发库。确认：
```powershell
git status
git log --oneline master..HEAD
```
Expected: 工作树干净（tmp/ 截图不计）；分支领先 master 约 9 个提交。汇报后由 finishing-a-development-branch 决定合并。

---

## Self-Review 结论

**Spec 覆盖检查**（对照蓝图 P4 行 M6：裁床→工票(计件源头)；条码(算11)/塑胶啤件成本(算9)）：
- ✅ 裁床（裁床总表+明细，从生产制单分床裁剪）：Task 2（Service）+ Task 3（Controller/审核）+ Task 8（前端）
- ✅ 工票/计件源头（计件表，工序×工人×数量，单价取工序工价）：Task 4（Service）+ Task 5（Controller）+ Task 9（前端录入）
- ✅ 计件汇总（按工人×工序归集，算法2 前身、P7 工资源头预览）：Task 4（SummaryAsync）+ Task 6（端点）+ Task 9（前端汇总页）
- ✅ 审核引擎扩展（裁床总表纳入白名单，单号列"裁床单号"；04 脚本扩宽单号列+补审核留痕列）：Task 1
- ✅ 横切引擎复用：单号①（裁床 CB 前缀）、审核②（裁床走引擎；计件按生产单批量审核——计件是扁平记录，合理偏离）、权限审计④（所有端点）；计件单价取 P2 生产制单工序表
- ✅ 成本保密：计件 单价/金额、计件汇总 金额 按"单价"权限后端剥离；裁床本期无敏感价格

**明确延后（已记录）**：
1. **算法11 条码**：计件本期手工录入（工序/工人/数量），条码扫描（扎号条码生成+扫描计件）延后——计件表的 条码号/扫描手工 列预留，将来扫描录入复用同一 RecordAsync 链路。
2. **算法9 塑胶啤件成本**：本厂主营服装，塑胶次要；其"工序成本+物料成本"通用建模延后（生产制单已有工序工费+BOM物料金额两侧数据，将来汇总即可）。
3. **工票格式/裁片打印**（工票格式/工票裁片表）：打印模板属 P8 配置，本期不做。
4. **裁床工资**（裁床计件，裁床数量×裁床单价）：裁床工资表是另一条计件线，本期裁床单不含价格，延后。
5. **M7 发外加工/回收/对数**：用户选定本次只做 M6；M7 是独立子系统，另行一份计划（结构与 P2 订单三层/P3 物料单据同构，可快速复用）。

**类型/签名一致性检查**：
- `CuttingService` 的 `DocType="裁床总表"`/`Prefix="CB"`；审核走 `PostableDocuments["裁床总表"]="裁床单号"`（Task 1 加）——一致 ✅
- `PieceworkService.RecordAsync/ListByOrderAsync/ApproveByOrderAsync/DeleteAsync/SummaryAsync` 在 Task 4 定义，Task 5/6 控制器调用签名一致 ✅
- 计件单价来源 `生产制单工序表`（P2 表）：Task 4 SQL 与 P4TestData 种的工序（02 车缝 2.5）一致，测试断言 40×2.5=100、70×2.5=175 自洽 ✅
- 前端 `cuttingsApi`（Task 8）、`pieceworkApi`（Task 9）字段与后端 DTO 对齐；`productionApi.get().工序`（P2）被裁床/计件前端复用 ✅
- `sumPieceQty/validPieceLines`（Task 9 utils）被录入页+测试共用 ✅

**已知简化与理由**：
1. 裁床总表↔明细无主从 FK（schema 既有），靠"裁床单号"约定串联；删除按裁床单号先明细后总表。
2. 计件是扁平记录、不走单据三层；审核按生产单批量翻转审核位（计件表无审核人/审核日期列，不写留痕）——计件本质是记录集，合理。
3. 计件汇总只归集"已审核"计件（审核='1'），契合 P7 工资只算确认计件。
4. 裁床明细 schema 有一条引用不存在"单号"列的索引（IX_114_单号），是既有瑕疵（建库 lenient 跳过），与本计划无关。

---

## 执行交接

计划已保存到 `docs/superpowers/plans/2026-06-04-p4-m6-cutting-piecework.md`。两种执行方式：

**1. Subagent-Driven（推荐）** — 每个任务派全新子代理实现，任务间做规格审查+质量审查，迭代快（与 P0–P3 一致）。REQUIRED SUB-SKILL: superpowers:subagent-driven-development。

**2. Inline Execution** — 当前会话用 superpowers:executing-plans 按批次执行、设检查点。

选哪种？






