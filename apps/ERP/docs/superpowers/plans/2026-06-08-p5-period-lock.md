# 硬月结锁期 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 月结后禁止对已结期间(该月及更早,按 仓库+口径)的仓储单据做 录入/审核/反审核(Delete 不锁),命中返回 409。完成后 P5 收官。

**Architecture:** 新建 `PeriodLockService`(读结存快照表判锁)+`PeriodLockedException`;12 个仓储/物料单据控制器注入它,在 Create/Approve/Unapprove 加校验(成品调拨用专用方法)。不改 service 签名,不动 Delete/库存查询/月报。

**Tech Stack:** .NET 8 + Dapper + ASP.NET Core；xUnit。依据 `docs/superpowers/specs/2026-06-08-p5-period-lock-design.md`。

---

## Task 1: PeriodLockService + DI + 核心 DbTest

**Files:** Create `src/ErpApi/Features/MonthEnd/PeriodLockService.cs`；Modify `src/ErpApi/Program.cs`；Create `tests/ErpApi.Tests/PeriodLockServiceDbTests.cs`.

- [ ] **Step 1: 写 PeriodLockService（含异常）**

`src/ErpApi/Features/MonthEnd/PeriodLockService.cs`（完整内容见设计 §2，照抄）：
```csharp
using Dapper;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.MonthEnd;

public sealed class PeriodLockedException(string message) : Exception(message);

// 硬月结锁期：已结期间(该仓+口径,年月>=单据月)禁止录入/审核/反审核。读 结存快照表 判锁。
public sealed class PeriodLockService(ISqlConnectionFactory factory)
{
    public async Task<bool> IsLockedAsync(string 口径, string? 仓库, DateTime 日期, SqlConnection c, SqlTransaction? tx = null)
    {
        if (string.IsNullOrWhiteSpace(仓库)) return false;
        var ym = 日期.ToString("yyyyMM");
        var n = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [结存快照表] WHERE 口径=@口径 AND 仓库=@仓 AND 年月>=@ym",
            new { 口径, 仓 = 仓库.Trim(), ym }, tx);
        return n > 0;
    }
    private static PeriodLockedException Locked(string 口径, string 仓库, DateTime d) =>
        new($"仓库[{仓库}] {d:yyyy-MM} 期间已月结锁定（{口径}），不能录入/审核/反审核该期间单据，请先反月结。");

    public async Task EnsureWarehouseOpenAsync(string 口径, string? 仓库, DateTime 日期)
    {
        if (string.IsNullOrWhiteSpace(仓库)) return;
        using var c = factory.Create(); await c.OpenAsync();
        if (await IsLockedAsync(口径, 仓库, 日期, c)) throw Locked(口径, 仓库!.Trim(), 日期);
    }
    public async Task EnsureHeaderOpenAsync(string 口径, string table, string 单号)
    {
        using var c = factory.Create(); await c.OpenAsync();
        var row = await c.QueryFirstOrDefaultAsync(
            $"SELECT [仓库] AS 仓库,[日期] AS 日期 FROM [{table}] WHERE [单号]=@单号", new { 单号 });
        if (row is null) return;
        string? 仓库 = row.仓库; DateTime? 日期 = row.日期;
        if (仓库 != null && 日期 != null && await IsLockedAsync(口径, 仓库, 日期.Value, c))
            throw Locked(口径, 仓库, 日期.Value);
    }
    public async Task EnsureTransferOpenAsync(string 单号)
    {
        using var c = factory.Create(); await c.OpenAsync();
        var 日期 = await c.ExecuteScalarAsync<DateTime?>("SELECT [日期] FROM [成品调拨单] WHERE [单号]=@单号", new { 单号 });
        if (日期 is null) return;
        var whs = await c.QueryAsync<string>(
            @"SELECT 源仓库 FROM [成品调拨明细单] WHERE 单号=@单号 AND 源仓库 IS NOT NULL
              UNION SELECT 目标仓库 FROM [成品调拨明细单] WHERE 单号=@单号 AND 目标仓库 IS NOT NULL", new { 单号 });
        foreach (var w in whs)
            if (await IsLockedAsync("成品", w, 日期.Value, c)) throw Locked("成品", w, 日期.Value);
    }
}
```

