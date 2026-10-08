# 塑胶领料单 保真重做(全屏主从录入页)· 设计 · 2026-06-26

## 目标

把**塑胶领料单**从 P3b 的「通用列表 + 抽屉」(PlasticDocPage)换成**专用全屏主从录入页**,按原系统截图保真:顶部工具栏 + 丰富表头 + 左明细网格 + 右只读「库存参考」面板 + 底部合计。后端单据语义/库存方向(领料 −)不变,只**补表头/明细列**。做完跑通后,退料/退仓/报废/入仓可照此模板克隆(本次不做)。

仅塑胶领料单一张单,单一 spec。其它五张塑胶单据保持现有通用组件不变。

## 范围与决策(已确认)

- 范围:**仅塑胶领料单**。
- 表头无源字段(胶箱数/纸箱/钙塑箱/卡板数/收件人/电脑单号/领料备注):**加 DB 列真落库**。
- 右侧「库存数量/发料数量」面板 + 装配采购清单/调入清单按钮:**简化为只读「库存参考」面板**(查现成 `api/plastic-inventory`),复杂带出逻辑 v1 不做。
- 前端:**全屏专用页替换 `/plastic-issues` 路由**(非加抽屉)。

## 架构

后端仍是「塑胶领料单 + 塑胶领料明细单」两层、Dapper 事务、SR 风格 SLL 单号、审核走 PostingEngine、库存 UNION 领料支(−)——**全不变**,只在头/明细两表加列、DTO 与 Service 的 INSERT/SELECT 带上新列。右侧库存参考**零新后端端点**,前端直接调 `api/plastic-inventory`。前端新建一个专用页,替换该路由;其它塑胶单据组件不受影响。

## ① 数据库

`db/22_plastic_issue_form.sql`(幂等 `IF COL_LENGTH(...) IS NULL ALTER TABLE ... ADD`,ERP_DB + ERP_TEST_DB 都执行):

- `塑胶领料单` 加列:`胶箱数 int NULL`、`纸箱数 int NULL`、`钙塑箱数 int NULL`、`卡板数 int NULL`、`收件人 nvarchar(30) NULL`、`电脑单号 nvarchar(30) NULL`、`领料备注 nvarchar(40) NULL`。
  - (部门=已有 `领料部门`;操作员/审核/审核人/审核日期/备注/仓库 已有。)
- `塑胶领料明细单` 加列:`生产单号 nvarchar(30) NULL`、`款号 nvarchar(40) NULL`、`模具编号 nvarchar(30) NULL`、`色粉号 nvarchar(30) NULL`、`用料名称 nvarchar(40) NULL`、`装配采购 nvarchar(10) NULL`。
  - (物料编号/物料名称/规格/颜色/仓位号/单位/数量/单价/金额/备注 已有。)

## ② 后端(仅改 PlasticIssue)

- `PlasticIssueDtos.cs`:
  - `PlasticIssueCreateDto` 头加:胶箱数/纸箱数/钙塑箱数/卡板数(`int?`)、收件人/电脑单号/领料备注(`string?`)。
  - `PlasticIssueCreateLineDto` 加:生产单号/款号/模具编号/色粉号/用料名称/装配采购(`string?`)。
  - `PlasticIssueHeaderDto` 与 `PlasticIssueLineDto` 同步加这些读出字段。
- `PlasticIssueService.cs`:`CreateAsync` 头/明细 INSERT 带新列;`GetAsync` 头/明细 SELECT 带新列。`ListAsync`/`DeleteAsync` 不变。库存方向不变(领料明细 `数量*-1`,P3b 已有,LedgerUnion 不动)。
- Controller 不变(路由 `api/plastic-issues`,菜单 塑胶领料单)。
- 右侧库存参考:**无新端点**,前端调 `GET api/plastic-inventory?keyword=<物料编号>`(已存在,塑胶库存菜单权限 admin 已有)。

## ③ 前端(专用全屏页)

