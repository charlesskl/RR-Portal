# 应收 逐单核销 + 账龄 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 应收逐张出货单核销视图 + 账龄报表(派生只读,零改表) + 销售收款录入带出客户待核销出货单。

**Architecture:** ReceivablesService 加 SettlementAsync/AgingAsync/UnsettledShipmentsAsync(per-invoice 派生:出货Σ−退货Σ(按销售单号)−收款Σ(按出仓单号),审核'1') + ReceivablesController 端点 + 前端应收对账页加逐单核销/账龄Tab + 收款抽屉带出待核销。`src/ErpApi/Features/Sales/`。依据 `docs/superpowers/specs/2026-06-09-ar-settlement-aging-design.md`。样板:现有 ReceivablesService(算法5 UNION)、SalesReceiptService。

---

## Task 1: 后端 — Settlement/Aging/Unsettled + DTO + 端点 + DbTest + API 测试

**Files:** Modify `src/ErpApi/Features/Sales/ReceivablesService.cs`、`SalesDtos.cs`、`ReceivablesController.cs`；Test `tests/ErpApi.Tests/ReceivablesSettlementDbTests.cs`、`P6ArSettlementApiTests.cs`.

- [ ] **Step 1: DTOs** 追加 SalesDtos.cs：
```csharp
public sealed class ReceivableSettlementRow
{ public string? 出货单号 {get;set;} public DateTime? 出货日期 {get;set;} public string? 客户编号 {get;set;} public string? 客户名称 {get;set;}
  public decimal 应收金额 {get;set;} public decimal 退货金额 {get;set;} public decimal 已收金额 {get;set;} public decimal 未核销余额 {get;set;} }
public sealed class ReceivableAgingRow
{ public string? 客户编号 {get;set;} public string? 客户名称 {get;set;}
  public decimal 账龄0_30 {get;set;} public decimal 账龄31_60 {get;set;} public decimal 账龄61_90 {get;set;} public decimal 账龄90以上 {get;set;} public decimal 合计 {get;set;} }
public sealed class UnsettledShipmentRow
{ public string? 出货单号 {get;set;} public DateTime? 出货日期 {get;set;} public decimal 应收金额 {get;set;} public decimal 已收金额 {get;set;} public decimal 未核销余额 {get;set;} }
```