- [ ] **Step 2: DI 注册**

`src/ErpApi/Program.cs`，在 `MonthEndService` 注册行之后追加：
```csharp
builder.Services.AddScoped<ErpApi.Features.MonthEnd.PeriodLockService>();
```

- [ ] **Step 3: 核心 DbTest**

`tests/ErpApi.Tests/PeriodLockServiceDbTests.cs`：
```csharp
using Dapper;
using ErpApi.Features.MonthEnd;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PeriodLockServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    [SkippableFact]
    public async Task IsLocked_按口径仓库年月判定()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        const string wh = "PL锁仓";
        using var c = fx.Open();
        c.Execute("DELETE FROM [结存快照表] WHERE [仓库]=@wh", new { wh });
        try
        {
            // 月结 202602(物料)
            c.Execute(@"INSERT INTO [结存快照表]([年月],[仓库],[口径],[物料编号],[期初],[本期入],[本期出],[结存],[生成时间])
                        VALUES('202602',@wh,N'物料',N'X1',0,0,0,0,SYSUTCDATETIME())", new { wh });
            var svc = new PeriodLockService(Factory());
            using var cc = fx.Open();
            Assert.True (await svc.IsLockedAsync("物料", wh, new DateTime(2026,2,15), cc));  // 当月→锁
            Assert.True (await svc.IsLockedAsync("物料", wh, new DateTime(2026,1,10), cc));  // 更早→锁
            Assert.False(await svc.IsLockedAsync("物料", wh, new DateTime(2026,3,10), cc));  // 更晚→不锁
            Assert.False(await svc.IsLockedAsync("成品", wh, new DateTime(2026,2,15), cc));  // 别的口径→不锁
            Assert.False(await svc.IsLockedAsync("物料", "别的仓", new DateTime(2026,2,15), cc)); // 别的仓→不锁
            // 反月结(删快照)后解锁
            c.Execute("DELETE FROM [结存快照表] WHERE [仓库]=@wh", new { wh });
            Assert.False(await svc.IsLockedAsync("物料", wh, new DateTime(2026,2,15), cc));
        }
        finally { c.Execute("DELETE FROM [结存快照表] WHERE [仓库]=@wh", new { wh }); }
    }
}
```

- [ ] **Step 4: 跑测试（绿）** — `Get-Process -Name ErpApi ...|Stop-Process -Force`；`dotnet test tests/ErpApi.Tests --filter PeriodLockServiceDbTests`（全过）；全量 `dotnet test tests/ErpApi.Tests`（148）。

- [ ] **Step 5: Commit**
```bash
git add src/ErpApi/Features/MonthEnd/PeriodLockService.cs src/ErpApi/Program.cs tests/ErpApi.Tests/PeriodLockServiceDbTests.cs
git commit -m "feat(P5): 硬月结锁期PeriodLockService(读快照判锁,录入/审核/反审核)+DI+DbTest"
```

---

## Task 2: 物料 3 控制器加锁 + 集成测试

**Files:** Modify `src/ErpApi/Features/Materials/PurchaseReceipt/PurchaseReceiptController.cs`, `.../MaterialIssue/MaterialIssueController.cs`, `.../MaterialReturn/MaterialReturnController.cs`；Modify `tests/ErpApi.Tests/P5MonthEndApiIntegrationTests.cs`.

口径 = `物料`，三者单头都有 仓库+日期，create dto 都有 `仓库`，均走**标准模式**。

