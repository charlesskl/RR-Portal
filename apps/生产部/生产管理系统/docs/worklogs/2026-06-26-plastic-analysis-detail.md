# 塑胶分析明细查询(P4 塑胶报表第五张)· 2026-06-26

## 做了什么
塑胶物料单(塑胶采购分析)的**扁平明细查询**:按日期区间+关键词+完成情况列出每条塑胶物料明细行(只读·单 Tab·镜像物料侧查询页)。
- **后端**(扩 P2 `PlasticMaterialDocService`):`AnalysisDetailAsync(起,止,keyword?,完成?)` —— `塑胶物料明细单 d JOIN 塑胶物料单 h`(日期)`LEFT JOIN 生产制单 p ON p.生产单号=d.生产单号`(款号/完成·**生产单号 UNIQUE 1:1 不放大**)`LEFT JOIN 塑胶物料资料`(材料=物料类别/单位)。WHERE 日期∈[起,止]+keyword(OR 生产单号/款号/货号/物料编号/物料名称)+完成(`ISNULL(p.完成,'否')=@done`)。数量=订购数量·完成=`ISNULL(p.完成,'否')`。新 `PlasticAnalysisController`(`api/plastic-analysis-detail`·菜单 塑胶分析明细查询)+MenuCatalog+种子。**加工单价/金额脱敏**(无「塑胶分析明细查询·单价」权限置 null)。
- **前端**(新查询页):`PlasticAnalysisDetailPage`——上月/本月/下月+RangePicker(默认本月)+**完成情况下拉**(全部/已完成[是]/未完成[否])+关键词+导出/打印;列 日期|生产单号|款号|货号|物料编号|物料名称|颜色|材料|单位|加工内容|数量|加工单价|金额|完成(加工单价/金额 hidePrice 隐藏)+底部汇总。

## 决策(AskUserQuestion)
完成情况=接生产制单.完成(存 N'是'/N'否'·LEFT JOIN 生产单号);加工单价/金额=带价+按权限脱敏。另:单 Tab 扁平明细(无汇总 Tab)。

## 执行(subagent-driven)
brainstorming(2决策·先探数据源链 塑胶物料单+生产制单款号/完成)→ spec → writing-plans(3任务·全码)→ 子代理。Task1 后端(顺利·366·**子代理踩 FK:生产制单.款号 有 FK_144→款号总表,种子加 款号总表 父行**)/Task2 前端(顺利·54)/Task3 冒烟+终审+合并。**opus 全分支终审 = READY TO MERGE**(7项·重点 #1 两 LEFT JOIN 1:1 无行放大[生产单号 UNIQUE+物料资料 GROUP BY]·#4 测试自洽含 款号总表 FK 父行顺序·#6 汇总 colSpan/index 两权限态对齐)。

## 测试 / 验证
- 后端 `PlasticAnalysisDetailServiceDbTests`(种 款号总表→塑胶物料资料→生产制单[款号/完成是]→塑胶物料单→明细 → 验带出款号/材料/单位/数量/加工单价/完成 + 完成/keyword/区间过滤·反序清理)。全量 **后端 366**(365+1)/前端 54 全过、tsc 干净。
- **HTTP 冒烟全绿**:种链(含 款号总表 父)→ `GET /api/plastic-analysis-detail?起=&止=&keyword=PADSMK` → 款号K-SMK/材料ABS/数量8/加工单价5/金额40/完成是;`&完成=否` 空。

## 合并
分支 `feat-plastic-analysis-detail`(2提交)→ `--no-ff` 合并 master `092e5fe`,分支已删。10 文件 +249/−1。

## 教训/记录
**生产制单.款号 有 FK→款号总表**:任何种 生产制单 的测试/冒烟须先种 款号总表 父行,清理反序(生产制单先于款号总表删)。

## 下一步
P4 余下塑胶报表(库存月报表/订购单查询/标签查询/各单据查询等)。扁平明细查询模式(JOIN 链+日期工具栏+完成/审核过滤+脱敏+导出打印)已成型可复用。