- [ ] **Step 2: ReceivablesService 加方法**（共用 per-invoice 派生子查询常量）：
```csharp
    // per-invoice 派生:每张销售出货单 应收/退货/已收/余额(均审核'1')
    private const string PerInvoice = @"
SELECT s.[单号] AS 出货单号, s.[日期] AS 出货日期, s.[客户编号], s.[客户名称],
       ISNULL(o.应收,0) AS 应收金额, ISNULL(r.退货,0) AS 退货金额, ISNULL(p.已收,0) AS 已收金额,
       ISNULL(o.应收,0)-ISNULL(r.退货,0)-ISNULL(p.已收,0) AS 未核销余额
FROM [销售出货单] s
LEFT JOIN (SELECT [单号],SUM(ISNULL([金额],0)) 应收 FROM [销售出货明细单] GROUP BY [单号]) o ON o.[单号]=s.[单号]
LEFT JOIN (SELECT d.[销售单号],SUM(ISNULL(d.[金额],0)) 退货 FROM [销售退货明细单] d JOIN [销售退货单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1' GROUP BY d.[销售单号]) r ON r.[销售单号]=s.[单号]
LEFT JOIN (SELECT d.[出仓单号],SUM(ISNULL(d.[收款金额],0)) 已收 FROM [销售收款明细单] d JOIN [销售收款单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1' GROUP BY d.[出仓单号]) p ON p.[出仓单号]=s.[单号]
WHERE ISNULL(s.[审核],'0')='1'";

    public async Task<IReadOnlyList<ReceivableSettlementRow>> SettlementAsync(string? 客户编号, bool 仅未结清)
    {
        var 客 = string.IsNullOrWhiteSpace(客户编号) ? null : 客户编号.Trim();
        var sql = $"SELECT * FROM ({PerInvoice} AND (@客 IS NULL OR s.[客户编号]=@客)) t "
                + (仅未结清 ? "WHERE t.未核销余额 > 0.005 " : "")
                + "ORDER BY t.客户编号, t.出货日期, t.出货单号";
        using var c = factory.Create();
        return (await c.QueryAsync<ReceivableSettlementRow>(sql, new { 客 })).AsList();
    }

    public async Task<IReadOnlyList<ReceivableAgingRow>> AgingAsync(string? 客户编号, DateTime? 基准日)
    {
        var 客 = string.IsNullOrWhiteSpace(客户编号) ? null : 客户编号.Trim();
        var 基准 = 基准日 ?? DateTime.Today;
        var sql = $@"
SELECT t.客户编号, MAX(t.客户名称) AS 客户名称,
  SUM(CASE WHEN d<=30 THEN 余 ELSE 0 END) AS 账龄0_30,
  SUM(CASE WHEN d BETWEEN 31 AND 60 THEN 余 ELSE 0 END) AS 账龄31_60,
  SUM(CASE WHEN d BETWEEN 61 AND 90 THEN 余 ELSE 0 END) AS 账龄61_90,
  SUM(CASE WHEN d>90 THEN 余 ELSE 0 END) AS 账龄90以上,
  SUM(余) AS 合计
FROM (SELECT t.客户编号, t.客户名称, DATEDIFF(day, t.出货日期, @基准) AS d, t.未核销余额 AS 余
      FROM ({PerInvoice} AND (@客 IS NULL OR s.[客户编号]=@客)) t WHERE t.未核销余额 > 0.005) t
GROUP BY t.客户编号 ORDER BY t.客户编号";
        using var c = factory.Create();
        return (await c.QueryAsync<ReceivableAgingRow>(sql, new { 客, 基准 })).AsList();
    }

    public async Task<IReadOnlyList<UnsettledShipmentRow>> UnsettledShipmentsAsync(string 客户编号)
    {
        var sql = $"SELECT t.出货单号,t.出货日期,t.应收金额,t.已收金额,t.未核销余额 FROM ({PerInvoice} AND s.[客户编号]=@客) t WHERE t.未核销余额 > 0.005 ORDER BY t.出货日期, t.出货单号";
        using var c = factory.Create();
        return (await c.QueryAsync<UnsettledShipmentRow>(sql, new { 客 = 客户编号 })).AsList();
    }
```
（注:`SELECT *` 外套子查询取派生列;若 Dapper 对 `账龄90以上`/`账龄0_30` 列名映射 OK[中文+下划线属性名匹配]。`基准` 传 DateTime。）

- [ ] **Step 3: 控制器端点** ReceivablesController 加（Menu 应收对账,打开;沿用 CurrentUser/perms）：
```csharp
    [HttpGet("settlement")]
    public async Task<IActionResult> Settlement(string? 客户编号, bool 仅未结清 = false)
    { if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid(); return Ok(await svc.SettlementAsync(客户编号, 仅未结清)); }

    [HttpGet("aging")]
    public async Task<IActionResult> Aging(string? 客户编号, DateTime? 基准日)
    { if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid(); return Ok(await svc.AgingAsync(客户编号, 基准日)); }

    [HttpGet("unsettled")]
    public async Task<IActionResult> Unsettled(string 客户编号)
    { if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
      if (string.IsNullOrWhiteSpace(客户编号)) return BadRequest(new { 消息 = "客户编号必填" });
      return Ok(await svc.UnsettledShipmentsAsync(客户编号)); }
```

- [ ] **Step 4: DbTest** `ReceivablesSettlementDbTests.cs`(`[Collection("db")]`+Factory())：
  - seed 客户资料(AR_C1) + 销售出货单(单号 AR_XS1,客户 AR_C1,日期 d0=固定如 new DateTime(2026,4,1),审核'1')+销售出货明细单(单号 AR_XS1,客户 AR_C1,金额 1000)[守FK:客户/款号/物料编号视明细表FK而定,参照现有 Sales DbTest 种子] + 销售收款单(XK,审核'1')+销售收款明细单(出仓单号=AR_XS1,单号=XK,客户 AR_C1,收款金额 400) + 销售退货单(审核'1')+销售退货明细单(销售单号=AR_XS1,金额 100)。
  - `var svc = new ReceivablesService(Factory());`
  - SettlementAsync("AR_C1",false): 找 出货单号 AR_XS1 行 → 应收=1000,退货=100,已收=400,未核销余额=500。
  - AgingAsync("AR_C1", d0.AddDays(45)): 该客户 账龄31_60=500(45天落 31-60),其余桶0,合计500。
  - UnsettledShipmentsAsync("AR_C1"): 含 AR_XS1 余额500。
  - (可选)再 seed 一笔收款500(出仓单号=AR_XS1)→ SettlementAsync(仅未结清=true) 不含 AR_XS1(余额0)。
  - 清理删 各单头+明细(AR_XS1/XK/退货号)+客户 AR_C1 等。参照现有 Sales*DbTests 的种子/FK 与清理。
