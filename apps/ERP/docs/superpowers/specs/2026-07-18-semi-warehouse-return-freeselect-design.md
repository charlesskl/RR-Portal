# 半成品退仓单（自由选产品版）设计

> 本文取代 `2026-07-16-semi-warehouse-return.md` 中「按原入仓单核销可退数量」的旧模型。
> 依据用户提供的原系统截图（半成品退仓单主界面 + “资料”产品选择器），改为**自由选产品**模型。

## 目标

在「半成品仓库 > 半成品退仓单」交付可新建、保存、打开、复制、刷新、前后翻单、审核、反审核、删除、打印的全屏主从录入单：把某张已审核半成品入仓单对应供应商/仓库下的半成品，**自由选取产品**后录入退仓数量退回供应商；审核后按实时台账减半成品库存。前端与现有现代 ERP 页面（半成品标签单）骨架、权限、脱敏、操作日志保持一致。

## 与旧模型的差异（核心）

| 维度 | 旧 WIP（受票核销） | 本设计（自由选产品，按截图） |
|---|---|---|
| 明细来源 | 选原入仓单 → “选择原入仓产品”弹窗，带出 `入仓明细ID`/可退数量 | 点“资料”从产品库（`products` 数据源，同标签单）自由选产品，无可退数量上限 |
| 明细约束 | 退仓量 ≤ 可退量，绑定 `入仓明细ID` | 无核销约束，`入仓明细ID` 置空 |
| 入仓单号 | 驱动明细 | 表头参考字段（必选），仅用于带出供应商/仓库 |
| 明细列 | 含 单位/可退数量 | 配件编号/客户/产品货号/产品名称/产品装配名称/生产单号/数量/备注 |

## 库存口径（关键约束）

半成品库存为**实时台账**（`InventorySummaryService.SemiSql` 的 `LedgerUnion`），已把审核='1' 的 `半成品退仓明细单` 计为 `数量*-1`，按 `仓库 + 物料编号 + 颜色` 净额。因此：

- 退仓明细**必须落库** `仓库`、`物料编号`(=配件编号)、`颜色`、`数量`，否则无法正确减库存。
- 审核**无需显式过账**：`SetApproved` 只翻审核位，union 读到审核过的退仓行即自动减库存；反审核翻回即自动恢复。
- 截图表头无“仓库”、明细无“颜色/规格”列 → 由后端补齐：`仓库` 取自表头**必选的入仓单号**对应入仓单；`颜色/规格/单位/库存单价` 按 `物料编号` 从半成品数据（入仓明细/主数据）带出。

## 交互流程

1. 新建 → 选**入仓单号**(🔍，仅列已审核半成品入仓单) → 自动带出 `供应商编号/供应商名称/仓库`（仓库只读/隐藏）。
2. 点**资料**(🔍) → 复用 `SemiFinishedLabelProductPicker`（列同图2：配件编号/产品装配名称/客户/产品货号/产品名称/加工单价/库存单价），自由多选产品 → 合并入明细行（去重按配件编号）。
3. 明细逐行录入**数量**、可编辑**备注**；`生产单号` 由产品选择器带出（只读列）。
4. 保存 → 首存生成 `BRTyyyyMMddNNN`；金额=Σ数量×库存单价。
5. 审核 → 减半成品库存（实时 union）；反审核恢复；已审核只读、禁删。

## 页面结构（套用半成品标签单骨架）

