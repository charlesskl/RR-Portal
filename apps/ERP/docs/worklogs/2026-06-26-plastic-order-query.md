# 塑胶订购单查询(P4 塑胶报表第六张)· 2026-06-26

## 做了什么
塑胶物料单(订购单)的**只读两 Tab 查询**:汇总查询(按物料编号+规格+颜色 GROUP·SUM 订购数量/金额)+ 明细查询(逐行);按 订货日期区间 + 审核情况 + 物料类别 + 关键词过滤;明细双击复用现成 `PlasticMaterialDocDrawer` 按单号开整单(只读)。
- **后端**(扩 P2 `PlasticMaterialDocService`):`ApprovalFilter(审核情况)` 固定 switch 片段(已审核/未审核/全部) + `OrderQueryDetailAsync(起,止,keyword?,审核情况?,物料类别?)` + `OrderQuerySummaryAsync(...)`。明细 JOIN 链 `塑胶物料明细单 d JOIN 塑胶物料单 h ON 单号`(日期/审核)`LEFT JOIN 生产制单 p ON 生产单号`(款号·**生产单号 UNIQUE 1:1 不放大**)`LEFT JOIN (塑胶物料资料 GROUP BY 物料编号) m`(材料=物料类别/规格/单位·**子查询 GROUP 1:1·因 塑胶物料资料.物料编号 无 UNIQUE 约束故防御性 GROUP**)。数量=订购数量。汇总 `GROUP BY 物料编号,m.规格,颜色` SUM。新 `PlasticOrderQueryController`(`api/plastic-order-query`·`/detail`+`/summary`·菜单 塑胶订购单查询)+MenuCatalog+种子。**加工单价/金额(明细)、金额(汇总)脱敏**(无「塑胶订购单查询·单价」权限置 null·服务端 query 后置 null·导出仅客户端态不泄露)。
- **前端**(新两 Tab 查询页·镜像 `PurchaseOrderQueryPage`):`PlasticOrderQueryPage`——上月/本月/下月+RangePicker(默认本月)+审核情况下拉(全部/已审核/未审核)+物料类别下拉(`plasticMaterialMasterApi.categories()`)+关键词+导出EXCEL/打印(按当前 Tab 列/数据);两 Tab 明细(日期/单号/工模编号/生产单号/款号/货号/物料编号/物料名称/颜色/材料/规格/单位/数量/加工单价/金额/审核)+ 汇总(物料编号/物料名称/物料类别/规格/颜色/单位/数量/金额);明细 `onRow.onDoubleClick` → `PlasticMaterialDocDrawer open 单号={viewing}` 只读看整单(`isView=!!currentNo`)。`api/plasticOrderQuery.ts` typed。

## 决策(AskUserQuestion)
v1 省略 物料查询(共用物料)切换/精确查询/高级查询/表格设置;两 Tab(汇总+明细)+ 明细双击开单据(复用 PlasticMaterialDocDrawer 按单号)。数据源=塑胶物料单+明细(**无独立塑胶采购订单表**)。

## 执行(subagent-driven)
brainstorming(先探数据源:无采购订单表→塑胶物料单·确认 drawer 按单号开·两 Tab 镜像 PurchaseOrderQueryPage)→ spec → writing-plans(3任务·全码)→ 子代理。Task1 后端(顺利·367·`[ID]` 存在于 塑胶物料明细单 故 ORDER BY 保留;**子代理为重建 Release 杀掉占用 DLL 的 dev 后端**)/Task2 前端(顺利·54·tsc 干净·drawer `onSaved` 可选故省·`PermAction` 是字面量联合非枚举·列显式 `ColumnsType<Row>`)/Task3 冒烟+终审+合并。**opus 全分支终审 = READY TO MERGE**(7 项全 PASS·重点 #1 两 LEFT JOIN 1:1 无放大[生产单号 UNIQUE+物料资料 GROUP]·#2 脱敏服务端+客户端一致导出不泄露·#3 ApprovalFilter 固定 switch 注入安全·#5 测试含 款号总表 FK 父行顺序)。

## 测试 / 验证
- 后端 `PlasticOrderQueryServiceDbTests`(种 款号总表→塑胶物料资料→生产制单[款号]→塑胶物料单[审核1]→明细 2 行 → detail 2 行带款号/材料/规格·summary 数量8/金额40 + 审核情况/物料类别/keyword/区间外过滤·反序清理)。全量 **后端 367**(366+1)/前端 54 全过、tsc 干净。
- **HTTP 冒烟全绿**:种链(款号总表 K-OQS 父先)→ `GET /api/plastic-order-query/detail?起=&止=&keyword=OQSPM` → 2 行 款号K-OQS/材料ABS/单价5/金额25+15/审核1;`/summary` → 数量8/金额40/物料类别ABS;`&审核情况=未审核` 空。
- **冒烟踩坑**:首次起后端用 `dotnet ErpApi.dll`(content root=cwd D:\WebpageERP)未加载 src\ErpApi 的 appsettings → `Erp:Jwt:Issuer/Audience` 为 null → JWT 验签 `IDX10208 audience` 401(route 已匹配=控制器在·非 404)。**改用 `--contentRoot <bin\Release\net8.0 输出目录>`(appsettings 已 CopyToOutput)** 后正常。

## 合并
分支 `feat-plastic-order-query`(2 提交)→ `--no-ff` 合并 master `26c6019`,分支已删。10 文件 +340/−1。

## 教训/记录
- **离线起后端冒烟须正确 content root**:`dotnet bin\...\ErpApi.dll` 默认 content root=当前工作目录,若非输出目录则不读 appsettings → JWT Issuer/Audience 为 null → 所有受保护接口 401(`IDX10208`)。修复:加 `--contentRoot <输出目录>` 或在输出目录内启动。
- 生产制单.款号 FK→款号总表(种子先父反序清·沿用前例)。

## 下一步
P4 余下塑胶报表(库存月报表/标签查询/各单据查询等)。**透视/汇总+扁平明细两 Tab 查询模式**(后端 Detail/Summary 双方法·前端 Tabs+日期工具栏+categories 下拉+审核情况+脱敏+导出+双击复用 drawer)已稳固可复用。
