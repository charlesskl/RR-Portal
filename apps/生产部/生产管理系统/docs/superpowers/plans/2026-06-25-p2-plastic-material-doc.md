# 塑胶采购分析 + 塑胶物料单(P2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建塑胶模块 P2 —— 塑胶采购分析(列生产单)+ 塑胶物料单(按生产单货号从 P1 塑胶共用物料表带出的可保存可审核采购单据:头 `塑胶物料单` + 明细 `塑胶物料明细单`)。

**Architecture:** 镜像物料侧 `采购物料分析→采购物料单(PurchaseOrderService/PurchaseOrderDrawer)`,差异只在 basis 来源:塑胶用 `塑胶共用物料表 JOIN 生产制单货号 ON 货号=塑胶货号`(无 BOM 展开)。两表 Dapper 手写(非泛型 CRUD,同采购订单);单号生成走 `IDocumentNumberGenerator`(前缀 SL),审核走通用 `IPostingEngine`。

**Tech Stack:** .NET 8 / Dapper / ASP.NET Controllers · React + TS + Ant Design · SQL Server。

**设计依据:** `docs/superpowers/specs/2026-06-25-p2-plastic-material-doc-design.md`。镜像源:`src/ErpApi/Features/Materials/PurchaseOrder/PurchaseOrderService.cs`+`PurchaseOrderController.cs`、`src/ErpApi/Features/Materials/MaterialStocktake/MaterialStocktakeController.cs`(审核/删除模式)、`web/src/pages/production/PurchaseMaterialAnalysisPage.tsx`+`PurchaseOrderDrawer.tsx`。

---

## 文件结构

| 文件 | 职责 | 新建/改 |
|---|---|---|
| `db/17_plastic_material_doc.sql` | `塑胶物料单`+`塑胶物料明细单` 建表 | 新建 |
| `db/seed_plastic_doc_perms.sql` | admin 9 位权限 | 新建 |
| `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocDtos.cs` | DTO(orders/basis/header/line/create) | 新建 |
| `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocService.cs` | orders/basis/create/get/delete | 新建 |
| `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocController.cs` | REST + 审核/反审核 + 脱敏 | 新建 |
| `src/ErpApi/Program.cs` | 注册 service | 改 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 菜单项「塑胶物料单」 | 改 |
| `tests/ErpApi.Tests/PlasticMaterialDocDbTests.cs` | service DB 测试 | 新建 |
| `web/src/api/plasticMaterialDoc.ts` | 前端 API + 类型 | 新建 |
| `web/src/pages/plastics/PlasticMaterialAnalysisPage.tsx` | 列生产单 + 开抽屉 | 新建 |
| `web/src/pages/plastics/PlasticMaterialDocDrawer.tsx` | 新建带出/保存 + 查看/审核 | 新建 |
| `web/src/App.tsx` | 路由 | 改 |
| `web/src/nav/menuTree.tsx` | ⑦塑胶采购「塑胶采购分析」落地 | 改 |

---

### Task 1: 建表脚本 + 执行

**Files:** Create `db/17_plastic_material_doc.sql`

- [ ] **Step 0: 建分支**

Run: `cd /d/WebpageERP && git checkout master && git checkout -b feat-plastic-material-doc`
Expected: `Switched to a new branch 'feat-plastic-material-doc'`

- [ ] **Step 1: 写建表脚本**

`db/17_plastic_material_doc.sql`:
```sql
-- 塑胶模块 P2:塑胶物料单(头)+ 塑胶物料明细单(明细)。按生产单货号从塑胶共用物料表带出的采购单据。
IF OBJECT_ID(N'[塑胶物料单]', N'U') IS NULL
CREATE TABLE [塑胶物料单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [日期] datetime NULL,
    [生产单号] nvarchar(50) NULL,
    [货号] nvarchar(40) NULL,
    [客户] nvarchar(50) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[塑胶物料明细单]', N'U') IS NULL
CREATE TABLE [塑胶物料明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [生产单号] nvarchar(50) NULL,
    [货号] nvarchar(40) NULL,
    [工模编号] nvarchar(30) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [仓位号] nvarchar(30) NULL,
    [用料名称] nvarchar(40) NULL,
    [加工内容] nvarchar(50) NULL,
    [加工单价] decimal(18,4) NULL,
    [用量] decimal(18,4) NULL,
    [订购数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
```

- [ ] **Step 2: 在两库执行**

```bash
cd /d/WebpageERP
for V in ERP_TEST_DB ERP_DB; do \
  powershell -NoProfile -Command "\$cs=\$env:$V; \$c=New-Object System.Data.SqlClient.SqlConnection \$cs; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=[IO.File]::ReadAllText('db/17_plastic_material_doc.sql'); \$null=\$cmd.ExecuteNonQuery(); \$c.Close(); Write-Output '$V ok'"; \
done
```
Expected: `ERP_TEST_DB ok` 和 `ERP_DB ok`。

- [ ] **Step 3: 验证两表存在**

```bash
powershell -NoProfile -Command "\$c=New-Object System.Data.SqlClient.SqlConnection \$env:ERP_TEST_DB; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=\"SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME IN (N'塑胶物料单',N'塑胶物料明细单')\"; \$cmd.ExecuteScalar(); \$c.Close()"
```
Expected: `2`

- [ ] **Step 4: Commit**

```bash
git add db/17_plastic_material_doc.sql
git commit -m "feat(塑胶物料单): 建表脚本(头+明细)"
```

---

### Task 2: DTOs

**Files:** Create `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocDtos.cs`

- [ ] **Step 1: 写 DTO**

