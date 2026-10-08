# 半成品标签单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在“半成品仓库”中交付可新建、保存、打开、复制、前后翻单、审核、反审核、删除和打印标签的“半成品标签单”，并与现有现代 ERP 页面、权限和操作日志保持一致。

**Architecture:** 使用独立的标签单表头/明细表保存业务快照；ASP.NET Core 控制器负责权限、HTTP 状态和日志，Dapper 服务负责事务、单号、校验和产品选择查询；React 页面拆成单据页、产品选择弹窗、历史单据弹窗和打印预览，纯计算集中在工具模块并由 Vitest 覆盖。

**Tech Stack:** SQL Server migration, ASP.NET Core 8, Dapper, xUnit, React 19, TypeScript 6, Ant Design 6, Vitest 4.

## Global Constraints

- 菜单必须位于 `半成品仓库 > 半成品标签单`，路由固定为 `/semi-finished-label-orders`。
- 权限菜单名固定为 `半成品标签单`；“新建”和“保存”都检查现有 `PermissionAction.保存`，不新增权限位。
- 使用现有 `IDocumentNumberGenerator.NextAsync`，单据类型 `半成品标签单`、前缀 `SBL`，首次保存时生成 `SBLyyyyMMddNNN`。
- 已审核单据只读；更新、删除、审核和反审核均由后端重新检查当前状态，不能只依赖前端禁用。
- 产品字段按保存时快照落库；产品选择查询复用现有款号物料/装配数据，不维护第二套产品主数据。
- 数量计算规则唯一来源是 `web/src/utils/semiFinishedLabelOrders.ts`：`ceil(数量 / 每箱数量)`；后端重复执行同等校验，防止绕过前端。
- 不实现“半成品标签查询”页面，不引入桌面打印驱动，不写入截图示例业务数据。
- 工作区已有大量无关改动；每次只暂存本任务明确列出的文件，不运行会覆盖用户文件的格式化或清理命令。

---

## Task 1: 建立标签单数据库结构和权限种子

**Files:**
- Create: `db/migrate_semi_finished_label_orders.sql`
- Create: `db/seed_semi_finished_label_order_perms.sql`
- Modify: `db/run-db.ps1`

- [ ] **Step 1: 写一个会失败的结构检查**

在 `db/migrate_semi_finished_label_orders.sql` 文件末尾暂时加入结构断言，迁移前通过现有部署工具执行时应因为表不存在而失败：

```sql
IF OBJECT_ID(N'[半成品标签单]', N'U') IS NULL
    THROW 51000, N'半成品标签单 migration did not create header table', 1;
IF OBJECT_ID(N'[半成品标签明细]', N'U') IS NULL
    THROW 51000, N'半成品标签单 migration did not create detail table', 1;
```

Run:

```powershell
dotnet run --project tools/DbDeploy -- $env:ERP_TEST_DB db/migrate_semi_finished_label_orders.sql
```

Expected before adding DDL: FAIL with `半成品标签单 migration did not create header table`.

- [ ] **Step 2: 实现幂等迁移**

迁移创建以下结构：

