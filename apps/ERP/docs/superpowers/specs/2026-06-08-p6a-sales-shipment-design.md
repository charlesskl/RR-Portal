# P6a 销售出货 / 退货 设计

> 兴信B ERP 净室重建 · P6 下游(M9)第一切片 · 2026-06-08

**目标**：建成品**销售出货单**与**销售退货单**两个单据族（纯应收层），为应收对账（算法5，P6b）准备数据来源。出货=记应收（数量×单价=金额），退货=逆向冲应收（引用原销售单号）。**不碰成品库存**（库存由 P5a 成品出仓/成品退货负责）、**不算 COGS**（库存单价/金额留 0，待成品加权成本 P7）、**自由录入**（退货引用销售单号带出）。

**已确认决策（与用户）**：
- P6 切三片：P6a 出货/退货 → P6b 收款+应收对账 → P6c 付款+应付对账。装箱、多币种均延后。
- 销售出货/退货 = **纯应收层，不进成品库存账本**（与原系统 出仓/出货 分层一致，避免与 P5a 成品出仓双重扣减）。
- COGS（库存单价/库存金额）本期不算，留空/0。
- 自由录入；退货引用 `销售单号` 带出原销售明细。
- 应收对账报表归 P6b（P6a 只建出货+退货两个数据源）。

---

## 1. 数据模型 — 表已存在，无需建表

`销售出货单`/`销售出货明细单`、`销售退货单`/`销售退货明细单` 均在 `01_rebuild_schema.sql`。

- **审核仅在单头**：两个明细表**无 `审核` 列**（已核：明细列止于 `备注`），与半成品一致。⇒ 审核走引擎②翻单头审核位；**不需要 SyncLineApprovalAsync**；P6b 应收对账 JOIN 单头按 `h.审核='1'` 过滤（算法5 原样：`join 销售出货单 b on a.单号=b.单号 where b.审核='1'`）。
- **白名单已含**：`PostableDocuments` 已含 `销售出货单`/`销售退货单`（单号列=`单号`），审核人/审核日期列由 `03_p0_additions.sql` 补齐。**无新建/ALTER 脚本**。
- 维度：明细按 `物料编号/规格/颜色`（schema 用 `物料编号` 作成品商品码）。
- 金额列：明细 `单价`/`金额`(=数量×单价，售价/应收)；`库存单价`/`库存金额`(COGS) 本期留 0/不写。`条码号`/`批号`/`物料类别` 可空。
- 销售退货头/明细带 `销售单号`（引用原销售出货单号，无 FK 约束，约定串联）。
- `销售出货单.客户编号` → `客户资料` 有 FK（547 → 客户不存在）。

## 2. 后端服务（`src/ErpApi/Features/Sales/`）

### SalesShipmentService（销售出货，前缀 `XS`）
- 两层 Dapper 事务：插单头(客户编号/客户名称/付款方式/仓库/数量=Σ/金额=Σ/操作员/审核'0'/备注) → 插明细(物料编号/物料名称/规格/颜色/单位/数量/单价/金额=数量×单价；库存单价=0/库存金额=0；条码号/批号/物料类别/备注 可空)。明细不写审核列。
- 单号 `XS + yyyyMMdd + 3 位流水`（`IDocumentNumberGenerator`）。
- `CreateAsync(dto, user)`：校验 明细非空、客户编号必填、仓库必填；金额合计/数量合计回写单头。
- `ListAsync(page,size,keyword)`（单号/客户名称模糊）、`GetAsync(单号)`（单头+明细）、`DeleteAsync(单号)`（UPDLOCK/HOLDLOCK 守卫，已审核不可删→InvalidOperationException）。

