# P6c 采购/发外付款 + 应付对账 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 建采购付款单（供应商应付）+ 发外加工付款单（加工厂应付）+ 应付对账（算法5：入仓/回收−付款，按供应商/加工厂两口径）。镜像 P6b。P6 主线收官。

**Architecture:** 两个付款单族 = P6b 收款同款两层 Dapper（半成品式单头审核，无 SyncLineApprovalAsync，纯应付不碰库存、不接 periodLock，成本保密按 `金额` 权限）；应付对账 = Dapper 只读 UNION（供应商口径用采购入仓单头审核+采购付款明细；加工厂口径用发外回收明细审核+发外付款明细），两端点，打开即看金额。零改表。

**Tech Stack:** .NET 8 + Dapper；React + TS + AntD v6 + Vitest；xUnit。依据 `docs/superpowers/specs/2026-06-08-p6c-payments-payables-design.md`。样板：`src/ErpApi/Features/Sales/SalesReceiptService.cs`(+Controller)、`ReceivablesService.cs`。

新建 feature 目录 `src/ErpApi/Features/Payables/`。

---

## Task 1: 采购付款 DTOs + Service + Controller + DI + 权限种子 + DbTest

**Files:** Create `src/ErpApi/Features/Payables/PayablesDtos.cs`、`PurchasePaymentService.cs`、`PurchasePaymentController.cs`；Modify `src/ErpApi/Program.cs`；Create `db/seed_p6c_perms.sql`；Test `tests/ErpApi.Tests/PurchasePaymentServiceDbTests.cs`.

- [ ] **Step 1: PayablesDtos.cs**（含采购付款+发外付款+两应付Row，发外付款DTO供Task2用）：
```csharp
namespace ErpApi.Features.Payables;

// ---- 采购付款（供应商级挂账） ----
public sealed class PurchasePaymentLineDto
{ public string? 供应商编号 { get; set; } public string? 供应商名称 { get; set; } public decimal 付款金额 { get; set; } public decimal? 货款金额 { get; set; } public decimal? 尚欠金额 { get; set; } public string? 入仓单号 { get; set; } }
public sealed class PurchasePaymentCreateDto
{ public string? 入仓单号 { get; set; } public string? 备注 { get; set; } public List<PurchasePaymentLineDto> 明细 { get; set; } = []; }
public sealed class PurchasePaymentHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 入仓单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class PurchasePaymentLineRowDto
{
    public long ID { get; set; }
    public string? 入仓单号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public decimal? 货款金额 { get; set; }
    public decimal? 付款金额 { get; set; }
    public decimal? 尚欠金额 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class PurchasePaymentDetailDto
{ public PurchasePaymentHeaderDto? 单头 { get; set; } public List<PurchasePaymentLineRowDto> 明细 { get; set; } = []; }

// ---- 发外加工付款（加工厂级挂账） ----
public sealed class OutsourcePaymentLineDto
{ public string? 加工厂编号 { get; set; } public string? 加工厂名称 { get; set; } public decimal 付款金额 { get; set; } public decimal? 货款金额 { get; set; } public decimal? 尚欠金额 { get; set; } public string? 发外单号 { get; set; } }
public sealed class OutsourcePaymentCreateDto
{ public string? 发外单号 { get; set; } public string? 备注 { get; set; } public List<OutsourcePaymentLineDto> 明细 { get; set; } = []; }
public sealed class OutsourcePaymentHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 发外单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class OutsourcePaymentLineRowDto
{
    public long ID { get; set; }
    public string? 发外单号 { get; set; }
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public decimal? 货款金额 { get; set; }
    public decimal? 付款金额 { get; set; }
    public decimal? 尚欠金额 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class OutsourcePaymentDetailDto
{ public OutsourcePaymentHeaderDto? 单头 { get; set; } public List<OutsourcePaymentLineRowDto> 明细 { get; set; } = []; }

// ---- 应付对账 ----
public sealed class PayableSupplierRow
{ public string? 供应商编号 { get; set; } public string? 供应商名称 { get; set; } public decimal 入仓金额 { get; set; } public decimal 付款金额 { get; set; } public decimal 应付余额 { get; set; } }
public sealed class PayableFactoryRow
{ public string? 加工厂编号 { get; set; } public string? 加工厂名称 { get; set; } public decimal 回收金额 { get; set; } public decimal 付款金额 { get; set; } public decimal 应付余额 { get; set; } }
```

