# 半成品退库单（自由选产品版）设计文档

**日期**：2026-07-20
**分支**：`codex/semi-finished-label-order`
**状态**：设计已确认，待写实现计划

## 背景

原系统「半成品退库单」界面 + 「资料」产品选择器（原料资料查询MZFAD）两张截图。本系统菜单里 `M("半成品退库单")` 仅为**占位**（无路由/权限），后端无表无代码。本次**净新建**这张单据。

半成品退库 = 生产领用的半成品料**退回半成品仓**，库存方向 **+（增）**，是半成品出库单/领料单（−）的返回对手单。

## 目标

按截图新建「半成品退库单」：简领料退回头（部门/退料人）→ 点「资料」从产品库自由选产品录退库数量 → 审核实时**增加**半成品库存。

## 与已交付单据的关系

镜像刚交付的**半成品出库单（自由选产品版）**（`SemiIssue`），复用其全部模式，仅四点不同：

| 维度 | 半成品出库单（已交付） | 半成品退库单（本单） |
|---|---|---|
| 表 | 复用 半成品领料单/明细单 | **净新 半成品退库单/明细单** |
| 方向 | 减（union `数量*-1`） | **增（union `数量*+1`，新第5分支）** |
| 头 | 富领料头（部门/领料人/拉长/收件人/领料备注/件数/卡板数/制单人） | **简头（部门/日期/退料人/电脑单号/备注/操作员）** |
| 右侧库存参考网格 | 有 | **无** |
| 单号前缀 | BL | **BTK** |
| 审核 | PostingEngine | **PostingEngine（同）** |
| 仓库 | 固定半成品仓 | **固定半成品仓（同）** |
| 价格 | 无价 | **无价（同）** |
| 资料自由选 picker | SemiFinishedLabelProductPicker | **同（permissionMenu="半成品退库"）** |

## 架构