`src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocDtos.cs`:
```csharp
namespace ErpApi.Features.Plastics.PlasticMaterialDoc;

// 塑胶采购分析·生产单行
public sealed class PlasticOrderRow
{
    public long ID { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 合同号 { get; set; }
    public string? 客户名称 { get; set; }
    public decimal? 计划数量 { get; set; }
    public DateTime? 日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 审核 { get; set; }
}

// 塑胶物料单·带出基准行(从塑胶共用物料表 JOIN 生产制单货号;仓位号来自塑胶物料资料)
public sealed class PlasticMaterialBasisRow
{
    public string? 货号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 加工内容 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 用量 { get; set; }
}

public sealed class PlasticMaterialDocHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 货号 { get; set; }
    public string? 客户 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticMaterialDocLineDto
{
    public long ID { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 加工内容 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 用量 { get; set; }
    public decimal? 订购数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticMaterialDocDetailDto
{
    public PlasticMaterialDocHeaderDto? 单头 { get; set; }
    public List<PlasticMaterialDocLineDto> 明细 { get; set; } = [];
}

public sealed class PlasticMaterialDocCreateLineDto
{
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 仓位号 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 加工内容 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 用量 { get; set; }
    public decimal 订购数量 { get; set; }
}

public sealed class PlasticMaterialDocCreateDto
{
    public string? 生产单号 { get; set; }
    public string? 货号 { get; set; }
    public string? 客户 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticMaterialDocCreateLineDto> 明细 { get; set; } = [];
}
```

- [ ] **Step 2: 编译**

```bash
taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet build src/ErpApi/ErpApi.csproj -nologo -clp:ErrorsOnly 2>&1 | tail -4
```
Expected: 0 错误(仅 exe 锁错误则重跑)。

- [ ] **Step 3: Commit**

```bash
git add src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocDtos.cs
git commit -m "feat(塑胶物料单): DTOs(orders/basis/header/line/create)"
```

---

### Task 3: Service — OrdersAsync + BasisAsync · TDD

**Files:** Create `PlasticMaterialDocService.cs`; Test `tests/ErpApi.Tests/PlasticMaterialDocDbTests.cs`

- [ ] **Step 1: 写失败测试**

`tests/ErpApi.Tests/PlasticMaterialDocDbTests.cs`:
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticMaterialDoc;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticMaterialDocDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticMaterialDocService Svc() => new(Factory(), new DocumentNumberGenerator());

    // 生产单 SLMO01(货号 SLG01) + 塑胶共用物料表两行(SLG01) + 塑胶物料资料(SLPM01 带仓位号)
    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [生产制单]([生产单号],[款号],[款式],[客户名称],[日期],[计划数量],[审核]) VALUES(N'SLMO01',N'K1',N'童装',N'TONY','2026-06-15',100,'1')");
        c.Execute("INSERT INTO [生产制单货号]([生产单号],[序号],[货号],[BOM款号],[数量]) VALUES(N'SLMO01',1,N'SLG01',N'K1',100)");
        c.Execute("INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[仓位号],[单位]) VALUES(N'SLPM01',N'ABS粒',N'A-09',N'kg')");
        c.Execute(@"INSERT INTO [塑胶共用物料表]([客户],[塑胶货号],[工模编号],[物料名称],[颜色],[用料名称],[加工内容],[加工单价],[用量],[物料编号])
            VALUES(N'TONY',N'SLG01',N'M01',N'黑壳',N'黑',N'ABS',N'注塑',5,1.5,N'SLPM01'),
                  (N'TONY',N'SLG01',N'M02',N'白壳',N'白',N'PP',N'注塑',6,2.0,N'SLPM02')");
    }
    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [塑胶物料明细单] WHERE [生产单号]=N'SLMO01'");
        c.Execute("DELETE FROM [塑胶物料单] WHERE [生产单号]=N'SLMO01'");
        c.Execute("DELETE FROM [塑胶共用物料表] WHERE [塑胶货号]=N'SLG01'");
        c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号]=N'SLPM01'");
        c.Execute("DELETE FROM [生产制单货号] WHERE [生产单号]=N'SLMO01'");
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'SLMO01'");
    }

    [SkippableFact]
    public async Task Orders_filters_by_date_and_keyword()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var page = await Svc().OrdersAsync(new DateTime(2026, 6, 1), new DateTime(2026, 6, 30), "SLMO01", 1, 20);
            Assert.Contains(page.Items, r => r.生产单号 == "SLMO01" && r.客户名称 == "TONY");
            var none = await Svc().OrdersAsync(new DateTime(2026, 7, 1), new DateTime(2026, 7, 31), "SLMO01", 1, 20);
            Assert.DoesNotContain(none.Items, r => r.生产单号 == "SLMO01");
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Basis_pulls_from_common_table_by_货号_with_仓位号()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var basis = await Svc().BasisAsync("SLMO01");
            Assert.Equal(2, basis.Count);
            var r = Assert.Single(basis, x => x.物料编号 == "SLPM01");
            Assert.Equal("SLG01", r.货号);
            Assert.Equal("M01", r.工模编号);
            Assert.Equal("A-09", r.仓位号);    // LEFT JOIN 塑胶物料资料
            Assert.Equal(5m, r.加工单价);
            Assert.Equal(1.5m, r.用量);
        }
        finally { Cleanup(c); }
    }
}
```

- [ ] **Step 2: 运行,确认失败(service 未定义)**

```bash
taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticMaterialDocDbTests" -nologo 2>&1 | tail -8
```
Expected: 编译失败,`PlasticMaterialDocService` 未定义。

- [ ] **Step 3: 写 service(orders + basis)**

`src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocService.cs`:
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticMaterialDoc;

// 塑胶物料单。两层:塑胶物料单(头) + 塑胶物料明细单(明细)。
// basis 来源:塑胶共用物料表 JOIN 生产制单货号 ON 货号=塑胶货号;仓位号 LEFT JOIN 塑胶物料资料。
// 审核/反审核由通用过账引擎处理(仅翻头表审核位)。
public sealed class PlasticMaterialDocService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "塑胶物料单";
    public const string Prefix = "SL";   // 单号 = SL + yyyyMMdd + 3位流水

    // 塑胶采购分析:列生产单(按 生产制单.日期 区间 + 关键词)。
    public async Task<PagedResult<PlasticOrderRow>> OrdersAsync(DateTime? 起, DateTime? 止, string? keyword, int page, int size)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var 止Excl = 止?.Date.AddDays(1);
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [生产制单]
WHERE (@起 IS NULL OR [日期] >= @起) AND (@止 IS NULL OR [日期] < @止)
  AND (@kw IS NULL OR [生产单号] LIKE @kw OR [款号] LIKE @kw OR [款式] LIKE @kw OR [客户名称] LIKE @kw OR [合同号] LIKE @kw);
SELECT [ID],[生产单号],[款号],[款式],[合同号],[客户名称],[计划数量],[日期],[交货日期],[审核]
FROM [生产制单]
WHERE (@起 IS NULL OR [日期] >= @起) AND (@止 IS NULL OR [日期] < @止)
  AND (@kw IS NULL OR [生产单号] LIKE @kw OR [款号] LIKE @kw OR [款式] LIKE @kw OR [客户名称] LIKE @kw OR [合同号] LIKE @kw)
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { 起, 止 = 止Excl, kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticOrderRow>()).AsList();
        return new PagedResult<PlasticOrderRow>(items, total);
    }

    // 按生产单货号从塑胶共用物料表带出塑胶用料(仓位号 LEFT JOIN 塑胶物料资料)。
    public async Task<IReadOnlyList<PlasticMaterialBasisRow>> BasisAsync(string 生产单号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticMaterialBasisRow>(@"
SELECT g.[货号], p.[工模编号], p.[物料编号], p.[物料名称], p.[颜色],
       m.[仓位号], p.[用料名称], p.[加工内容], p.[加工单价], p.[用量]
FROM [塑胶共用物料表] p
JOIN [生产制单货号] g ON g.[货号] = p.[塑胶货号]
LEFT JOIN (SELECT [物料编号], MAX([仓位号]) AS 仓位号 FROM [塑胶物料资料] GROUP BY [物料编号]) m
       ON m.[物料编号] = p.[物料编号]
WHERE g.[生产单号] = @生产单号
ORDER BY p.[ID]", new { 生产单号 });
        return rows.AsList();
    }
}
```

