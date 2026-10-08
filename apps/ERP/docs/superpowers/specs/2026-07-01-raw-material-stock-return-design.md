# 原料退库表(⑪原料仓库)· 设计 · 2026-07-01

## 背景 / 目标
⑪原料仓库「原料退库表」全屏主从录入单 —— **生产领用链**的退料回仓(把领出的原料退回原料仓库)。表头 部门/退料人(生产领料侧),**无价**,明细带 啤机生产单号/开单日期。与「原料退仓单」(退回供应商·带价)是**另一条链**。前缀 **YTK**。

原系统截图字段(表头):部门 / 日期 / 退料人🔍 / 电脑单号 / 备注 / 操作员(只读)。明细列:啤机生产单号 / 开单日期 / 原料编号🔍 / 原料名称 / 产地 / 每包重量 / 单位 / 数量 / 备注。底部:数量合计(**无金额**)。

**v1 关键取舍(用户已定)**:审核 = 纯锁定不动库存(与已建原料入仓/退仓/需求单一致),**库存台账整体延后**(退库=加库存的方向,后续统一建原料台账时与出库−配对)。

## 前置改动:主数据「塑胶原料资料」加 产地/每包重量(用户已定·保真)
原系统原料资料含 产地/每包重量(选料查询 D 可见:产地=韩国锦湖/中国台湾…,每包重量=25,单位 KG/包)。我们重建时省了,现补上,让选料能带出这两列。**连带 4 处**:
1. **表**:`db/30_plastic_raw_material.sql` 建表体加 `[产地] nvarchar(60) NULL` + `[每包重量] decimal(18,4) NULL`;并出新脚本 `db/36_plastic_raw_material_add_cols.sql`(`IF COL_LENGTH('塑胶原料资料','产地') IS NULL ALTER TABLE [塑胶原料资料] ADD [产地] nvarchar(60) NULL;` 同理每包重量)对已存在的库补列(幂等)。
2. **实体**:塑胶原料资料实体加 `[Column("产地")] 产地` + `[Column("每包重量")] 每包重量`(`MasterCrudController<T>` 自动含进 list/CRUD/保存)。
3. **主数据编辑页**:前端塑胶原料资料页 `web/src/pages/plastics/PlasticRawMaterialMasterPage.tsx` 新建/编辑弹窗加 产地/每包重量 两输入框 + 列表加两列(后端实体 `src/ErpApi/Data/Entities/塑胶原料资料.cs`)。
4. **共享选择器**:`PlasticRawMaterialPicker` 列表加 产地/每包重量 两列,`onPick` 回填带出这两值(纯增,现有调用方[入仓/退仓/需求单]忽略即可,不破坏)。

## 数据库(新表 `db/35_raw_material_stock_return.sql`)
幂等、EF 不迁移、前缀 YTK。

### 头表 `原料退库表`
| 列 | 类型 | 说明 |
|---|---|---|
| ID | bigint IDENTITY PK | |
| 单号 | nvarchar(20) NOT NULL | YTK+yyyyMMdd+3位序号 |
| 部门 | nvarchar(40) NULL | 退料部门(文本) |
| 日期 | datetime NULL | 建单日(只读) |
| 退料人 | nvarchar(30) NULL | EmployeePicker 选 |
| 电脑单号 | nvarchar(40) NULL | 纯文本可空 |
| 操作员 | nvarchar(20) NULL | |
| 数量 | decimal(18,4) NULL | =SUM(明细.数量) |
| 审核 / 审核人 / 审核日期 | nvarchar(5) / nvarchar(20) / datetime | 三件套 |
| 备注 | nvarchar(200) NULL | |

