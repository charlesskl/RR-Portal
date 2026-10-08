# 原料生产需求表(⑪原料仓库占位落地) · 2026-06-30

## 做了什么
⑪ 原料仓库「原料生产需求表」全屏主从录入单(生产领料需求计划)。**审核纯锁定不动库存**(需求=计划·走 PostingEngine 翻审核+审核日期·绝不碰任何库存)。镜像 白件领料单(PlasticWhitePartIssue)去价格·换头(啤机生产单号/制单人/领料备注/生产车间)+明细(原料编号/原料名称/每包重量/单位/需求数量KG/需求数量包)。**新表**。
- **新表**(`db/31`):`原料生产需求表`(头·14列含 啤机生产单号/制单人/领料备注/生产车间/数量KG/数量包/审核三件套)+ `原料生产需求明细单`(明细·原料编号/原料名称/每包重量/单位/需求数量KG/需求数量包/备注)。
- **后端**(新 `Features/Plastics/PlasticRawMaterialDemand/`):DTOs(5)+Service(前缀 **YLX**·CreateAsync 数量KG=SUM(需求KG)/数量包=SUM(需求包)·List/Get/DeleteAsync 已审核抛错)+Controller(`api/plastic-raw-material-demand`·9位授权·审核走 IPostingEngine·**无价格脱敏**)。过账白名单 `["原料生产需求表"]="单号"`;DI;MenuCatalog `("原料仓库","原料生产需求表")`;admin 9 位权限种子(**新文件名 `seed_plastic_raw_material_demand_perms.sql`·确认未撞**)。
- **前端**:新 `PlasticRawMaterialPicker`(克隆 PlasticMaterialPicker over `plasticRawMaterialMasterApi`·选原料回填 原料编号/原料名称/单位)+ `PlasticRawMaterialDemandLineTable`(原料编号🔍/每包重量/需求KG/需求包)+ `PlasticRawMaterialDemandPage`(克隆白件领料单页·头 啤机生产单号/开单日期只读/制单人EmployeePicker必填/操作员只读/领料备注下拉/生产车间Input/备注·底部 **需求KG合计+需求包合计 双汇总**·历史列表+审核/反审核/删除门控)+ App 路由 + menuTree line126 三参。

## 决策(AskUserQuestion)
审核纯锁定·不动库存(需求=计划单·三件套);明细 原料编号🔍从塑胶原料资料带名称/单位·每包重量手录·**需求KG与需求包两者独立录入**·底部分别汇总。

## 执行(subagent-driven)
spec→plan→子代理 Task1 建表+白名单+DI(`17551b7`)/Task2 后端(`de10687`)/Task3 测试(`318527e`·407绿)/Task4 前端(`4ff680b`·tsc0+vitest54)/Task5 Release冒烟+opus终审。**opus 全分支终审=READY TO MERGE**(7点:审核纯锁定 LedgerUnion未改·白名单仅加一行/INSERT列对齐·数量KG/包SUM·已审核删抛错/路由+9位授权+无价格脱敏遗留/菜单权限DI齐·**种子新文件名未撞**/前端picker回填+双汇总+制单人必填+门控/DTO↔SQL↔前端一致/全参数化·未动白件领料单及LedgerUnion)。

## 测试 / 验证
- 后端 `PlasticRawMaterialDemandServiceDbTests`(create YLX·数量KG=8/数量包=2/明细2 + approve 审核1+审核日期 + delete 已审核抛错)。全量 **后端 407**(404+3)/前端 54、tsc 干净。
- **HTTP 冒烟全生命周期 PASS**:建 YLX20260630001→审核→数量KG8/包2/明细2→列表→**已审核删拒409**→反审核后删。

## 合并
分支 `feat-plastic-raw-material-demand`(5 提交)→ `--no-ff` 合并 master `464d94c`,分支已删。17 文件 +1506/−1。

## 教训/记录
- 上次"种子文件名撞车"教训生效:本次新建 db 种子前先 `ls db/ | grep` 确认 `seed_plastic_raw_material_demand_perms.sql` 未占用,且 plan/子代理都显式标注"确认文件名未撞"。无事故。
- **原料编号 picker 复用塑胶原料资料**:刚建的塑胶原料资料表(0ec6aa1)立即被本单 PlasticRawMaterialPicker 复用——主数据建好后下游单据即可选。
- 录入单"纯锁定不动库存"模式(白件领料单→原料生产需求表)稳定克隆:新两表+DTOs+Service(前缀/SUM合计/已审核删保护)+Controller(三件套·无价格脱敏)+前端(picker+LineTable+Page+双汇总)。

## 下一步
⑩发外加工 生产加工缺料表(最后一项);⑪原料仓库余下(原料采购分析表/采购订单/进度表/出入库单等);⑫原料报表;⑦塑胶物料设置/进度明细表/物料进出汇总;⑧工模表/塑胶标签单;塑胶库存月报表。
