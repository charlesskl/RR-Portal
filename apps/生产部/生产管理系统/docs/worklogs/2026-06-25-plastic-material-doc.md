# 塑胶采购分析 + 塑胶物料单(塑胶模块 P2) · 2026-06-25

## 做了什么
塑胶模块 P2 —— **用户最初展示的两屏**。塑胶采购分析(列生产单·上月/本月/下月)→ 点行开**塑胶物料单抽屉**:按生产单货号从 P1 塑胶共用物料表带出塑胶用料(`塑胶共用物料表 JOIN 生产制单货号 ON 货号=塑胶货号`,LEFT JOIN 塑胶物料资料补仓位号)→ 编辑订购数量(预填=用量,金额=订购数量×加工单价)→ 保存成单(电脑单号 前缀 **SL**)→ 审核/反审核/删除。镜像物料侧 采购物料分析→采购物料单(PurchaseOrderService/PurchaseOrderDrawer)。

- **数据模型**:`塑胶物料单`(头)+ `塑胶物料明细单`(明细)两表(`db/17`,Dapper 手写非泛型 CRUD)。
- **后端** `PlasticMaterialDocService`:`OrdersAsync`(列生产单·日期+关键词)、`BasisAsync`(按货号 JOIN 带出)、`CreateAsync`(SL单号·头明细·金额/合计)、`GetAsync`、`DeleteAsync`(已审核拒删)。`PlasticMaterialDocController`(`api/plastic-material-docs`):orders/basis/create/get/delete + approve/unapprove(通用 `IPostingEngine`),加工单价/金额按单价权限脱敏。
- **前端**:`PlasticMaterialAnalysisPage`(`/plastic-material-analysis`)+ `PlasticMaterialDocDrawer`(新建带出/保存 + 查看/审核/反审核/删除),菜单 ⑦塑胶采购占位落地。
- **权限**:`MenuCatalog` 加 `("塑胶采购","塑胶物料单")` + `db/seed_plastic_doc_perms.sql`。

## 范围决策(YAGNI)
- 省略 库存/出仓 列(依赖塑胶库存 P3,无源);金额=订购数量×加工单价;前缀 SL;审核仅翻头表位(不触发库存级联,塑胶库存 P3 才接)。

## 冒烟抓到的 bug + 修复(关键)
冒烟 approve 返回 **HTTP 500**:`InvalidOperationException: 表 [塑胶物料单] 不在可过账白名单内`。两处遗漏(探查说"通用引擎直接处理"但漏了):
1. **`PostableDocuments` 白名单** 未含 塑胶物料单 → 加 `["塑胶物料单"]="单号"`。
2. PostingEngine UPDATE 写 **`[审核日期]`** 列,而建表漏该列 → 加列(建表脚本 inline + 幂等 `ALTER` 兜底已建表)。
修复后冒烟全绿:create→SL单号、approve 204、删已审核 409、unapprove 204、删未审核 204、get 金额=50。**并补 approve/反审核 回归测试** 锁住此修复(原测试套件未覆盖过账,只被冒烟抓到)。

## 执行(subagent-driven)
brainstorming(确认塑胶物料单=可保存可审核单据·basis来源)→ spec → writing-plans(9任务)→ 每任务子代理,Task3/4 服务、Task7/8 前端 各做合并 spec 审查,**opus 全分支终审=READY TO MERGE**(确认过账修复完整)。

## 测试 / 验证
- 后端 `PlasticMaterialDocDbTests`×5(orders日期过滤、basis按货号JOIN带仓位号、create金额=订购数量×加工单价+合计/get/delete、空明细拒、**审核/反审核回归**)。全量 **后端 340**(P1后335 → P2加5)/前端 54 全过、tsc 干净、build ✓。
- 终审 3 个 Minor(非阻塞,留 P3/后续):打印未做;header 客户死字段(basis 未 select 客户);——已记录。

## 合并
分支 `feat-plastic-material-doc`(9提交+测试)→ `--no-ff` 合并 master `80bdb97`,分支已删。

## 下一步
P3 塑胶仓库单据(入仓/退仓/领料/退料/报废/盘点)+ 库存引擎接塑胶 → 接通后可补塑胶物料单的 库存/出仓 列。
