# 白件领料单(⑩发外加工占位落地)· 2026-06-29

## 做了什么
⑩ 发外加工「白件领料单」落地——全屏主从录入单。白件=半成品发给加工厂喷油。**审核纯锁定不动库存**(走通用 PostingEngine 只翻 审核='1'+写审核日期,**绝不碰 PlasticInventoryService.LedgerUnion**;白件库存未建模)。镜像 `塑胶加工采购单`(PlasticProcessPurchaseOrder)去价格、换头字段、明细加 发外采购/单位 列。BOM 调入按生产单号从 塑胶共用物料表。
- **新表**(`db/29_plastic_white_part_issue.sql`·EF不迁移):`白件领料单`(头·单号/日期/领料部门/领料人/胶箱数/卡板数/领料备注/数量/操作员/电脑单号/审核/审核人/审核日期/备注)+ `白件领料明细单`(发外采购/生产单号/款号/物料编号/模具编号/物料名称/颜色/用料名称/单位/数量/备注)。
- **后端**(新 `Features/Plastics/PlasticWhitePartIssue/`):DTOs + Service(`BasisAsync` 按生产单号 BOM[工模编号→模具编号·单位 LEFT JOIN 塑胶物料资料]/`CreateAsync` 前缀 **BJL**·数量合计=SUM明细/`ListAsync`/`GetAsync`/`DeleteAsync` 已审核抛错)+ Controller(`api/plastic-white-part-issue`·9位授权·**无价格脱敏**[不带价])。过账白名单 `["白件领料单"]="单号"`;DI 注册;MenuCatalog `("发外加工","白件领料单")`;admin 9 位权限种子(两库)。
- **前端**:`api/plasticWhitePartIssue.ts` + `PlasticWhitePartIssueLineTable`(列序 发外采购|生产单号🔍|款号🔍|模具编号|物料编号🔍|物料名称只读|颜色|用料名称|单位|数量|备注·无价格)+ `PlasticWhitePartIssuePage`(头 部门/日期只读/领料人🔍必填[EmployeePicker]/操作员只读/电脑单号只读/胶箱数/卡板数/领料备注下拉/备注·工具栏 新建/保存/调入清单[ProductionPicker→basis→setLines]/打印·底部 数量合计+制单人·历史单列表双击打开+审核/反审核/删除)+ App 路由 `plastic-white-part-issue` + menuTree 三参接线。

## 决策(AskUserQuestion)
审核纯锁定·不动库存(同塑胶加工采购单·三件套);v1=头+明细+保存+审核+列表/打开/删除·调入清单按生产单从BOM·**省右侧库存参考面板**(与塑胶领料单不同,白件无库存源);发外采购无BOM源→调入留空用户录入;重量统计无源省略。

## 执行(subagent-driven)
brainstorm→spec→plan→子代理 Task1 建表+白名单+DI(`6d4bdb9`)/Task2 后端(`0f3e3f5`·补 `using MasterData` 取 PagedResult)/Task3 测试(`1c6313e`·393绿)/Task4 前端(`a1dfbeb`·tsc 0+vitest54)/Task5 Release冒烟+opus终审。**opus 全分支终审=READY TO MERGE**(7点:LedgerUnion未改/INSERT列对齐/无价格脱敏遗留/basis 1:1/菜单权限DI齐/前端列序与截图一致/无注入)。

## 测试 / 验证
- 后端 `PlasticWhitePartIssueServiceDbTests`(basis 带出 模具编号/物料名称/款号/单位=个 + create BJL 往返 数量=8 + approve 审核=1且审核日期非空 + delete 已审核抛错)。全量 **后端 393**(390+3)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:basis BOM 1行(GM-BJSMK/白件A/个)→ create `BJL20260629001`(201)→ approve(204)→ get 审核=1/数量=7/明细1(发外采购=采购)→ list 含新单。

## 合并
分支 `feat-plastic-white-part-issue`(6 提交)→ `--no-ff` 合并 master `d5829cc`,分支已删。16 文件 +1687/−1。

## 教训/记录
- 白件领料单与塑胶领料单(SLL)不同:**塑胶领料单减塑胶库存(LedgerUnion 领料支),白件领料单纯锁定不动库存**(白件=发外半成品·与原料塑胶物料不同·库存未建模)。
- 冒烟前 LocalDB 实例可能处停止态:`SqlLocalDB start MSSQLLocalDB` 后从 `SqlLocalDB info` 解析 `np:\\.\pipe\...` 命名管道再 sqlcmd(`(localdb)\MSSQLLocalDB` 名解析失败时)。
- 单据流水号表名非 `单据流水号`(清理冒烟时报 Invalid object name·业务数据已清·计数器残留无害)。

## 下一步
⑩发外加工余下(加工入仓单/采购加工进度表/采购加工明细表/加工领料进度表/物料发外欠数表/生产加工缺料表);⑦塑胶物料设置/进度明细表/物料进出汇总;⑧工模表/塑胶标签单;塑胶库存月报表。
