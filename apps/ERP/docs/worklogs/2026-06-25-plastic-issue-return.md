# 塑胶领料(库存−)+ 塑胶退料(库存+)(塑胶模块 P3b) · 2026-06-25

## 做了什么
塑胶 P3 仓库第二子阶段。照 P3a 塑胶入仓**纵切克隆**出两个单据,接入库存 UNION:
- **塑胶领料单**(头`塑胶领料单`+明细`塑胶领料明细单`·SLL单号·头字段 领料部门/领料人):库存 **−号**。
- **塑胶退料单**(头`塑胶退料单`+明细`塑胶退料明细单`·STL单号·头字段 退料部门/退料人):库存 **+号**。
- **库存引擎** `PlasticInventoryService.LedgerUnion` 加 2 支(领料 `数量*-1`、退料 `数量`),现 3 支(入仓+/领料−/退料+)。
- **前端零新组件**:`PLASTIC_DOC_CONFIGS` 加 2 个 config(plastic-issues/plastic-returns)+ 2 路由(均 `<PlasticDocPage cfg=...>`)+ 2 菜单落地。**验证了 P3a「塑胶单据通用组件·六单复用」设计**——P3b 前端只改 config + 路由 + 菜单。
- 过账三件套(白名单 2 项 + 表含审核日期 + 库存联动测试走 PostingEngine)。

## 执行(subagent-driven)
brainstorming(轻量·确认前缀 SLL/STL)→ spec → writing-plans(8任务·领料/退料均给全码避免"同上")→ 每任务子代理。Task3 两 service 派**交叉污染专项 spec 审查**(确认领料只用领料表/退料只用退料、前缀正确),**opus 全分支终审=READY TO MERGE**(无任何需修问题)。

## 测试 / 验证
- 后端 `PlasticIssueReturnServiceDbTests`×3(领料create/get/金额/delete·SLL、退料·STL、空明细/空仓库拒)+ `PlasticInventoryServiceDbTests` 追加联动(入仓100审核→100、领料30审核→70、退料10审核→80)。全量 **后端 347**(343+4)/前端 54 全过、tsc 干净。
- 冒烟库存联动全绿:入仓100→**领料70**→**退料80**(SLL/STL 单号、审核即过账、符号正确)。

## 合并
分支 `feat-plastic-issue-return`(7提交)→ `--no-ff` 合并 master `ffdde5c`,分支已删。

## 下一步(P3 剩余)
P3c 塑胶退仓(库存−)/报废(库存−)→ P3d 塑胶盘点(盈亏±)。各单据建完后在 `LedgerUnion` 加一支,前端复用塑胶单据通用组件加 config。
