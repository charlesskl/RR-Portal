# 订单进度表（采购管理）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在采购管理下新增只读「订单进度表」：每行=一条采购订单明细（采购明细单），展示 订购数量 / 已入仓数量 / 欠数；点行内任意单元格打开该行所属采购订单（复用现有抽屉）。

**Architecture:** 后端在现有 `PurchaseOrderService`/`PurchaseOrderController` 加一个 Dapper 只读查询 `ProgressAsync` + `GET /api/purchase-orders/progress`；入仓数量按 `采购入仓明细单.订单单号=采购订单.单号 AND 物料编号 AND 颜色` 关联，仅认已审核入仓单。前端新增 `OrderProgressPage`（筛选条+表格+点行开抽屉），接 menuTree 路由，权限复用菜单「采购订单」。依据 `docs/superpowers/specs/2026-06-11-order-progress-design.md`。

**Tech Stack:** .NET 8 ASP.NET Core, Dapper, SQL Server LocalDB (erp/erp_test, Chinese_PRC_CI_AS), xUnit + Xunit.SkippableFact + WebApplicationFactory, React 18 + TS + Vite + Ant Design v6。

---

## 前置约定

- 工作目录 `D:\WebpageERP`，已在分支 `feat-order-progress`。Windows PowerShell；`dotnet` 不在 PATH 时刷新：`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`。
- DB 测试环境变量（shell 为空时）：`$env:ERP_TEST_DB = [Environment]::GetEnvironmentVariable("ERP_TEST_DB","User")`、`$env:ERP_JWT_KEY = [Environment]::GetEnvironmentVariable("ERP_JWT_KEY","User")`。
- 跑后端测试：`dotnet test`；单类 `dotnet test --filter "FullyQualifiedName~OrderProgressDbTests"`。前端：`npm --prefix web run build`、`npm --prefix web run test`。
- 提交规范：commit 末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。git 报 LF→CRLF 警告正常。
- 权限：本页复用菜单「采购订单」，admin 已由 `db/seed_purchase_order_perms.sql` 授权，**无需新增 seed**。
- 现有可复用件：`ISqlConnectionFactory.Create()`；`PurchaseOrderService(ISqlConnectionFactory, IDocumentNumberGenerator)`；`IPermissionService.HasAsync(user, "采购订单", PermissionAction.打开)`；前端 `PurchaseOrderDrawer`（props：`open`/`单号`/`onClose`/`onSaved`，传 `单号` 即查看态）、`usePerms()`、`can(perms, menu, action)`。
- **已存在的工作区改动**：`web/src/api/purchaseOrders.ts` 的 `list` 路由已从 `/purchase-orders/list` 修为 `/purchase-orders`（修复 404）。本计划 Task 4 会把它与前端改动一并提交。

### 相关表真实列（以 `db/01_rebuild_schema.sql` 为准）

- `采购订单`：单号, 日期, 交货日期, 供应商编号, 供应商名称, 操作员, 审核 …
- `采购明细单`：单号(→采购订单), 生产单号, 款号, 物料类别, 物料编号, 物料名称, 规格, 颜色, 单位, **数量(订购数量)**, 日期, 交货日期, ID …
- `采购入仓明细单`：单号(→采购入仓单), **订单单号**, 物料编号, 颜色, **数量(入仓数量)** …
- `采购入仓单`：单号, 审核

---

## 文件结构

```
src/ErpApi/Features/Materials/PurchaseOrder/
├─ PurchaseOrderDtos.cs        改:+PurchaseOrderProgressRow
├─ PurchaseOrderService.cs     改:+ProgressAsync
└─ PurchaseOrderController.cs  改:+[HttpGet("progress")]

tests/ErpApi.Tests/
├─ OrderProgressDbTests.cs     新:进度口径(订购/入仓/欠数·只认审核·颜色隔离·onlyOwed)
└─ OrderProgressApiTests.cs    新:progress 端点(权限+返回形状)

web/src/
├─ api/purchaseOrders.ts       改:+progress() + 类型 PurchaseOrderProgressRow
├─ pages/production/OrderProgressPage.tsx   新:筛选条+表格+点行开抽屉
├─ nav/menuTree.tsx            改:订单进度表→/order-progress
└─ App.tsx                     改:+/order-progress 路由
```