```sql
CREATE TABLE [半成品标签单] (
    [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_半成品标签单] PRIMARY KEY,
    [电脑单号] nvarchar(40) NOT NULL,
    [日期] date NOT NULL,
    [备注一] nvarchar(500) NULL,
    [备注二] nvarchar(500) NULL,
    [操作员] nvarchar(80) NOT NULL,
    [审核] char(1) NOT NULL CONSTRAINT [DF_半成品标签单_审核] DEFAULT ('0'),
    [审核人] nvarchar(80) NULL,
    [审核时间] datetime2 NULL,
    [创建时间] datetime2 NOT NULL CONSTRAINT [DF_半成品标签单_创建时间] DEFAULT (sysdatetime()),
    [更新时间] datetime2 NOT NULL CONSTRAINT [DF_半成品标签单_更新时间] DEFAULT (sysdatetime()),
    CONSTRAINT [UQ_半成品标签单_电脑单号] UNIQUE ([电脑单号]),
    CONSTRAINT [CK_半成品标签单_审核] CHECK ([审核] IN ('0','1'))
);

CREATE TABLE [半成品标签明细] (
    [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_半成品标签明细] PRIMARY KEY,
    [标签单ID] bigint NOT NULL,
    [行号] int NOT NULL,
    [配件编号] nvarchar(80) NOT NULL,
    [客户] nvarchar(160) NULL,
    [产品货号] nvarchar(120) NOT NULL,
    [产品名称] nvarchar(240) NULL,
    [产品装配名称] nvarchar(240) NULL,
    [数量] decimal(18,4) NOT NULL,
    [每箱数量] decimal(18,4) NULL,
    [预计标签数] int NOT NULL,
    [实需标签数] int NOT NULL,
    [实需标签数已手改] bit NOT NULL CONSTRAINT [DF_半成品标签明细_手改] DEFAULT (0),
    [备注] nvarchar(500) NULL,
    CONSTRAINT [FK_半成品标签明细_标签单] FOREIGN KEY ([标签单ID]) REFERENCES [半成品标签单]([ID]) ON DELETE CASCADE,
    CONSTRAINT [UQ_半成品标签明细_标签单_行号] UNIQUE ([标签单ID],[行号]),
    CONSTRAINT [CK_半成品标签明细_数量] CHECK ([数量] >= 0),
    CONSTRAINT [CK_半成品标签明细_预计] CHECK ([预计标签数] >= 0),
    CONSTRAINT [CK_半成品标签明细_实需] CHECK ([实需标签数] >= 0)
);
CREATE INDEX [IX_半成品标签单_日期_ID] ON [半成品标签单]([日期],[ID]);
CREATE INDEX [IX_半成品标签明细_配件编号] ON [半成品标签明细]([配件编号]);
```

使用 `IF OBJECT_ID(...) IS NULL` 和 `IF NOT EXISTS` 包裹创建语句，使重复部署安全。保留 Step 1 的迁移后断言。

- [ ] **Step 3: 写权限种子并接入部署顺序**

`db/seed_semi_finished_label_order_perms.sql` 按项目现有权限种子写法，为 `admin` 和已有角色补齐菜单 `半成品标签单`，默认允许 `打开/保存/删除/打印/审核/反审核`；不创建“新建”权限列。把两个脚本追加在 `db/run-db.ps1` 的半成品共用物料脚本之后。

- [ ] **Step 4: 验证迁移可重复执行**

Run twice:

```powershell
dotnet run --project tools/DbDeploy -- $env:ERP_TEST_DB db/migrate_semi_finished_label_orders.sql db/seed_semi_finished_label_order_perms.sql
```

Expected: 两次均退出码 0；表、索引和权限行不重复。

- [ ] **Step 5: 提交数据库改动**

```powershell
git add db/migrate_semi_finished_label_orders.sql db/seed_semi_finished_label_order_perms.sql db/run-db.ps1
git commit -m "feat: add semi-finished label order schema"
```

## Task 2: 先用数据库测试定义服务行为

**Files:**
- Create: `tests/ErpApi.Tests/SemiFinishedLabelOrderServiceDbTests.cs`
- Create: `src/ErpApi/Features/Warehouse/Semi/Labels/SemiFinishedLabelOrderDtos.cs`

- [ ] **Step 1: 定义 DTO 契约**

创建以下公开类型，字段名与 JSON 和数据库保持一致：

```csharp
public sealed class SemiFinishedLabelOrderLineDto
{
    public long? ID { get; set; }
    public string 配件编号 { get; set; } = "";
    public string? 客户 { get; set; }
    public string 产品货号 { get; set; } = "";
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 每箱数量 { get; set; }
    public int 预计标签数 { get; set; }
    public int 实需标签数 { get; set; }
    public bool 实需标签数已手改 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class SemiFinishedLabelOrderSaveDto
{
    public DateTime 日期 { get; set; }
    public string? 备注一 { get; set; }
    public string? 备注二 { get; set; }
    public List<SemiFinishedLabelOrderLineDto> 明细 { get; set; } = [];
}
```

同时定义 `SemiFinishedLabelOrderDto`（表头、状态、审核信息和有序明细）、`SemiFinishedLabelOrderListRow`、`SemiFinishedLabelProductQuery`、`SemiFinishedLabelProductRow` 和 `AdjacentDirection`。

- [ ] **Step 2: 写失败的服务生命周期测试**

测试构造 `SemiFinishedLabelOrderService(Factory(), new DocumentNumberGenerator())`，覆盖：