- [ ] **Step 2: PurchasePaymentService.cs**（镜像 `SalesReceiptService`，前缀 CF，表 采购付款单/采购付款明细单，明细字段供应商编号/供应商名称/货款金额/付款金额/尚欠金额/入仓单号）。完整代码照 `SalesReceiptService` 改表名/列名/前缀/DTO；CreateAsync 头金额=Σ付款金额；明细 INSERT 列 `[入仓单号],[单号],[日期],[供应商编号],[供应商名称],[货款金额],[付款金额],[尚欠金额],[备注]`；ListAsync/GetAsync SELECT 头含 `[审核人]`（采购付款单有该列）；DeleteAsync UPDLOCK 守卫。

- [ ] **Step 3: PurchasePaymentController.cs**（镜像 `SalesReceiptController`：`api/purchase-payments`、Menu `采购付款`、Table `采购付款单`；Get 缺 `金额` 权限剥离 货款金额/付款金额/尚欠金额；Create 547→"供应商不存在"；审核引擎②无同步）。

- [ ] **Step 4: DI** `Program.cs` 追加（Sales 注册附近）：
```csharp
builder.Services.AddScoped<ErpApi.Features.Payables.PurchasePaymentService>();
```

- [ ] **Step 5: 权限种子** `db/seed_p6c_perms.sql`：
```sql
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'采购付款',N'发外付款',N'应付对账');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'采购付款',1,1,1,1,1,1,1,1,1),
       (@用户,N'发外付款',1,1,1,1,1,1,1,1,1),
       (@用户,N'应付对账',1,0,0,1,0,1,0,0,1);
```

- [ ] **Step 6: DbTest** `tests/ErpApi.Tests/PurchasePaymentServiceDbTests.cs`（镜像 `SalesReceiptServiceDbTests`：seed 供应商资料 P6CS1；建付款单两行付款金额30+20→头金额50；审核后删409→反审核删ok）。seed/清理用 `供应商资料`（FK）。

- [ ] **Step 7: 测试（绿）+ Commit** — `Get-Process -Name ErpApi ...|Stop-Process -Force`；`dotnet test tests/ErpApi.Tests --filter PurchasePaymentServiceDbTests`（过）；全量(167)。
```bash
git add src/ErpApi/Features/Payables src/ErpApi/Program.cs db/seed_p6c_perms.sql tests/ErpApi.Tests/PurchasePaymentServiceDbTests.cs
git commit -m "feat(P6): 采购付款服务+REST(供应商级挂账·成本保密按金额权限·审核仅单头)+权限种子+DbTest"
```

---

## Task 2: 发外加工付款 Service + Controller + DI + DbTest

**Files:** Create `src/ErpApi/Features/Payables/OutsourcePaymentService.cs`、`OutsourcePaymentController.cs`；Modify `src/ErpApi/Program.cs`；Test `tests/ErpApi.Tests/OutsourcePaymentServiceDbTests.cs`.