- 净新两表 `半成品退库单` / `半成品退库明细单`，结构镜像 `半成品退仓单`（头）/`半成品领料明细单`（明细列），头字段换成 部门/退料人。
- ASP.NET Core 控制器新建，权限/月结锁/日志/**PostingEngine 审核**（加 PostableDocuments 白名单 + DI 注册）。Dapper 服务自由选产品：仓库默认 `半成品仓`，按 `物料编号+仓库` 从最近已审核 `半成品入仓明细单` 派生权威 颜色/规格/单位/单价/生产单号（**颜色必派生**——union 按 仓库+物料编号+颜色 净额）。
- `InventorySummaryService.SemiSql` 加第 5 分支 `半成品退库明细单 数量*+1`。
- React 全屏主从页新建，明细来源复用出库/退仓的自由选择器；无右侧网格。
- 接入：menuTree 占位 `M("半成品退库单")` → `M("半成品退库单","/semi-stock-returns","半成品退库")`；App.tsx 路由；权限种子。

## 技术栈

SQL Server migration、ASP.NET Core 8、Dapper、xUnit、React 19、TypeScript、Ant Design 6、Vitest。

## 数据模型

### DB 迁移（新建两表，`db/migrate_semi_stock_returns.sql`）

`半成品退库单`（头）：`ID`(PK identity) / `单号`(unique) / `日期`(date) / `部门` / `退料人` / `仓库` / `数量`(decimal) / `金额`(decimal) / `操作员` / `审核`(char(1) default '0', CHECK IN 0/1) / `审核人` / `审核日期`(datetime2) / `备注`。

`半成品退库明细单`（明细，镜像 `半成品领料明细单` 相关列）：`ID`(PK identity) / `单号` / `日期` / `仓库` / `订单单号` / `客户` / `生产单号` / `货号` / `名称` / `物料编号` / `物料名称` / `规格` / `颜色` / `单位` / `数量`(decimal) / `单价`(decimal) / `金额`(decimal) / `备注`。唯一键 `UQ_半成品退库明细单_物料 (单号,物料编号)`。

幂等：`IF OBJECT_ID(...) IS NULL CREATE TABLE ...`（两表各一块），可安全重跑。

### 权限种子（`db/seed_semi_stock_return_perms.sql`）

MERGE 给所有用户（含 admin）菜单 `半成品退库` 授 打开/保存/删除/打印/审核/反审核 + **单价/金额**（无价单虽不显示，仍授以避免脱敏坑；`WHEN MATCHED` 幂等回填 NULL 位）。

### 明细列映射（自由选产品字段 → `半成品退库明细单` 列）

配件编号→物料编号 / 产品装配名称→物料名称 / 产品货号→货号 / 产品名称→名称 / 客户→客户 / 生产单号→生产单号 / 数量→数量 / 备注→备注 / 颜色·规格·单位·单价→ReceiptFacts 派生 / 金额=数量×单价（内部记录，不显示）。

## 组件与数据流

### 后端 Service（`SemiStockReturnService`，新建）
- `DocType="半成品退库单"`，`Prefix="BTK"`，`DefaultWarehouse="半成品仓"`。
- `CreateAsync`/`UpdateAsync` → `SaveCoreAsync`（自由选：校验≥1行/配件编号必填/数量>0/同单不重复；仓库空→半成品仓；每行按 物料编号+仓库 派生 `ReceiptFacts`；落库头 + 明细 仓库/物料编号/颜色/数量 必落）。
- `ListAsync` / `GetAsync(no, showPrice)`（别名回读 配件编号/产品装配名称/产品货号/产品名称；!showPrice 脱敏 单价/金额）/ `DeleteAsync`（已审拒删）。
- `ProductsAsync(query, canSeePrice)`（与出库/退仓同一 CTE）+ `GetAdjacentAsync(no, next, showPrice)`。
- **审核走 PostingEngine**（Controller 用 `posting.ApproveAsync/UnapproveAsync`）。

### 后端 Controller（`SemiStockReturnController`，`/api/semi-stock-returns`，新建）
- List / Get(showPrice) / Products / Adjacent / Create / Update(PUT) / Delete / Approve / Unapprove。镜像 `SemiIssueController`。
- 常量 `Menu="半成品退库"`、`Table="半成品退库单"`、`口径="半成品"`。

### 库存引擎
- `InventorySummaryService.SemiSql` 加 `UNION ALL SELECT ... d.数量 AS 库存 FROM [半成品退库明细单] d JOIN [半成品退库单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'`（**正号 +**）。

### DI / 白名单 / 接入
- `Program.cs`：`AddScoped<SemiStockReturnService>()`。
- `PostableDocuments`：加 `["半成品退库单"]="单号"`。
- `menuTree.tsx`：`M("半成品退库单","/semi-stock-returns","半成品退库")`。
- `App.tsx`：`<Route path="semi-stock-returns" element={<SemiStockReturnPage/>} />`。
- `MenuCatalog.cs`：加 `new("半成品仓库","半成品退库")`（对齐现有 `new("半成品仓库","半成品退仓")`），使权限矩阵可配该菜单。

### 前端
- `api/semi.ts`：新增 `SSR*` 类型（product/lineInput/lineRow/create/header/detail）+ `semiStockReturnApi`（list/get/create/update/remove/approve/unapprove/products/adjacent）。
- `utils/semiStockReturn.ts`：`mergeSemiStockReturnLines`/`validateSemiStockReturn`（同出库 utils，无入仓单号要求）。
- `pages/warehouse/SemiStockReturnPage.tsx`：全屏主从。工具栏（装配采购清单禁用占位/资料/前后单/审核…）；头 部门/日期/退料人🔍/电脑单号只读/备注/操作员只读 + 审核 Tag；明细列 删除/装配采购空占位/配件编号/客户/产品货号/产品名称/产品装配名称/生产单号/数量录入/备注；**无右侧网格**；底部仅数量合计。资料复用 `SemiFinishedLabelProductPicker`（`permissionMenu="半成品退库"`），退料人用 `EmployeePicker`。

## 错误处理

- 保存校验 → `ArgumentException` → 400 `{消息}`。月结锁 → PeriodLockService。审核经 PostingEngine。

## 测试策略

- **后端 DB 测试** `SemiStockReturnServiceDbTests`：自由选建单→审核→半成品库存 **+30**（前置建审核入仓单 M1 仓库 P5c半成品仓 数量100；退库30；审核翻位→库存130；反审核→100）。
- **前端 utils** `semiStockReturn.test.ts`：合并去重/校验。
- **HTTP 冒烟**：全生命周期（资料选品→录数量→保存 BTK→审核 +库存→反审核恢复→前后单→已审删拒→未审删）。

## 接入清单（本单需新增，非"已存在"）

与出库/退仓不同，本单是**净新**：新表、新 Service/Controller、新 DI、新白名单、新权限种子、菜单占位落地、新路由、union 新分支。

## 现有测试影响

- 无：净新单据，不改动现有单据的 DTO/Service。`InventorySummaryService.SemiSql` 加分支为纯增（不影响现有 4 分支的净额）。

## YAGNI 边界

- 装配采购清单调入：缓做（占位禁用）。表格设置：禁用占位。多仓：固定半成品仓。价格显示/脱敏 UI：无价单不做。右侧库存参考网格：截图无，不做。

## 部署提醒

生产库须部署 `db/migrate_semi_stock_returns.sql` + `db/seed_semi_stock_return_perms.sql`。
