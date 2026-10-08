# 塑胶领料单 保真重做(全屏主从录入页)· 2026-06-26

## 做了什么
按用户提供的原系统**塑胶领料单**截图,把它从 P3b 的「通用列表+抽屉」换成**专用全屏主从录入页**保真重做:
- **后端**(仅改 PlasticIssue,库存方向/单号 SLL/审核全不变):头表 `塑胶领料单` 补 7 列(胶箱数/纸箱数/钙塑箱数/卡板数/收件人/电脑单号/领料备注),明细 `塑胶领料明细单` 补 6 列(装配采购/生产单号/款号/模具编号/色粉号/用料名称),`db/22` 幂等 ALTER ADD。DTO 头/明细/Create 全带新字段;Service CreateAsync 头+明细 INSERT、GetAsync SELECT 带新列(ListAsync/DeleteAsync 不动)。
- **前端**:`api/plasticIssue.ts`(typed PIHeader/PILine,含新字段)+ `PlasticIssueLineTable`(可编辑明细网格·保真列序 装配采购|生产单号|款号|物料编号|模具编号|物料名称|颜色|色粉号|用料名称|单位|数量·物料编号🔍→PlasticMaterialPicker 回填名称/规格/颜色/仓位号/单位·生产单号/款号🔍→ProductionPicker 回填)+ `PlasticIssueFormPage`(全屏:工具栏 新建/保存/打印/打印合并表格 + 两行保真表头[部门/日期只读/领料人🔍/操作员只读/仓库/电脑单号只读/胶箱数·纸箱·钙塑箱·卡板数/收件人🔍/领料备注下拉/备注] + 左明细网格 + **右只读「库存参考」面板**[查现成 `api/plastic-inventory` 按仓库映射物料→库存] + 底部 数量合计/重量合计 0.0占位/制单人 + 历史单列表[打开查看·审核/反审核/删除按权限])。`App.tsx` 把 `/plastic-issues` 路由从通用 PlasticDocPage 换成 PlasticIssueFormPage(其它五单仍用通用组件)。

## 决策(AskUserQuestion)
范围=仅塑胶领料单;无源表头字段=加 DB 列真落库;右侧面板=简化为只读库存参考(查 `api/plastic-inventory`,装配采购清单/调入清单复杂带出 v1 不做)。其它折中:模具编号/色粉号/用料名称 v1 手录;重量合计 0.0 占位;前单后单/表格设置不做;价格列不显(原系统领料界面也无)。

## 执行(subagent-driven)
brainstorming(AskUserQuestion 三决策)→ spec(自审修 basis 无颜色等)→ writing-plans(5任务·全码)→ 每任务 sonnet 子代理。Task1 DB / Task2 后端DTO+Service+往返测试 / Task3 前端API+明细网格 / Task4 全屏页+路由 / Task5 冒烟+终审+合并。**opus 全分支终审 = READY TO MERGE**(8 项核对,重点 #1 四处列名对齐[DB ADD/DTO/INSERT列+参/SELECT]逐列核无 纸箱vs纸箱数 类错,库存未动,回归安全,前端↔DTO 中文字段一致,路由替换无残留)。

## 测试 / 验证
- 后端 `PlasticIssueFormDbTests`×1(create 带全部新头/明细字段 → GetAsync 读回逐一断言)。全量 **后端 357**/前端 54 全过、tsc 干净、build 成功。现有 `PlasticIssueReturnServiceDbTests` 仍绿(新列可空)。
- **HTTP 冒烟全绿**:入仓20(SR..003)→ 领料8(SLL20260626001·带 胶箱数=2/收件人/电脑单号/装配采购/生产单号/模具编号)→ GET 字段往返一致 → 审核 → 库存=12(20−8)→ 清理残留0。

## 合并
分支 `feat-plastic-issue-form`(5提交)→ `--no-ff` 合并 master `dbbd1e9`,分支已删。8 文件 +388。

## 下一步
塑胶退料/退仓/报废/入仓 可照此模板克隆保真重做(各自表头差异);或继续 P4 塑胶报表。本次只做了领料单一张(用户范围选择)。
