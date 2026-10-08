# 原料本月库存汇总(P4 塑胶报表第四张)· 2026-06-26

## 做了什么
按原系统截图做原料本月库存汇总:按 **原料名称(=塑胶物料名称)** 汇总 本月库存/存外厂数量/本月报废/本月总数。**纯数量·无金额·无重量列**(数据源缺口务实处理)。
- **后端**(扩 `PlasticInventoryService`,复用 `LedgerUnion` 不动):`RawMaterialMonthlySummaryAsync(起,止,keyword?)` —— CTE **库存**=`(LedgerUnion)` 按物料名称 SUM(数量)(=当前实时库存·已扣全部报废)+ CTE **报废**=`塑胶报废明细单 JOIN 塑胶报废单`(审核='1'+单据日期∈[起,止])按物料名称 SUM(数量),二者 `FULL OUTER JOIN` on 物料名称 → 原料名称/本月库存/`存外厂数量=0`/本月报废/`本月总数=库存+报废`;keyword 过滤名称·滤全零行。新 `PlasticRawMaterialController`(`api/plastic-raw-material-summary`·菜单 原料本月库存汇总)+MenuCatalog+种子。无金额无脱敏。
- **前端**(新报表页):`PlasticRawMaterialSummaryPage`——上月/本月/下月+RangePicker(默认本月)+原料名称关键词+导出/打印;列 原料名称|本月库存|存外厂数量|本月报废|本月总数+底部汇总。

## 决策(AskUserQuestion·数据源缺口务实)
存外厂(重量/数量)无塑胶外厂数据源 → **保留「存外厂数量」一列恒0·重量列省略**;重量(KG)系列列 → **省略只做数量**(无可靠单件净重);本月库存 → **当前实时库存**(UNION无快照·报废=区间)。总数=库存+报废、按物料名称分组。

## 执行(subagent-driven)
brainstorming(**先探数据源·诚实flag缺口**:存外厂/重量无源→3个口径问用户)→ spec → writing-plans(3任务·全码)→ 子代理。Task1 后端(顺利·365)/Task2 前端(顺利·54)/Task3 冒烟+终审+合并。**opus 全分支终审 = READY TO MERGE**(8项·重点 LedgerUnion零删除·库存=当前/报废=区间·FULL OUTER JOIN投影·测试算术;明确「存外厂0/无重量」为按设计缺口非bug)。

## 测试 / 验证
- 后端 `PlasticRawMaterialSummaryServiceDbTests`(种 入仓100[6月]+报废20[6月]+报废7[5月]审核 → 当前库存=100−20−7=73、本月报废=20[仅6月]、本月总数=93、存外厂=0)。全量 **后端 365**(364+1)/前端 54 全过、tsc 干净。
- **HTTP 冒烟全绿**:种 入仓100+报废20[本月]审核 → `GET /api/plastic-raw-material-summary?起=&止=&keyword=RAWSMK` → 库存80/存外厂0/报废20/总数100。

## 合并
分支 `feat-plastic-raw-material-summary`(2提交)→ `--no-ff` 合并 master `7befa2e`,分支已删。9 文件 +220/−1。

## 教训/记录
**报表如实留缺口**:原系统有「存外厂」「重量」数据,重建里无塑胶外厂库存源/无可靠单件净重 → 不臆造,存外厂列恒0、重量列不画,并 brainstorming 时显式 flag 给用户拍板。后续有发外加工塑胶数据再补存外厂。

## 下一步
P4 余下塑胶报表(库存月报表/订购单查询/标签查询/各单据查询等)。
