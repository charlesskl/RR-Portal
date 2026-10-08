# 塑胶库存引擎 + 塑胶入仓单(塑胶模块 P3a) · 2026-06-25

## 做了什么
塑胶模块 P3(仓库)第一子阶段。镜像物料侧「库存引擎 + 仓库单据」:**库存=已审核单据明细的实时 UNION 聚合**,审核即过账(翻 `审核='1'` 后该单明细立即计入库存,反审核移出)。

- **塑胶库存引擎** `PlasticInventoryService`(`src/ErpApi/Engines/Inventory/`):`LedgerUnion` 本期单支(塑胶入仓明细单 JOIN 塑胶入仓单 审核=1,+号)+ `StockOfAsync` + `ListAsync`(GROUP BY 物料编号×仓库·HAVING<>0·LEFT JOIN 塑胶物料资料带物料类别/仓位号)。**框架可逐支扩展**:P3b/c/d 在此 UNION ALL 加 领料−/退料+/退仓−/报废−/盘点±。
- **塑胶入仓单**(头 `塑胶入仓单` + 明细 `塑胶入仓明细单`,`db/18`)`PlasticReceiptService` create(SR单号·金额=数量×单价合计)/get/list/delete(已审核拒删);`PlasticReceiptController`(`api/plastic-receipts`)+ 审核/反审核(IPostingEngine)+ 单价/金额权限脱敏。`PlasticInventoryController`(`api/plastic-inventory`)库存查询。
- **塑胶专用通用单据前端**(与物料侧隔离·config 驱动·行表用 P1 PlasticMaterialPicker):`api/plasticDocs.ts` 泛型工厂 + `docs/{PlasticDocConfigs,PlasticLineTable,PlasticDocCreateDrawer,PlasticDocDetailDrawer,PlasticDocPage}.tsx`。塑胶入仓页=`<PlasticDocPage cfg={PLASTIC_DOC_CONFIGS["plastic-receipts"]}/>`。**P3b/c/d 六单全复用这套**。
- **塑胶库存统计表** `PlasticInventoryPage`(`/plastic-inventory`)。菜单 ⑧塑胶入仓单 + ⑨塑胶库存统计表 落地 + 权限。

## 过账三件套(P2 教训前置)
P2 踩过 approve 500 的坑(白名单+审核日期列),本期建表即含 `审核日期`、`PostableDocuments` 同步加 `塑胶入仓单`、库存测试用 PostingEngine 走完整审核→反审核——三者闭环,审核一次成功无 500。

## 范围决策
省略月结锁(塑胶无月结);塑胶入仓本期手工选料(无塑胶采购订单来源);库存列带 物料类别/仓位号(塑胶物料资料无货号)。

## 执行(subagent-driven)
brainstorming(探物料库存引擎+仓库单据架构·拆 P3a-d)→ spec → writing-plans(10任务)→ 每任务子代理(Task6 子代理中途 API 断连·做完改动未提交·我核验后替它提交)。Task3/4 引擎+service、Task7/8 前端通用组件 各合并 spec 审查,**opus 全分支终审=READY TO MERGE**。

## 测试 / 验证
- 后端 `PlasticInventoryServiceDbTests`×1(未审核0→审核+100→反审核0)+ `PlasticReceiptServiceDbTests`×2(金额/合计、空明细/空仓库拒)。全量 **后端 343**(340+3)/前端 54 全过、tsc 干净。
- 冒烟核心链全绿:create→SR单号、审核前库存`[]`、approve 204、**审核后库存数量7**、unapprove 204、**反审核后`[]`**、删未审核 204。
- 终审 Minor(非阻塞):数量 InputNumber precision=2(同物料侧基线)、seed 开发用。

## 合并
分支 `feat-plastic-receipt`(9提交)→ `--no-ff` 合并 master `e743406`,分支已删。

## 下一步(P3 剩余)
P3b 塑胶领料(库存−)/退料(库存+)→ P3c 退仓(−)/报废(−)→ P3d 盘点(盈亏±)。各单据建完后在 `PlasticInventoryService.LedgerUnion` 加一支,前端复用塑胶单据通用组件加 config。