- [ ] **Step 1: 对三个控制器各加锁**（逐个读文件，按下述最小改动）：
  1. ctor 末尾参数加 `, ErpApi.Features.MonthEnd.PeriodLockService periodLock`（若控制器 namespace 非 MonthEnd，用全限定或加 `using ErpApi.Features.MonthEnd;`）。
  2. 加常量：`private const string 口径 = "物料";`
  3. `Create` 方法：在 `保存` 权限校验之后、`try { 单号 = await svc.CreateAsync(...) }` 之前插入：
     ```csharp
     try { await periodLock.EnsureWarehouseOpenAsync(口径, dto.仓库, DateTime.Now); }
     catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
     ```
  4. `Approve` 方法：在 `审核` 权限校验之后、`posting.ApproveAsync` 之前插入：
     ```csharp
     try { await periodLock.EnsureHeaderOpenAsync(口径, Table, 单号); }
     catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
     ```
  5. `Unapprove` 方法：同 Approve（在 `反审核` 权限校验后、`posting.UnapproveAsync` 之前），同样 `EnsureHeaderOpenAsync(口径, Table, 单号)`。
  6. 顶部加 `using ErpApi.Features.MonthEnd;`（若引用 `PeriodLockedException` 短名需要）和确保有 `DateTime`(System) 可用（控制器一般已 `using System;`，若无则用 `System.DateTime.Now`）。
  - 确认 dto 字段名为 `仓库`（读 `PurchaseReceiptCreateDto`/`MaterialIssueCreateDto`/`MaterialReturnCreateDto`，应为 `仓库`）。

- [ ] **Step 2: 集成测试（物料锁期）**

在 `tests/ErpApi.Tests/P5MonthEndApiIntegrationTests.cs` 追加（复用其 `Factory()/Token/Client`；权限种子用既有 `SeedPerms`，需含 保存/审核/反审核/功能；如现有 `SeedPerms` 不含某些位，用本测试内联种子补全）：
```csharp
    [SkippableFact]
    public async Task 物料_月结后锁期_录入与审核被拒()
    {
        using var app = Factory();
        const string wh = "PL_API物料仓";
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open();
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [采购入仓单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [结存快照表] WHERE [仓库]=@wh", new { wh });
            c.Execute("IF NOT EXISTS (SELECT 1 FROM [物料资料] WHERE [物料编号]=N'PLM1') INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'PLM1',N'锁料',N'规',N'KG')");
            // 造一张本月(以当前月)采购入仓并审核——但为可控,直接插审核入仓 + 月结当前月
        }
        // 用一个全权限用户
        using (var c = new SqlConnection(fx.ConnectionString)) { c.Open();
            c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=N'pl_mat'");
            c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[审核],[反审核],[功能],[单价])
                        VALUES(N'pl_mat',N'采购入仓单',1,1,1,1,1,1,1),(N'pl_mat',N'库存月结',1,1,1,1,1,1,1)");
        }
        var client = Client(app, "pl_mat");
        var ym = DateTime.Now.ToString("yyyyMM");
        string? rk = null;
        try
        {
            // 录入并审核一张本月采购入仓
            var body = new { 仓库 = wh, 明细 = new[] { new { 物料编号 = "PLM1", 物料名称 = "锁料", 规格 = "规", 单位 = "KG", 数量 = 10, 单价 = 5 } } };
            var cr = await client.PostAsJsonAsync("/api/purchase-receipts", body);
            Assert.Equal(HttpStatusCode.Created, cr.StatusCode);
            rk = (await cr.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("单号").GetString();
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/purchase-receipts/{rk}/approve", null)).StatusCode);

            // 月结当前月(物料,本仓)
            Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/month-end/close", new { 年月 = ym, 口径 = "物料", 仓库 = wh })).StatusCode);

            // 反审核该单 → 409(锁期)
            Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsync($"/api/purchase-receipts/{rk}/unapprove", null)).StatusCode);
            // 再录入本仓本月单 → 409(锁期)
            Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/purchase-receipts", body)).StatusCode);
        }
        finally
        {
            using var c = new SqlConnection(fx.ConnectionString); c.Open();
            c.Execute("DELETE FROM [结存快照表] WHERE [仓库]=@wh", new { wh });   // 先解锁
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [采购入仓单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'PLM1'");
            c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=N'pl_mat'");
        }
    }
```
注：采购入仓路由确认为 `/api/purchase-receipts`（读 `PurchaseReceiptController` 的 `[Route]`，以实际为准修正路径）。`/api/purchase-receipts/{单号}/approve`、`/unapprove` 同理。`SeedPerms`/`Client`/`Factory`/`Token` 复用文件已有。`using System.Linq;` 文件已加。

