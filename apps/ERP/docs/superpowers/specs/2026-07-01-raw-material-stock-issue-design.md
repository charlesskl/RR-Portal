# 原料出库单(⑪原料仓库)· 设计 · 2026-07-01

## 背景 / 目标
⑪原料仓库「原料出库单」全屏主从录入单 —— 生产领用链的**实际领料出库**(把原料发给生产·**无价**·方向语义为减)。头接近原料生产需求表(生产车间/领料备注/制单人),明细比退库表多「啤机外发单号」列,支持从已审核**原料生产需求表(YLX)调入清单**。前缀 **YCK**。

原系统截图字段(表头):生产车间(下拉🔍)/ 日期 / 审核日期(只读)/ 电脑单号 / 备注 / 操作员(只读)/ 领料备注(下拉·生产领料)/ 制单人🔍(底部)。明细列:啤机生产单号 / 开单日期 / 啤机外发单号 / 原料编号🔍 / 原料名称 / 产地 / 每包重量 / 单位 / 数量 / 备注。底部:数量(包)合计 / 制单人🔍 / 删除空白行。工具栏含「调入清单」。

**v1 关键取舍(用户已定)**:审核 = 纯锁定不动库存(与已建原料各单一致),**库存台账整体延后**(出库=减库存方向,后续统一建原料台账时与入仓+/退仓−/退库+ 一起接)。

## 非目标(明确延后)
- 不建 LedgerUnion、不改采购分析表/库存列表读法。
- 「生产车间」做文本输入(截图有下拉🔍,但无车间主数据来源);「合并/打印合并表格」不做。

## 数据库(新表 `db/37_raw_material_stock_issue.sql`)
幂等、EF 不迁移、前缀 YCK。

### 头表 `原料出库单`
| 列 | 类型 | 说明 |
|---|---|---|
| ID | bigint IDENTITY PK | |
| 单号 | nvarchar(20) NOT NULL | YCK+yyyyMMdd+3位序号 |
| 生产车间 | nvarchar(40) NULL | 文本(调入时可从需求头带出) |
| 日期 | datetime NULL | 建单日(只读) |
| 电脑单号 | nvarchar(40) NULL | 纯文本可空 |
| 领料备注 | nvarchar(30) NULL | 下拉·默认「生产领料」 |
| 制单人 | nvarchar(30) NULL | EmployeePicker 选 |
| 操作员 | nvarchar(20) NULL | 当前用户 |
| 数量 | decimal(18,4) NULL | =SUM(明细.数量) |
| 审核 / 审核人 / 审核日期 | nvarchar(5) / nvarchar(20) / datetime | 三件套 |
| 备注 | nvarchar(200) NULL | |

### 明细表 `原料出库明细单`
| 列 | 类型 | 说明 |
|---|---|---|
| ID | bigint IDENTITY PK | |
| 单号 | nvarchar(20) NOT NULL | |
| 啤机生产单号 | nvarchar(50) NULL | 行内·调入带出/手录 |
| 开单日期 | datetime NULL | 行内·DatePicker |
| 啤机外发单号 | nvarchar(50) NULL | 行内·手录 |
| 原料编号 | nvarchar(40) NULL | |
| 原料名称 | nvarchar(80) NULL | |
| 产地 | nvarchar(60) NULL | 选料带出·可改 |
| 每包重量 | decimal(18,4) NULL | 选料/调入带出·可改 |
| 单位 | nvarchar(20) NULL | |
| 数量 | decimal(18,4) NULL | 出库数量 |
| 备注 | nvarchar(200) NULL | |

**无单价/金额列。**

## 后端(新 `Features/Plastics/PlasticRawMaterialStockIssue/`)
无价模板(镜像 `原料生产需求表`/`原料退库表` 的无价 Service/Controller)。

- **DTOs**:Header(单号/生产车间/日期/电脑单号/领料备注/制单人/操作员/数量/审核/审核人/备注)+ Line(啤机生产单号/开单日期/啤机外发单号/原料编号/原料名称/产地/每包重量/单位/数量/备注)+ Detail + CreateLine + Create(生产车间/电脑单号/领料备注/制单人/备注/明细)。**无价字段。**
- **Service**(`PlasticRawMaterialStockIssueService`):前缀 **YCK**;Create 头 数量=SUM(明细.数量)、`日期`=建单日、`审核`='0';明细逐行 INSERT(含 啤机生产单号/开单日期/啤机外发单号/产地/每包重量)。Approve/Unapprove 走通用 `IPostingEngine`(**只翻审核位·不动库存**)。List/Get/Delete(已审核抛 409)。
- **Controller**(`api/plastic-raw-material-stock-issue`):9 位授权,CRUD + approve/unapprove。**无 CanPrice/脱敏**。`Menu = "原料出库表"`(与 menuTree 占位一致)、`Table = "原料出库单"`(过账用)。
- 过账白名单 `PostableDocuments` 加 `["原料出库单"]="单号"`。DI 注册。`MenuCatalog` 加 `("原料仓库","原料出库表")`;admin 9 位权限种子 `seed_raw_material_stock_issue_perms.sql`(菜单名 `原料出库表`)。

## 前端(克隆退库表页 + 调入清单)
- `api/plasticRawMaterialStockIssue.ts`:类型前缀 **RSI**(RSILine/RSIHeader/RSIDetail),base `/plastic-raw-material-stock-issue`。
- `PlasticRawMaterialStockIssueLineTable.tsx`:明细列 啤机生产单号(文本)/开单日期(DatePicker per row)/**啤机外发单号(文本)**/原料编号🔍(复用 `PlasticRawMaterialPicker` 带出 原料编号/名称/单位/产地/每包重量)/原料名称(只读)/产地(可改)/每包重量(可改)/单位/数量/备注。**无价列。**
- `PlasticRawMaterialStockIssuePage.tsx`:表头 生产车间(文本)/日期(只读)/电脑单号/领料备注(Select:生产领料/样品领料/维修领料)/**制单人🔍 EmployeePicker**(onPick 姓名)/操作员(只读)/备注;底部 数量合计(无金额);历史列表 + 审核/反审核/删除门控。
  - **调入清单**按钮:弹 Modal 列已审核原料生产需求表(复用 `plasticRawMaterialDemandApi.list` 过滤 审核='1'),选中调 `get(单号)`:明细映射 原料编号/名称/每包重量/单位/**数量=需求数量包**,每行 啤机生产单号/开单日期 取自需求头(`h.啤机生产单号`/`h.开单日期`),啤机外发单号/产地留空;头带出 生产车间/领料备注(`h.生产车间`/`h.领料备注`)。**零新后端调入端点。**
- App 路由 `/plastic-raw-material-stock-issue` + menuTree 占位 `M("原料出库表")` → 三参。

## 测试
- 后端 `PlasticRawMaterialStockIssueServiceDbTests`:create YCK·数量 SUM·生产车间/制单人·啤机生产单号/开单日期/啤机外发单号/产地/每包重量 round-trip + approve(审核=1·审核日期)+ delete 已审核抛错。
- HTTP 冒烟全生命周期:建 YCK→审核→数量→已审核删拒 409→反审核后删。
- 前端 tsc 干净 + vitest 全绿。

## 里程碑 / 后续
- 原料仓库生产领用链完整:需求 YLX(计划)→ 出库 YCK(实际领料·−)→ 退库 YTK(退回·+)。
- ⑪原料仓库 录入单补全后剩 原料盘点单。
- **库存台账**:延后(接 入仓+/退仓−/出库−/退库+ 四支后统一建 + 改采购分析表/库存列表读)。