- [ ] **Step 5: API 测试** `P6ArSettlementApiTests.cs`：无 应收对账 打开 → GET settlement/aging/unsettled 403;有权限 → settlement/aging 200;unsettled 缺客户编号 → 400。可轻量(不必全 seed,403+200空查询即可)。
- [ ] **Step 6: 测试(绿)+Commit**
```bash
git add src/ErpApi/Features/Sales/ReceivablesService.cs src/ErpApi/Features/Sales/SalesDtos.cs src/ErpApi/Features/Sales/ReceivablesController.cs tests/ErpApi.Tests/ReceivablesSettlementDbTests.cs tests/ErpApi.Tests/P6ArSettlementApiTests.cs
git commit -m "feat(P6): 应收逐单核销+账龄(派生:出货-退货-收款按出货单·DATEDIFF分桶)+待核销出货单+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 前端 — 应收对账加逐单核销/账龄Tab + 收款带出待核销

**Files:** Modify 应收对账 api/页面、销售收款 创建抽屉。先 grep 定位:`grep -rl "应收对账\|receivables\|销售收款" web/src`.

- [ ] **Step 1: api** receivables api 加 `settlement(客户编号?,仅未结清?)`/`aging(客户编号?,基准日?)`/`unsettled(客户编号)` + 类型(SettlementRow/AgingRow/UnsettledRow)。
- [ ] **Step 2: 应收对账页 Tabs** 现有应收对账页(客户汇总)改为 `Tabs`：①客户汇总(现有 list);②逐单核销(筛 客户编号 + 仅未结清 Switch → settlement Table:出货单号/出货日期/客户/应收/退货/已收/未核销余额);③账龄(筛 客户编号 + 基准日 DatePicker → aging Table:客户/账龄0_30/31_60/61_90/90以上/合计)。
- [ ] **Step 3: 收款带出待核销** 销售收款创建抽屉:客户编号填后,「带出待核销出货单」按钮 → `unsettled(客户编号)` → Modal/Table 列出(出货单号/出货日期/应收/已收/余额)+本次收款金额输入(默认=余额) → 勾选确认 → 生成收款明细行(出仓单号=出货单号,货款金额=应收,收款金额=本次,应收金额=余额−本次,客户编号/客户名称)。可改。
- [ ] **Step 4: 构建+测试+Commit**
```bash
npm --prefix web run build; npm --prefix web run test -- --run
git add web/src && git commit -m "feat(P6): 应收对账加逐单核销/账龄Tab+销售收款带出待核销出货单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 验证 + 收尾

- [ ] **Step 1: 全量回归** — 后端 `dotnet test tests/ErpApi.Tests`(全过);前端 test+build(全过)。
- [ ] **Step 2: 终审** — diff:派生SQL 审核'1'口径、余额容差、账龄DATEDIFF分桶、零改表、复用应收对账菜单。
- [ ] **Step 3: 收尾** — finishing-a-development-branch:合并 master 本地→删分支→重启 5000/5173→更新记忆(P6 应收逐单核销+账龄已建[派生零改表],应付AP同构延后)。

---

## Self-Review

- **Spec 覆盖**:Settlement/Aging/Unsettled 服务+端点(T1 Step1-3)、DbTest(应收1000/退货100/已收400/余额500·账龄31_60·待核销)+API(T1 Step4-5)、前端Tabs+收款带出(T2)、回归收尾(T3)。✓
- **占位符**:DTO+三方法 SQL+端点完整;DbTest 给精确数值;前端给明确 Tab/带出步骤。✓
- **类型/命名一致**:api/receivables/{settlement,aging,unsettled};Menu 应收对账;DTO ReceivableSettlementRow/ReceivableAgingRow/UnsettledShipmentRow;余额=出货-退货-收款;账龄桶 0_30/31_60/61_90/90以上。✓
- **关键坑**:派生按 出货单号 关联(退货.销售单号/收款.出仓单号=出货单号),均审核'1';余额容差>0.005;账龄 DATEDIFF(day,出货日期,基准);中文列名→DTO属性映射;DbTest守 Sales 明细表FK(参照现有Sales DbTest);复用应收对账菜单不改MenuCatalog;不脱敏(金额报表);提交带trailer;ErpApi占用先Stop-Process。✓
