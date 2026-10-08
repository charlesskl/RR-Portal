# 原料退仓单(⑪原料仓库)· 设计 · 2026-07-01

## 背景 / 目标
⑪原料仓库「原料退仓单」全屏主从录入单(退回供应商)。**原料入仓单(YRC)的近乎克隆**,明细列逐列一致,唯一实质差异:表头「订单单号」换成「入仓单号🔍」,从**已审核原料入仓单(YRC)调入明细**(退回供应商);前缀 **YTC**;库存方向语义为减(入仓为加)。

**v1 关键取舍(用户已定):审核 = 纯锁定不动库存**,与 原料入仓单/采购订单/需求表 一致。**库存台账整体延后**(后续建 `RawMaterialInventoryService.LedgerUnion` 时:入仓 + / 退仓 −)。

原系统截图字段(表头):供应商🔍 / 日期 / 电脑单号 / 入仓单号🔍 / 备注 / 单价类型(格式HK$/Lb 下拉)/ 操作员(只读)。明细列:原料编号🔍 / 原料名称 / 产地 / 每包重量 / 单价类型 / 单位 / 数量 / 单价 / 金额 / 备注。底部:数量合计 / 金额合计 / 删除空白行。

## 非目标(明确延后)
- **不建** `RawMaterialInventoryService` / LedgerUnion;**不改** 采购分析表/库存列表读法(与入仓单一致)。
- 「电脑单号」不自动生成(纯文本手录,可空)。

## 数据库(新表 `db/34_raw_material_return.sql`)
幂等建表、EF 不迁移。结构 = 原料入仓单(db/33),仅头表 `订单单号` → `入仓单号`。

### 头表 `原料退仓单`
| 列 | 类型 | 说明 |
|---|---|---|
| ID | bigint IDENTITY PK | |
| 单号 | nvarchar(20) NOT NULL | 本单单号·前缀 YTC+yyyyMMdd+3位序号 |
| 供应商编号 | nvarchar(40) NULL | |
| 供应商名称 | nvarchar(80) NULL | |
| 日期 | datetime NULL | 建单日(只读) |
| 电脑单号 | nvarchar(40) NULL | 纯文本可空 |
| 入仓单号 | nvarchar(20) NULL | 调入来源的 YRC 入仓单号 |
| 单价类型 | nvarchar(20) NULL | 头·默认「格式HK$/Lb」 |
| 数量 | decimal(18,4) NULL | =SUM(明细.数量) |
| 金额 | decimal(18,4) NULL | =SUM(明细.数量×单价) |
| 操作员 | nvarchar(20) NULL | |
| 审核 / 审核人 / 审核日期 | nvarchar(5) / nvarchar(20) / datetime | 三件套 |
| 备注 | nvarchar(200) NULL | |

### 明细表 `原料退仓明细单`
与 `原料入仓明细单` 逐列一致:ID / 单号 / 原料编号 / 原料名称 / 产地 / 每包重量 / 单价类型 / 单位 / 数量 / 单价 / 金额 / 备注(类型同 db/33)。

## 后端(新 `Features/Plastics/PlasticRawMaterialReturn/`)
镜像 `PlasticRawMaterialReceipt` 各层:

- **DTOs**:Header/Line/Detail/CreateLine/Create。头 `订单单号` → `入仓单号`;其余同入仓单。
- **Service**(`PlasticRawMaterialReturnService`):前缀 **YTC**;Create 头 数量=SUM(数量)、金额=SUM(数量×单价);明细金额=数量×单价;`日期`=建单日;`审核`='0'。Approve/Unapprove 走通用 `IPostingEngine`(**只翻审核位·不动库存**)。List/Get/Delete(已审核抛 409)同入仓单。**带价脱敏**:list 头金额;get 头金额 + 明细单价/金额。
- **Controller**(`api/plastic-raw-material-return`):9 位授权,CRUD + approve/unapprove,脱敏按 `PermissionAction.单价`。
- 过账白名单 `PostableDocuments` 加 `["原料退仓单"]="单号"`。DI 注册。`MenuCatalog` 加 `("原料仓库","原料退仓单")`;admin 9 位权限种子 `seed_raw_material_return_perms.sql`(**先确认文件名未撞**)。

### 从原料入仓单调入明细(零新后端)
「入仓单号」🔍 复用现有 `plasticRawMaterialReceiptApi`:列出**已审核** YRC 入仓单(list + 前端过滤 审核='1')→ 选中调 `Get(单号)` 取明细,前端映射为退仓明细行:原料编号/名称/产地/每包重量/单价类型/单位/单价 **带出**(入仓单已含 产地/每包重量,与退仓列相同故全部带出),数量→数量。回填后可再改。**退仓单后端不新增调入端点**。

## 前端(克隆入仓单页)
- `api/plasticRawMaterialReturn.ts`:类型前缀 **RTN**(RTNLine/RTNHeader/RTNDetail),base `/plastic-raw-material-return`,方法同入仓 api。
- `PlasticRawMaterialReturnLineTable.tsx`:与 `PlasticRawMaterialReceiptLineTable` 同列(原料编号🔍 复用 `PlasticRawMaterialPicker`·产地/每包重量 可编辑·单价类型 Select·单价/金额 hidePrice 隐藏),类型换 RTNLine。
- `PlasticRawMaterialReturnPage.tsx`:表头 供应商🔍(必填)/ 日期(只读)/ 电脑单号 / **入仓单号🔍(Modal 调入已审核 YRC)** / 单价类型 Select / 操作员(只读)/ 备注;底部 数量+金额(hidePrice 隐藏金额)合计;历史列表 + 审核/反审核/删除门控。入仓单号 Modal 列出已审核 YRC(单号/供应商/数量/日期),点单号 pickReceipt 调入。
- App 路由 `/plastic-raw-material-return` + menuTree 占位 `M("原料退仓单")` → 三参。

## 测试
- 后端 `PlasticRawMaterialReturnServiceDbTests`:create YTC·数量/金额 SUM·产地/每包重量/单价类型·明细金额 + approve(审核=1·审核日期)+ delete 已审核抛错。
- HTTP 冒烟全生命周期:建 YTC→审核→数量/金额→已审核删拒 409→反审核后删。
- 前端 tsc 干净 + vitest 全绿。

## 里程碑 / 后续
- 原料仓库入仓(YRC·+)/退仓(YTC·−)两张实物单据成型,均 v1 纯锁定。
- **后续**:原料库存台账(接 入仓+/退仓− 两支)+ 采购分析表/库存列表改读;原料出库表/退库表/盘点单;原料采购进度表。