- [ ] **Step 4: 运行,确认通过**

```bash
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticMaterialDocDbTests" -nologo 2>&1 | tail -6
```
Expected: `已通过! ... 通过: 2`

- [ ] **Step 5: Commit**

```bash
git add src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocService.cs tests/ErpApi.Tests/PlasticMaterialDocDbTests.cs
git commit -m "feat(塑胶物料单): service orders+basis + DB测试"
```

---

### Task 4: Service — CreateAsync + GetAsync + DeleteAsync · TDD

**Files:** Modify `PlasticMaterialDocService.cs`, `tests/ErpApi.Tests/PlasticMaterialDocDbTests.cs`

- [ ] **Step 1: 追加失败测试**

在 `PlasticMaterialDocDbTests.cs` 的最后一个 `}` 之前(类内)追加:
```csharp
    [SkippableFact]
    public async Task Create_then_Get_computes_金额_and_合计_then_Delete()
    {
        using var c = fx.Open(); Seed(c);
        string? 单号 = null;
        try
        {
            var dto = new PlasticMaterialDocCreateDto
            {
                生产单号 = "SLMO01", 货号 = "SLG01", 客户 = "TONY",
                明细 = [
                    new PlasticMaterialDocCreateLineDto { 工模编号 = "M01", 物料编号 = "SLPM01", 物料名称 = "ABS粒", 颜色 = "黑", 仓位号 = "A-09", 加工单价 = 5, 用量 = 1.5m, 订购数量 = 10 },
                    new PlasticMaterialDocCreateLineDto { 工模编号 = "M02", 物料编号 = "SLPM02", 物料名称 = "PP粒", 颜色 = "白", 加工单价 = 6, 用量 = 2.0m, 订购数量 = 20 },
                ]
            };
            单号 = await Svc().CreateAsync(dto, "tester");
            Assert.StartsWith("SL", 单号);

            var detail = await Svc().GetAsync(单号);
            Assert.NotNull(detail);
            Assert.Equal(30m, detail!.单头!.数量);          // 10+20
            Assert.Equal(170m, detail.单头!.金额);          // 10*5 + 20*6
            Assert.Equal(2, detail.明细.Count);
            var l1 = Assert.Single(detail.明细, x => x.物料编号 == "SLPM01");
            Assert.Equal(50m, l1.金额);                     // 10*5
            Assert.Equal("A-09", l1.仓位号);

            Assert.True(await Svc().DeleteAsync(单号));
            Assert.Null(await Svc().GetAsync(单号));
            单号 = null;
        }
        finally
        {
            if (单号 != null) { c.Execute("DELETE FROM [塑胶物料明细单] WHERE [单号]=@n", new { n = 单号 }); c.Execute("DELETE FROM [塑胶物料单] WHERE [单号]=@n", new { n = 单号 }); }
            Cleanup(c);
        }
    }

    [SkippableFact]
    public async Task Create_rejects_empty_lines()
    {
        using var c = fx.Open();
        await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(
            new PlasticMaterialDocCreateDto { 生产单号 = "SLMO01", 明细 = [] }, "tester"));
    }
```

- [ ] **Step 2: 运行,确认失败(CreateAsync 未定义)**

```bash
taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticMaterialDocDbTests" -nologo 2>&1 | tail -8
```
Expected: 编译失败,`CreateAsync`/`GetAsync`/`DeleteAsync` 未定义。

- [ ] **Step 3: 追加 create/get/delete**