```csharp
[SkippableFact]
public async Task Save_load_update_and_delete_unapproved_order()
{
    var saved = await Svc().CreateAsync(ValidDto(), "tester");
    Assert.StartsWith("SBL", saved.电脑单号);
    Assert.Equal(2, saved.明细.Count);
    Assert.Equal(3, saved.明细[0].预计标签数);
    Assert.Equal(3, saved.明细[0].实需标签数);

    var update = ValidDto();
    update.备注一 = "updated";
    await Svc().UpdateAsync(saved.电脑单号, update, "tester");
    Assert.Equal("updated", (await Svc().GetAsync(saved.电脑单号))!.备注一);
    Assert.True(await Svc().DeleteAsync(saved.电脑单号));
}
```

再写：空明细失败、重复配件编号失败、负数量失败、每箱数量为 0 时允许保存但预计必须为 0、非法预计/实需值失败、已审核更新和删除失败、审核/反审核转换、前单/后单排序、产品查询普通/精确和分页。

- [ ] **Step 3: 运行服务测试确认失败**

```powershell
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter FullyQualifiedName~SemiFinishedLabelOrderServiceDbTests
```

Expected: FAIL，提示 `SemiFinishedLabelOrderService` 不存在；若未设置 `ERP_TEST_DB`，测试明确显示 skip 而不是假通过。

- [ ] **Step 4: 提交测试和 DTO**

```powershell
git add tests/ErpApi.Tests/SemiFinishedLabelOrderServiceDbTests.cs src/ErpApi/Features/Warehouse/Semi/Labels/SemiFinishedLabelOrderDtos.cs
git commit -m "test: define semi-finished label order service"
```

## Task 3: 实现标签单服务与产品选择查询

**Files:**
- Create: `src/ErpApi/Features/Warehouse/Semi/Labels/SemiFinishedLabelOrderService.cs`
- Modify: `tests/ErpApi.Tests/SemiFinishedLabelOrderServiceDbTests.cs`

- [ ] **Step 1: 实现集中校验和标签数计算**

服务定义：

```csharp
public const string DocType = "半成品标签单";
public const string Prefix = "SBL";

internal static int CalculateExpected(decimal quantity, decimal? perBox)
    => perBox is > 0 ? checked((int)Math.Ceiling(quantity / perBox.Value)) : 0;
```

`ValidateAndNormalize` 要求至少一行、配件编号和产品货号必填、同一单据配件编号唯一、数量非负、实需标签数非负；后端重新计算预计标签数。新行未手改时把实需标签数同步为预计；已手改时保留客户端值。

- [ ] **Step 2: 实现事务创建与更新**

接口签名：

```csharp
Task<SemiFinishedLabelOrderDto> CreateAsync(SemiFinishedLabelOrderSaveDto dto, string user);
Task<SemiFinishedLabelOrderDto> UpdateAsync(string documentNo, SemiFinishedLabelOrderSaveDto dto, string user);
Task<SemiFinishedLabelOrderDto?> GetAsync(string documentNo);
Task<PagedResult<SemiFinishedLabelOrderListRow>> ListAsync(int page, int size, string? keyword);
```

创建时打开连接和事务，用 `docNo.NextAsync(DocType, Prefix, dto.日期, c, tx)` 生成单号，再写表头和按顺序写明细。更新时用 `UPDLOCK,HOLDLOCK` 读取审核状态，已审核抛 `InvalidOperationException`；在同一事务更新表头、删除旧明细、重写明细。返回值统一通过事务提交后 `GetAsync` 读取完整快照。

- [ ] **Step 3: 实现删除、审核和相邻单据**

```csharp
Task<bool> DeleteAsync(string documentNo);
Task<bool> SetAuditAsync(string documentNo, bool audited, string user);
Task<SemiFinishedLabelOrderDto?> GetAdjacentAsync(string documentNo, AdjacentDirection direction);
```

审核只允许 `0 -> 1`，反审核只允许 `1 -> 0`；更新审核人和审核时间。相邻单据按 `[日期], [ID]` 的稳定顺序查找，不以字符串单号排序。

- [ ] **Step 4: 实现产品选择数据源**

产品查询以 `[款号物料总表]` 最新记录为主，LEFT JOIN `[半成品共用物料设置]`，并以 `[款号物料明细表]` 汇总结果作为客户/款式回退。返回：配件编号、产品装配名称、客户、产品货号、产品名称、加工单价、库存单价、每箱数量。若当前主数据没有每箱数量列则返回 `null`，由用户在标签单明细补录。查询字段白名单为产品货号、产品名称、配件编号、客户、产品装配名称；精确模式用 `=`，普通模式用参数化 `LIKE`；最大页大小 200。

