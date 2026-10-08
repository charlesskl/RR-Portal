# 塑胶订单制作(⑦塑胶采购占位落地)· 2026-06-29

## 做了什么
⑦ 塑胶采购「塑胶订单制作」落地——**只读单表平铺查询**:把已审核(塑胶共用物料表.调整审核='1')的塑胶 BOM 按生产单展开列出。提示"只显示已审核物料BOM清单内容"。无录入/无开单(开单是塑胶采购分析的职责)。
- **后端**(扩 `PlasticMaterialDocService`):`OrderMakeListAsync(起,止,keyword?)`。`生产制单货号 g JOIN 塑胶共用物料表 p ON p.塑胶货号=g.货号 JOIN 生产制单 pm ON 生产单号 LEFT JOIN (塑胶物料资料 GROUP BY 物料编号) m`(单位);WHERE pm.日期∈区间 + **p.调整审核='1'** + keyword。**订购数量=p.用量×ISNULL(pm.计划数量,0)·金额=订购数量×ISNULL(p.加工单价,0)**。p JOIN g 按塑胶货号=货号是 BOM 展开(1:N 正常·与 BasisAsync 同口径);pm(生产单号 UNIQUE)/m 1:1。新 `PlasticOrderMakeController`(`api/plastic-order-make`·菜单 塑胶订单制作[组"塑胶采购"]·加工单价/金额脱敏)。
- **前端**:`PlasticOrderMakePage`(单 Tab 平铺·克隆 PlasticAnalysisDetailPage 去完成情况/汇总)——上月/本月/下月+RangePicker(默认本月)+关键词(生产单号/款号/物料)+导出EXCEL/打印+"共 N 条";列 单据日期/生产单号/款号/塑胶货号/工模编号/物料编号/物料名称/颜色/用料名称/单位/用量/计划数量/订购数量/(加工单价/金额 hidePrice 隐藏)。

## 决策(AskUserQuestion)
已审核=塑胶共用物料表.调整审核='1'(BOM 清单本身已调整审核/做完);订购数量=用量×计划数量;订单单号列省略(无源)。

## 执行(subagent-driven)
brainstorming(探明 BOM 源=生产制单货号 JOIN 共用物料表·确认 调整审核/订购数量/订单单号三处)→ spec → plan(全 SQL/DTO)→ 子代理 Task1 后端(375·生产制单货号列=生产单号/货号确认·调整审核列名确认)/Task2 前端(54·tsc 干净)/Task3 冒烟+终审+合并。**opus 终审 READY**(9 项·BOM 展开 JOIN grain 故意正确[与 BasisAsync 同]·调整审核过滤验证·订购=用量×计划·金额=订购×单价·脱敏无泄露)。

## 测试 / 验证
- 后端 `PlasticOrderMakeServiceDbTests`(种 款号总表父→生产制单[计划100]→生产制单货号→共用物料表[调整审核 1 一行 + 0 一行]→物料资料 → 仅审核1行出·订购200·金额600·款号/单位带出·区间/keyword 过滤·调整审核0被滤)。全量 **后端 375**(374+1)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:订购数量=用量2×计划100=200·金额=200×3=600·款号 K-OMS/单位 kg·调整审核'0'行被过滤·keyword 无关空。

## 合并
分支 `feat-plastic-order-make`(2 提交)→ `--no-ff` 合并 master `14ee80e`,分支已删。10 文件 +234/−1。

## 教训/记录
- BOM 展开查询 grain=按 货号→共用物料表(1:N 是 BOM 需求,非 bug);与 `PlasticMaterialDocService.BasisAsync` 同口径。生产制单.款号 FK→款号总表(种父反序清)。

## 下一步
P4 余下:塑胶入仓查询/退仓查询(拆两步第2步·录入保真已扩五列)、塑胶库存月报表;⑦塑胶采购其余占位(塑胶物料设置/采购订单/进度表等)、⑧工模表/塑胶标签单。