---

## Task 1: 后端 ProgressAsync + DTO + DbTest

进度查询的核心。Dapper 只读：`采购明细单` JOIN `采购订单`，LEFT JOIN 已审核入仓汇总（按 订单单号+物料编号+颜色）。欠数=订购−入仓。

**Files:**
- Modify: `src/ErpApi/Features/Materials/PurchaseOrder/PurchaseOrderDtos.cs`, `src/ErpApi/Features/Materials/PurchaseOrder/PurchaseOrderService.cs`
- Test: `tests/ErpApi.Tests/OrderProgressDbTests.cs`

- [ ] **Step 1: 加 DTO**

在 `PurchaseOrderDtos.cs` 末尾追加：

```csharp
// 订单进度行：一条采购订单明细 + 入仓进度（订购/入仓/欠数）
public sealed class PurchaseOrderProgressRow
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
    public decimal? 入仓数量 { get; set; }
    public decimal? 欠数 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
}
```

- [ ] **Step 2: 写失败的 DbTest**

Create `tests/ErpApi.Tests/OrderProgressDbTests.cs`:

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Materials.PurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class OrderProgressDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PurchaseOrderService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'OPSPROG',N'进度测试供应商')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'OPMPROG',N'进度测试料',N'规格X',N'米')");
        // 采购订单(已审核) + 2 行明细：同物料 OPMPROG 异色(红100/蓝50)
        c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[供应商编号],[供应商名称],[操作员],[审核])
                    VALUES(N'POPROG1', SYSDATETIME(), N'OPSPROG', N'进度测试供应商', N'tester', '1')");
        c.Execute(@"INSERT INTO [采购明细单]([单号],[生产单号],[日期],[物料编号],[物料名称],[规格],[颜色],[单位],[数量])
                    VALUES(N'POPROG1',N'MOPROG',SYSDATETIME(),N'OPMPROG',N'进度测试料',N'规格X',N'红',N'米',100),
                          (N'POPROG1',N'MOPROG',SYSDATETIME(),N'OPMPROG',N'进度测试料',N'规格X',N'蓝',N'米',50)");
        // 已审核入仓：红 30、蓝 50(满)
        c.Execute("INSERT INTO [采购入仓单]([单号],[审核]) VALUES(N'RKPROG1','1')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[物料编号],[颜色],[数量])
                    VALUES(N'RKPROG1',N'POPROG1',N'OPMPROG',N'红',30),
                          (N'RKPROG1',N'POPROG1',N'OPMPROG',N'蓝',50)");
        // 未审核入仓：红 999(不计)
        c.Execute("INSERT INTO [采购入仓单]([单号],[审核]) VALUES(N'RKPROG9','0')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[物料编号],[颜色],[数量])
                    VALUES(N'RKPROG9',N'POPROG1',N'OPMPROG',N'红',999)");
    }

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [订单单号]=N'POPROG1'");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN (N'RKPROG1',N'RKPROG9')");
        c.Execute("DELETE FROM [采购明细单] WHERE [单号]=N'POPROG1'");
        c.Execute("DELETE FROM [采购订单] WHERE [单号]=N'POPROG1'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'OPMPROG'");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'OPSPROG'");
    }

    [SkippableFact]
    public async Task Progress_computes_ordered_received_owed_only_approved_color_isolated()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().ProgressAsync(供应商: null, 起: null, 止: null, keyword: "OPMPROG", onlyOwed: false);
            Assert.Equal(2, rows.Count);
            var 红 = rows.Single(r => r.颜色 == "红");
            var 蓝 = rows.Single(r => r.颜色 == "蓝");
            // 红：订购100 入仓30(未审核999不计) 欠70；蓝：订购50 入仓50 欠0(颜色隔离，红入仓不串到蓝)
            Assert.Equal(100m, 红.订购数量);
            Assert.Equal(30m, 红.入仓数量);
            Assert.Equal(70m, 红.欠数);
            Assert.Equal(50m, 蓝.订购数量);
            Assert.Equal(50m, 蓝.入仓数量);
            Assert.Equal(0m, 蓝.欠数);
            Assert.Equal("POPROG1", 红.采购单号);
            Assert.Equal("进度测试供应商", 红.供应商名称);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Progress_onlyOwed_filters_fully_received()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var owed = await Svc().ProgressAsync(供应商: null, 起: null, 止: null, keyword: "OPMPROG", onlyOwed: true);
            // 蓝 欠0 被过滤，只剩 红
            var row = Assert.Single(owed);
            Assert.Equal("红", row.颜色);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Progress_filters_by_supplier()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            Assert.Empty(await Svc().ProgressAsync(供应商: "不存在供应商", 起: null, 止: null, keyword: "OPMPROG", onlyOwed: false));
            Assert.Equal(2, (await Svc().ProgressAsync(供应商: "OPSPROG", 起: null, 止: null, keyword: "OPMPROG", onlyOwed: false)).Count);
        }
        finally { Cleanup(c); }
    }
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~OrderProgressDbTests"`
Expected: FAIL（`ProgressAsync` 不存在，编译错误）

