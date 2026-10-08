# 原料盘点单(⑪原料仓库占位落地·收尾 ⑪) · 2026-07-01

## 做了什么
⑪ 原料仓库「原料盘点单」全屏主从录入单 —— 以实盘校准账面库存(原系统截图保真·**无价**)。**⑪原料仓库最后一张录入单,做完收尾全部录入单**。前缀 **YPD**。无选仓(原料无仓库维度)。
- **新表**(`db/38`):`原料盘点单`(头·日期/电脑单号/操作员/审核三件套/备注)+ `原料盘点明细单`(原料编号/名称/产地/每包重量/单位/**系统数量/盘点数量/盈亏数量**/备注·**无价**)。
- **后端**(新 `Features/Plastics/PlasticRawMaterialStocktake/`):DTOs(5)+Service(前缀 **YPD**·Create 盈亏=盘点−系统后端算·**审核独特**)+Controller(`api/plastic-raw-material-stocktake`·9位授权·**不注入 IPostingEngine**·Approve/Unapprove 调 svc)。**不入 PostableDocuments 白名单**(审核不走通用引擎)。DI;MenuCatalog+种子。
- **本单与前面所有原料单最大区别 = 审核会写库存**:`ApproveAsync` **自建事务**:① `UPDATE 原料盘点单 SET 审核='1',审核人,审核日期` ② `UPDATE m SET m.[库存]=d.[盘点数量] FROM [塑胶原料资料] m JOIN [原料盘点明细单] d ON d.[原料编号]=m.[物料编号] WHERE d.[单号]=@单号`(按原料编号把账面校准为盘点数)。`UnapproveAsync` 仅翻审核位=0,**不回滚库存**(盘前值不可知)。
- **前端**(专用盘点页):`api/plasticRawMaterialStocktake.ts`(类型 RST)+ LineTable(原料编号🔍复用 PlasticRawMaterialPicker·**系统数量=`row.库存` 选料带出**·盘点数量录入·**盈亏数量=盘点−系统只读派生**·系统/每包重量/单位只读·无价)+ Page(日期只读/电脑单号/操作员只读/备注·底部**系统/盘点/盈亏三合计**·历史列表+审核门控)+ 路由 + menuTree 三参。

## 决策(AskUserQuestion)
① 审核库存处理:**审核时把库存校准为盘点数(写静态列)** —— 与前面所有原料单「纯锁定」不同,盘点是唯一写库存的单;② 系统数量:**选料带出当前库存**(塑胶原料资料.[库存]静态列)。

## 执行(subagent-driven·opus 终审)
spec→plan→子代理 Task1 建表+菜单+DI+前端路由(`1608529`·**不改白名单**)/Task2 后端 DTOs+Service 含自建审核(`7cd35d3`)/Task3 Controller 不注入 IPostingEngine(`f245f0f`)/Task4 测试(`e7b9167`·428绿·**验证库存校准**)/Task5 前端 api+LineTable(`33b453c`)/Task6 录入页+路由(`c5c0131`·**本次无中断**)。lead 执行前停后端释放 bin 锁。**opus 全分支终审=READY TO MERGE**(10 点全 PASS·重点核对第3/4/6:审核 UPDATE JOIN 列/方向正确+幂等守卫/反审核无回滚语句/Controller 未注入 IPostingEngine+PostableDocuments 未动;零bug·零over-build·15文件不含白名单)。

## 测试 / 验证
- 后端 `PlasticRawMaterialStocktakeServiceDbTests`(4 测试·在塑胶原料资料插测试原料库存100→盘点系统100/盘点90:**盈亏=−10** + **审核后 SELECT [库存]=90 校准成功** + **反审核后 [库存]仍90 不回滚** + 已审核删抛错)。全量 **后端 428**(424+4)/前端 54、tsc 干净。
- **HTTP 冒烟 + DB 直接查双重验证 PASS**:建 YPD→盈亏−10→approve 204→**sqlcmd 查 塑胶原料资料.[库存]=90.0000(端到端校准成功)**→unapprove 204→**DB 库存仍90(不回滚)**→delete 204。(坑:master API 读不到库存——`塑胶原料资料` 实体**未映射 [库存] 列**·故 master get 不含库存·但审核写的是 DB [库存] 列·采购分析表/库存统计表用 service 直接 SQL SELECT [库存] 不受影响·库存校准由 DbTest 直接查 + sqlcmd 端到端双证)

## 合并
分支 `feat-raw-material-stocktake`(7 提交)→ `--no-ff` 合并 master。

## 教训/记录
- **⑪原料仓库录入单全部完成**:①塑胶原料资料(主数据)/原料生产需求表 YLX/原料采购分析表/原料采购订单 YCD/原料入仓 YRC/原料退仓 YTC/原料退库 YTK/原料出库 YCK/**原料盘点 YPD**。
- **审核写静态库存列模式(首次)**:原料库存台账延后·`塑胶原料资料.[库存]` 是静态列·**盘点是唯一在审核时主动 UPDATE 这个静态列的单**(以实盘校准账面)。做法:Service 自建 ApproveAsync 事务(翻审核位 + UPDATE m.[库存]=d.[盘点数量] FROM 塑胶原料资料 JOIN 盘点明细 ON 原料编号=物料编号),**不走通用 IPostingEngine·不入白名单**(白名单是给通用引擎翻审核位用的)。反审核不回滚(盘前值不可知)。**与塑胶盘点区别**:塑胶盘点走 posting+LedgerUnion(库存不落地·盘点盈亏作台账一支);原料无台账故审核直接写静态列。
- **实体列映射盲区**:`塑胶原料资料` 实体未映射 [库存]/[最低库存]/[最高库存] 列(列在DB·实体没映射)。故 master CRUD API 读不到库存;但 service 直接 SQL(采购分析/库存统计/盘点审核)能读写。验证审核写库存要**直查 DB**(DbTest 的 SELECT [库存] 或 sqlcmd),不能靠 master API。
- 执行前停后端释放 bin 锁(连续生效)。工具调用前缀务必 `antml:invoke`(本会话多次误写 `core:invoke` 致解析失败·已纠正)。

## 下一步
**⑪原料仓库录入单收尾完成**。剩:原料采购进度表(YCD 订购 vs YRC 入仓)/原料出库进度表;**⑫原料报表**(原料库存统计表[已 brainstorm 待落地·读塑胶原料资料静态库存·现盘点单能校准该列了]/库存月报表/生产需求汇总/订货入库统计/进度明细表/欠数统计/各查询页);原料库存台账(若日后要入仓/退仓/出库/退库实时驱动·统一建 LedgerUnion);⑩发外加工 生产加工缺料表。
