# 塑胶库存统计表 保真增强(P4 塑胶报表第一张)· 2026-06-26

## 做了什么
按原系统截图把 P3a 建的简版 `PlasticInventoryPage`(/plastic-inventory·菜单 塑胶库存)增强为对齐原系统的塑胶库存统计表。库存口径(6 支 UNION 实时聚合)不变,只外层加 JOIN 带展示列。
- **后端**(`PlasticInventoryService.ListAsync` + Controller):`PlasticStockRow` 加 颜色/工模编号/塑胶货号/单价/金额;ListAsync 加 `物料类别` 过滤参,外层 `LEFT JOIN 塑胶物料资料`(带 颜色/单价,原已带 物料类别/仓位号)+ `LEFT JOIN 塑胶共用物料表`(按物料编号 GROUP 取 MAX 工模编号/塑胶货号),金额=`SUM(数量)*ISNULL(MAX(单价),0)`(单价用 MAX 避免 GROUP BY 报错+不放大);`HAVING SUM<>0` 保留。Controller 加 物料类别 参 + **单价/金额脱敏**(无「塑胶库存·单价」权限置 null,服务端 defense-in-depth)。左树复用现成 `categories` 端点,零改。
- **前端**(重写页·镜像 MaterialInventoryPage):左物料分类树(`plasticMaterialMasterApi.categories`·选中按物料类别过滤)+ 顶部 仓库/关键词 + **导出EXCEL/打印**(复用 `utils/tableExport`)+ 全列(物料编号|工模编号|物料名称|规格|颜色|材料|塑胶货号|仓位号|单位|仓库|库存数量|单价|金额·`hidePrice` 隐藏单价/金额两列)+ 底部汇总(库存合计/金额合计·脱敏不显金额)。`api/plasticInventory.ts` 加字段+物料类别参。

## 决策(AskUserQuestion)
列=全加(工模/货号/颜色/单价/金额·脱敏);工具=导出/打印+基础过滤(左树+关键词+仓库+汇总),类型/精确查询/按款号查询/零库存切换 v1 省略;增强现有页不新建。

## 执行(subagent-driven)
brainstorming(2决策)→ spec(单价 MAX 自审)→ writing-plans(3任务·全码)→ 子代理。Task1 后端ListAsync补列/过滤/脱敏+测试 / Task2 前端重写 / Task3 冒烟+终审+合并。**opus 全分支终审 = READY TO MERGE**(7项·重点 库存union未动·两JOIN 1:1不放大行·金额 SUM×MAX(单价)multiply-once·脱敏单价金额都置null·汇总 colSpan 两权限态都对齐·实跑 5/5 DB测试)。

## 测试 / 验证
- 后端 `PlasticInventoryServiceDbTests` 加 `List_brings_join_columns_and_filters_by_category`(种物料资料+共用物料表+入仓审核100 → 读回 颜色/工模/货号/类别/单价10/金额1000 + 物料类别过滤两向)。全量 **后端 362**(361+1)/前端 54 全过、tsc 干净。
- **HTTP 冒烟全绿**:种物料(类别ABS/颜色黑/单价10/工模MJ-S/货号HH-S)→ 入仓100审核 → `GET /api/plastic-inventory?keyword=` 带出 颜色/工模/货号/类别/单价10/**金额1000** → `?物料类别=ABS` 有、`不存在类` 空 → 清理。

## 合并
分支 `feat-plastic-inventory-report`(2提交)→ `--no-ff` 合并 master `53a8f3f`,分支已删。5 文件 +127/−24。

## 里程碑:P4 塑胶报表 开张(第一张:库存统计表)
## 下一步
P4 其余报表(库存月报表/进出库统计/订购单查询/标签查询/入仓·退仓·领料·退料·报废·盘点 查询 等);各可镜像物料侧对应查询页 + 复用 tableExport。