### 明细表 `原料退库明细单`
| 列 | 类型 | 说明 |
|---|---|---|
| ID | bigint IDENTITY PK | |
| 单号 | nvarchar(20) NOT NULL | |
| 啤机生产单号 | nvarchar(50) NULL | 行内·手录 |
| 开单日期 | datetime NULL | 行内·DatePicker |
| 原料编号 | nvarchar(40) NULL | |
| 原料名称 | nvarchar(80) NULL | |
| 产地 | nvarchar(60) NULL | 选料带出·可改 |
| 每包重量 | decimal(18,4) NULL | 选料带出·可改 |
| 单位 | nvarchar(20) NULL | |
| 数量 | decimal(18,4) NULL | 退库数量 |
| 备注 | nvarchar(200) NULL | |

**无单价/金额列。**

## 后端(新 `Features/Plastics/PlasticRawMaterialStockReturn/`)
镜像无价领料侧单据(参考 `原料生产需求表` PlasticRawMaterialDemand)。

- **DTOs**:Header(单号/部门/日期/退料人/电脑单号/操作员/数量/审核/审核人/备注)+ Line(啤机生产单号/开单日期/原料编号/原料名称/产地/每包重量/单位/数量/备注)+ Detail + CreateLine + Create(部门/退料人/电脑单号/备注/明细)。**无价字段。**
- **Service**(`PlasticRawMaterialStockReturnService`):前缀 **YTK**;Create 头 数量=SUM(明细.数量)、`日期`=建单日、`审核`='0';明细逐行 INSERT(含 啤机生产单号/开单日期/产地/每包重量)。Approve/Unapprove 走通用 `IPostingEngine`(**只翻审核位·不动库存**)。List/Get/Delete(已审核抛 409)。**无带价脱敏**(无价单)。
- **Controller**(`api/plastic-raw-material-stock-return`):9 位授权(打开/保存/删除/审核/反审核),CRUD + approve/unapprove。**无 单价 脱敏逻辑**。
- 过账白名单 `PostableDocuments` 加 `["原料退库表"]="单号"`。DI 注册。`MenuCatalog` 加 `("原料仓库","原料退库表")`;admin 9 位权限种子 `seed_raw_material_stock_return_perms.sql`(**先确认文件名未撞**)。

## 前端(克隆无价领料录入页)
- `api/plasticRawMaterialStockReturn.ts`:类型前缀 **RSR**(RSRLine/RSRHeader/RSRDetail),base `/plastic-raw-material-stock-return`,方法同其它单 api。
- `PlasticRawMaterialStockReturnLineTable.tsx`:明细列 啤机生产单号(文本)/开单日期(DatePicker per row)/原料编号🔍(用增强后的 `PlasticRawMaterialPicker` 带出 原料编号/名称/单位/**产地/每包重量**)/原料名称(只读)/产地(带出可改)/每包重量(带出可改)/单位/数量/备注。**无单价/金额列。**
- `PlasticRawMaterialStockReturnPage.tsx`:表头 部门(文本)/日期(只读,建单日)/退料人🔍(**EmployeePicker**)/电脑单号/操作员(只读)/备注;底部 数量合计(**无金额**);历史列表 + 审核/反审核/删除 门控。
- App 路由 `/plastic-raw-material-stock-return` + menuTree 占位 `M("原料退库表")` → 三参。

## 测试
- 后端 `PlasticRawMaterialStockReturnServiceDbTests`:create YTK·数量 SUM·啤机生产单号/开单日期/产地/每包重量 round-trip + approve(审核=1·审核日期)+ delete 已审核抛错。
- 主数据加列后:塑胶原料资料 CRUD 带 产地/每包重量(并入 HTTP 冒烟或独立验证)。
- HTTP 冒烟全生命周期:建 YTK→审核→数量→已审核删拒 409→反审核后删。
- 前端 tsc 干净 + vitest 全绿。

## 里程碑 / 后续
- 原料仓库**生产领用链**开张:退库(YTK·+·退料回仓)先建;出库表(领料·−)后续。
- 主数据 产地/每包重量 补齐后,原料入仓/退仓单选料也能带出这两列(以后可回填增强,非本次范围)。
- **库存台账**:延后(与出库−、入仓+/退仓− 统一接原料 LedgerUnion)。