价格字段必须接收 `canSeePrice` 参数；没有单价权限时将加工单价和库存单价置 `null`。

- [ ] **Step 5: 运行数据库服务测试**

```powershell
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter FullyQualifiedName~SemiFinishedLabelOrderServiceDbTests
```

Expected: PASS（配置 `ERP_TEST_DB` 时）；未配置时只允许由 fixture 明确 skip，并在交付说明记录该环境限制。

- [ ] **Step 6: 提交服务实现**

```powershell
git add src/ErpApi/Features/Warehouse/Semi/Labels/SemiFinishedLabelOrderService.cs tests/ErpApi.Tests/SemiFinishedLabelOrderServiceDbTests.cs
git commit -m "feat: implement semi-finished label order service"
```

## Task 4: 暴露 API、权限、日志和菜单目录

**Files:**
- Create: `src/ErpApi/Features/Warehouse/Semi/Labels/SemiFinishedLabelOrderController.cs`
- Modify: `src/ErpApi/Program.cs`
- Modify: `src/ErpApi/Features/Admin/MenuCatalog.cs`
- Create: `tests/ErpApi.Tests/SemiFinishedLabelOrderControllerTests.cs`

- [ ] **Step 1: 写控制器契约测试**

使用现有控制器测试基建验证路由和状态：无打开权限返回 403；不存在返回 404；输入错误 400；审核锁定冲突 409；成功创建返回 201；保存、删除、审核和反审核会调用 `IAuditLogger`。

Run:

```powershell
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter FullyQualifiedName~SemiFinishedLabelOrderControllerTests
```

Expected: FAIL，因为控制器和 DI 尚不存在。

- [ ] **Step 2: 实现 REST 控制器**

固定路由：

```text
GET    /api/semi-finished-label-orders?page=&size=&keyword=
GET    /api/semi-finished-label-orders/{documentNo}
POST   /api/semi-finished-label-orders
PUT    /api/semi-finished-label-orders/{documentNo}
DELETE /api/semi-finished-label-orders/{documentNo}
POST   /api/semi-finished-label-orders/{documentNo}/audit
POST   /api/semi-finished-label-orders/{documentNo}/reverse-audit
GET    /api/semi-finished-label-orders/{documentNo}/adjacent?direction=previous|next
GET    /api/semi-finished-label-orders/products?page=&size=&field=&keyword=&exact=
```

控制器常量 `Menu = "半成品标签单"`、`Table = "半成品标签单"`。GET 检查 `打开`；POST/PUT 检查 `保存`；DELETE 检查 `删除`；审核和反审核检查对应权限；products 价格由 `单价` 权限决定。把 `ArgumentException` 映射为 400、状态冲突映射为 409、缺失单据映射为 404。写操作成功后记录单号和行为。

- [ ] **Step 3: 注册服务和管理目录**

在 `Program.cs` 半成品服务附近加入：

```csharp
builder.Services.AddScoped<SemiFinishedLabelOrderService>();
```

在 `MenuCatalog.All` 的半成品仓库条目中加入：

```csharp
new("半成品仓库", "半成品标签单"),
```

- [ ] **Step 4: 验证后端**

```powershell
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~SemiFinishedLabelOrder"
dotnet build src/ErpApi/ErpApi.csproj
```

Expected: 新测试通过，后端构建退出码 0。

- [ ] **Step 5: 提交 API 层**

```powershell
git add src/ErpApi/Features/Warehouse/Semi/Labels/SemiFinishedLabelOrderController.cs src/ErpApi/Program.cs src/ErpApi/Features/Admin/MenuCatalog.cs tests/ErpApi.Tests/SemiFinishedLabelOrderControllerTests.cs
git commit -m "feat: expose semi-finished label order api"
```

## Task 5: 用纯函数测试锁定前端计算、合并和打印规则

**Files:**
- Create: `web/src/api/semiFinishedLabelOrders.ts`
- Create: `web/src/utils/semiFinishedLabelOrders.ts`
- Create: `web/src/__tests__/semiFinishedLabelOrders.test.ts`

- [ ] **Step 1: 写失败的纯函数测试**

