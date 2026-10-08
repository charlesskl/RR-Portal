# 原料盘点单(⑪原料仓库)· 设计 · 2026-07-01

## 背景 / 目标
⑪原料仓库「原料盘点单」全屏主从录入单 —— 以实盘校准账面库存。⑪原料仓库最后一张录入单。前缀 **YPD**。无选仓(原料无仓库维度,`塑胶原料资料` 只有仓位号无仓库)。

原系统截图(表头):日期(只读)/ 电脑单号 / 操作员(只读)/ 备注。明细列:原料编号🔍 / 原料名称 / 产地 / 每包重量 / 单位 / 系统数量 / 盘点数量 / 盈亏数量 / 备注。底部:系统数量 / 盘点数量 / 盈亏数量 三合计。

**核心决策(用户已定·本单与其它原料单不同)**:
- **审核 = 校准库存**:审核时在一个事务里 ① 翻审核位 + 审核人/审核日期 ② 对每行 `UPDATE [塑胶原料资料] SET [库存]=盘点数量 WHERE [物料编号]=原料编号`。**这是原料侧唯一一个审核会写库存的单**(采购分析表/库存统计表读的就是这个静态列,盘点校准它才有意义)。
- **反审核 = 仅翻审核位=0,不回滚库存**(盘前值已不可知)。
- **系统数量来自选料带出**:明细逐行选原料(`塑胶原料资料.[库存]` 作系统数量),非 basis 拉全部(截图无 basis 按钮·逐行录)。

## 数据库(新表 `db/38_raw_material_stocktake.sql`)
幂等、EF 不迁移、前缀 YPD。头不存合计(前端算),镜像塑胶盘点头精简结构。

### 头表 `原料盘点单`
| 列 | 类型 | 说明 |
|---|---|---|
| ID | bigint IDENTITY PK | |
| 单号 | nvarchar(20) NOT NULL | YPD+yyyyMMdd+3位序号 |
| 日期 | datetime NULL | 建单日(只读) |
| 电脑单号 | nvarchar(40) NULL | 纯文本可空 |
| 操作员 | nvarchar(20) NULL | 当前用户 |
| 审核 / 审核人 / 审核日期 | nvarchar(5) / nvarchar(20) / datetime | 三件套 |
| 备注 | nvarchar(200) NULL | |

### 明细表 `原料盘点明细单`
| 列 | 类型 | 说明 |
|---|---|---|
| ID | bigint IDENTITY PK | |
| 单号 | nvarchar(20) NOT NULL | |
| 原料编号 | nvarchar(40) NULL | |
| 原料名称 | nvarchar(80) NULL | |
| 产地 | nvarchar(60) NULL | 选料带出 |
| 每包重量 | decimal(18,4) NULL | 选料带出 |
| 单位 | nvarchar(20) NULL | |
| 系统数量 | decimal(18,4) NULL | 选料带出=当前库存(账面) |
| 盘点数量 | decimal(18,4) NULL | 实盘录入 |
| 盈亏数量 | decimal(18,4) NULL | =盘点−系统(后端算) |
| 备注 | nvarchar(200) NULL | |

**无价。**

## 后端(新 `Features/Plastics/PlasticRawMaterialStocktake/`)
- **DTOs**:Header(单号/日期/电脑单号/操作员/审核/审核人/备注)+ Line(原料编号/原料名称/产地/每包重量/单位/系统数量/盘点数量/盈亏数量/备注)+ Detail + CreateLine(原料编号/名称/产地/每包重量/单位/系统数量/盘点数量/备注)+ Create(电脑单号/备注/明细)。
- **Service**(`PlasticRawMaterialStocktakeService`):前缀 **YPD**。
  - `CreateAsync`:头 `日期`=建单日、`审核`='0';明细逐行 INSERT,`盈亏数量=盘点数量−系统数量`(后端算)。
  - `ApproveAsync(单号, user)`(**独特·自建事务**):`SELECT 审核 WITH (UPDLOCK,HOLDLOCK)`;若已审核抛错;`UPDATE [原料盘点单] SET 审核='1',审核人=@user,审核日期=@now WHERE 单号`;`foreach 明细 UPDATE [塑胶原料资料] SET [库存]=@盘点数量 WHERE [物料编号]=@原料编号`;commit。返回 bool。
  - `UnapproveAsync(单号, user)`:`UPDATE [原料盘点单] SET 审核='0',审核人=NULL,审核日期=NULL WHERE 单号 AND 审核='1'`(**不回滚库存**)。返回 bool。
  - `ListAsync`/`GetAsync`/`DeleteAsync`(已审核抛 409)镜像塑胶盘点。
- **Controller**(`api/plastic-raw-material-stocktake`):9 位授权;Approve/Unapprove 调 `svc.ApproveAsync`/`svc.UnapproveAsync`(**不走通用 IPostingEngine**,因需在同事务写库存);List/Get/Create/Delete 常规。**无脱敏**(无价)。
- **不入 PostableDocuments 白名单**(审核走 Service 自建,不经通用引擎)。DI 注册。`MenuCatalog` 加 `("原料仓库","原料盘点单")`;admin 9 位权限种子 `seed_raw_material_stocktake_perms.sql`。

## 前端(专用盘点页)
- `api/plasticRawMaterialStocktake.ts`:类型前缀 **RST**(RSTLine/RSTHeader/RSTDetail),base `/plastic-raw-material-stocktake`,方法含 approve/unapprove。
- `PlasticRawMaterialStocktakeLineTable.tsx`:明细列 原料编号🔍(复用 `PlasticRawMaterialPicker` 带出 原料编号/名称/产地/每包重量/单位 + **系统数量=`row.库存`**)/原料名称(只读)/产地(只读或可改)/每包重量/单位/系统数量(只读)/盘点数量(录入)/**盈亏数量(=盘点−系统·只读计算)**/备注。**无价。**
- `PlasticRawMaterialStocktakePage.tsx`:表头 日期(只读,建单日)/电脑单号/操作员(只读)/备注;底部 **系统数量/盘点数量/盈亏数量 三合计**;历史列表 + 审核/反审核/删除门控。
- App 路由 `/plastic-raw-material-stocktake` + menuTree 占位 `M("原料盘点单")` → 三参。

## 测试
- 后端 `PlasticRawMaterialStocktakeServiceDbTests`:**先在 `塑胶原料资料` 插一个测试原料(库存=100)** → create YPD(系统数量100·盘点数量90)→ Get 盈亏=−10 → **ApproveAsync 后验证 `塑胶原料资料.[库存]` 被改为 90(盘点数量)** + 审核=1 → UnapproveAsync 后审核=0 且**库存仍=90(不回滚)** → 已审核 delete 抛错。测试末尾清理测试原料。
- HTTP 冒烟:建 YPD→审核→查库存被校准→反审核→删。
- 前端 tsc 干净 + vitest 全绿。

## 里程碑 / 后续
- **⑪原料仓库录入单全部完成**:主数据/需求 YLX/采购分析/采购订单 YCD/入仓 YRC/退仓 YTC/退库 YTK/出库 YCK/**盘点 YPD**。
- **原料库存首次可被单据校准**:盘点单审核写 `塑胶原料资料.[库存]`,采购分析表/库存统计表随之反映。
- 后续:原料采购进度表/出库进度表;⑫原料报表;原料库存台账(若日后要 入仓/退仓/出库/退库 实时驱动库存,再统一建 LedgerUnion,届时盘点改为盈亏入台账)。
