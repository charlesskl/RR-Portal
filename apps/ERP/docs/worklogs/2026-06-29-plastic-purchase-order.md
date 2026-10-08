# 塑胶采购单(塑胶采购订单·⑦塑胶采购占位落地)· 2026-06-29

## 做了什么
⑦ 塑胶采购「塑胶采购订单」落地——**全屏主从录入单据**(头+左明细+保存+审核+列表/打开/删除),按生产单号从 BOM 调入明细,右侧只读合并汇总。**塑胶物料单后第一个独立可录采购单据**。
- **新表**(`db/27`·EF 不迁移):`塑胶采购订单`(头:单号/日期/交货日期/供应商编号/供应商名称/客户名称/交货地点/编号/数量/操作员/审核/审核人/**审核日期**/备注)+ `塑胶采购订单明细`(单号/生产单号/款号/物料编号/物料名称/模具编号/用量/套数/数量/颜色/色粉号/用料名称/备注)。
- **后端** `PlasticPurchaseOrder/`(Service+Controller+Dtos·DI AddScoped):`DocType=塑胶采购订单·Prefix=SP`;`BasisAsync(生产单号)`=按生产单号从 `塑胶共用物料表 JOIN 生产制单货号 ON 货号=塑胶货号`+生产制单款号 带 BOM(模具编号=工模编号/用量/套数/颜色/色粉号/用料名称);`CreateAsync`(SP 单号·头数量=SUM 明细数量·审核'0');`ListAsync`/`GetAsync`/`DeleteAsync`(已审核抛 InvalidOperationException→Conflict)。`api/plastic-purchase-orders`(list/basis/get/post/delete/approve/unapprove)。**审核三件套**:`PostableDocuments` 加 `["塑胶采购订单"]="单号"` + 头审核日期列 + 测试 → 走通用过账引擎 `ApproveAsync` **只翻审核标志·不动库存**(无库存引擎读此单)。
- **前端** `PlasticPurchaseOrderPage`(全屏主从·镜像 PlasticReceiptFormPage):头(SupplierPicker/交货日期 DatePicker/客户名称[纯 Input·无客户选择器]/交货地点/编号/备注)+ **调入清单**(ProductionPicker→basis 填左明细·数量默认0)+ 可编辑 `PlasticPurchaseOrderLineTable`(物料🔍PlasticMaterialPicker·生产单号🔍ProductionPicker·无价格)+ **右侧只读 useMemo 合并**(按物料编号 SUM 数量合计)+ 底部数量合计 + 历史列表(openDoc/审核/反审核/删除)。

## 决策(AskUserQuestion)
①审核=纯锁定·不动库存(过账引擎翻标志·三件套);②调入清单=按生产单号从塑胶共用物料表 BOM 带入;③右侧合并=只读汇总(标签三列无源省略);④v1 范围=头+左明细+保存+审核+列表/打开/删除(镜像塑胶物料单·省略 标识贴/文本导出/前后单/合并/表格设置)。

## 执行(subagent-driven)
brainstorming(4决策·探明无现表·BOM 源=生产制单货号 JOIN 共用物料表·审核三件套前置)→ spec → plan(全表/SQL/DTO)→ 子代理 Task1 后端(380·审核三件套·PostingEngine `new(Factory(),new AuditLogger())` 同入仓测试·DI AddScoped·款号总表 FK 父行)/Task2 前端(54·全屏主从·无客户选择器用纯Input)/Task3 冒烟+终审+合并。**opus 全分支终审(首次子代理中途断连·重试)= READY TO MERGE**(8项·审核三件套 incl 审核日期+无库存·头INSERT 12=12/明细INSERT 13=13 列对齐·BasisAsync 列全在·DI/共享文件加行式additive)。

## 测试 / 验证
- 后端 `PlasticPurchaseOrderServiceDbTests`×3(Create→Get 头数量8/明细2·BasisAsync BOM 模具编号/套数/色粉号/款号·Approve 翻审核='1'+审核日期非空·Delete 已审核抛)。全量 **后端 380**(377+3)/前端 54、tsc 干净。
- **HTTP 冒烟全绿**:basis 带出 模具编号 GM-POS/套数3/色粉号 C1/款号 K-POS → POST 创建 SP20260629001 → GET 头数量8/明细2/客户客X → approve 204 审核=1。脚本内 unapprove+delete 清理。

## 合并
分支 `feat-plastic-purchase-order`(2 提交)→ `--no-ff` 合并 master `b61de22`,分支已删。14 文件 +716/−1。

## 教训/记录
- 审核三件套(PostableDocuments 白名单+审核日期列+测试)对**任何接审核的塑胶单据**都要前置;纯锁定单据(采购单)同样走过账引擎,只是无库存引擎读它。
- 塑胶单据 DI 是显式 `AddScoped`(非程序集扫描),新服务须在 Program.cs 注册。
- BOM 调入口径复用 `塑胶共用物料表 JOIN 生产制单货号 ON 货号=塑胶货号`(同 PlasticMaterialDocService.BasisAsync)。

## 下一步
⑦塑胶采购其余占位(塑胶物料设置/塑胶进度表/塑胶进度明细表/塑胶物料进出汇总);塑胶库存月报表;⑧工模表/塑胶标签单。