覆盖以下断言：

```ts
expect(calculateExpectedLabels(25, 10)).toBe(3);
expect(calculateExpectedLabels(25, 0)).toBe(0);
expect(recalculateLine(line, { quantity: 25, perBox: 10 }).实际标签数).toBe(3);
expect(recalculateLine({ ...line, 实需标签数已手改: true, 实需标签数: 7 }, { quantity: 25 }).实需标签数).toBe(7);
expect(mergeSelectedProducts(existing, selectedSamePart)).toHaveLength(1);
expect(expandPrintableLabels(lines)).toHaveLength(7);
expect(expandPrintableLabels([{ ...line, 实需标签数: 0 }])).toEqual([]);
```

测试非法负数、非整数实需数和缺失每箱数量的验证错误。

Run:

```powershell
npm --prefix web test -- semiFinishedLabelOrders.test.ts
```

Expected: FAIL，因为工具模块尚不存在。

- [ ] **Step 2: 定义 API 类型和调用**

`semiFinishedLabelOrders.ts` 暴露 `SemiFinishedLabelOrder`、`SemiFinishedLabelOrderLine`、`SemiFinishedLabelProductRow`、`SemiFinishedLabelOrderSave` 类型，以及 `list/get/create/update/remove/audit/reverseAudit/adjacent/products`。所有单号和路径参数使用 `encodeURIComponent`。

- [ ] **Step 3: 实现纯函数**

工具模块导出：

```ts
export function calculateExpectedLabels(quantity: number, perBox?: number | null): number;
export function recalculateLine(line: LabelLine, patch: QuantityPatch): LabelLine;
export function markActualLabelsEdited(line: LabelLine, actual: number): LabelLine;
export function mergeSelectedProducts(lines: LabelLine[], products: ProductRow[]): LabelLine[];
export function validateLabelOrder(order: EditableLabelOrder): ValidationIssue[];
export function expandPrintableLabels(lines: LabelLine[]): PrintableLabel[];
```

合并键为修剪后的配件编号；重复项数量累加、重新计算预计；原行实需数已手改时不覆盖。打印展开项包含产品货号、产品名称、产品装配名称、配件编号、客户、当前序号和该行标签总数。

- [ ] **Step 4: 运行纯函数测试**

```powershell
npm --prefix web test -- semiFinishedLabelOrders.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交前端领域层**

```powershell
git add web/src/api/semiFinishedLabelOrders.ts web/src/utils/semiFinishedLabelOrders.ts web/src/__tests__/semiFinishedLabelOrders.test.ts
git commit -m "feat: add semi-finished label order frontend domain"
```

## Task 6: 实现产品选择和历史单据弹窗

**Files:**
- Create: `web/src/pages/semi/SemiFinishedLabelProductPicker.tsx`
- Create: `web/src/pages/semi/SemiFinishedLabelOrderPicker.tsx`
- Create: `web/src/__tests__/semiFinishedLabelOrderPickers.test.ts`

- [ ] **Step 1: 写弹窗交互测试**

产品弹窗测试字段切换、普通/精确查询、分页、全选、反选、多选确认和关闭；确认回调必须返回选中产品完整快照。历史单据弹窗测试关键字查询、单击选择和双击打开。

Run:

```powershell
npm --prefix web test -- semiFinishedLabelOrderPickers.test.ts
```

Expected: FAIL，因为组件不存在。

- [ ] **Step 2: 实现产品选择弹窗**

使用 `Modal + Select + Input.Search + Table rowSelection`，列为：配件编号、产品装配名称、客户、产品货号、产品名称、加工单价、库存单价。无单价权限时显示 `***`。查询请求使用递增 request id，忽略过期响应。按钮文字和交互对齐参考截图，但使用项目现代 Ant Design 样式。

- [ ] **Step 3: 实现历史单据弹窗**

列表列为电脑单号、日期、操作员、审核状态、明细行数；支持关键字和分页。单击选中，双击或“打开”确认后回传电脑单号。

- [ ] **Step 4: 运行弹窗测试并提交**

```powershell
npm --prefix web test -- semiFinishedLabelOrderPickers.test.ts
git add web/src/pages/semi/SemiFinishedLabelProductPicker.tsx web/src/pages/semi/SemiFinishedLabelOrderPicker.tsx web/src/__tests__/semiFinishedLabelOrderPickers.test.ts
git commit -m "feat: add semi-finished label order pickers"
```

Expected: 测试通过，提交只包含三个文件。

## Task 7: 实现单据页和完整生命周期

**Files:**
- Create: `web/src/pages/semi/SemiFinishedLabelOrderPage.tsx`
- Create: `web/src/__tests__/semiFinishedLabelOrderPage.test.ts`
- Modify: `web/src/nav/menuTree.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: 写页面契约和交互测试**