- [ ] **Step 1: OutsourcePaymentService.cs** — 镜像 PurchasePaymentService，前缀 `FF`，表 发外加工付款单/发外加工付款明细单，明细字段 加工厂编号/加工厂名称/货款金额/付款金额/尚欠金额/发外单号（头 INSERT 列 `[发外单号],[单号],[日期],[金额],[操作员],[审核],[备注]`；明细 INSERT 列 `[发外单号],[单号],[日期],[加工厂编号],[加工厂名称],[货款金额],[付款金额],[尚欠金额],[备注]`）。DocType `发外加工付款单`。
- [ ] **Step 2: OutsourcePaymentController.cs** — `api/outsource-payments`、Menu `发外付款`、Table `发外加工付款单`；Get 缺 `金额` 剥离 货款/付款/尚欠金额；Create 547→"加工厂不存在"。
- [ ] **Step 3: DI** 追加 `builder.Services.AddScoped<ErpApi.Features.Payables.OutsourcePaymentService>();`
- [ ] **Step 4: DbTest** `OutsourcePaymentServiceDbTests.cs` — seed 加工厂资料 P6CF1；建付款两行→头金额；删除护栏。
- [ ] **Step 5: 测试（绿）+ Commit**
```bash
git add src/ErpApi/Features/Payables/OutsourcePaymentService.cs src/ErpApi/Features/Payables/OutsourcePaymentController.cs src/ErpApi/Program.cs tests/ErpApi.Tests/OutsourcePaymentServiceDbTests.cs
git commit -m "feat(P6): 发外加工付款服务+REST(加工厂级挂账)+DbTest"
```

---

## Task 3: 应付对账 Service + Controller + DI + DbTest + API 测试

**Files:** Create `src/ErpApi/Features/Payables/PayablesService.cs`、`PayablesController.cs`；Modify `src/ErpApi/Program.cs`；Test `tests/ErpApi.Tests/PayablesServiceDbTests.cs`、`tests/ErpApi.Tests/P6cPayablesApiIntegrationTests.cs`.

- [ ] **Step 1: PayablesService.cs**（只读 Dapper，两方法）：
```csharp
using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Payables;

// 应付对账(算法5 AP)：供应商=采购入仓−采购付款；加工厂=发外回收−发外付款。各 JOIN/过滤 审核='1'。只读。
public sealed class PayablesService(ISqlConnectionFactory factory)
{
    private const string SupplierSql = @"
SELECT 供应商编号, MAX(供应商名称) AS 供应商名称,
       SUM(CASE WHEN 类型='入仓' THEN 金额 ELSE 0 END) AS 入仓金额,
       SUM(CASE WHEN 类型='付款' THEN 金额 ELSE 0 END) AS 付款金额,
       SUM(CASE WHEN 类型='入仓' THEN 金额 WHEN 类型='付款' THEN -金额 ELSE 0 END) AS 应付余额
FROM (
    SELECT 供应商编号, 供应商名称, '入仓' AS 类型, ISNULL(金额,0) AS 金额
      FROM [采购入仓单] WHERE ISNULL(审核,'0')='1'
    UNION ALL
    SELECT d.供应商编号, d.供应商名称, '付款', ISNULL(d.付款金额,0)
      FROM [采购付款明细单] d JOIN [采购付款单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1'
) t WHERE @供应商编号 IS NULL OR 供应商编号=@供应商编号
GROUP BY 供应商编号 ORDER BY 供应商编号;";

    private const string FactorySql = @"
SELECT 加工厂编号, MAX(加工厂名称) AS 加工厂名称,
       SUM(CASE WHEN 类型='回收' THEN 金额 ELSE 0 END) AS 回收金额,
       SUM(CASE WHEN 类型='付款' THEN 金额 ELSE 0 END) AS 付款金额,
       SUM(CASE WHEN 类型='回收' THEN 金额 WHEN 类型='付款' THEN -金额 ELSE 0 END) AS 应付余额
FROM (
    SELECT 加工厂编号, 加工厂名称, '回收' AS 类型, ISNULL(金额,0) AS 金额
      FROM [发外回收明细单] WHERE ISNULL(审核,'0')='1'
    UNION ALL
    SELECT d.加工厂编号, d.加工厂名称, '付款', ISNULL(d.付款金额,0)
      FROM [发外加工付款明细单] d JOIN [发外加工付款单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1'
) t WHERE @加工厂编号 IS NULL OR 加工厂编号=@加工厂编号
GROUP BY 加工厂编号 ORDER BY 加工厂编号;";

    public async Task<IReadOnlyList<PayableSupplierRow>> SupplierAsync(string? 供应商编号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<PayableSupplierRow>(SupplierSql, new { 供应商编号 = string.IsNullOrWhiteSpace(供应商编号) ? null : 供应商编号.Trim() });
        return rows.AsList();
    }
    public async Task<IReadOnlyList<PayableFactoryRow>> FactoryAsync(string? 加工厂编号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<PayableFactoryRow>(FactorySql, new { 加工厂编号 = string.IsNullOrWhiteSpace(加工厂编号) ? null : 加工厂编号.Trim() });
        return rows.AsList();
    }
}
```

