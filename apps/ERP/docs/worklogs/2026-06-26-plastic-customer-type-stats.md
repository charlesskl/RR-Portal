# 塑胶类型客户统计(P4 塑胶报表第三张·透视表)· 2026-06-26

## 做了什么
按原系统截图做塑胶类型客户统计:**行=客户 × 列=塑胶类型(=加工内容)×(本月数量/本月金额)+ 总合计**,按日期区间(单据日期+审核='1')。
- **数据源**:`塑胶物料单`(头 客户/日期/审核)+ `塑胶物料明细单`(加工内容=类型/订购数量=数量/金额)。
- **后端**(扩 P2 `PlasticMaterialDocService`):`CustomerTypeStatsAsync(起,止,客户?)` —— 明细 JOIN 单头(N:1·无行放大),`GROUP BY 客户 × ISNULL(NULLIF(TRIM(加工内容),''),'未分类')`,数量=SUM(订购数量)/金额=SUM(金额),WHERE 审核='1'+单据日期∈[起,止],HAVING 滤全零,返回**扁平行** `PlasticCustomerTypeStatRow{客户,类型,数量,金额}`。新 `PlasticCustomerTypeController`(`api/plastic-customer-type-stats`·菜单 塑胶类型客户统计·**金额脱敏**:无金额权限置 null)+ MenuCatalog + 种子。复用 PlasticMaterialDocService DI。
- **前端**(新透视页):`PlasticCustomerTypeStatsPage` —— 上月/本月/下月 + RangePicker(默认本月)+ 客户关键词 + 货币转换下拉(只默认·禁用)+ 导出/打印。**前端透视**(useMemo):去重类型→动态列组(每类型 本月数量[+本月金额])+ 总合计组;底部总合计行(summary 用计数器 idx 顺序发 leaf cells·随金额权限增减)。金额列/汇总/导出 三处按 `金额Hidden=!can(金额)` 一致隐藏。`api/plasticCustomerType.ts` + 路由 + 填占位菜单。

## 决策(AskUserQuestion)
数据源=塑胶物料单(客户头/加工内容=类型/订购数量=数量);类型列动态(实际加工内容);货币转换 v1 只默认。另:后端扁平行+前端透视、金额按权限脱敏。

## 执行(subagent-driven)
brainstorming(3决策)→ spec → writing-plans(3任务·全码)→ 子代理。Task1 后端(顺利·后端364)/Task2 前端(顺利·tsc 需给 columns 加 `ColumnsType<PivotRow>` 注解防 never[] 推断)/Task3 冒烟+终审+合并。**opus 全分支终审 = READY TO MERGE**(8项·重点 #1 JOIN N:1 无行放大[一单号一头]·#4 透视 summary leaf-cell index 两权限态都对齐·金额脱敏 table/summary/export 一致无 NaN)。

## 测试 / 验证
- 后端 `PlasticCustomerTypeStatsServiceDbTests`(种 客SCTA[原胶件10/100+印喷件5/50]+客SCTB[原胶件3/30] 本月审核 + 区间外/未审核各一 → 验三行聚合+排除+客户过滤2行)。全量 **后端 364**(363+1)/前端 54 全过、tsc 干净。
- **HTTP 冒烟全绿**:种两客户单 → `GET /api/plastic-customer-type-stats?起=&止=&客户=客SMK` → 客SMKA原胶件10/100·客SMKA印喷件5/50·客SMKB原胶件3/30。

## 合并
分支 `feat-plastic-customer-type-stats`(2提交)→ `--no-ff` 合并 master `a5699cd`,分支已删。10 文件 +253/−1。

## 下一步
P4 余下塑胶报表(库存月报表/订购单查询/标签查询/各单据查询等·镜像物料侧查询页+tableExport)。透视/汇总报表模式(扁平后端+前端 pivot/汇总+金额脱敏+日期工具栏+导出打印)已成型可复用。
