# 进度明细表（采购管理）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在采购管理下新增只读「进度明细表」：一行=一条已审核入仓明细（订单行×该次入仓），未入仓订单行也列一行（入仓列空）；点行内任意单元格打开该行所属采购订单（复用现有抽屉）。

**Architecture:** 后端在现有 `PurchaseOrderService`/`PurchaseOrderController` 加 `ProgressDetailAsync` + `GET /api/purchase-orders/progress-detail`；订单明细 LEFT JOIN 已审核入仓明细（不聚合，按 订单单号+物料编号+颜色 关联），展开为每条入仓一行、零入仓订单行留空。前端新增 `ProgressDetailPage`，接 menuTree 路由，权限复用「采购订单」。与已完成的「订单进度表」同源同模式（见 `docs/superpowers/specs/2026-06-11-order-progress-design.md` 与 `web/src/pages/production/OrderProgressPage.tsx`）。依据 `docs/superpowers/specs/2026-06-11-progress-detail-design.md`。

**Tech Stack:** .NET 8 ASP.NET Core, Dapper, SQL Server LocalDB (erp/erp_test, Chinese_PRC_CI_AS), xUnit + Xunit.SkippableFact + WebApplicationFactory, React 18 + TS + Vite + Ant Design v6。

---

## 前置约定

- 工作目录 `D:\WebpageERP`，已在分支 `feat-progress-detail`。Windows PowerShell；`dotnet` 不在 PATH 时刷新：`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 测试环境变量（shell 为空时）：`$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")`、`$env:ERP_JWT_KEY = [Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")`。
- 跑后端测试：`dotnet test`；单类 `dotnet test --filter "FullyQualifiedName~ProgressDetailDbTests"`。前端：`npm --prefix web run build`、`npm --prefix web run test`。
- 提交规范：commit 末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。git 报 LF→CRLF 警告正常。
- 权限：本页复用菜单「采购订单」，admin 已由 `db/seed_purchase_order_perms.sql` 授权，**无需新增 seed**。
- **关键 FK（种子需先种父行，反序清理）**：`采购订单.供应商编号 → 供应商资料.供应商编号`（FK_209）；`采购明细单.物料编号 → 物料资料.物料编号`（FK_207）；`采购明细单.生产单号 → 生产制单.生产单号`（可空，种子留 NULL 不填该列）。入仓两表对 物料/订单 无强制 FK（订单单号/物料编号 在入仓明细上不设 FK）。
- 现有可复用件：`PurchaseOrderService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)`（已有 `ProgressAsync`，本计划加 `ProgressDetailAsync`）；前端 `PurchaseOrderDrawer`（props `open`/`单号`/`onClose`，传 `单号` 即查看态）、`usePerms()`、`can(perms, menu, action)`。前端页范本 `web/src/pages/production/OrderProgressPage.tsx`。

### 相关表真实列（以 `db/01_rebuild_schema.sql` 为准）

- `采购订单`：单号, 日期, 交货日期, 供应商编号, 供应商名称, 操作员, 审核 …
- `采购明细单`：单号(→采购订单), 生产单号, 款号, 物料类别, 物料编号, 物料名称, 规格, 颜色, 单位, **数量(订购数量)**, 日期(订购日期), 交货日期, ID …
- `采购入仓明细单`：**单号(=入仓单号)**, 订单单号, 物料编号, 颜色, **数量(入仓数量)** …
- `采购入仓单`：单号, **日期(=入仓日期)**, 审核

---

## 文件结构

```
src/ErpApi/Features/Materials/PurchaseOrder/
├─ PurchaseOrderDtos.cs        改:+PurchaseOrderProgressDetailRow
├─ PurchaseOrderService.cs     改:+ProgressDetailAsync
└─ PurchaseOrderController.cs  改:+[HttpGet("progress-detail")]

tests/ErpApi.Tests/
├─ ProgressDetailDbTests.cs     新:展开口径(多次入仓多行/未入仓留空·只认审核·状态过滤·颜色)
└─ ProgressDetailApiTests.cs    新:progress-detail 端点(权限+返回形状)

