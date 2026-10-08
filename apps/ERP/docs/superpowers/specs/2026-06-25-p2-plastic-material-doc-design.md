# 塑胶模块 · P2 塑胶采购分析 + 塑胶物料单 · 设计

> 日期:2026-06-25
> 范围:塑胶模块第三个子项目 —— 用户最初展示的两屏。塑胶采购分析(列生产单)+ 塑胶物料单(按生产单货号从 P1 塑胶共用物料表带出的可保存可审核采购单据)。
> 上游:[[P0 塑胶物料资料]] `946cab8`、[[P1 塑胶共用物料表]] `31698dc` 已完成。

## 1. 背景与数据流

塑胶采购分析(截图1)列生产单;双击/点行打开**塑胶物料单**(截图2):按该生产单的货号,从 P1 塑胶共用物料表带出该货号的塑胶用料,编辑订购数量后**保存成单**(生成电脑单号),可审核/反审核/删除。这是物料侧「采购物料分析 → 采购物料单(PurchaseOrderDrawer→采购订单)」的塑胶版,差异只在 **basis 来源**:

- 物料侧:`生产BOM物料清单`(制单时由款号BOM展开)。
- 塑胶侧:`塑胶共用物料表 JOIN 生产制单货号 ON 货号=塑胶货号`(共用物料表本身即源,无需展开)。

塑胶复用通用 `生产制单`(无塑胶专属生产单);`生产制单货号` 一对多存每个生产单的货号。单号生成走 `IDocumentNumberGenerator`,审核走通用 `IPostingEngine`(翻头表 `审核` 位)。

## 2. 目标 / 非目标

**目标(P2):**
- 新建 `塑胶物料单`(头)+ `塑胶物料明细单`(明细)两表。
- 后端:按生产单货号带出 basis、保存成单(电脑单号·前缀 `SL`)、查看、审核/反审核、删除;塑胶采购分析的生产单列表(日期+关键词过滤)。
- 前端:塑胶采购分析页(列生产单·上月/本月/下月)+ 塑胶物料单抽屉(新建带出+编辑订购数量+保存;查看+审核/反审核/删除/打印)。
- 菜单「塑胶采购分析」占位落地 + 权限。

**非目标(后续):**
- 库存数量 / 出仓数量 列(依赖塑胶库存,P3 才有;本期省略,P3 接入后补)。
- 塑胶采购订单(独立单据)、塑胶物料单查询报表(P4)。
- 塑胶库存引擎接入 / 过账库存流水(P3)。

## 3. 数据模型(2 新表)

`db/17_plastic_material_doc.sql`:

```sql
CREATE TABLE [塑胶物料单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [日期] datetime NULL,
    [生产单号] nvarchar(50) NULL,
    [货号] nvarchar(40) NULL,
    [客户] nvarchar(50) NULL,
    [数量] decimal(18,4) NULL,        -- 订购数量合计
    [金额] decimal(18,4) NULL,        -- 金额合计
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [备注] nvarchar(200) NULL
);
CREATE TABLE [塑胶物料明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [生产单号] nvarchar(50) NULL,
    [货号] nvarchar(40) NULL,
    [工模编号] nvarchar(30) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [仓位号] nvarchar(30) NULL,
    [用料名称] nvarchar(40) NULL,
    [加工内容] nvarchar(50) NULL,
    [加工单价] decimal(18,4) NULL,
    [用量] decimal(18,4) NULL,
    [订购数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,        -- = 订购数量 × 加工单价
    [备注] nvarchar(200) NULL
);
```
两表 EF 实体(明细 `加工单价/金额` 不映射价格特性——脱敏在服务/控制器层做,与采购订单一致;或在 DTO 上脱敏)。注:本单据用 Dapper 手写 SQL(非泛型 CRUD),实体仅供需要时用;header/detail 读写均 Dapper。

## 4. 后端

新 `src/ErpApi/Features/Plastics/PlasticMaterialDoc/`:

**`PlasticMaterialDocService`:**
- `OrdersAsync(起, 止, keyword, page, size)` —— 列生产单供分析页:`SELECT 生产单号/款号/款式/客户名称/合同号/计划数量/日期/交货日期/审核 FROM [生产制单] WHERE 日期区间 + 关键词` 分页。
- `BasisAsync(生产单号)` —— `SELECT p.工模编号,p.物料编号,p.物料名称,p.颜色,m.仓位号,p.用料名称,p.加工内容,p.加工单价,p.用量, g.货号 FROM [塑胶共用物料表] p JOIN [生产制单货号] g ON g.[货号]=p.[塑胶货号] LEFT JOIN (SELECT 物料编号,MAX(仓位号) 仓位号 FROM [塑胶物料资料] GROUP BY 物料编号) m ON m.物料编号=p.物料编号 WHERE g.[生产单号]=@生产单号`。basis 返回 用量;抽屉新建时**订购数量预填=用量**(可改),金额=订购数量×加工单价 前端实时算。
- `CreateAsync(dto, user)` —— 事务:`docNo.NextAsync("塑胶物料单","SL",now,c,tx)` 取单号;插 `塑胶物料单`(审核 '0',数量/金额合计)+ 逐行插 `塑胶物料明细单`(金额=订购数量×加工单价);返回单号。
- `GetAsync(单号)` —— 头 + 明细(查看模式)。
- `DeleteAsync(单号)` —— 已审核拒删;删明细+头。

