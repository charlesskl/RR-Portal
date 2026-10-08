# 原料入仓单(⑪原料仓库)· 设计 · 2026-07-01

## 背景 / 目标
⑪原料仓库「原料入仓单」全屏主从录入单(供应商头 + 带价明细)。镜像 **原料采购订单**(`PlasticRawMaterialPurchaseOrder`),加 产地/每包重量 明细列,并支持从**已审核原料采购订单(YCD)调入明细**。前缀 **YRC**。

**v1 关键取舍(用户已定):审核 = 纯锁定不动库存**,与 原料采购订单/原料生产需求表 完全一致。**不建库存台账、不改采购分析表/库存列表读法**。库存过账(LedgerUnion + 采购分析改读)整体延后到后续专门做。

原系统截图字段(表头):供应商🔍 / 日期 / 入库单号 / 电脑单号 / 订单单号🔍 / 备注 / 单价类型(格式HK$/Lb 下拉)/ 操作员(只读)。明细列:原料编号🔍 / 原料名称 / 产地 / 每包重量 / 单价类型 / 单位 / 数量 / 单价 / 金额 / 备注。底部:数量合计 / 金额合计 / 删除空白行。

## 非目标(明确延后)
- **不建** `RawMaterialInventoryService` / LedgerUnion。
- **不改** `PlasticRawMaterialMasterService.PurchaseAnalysisAsync` / `ListAsync` 读库存的地方(`塑胶原料资料.[库存]` 静态列照旧)。
- 原料退仓/出库/盘点单(后续)。
- 「电脑单号」不自动生成(纯文本手录,可空)。

## 数据库(新表 `db/33_raw_material_receipt.sql`)
幂等建表、EF 不迁移(实体加 `[Column]` 映射即可)。

### 头表 `原料入仓单`
| 列 | 类型 | 说明 |
|---|---|---|
| ID | bigint IDENTITY PK | |
| 单号 | nvarchar(20) NOT NULL | 逻辑键=界面「入库单号」·前缀 YRC+yyyyMMdd+3位序号 |
| 供应商编号 | nvarchar(40) NULL | |
| 供应商名称 | nvarchar(80) NULL | |
| 日期 | datetime NULL | 界面「日期」(建单日,只读) |
| 电脑单号 | nvarchar(40) NULL | 纯文本可空 |
| 订单单号 | nvarchar(20) NULL | 调入来源的 YCD 采购订单单号 |
| 单价类型 | nvarchar(20) NULL | 头·默认「格式HK$/Lb」 |
| 数量 | decimal(18,4) NULL | =SUM(明细.数量) |
| 金额 | decimal(18,4) NULL | =SUM(明细.数量×单价) |
| 操作员 | nvarchar(20) NULL | |
| 审核 | nvarchar(5) NULL | 三件套 |
| 审核人 | nvarchar(20) NULL | |
| 审核日期 | datetime NULL | |
| 备注 | nvarchar(200) NULL | |

### 明细表 `原料入仓明细单`
| 列 | 类型 | 说明 |
|---|---|---|
| ID | bigint IDENTITY PK | |
| 单号 | nvarchar(20) NOT NULL | |
| 原料编号 | nvarchar(40) NULL | |
| 原料名称 | nvarchar(80) NULL | |
| 产地 | nvarchar(60) NULL | 新增列(PO 无·手录/调入后空) |
| 每包重量 | decimal(18,4) NULL | 新增列(PO 无) |
| 单价类型 | nvarchar(20) NULL | 行·含税/未税(同 PO) |
| 单位 | nvarchar(20) NULL | |
| 数量 | decimal(18,4) NULL | 入仓数量 |
| 单价 | decimal(18,4) NULL | |
| 金额 | decimal(18,4) NULL | =数量×单价 |
| 备注 | nvarchar(200) NULL | |

## 后端(新 `Features/Plastics/PlasticRawMaterialReceipt/`)
镜像 `PlasticRawMaterialPurchaseOrder` 各层:

