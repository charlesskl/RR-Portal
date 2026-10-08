# 塑胶退仓(库存−)+ 塑胶报废(库存−)(塑胶模块 P3c)· 2026-06-26

## 做了什么
塑胶 P3 仓库第三子阶段。照 P3a 入仓 / P3b 领料退料**纵切克隆**两张出库单据,接入库存 UNION 两支均 `数量*-1`:
- **塑胶退仓单**(头`塑胶退仓单`+明细`塑胶退仓明细单`·STC单号·头字段 供应商编号/供应商名称·语义=退回供应商出仓):库存 **−号**。镜像物料模块「采购退仓」,头与塑胶入仓对称。
- **塑胶报废单**(头`塑胶报废单`+明细`塑胶报废明细单`·SBF单号·头字段 报废部门/报废人):库存 **−号**。
- **库存引擎** `PlasticInventoryService.LedgerUnion` 加 2 支(退仓/报废 各 `数量*-1`),现 **5 支**(入仓+/领料−/退料+/退仓−/报废−),注释剩「后续加 盘点±」。
- **前端零新组件**:`PLASTIC_DOC_CONFIGS` 加 2 个 config(plastic-warehouse-returns/plastic-scraps)+ `App.tsx` 2 路由 + `menuTree` 填 2 个占位菜单路由。再次验证 P3a「塑胶单据通用组件·六单复用」设计。
- 过账三件套(白名单 2 项 + 建表即含审核日期 + 库存联动测试走 PostingEngine),DI 注册 2 service,MenuCatalog 2 菜单项,db/20 建表 + seed 权限。

## 执行(subagent-driven)
brainstorming(轻量·AskUserQuestion 确认 退仓=供应商头、前缀 STC/SBF)→ spec → writing-plans(6任务·退仓/报废均给全码避免「同上」)→ 每任务 sonnet 子代理(TDD:DTO→失败测试→service→通过)。Task1建表/Task2退仓/Task3报废/Task4两Controller+wiring+库存联动/Task5前端/Task6冒烟+终审+合并。**opus 全分支终审 = READY TO MERGE**(逐项核对无交叉污染、5支符号、白名单+审核列、masking/删除守卫、前端config↔DTO一致,无任何需修问题)。

## 测试 / 验证
- 后端 `PlasticReturnScrapServiceDbTests`×4(退仓create/get/金额28/delete·STC、报废·SBF金额30、空明细/空仓库拒)+ `PlasticInventoryServiceDbTests` 追加联动(入仓100审核→100、退仓20审核→80、报废10审核→70)。全量 **后端 352**(347+5)/前端 54 全过、tsc 干净、vite build 成功。
- **HTTP 冒烟全绿**:重启后端(新代码)→ admin 登录 → 入仓100(SR..001)→ 退仓20(STC..001)→ 报废10(SBF..001)→ `GET /api/plastic-inventory` 库存=**70**,清理后残留 0。端到端确认 STC/SBF 路由、审核即过账、中文 DTO 往返、两 − 支聚合。

## 合并
分支 `feat-plastic-return-scrap`(6提交)→ `--no-ff` 合并 master `4d91f4c`,分支已删。17 文件 +611。

## 下一步(P3 剩余)
P3d 塑胶盘点(盈亏±)→ 选仓拉账面底稿、录实盘、盈亏=盘点−系统、审核后盈亏(有符号)入 `LedgerUnion` 第 6 支。镜像物料盘点 `MaterialStocktake`(专用盘点页,非通用单据组件)。