在 `PlasticMaterialDocService.cs` 类内 `BasisAsync` 方法之后追加:
```csharp
    // 保存成单:生成 SL 单号,插头(数量/金额合计)+ 逐行插明细(金额=订购数量×加工单价)。
    public async Task<string> CreateAsync(PlasticMaterialDocCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("塑胶物料单至少要有一行明细");
        var 数量合计 = dto.明细.Sum(l => l.订购数量);
        var 金额合计 = dto.明细.Sum(l => l.订购数量 * (l.加工单价 ?? 0));
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [塑胶物料单]([单号],[日期],[生产单号],[货号],[客户],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@生产单号,@货号,@客户,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.生产单号, dto.货号, dto.客户,
                  数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [塑胶物料明细单]([单号],[生产单号],[货号],[工模编号],[物料编号],[物料名称],[颜色],[仓位号],[用料名称],[加工内容],[加工单价],[用量],[订购数量],[金额])
VALUES(@单号,@生产单号,@货号,@工模编号,@物料编号,@物料名称,@颜色,@仓位号,@用料名称,@加工内容,@加工单价,@用量,@订购数量,@金额)",
                new { 单号, dto.生产单号, dto.货号, l.工模编号, l.物料编号, l.物料名称, l.颜色, l.仓位号,
                      l.用料名称, l.加工内容, l.加工单价, l.用量, l.订购数量, 金额 = l.订购数量 * (l.加工单价 ?? 0) }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PlasticMaterialDocDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[生产单号],[货号],[客户],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [塑胶物料单] WHERE [单号]=@单号;
SELECT [ID],[工模编号],[物料编号],[物料名称],[颜色],[仓位号],[用料名称],[加工内容],[加工单价],[用量],[订购数量],[金额],[备注]
FROM [塑胶物料明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticMaterialDocHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticMaterialDocLineDto>()).AsList();
        return new PlasticMaterialDocDetailDto { 单头 = header, 明细 = lines };
    }

    // 删除:仅未审核可删;FK 顺序 明细→头。
    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [塑胶物料单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的塑胶物料单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [塑胶物料明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [塑胶物料单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
```

- [ ] **Step 4: 运行,确认通过**

```bash
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~PlasticMaterialDocDbTests" -nologo 2>&1 | tail -6
```
Expected: `已通过! ... 通过: 4`

- [ ] **Step 5: Commit**

```bash
git add src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocService.cs tests/ErpApi.Tests/PlasticMaterialDocDbTests.cs
git commit -m "feat(塑胶物料单): service create+get+delete + DB测试"
```

---

### Task 5: Controller + DI

**Files:** Create `PlasticMaterialDocController.cs`; Modify `Program.cs`

- [ ] **Step 1: 写控制器**

`src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocController.cs`:
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticMaterialDoc;

