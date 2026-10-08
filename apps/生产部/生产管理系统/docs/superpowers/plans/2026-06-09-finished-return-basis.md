# 成品退货/退仓 带出原单基准 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 成品退货/退仓创建时按 出仓单号/入仓单号 带出原单明细(BasisAsync),体验对齐其它退类单据。零改表。

**Architecture:** FinishedSalesReturnService.BasisAsync(出仓单号)从成品出仓明细单带行 + FinishedVendorReturnService.BasisAsync(入仓单号)从成品入仓明细单带行 + 两控制器 GET basis(单价脱敏) + 前端带出按钮。`src/ErpApi/Features/Warehouse/Finished/`。依据 `docs/superpowers/specs/2026-06-09-finished-return-basis-design.md`。样板:`Sales/SalesReturnService.BasisAsync`、本目录控制器现有 Get 的 单价 脱敏。

---

## Task 1: 后端 — 两 BasisAsync + DTO + 控制器端点 + DbTest + API 测试

**Files:** Modify `src/ErpApi/Features/Warehouse/Finished/FinishedDtos.cs`、`FinishedSalesReturnService.cs`、`FinishedVendorReturnService.cs`、`FinishedSalesReturnController.cs`、`FinishedVendorReturnController.cs`；Test `tests/ErpApi.Tests/FinishedReturnBasisDbTests.cs`、`P5bReturnBasisApiTests.cs`.

- [ ] **Step 1: DTOs** 追加 FinishedDtos.cs：
```csharp
public sealed class FinishedSalesReturnBasisRow
{ public string? 客户编号 {get;set;} public string? 客户名称 {get;set;} public string? 仓库 {get;set;} public string? 生产单号 {get;set;}
  public string? 款号 {get;set;} public string? 款式 {get;set;} public string? 床号 {get;set;} public string? 色号 {get;set;}
  public string? 颜色 {get;set;} public string? 尺码 {get;set;} public decimal? 数量 {get;set;} public decimal? 单价 {get;set;} }
public sealed class FinishedVendorReturnBasisRow
{ public string? 供应商编号 {get;set;} public string? 供应商名称 {get;set;} public string? 仓库 {get;set;} public string? 生产单号 {get;set;}
  public string? 款号 {get;set;} public string? 款式 {get;set;} public string? 床号 {get;set;} public string? 色号 {get;set;}
  public string? 颜色 {get;set;} public string? 尺码 {get;set;} public decimal? 数量 {get;set;} public decimal? 单价 {get;set;} }
```

- [ ] **Step 2: BasisAsync** 加到两服务（注入已有 ISqlConnectionFactory factory）：
```csharp
// FinishedSalesReturnService
public async Task<IReadOnlyList<FinishedSalesReturnBasisRow>> BasisAsync(string 出仓单号)
{
    using var c = factory.Create();
    return (await c.QueryAsync<FinishedSalesReturnBasisRow>(@"
SELECT [客户编号],[客户名称],[仓库],[生产单号],[款号],[款式],[床号],[色号],[颜色],[尺码],[数量],[单价]
FROM [成品出仓明细单] WHERE [单号]=@出仓单号 ORDER BY [ID]", new { 出仓单号 })).AsList();
}
```
```csharp
// FinishedVendorReturnService
public async Task<IReadOnlyList<FinishedVendorReturnBasisRow>> BasisAsync(string 入仓单号)
{
    using var c = factory.Create();
    return (await c.QueryAsync<FinishedVendorReturnBasisRow>(@"
SELECT [供应商编号],[供应商名称],[仓库],[生产单号],[款号],[款式],[床号],[色号],[颜色],[尺码],[数量],[单价]
FROM [成品入仓明细单] WHERE [单号]=@入仓单号 ORDER BY [ID]", new { 入仓单号 })).AsList();
}
```

- [ ] **Step 3: 控制器端点**（仿同文件 Get 的 打开 + 单价脱敏）：
  - `FinishedSalesReturnController` 加 `[HttpGet("basis")] Basis(string 出仓单号)`：`打开` 否则 Forbid;`var rows = await svc.BasisAsync(出仓单号);` 若 `!await AllowAsync(PermissionAction.单价)` 则 `foreach(var r in rows) r.单价=null;`;Ok(rows)。
  - `FinishedVendorReturnController` 加 `[HttpGet("basis")] Basis(string 入仓单号)` 同上(svc.BasisAsync(入仓单号))。