### SalesReturnService（销售退货，前缀 `XR`）
- 两层 Dapper 事务，头/明细带 `销售单号`（引用原销售出货单号）。结构同出货（物料维度+单价/金额；库存单价/金额留 0）。
- `BasisAsync(销售单号)`：从 `销售出货明细单`（该销售单号）带出 物料编号/物料名称/规格/颜色/单位/数量/单价 作退货基准（供前端带出，不强制按基准；首版可只带出原明细，不做"已退数量"累计——保持简单，超退由业务把控）。
- `CreateAsync/ListAsync/GetAsync/DeleteAsync` 同出货模式。

## 3. 控制器（REST）

- `SalesShipmentController`：`api/sales-shipments`；Menu `销售出货`；Table `销售出货单`。
- `SalesReturnController`：`api/sales-returns`（+ `GET /basis?销售单号=`）；Menu `销售退货`；Table `销售退货单`。
- 模式同半成品控制器：`[ApiController][Authorize]`，9 位权限（打开/保存/删除/审核/反审核），审核 `posting.ApproveAsync(Table,单号,user)` / `UnapproveAsync`，**无 SyncLineApprovalAsync**（不进库存账本）。
- **成本保密**：`Get` 在缺 `单价` 权限时把每行 `单价/金额/库存单价/库存金额` 置 null（沿用现有剥离模式）。
- 审计：Create/Delete 写 AuditLog。
- 异常：`ArgumentException`→400；`SqlException 547`→400（客户不存在）；删除已审核→409。
- **不接 periodLock**：销售出货/退货是应收类，不在月结库存口径（成品/半成品/物料）内，硬月结锁期不适用。
- DI：`Program.cs` 注册 `SalesShipmentService`/`SalesReturnService`。

## 4. 前端

- `web/src/api/sales.ts`：`salesShipmentApi`(list/get/create/remove/approve/unapprove)、`salesReturnApi`(+basis) + 类型。
- 页面 `web/src/pages/sales/`：销售出货页（列表+新建抽屉+明细+审核/反审核）、销售退货页（引用销售单号带出基准）。明细维度 物料编号/规格/颜色/数量/单价/金额——**可复用物料单据组件思路**（MaterialDocPage/CreateDrawer/LineTable 模式），或新建轻量页。
- 菜单：`MainLayout` 新增独立组 **「销售管理」**（key `sale`）→ 销售出货/销售退货；`App.tsx` 加路由 `/sales-shipments`、`/sales-returns`；Header 标题链补。
- 成本保密由服务端剥离落地；前端按权限隐藏金额列（`usePerms('单价')`）或直接渲染所得（null→空）。

## 5. 测试

- 后端 `SalesShipmentServiceDbTests`/`SalesReturnServiceDbTests`：建单(金额=数量×单价回写)、查询、删除护栏(已审核不可删)、退货 BasisAsync 带出原销售明细。需 seed 客户资料(FK)。
- 后端 `P6aSalesApiIntegrationTests`：权限 403、审核/反审核生命周期、成本保密(缺单价→单价/金额 null)、退货引用销售单号。
- 前端 util/组件测试（金额合计、明细校验）。

## 6. 范围外（后续）

应收对账报表（P6b 算法5：出货−收款−退货 按客户）、销售收款（P6b）、付款/应付（P6c）、装箱、多币种、COGS/出货成本（库存单价金额，待成品加权成本）、从客户订单/成品出仓单带出、超退校验。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 与成品出仓双重扣减库存 | 销售出货/退货**不进库存账本**（纯应收）；库存由 P5a 出仓/退货负责。 |
| 明细无审核列 | 审核仅单头（半成品式）；不做 SyncLineApprovalAsync；P6b 应收对账 JOIN 单头审核。 |
| COGS 缺成品成本 | 库存单价/金额留 0，本期不算；待 P7 成品加权成本。 |
| 退货超退 | 首版 BasisAsync 只带出原明细，不做累计已退校验；业务把控，后续可加。 |
| 成本保密 | Get 缺 `单价` 权限置 null（单价/金额/库存单价/库存金额）；审核/删除只用单号。 |