web/src/
├─ api/purchaseOrders.ts        改:+progressDetail() + 类型
├─ pages/production/ProgressDetailPage.tsx   新:筛选条(含状态)+表格+点行开抽屉
├─ nav/menuTree.tsx            改:进度明细表→/order-progress-detail
└─ App.tsx                     改:+/order-progress-detail 路由
```

---

## Task 1: 后端 ProgressDetailAsync + DTO + DbTest

明细级查询核心。订单明细 LEFT JOIN 已审核入仓明细（不聚合），每条入仓一行、零入仓订单行留空；`状态` 过滤 已入仓/未入仓/全部。

**Files:**
- Modify: `src/ErpApi/Features/Materials/PurchaseOrder/PurchaseOrderDtos.cs`, `src/ErpApi/Features/Materials/PurchaseOrder/PurchaseOrderService.cs`
- Test: `tests/ErpApi.Tests/ProgressDetailDbTests.cs`

- [ ] **Step 1: 加 DTO**

在 `PurchaseOrderDtos.cs` 末尾追加：

```csharp
// 进度明细行：一条订单明细 × 一次已审核入仓（未入仓则入仓列为 null）
public sealed class PurchaseOrderProgressDetailRow
{
    public DateTime? 订购日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 采购单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 订购数量 { get; set; }
    public string? 入仓单号 { get; set; }
    public decimal? 入仓数量 { get; set; }
    public DateTime? 入仓日期 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
}
```

- [ ] **Step 2: 写失败的 DbTest**

Create `tests/ErpApi.Tests/ProgressDetailDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Materials.PurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class ProgressDetailDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PurchaseOrderService Svc() => new(Factory(), new DocumentNumberGenerator());

    // 订单 PDORD1：物料 PDMA(有2次已审核入仓+1次未审核) / 物料 PDMB(零入仓)
    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'PDSUP',N'明细测试供应商')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'PDMA',N'明细料A',N'规A',N'米'),(N'PDMB',N'明细料B',N'规B',N'个')");
        c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[供应商编号],[供应商名称],[操作员],[审核])
                    VALUES(N'PDORD1', SYSDATETIME(), N'PDSUP', N'明细测试供应商', N'tester', '1')");
        c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[物料编号],[物料名称],[规格],[颜色],[单位],[数量])
                    VALUES(N'PDORD1',SYSDATETIME(),N'PDMA',N'明细料A',N'规A',N'红',N'米',100),
                          (N'PDORD1',SYSDATETIME(),N'PDMB',N'明细料B',N'规B',N'红',N'个',50)");
        // 物料A 两次已审核入仓：RKA1(30,日期03-10)、RKA2(20,日期03-12)
        c.Execute("INSERT INTO [采购入仓单]([单号],[日期],[审核]) VALUES(N'RKA1','2026-03-10','1'),(N'RKA2','2026-03-12','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[物料编号],[颜色],[数量])
                    VALUES(N'RKA1',N'PDORD1',N'PDMA',N'红',30),
                          (N'RKA2',N'PDORD1',N'PDMA',N'红',20)");
        // 物料A 一次未审核入仓 RKA9(999) → 不计
        c.Execute("INSERT INTO [采购入仓单]([单号],[日期],[审核]) VALUES(N'RKA9','2026-03-13','0')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[物料编号],[颜色],[数量])
                    VALUES(N'RKA9',N'PDORD1',N'PDMA',N'红',999)");
    }

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [订单单号]=N'PDORD1'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN (N'RKA1',N'RKA2',N'RKA9')");
        c.Execute("DELETE FROM [采购明细单] WHERE [单号]=N'PDORD1'");
        c.Execute("DELETE FROM [采购订单] WHERE [单号]=N'PDORD1'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'PDMA',N'PDMB')");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'PDSUP'");
    }

    [SkippableFact]
    public async Task Detail_expands_each_receipt_and_keeps_unreceived_line()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().ProgressDetailAsync(供应商: null, 起: null, 止: null, keyword: "PD", 状态: "全部");
            // 物料A 2 条入仓行 + 物料B 1 条未入仓行 = 3 行（未审核 999 不计）
            Assert.Equal(3, rows.Count);
            var aRows = rows.Where(r => r.物料编号 == "PDMA").ToList();
            Assert.Equal(2, aRows.Count);
            Assert.All(aRows, r => Assert.Equal(100m, r.订购数量));         // 订购数量在每条入仓行重复
            Assert.Contains(aRows, r => r.入仓单号 == "RKA1" && r.入仓数量 == 30m);
            Assert.Contains(aRows, r => r.入仓单号 == "RKA2" && r.入仓数量 == 20m);
            Assert.DoesNotContain(aRows, r => r.入仓数量 == 999m);          // 未审核不计

            var bRow = Assert.Single(rows.Where(r => r.物料编号 == "PDMB"));
            Assert.Null(bRow.入仓单号);                                      // 未入仓行入仓列空
            Assert.Null(bRow.入仓数量);
            Assert.Equal(50m, bRow.订购数量);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Detail_状态_filters_received_and_unreceived()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var received = await Svc().ProgressDetailAsync(供应商: null, 起: null, 止: null, keyword: "PD", 状态: "已入仓");
            Assert.Equal(2, received.Count);                                // 只 A 的两条入仓行
            Assert.All(received, r => Assert.NotNull(r.入仓单号));

            var unreceived = await Svc().ProgressDetailAsync(供应商: null, 起: null, 止: null, keyword: "PD", 状态: "未入仓");
            var only = Assert.Single(unreceived);                           // 只 B
            Assert.Equal("PDMB", only.物料编号);
            Assert.Null(only.入仓单号);
        }
        finally { Cleanup(c); }
    }
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~ProgressDetailDbTests"`
Expected: FAIL（`ProgressDetailAsync` 不存在，编译错误）

