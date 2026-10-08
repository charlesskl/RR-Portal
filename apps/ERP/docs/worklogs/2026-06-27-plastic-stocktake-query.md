# 塑胶盘点查询(塑胶各单据查询 4 张之④·收官)· 2026-06-27

## 做了什么
塑胶盘点单 只读两 Tab 查询(汇总按物料编号 + 明细)+ 双击**专用**只读抽屉。**4 张塑胶单据查询收官**。最分歧的一张:三数量列(系统数量/盘点数量/盈亏数量)、头无部门/人、单价取塑胶物料资料、金额=盈亏数量×单价。
- **后端**(扩 `PlasticStocktakeService`):`ApprovalFilter` + `StocktakeQueryDetail/SummaryAsync`。`塑胶盘点明细单 d JOIN 塑胶盘点单 h`(日期/审核)`LEFT JOIN (塑胶共用物料表 GROUP BY 物料编号) cm`(塑胶货号/共用货号=cm.塑胶货号)`LEFT JOIN (塑胶物料资料 GROUP BY 物料编号) m`(单价/物料类别);两子查询 1:1。**单价=m.单价·金额=d.盈亏数量×ISNULL(m.单价,0)**(明细)/`SUM(d.盈亏数量×单价)`(汇总·非 SUM(盈亏)×单价)。汇总 GROUP BY 物料编号+颜色·三数量 SUM。新 `PlasticStocktakeQueryController`(`api/plastic-stocktake-query`·菜单 塑胶盘点查询·单价/金额脱敏)。
- **前端**:两 Tab 页(三数量列·盈亏可负)+ **专用只读抽屉 `PlasticStocktakeQueryDetailDrawer`**(列异构:系统/盘点/盈亏数量·无价·头单号/日期/仓库/审核无部门人)。
- **服务 ctor 3 依赖**(`factory, docNo, PlasticInventoryService`)→ 测试 `new PlasticStocktakeService(f, new DocumentNumberGenerator(), new PlasticInventoryService(f))`。

## 执行
plan(全 SQL/DTO)→ 子代理 Task1 后端(374·ctor 3 依赖处理·金额验证 row 4/-2·summary 盈亏1/金额2)/Task2 前端(54·tsc 干净·专用抽屉)/Task3 冒烟+终审+合并。**opus 终审 READY**(10 项·金额=盈亏×单价[明细 per-row + 汇总 SUM(盈亏×单价)]·三数量·负盈亏·脱敏无泄露[抽屉本无价]·其它三模板未动)。

## 测试 / 验证
- 后端 `PlasticStocktakeQueryServiceDbTests`(种 共用物料表/物料资料[单价2]/盘点单/明细[系统10,5·盘点12,4·盈亏2,-1] → Detail 塑胶货号 H-PD/单价2/金额4 与 -2 + Summary 系统15/盘点16/盈亏1/金额2 + 审核/物料类别/keyword/区间)。全量 **后端 374**(373+1)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:detail 系统/盘点/盈亏/单价2/金额=盈亏×单价(4 与 -2);summary 单行 系统15/盘点16/盈亏1/金额2;未审核空。

## 合并
分支 `feat-plastic-stocktake-query`(2 提交)→ `--no-ff` 合并 master `a33706c`,分支已删。11 文件 +408/−1。

## 里程碑:塑胶各单据查询 4 张全部完成
①领料 `a3b40c4` ②退料 `7657ca1` ③报废 `45b5663` ④盘点 `a33706c`。共同口径:共用货号=塑胶共用物料表.塑胶货号·共用物料=共用原料编号(LEFT JOIN GROUP BY 物料编号 1:1);两 Tab 汇总+明细·双击只读抽屉(领料/退料/报废 通用抽屉·盘点专用列异构)·带价脱敏·日期工具栏+审核情况+物料类别·导出打印。

## 下一步
P4 余下塑胶报表(库存月报表/入仓查询[需先做第2步两Tab+只读抽屉·入仓录入保真已扩五列]/退仓查询等)。塑胶单据查询模板已极成熟。