- 外壳：`<Card title="半成品退仓单" extra={工具栏}>`，无“打开”权限时返回“无权访问该页面”。
- 工具栏 `<Space wrap>`：新建 / 打开 / 保存 / 删除 / 复制单 / 刷新 / 资料 / 前单 / 后单 / 审核 / 反审核 / 表格设置(禁用) / 打印 / 关闭，均带 `@ant-design/icons`，按 `can(perms, "半成品退仓", action)` 控制 disabled。
- 表头 `<Form layout="vertical" size="small">` + `<Row gutter={12}>`：供应商🔍、日期 `DatePicker`、电脑单号(只读)、入仓单号🔍、备注、操作员(只读)、审核状态 `Tag`。
- 明细 `<Table size="small" pagination={false} scroll={{x:1450,y:"calc(100vh-455px)"}}>`：删除(fixed left) / 配件编号 / 客户 / 产品货号 / 产品名称 / 产品装配名称 / 生产单号 / 数量(`InputNumber`) / 备注(`Input`)。
- 底部 `<Space>`+`<Statistic>`：数量合计、金额合计(precision 2，按 `单价` 权限脱敏隐藏)。
- 弹窗组件：供应商 Picker（复用现有 SupplierPicker/master suppliers）、入仓单 Picker（`SemiReceiptOrderPicker`，仅已审核）、资料 Picker（复用 `SemiFinishedLabelProductPicker`，permissionMenu="半成品退仓"）。
- 并发防护：沿用标签单的 `writeActive`/`documentRequestVersion` 版本号防竞态（或沿用现有 busy 简版，二选一，保持与现有页一致）。

## 后端

沿用现有表 `半成品退仓单` / `半成品退仓明细单`（前缀 `BRT`），改写 `SemiWarehouseReturnService` 为自由选产品模型。

### 端点（`SemiWarehouseReturnController`，route `api/semi-warehouse-returns`）

标准：List / Get / Create(POST) / Update(PUT) / Delete / audit / reverse-audit / adjacent(前后翻单) / receipts(入仓单选择) / products(产品选择，复用标签 products，扩展带 `生产单号`)。
- 权限门禁 `perms.HasAsync(user, "半成品退仓", action)`。
- 异常映射：`ArgumentException→400`、`KeyNotFoundException→404`、`InvalidOperationException→409`。

### Service 规则

- `CreateAsync/UpdateAsync`：
  - 校验入仓单号必填且对应入仓单已审核 → 取其 `供应商编号/供应商名称/仓库`。
  - 校验明细非空、每行数量>0、配件编号必填、同单配件编号不重复。
  - 每行按 `物料编号`(=配件编号) 从半成品数据带出 `颜色/规格/单位/库存单价/生产单号`（缺失则置空/0）。
  - 金额=数量×库存单价；表头 `数量/金额` 汇总落库。
  - `入仓明细ID` 置 NULL（不再核销）。
  - 头表锁 `WITH (UPDLOCK,HOLDLOCK)`；已审核禁改。
- `SetApprovedAsync`：仅翻审核位（+审核人/审核日期），不写台账；审核前校验入仓单仍为已审核。反审核翻回。
- `DeleteAsync`：已审核禁删。
- 单价/金额按 `单价` 权限脱敏（list 头金额、get 明细单价金额置 null）。
- 所有写操作经 `IAuditLogger` 记 `新增/保存/删除/审核/反审核`。

### products 扩展

复用标签 `products` 查询，`SELECT` 增加 `生产单号`（best-effort：若款号/半成品数据无该列则返回 NULL，实施时按实际列确认）。前端资料选择器保持图2列不变，`生产单号` 随行带入明细。

## 前端接入四处

均已存在，无需新增：路由 `App.tsx`(`semi-warehouse-returns`)、菜单 `menuTree.tsx`(半成品退仓)、DI `Program.cs`、权限 `MenuCatalog`。

## 测试

- 后端 xUnit DB 测试：全生命周期（建 BRT→审核减库存→反审核恢复→已审核删拒 409→删）、脱敏、入仓单未审核拒审核、自由选产品带出颜色/仓库正确。
- 前端 Vitest：`utils/semiWarehouseReturn.ts` 纯计算（合并去重、金额、校验）；页面/选择器渲染冒烟。

## 非目标（YAGNI）

- 不实现“半成品退仓查询”报表页。
- 不引入桌面打印驱动（打印用 `window.print`/现有预览）。
- 不改动其他半成品单据与库存 union 结构（仅复用现有退仓分支）。
