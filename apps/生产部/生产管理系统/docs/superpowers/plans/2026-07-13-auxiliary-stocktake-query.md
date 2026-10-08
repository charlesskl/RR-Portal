# Auxiliary Stocktake Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a modern auxiliary stocktake query page with summary/detail tabs and double-click read-only stocktake detail.

**Architecture:** Extend the existing material stocktake query service with an optional warehouse filter, then expose a permission-scoped auxiliary controller that always supplies `辅料仓库`. The React page uses a focused auxiliary API module, the shared `AuxiliaryReportLayout`, and the existing material stocktake detail API for the drawer.

**Tech Stack:** ASP.NET Core 8, Dapper, xUnit, React 19, TypeScript, Ant Design, Vitest, Vite.

## Global Constraints

- Route: `/auxiliary-stocktake-query` under `辅料报表`.
- Backend results must be restricted to warehouse `辅料仓库`.
- Summary and detail fields must match the approved design.
- Double-clicking a detail row opens the corresponding auxiliary stocktake document read-only.
- Do not change create/save/approve behavior of the existing auxiliary stocktake form.
- Use the modern shared auxiliary report layout; do not recreate the legacy desktop window styling.

---

### Task 1: Warehouse-scoped backend query

**Files:**
- Modify: `src/ErpApi/Features/Materials/MaterialStocktake/MaterialStocktakeService.cs`
- Create: `src/ErpApi/Features/Materials/MaterialStocktake/AuxiliaryStocktakeQueryController.cs`
- Modify: `tests/ErpApi.Tests/MaterialStocktakeServiceDbTests.cs`

**Interfaces:**
- Extends: `StocktakeQueryDetailAsync(DateTime? 起, DateTime? 止, string? keyword, string? 物料类别, string? 审核情况, string? 仓库 = null)`
- Extends: `StocktakeQuerySummaryAsync(DateTime? 起, DateTime? 止, string? keyword, string? 物料类别, string? 审核情况, string? 仓库 = null)`
- Produces: `GET /api/auxiliary-stocktake-query/detail` and `/summary`.

- [ ] **Step 1: Write the failing warehouse-isolation database test**

Add a test that inserts two stocktake documents with the same material keyword, one in `辅料仓库` and one in another warehouse, then asserts:

```csharp
var detail = await Svc().StocktakeQueryDetailAsync(null, null, marker, null, null, "辅料仓库");
Assert.NotEmpty(detail);
Assert.All(detail, row => Assert.Equal(auxiliaryNo, row.单号));

var summary = await Svc().StocktakeQuerySummaryAsync(null, null, marker, null, null, "辅料仓库");
Assert.Single(summary);
Assert.Equal(auxiliarySystemQty, summary[0].系统数量);
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter FullyQualifiedName~MaterialStocktakeServiceDbTests
```

Expected: compile failure because the warehouse argument is not accepted yet.

- [ ] **Step 3: Add the optional warehouse SQL filter**

Extend both service methods with `string? 仓库 = null`, normalize it, and add this predicate to detail and summary queries:

```csharp
var warehouse = string.IsNullOrWhiteSpace(仓库) ? null : 仓库.Trim();
// SQL
AND (@warehouse IS NULL OR d.[仓库] = @warehouse)
// parameters
new { 起, 止 = 止Excl, kw, cat, warehouse }
```

Existing callers remain source-compatible because the new parameter is optional.

- [ ] **Step 4: Add the auxiliary permission-scoped controller**

Create a controller with menu `辅料盘点查询` and fixed warehouse:

```csharp
[ApiController]
[Authorize]
[Route("api/auxiliary-stocktake-query")]
public sealed class AuxiliaryStocktakeQueryController(
    MaterialStocktakeService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "辅料盘点查询";
    private const string Warehouse = "辅料仓库";

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(DateTime? 起 = null, DateTime? 止 = null,
        string? keyword = null, string? 物料类别 = null, string? 审核情况 = null)
        => await Allowed()
            ? Ok(await svc.StocktakeQuerySummaryAsync(起, 止, keyword, 物料类别, 审核情况, Warehouse))
            : Forbid();

    [HttpGet("detail")]
    public async Task<IActionResult> Detail(DateTime? 起 = null, DateTime? 止 = null,
        string? keyword = null, string? 物料类别 = null, string? 审核情况 = null)
        => await Allowed()
            ? Ok(await svc.StocktakeQueryDetailAsync(起, 止, keyword, 物料类别, 审核情况, Warehouse))
            : Forbid();
}
```