- [ ] **Step 4: 实现 ProgressAsync**

在 `PurchaseOrderService.cs` 的 `BasisAsync` 方法之后追加（类内）：

```csharp
    // 订单进度：每行一条采购明细，入仓数量按 订单单号+物料编号+颜色 关联已审核入仓，欠数=订购−入仓。
    public async Task<IReadOnlyList<PurchaseOrderProgressRow>> ProgressAsync(
        string? 供应商, DateTime? 起, DateTime? 止, string? keyword, bool onlyOwed)
    {
        var sup = string.IsNullOrWhiteSpace(供应商) ? null : $"%{供应商.Trim()}%";
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var 止Excl = 止?.Date.AddDays(1);   // 半开区间上界
        using var c = factory.Create();
        var rows = await c.QueryAsync<PurchaseOrderProgressRow>(@"
SELECT d.[日期] AS 订购日期, d.[交货日期], d.[单号] AS 采购单号, d.[生产单号], d.[款号],
       d.[物料编号], d.[物料名称], d.[物料类别], d.[规格], d.[颜色], d.[单位],
       d.[数量] AS 订购数量,
       ISNULL(rk.[入仓数量], 0) AS 入仓数量,
       d.[数量] - ISNULL(rk.[入仓数量], 0) AS 欠数,
       o.[供应商名称], o.[操作员], o.[审核]
FROM [采购明细单] d
JOIN [采购订单] o ON o.[单号] = d.[单号]
LEFT JOIN (
    SELECT r.[订单单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键, SUM(r.[数量]) AS 入仓数量
    FROM [采购入仓明细单] r
    JOIN [采购入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
    GROUP BY r.[订单单号], r.[物料编号], ISNULL(r.[颜色],'')
) rk ON rk.[订单单号] = d.[单号] AND rk.[物料编号] = d.[物料编号] AND rk.[颜色键] = ISNULL(d.[颜色],'')
WHERE (@sup IS NULL OR o.[供应商编号] LIKE @sup OR o.[供应商名称] LIKE @sup)
  AND (@起 IS NULL OR d.[日期] >= @起)
  AND (@止 IS NULL OR d.[日期] < @止)
  AND (@kw IS NULL OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@onlyOwed = 0 OR (d.[数量] - ISNULL(rk.[入仓数量], 0)) > 0)
ORDER BY d.[单号] DESC, d.[ID];",
            new { sup, 起, 止 = 止Excl, kw, onlyOwed = onlyOwed ? 1 : 0 });
        return rows.AsList();
    }
```

文件顶部已 `using ErpApi.Infrastructure.Db;`，`DateTime` 在 `System`（隐式 global using）。