- [ ] **Step 4: 实现 ProgressDetailAsync**

在 `PurchaseOrderService.cs` 的 `ProgressAsync` 方法之后追加（类内）：

```csharp
    // 进度明细：订单明细 LEFT JOIN 已审核入仓明细(不聚合)，每条入仓一行，零入仓订单行留空。
    // 状态: "已入仓"=入仓单号非空 / "未入仓"=入仓单号空 / 其它=全部。入仓日期取入仓单表头。
    public async Task<IReadOnlyList<PurchaseOrderProgressDetailRow>> ProgressDetailAsync(
        string? 供应商, DateTime? 起, DateTime? 止, string? keyword, string? 状态)
    {
        var sup = string.IsNullOrWhiteSpace(供应商) ? null : $"%{供应商.Trim()}%";
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var 止Excl = 止?.Date.AddDays(1);   // 半开区间上界
        var onlyIn = 状态 == "已入仓" ? 1 : 0;
        var onlyOut = 状态 == "未入仓" ? 1 : 0;
        using var c = factory.Create();
        var rows = await c.QueryAsync<PurchaseOrderProgressDetailRow>(@"
SELECT d.[日期] AS 订购日期, d.[交货日期], d.[单号] AS 采购单号, d.[生产单号], d.[款号],
       d.[物料编号], d.[物料名称], d.[物料类别], d.[规格], d.[颜色], d.[单位],
       d.[数量] AS 订购数量,
       rk.[入仓单号], rk.[入仓数量], rk.[入仓日期],
       o.[供应商名称], o.[操作员], o.[审核]
FROM [采购明细单] d
JOIN [采购订单] o ON o.[单号] = d.[单号]
LEFT JOIN (
    SELECT r.[订单单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键,
           r.[单号] AS 入仓单号, r.[数量] AS 入仓数量, h.[日期] AS 入仓日期
    FROM [采购入仓明细单] r
    JOIN [采购入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
) rk ON rk.[订单单号] = d.[单号] AND rk.[物料编号] = d.[物料编号] AND rk.[颜色键] = ISNULL(d.[颜色],'')
WHERE (@sup IS NULL OR o.[供应商编号] LIKE @sup OR o.[供应商名称] LIKE @sup)
  AND (@起 IS NULL OR d.[日期] >= @起)
  AND (@止 IS NULL OR d.[日期] < @止)
  AND (@kw IS NULL OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@onlyIn = 0 OR rk.[入仓单号] IS NOT NULL)
  AND (@onlyOut = 0 OR rk.[入仓单号] IS NULL)
ORDER BY d.[单号] DESC, d.[ID], rk.[入仓日期];",
            new { sup, 起, 止 = 止Excl, kw, onlyIn, onlyOut });
        return rows.AsList();
    }
```

文件顶部已 `using ErpApi.Infrastructure.Db;`，`DateTime` 在 System(隐式 global using)。`PurchaseOrderProgressDetailRow` 与 service 同命名空间。

- [ ] **Step 5: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~ProgressDetailDbTests"`
Expected: PASS 2 个

- [ ] **Step 6: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Materials/PurchaseOrder/PurchaseOrderDtos.cs src/ErpApi/Features/Materials/PurchaseOrder/PurchaseOrderService.cs tests/ErpApi.Tests/ProgressDetailDbTests.cs
git commit -m @'
feat(采购管理): 进度明细表查询服务(订单明细LEFT JOIN已审核入仓展开,每条入仓一行/未入仓留空,状态过滤)+DbTest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 后端 controller progress-detail 端点 + API 测试

只读端点，权限「采购订单·打开」，无价格列不脱敏。