新 `web/src/pages/plastics/PlasticIssueFormPage.tsx`,替换 `App.tsx` 中 `/plastic-issues` 的元素(原 `<PlasticDocPage cfg=...>` 换成 `<PlasticIssueFormPage/>`);`PLASTIC_DOC_CONFIGS["plastic-issues"]` 可保留(其它五单仍用),领料的 config 不再被页面引用。

布局(保真截图):
- **工具栏**:新建(清空表单)/保存(create)/删除(删当前打开的未审核单)/审核/反审核/打印(开窗 window.print)/关闭。前单/后单/表格设置/调入清单/装配采购清单 暂不做(灰显或不画)。
- **表头**(Form,保真字段与只读态):
  - 领料部门(输入/下拉)、日期(只读=今天)、审核日期(只读)、领料人(只读+🔍 复用 `EmployeePicker`,必填)、操作员(只读=当前用户)、电脑单号(只读,空)、备注(输入)。
  - 胶箱数/纸箱数/钙塑箱数/卡板数(`InputNumber`)、收件人(只读+🔍 EmployeePicker)、领料备注(下拉,选项「生产领料」等,默认「生产领料」)、☑打印合并表格(本地状态,仅影响打印)。
- **左明细网格**(可编辑,列序保真):装配采购 | 生产单号 | 款号 | 物料编号 | 模具编号 | 物料名称 | 颜色 | 色粉号 | 用料名称 | 单位 | 数量 | (删行)。
  - 物料编号🔍 复用 `PlasticMaterialPicker`(回填 物料名称/颜色/仓位号/单位)。
  - 生产单号/款号🔍 复用 `ProductionPicker`(回填生产单号+款号)。
  - 模具编号/色粉号/用料名称:可手录(后续可从塑胶共用物料表带出,v1 手录)。
  - 装配采购:文本/勾选小列(存字符串,如「是」/空)。
  - 数量:`InputNumber`。
- **右「库存参考」面板**(只读 Table):序号 | 物料编号 | 物料名称 | 库存数量。来源:对左侧已录入且有物料编号的行去重,逐个查 `api/plastic-inventory?keyword=<物料编号>` 取该物料在所选仓库的库存数量(或汇总),实时显示。
- **底部**:数量合计(左侧数量实时 SUM)、重量合计(0.0 占位,无逐行重量源)、制单人(=当前用户)。
- **历史单列表**:页面下方放一个简列表(复用 `plastic-issues` list 接口)显示已建领料单,支持打开(回填表单为只读查看)/审核/反审核/删除——满足工具栏「打开」与单据生命周期。

数据流:新建→录表头+明细→保存(POST create)→刷新列表;打开历史→GET detail 回填(只读);审核/反审核/删除走现有端点。库存参考随明细物料变化拉取。

## ④ 测试

- 后端 `PlasticIssueReturnServiceDbTests`(或新增)补:create 带新头字段(胶箱数=2/收件人/领料备注)+ 新明细字段(生产单号/装配采购/模具编号)→ GetAsync 读回一致;金额/SLL 前缀回归不变。
- 全量 `dotnet test` 绿(后端 356 起,不减)。
- 前端 `npm --prefix web run test`(54 不减)+ `build` tsc 干净。
- 冒烟:重启后端 → 登录 → 用新页建一张领料单(带胶箱数/生产单号/装配采购)→ 审核 → 库存减 → 打开该单读回字段一致 → 库存参考显示正确。

## ⑤ 不做(YAGNI)

- 其它五张塑胶单据的保真重做(克隆留后续)。
- 装配采购清单 / 调入清单 的复杂带出。
- 前单/后单、表格设置、逐行重量计算。
- 价格/单价列(原系统领料界面不显单价;库存方向与金额后端照旧)。
- 模具编号/色粉号/用料名称 的自动带出(v1 手录)。

## 执行

writing-plans → subagent-driven 逐任务 → opus 全分支终审 → 分支 `feat-plastic-issue-form` `--no-ff` 合并 master,删分支 → worklog + 更新 MEMORY.md。