- [ ] **Step 5: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~OrderProgressDbTests"`
Expected: PASS 3 个

- [ ] **Step 6: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Materials/PurchaseOrder/PurchaseOrderDtos.cs src/ErpApi/Features/Materials/PurchaseOrder/PurchaseOrderService.cs tests/ErpApi.Tests/OrderProgressDbTests.cs
git commit -m @'
feat(采购管理): 订单进度表查询服务(采购明细级 订购/入仓/欠数,按订单号+物料+颜色关联已审核入仓)+DbTest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 后端 controller progress 端点 + API 测试

只读端点，权限「采购订单·打开」，无价格列不做脱敏。

**Files:**
- Modify: `src/ErpApi/Features/Materials/PurchaseOrder/PurchaseOrderController.cs`
- Test: `tests/ErpApi.Tests/OrderProgressApiTests.cs`

- [ ] **Step 1: 写失败的 API 测试**

Create `tests/ErpApi.Tests/OrderProgressApiTests.cs`:

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
public class OrderProgressApiTests(DbFixture fx)
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
        c.Execute(@"INSERT INTO [采购订单]([单号],[日期],[供应商编号],[供应商名称],[操作员],[审核])
                    VALUES(N'POPRAPI', SYSDATETIME(), N'OPSAPI', N'API进度供应商', N'tester', '1')");
        c.Execute(@"INSERT INTO [采购明细单]([单号],[日期],[物料编号],[物料名称],[颜色],[单位],[数量])
                    VALUES(N'POPRAPI',SYSDATETIME(),N'OPMAPI',N'API进度料',N'红',N'米',100)");
    }
    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购明细单] WHERE [单号]=N'POPRAPI'");
        c.Execute("DELETE FROM [采购订单] WHERE [单号]=N'POPRAPI'");
    }

    [SkippableFact]
    public async Task Progress_forbidden_without_open_permission()
    {
        using var app = Factory();
        SeedPerms("opnoopen", open: false);
        var resp = await Client(app, "opnoopen").GetAsync("/api/purchase-orders/progress?keyword=OPMAPI");
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [SkippableFact]
    public async Task Progress_returns_rows_with_owed()
    {
        using var app = Factory();
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open(); Seed(c); }
        SeedPerms("opviewer", open: true);
        try
        {
            var rows = await Client(app, "opviewer")
                .GetFromJsonAsync<JsonElement>("/api/purchase-orders/progress?keyword=OPMAPI");
            Assert.Equal(1, rows.GetArrayLength());
            var r = rows[0];
            Assert.Equal("POPRAPI", r.GetProperty("采购单号").GetString());
            Assert.Equal(100m, r.GetProperty("订购数量").GetDecimal());
            Assert.Equal(0m, r.GetProperty("入仓数量").GetDecimal());
            Assert.Equal(100m, r.GetProperty("欠数").GetDecimal());
        }
        finally { using var c = new SqlConnection(fx.ConnectionString); c.Open(); Clean(c); }
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `dotnet test --filter "FullyQualifiedName~OrderProgressApiTests"`
Expected: FAIL（/progress 404 → `GetFromJsonAsync` 抛异常 / Forbidden 用例可能因路由落到 `{单号}` 而失败）

- [ ] **Step 3: 实现端点**

在 `PurchaseOrderController.cs` 的 `Basis` 方法（`[HttpGet("basis")]`）之后追加。**必须放在 `[HttpGet("{单号}")]` 之前**，否则 `progress` 会被 `{单号}` 吞掉（attribute 路由里字面量段优先级高于参数段，放前更稳妥）：

```csharp
    // 订单进度表：采购明细级 订购/入仓/欠数（只读查询）
    [HttpGet("progress")]
    public async Task<IActionResult> Progress(
        string? 供应商 = null, DateTime? 起 = null, DateTime? 止 = null,
        string? keyword = null, bool onlyOwed = false)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ProgressAsync(供应商, 起, 止, keyword, onlyOwed));
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `dotnet test --filter "FullyQualifiedName~OrderProgressApiTests"`
Expected: PASS 2 个

- [ ] **Step 5: 全量回归 + 提交**

Run: `dotnet test`
Expected: 全部 PASS

```powershell
git add src/ErpApi/Features/Materials/PurchaseOrder/PurchaseOrderController.cs tests/ErpApi.Tests/OrderProgressApiTests.cs
git commit -m @'
feat(采购管理): 订单进度表REST端点 GET /purchase-orders/progress(权限采购订单·打开)+API测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 前端 api + OrderProgressPage

筛选条 + 表格 + 点行打开现有采购订单抽屉。

**Files:**
- Modify: `web/src/api/purchaseOrders.ts`
- Create: `web/src/pages/production/OrderProgressPage.tsx`

- [ ] **Step 1: api 加 progress + 类型**

在 `web/src/api/purchaseOrders.ts` 中，`PurchaseOrderDetail` 接口之后追加类型：

```typescript
export interface PurchaseOrderProgressRow {
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
  入仓数量?: number | null;
  欠数?: number | null;
  供应商名称?: string;
  操作员?: string;
  审核?: string;
}

export interface ProgressQuery {
  供应商?: string;
  起?: string;
  止?: string;
  keyword?: string;
  onlyOwed?: boolean;
}
```

并在 `purchaseOrderApi` 对象里（`basis` 之后）追加方法：

```typescript
  progress: (q: ProgressQuery) =>
    api.get<PurchaseOrderProgressRow[]>("/purchase-orders/progress", { params: q }).then(r => r.data),
```

- [ ] **Step 2: 写 OrderProgressPage**

Create `web/src/pages/production/OrderProgressPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Card, Checkbox, DatePicker, Input, Space, Table, Tag, message } from "antd";
import type { Dayjs } from "dayjs";
import { purchaseOrderApi, type PurchaseOrderProgressRow } from "../../api/purchaseOrders";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import PurchaseOrderDrawer from "./PurchaseOrderDrawer";

const MENU = "采购订单";
const d10 = (v?: string) => v?.slice(0, 10);

export default function OrderProgressPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");

  const [供应商, set供应商] = useState("");
  const [keyword, setKeyword] = useState("");
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [onlyOwed, setOnlyOwed] = useState(false);
  const [rows, setRows] = useState<PurchaseOrderProgressRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    if (!canOpen) return;
    setLoading(true);
    try {
      const r = await purchaseOrderApi.progress({
        供应商: 供应商.trim() || undefined,
        keyword: keyword.trim() || undefined,
        起: range?.[0] ? range[0].format("YYYY-MM-DD") : undefined,
        止: range?.[1] ? range[1].format("YYYY-MM-DD") : undefined,
        onlyOwed: onlyOwed || undefined,
      });
      setRows(r);
    } catch { message.error("加载订单进度表失败"); }
    finally { setLoading(false); }
  }, [canOpen, 供应商, keyword, range, onlyOwed]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const 审核Tag = (v?: string) => v === "1"
    ? <Tag color="green">已审核</Tag> : <Tag>未审核</Tag>;

  const num = (v?: number | null) => (v ?? 0);
  const owe = (v?: number | null) => (
    <span style={{ fontWeight: 700, color: (v ?? 0) > 0 ? "#cf1322" : undefined }}>{v ?? 0}</span>
  );

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
    { title: "入仓数量", dataIndex: "入仓数量", width: 90, align: "right" as const, render: num },
    { title: "欠数", dataIndex: "欠数", width: 90, align: "right" as const, render: owe },
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
    <Card title="订单进度表" variant="borderless">
      <Space wrap style={{ marginBottom: 12 }}>
        <Input placeholder="供应商" allowClear style={{ width: 160 }}
          value={供应商} onChange={e => set供应商(e.target.value)} />
        <DatePicker.RangePicker value={range as never}
          onChange={v => setRange(v as [Dayjs | null, Dayjs | null] | null)} />
        <Input.Search placeholder="生产单号/款号/物料" allowClear style={{ width: 220 }}
          value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={load} />
        <Checkbox checked={onlyOwed} onChange={e => setOnlyOwed(e.target.checked)}>只看欠数</Checkbox>
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

注：`onlyOwed` 切换或选择日期范围后点搜索框的搜索（或重新触发 `load`）刷新；`load` 依赖项已含全部筛选，搜索按钮 `onSearch={load}` 立即查询。

- [ ] **Step 3: 构建确认前端编译通过**

Run: `npm --prefix web run build`
Expected: 成功（tsc 无类型错误，vite 产出）

- [ ] **Step 4: 提交**

```powershell
git add web/src/api/purchaseOrders.ts web/src/pages/production/OrderProgressPage.tsx
git commit -m @'
feat(采购管理): 订单进度表前端页(筛选 供应商/订购日期/关键字/只看欠数 + 欠数标红 + 点行开采购订单抽屉)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: 菜单/路由接线 + 列表路由修复 + 验证

把「订单进度表」接进菜单与路由，并把工作区里已修好的列表路由 bug 一并提交。

**Files:**
- Modify: `web/src/nav/menuTree.tsx`, `web/src/App.tsx`
- Modify(已改未提交): `web/src/api/purchaseOrders.ts`（list 路由修复，Task 3 已 add 过该文件；本任务确认含修复）

- [ ] **Step 1: menuTree 接路由**

在 `web/src/nav/menuTree.tsx` 把 `M("订单进度表")` 改为：

```tsx
    M("订单进度表", "/order-progress", "采购订单"),
```

- [ ] **Step 2: App.tsx 加路由**

在 `web/src/App.tsx` 顶部 import 区（与 `PurchaseOrderListPage` 同组）追加：

```tsx
import OrderProgressPage from "./pages/production/OrderProgressPage";
```

在路由区 `purchase-orders` 那行之后追加：

```tsx
          <Route path="order-progress" element={<OrderProgressPage />} />
```

- [ ] **Step 3: 构建确认**

Run: `npm --prefix web run build`
Expected: 成功

- [ ] **Step 4: 前端单测回归（确保未破坏既有纯函数测试）**

Run: `npm --prefix web run test`
Expected: 全部 PASS

- [ ] **Step 5: 提交（含 list 路由修复）**

```powershell
git add web/src/nav/menuTree.tsx web/src/App.tsx web/src/api/purchaseOrders.ts
git commit -m @'
feat(采购管理): 订单进度表接入菜单/路由 /order-progress + 修复采购订单列表路由(/purchase-orders/list→/purchase-orders 404)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

- [ ] **Step 6: 冒烟（可选，服务在跑时）**

后端 5000 / 前端 5173 运行中：浏览器登录 admin/admin123 → 采购管理 → 订单进度表，确认筛选/表格加载、点行弹出采购订单抽屉。若服务未跑，按前置约定启动。

---

## Self-Review

- **Spec 覆盖**：进度口径(订购/入仓/欠数·只认审核·订单号+物料+颜色关联) → Task1；端点+权限 → Task2；前端筛选/标红/点行开抽屉 → Task3；菜单/路由 → Task4。✓
- **占位符**：无 TBD/TODO；每步含完整代码/命令/预期。✓
- **类型一致**：后端 `PurchaseOrderProgressRow`(C#) ↔ 前端 `PurchaseOrderProgressRow`(TS) 字段对齐；`ProgressAsync(供应商,起,止,keyword,onlyOwed)` 在 Task1 定义、Task2 调用、Task3 经 `progress(q)` 传参一致。✓
- **关键坑**：①`[HttpGet("progress")]` 须在 `{单号}` 之前，避免被参数路由吞（Task2 Step3 已强调）；②日期半开区间(@止 + 1 天)在服务端处理；③颜色 ISNULL 兜空避免多色串算；④list 路由修复随 Task4 提交。✓
- **范围**：单一只读查询页，聚焦，无需拆分。✓