- [ ] **Step 2.5: 验证路由**：实现前读三控制器的 `[Route("...")]`，把测试里的 `/api/purchase-receipts` 改成真实路由（领料/退料测试本任务不强制，但物料这条必过）。

- [ ] **Step 3: 跑测试（绿）** — `dotnet test tests/ErpApi.Tests --filter P5MonthEndApiIntegrationTests`（全过）；全量（不回归）。

- [ ] **Step 4: Commit**
```bash
git add src/ErpApi/Features/Materials tests/ErpApi.Tests/P5MonthEndApiIntegrationTests.cs
git commit -m "feat(P5): 物料3单据(采购入仓/领料/退料)硬月结锁期+集成测试"
```

---

## Task 3: 半成品 3 控制器加锁

**Files:** Modify `src/ErpApi/Features/Warehouse/Semi/SemiReceiptController.cs`, `SemiIssueController.cs`, `SemiStocktakeController.cs`.

口径 = `半成品`，单头都有 仓库+日期，create dto 有 `仓库`，标准模式。

- [ ] **Step 1: 三控制器各加锁**（同 Task 2 Step 1 的标准模式：ctor 加 `PeriodLockService periodLock`、`const 口径="半成品"`、Create 用 `EnsureWarehouseOpenAsync(口径, dto.仓库, DateTime.Now)`、Approve/Unapprove 用 `EnsureHeaderOpenAsync(口径, Table, 单号)`，均 try/catch `PeriodLockedException`→409；这些控制器已 `using ErpApi.Engines...`，加 `using ErpApi.Features.MonthEnd;`）。半成品控制器同 namespace `ErpApi.Features.Warehouse.Semi`，`Table` 常量已存在。

- [ ] **Step 2: 集成测试（半成品锁期，至少审核被拒）**

在 `P5MonthEndApiIntegrationTests` 追加一条：造半成品入仓本月审核→月结本月(半成品,仓)→反审核该单 409。半成品入仓需 FK 物料资料(seed)；路由读 `SemiReceiptController` `[Route]`（应为 `/api/semi-receipts`）。结构同 Task2 测试，口径换 `半成品`、表换 `半成品入仓单/明细单`、数量列。明细插入参照 P5cTestData 风格。清理先删快照解锁再删单。

- [ ] **Step 3: 跑测试 + Commit**
```bash
git add src/ErpApi/Features/Warehouse/Semi tests/ErpApi.Tests/P5MonthEndApiIntegrationTests.cs
git commit -m "feat(P5): 半成品3单据(入仓/领料/盘点)硬月结锁期+集成测试"
```

---

## Task 4: 成品 6 控制器加锁（含调拨特殊）

**Files:** Modify `src/ErpApi/Features/Warehouse/Finished/`: FinishedReceiptController, FinishedIssueController, FinishedSalesReturnController, FinishedStocktakeController, FinishedVendorReturnController（5 标准）+ FinishedTransferController（特殊）。

口径 = `成品`。前 5 单头有 仓库+日期、create dto 有 `仓库`，标准模式。

- [ ] **Step 1: 5 个标准成品控制器加锁** — 同标准模式（ctor 加 `PeriodLockService periodLock`、`const 口径="成品"`、Create `EnsureWarehouseOpenAsync(口径, dto.仓库, DateTime.Now)`、Approve/Unapprove `EnsureHeaderOpenAsync(口径, Table, 单号)`，try/catch→409，加 `using ErpApi.Features.MonthEnd;`）。