- [ ] **Step 2: PayablesController.cs**：
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Payables;

// 应付对账(算法5 只读报表)。有「应付对账」打开权限即看金额(不逐列脱敏)。
[ApiController]
[Authorize]
[Route("api/payables")]
public sealed class PayablesController(PayablesService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "应付对账";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet("supplier")]
    public async Task<IActionResult> Supplier([FromQuery(Name = "供应商编号")] string? 供应商编号 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.SupplierAsync(供应商编号));
    }

    [HttpGet("factory")]
    public async Task<IActionResult> Factory([FromQuery(Name = "加工厂编号")] string? 加工厂编号 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.FactoryAsync(加工厂编号));
    }
}
```

- [ ] **Step 3: DI** 追加 `builder.Services.AddScoped<ErpApi.Features.Payables.PayablesService>();`

- [ ] **Step 4: DbTest** `PayablesServiceDbTests.cs`：
  - 供应商：seed 供应商资料 P6CS9 + 采购入仓单(供应商P6CS9,金额100,审核'1') + 采购付款单+明细(供应商P6CS9,付款金额30,审核'1') → SupplierAsync(P6CS9) 应付余额=70(入仓100−付款30)。
  - 加工厂：seed 加工厂资料 P6CF9 + 发外回收明细单(加工厂P6CF9,金额80,审核'1'——注意发外回收明细单的审核在明细且需 发外回收单 主从? 发外回收明细单.单号→发外回收单 主从FK,故须先插 发外回收单 头;加工厂编号/款号等 FK 视情 seed) + 发外加工付款单+明细(加工厂P6CF9,付款金额20,审核'1') → FactoryAsync(P6CF9) 应付余额=60(回收80−付款20)。
  - 用直接 SQL 造数;插明细前先插各自单头(主从FK);发外回收明细单可能 FK 款号/生产单号/加工项目等→相应 seed 或留 NULL(FK 允许 NULL 的留空);清理删明细/单头/主数据。**实现时先 grep db/02_rebuild_relations.sql 看发外回收明细单/采购入仓单 的 NOT-NULL FK,按需 seed**(参照 P4/P5 测试数据)。

- [ ] **Step 5: API 集成测试** `P6cPayablesApiIntegrationTests.cs`（仿 P6b）：①付款无保存权限→403;②采购付款全权限生命周期(create→approve→删已审核409→unapprove→delete);③采购付款缺金额权限 Get→金额列null;④应付对账 无打开→403、有打开→supplier/factory 两端点 200。seed 供应商资料/加工厂资料 FK;权限种子内联(含金额列)。

- [ ] **Step 6: 测试（绿）+ Commit**
```bash
git add src/ErpApi/Features/Payables/PayablesService.cs src/ErpApi/Features/Payables/PayablesController.cs src/ErpApi/Program.cs tests/ErpApi.Tests/PayablesServiceDbTests.cs tests/ErpApi.Tests/P6cPayablesApiIntegrationTests.cs
git commit -m "feat(P6): 应付对账(算法5:供应商=入仓-付款/加工厂=回收-付款·两端点·打开即看)+DbTest+API测试"
```

---

## Task 4: 前端 — 采购付款/发外付款页 + 应付对账页 + 应付管理菜单

**Files:** Create `web/src/api/payables.ts`、`web/src/utils/payLines.ts`、`web/src/__tests__/payables.test.ts`、`web/src/pages/payables/PurchasePaymentPage.tsx`、`OutsourcePaymentPage.tsx`、`PayablesPage.tsx`；Modify `web/src/App.tsx`、`web/src/pages/MainLayout.tsx`.

- [ ] **Step 1: api** `web/src/api/payables.ts`：`purchasePaymentApi`/`outsourcePaymentApi`(list/get/create/remove/approve/unapprove)、`payablesApi.supplier(供应商编号?)`/`payablesApi.factory(加工厂编号?)` + 类型(付款明细=对方+付款金额;PayableSupplierRow/PayableFactoryRow)。
- [ ] **Step 2: util+单测** `payLines.ts`:`sumPay(lines)`=Σ付款金额;`payables.test.ts` 断言。
- [ ] **Step 3: 页面** 采购付款页/发外付款页(仿 P6b 收款页,明细=对方编号/名称+付款金额,审核/反审核/删除,金额列按 `can(MENU,'金额')` 显隐);应付对账页(口径 Select 供应商/加工厂 切换两端点;列 对方/入仓或回收金额/付款金额/应付余额;应付余额>0 红)。
- [ ] **Step 4: 菜单+路由** 新独立组 **「应付管理」**(key `ap`,图标如 `AccountBookOutlined`):采购付款(`can('采购付款','打开')`)/发外付款(`can('发外付款','打开')`)/应付对账(`can('应付对账','打开')`);`App.tsx` 路由 `/purchase-payments`、`/outsource-payments`、`/payables`;Header 标题链补。图标按需加 import。
- [ ] **Step 5: 构建+测试+Commit** — `npm --prefix web run build`(无TS错);`npm --prefix web run test -- --run`(全过);
```bash
git add web/src && git commit -m "feat(P6): 应付管理菜单+采购/发外付款页+应付对账页+api+util测试"
```

---

## Task 5: 验证 + 收尾（P6 主线收官）

- [ ] **Step 1: 全量回归** — 后端 `dotnet test tests/ErpApi.Tests`(全过)；前端 test+build(全过)。
- [ ] **Step 2: 终审** — diff 核对:两付款服务/控制器纯应付不碰库存、无 SyncLineApprovalAsync、成本保密按金额权限;应付对账两端点打开权限;入仓段用采购入仓单头审核、回收段用发外回收明细审核;零改表。
- [ ] **Step 3: 授权种子** — `dotnet run --project tmp/dbquery -- $env:ERP_DB "@db/seed_p6c_perms.sql"`。
- [ ] **Step 4: 收尾** — finishing-a-development-branch：合并 master 本地→删分支→重启 5000/5173→更新记忆(erp-status 加 P6c 条目并标注 **P6 主线收官**[出货/收付款/应收应付闭环],剩余装箱/多币种;MEMORY.md 同步)。

---

## Self-Review

- **Spec 覆盖**：采购付款全栈+权限种子(T1)、发外付款全栈(T2)、应付对账双口径+API(T3)、前端(T4)、回归收官(T5)。供应商/加工厂级挂账、两端点、入仓段单头审核/回收段明细审核、半成品式无同步、成本保密按金额、不碰库存不锁期、零改表——均落实。✓
- **占位符**：DTOs/PayablesService/PayablesController/权限种子为完整代码;付款服务/控制器=P6b `SalesReceiptService`/`SalesReceiptController` 镜像(给明确表名/列名/前缀/DTO映射);DbTest/API测试给明确结构+样板引用。✓
- **类型/命名一致**：DocType 采购付款单/发外加工付款单;前缀 CF/FF;Menu 采购付款/发外付款/应付对账;路由 api/purchase-payments、api/outsource-payments、api/payables/{supplier,factory};DTO Purchase/Outsource Payment* + PayableSupplierRow/PayableFactoryRow;付款成本保密按 `金额` 权限。✓
- **关键坑**：付款明细无审核列→无SyncLineApprovalAsync(应付付款段JOIN单头审核);**入仓段用采购入仓单头审核、回收段用发外回收明细自带审核**(不一致,勿统一);发外回收明细单主从FK需先插发外回收单头+按需seed NOT-NULL FK;对方FK 547→400;UPDLOCK删除守卫;不接periodLock;ErpApi占用先Stop-Process。✓