- **DTOs**:Header/Line/Detail/CreateLine/Create。字段对齐上表(头加 日期/电脑单号/订单单号/单价类型;行加 产地/每包重量/数量[替代订货数量])。CreateDto 头含 供应商编号/名称、电脑单号、订单单号、单价类型、备注 + 明细列表。
- **Service**(`PlasticRawMaterialReceiptService`):
  - 前缀 **YRC**·当日序号。
  - Create:头 数量=SUM(明细.数量)、金额=SUM(数量×单价);明细金额=数量×单价;`日期`=建单日;`审核`='0'。
  - Approve/Unapprove:走通用 `IPostingEngine`(**只翻审核位·不动任何库存**)。
  - List/Get:同 PO。DeleteAsync:已审核抛错(409)。
  - **带价脱敏**:list 头隐藏 金额;get 隐藏 明细.单价/金额 + 头.金额(无 单价 权限时置 null)。镜像 PO 的脱敏逻辑。
- **Controller**(`api/plastic-raw-material-receipt`):9 位授权,CRUD + approve/unapprove,脱敏按 `PermissionAction.单价`。
- 过账白名单 `PostableDocuments` 加 `["原料入仓单"]="单号"`。
- DI 注册 `PlasticRawMaterialReceiptService`。
- `MenuCatalog` 加 `("原料仓库","原料入仓单")`;admin 9 位权限种子 `seed_raw_material_receipt_perms.sql`(**先 grep 确认文件名未撞**)。

### 从原料采购订单调入明细(零新后端)
「订单单号」🔍 选择器**复用现有 `plasticRawMaterialPurchaseOrder` API**:
- 列出**已审核**的 YCD 采购订单(复用 PO 的 list 接口 + 前端过滤 审核='1',或按需加 approved 过滤参)。
- 选中后调 PO 的 `Get(单号)` 取明细,前端映射为入仓明细行:原料编号/名称/规格→(规格不在入仓列,舍)/单位/单价类型/单价 带出,订货数量→数量,产地/每包重量 留空。
- 回填后可再改数量。**入仓单后端不新增调入端点**。

## 前端(克隆原料采购订单页)
- `api/plasticRawMaterialReceipt.ts`:CRUD + approve/unapprove。
- `PlasticRawMaterialReceiptLineTable.tsx`:明细网格。原料编号🔍**复用 `PlasticRawMaterialPicker`** 回填 原料编号/名称/单位/单价(主数据无 产地/每包重量 列,故这两列**全手录**);单价类型 行 Select(含税/未税);单价/金额 `hidePrice` 隐藏列;产地/每包重量 可编辑列。
- `PlasticRawMaterialReceiptPage.tsx`:
  - 表头:**SupplierPicker 供应商**(必填)/ 日期(只读,建单日)/ 入库单号(=单号,保存后只读回显)/ 电脑单号(文本)/ **订单单号🔍(调入 YCD 采购订单)** / 单价类型(头 Select,默认「格式HK$/Lb」)/ 操作员(只读)/ 备注。
  - 「订单单号」选择器:弹已审核 YCD 采购订单列表,选中调入明细(见上)。
  - 底部合计:数量 + 金额(`hidePrice` 隐藏金额)。
  - 历史列表 + 审核/反审核/删除 门控(镜像 PO 页)。
- App 路由 `/plastic-raw-material-receipt` + menuTree 三参别名到「原料入仓单」菜单权限。

## 测试
- 后端 `PlasticRawMaterialReceiptServiceDbTests`:create YRC·数量/金额 SUM·明细金额=数量×单价·单价类型 + approve(审核=1·审核日期)+ delete 已审核抛错。
- HTTP 冒烟全生命周期:建 YRC→审核→数量/金额校验→列表→已审核删拒 409→反审核后删。
- 前端 tsc 干净 + vitest 全绿。

## 里程碑 / 后续
- 本单 = 原料仓库第一张**实物入库单据**(数据源),但 v1 纯锁定不动库存。
- **后续专门做**:原料库存台账(`RawMaterialInventoryService.LedgerUnion` 先接本单入仓+一支)+ 采购分析表/库存列表改从台账读 + 原料退仓/出库/盘点逐支加。