- [ ] **Step 2: FinishedTransferController（调拨特殊）加锁**
  - ctor 加 `PeriodLockService periodLock`、`const 口径="成品"`、`using System.Linq;` + `using ErpApi.Features.MonthEnd;`。
  - `Create`（保存权限后）：
    ```csharp
    try {
        foreach (var w in dto.明细.SelectMany(l => new[] { l.源仓库, l.目标仓库 })
                     .Where(x => !string.IsNullOrWhiteSpace(x)).Distinct())
            await periodLock.EnsureWarehouseOpenAsync("成品", w, DateTime.Now);
    } catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
    ```
    （`dto.明细` 行字段名以 `FinishedTransferCreateDto` 实际为准——读该 DTO 确认 `源仓库`/`目标仓库`。）
  - `Approve`（审核权限后、posting 前）与 `Unapprove`（反审核权限后、posting 前）：
    ```csharp
    try { await periodLock.EnsureTransferOpenAsync(单号); }
    catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
    ```

- [ ] **Step 3: 集成测试（成品锁期，含调拨）**

在 `P5MonthEndApiIntegrationTests` 追加：①成品入仓本月审核→月结本月(成品,仓)→反审核该单 409；②（可选）成品调拨：源/目标仓中某仓本月已结→调拨该期间 审核 409（验证 `EnsureTransferOpenAsync`）。路由读各控制器 `[Route]`。明细/数量参照成品测试数据风格。清理先删快照解锁。

- [ ] **Step 4: 跑测试 + Commit**
```bash
git add src/ErpApi/Features/Warehouse/Finished tests/ErpApi.Tests/P5MonthEndApiIntegrationTests.cs
git commit -m "feat(P5): 成品6单据(入仓/出仓/退货/盘点/退仓/调拨)硬月结锁期+集成测试"
```

---

## Task 5: 验证 + 收尾（P5 收官）

- [ ] **Step 1: 全量回归** — `Get-Process -Name ErpApi ...|Stop-Process -Force`；`dotnet test tests/ErpApi.Tests`（全过）；`npm --prefix web run test -- --run`（全过）；`npm --prefix web run build`（通过，前端无改动应仍 20）。
- [ ] **Step 2: 终审** — diff 核对：PeriodLockService + Program.cs + 12 控制器都注入 periodLock 且 Create/Approve/Unapprove 均加校验（成品调拨用 Transfer 专用），Delete 未动；测试覆盖物料/半成品/成品三口径。
- [ ] **Step 3: 收尾** — finishing-a-development-branch：合并 master 本地→删分支→重启 5000/5173→更新记忆（erp-status.md 加硬月结锁期条目并标注 **P5 仓储模块收官**，剩余项移出 P5；MEMORY.md 同步，下一步改为 P6 下游）。

---

## Self-Review

- **Spec 覆盖**：PeriodLockService+异常+DI+核心测试(T1)、物料3控制器+测试(T2)、半成品3(T3)、成品6含调拨(T4)、回归收官(T5)。Create+Approve+Unapprove 加锁、Delete 不锁、调拨专用、409、纯后端。✓
- **占位符**：PeriodLockService/DI/核心测试/物料集成测试为完整代码；半成品/成品集成测试给了明确结构与差异点(口径/表/路由/数据风格)而非空话——属"按既有模式套用"，实现子代理读对应控制器与 P5c/成品测试即可套出，符合本仓多控制器同构现状。✓
- **类型/命名一致**：`口径` 值 成品/半成品/物料；`EnsureWarehouseOpenAsync`(录入)/`EnsureHeaderOpenAsync`(标准审核)/`EnsureTransferOpenAsync`(调拨)；`PeriodLockedException`→409；锁规则 年月>=单据月。✓
- **关键坑**：调拨仓库在明细(专用方法)；`table` 仅常量无注入；create 用 dto.仓库+now；Delete 不锁；测试清理先删快照解锁再删单(否则 FK/锁干扰);路由以各控制器实际 `[Route]` 为准;ErpApi 占用先 Stop-Process。✓