Implement `Allowed()` using the current authenticated user and `PermissionAction.打开`, matching adjacent controllers.

- [ ] **Step 5: Verify GREEN**

Run the filtered backend test again. Expected: PASS and only auxiliary warehouse rows returned.

---

### Task 2: Frontend query contract and transformation

**Files:**
- Create: `web/src/api/auxiliaryStocktakeQuery.ts`
- Create: `web/src/utils/auxiliaryStocktakeQuery.ts`
- Create: `web/src/__tests__/auxiliaryStocktakeQuery.test.ts`

**Interfaces:**
- Produces: `AuxiliaryStocktakeQueryParams`, `AuxiliaryStocktakeSummaryRow`, `AuxiliaryStocktakeDetailRow`.
- Produces: `buildAuxiliaryStocktakeQuery(...)` for trimmed filters.
- Produces: `auxiliaryStocktakeQueryApi.summary(params)` and `.detail(params)`.

- [ ] **Step 1: Write failing frontend contract tests**

```ts
it("trims auxiliary stocktake filters", () => {
  expect(buildAuxiliaryStocktakeQuery({
    start: "2026-07-01", end: "2026-07-31", keyword: "  A001  ", audit: "全部",
  })).toEqual({ 起: "2026-07-01", 止: "2026-07-31", keyword: "A001" });
});

it("keeps an explicit audit filter", () => {
  expect(buildAuxiliaryStocktakeQuery({ audit: "已审核" })).toEqual({ 审核情况: "已审核" });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm --prefix web run test -- auxiliaryStocktakeQuery
```

Expected: FAIL because the utility module does not exist.

- [ ] **Step 3: Implement minimal types, query builder, and API client**

Use these exact row shapes:

```ts
export interface AuxiliaryStocktakeSummaryRow {
  物料编号?: string; 物料名称?: string; 规格?: string; 单位?: string;
  系统数量?: number | null; 盘点数量?: number | null; 盈亏数量?: number | null;
}

export interface AuxiliaryStocktakeDetailRow extends AuxiliaryStocktakeSummaryRow {
  日期?: string; 单号?: string; 备注?: string; 审核?: string;
}
```

API base path is `/auxiliary-stocktake-query` and sends the built params unchanged.

- [ ] **Step 4: Verify GREEN**

Run the same Vitest command. Expected: PASS.

---

### Task 3: Read-only detail drawer

**Files:**
- Create: `web/src/pages/auxiliary/AuxiliaryStocktakeQueryDetailDrawer.tsx`
- Modify: `web/src/__tests__/auxiliaryStocktakeQuery.test.ts`

**Interfaces:**
- Consumes: `materialStocktakeApi.get(单号)`.
- Produces: `AuxiliaryStocktakeQueryDetailDrawer({ open, 单号, onClose })`.

- [ ] **Step 1: Add a failing source-level behavior test**

```ts
import drawerSource from "../pages/auxiliary/AuxiliaryStocktakeQueryDetailDrawer.tsx?raw";

it("loads a stocktake document by number in the read-only drawer", () => {
  expect(drawerSource).toContain("materialStocktakeApi.get(单号)");
  expect(drawerSource).toContain("辅料盘点单");
  expect(drawerSource).toContain("系统数量");
  expect(drawerSource).toContain("盘点数量");
  expect(drawerSource).toContain("盈亏数量");
});
```

- [ ] **Step 2: Verify RED**

Run the targeted frontend test. Expected: FAIL because the drawer file is absent.

- [ ] **Step 3: Implement the drawer**

Use Ant Design `Drawer`, `Descriptions`, `Tag`, and read-only `Table`. After loading, reject any document whose header warehouse is not `辅料仓库` by clearing data and showing `该盘点单不是辅料仓库单据`.

- [ ] **Step 4: Verify GREEN**