[ApiController]
[Authorize]
[Route("api/plastic-material-docs")]
public sealed class PlasticMaterialDocController(
    PlasticMaterialDocService svc, IPostingEngine posting, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶物料单";
    private const string Table = "塑胶物料单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);

    [HttpGet("orders")]
    public async Task<IActionResult> Orders(DateTime? 起 = null, DateTime? 止 = null, string? keyword = null, int page = 1, int size = 20)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.OrdersAsync(起, 止, keyword, page, size));
    }

    [HttpGet("basis")]
    public async Task<IActionResult> Basis([FromQuery(Name = "生产单号")] string 生产单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var rows = await svc.BasisAsync(生产单号);
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in rows) r.加工单价 = null;
        return Ok(rows);
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号);
        if (d is null) return NotFound();
        if (!await AllowAsync(PermissionAction.单价))
        {
            if (d.单头 is not null) d.单头.金额 = null;
            foreach (var l in d.明细) { l.加工单价 = null; l.金额 = null; }
        }
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] PlasticMaterialDocCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        return CreatedAtAction(nameof(Get), new { 单号 }, new { 单号 });
    }

    [HttpDelete("{单号}")]
    public async Task<IActionResult> Delete(string 单号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try { if (!await svc.DeleteAsync(单号)) return NotFound(); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
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
注:`IPostingEngine` 在 `ErpApi.Engines.Posting`。确认 `posting.ApproveAsync(table,单号,user)` 签名与 `MaterialStocktakeController` 一致(它就是这么调的)。

- [ ] **Step 2: 注册 DI**

`src/ErpApi/Program.cs` —— 在 `builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticCommonMaterial.PlasticCommonMaterialService>();`(P1 加的)之后加:
```csharp
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticMaterialDoc.PlasticMaterialDocService>();
```

- [ ] **Step 3: 编译**

```bash
taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet build src/ErpApi/ErpApi.csproj -nologo -clp:ErrorsOnly 2>&1 | tail -5
```
Expected: 0 错误。若 `IPostingEngine`/`ApproveAsync` 签名不符,照 `MaterialStocktakeController.cs` 的实际用法修正(它注入 `IPostingEngine posting` 并 `posting.ApproveAsync(Table, 单号, CurrentUser)`)。

- [ ] **Step 4: Commit**

```bash
git add src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocController.cs src/ErpApi/Program.cs
git commit -m "feat(塑胶物料单): REST控制器(orders/basis/create/get/delete/审核)+DI"
```

---

### Task 6: 菜单 + 权限种子

**Files:** Modify `MenuCatalog.cs`; Create `db/seed_plastic_doc_perms.sql`

- [ ] **Step 1: MenuCatalog 加菜单项**

`src/ErpApi/Features/Admin/MenuCatalog.cs` —— 在 `new("塑胶仓储","塑胶共用物料表"),`(P1 加的)之后加:
```csharp
        new("塑胶采购","塑胶物料单"),
```

- [ ] **Step 2: 写权限种子**

`db/seed_plastic_doc_perms.sql`:
```sql
-- 开发用:给某用户授予 塑胶物料单 菜单的 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'塑胶物料单');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'塑胶物料单',1,1,1,1,1,1,1,1,1);
```

- [ ] **Step 3: 执行种子**

```bash
cd /d/WebpageERP
powershell -NoProfile -Command "\$c=New-Object System.Data.SqlClient.SqlConnection \$env:ERP_DB; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=[IO.File]::ReadAllText('db/seed_plastic_doc_perms.sql'); \$null=\$cmd.ExecuteNonQuery(); \$c.Close(); Write-Output 'perms seeded'"
```
Expected: `perms seeded`

- [ ] **Step 4: 编译**

```bash
taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet build src/ErpApi/ErpApi.csproj -nologo -clp:ErrorsOnly 2>&1 | tail -4
```
Expected: 0 错误。

- [ ] **Step 5: Commit**

```bash
git add src/ErpApi/Features/Admin/MenuCatalog.cs db/seed_plastic_doc_perms.sql
git commit -m "feat(塑胶物料单): MenuCatalog菜单项+权限种子"
```

---

### Task 7: 前端 API + 塑胶采购分析页 + 路由 + 菜单

**Files:** Create `web/src/api/plasticMaterialDoc.ts`, `web/src/pages/plastics/PlasticMaterialAnalysisPage.tsx`; Modify `App.tsx`, `menuTree.tsx`

- [ ] **Step 1: 写前端 API**

`web/src/api/plasticMaterialDoc.ts`:
```typescript
import { api } from "./client";
import type { Paged } from "./master";

export interface PlasticOrderRow {
  ID: number; 生产单号?: string; 款号?: string; 款式?: string; 合同号?: string;
  客户名称?: string; 计划数量?: number | null; 日期?: string; 交货日期?: string; 审核?: string;
}
export interface PlasticMaterialBasisRow {
  货号?: string; 工模编号?: string; 物料编号?: string; 物料名称?: string; 颜色?: string;
  仓位号?: string; 用料名称?: string; 加工内容?: string; 加工单价?: number | null; 用量?: number | null;
}
export interface PlasticMaterialDocHeader {
  ID: number; 单号?: string; 日期?: string; 生产单号?: string; 货号?: string; 客户?: string;
  数量?: number | null; 金额?: number | null; 操作员?: string; 审核?: string; 审核人?: string; 备注?: string;
}
export interface PlasticMaterialDocLine {
  ID: number; 工模编号?: string; 物料编号?: string; 物料名称?: string; 颜色?: string; 仓位号?: string;
  用料名称?: string; 加工内容?: string; 加工单价?: number | null; 用量?: number | null;
  订购数量?: number | null; 金额?: number | null; 备注?: string;
}
export interface PlasticMaterialDocDetail { 单头?: PlasticMaterialDocHeader; 明细: PlasticMaterialDocLine[] }

export interface PlasticDocCreateLine {
  工模编号?: string; 物料编号?: string; 物料名称?: string; 颜色?: string; 仓位号?: string;
  用料名称?: string; 加工内容?: string; 加工单价?: number | null; 用量?: number | null; 订购数量: number;
}
export interface PlasticDocCreate {
  生产单号?: string; 货号?: string; 客户?: string; 备注?: string; 明细: PlasticDocCreateLine[];
}

const enc = encodeURIComponent;
export const plasticMaterialDocApi = {
  orders: (起?: string, 止?: string, keyword?: string, page = 1, size = 50) =>
    api.get<Paged<PlasticOrderRow>>("/plastic-material-docs/orders", { params: { 起, 止, keyword, page, size } }).then(r => r.data),
  basis: (生产单号: string) =>
    api.get<PlasticMaterialBasisRow[]>("/plastic-material-docs/basis", { params: { 生产单号 } }).then(r => r.data),
  create: (body: PlasticDocCreate) =>
    api.post<{ 单号: string }>("/plastic-material-docs", body).then(r => r.data),
  get: (单号: string) =>
    api.get<PlasticMaterialDocDetail>(`/plastic-material-docs/${enc(单号)}`).then(r => r.data),
  approve: (单号: string) => api.post(`/plastic-material-docs/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/plastic-material-docs/${enc(单号)}/unapprove`),
  remove: (单号: string) => api.delete(`/plastic-material-docs/${enc(单号)}`),
};
```

- [ ] **Step 2: 写塑胶采购分析页**

`web/src/pages/plastics/PlasticMaterialAnalysisPage.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, DatePicker, Input, Space, Table, Tag, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { plasticMaterialDocApi, type PlasticOrderRow } from "../../api/plasticMaterialDoc";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import PlasticMaterialDocDrawer from "./PlasticMaterialDocDrawer";

const MENU = "塑胶物料单";
const d10 = (v?: string) => v?.slice(0, 10);
const thisMonth = (): [Dayjs, Dayjs] => [dayjs().startOf("month"), dayjs().endOf("month")];

export default function PlasticMaterialAnalysisPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");

  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(thisMonth);
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<PlasticOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [生产单号, set生产单号] = useState<string | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = useCallback(async (p: number) => {
    if (!canOpen) return;
    setLoading(true);
    try {
      const r = await plasticMaterialDocApi.orders(
        range?.[0]?.format("YYYY-MM-DD"), range?.[1]?.format("YYYY-MM-DD"),
        keyword.trim() || undefined, p, 50);
      setRows(r.items); setTotal(r.total);
    } catch { message.error("加载生产单失败"); }
    finally { setLoading(false); }
  }, [canOpen, range, keyword]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(1); setPage(1); }, [canOpen]);

  const jumpMonth = (off: number) => {
    const b = dayjs().add(off, "month");
    setRange([b.startOf("month"), b.endOf("month")]);
  };
  const search = () => { setPage(1); load(1); };
  const openDrawer = (no?: string) => { if (no) { set生产单号(no); setDrawerOpen(true); } };

  const 审核Tag = (v?: string) => v === "1" ? <Tag color="green">已审核</Tag> : <Tag>未审核</Tag>;
  const columns = [
    { title: "制单日期", dataIndex: "日期", width: 110, render: d10 },
    { title: "交货日期", dataIndex: "交货日期", width: 110, render: d10 },
    { title: "生产单号", dataIndex: "生产单号", width: 140, render: (v: string) => <a className="erp-num">{v}</a> },
    { title: "款号", dataIndex: "款号", width: 110 },
    { title: "款式", dataIndex: "款式", width: 140 },
    { title: "客户", dataIndex: "客户名称", width: 120 },
    { title: "合同号", dataIndex: "合同号", width: 110 },
    { title: "计划数量", dataIndex: "计划数量", width: 90, align: "right" as const },
    { title: "审核", dataIndex: "审核", width: 90, align: "center" as const, render: 审核Tag },
  ];

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"塑胶物料单·打开"权限）。</div></Card>;
  }

  return (
    <Card title="塑胶采购分析" variant="borderless">
      <Space style={{ marginBottom: 12 }} wrap>
        <Button.Group>
          <Button onClick={() => jumpMonth(-1)}>上月</Button>
          <Button onClick={() => jumpMonth(0)}>本月</Button>
          <Button onClick={() => jumpMonth(1)}>下月</Button>
        </Button.Group>
        <DatePicker.RangePicker value={range ?? undefined}
          onChange={v => setRange(v as [Dayjs | null, Dayjs | null] | null)} />
        <Input.Search placeholder="生产单号/款号/款式/客户/合同号" allowClear style={{ width: 260 }}
          value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={search} />
        <Button type="primary" onClick={search}>查询</Button>
      </Space>
      <Table
        size="small" rowKey="ID" loading={loading} dataSource={rows} columns={columns} scroll={{ x: 1100 }}
        pagination={{ current: page, pageSize: 50, total, showSizeChanger: false,
          onChange: p => { setPage(p); load(p); }, showTotal: t => `共 ${t} 条` }}
        onRow={r => ({ onClick: () => openDrawer(r.生产单号), style: { cursor: "pointer" } })}
      />
      <PlasticMaterialDocDrawer open={drawerOpen} 生产单号={生产单号}
        onClose={() => setDrawerOpen(false)} onSaved={() => load(page)} />
    </Card>
  );
}
```

- [ ] **Step 3: 路由 + 菜单**

`web/src/App.tsx` —— import 区加:
```tsx
import PlasticMaterialAnalysisPage from "./pages/plastics/PlasticMaterialAnalysisPage";
```
路由区(其它 plastic 路由旁)加:
```tsx
          <Route path="plastic-material-analysis" element={<PlasticMaterialAnalysisPage />} />
```
`web/src/nav/menuTree.tsx` —— ⑦塑胶采购 把 `M("塑胶采购分析")` 改为:
```tsx
    M("塑胶采购分析", "/plastic-material-analysis", "塑胶物料单"),
```

- [ ] **Step 4: Commit**(此时抽屉未建,tsc 会报缺 `./PlasticMaterialDocDrawer`,Task 8 补;先不跑 tsc,仅提交)

```bash
cd /d/WebpageERP
git add web/src/api/plasticMaterialDoc.ts web/src/pages/plastics/PlasticMaterialAnalysisPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m "feat(塑胶物料单): 前端API+塑胶采购分析页+路由+菜单"
```

---

### Task 8: 前端 塑胶物料单抽屉

**Files:** Create `web/src/pages/plastics/PlasticMaterialDocDrawer.tsx`

- [ ] **Step 1: 写抽屉(新建带出/保存 + 查看/审核/反审核/删除)**

`web/src/pages/plastics/PlasticMaterialDocDrawer.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Descriptions, Drawer, InputNumber, Popconfirm, Space, Table, Tag, message } from "antd";
import { CheckOutlined, CloseOutlined, DeleteOutlined, SaveOutlined } from "@ant-design/icons";
import {
  plasticMaterialDocApi,
  type PlasticMaterialBasisRow, type PlasticMaterialDocDetail,
} from "../../api/plasticMaterialDoc";
import { can, hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "塑胶物料单";
const d10 = (v?: string) => v?.slice(0, 10);
const errMsg = (e: unknown) => (e as { response?: { data?: { 消息?: string } } }).response?.data?.消息;

let seq = 1;
const uid = () => seq++;
interface EditRow extends PlasticMaterialBasisRow { key: number; 订购数量?: number }

export default function PlasticMaterialDocDrawer({ open, 生产单号, 单号, onClose, onSaved }: {
  open: boolean; 生产单号?: string; 单号?: string; onClose: () => void; onSaved?: () => void;
}) {
  const perms = usePerms();
  const priceHidden = hidePrice(perms, MENU);
  const money = (v?: number | null) => (priceHidden ? "***" : (v ?? ""));

  const [currentNo, setCurrentNo] = useState<string | undefined>(单号);
  const isView = !!currentNo;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [detail, setDetail] = useState<PlasticMaterialDocDetail | null>(null);

  const loadView = useCallback(async (no: string) => {
    setLoading(true);
    try { setDetail(await plasticMaterialDocApi.get(no)); }
    catch { message.error("加载塑胶物料单失败"); }
    finally { setLoading(false); }
  }, []);

  const loadBasis = useCallback(async (mo: string) => {
    setLoading(true);
    try {
      const basis = await plasticMaterialDocApi.basis(mo);
      setRows(basis.map(b => ({ ...b, key: uid(), 订购数量: Number(b.用量 ?? 0) })));
    } catch { message.error("加载塑胶物料分析失败"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!open) return;
    setDetail(null); setRows([]);
    if (单号) { setCurrentNo(单号); loadView(单号); }
    else if (生产单号) { setCurrentNo(undefined); loadBasis(生产单号); }
  }, [open, 单号, 生产单号, loadView, loadBasis]);

  const setQty = (key: number, v: number) =>
    setRows(rs => rs.map(r => (r.key === key ? { ...r, 订购数量: v } : r)));

  const save = async () => {
    const lines = rows.filter(r => Number(r.订购数量) > 0).map(r => ({
      工模编号: r.工模编号, 物料编号: r.物料编号, 物料名称: r.物料名称, 颜色: r.颜色, 仓位号: r.仓位号,
      用料名称: r.用料名称, 加工内容: r.加工内容, 加工单价: r.加工单价 ?? undefined, 用量: r.用量 ?? undefined,
      订购数量: Number(r.订购数量),
    }));
    if (lines.length === 0) { message.error("请至少录入一行订购数量>0的明细"); return; }
    setSaving(true);
    try {
      const first = rows[0];
      const r = await plasticMaterialDocApi.create({ 生产单号, 货号: first?.货号, 明细: lines });
      message.success(`塑胶物料单已创建：${r.单号}`);
      setCurrentNo(r.单号); loadView(r.单号); onSaved?.();
    } catch (e) { message.error(errMsg(e) ?? "保存失败"); }
    finally { setSaving(false); }
  };

  const act = async (fn: () => Promise<unknown>, ok: string, after: "reload" | "close") => {
    try {
      await fn(); message.success(ok); onSaved?.();
      if (after === "close") onClose();
      else if (currentNo) await loadView(currentNo);
    } catch (e) { message.error(errMsg(e) ?? "操作失败"); }
  };

  const 审核 = detail?.单头?.审核;
  const 审核Tag = (v?: string) => v === "1" ? <Tag color="green">已审核</Tag> : <Tag>未审核</Tag>;

  const editColumns = [
    { title: "序号", width: 56, render: (_: unknown, __: EditRow, i: number) => i + 1 },
    { title: "工模编号", dataIndex: "工模编号", width: 90 },
    { title: "物料编号", dataIndex: "物料编号", width: 110 },
    { title: "物料名称", dataIndex: "物料名称", width: 130 },
    { title: "颜色", dataIndex: "颜色", width: 70 },
    { title: "仓位号", dataIndex: "仓位号", width: 80 },
    { title: "用料名称", dataIndex: "用料名称", width: 100 },
    { title: "加工内容", dataIndex: "加工内容", width: 100 },
    ...(priceHidden ? [] : [{ title: "加工单价", dataIndex: "加工单价", width: 90, align: "right" as const, render: (v?: number | null) => v ?? "" }]),
    { title: "用量", dataIndex: "用量", width: 80, align: "right" as const, render: (v?: number | null) => v ?? "" },
    {
      title: "订购数量", dataIndex: "订购数量", width: 120, align: "right" as const,
      render: (v: number | undefined, r: EditRow) =>
        <InputNumber min={0} value={v} style={{ width: "100%" }} onChange={n => setQty(r.key, Number(n ?? 0))} />,
    },
    ...(priceHidden ? [] : [{
      title: "金额", width: 100, align: "right" as const,
      render: (_: unknown, r: EditRow) => (Number(r.订购数量) || 0) * (Number(r.加工单价) || 0),
    }]),
  ];

  const viewColumns = [
    { title: "工模编号", dataIndex: "工模编号", width: 90 },
    { title: "物料编号", dataIndex: "物料编号", width: 110 },
    { title: "物料名称", dataIndex: "物料名称", width: 130 },
    { title: "颜色", dataIndex: "颜色", width: 70 },
    { title: "仓位号", dataIndex: "仓位号", width: 80 },
    { title: "用料名称", dataIndex: "用料名称", width: 100 },
    { title: "加工内容", dataIndex: "加工内容", width: 100 },
    ...(priceHidden ? [] : [{ title: "加工单价", dataIndex: "加工单价", width: 90, align: "right" as const, render: money }]),
    { title: "用量", dataIndex: "用量", width: 80, align: "right" as const, render: (v?: number | null) => v ?? "" },
    { title: "订购数量", dataIndex: "订购数量", width: 90, align: "right" as const, render: (v?: number | null) => v ?? "" },
    ...(priceHidden ? [] : [{ title: "金额", dataIndex: "金额", width: 100, align: "right" as const, render: money }]),
  ];

  const editTotal = rows.reduce((s, r) => s + (Number(r.订购数量) || 0) * (Number(r.加工单价) || 0), 0);
  const h = detail?.单头;

  const toolbar = (
    <Space wrap>
      {!isView && can(perms, MENU, "保存") && (
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>保存</Button>
      )}
      {isView && 审核 !== "1" && can(perms, MENU, "审核") && (
        <Button icon={<CheckOutlined />} onClick={() => act(() => plasticMaterialDocApi.approve(currentNo!), "已审核", "reload")}>审核</Button>
      )}
      {isView && 审核 === "1" && can(perms, MENU, "反审核") && (
        <Button icon={<CloseOutlined />} onClick={() => act(() => plasticMaterialDocApi.unapprove(currentNo!), "已反审核", "reload")}>反审核</Button>
      )}
      {isView && 审核 !== "1" && can(perms, MENU, "删除") && (
        <Popconfirm title="确认删除该塑胶物料单?" onConfirm={() => act(() => plasticMaterialDocApi.remove(currentNo!), "已删除", "close")}>
          <Button danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      )}
    </Space>
  );

  return (
    <Drawer title={`塑胶物料单${currentNo ? ` · ${currentNo}` : "（新建）"}`} width={1080} open={open} onClose={onClose} loading={loading} extra={toolbar}>
      {isView ? (
        h && (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions size="small" column={3} bordered>
              <Descriptions.Item label="单号">{h.单号}</Descriptions.Item>
              <Descriptions.Item label="日期">{d10(h.日期)}</Descriptions.Item>
              <Descriptions.Item label="审核">{审核Tag(h.审核)}</Descriptions.Item>
              <Descriptions.Item label="生产单号">{h.生产单号}</Descriptions.Item>
              <Descriptions.Item label="货号">{h.货号}</Descriptions.Item>
              <Descriptions.Item label="客户">{h.客户}</Descriptions.Item>
              <Descriptions.Item label="数量">{h.数量}</Descriptions.Item>
              <Descriptions.Item label="金额">{money(h.金额)}</Descriptions.Item>
              <Descriptions.Item label="操作员">{h.操作员}</Descriptions.Item>
            </Descriptions>
            <Table size="small" rowKey="ID" pagination={false} scroll={{ x: true }} dataSource={detail?.明细 ?? []} columns={viewColumns} />
          </Space>
        )
      ) : (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Descriptions size="small" column={3} bordered>
            <Descriptions.Item label="生产单号">{生产单号}</Descriptions.Item>
            <Descriptions.Item label="货号">{rows[0]?.货号 ?? "-"}</Descriptions.Item>
            <Descriptions.Item label="明细行数">{rows.length}</Descriptions.Item>
          </Descriptions>
          <Table size="small" rowKey="key" pagination={false} scroll={{ x: true }} dataSource={rows} columns={editColumns} />
          {!priceHidden && <div style={{ textAlign: "right", fontWeight: 600 }}>金额合计：{editTotal}</div>}
        </Space>
      )}
    </Drawer>
  );
}
```

- [ ] **Step 2: 类型检查 + 测试**

```bash
cd /d/WebpageERP/web && npx tsc --noEmit 2>&1 | head -20 && echo "=== test ===" && npm test 2>&1 | tail -6
```
Expected: tsc 无输出;vitest 54 全过。修 YOUR 文件 tsc 报错。

- [ ] **Step 3: Commit**

```bash
cd /d/WebpageERP
git add web/src/pages/plastics/PlasticMaterialDocDrawer.tsx
git commit -m "feat(塑胶物料单): 前端单据抽屉(带出/保存/查看/审核/删除)"
```

---

### Task 9: 全量验证 + 冒烟 + 收尾

- [ ] **Step 1: 后端全量测试**

```bash
taskkill //F //IM ErpApi.exe 2>/dev/null; cd /d/WebpageERP && dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj -nologo 2>&1 | tail -5
```
Expected: 全过(335 + 4 = 339,无回归)。

- [ ] **Step 2: 启动后端 + 冒烟(orders/basis/create/get/approve)**

```bash
cd /d/WebpageERP
nohup dotnet run --project src/ErpApi/ErpApi.csproj --no-build > /tmp/be_p2.log 2>&1 &
sleep 9
echo '{"用户":"admin","密码":"admin123"}' > /tmp/login.json
TOK=$(curl -s --noproxy '*' -X POST http://localhost:5000/api/auth/login -H "Content-Type: application/json" --data @/tmp/login.json | python -c "import sys,json; d=json.load(sys.stdin); print(next(v for v in d.values() if isinstance(v,str) and v.startswith('eyJ')))")
echo "=== orders ==="; curl -s --noproxy '*' "http://localhost:5000/api/plastic-material-docs/orders" -H "Authorization: Bearer $TOK" -w "\nHTTP %{http_code}\n" | head -c 150
# 用测试种子(若 ERP_DB 无 SLMO01,先建一行生产单+货号+共用物料表;否则 basis 为空属正常)
echo "=== create(空明细应400) ==="; echo '{"生产单号":"SLMO01","明细":[]}' > /tmp/d.json
curl -s --noproxy '*' -X POST "http://localhost:5000/api/plastic-material-docs" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" --data @/tmp/d.json -w "\nHTTP %{http_code}\n" | head -c 150
echo "=== create(1行) ==="; echo '{"生产单号":"SLSMOKE","货号":"SLGSMOKE","明细":[{"物料编号":"X","加工单价":5,"订购数量":10}]}' > /tmp/d2.json
RESP=$(curl -s --noproxy '*' -X POST "http://localhost:5000/api/plastic-material-docs" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" --data @/tmp/d2.json -w "\nHTTP %{http_code}")
echo "$RESP" | head -c 200
```
Expected: orders 200;空明细 create 400(消息含"至少要有一行");1行 create 201(返回 SL... 单号)。

- [ ] **Step 3: 清理冒烟数据**

```bash
powershell -NoProfile -Command "\$c=New-Object System.Data.SqlClient.SqlConnection \$env:ERP_DB; \$c.Open(); \$cmd=\$c.CreateCommand(); \$cmd.CommandText=\"DELETE FROM [塑胶物料明细单] WHERE [生产单号]=N'SLSMOKE'; DELETE FROM [塑胶物料单] WHERE [生产单号]=N'SLSMOKE'\"; \$null=\$cmd.ExecuteNonQuery(); \$c.Close(); Write-Output 'cleaned'"
```
Expected: `cleaned`

- [ ] **Step 4: 前端 lint 新文件**

```bash
cd /d/WebpageERP/web && npx eslint src/pages/plastics/PlasticMaterialAnalysisPage.tsx src/pages/plastics/PlasticMaterialDocDrawer.tsx src/api/plasticMaterialDoc.ts 2>&1 | tail -12
```
Expected:仅 `react-hooks/set-state-in-effect`/`exhaustive-deps` 类与克隆源(PurchaseOrderDrawer/PurchaseMaterialAnalysisPage)相同的基线惯例,无新类型错误。

- [ ] **Step 5: 合并 master**

```bash
cd /d/WebpageERP
git checkout master
git merge --no-ff feat-plastic-material-doc -m "Merge branch 'feat-plastic-material-doc' into master"
git log --oneline -2
git branch -d feat-plastic-material-doc
```
Expected: 合并成功,分支删除。

- [ ] **Step 6: worklog + 记忆**

写 `docs/worklogs/2026-06-25-plastic-material-doc.md`;更新 `erp-plastic-module-p0-0625.md`(标 P2 完成)+ `MEMORY.md` 索引。

---

## 自检

**Spec 覆盖:** ① 两表→Task1;② DTO→Task2,orders/basis→Task3,create/get/delete→Task4,控制器+审核→Task5,权限→Task6;③ 前端 api+分析页→Task7,抽屉→Task8;④ 测试→Task3/4+Task9;⑤ 验收 1-5→Task9 冒烟。无遗漏。

**占位扫描:** 无 TBD;每个写代码步骤都给完整代码;db/17 序号已定;DI/MenuCatalog/菜单 锚点具体。Task7 提交时抽屉未建(tsc 暂缺引用),Task8 补齐后 tsc 干净——已在 Task7 Step4 注明。

**类型一致:** service `OrdersAsync(起,止,keyword,page,size)`/`BasisAsync(生产单号)`/`CreateAsync(dto,user)`/`GetAsync(单号)`/`DeleteAsync(单号)` 在 Task3/4 定义、Task5 控制器调用一致;DTO 字段(PlasticOrderRow/PlasticMaterialBasisRow/Header/Line/Create)后端(Task2)与前端(Task7)一致;金额=订购数量×加工单价 在 service(Task4)与前端抽屉(Task8 editColumns/editTotal)一致;单号前缀 `SL`、DocType `塑胶物料单`、菜单/权限名 `塑胶物料单` 三处统一;审核走 `posting.ApproveAsync("塑胶物料单",单号,user)`(Task5,同 MaterialStocktakeController)。