**Files:**
- Modify: `src/ErpApi/Features/Materials/PurchaseOrder/PurchaseOrderController.cs`
- Test: `tests/ErpApi.Tests/ProgressDetailApiTests.cs`

- [ ] **Step 1: 写失败的 API 测试**

Create `tests/ErpApi.Tests/ProgressDetailApiTests.cs`:

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
public class ProgressDetailApiTests(DbFixture fx)
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

    private void SeedPerms(string user, bool open)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'采购订单'", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开]) VALUES(@user,N'采购订单',@open)",
            new { user, open });
    }

    private HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }

    private static void Seed(SqlConnection c)
    {
        Clean(c);
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'PDASUP',N'PD-API供应商')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位]) VALUES(N'PDAMAT',N'PD-API料',N'米')");
        c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[供应商编号],[供应商名称],[操作员],[审核])
                    VALUES(N'PDAORD', SYSDATETIME(), N'PDASUP', N'PD-API供应商', N'tester', '1')");
        c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[物料编号],[物料名称],[颜色],[单位],[数量])
                    VALUES(N'PDAORD',SYSDATETIME(),N'PDAMAT',N'PD-API料',N'红',N'米',100)");
        c.Execute("INSERT INTO [采购入仓单]([单号],[日期],[审核]) VALUES(N'PDARK','2026-03-10','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[物料编号],[颜色],[数量])
                    VALUES(N'PDARK',N'PDAORD',N'PDAMAT',N'红',40)");
    }
    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [订单单号]=N'PDAORD'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号]=N'PDARK'");
        c.Execute("DELETE FROM [采购明细单] WHERE [单号]=N'PDAORD'");
        c.Execute("DELETE FROM [采购订单] WHERE [单号]=N'PDAORD'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'PDAMAT'");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'PDASUP'");
    }

    [SkippableFact]
    public async Task Detail_forbidden_without_open_permission()
    {
        using var app = Factory();
        SeedPerms("pdnoopen", open: false);
        var resp = await Client(app, "pdnoopen").GetAsync("/api/purchase-orders/progress-detail?keyword=PDAMAT");
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [SkippableFact]
    public async Task Detail_returns_row_with_receipt_fields()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); Seed(c); }
        SeedPerms("pdviewer", open: true);
        try
        {
            var rows = await Client(app, "pdviewer")
                .GetFromJsonAsync<JsonElement>("/api/purchase-orders/progress-detail?keyword=PDAMAT");
            Assert.Equal(1, rows.GetArrayLength());
            var r = rows[0];
            Assert.Equal("PDAORD", r.GetProperty("采购单号").GetString());
            Assert.Equal(100m, r.GetProperty("订购数量").GetDecimal());
            Assert.Equal("PDARK", r.GetProperty("入仓单号").GetString());
            Assert.Equal(40m, r.GetProperty("入仓数量").GetDecimal());
        }
        finally { using var c = new SqlConnection(fx.ConnectionString); c.Open(); Clean(c); }
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~ProgressDetailApiTests"`
Expected: FAIL（/progress-detail 404）

- [ ] **Step 3: 实现端点**

在 `PurchaseOrderController.cs` 的 `Progress` 方法（`[HttpGet("progress")]`）之后追加，**须在 `[HttpGet("{单号}")]` 之前**：

```csharp
    // 进度明细表：逐条入仓明细 + 未入仓订单行（只读查询）
    [HttpGet("progress-detail")]
    public async Task<IActionResult> ProgressDetail(
        string? 供应商 = null, DateTime? 起 = null, DateTime? 止 = null,
        string? keyword = null, string? 状态 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ProgressDetailAsync(供应商, 起, 止, keyword, 状态));
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~ProgressDetailApiTests"`
Expected: PASS 2 个

- [ ] **Step 5: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Materials/PurchaseOrder/PurchaseOrderController.cs tests/ErpApi.Tests/ProgressDetailApiTests.cs
git commit -m @'
feat(采购管理): 进度明细表REST端点 GET /purchase-orders/progress-detail(权限采购订单·打开)+API测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 前端 api + ProgressDetailPage

筛选条（含状态下拉）+ 表格 + 点行打开采购订单抽屉。范本：`OrderProgressPage.tsx`。

**Files:**
- Modify: `web/src/api/purchaseOrders.ts`
- Create: `web/src/pages/production/ProgressDetailPage.tsx`

- [ ] **Step 1: api 加 progressDetail + 类型**