测试源代码契约：菜单准确位于半成品仓库、路由存在、`MENU = "半成品标签单"`。组件交互覆盖：新建默认日期和操作员、空白行点击打开产品弹窗、多选回填、同配件合并、数量重算、实需手改保护、保存后获得单号、复制清空单号和审核信息、前后翻单、已审核只读、删除确认和关闭返回。

Run:

```powershell
npm --prefix web test -- semiFinishedLabelOrderPage.test.ts
```

Expected: FAIL，因为页面和路由尚不存在。

- [ ] **Step 2: 实现现代单据布局**

页面使用无边框 `Card`，顶部 `Space` 工具栏和项目现有图标按钮。字段区使用响应式 `Form`/CSS grid，表格使用 `scroll={{ x: 1450, y: "calc(100vh - 430px)" }}`，不模拟旧桌面窗口边框。工具栏包含新建、打开、保存、删除、复制单、前单、后单、审核、反审核、表格设置、打印、标识贴、关闭；权限不足或状态不允许时禁用/隐藏。

明细列准确为：删除、序号、配件编号、客户、产品货号、产品名称、产品装配名称、数量、每箱数量、预计标签数、实需标签数、备注。底部固定展示三个合计。

- [ ] **Step 3: 接通生命周期 API**

- 新建清空单号、审核信息和明细。
- 保存期间按钮 loading，接口失败时保留输入。
- 打开、前单和后单用完整 DTO 替换当前页面。
- 复制保留日期、备注和明细快照，但清空单号、审核人和审核时间，状态重置未审核。
- 审核后所有可编辑控件只读；反审核成功后恢复编辑。
- 删除仅允许未审核，成功后回到新建状态。
- 关闭使用 `navigate(-1)`；没有历史时回到 `/`。

- [ ] **Step 4: 接入菜单和路由**

把占位菜单替换为：

```tsx
M("半成品标签单", "/semi-finished-label-orders", "半成品标签单")
```

在 `App.tsx` 导入页面并加入：

```tsx
<Route path="semi-finished-label-orders" element={<SemiFinishedLabelOrderPage />} />
```

- [ ] **Step 5: 运行页面测试和构建**

```powershell
npm --prefix web test -- semiFinishedLabelOrderPage.test.ts semiFinishedLabelOrders.test.ts semiFinishedLabelOrderPickers.test.ts
npm --prefix web run build
```

Expected: 测试通过，TypeScript 和 Vite 构建退出码 0。

- [ ] **Step 6: 提交单据页**

```powershell
git add web/src/pages/semi/SemiFinishedLabelOrderPage.tsx web/src/__tests__/semiFinishedLabelOrderPage.test.ts web/src/nav/menuTree.tsx web/src/App.tsx
git commit -m "feat: add semi-finished label order page"
```

## Task 8: 实现标签打印预览

**Files:**
- Create: `web/src/pages/semi/SemiFinishedLabelPrintPreview.tsx`
- Create: `web/src/pages/semi/SemiFinishedLabelPrintPreview.css`
- Create: `web/src/__tests__/semiFinishedLabelPrintPreview.test.ts`
- Modify: `web/src/pages/semi/SemiFinishedLabelOrderPage.tsx`

- [ ] **Step 1: 写失败的打印测试**

测试：实需标签数 0 的行不渲染；实需 3 的行产生 3 张标签；标签显示产品货号、产品名称、产品装配名称、配件编号、客户和 `1/3`；非法实需数阻止打开预览；打印按钮调用 `window.print()`。

Run:

```powershell
npm --prefix web test -- semiFinishedLabelPrintPreview.test.ts
```

Expected: FAIL，因为预览组件不存在。

- [ ] **Step 2: 实现预览和打印样式**

预览用 `Modal` 显示标签网格；CSS 使用 `@media print` 隐藏应用壳、弹窗按钮和非打印内容，只显示 `.semi-label-print-root`。每张标签设置稳定的物理尺寸和 `break-inside: avoid`，不依赖本地 ActiveX 或专用驱动。