**`PlasticMaterialDocController`**(`api/plastic-material-docs`,`Menu="塑胶物料单"`):
- `GET orders`(分析页生产单列表)、`GET basis?生产单号`、`POST`(create)、`GET {单号}`、`DELETE {单号}`、`POST {单号}/approve`、`POST {单号}/unapprove`(注 `IPostingEngine.ApproveAsync("塑胶物料单",单号,user)`)。
- 无 `单价` 权限 → basis/get/明细 的 加工单价/金额 置 null。

**权限**:`MenuCatalog` 加 `("塑胶采购","塑胶物料单")`;`db/seed_plastic_doc_perms.sql` 给 admin 9 位。

## 5. 前端

- `web/src/api/plasticMaterialDoc.ts`:`orders/basis/create/get/approve/unapprove/remove` + 类型(`PlasticOrderRow`/`PlasticMaterialBasisRow`/`PlasticMaterialDocDetail`)。
- `web/src/pages/plastics/PlasticMaterialAnalysisPage.tsx`:列生产单(上月/本月/下月 + 关键词)+ 点行开抽屉(克隆 `PurchaseMaterialAnalysisPage` + 日期工具栏)。
- `web/src/pages/plastics/PlasticMaterialDocDrawer.tsx`:克隆 `PurchaseOrderDrawer` 精简:
  - 新建:`basis(生产单号)` 带出明细(工模/物料/颜色/仓位号/用料/加工内容/加工单价/用量)+ 录 **订购数量**(金额=订购数量×加工单价 实时算)+ 保存。
  - 查看:头(单号/日期/生产单号/货号/客户/审核)+ 明细;审核/反审核/删除按权限;打印(复用 print 工具)。价格按 `hidePrice` 显 `***`。
- 路由 `/plastic-material-analysis`;菜单 ⑦塑胶采购 `M("塑胶采购分析","/plastic-material-analysis","塑胶物料单")`。

## 6. 测试

- 后端 `PlasticMaterialDocServiceDbTests`:
  - `BasisAsync` 按生产单货号 JOIN 共用物料表带出(含仓位号 LEFT JOIN)。
  - `CreateAsync` 生成 `SL` 单号、头+明细落库、金额=订购数量×加工单价、数量/金额合计。
  - `GetAsync` 读回头+明细;`DeleteAsync` 未审核可删、已审核拒删。
  - 审核经 `IPostingEngine` 翻 审核 位(或测 service+posting 组合)。
- 全量:后端 dotnet test 全过、前端 tsc/vitest 全过、build ✓。

## 7. 验收标准

1. 执行 `db/17` 后两表存在。
2. `/plastic-material-analysis` 列生产单(上月/本月/下月过滤);点行开抽屉,basis 按货号从塑胶共用物料表带出明细(带仓位号);录订购数量→金额实时=订购数量×加工单价;保存生成 `SL...` 单号。
3. 保存后抽屉转查看;审核→反审核生效;未审核可删、已审核拒删。
4. 无「塑胶物料单·单价」权限者 加工单价/金额 显 `***`。
5. 菜单 ⑦塑胶采购「塑胶采购分析」可进入。

## 8. 风险 / 决策

- **basis 来源 = 塑胶共用物料表 JOIN 生产制单货号**(按 货号=塑胶货号),非 BOM 展开。
- **省略 库存/出仓 列**:依赖塑胶库存(P3),本期无源故省略(同既有查询页省无源列惯例)。
- **金额 = 订购数量 × 加工单价**(用户确认);头表 数量/金额 = 明细合计。
- **单号前缀 SL**(用户确认);DocType="塑胶物料单"。
- **审核仅翻头表位**(通用 PostingEngine),不触发库存/成本级联(塑胶库存 P3 才接)。
- **生产单列表日期过滤**按 `生产制单.日期`;接货/交货双日期类型切换暂不做(YAGNI,需要时加)。
- **P2 体量**比 P0/P1 大(双表+单据 service+审核+两屏),实现计划约 8-9 任务。