在 `web/src/api/purchaseOrders.ts` 中，`ProgressQuery` 接口之后追加类型：

```typescript
export interface PurchaseOrderProgressDetailRow {
  订购日期?: string;
  交货日期?: string;
  采购单号?: string;
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  订购数量?: number | null;
  入仓单号?: string | null;
  入仓数量?: number | null;
  入仓日期?: string | null;
  供应商名称?: string;
  操作员?: string;
  审核?: string;
}

export interface ProgressDetailQuery {
  供应商?: string;
  起?: string;
  止?: string;
  keyword?: string;
  状态?: string;
}
```

并在 `purchaseOrderApi` 对象里（`progress` 之后）追加方法：

```typescript
  progressDetail: (q: ProgressDetailQuery) =>
    api.get<PurchaseOrderProgressDetailRow[]>("/purchase-orders/progress-detail", { params: q }).then(r => r.data),
```

- [ ] **Step 2: 写 ProgressDetailPage**

Create `web/src/pages/production/ProgressDetailPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, DatePicker, Input, Select, Space, Table, Tag, message } from "antd";
import type { Dayjs } from "dayjs";
import { purchaseOrderApi, type PurchaseOrderProgressDetailRow } from "../../api/purchaseOrders";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import PurchaseOrderDrawer from "./PurchaseOrderDrawer";

const MENU = "采购订单";
const d10 = (v?: string | null) => v?.slice(0, 10);

export default function ProgressDetailPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");

  const [供应商, set供应商] = useState("");
  const [keyword, setKeyword] = useState("");
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [状态, set状态] = useState<string>("全部");
  const [rows, setRows] = useState<PurchaseOrderProgressDetailRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    if (!canOpen) return;
    setLoading(true);
    try {
      const r = await purchaseOrderApi.progressDetail({
        供应商: 供应商.trim() || undefined,
        keyword: keyword.trim() || undefined,
        起: range?.[0] ? range[0].format("YYYY-MM-DD") : undefined,
        止: range?.[1] ? range[1].format("YYYY-MM-DD") : undefined,
        状态: 状态 === "全部" ? undefined : 状态,
      });
      setRows(r);
    } catch { message.error("加载进度明细表失败"); }
    finally { setLoading(false); }
  }, [canOpen, 供应商, keyword, range, 状态]);

  // 仅首屏加载一次；之后由「查询」按钮 / 搜索框显式触发，故意不随筛选变化自动刷新
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const 审核Tag = (v?: string) => v === "1"
    ? <Tag color="green">已审核</Tag> : <Tag>未审核</Tag>;

  const num = (v?: number | null) => (v ?? 0);

  const columns = [
    { title: "订购日期", dataIndex: "订购日期", width: 110, render: d10 },
    { title: "交货日期", dataIndex: "交货日期", width: 110, render: d10 },
    { title: "采购单号", dataIndex: "采购单号", width: 140, render: (v: string) => <a className="erp-num">{v}</a> },
    { title: "生产单号", dataIndex: "生产单号", width: 130 },
    { title: "款号", dataIndex: "款号", width: 110 },
    { title: "物料编号", dataIndex: "物料编号", width: 120 },
    { title: "物料名称", dataIndex: "物料名称", width: 150 },
    { title: "材料", dataIndex: "物料类别", width: 90 },
    { title: "规格", dataIndex: "规格", width: 100 },
    { title: "颜色", dataIndex: "颜色", width: 80 },
    { title: "单位", dataIndex: "单位", width: 64 },
    { title: "订购数量", dataIndex: "订购数量", width: 90, align: "right" as const, render: num },
    { title: "入仓单号", dataIndex: "入仓单号", width: 140, render: (v?: string | null) => v ?? "" },
    { title: "入仓数量", dataIndex: "入仓数量", width: 90, align: "right" as const, render: (v?: number | null) => v ?? "" },
    { title: "入仓日期", dataIndex: "入仓日期", width: 110, render: d10 },
    { title: "供应商", dataIndex: "供应商名称", width: 160 },
    { title: "操作员", dataIndex: "操作员", width: 90 },
    { title: "审核", dataIndex: "审核", width: 90, align: "center" as const, render: 审核Tag },
  ];

  if (!canOpen) {
    return (
      <Card variant="borderless">
        <div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少“采购订单·打开”权限）。</div>
      </Card>
    );
  }

  return (
    <Card title="进度明细表" variant="borderless">
      <Space wrap style={{ marginBottom: 12 }}>
        <Input placeholder="供应商" allowClear style={{ width: 160 }}
          value={供应商} onChange={e => set供应商(e.target.value)} onPressEnter={load} />
        <DatePicker.RangePicker value={range}
          onChange={v => setRange(v as [Dayjs | null, Dayjs | null] | null)} />
        <Input.Search placeholder="生产单号/款号/物料" allowClear style={{ width: 220 }}
          value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={load} />
        <Select value={状态} style={{ width: 120 }} onChange={set状态}
          options={[{ value: "全部", label: "全部" }, { value: "已入仓", label: "已入仓" }, { value: "未入仓", label: "未入仓" }]} />
        <Button type="primary" onClick={load}>查询</Button>
      </Space>
      <Table
        size="small" rowKey={(_, i) => String(i)} loading={loading} dataSource={rows}
        columns={columns} scroll={{ x: true }}
        pagination={{ pageSize: 50, showSizeChanger: false, showTotal: t => `共 ${t} 条` }}
        onRow={r => ({ onClick: () => r.采购单号 && setViewing(r.采购单号), style: { cursor: "pointer" } })}
      />
      <PurchaseOrderDrawer
        open={!!viewing}
        单号={viewing}
        onClose={() => setViewing(undefined)}
      />
    </Card>
  );
}
```

