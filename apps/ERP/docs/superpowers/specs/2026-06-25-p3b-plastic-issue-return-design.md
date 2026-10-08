# 塑胶模块 · P3b 塑胶领料(库存−)+ 塑胶退料(库存+) · 设计

> 日期:2026-06-25
> 范围:塑胶 P3 仓库阶段第二子阶段 —— 塑胶领料单(出·库存−)+ 塑胶退料单(退回·库存+),克隆 P3a 塑胶入仓,接入库存 UNION。
> 上游:P3a 塑胶库存引擎+塑胶入仓单 `e743406` 已完成。基础设施(库存引擎框架、塑胶单据通用前端)已就绪,本期为轻量克隆。

## 1. 背景与复用

P3a 已建库存引擎(实时 UNION·审核即过账)+ 塑胶入仓单 + 塑胶专用 config 驱动单据前端。P3b 照塑胶入仓纵切克隆出**塑胶领料单**(库存 −)和**塑胶退料单**(库存 +),并在 `PlasticInventoryService.LedgerUnion` 各加一支。前端**零新组件**——加 2 个 config + 路由 + 菜单即可。

## 2. 目标 / 非目标

**目标(P3b):**
- 塑胶领料单(头 `塑胶领料单` + 明细 `塑胶领料明细单`)CRUD + 审核;库存 −。
- 塑胶退料单(头 `塑胶退料单` + 明细 `塑胶退料明细单`)CRUD + 审核;库存 +。
- `PlasticInventoryService.LedgerUnion` 加 领料(−)/退料(+) 两支。
- 前端 2 个 config(plastic-issues / plastic-returns)+ 路由 + 菜单落地。
- 过账三件套(白名单 + 审核日期列 + 回归测试)。

**非目标:**
- 明细行的 生产单号/款号 列(原系统 usageCols;库存不依赖,本期沿用 P3a 的 PlasticLineTable 物料/数量/单价口径,以后需要再加)。
- 退仓/报废/盘点(P3c/d)。

## 3. 数据模型(4 新表)

`db/19_plastic_issue_return.sql`:`塑胶领料单`+`塑胶领料明细单`、`塑胶退料单`+`塑胶退料明细单`。头/明细列照 `塑胶入仓单`/`塑胶入仓明细单`(db/18),差异仅头表的部门/人字段:

- `塑胶领料单`(头):单号/日期/**领料部门**/**领料人**/仓库/数量/金额/操作员/审核/审核人/**审核日期**/备注。
- `塑胶退料单`(头):单号/日期/**退料部门**/**退料人**/仓库/数量/金额/操作员/审核/审核人/**审核日期**/备注。
- 两明细表 = `塑胶入仓明细单` 同列(单号/日期/仓库/物料编号/物料名称/规格/颜色/仓位号/单位/数量/单价/金额/备注)。

## 4. 后端

新 `src/ErpApi/Features/Plastics/PlasticIssue/`、`.../PlasticReturn/`,各照 `PlasticReceipt/*` 克隆:
- DTOs(Header/Line/Detail/CreateLine/Create;头字段换 领料部门/领料人 或 退料部门/退料人)。
- Service:`PlasticIssueService`(DocType="塑胶领料单" Prefix="**SLL**")、`PlasticReturnService`(DocType="塑胶退料单" Prefix="**STL**");create/get/list/delete 同入仓(金额=数量×单价合计)。
- Controller(`api/plastic-issues`、`api/plastic-returns`):list/get/create/delete + approve/unapprove;单价/金额脱敏。
- `PostableDocuments` 加 `["塑胶领料单"]="单号"`、`["塑胶退料单"]="单号"`;`Program.cs` 注册两 service。
- 权限:`MenuCatalog` 加 `("塑胶仓储","塑胶领料单")`、`("塑胶仓储","塑胶退料单")`;`db/seed_plastic_issue_return_perms.sql`。

**库存引擎扩展**(`src/ErpApi/Engines/Inventory/PlasticInventoryService.cs`)—— `LedgerUnion` 追加两支:
```sql
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]*-1
    FROM [塑胶领料明细单] d JOIN [塑胶领料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
UNION ALL
SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[数量]
    FROM [塑胶退料明细单] d JOIN [塑胶退料单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
```

## 5. 前端(零新组件)

- `web/src/pages/plastics/docs/PlasticDocConfigs.ts` 加两 config:
  - `"plastic-issues"`:menu 塑胶领料单,title 塑胶领料,headerFields 领料部门/领料人/仓库(必填)/备注,listExtra 领料人/仓库。
  - `"plastic-returns"`:menu 塑胶退料单,title 塑胶退料,headerFields 退料部门/退料人/仓库(必填)/备注,listExtra 退料人/仓库。
- `App.tsx` 加路由 `/plastic-issues`、`/plastic-returns`(均 `<PlasticDocPage cfg=.../>`)。
- `menuTree.tsx` ⑧塑胶仓库 `M("塑胶领料单","/plastic-issues","塑胶领料单")`、`M("塑胶退料单","/plastic-returns","塑胶退料单")`。
- 搜索框 placeholder「单号/供应商」对领料/退料语义不符但无害(通用页固定文案),沿用。

## 6. 测试

- 后端 `PlasticIssueServiceDbTests`/`PlasticReturnServiceDbTests`:create(SLL/STL 单号·金额)/get/delete + 空明细/空仓库拒。
- 库存引擎扩展测试(在 `PlasticInventoryServiceDbTests` 追加):入仓100 审核 → 领料30 审核后库存=70;退料10 审核后=80。**审核走 PostingEngine(回归白名单+审核日期)**。
- 全量后端/前端 tsc/vitest 全过。冒烟:领料审核后库存减、退料审核后库存加。

## 7. 验收标准

1. `db/19` 后 4 表存在。
2. `/plastic-issues`、`/plastic-returns` 列表/新建(选塑胶物料·录数量)/保存(SLL/STL单号)/审核/反审核/删除。
3. 入仓100审核后库存100;领料30审核 → 库存70;退料10审核 → 库存80;各反审核还原。
4. 无「·单价」权限者 单价/金额 `***`。
5. 菜单 塑胶领料单/塑胶退料单 可进入。

## 8. 风险 / 决策

- **签名**:领料 −、退料 +(对齐物料侧 MaterialInventoryService)。
- **前缀** SLL(领料)/STL(退料),用户确认。
- **过账三件套** P2/P3a 教训:建表即含审核日期、白名单同步、库存测试走 PostingEngine。
- **零新前端组件**:复用 P3a 塑胶单据通用组件,仅加 config(验证了 P3a「六单复用」设计)。
- 明细沿用 PlasticLineTable(带单价);生产单号/款号 usage 列延后。