- [ ] **Step 3: 接通“标识贴”和“打印”**

“标识贴”先调用 `validateLabelOrder`，无错误才打开预览；预览内“打印”调用浏览器打印。顶部普通“打印”也进入同一预览，避免出现两套输出逻辑。

- [ ] **Step 4: 运行打印测试并提交**

```powershell
npm --prefix web test -- semiFinishedLabelPrintPreview.test.ts
git add web/src/pages/semi/SemiFinishedLabelPrintPreview.tsx web/src/pages/semi/SemiFinishedLabelPrintPreview.css web/src/__tests__/semiFinishedLabelPrintPreview.test.ts web/src/pages/semi/SemiFinishedLabelOrderPage.tsx
git commit -m "feat: add semi-finished label printing"
```

Expected: 打印测试通过。

## Task 9: 全量验证、浏览器验收和部署可运行性

**Files:**
- Modify only if verification finds a defect in the files listed above.

- [ ] **Step 1: 运行后端验证**

```powershell
dotnet test tests/ErpApi.Tests/ErpApi.Tests.csproj --filter "FullyQualifiedName~SemiFinishedLabelOrder"
dotnet build src/ErpApi/ErpApi.csproj
```

Expected: 构建成功；数据库测试在配置 `ERP_TEST_DB` 时通过，未配置时明确报告 skip。

- [ ] **Step 2: 运行前端专项与全量验证**

```powershell
npm --prefix web test -- semiFinishedLabelOrders.test.ts semiFinishedLabelOrderPickers.test.ts semiFinishedLabelOrderPage.test.ts semiFinishedLabelPrintPreview.test.ts
npm --prefix web test
npm --prefix web run build
```

Expected: 专项测试、全量 Vitest 和生产构建均退出码 0。

- [ ] **Step 3: 启动本地前后端并做视觉验收**

分别启动现有后端和 Vite，打开 `http://localhost:5173/semi-finished-label-orders`。使用浏览器工具验证 1920x1080、1440x900 和 390x844：菜单位置正确，字段和表格无重叠，横向滚动可用，弹窗不超出视口，审核只读生效，打印预览非空且分页稳定。

- [ ] **Step 4: 验证关键业务流**

手工走通：新建 -> 多选产品 -> 编辑数量/每箱 -> 手改实需 -> 保存 -> 打开 -> 复制 -> 前后单 -> 审核 -> 只读 -> 反审核 -> 删除；确认重复配件合并、错误不会清空表单、0 标签不打印。

- [ ] **Step 5: 验证生产部署不依赖 Vite 终端**

确认 `npm --prefix web run build` 产物由服务器既有静态文件托管方式提供，浏览器访问生产站点时不使用 `localhost:5173`。不要用隐藏终端替代服务器部署；关闭 Vite 后本地 5173 拒绝连接是正常行为。

- [ ] **Step 6: 检查范围并提交修复**

```powershell
git status --short
git diff --check
git log --oneline -8
```

Expected: 无空白错误；只出现本计划文件；若验证阶段修复了缺陷，单独提交：

```powershell
git add src/ErpApi/Features/Warehouse/Semi/Labels web/src/pages/semi/SemiFinishedLabelOrderPage.tsx web/src/pages/semi/SemiFinishedLabelPrintPreview.tsx web/src/pages/semi/SemiFinishedLabelPrintPreview.css web/src/utils/semiFinishedLabelOrders.ts
git commit -m "fix: harden semi-finished label order workflow"
```

## Acceptance Checklist

- [ ] `半成品仓库 > 半成品标签单` 可见且路由正确。
- [ ] 页面视觉与项目现代 ERP 页面统一，不复刻旧 Windows 窗口外壳。
- [ ] 产品选择支持普通/精确、全选、反选、多选和价格权限。
- [ ] 同一配件编号自动合并，标签计算和手改保护符合规格。
- [ ] 新建、打开、保存、删除、复制、前后单、审核、反审核均可用。
- [ ] 已审核单据前后端双重只读保护。
- [ ] 标签预览按实需数展开，0 数跳过，浏览器打印可用。
- [ ] 数据表、权限种子、DI、管理菜单、前端菜单和路由全部部署到位。
- [ ] 专项测试、全量前端测试、前后端构建均有最新验证证据。
