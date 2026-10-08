# 原料退库表(⑪原料仓库占位落地) · 2026-07-01

## 做了什么
⑪ 原料仓库「原料退库表」全屏主从录入单 —— **生产领用链**的退料回仓(把领出的原料退回原料仓库·原系统截图保真)。表头 部门/退料人(生产领料侧),**无价**,明细带 啤机生产单号/开单日期。与「原料退仓单」(退回供应商·带价)是**另一条链**。前缀 **YTK**。
- **前置主数据加列**:给可编辑主数据 `塑胶原料资料` 补 产地/每包重量 两列(原系统原料资料含此二列·重建时省略)。**五处**:db/30 建表体 + 新 `db/36` 幂等 ALTER 补列(对已存在库)+ 实体 `塑胶原料资料.cs` 两 `[Column]`(MasterCrudController 泛型自动纳入 CRUD)+ 前端 `PlasticRawMaterialRow` 两字段 + 共享选择器 `PlasticRawMaterialPicker`(列 + onPick 带出)+ 主数据页 `PlasticRawMaterialMasterPage`(列表列 + 编辑弹窗输入框)。
- **新表**(`db/35`):`原料退库表`(头·部门/日期/退料人/电脑单号/操作员/数量/审核三件套·**无金额**)+ `原料退库明细单`(啤机生产单号/开单日期/原料编号/名称/产地/每包重量/单位/数量/备注·**无单价金额**)。
- **后端**(新 `Features/Plastics/PlasticRawMaterialStockReturn/`):DTOs(5·无价)+Service(前缀 **YTK**·数量=SUM·**无金额计算**·审核纯锁定·List/Get/Delete 已审核抛错)+Controller(`api/plastic-raw-material-stock-return`·9位授权·审核走 IPostingEngine·**镜像无价需求表 Controller·无 CanPrice/脱敏**)。过账白名单 `["原料退库表"]="单号"`;DI;MenuCatalog `("原料仓库","原料退库表")`;种子 `seed_raw_material_stock_return_perms.sql`。
- **前端**(克隆无价领料录入页):`api/plasticRawMaterialStockReturn.ts`(类型 RSR*)+ `PlasticRawMaterialStockReturnLineTable`(啤机生产单号文本/开单日期**行内 DatePicker**[dayjs·存 YYYY-MM-DD]/原料编号🔍复用 PlasticRawMaterialPicker **带出产地/每包重量/单位**/**无价列**)+ `PlasticRawMaterialStockReturnPage`(部门文本/日期只读/**退料人🔍 EmployeePicker**[onPick 姓名]/电脑单号/操作员只读/备注·底部**仅数量合计**·历史列表+审核门控)+ App 路由 + menuTree 三参。

## 决策(AskUserQuestion)
① 产地/每包重量:**主数据加两列 + 选料带出**(保真·非手录);② 库存过账:**v1 纯锁定不动库存**(与已建原料单一致·台账延后);③ 前缀 **YTK**。

## 执行(subagent-driven·opus 终审)
spec→plan→子代理 Task1 主数据加列(`c194cde`·build+tsc绿·两库列非NULL)/Task2 建表+接线(`45a8ebf`)/Task3 后端(`c5209f2`)/Task4 Controller(`400f44b`)/Task5 测试(`6bb9197`·421绿)/Task6 前端 api+LineTable(`e0accf7`)/Task7 录入页+路由(`8229015`·**本次无中断**)。lead 执行前先停后端 dev server 释放 bin 锁(前几单教训生效)。**opus 全分支终审=READY TO MERGE**(10 点全 PASS:主数据加列五处一致/新表无价/YTK/审核纯锁定[LedgerUnion未建·master服务零diff]/数量SUM+全单无价/**五处列对齐**[含啤机生产单号/开单日期/产地/每包重量四新字段]/白名单菜单DI种子/EmployeePicker退料人+选料带出+DatePicker行内+门控/路由类型一致;零bug·零over-build·22文件与预期吻合)。

## 测试 / 验证
- 后端 `PlasticRawMaterialStockReturnServiceDbTests`(create YTK·数量8·部门/退料人·啤机生产单号 PPJ001·产地台湾·每包重量25·开单日期 round-trip + approve 审核1+审核日期 + delete 已审核抛错)。全量 **后端 421**(418+3)/前端 54、tsc 干净。
- **HTTP 冒烟两组 PASS**:①退库表全生命周期(建 YTK20260701001→数量8/部门/退料人/明细2/啤机/产地/开单日期→approve 204→审核1→已审核删拒 409→unapprove 204→delete 204);②**主数据加列 CRUD**(新建原料带产地韩国锦湖/每包重量25→GET 回显→delete·证实实体加列 + MasterCrud 自动 CRUD 生效)。

## 合并
分支 `feat-raw-material-stock-return`(8 提交)→ `--no-ff` 合并 master。

## 教训/记录
- **原料仓库两条链并行推进**:①供应商链 入仓 YRC(+)/退仓 YTC(−)·带价;②**生产领用链** 退库 YTK(+·退料回仓)本单先建·出库表(领料−)后续·**无价·部门/退料人头**。
- **可编辑主数据加列的完整闭环**:表(建表体+幂等 ALTER 补列)→ 实体 [Column](MasterCrudController 泛型自动含 CRUD/保存/脱敏)→ 前端类型 → 共享选择器(列+回填)→ 主数据页(列表+编辑弹窗)。加列是纯增,现有调用方忽略即可不破坏。**共享选择器 PlasticRawMaterialPicker 增列后,入仓/退仓单选料以后也能带出产地/每包重量(本次未回填增强)**。
- **无价单模板**:镜像 原料生产需求表(Controller 无 CanPrice·DTO/Service 无单价金额·前端无价列·底部仅数量合计)。带价 vs 无价按单据链选模板。
- 行内 DatePicker:dayjs·value={dayjs(str)}·onChange 存 YYYY-MM-DD 字符串·后端 DateTime? 绑定。
- 执行前停后端 dev server 释放 bin 锁(避免 MSB3027·连续生效)。

## 下一步
原料出库表(领料·YCK?·−·与退库配对·无价·部门/领料人头);原料采购进度表(YCD 订购 vs YRC 入仓);**原料库存台账**(接 入仓+/退仓−/出库−/退库+ 四支·再改采购分析表/库存列表读法);原料盘点单;⑫原料报表;⑩发外加工 生产加工缺料表。
