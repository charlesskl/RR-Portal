# 塑胶退仓单 保真重做(全屏主从录入页)· 2026-06-26

## 做了什么
按原系统**塑胶退仓单**截图,照领料单模板把它从 P3c 的通用组件换成**专用全屏主从录入页**保真。第二张保真单据。
- **后端**(仅改 PlasticWarehouseReturn,库存方向−/STC/审核/成本脱敏全不变):头表 `塑胶退仓单` 补 3 列(出库单号/入仓单号/电脑单号),明细 `塑胶退仓明细单` 补 3 列(生产单号/款号/塑胶货号),`db/23` 幂等 ALTER ADD。DTO 头/明细/Create 带新字段;Service CreateAsync 头+明细 INSERT、GetAsync SELECT 带新列(ListAsync/DeleteAsync 不动)。**单价/金额本就有**。
- **前端**:
  - **SupplierPicker**(新·复用件):`masterApi("suppliers")` 供应商资料,🔍 回填 供应商编号+名称。
  - **PlasticReceiptPicker**(新):列已审核塑胶入仓单(`plasticDocApi("plastic-receipts").list` 前端过滤 审核==='1'),选中→`get` 拉明细带出。
  - `api/plasticWarehouseReturn.ts`(typed PWRHeader/PWRLine 含新字段)。
  - `PlasticWarehouseReturnLineTable`(明细网格·保真列序 生产单号|款号|物料编号|物料名称|颜色|塑胶货号|单位|数量|**单价|金额**|备注·物料编号🔍PlasticMaterialPicker·生产单号/款号🔍ProductionPicker·塑胶货号手录·**hidePrice 隐藏单价/金额**)。
  - `PlasticWarehouseReturnFormPage`(全屏:工具栏 新建/保存/打印 + 表头[供应商🔍/日期只读/出库单号/入仓单号🔍带出/电脑单号只读/仓库/操作员只读/备注] + **入仓带出**[选入仓单→拉明细+供应商映射进退仓·生产单号/款号/塑胶货号留空手录] + 左明细网格 + 底部 数量合计/金额合计[脱敏不显]/制单人 + 历史列表[打开/审核/反审核/删除])。`App.tsx` 换 `/plastic-warehouse-returns` 路由(其它单仍用通用组件)。

## 决策(AskUserQuestion)
供应商=建 SupplierPicker(复用 suppliers master);入仓单号=🔍选历史已审核入仓单带出明细(**零新后端**·复用 plastic-receipts list/get)。其它折中:塑胶货号手录;单价/金额保留并按权限脱敏;复制单/前单后单/表格设置/资料按钮 v1 不做。

## 执行(subagent-driven)
brainstorming(2 决策)→ spec → writing-plans(5任务·全码)→ 每任务 sonnet 子代理。Task1 DB / Task2 后端DTO+Service+往返测试 / Task3 两选择器+API+明细网格 / Task4 全屏页+路由 / Task5 冒烟+终审+合并。**opus 全分支终审 = READY TO MERGE**(10 项·重点 #1 四处列名对齐[DB/DTO/INSERT+参/SELECT]逐列核无错·库存/脱敏未动·入仓带出正确)。

## 测试 / 验证
- 后端 `PlasticWarehouseReturnFormDbTests`×1(create 带全新头/明细字段 → get 读回断言·金额=42)。全量 **后端 358**/前端 54 全过、tsc 干净。现有 `PlasticReturnScrapServiceDbTests` 仍绿(新列可空)。
- **HTTP 冒烟全绿**:入仓20(SR..004)→ 退仓6(STC20260626002·带 出库单号/入仓单号/生产单号/塑胶货号)→ GET 往返一致+金额42 → 审核 → 库存=14(20−6)→ 残留0。

## 合并
分支 `feat-plastic-wh-return-form`(5提交)→ `--no-ff` 合并 master `dfff115`,分支已删。10 文件 +418。

## 下一步
塑胶退料/报废/入仓 可照此模板继续保真重做(各自表头差异;SupplierPicker/入仓带出已成复用件);或 P4 塑胶报表。