- [ ] **Step 3: 构建确认前端编译通过**

Run: `npm --prefix web run build`
Expected: 成功（tsc 无类型错误，vite 产出）

- [ ] **Step 4: 提交**

```powershell
git add web/src/api/purchaseOrders.ts web/src/pages/production/ProgressDetailPage.tsx
git commit -m @'
feat(采购管理): 进度明细表前端页(筛选 供应商/订购日期/关键字/状态 + 逐条入仓行/未入仓留空 + 点行开采购订单抽屉)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: 菜单/路由接线 + 验证

**Files:**
- Modify: `web/src/nav/menuTree.tsx`, `web/src/App.tsx`

- [ ] **Step 1: menuTree 接路由**

在 `web/src/nav/menuTree.tsx` 把采购管理组里的 `M("进度明细表")` 改为：

```tsx
    M("进度明细表", "/order-progress-detail", "采购订单"),
```

- [ ] **Step 2: App.tsx 加路由**

在 `web/src/App.tsx` 顶部 import 区追加（与 `OrderProgressPage` 同组）：

```tsx
import ProgressDetailPage from "./pages/production/ProgressDetailPage";
```

在路由区 `<Route path="order-progress" element={<OrderProgressPage />} />` 那行之后追加：

```tsx
          <Route path="order-progress-detail" element={<ProgressDetailPage />} />
```

- [ ] **Step 3: 构建确认**

Run: `npm --prefix web run build`
Expected: 成功

- [ ] **Step 4: 前端单测回归**

Run: `npm --prefix web run test`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```powershell
git add web/src/nav/menuTree.tsx web/src/App.tsx
git commit -m @'
feat(采购管理): 进度明细表接入菜单/路由 /order-progress-detail(权限采购订单)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

- [ ] **Step 6: 冒烟（可选，服务在跑时）**

后端 5000 / 前端 5173 运行中：浏览器登录 admin/admin123 → 采购管理 → 进度明细表，确认筛选(含状态)、表格加载、点行弹出采购订单抽屉。

---

## Self-Review

- **Spec 覆盖**：展开口径(每条入仓一行/未入仓留空·只认审核·状态过滤·颜色/订单号关联) → Task1；端点+权限 → Task2；前端筛选(含状态)/点行开抽屉 → Task3；菜单/路由 → Task4。✓
- **占位符**：无 TBD/TODO；每步含完整代码/命令/预期。✓
- **类型一致**：后端 `PurchaseOrderProgressDetailRow`(C#) ↔ 前端 `PurchaseOrderProgressDetailRow`(TS) 字段对齐(入仓单号 string?/入仓数量 number?/入仓日期 string?)；`ProgressDetailAsync(供应商,起,止,keyword,状态)` Task1 定义、Task2 调用、Task3 经 `progressDetail(q)` 传参一致；端点参数名 `状态` 与服务一致。✓
- **关键坑**：①`[HttpGet("progress-detail")]` 放 `{单号}` 之前；②LEFT JOIN 展开非聚合(订购数量重复属预期)；③状态映射 已入仓/未入仓→onlyIn/onlyOut；④FK：种子先种 供应商资料/物料资料，反序清理(Task1/2 Seed 已含)；⑤日期半开区间(@止+1天)。✓
- **范围**：单一只读查询页，聚焦。✓