- [ ] **Step 4: DbTest** `FinishedReturnBasisDbTests.cs`(`[Collection("db")]`+Factory())：
  - seed 成品出仓单(单号 RB_CC1) + 成品出仓明细单 2行(RB_CC1,款号 K1,色号/颜色/尺码,数量 10/5,单价 8)[FK:款号→款号总表?若有FK需先种,参照现有 FinishedIssue DbTest 的种子]。`new FinishedSalesReturnService(Factory()).BasisAsync("RB_CC1")` → 2行,款号 K1,数量含10,单价 8。
  - seed 成品入仓单(RB_CR1)+成品入仓明细单 2行 → `FinishedVendorReturnService.BasisAsync("RB_CR1")` 2行。
  - 清理删两明细+单头(RB_*)。
  - 注:种子按现有 FinishedReceiptService/FinishedIssueService DbTest 的 FK 顺序(款号总表/客户/供应商若有FK)。参照 `tests/ErpApi.Tests` 内成品相关 DbTest。
- [ ] **Step 5: API 测试** `P5bReturnBasisApiTests.cs`：有 成品退货 打开+单价 权限 + seed 出仓明细 → GET `/api/.../basis?出仓单号=RB_CC1`(用实际路由,见控制器 Route) 200 带行单价非空;去掉单价权限 → 单价=null;无打开 → 403。成品退仓同理一条。清理。
  （路由前缀以 FinishedSalesReturnController/FinishedVendorReturnController 的 [Route] 为准。）
- [ ] **Step 6: 测试(绿)+Commit**
```bash
git add src/ErpApi/Features/Warehouse/Finished tests/ErpApi.Tests/FinishedReturnBasisDbTests.cs tests/ErpApi.Tests/P5bReturnBasisApiTests.cs
git commit -m "feat(P5): 成品退货/退仓带出原单基准(BasisAsync从出仓/入仓明细单·单价脱敏)+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 前端 — 带出原单按钮（成品退货/退仓 创建抽屉）

**Files:** Modify `web/src/api/`(成品退货/退仓 api)、`web/src/pages/finished/`(两创建抽屉)。先 grep 定位:`grep -rl "成品退货\|成品退仓\|出仓单号\|入仓单号" web/src`。

- [ ] **Step 1: api** 两 api 加 `basis(出仓单号)` / `basis(入仓单号)`:GET `/.../basis?出仓单号=`、`?入仓单号=` → 行数组类型。
- [ ] **Step 2: 创建抽屉** 成品退货创建抽屉:出仓单号 Input 旁加「带出原单」Button → `basis(出仓单号)` → 预填 单头(客户编号/客户名称/仓库/生产单号/款号/款式/床号 取首行) + 明细行(色号/颜色/尺码/数量/单价);成品退仓同理(入仓单号→供应商/...)。带出前若已有明细,提示将替换(message 或 Popconfirm)。空结果 message.warning("原单无明细")。
- [ ] **Step 3: 构建+测试+Commit**
```bash
npm --prefix web run build; npm --prefix web run test -- --run
git add web/src && git commit -m "feat(P5): 成品退货/退仓创建抽屉加带出原单按钮(预填单头+明细)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 验证 + 收尾

- [ ] **Step 1: 全量回归** — 后端 `dotnet test tests/ErpApi.Tests`(全过)；前端 test+build(全过)。
- [ ] **Step 2: 终审** — diff:仅新增 BasisAsync+端点+前端按钮;单价脱敏一致;零改表。
- [ ] **Step 3: 收尾** — finishing-a-development-branch:合并 master 本地→删分支→重启 5000/5173→更新记忆(P5 成品退货/退仓带出原单基准已补,退类单据带出基准体验统一)。

---

## Self-Review

- **Spec 覆盖**:两 BasisAsync+DTO+端点(T1 Step1-3)、DbTest+API(T1 Step4-5)、前端带出按钮(T2)、回归收尾(T3)。✓
- **占位符**:DTO+BasisAsync+端点脱敏完整;DbTest/前端给明确步骤(种子按现有成品DbTest的FK顺序、路由以控制器Route为准)。✓
- **类型/命名一致**:FinishedSalesReturnBasisRow/FinishedVendorReturnBasisRow;BasisAsync(出仓单号)/(入仓单号);端点 GET basis;单价脱敏 PermissionAction.单价。✓
- **关键坑**:成品出仓明细单按[单号]=出仓单号查、成品入仓明细单按[单号]=入仓单号;单价无权限置null(同现有Get);DbTest种子守FK(款号总表/客户/供应商);路由前缀以[Route]为准;带出为显式按钮预填可改不校验超退;提交带trailer;ErpApi占用先Stop-Process。✓