Run the targeted frontend test. Expected: PASS.

---

### Task 4: Modern report page, route, menu, and permissions

**Files:**
- Create: `web/src/pages/auxiliary/AuxiliaryStocktakeQueryPage.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/nav/menuTree.tsx`
- Modify: `web/src/__tests__/auxiliaryMenu.test.ts`
- Modify: `web/src/__tests__/auxiliaryReportTheme.test.ts`
- Modify: `src/ErpApi/Features/Admin/MenuCatalog.cs`
- Create: `db/seed_auxiliary_stocktake_query_perms.sql`

**Interfaces:**
- Consumes: API and drawer from Tasks 2-3.
- Consumes: `AuxiliaryReportLayout` and its shared filter/table styles.
- Produces: route `/auxiliary-stocktake-query`.

- [ ] **Step 1: Write failing menu and style tests**

Add assertions:

```ts
expect(auxiliaryReport.children?.find(x => x.label === "辅料盘点查询")?.path)
  .toBe("/auxiliary-stocktake-query");
expect(pageSource).toContain("AuxiliaryReportLayout");
expect(pageSource).toContain("onDoubleClick");
expect(pageSource).toContain("AuxiliaryStocktakeQueryDetailDrawer");
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm --prefix web run test -- auxiliaryMenu auxiliaryReportTheme auxiliaryStocktakeQuery
```

Expected: FAIL because the route and page do not exist.

- [ ] **Step 3: Implement the page**

Build the page with:

```tsx
<AuxiliaryReportLayout title="辅料盘点查询" recordCount={activeRows.length}>
  <Space wrap>...month buttons, range, category, audit, keyword, query...</Space>
  <Tabs activeKey={tab} items={[summaryTab, detailTab]} />
  <AuxiliaryStocktakeQueryDetailDrawer
    open={viewing !== undefined}
    单号={viewing}
    onClose={() => setViewing(undefined)}
  />
</AuxiliaryReportLayout>
```

Summary columns are `辅料编号/辅料名称/规格/单位/系统数/盘点数/盈亏数`. Detail columns are `日期/单号/辅料编号/辅料名称/规格/单位/系统数量/盘点数量/盈亏数量/备注/审核`. Map backend `物料*` fields to auxiliary labels only at presentation time.

- [ ] **Step 4: Register route, menu, and permission catalog**

Import the page in `App.tsx`, add the route, change the menu placeholder to:

```ts
M("辅料盘点查询", "/auxiliary-stocktake-query", "辅料盘点查询")
```

Add `new("辅料报表", "辅料盘点查询")` to the backend catalog. Seed all standard actions with at least `打开=1` for the admin role, matching adjacent auxiliary report seed scripts.

- [ ] **Step 5: Verify GREEN**

Run the three targeted frontend tests. Expected: PASS.

---

### Task 5: Regression, build, publish, and runtime verification

**Files:**
- No production source changes unless verification exposes a defect.

**Interfaces:**
- Validates all outputs from Tasks 1-4.

- [ ] **Step 1: Run focused backend tests**

```powershell
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter FullyQualifiedName~MaterialStocktakeServiceDbTests
```

Expected: PASS.

- [ ] **Step 2: Run focused frontend tests**

```powershell
npm --prefix web run test -- auxiliaryStocktakeQuery auxiliaryMenu auxiliaryReportTheme
```

Expected: all selected files and tests PASS.

- [ ] **Step 3: Build frontend**

```powershell
npm --prefix web run build
```

Expected: TypeScript and Vite build exit code 0.

- [ ] **Step 4: Publish the combined application**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\publish-windows.ps1
```

Expected: output ends with `Published to: D:\WebpageERP\publish\erpapi`.

- [ ] **Step 5: Restart hidden runtime and verify routes**

Stop only the current listener PIDs on ports 5000/5173, start `scripts\run-published.cmd` through hidden `Start-Process`, then verify:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:5173/auxiliary-stocktake-query -TimeoutSec 5
Invoke-WebRequest -UseBasicParsing http://localhost:5000/swagger -TimeoutSec 5
```

Expected: HTTP 200 for both URLs and one hidden process owns both listeners.

