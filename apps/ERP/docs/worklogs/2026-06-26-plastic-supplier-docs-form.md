# 塑胶退料/报废/入仓 保真重做 + 退仓抽通用供应商单据页 · 2026-06-26

## 做了什么
用户确认 退料/报废/入仓 三单与塑胶退仓单同款表头/明细。把退仓表单**抽成 config 驱动的通用供应商单据页**,四单(退仓/退料/报废/入仓)共用;三单后端补列。
- **统一界面**:表头=供应商🔍/日期只读/出库单号/入仓单号🔍带出/电脑单号只读/仓库/操作员只读/备注;明细=生产单号|款号|物料编号|物料名称|颜色|塑胶货号|单位|数量|单价|金额|备注(单价/金额按权限脱敏);入仓单号🔍 四单都带出历史已审核入仓单明细。
- **后端**(三 service 各补·镜像退仓·库存方向/前缀/审核/脱敏不变):`db/24` 幂等 ALTER ADD —— 塑胶退料单/塑胶报废单 头补 供应商编号/供应商名称/出库单号/入仓单号/电脑单号(**旧 退料部门/退料人、报废部门/报废人 保留不动弃用**),塑胶入仓单 头补 出库单号/入仓单号/电脑单号(供应商已有),三明细表各补 生产单号/款号/塑胶货号。DTO 头/明细/Create 带新字段(退料/报废 保留旧 部门/人 字段向后兼容);Service INSERT/SELECT 带新列。
- **前端**(通用化重构):`api/plasticSupplierDoc.ts`(工厂 `plasticSupplierDocApi(resource)` + PSDHeader/PSDLine)、`PlasticSupplierDocLineTable.tsx`(= 退仓网格改名)、`PlasticSupplierDocFormPage.tsx`(= 退仓页参数化 cfg={resource,menu,title})、`PlasticSupplierDocConfigs.ts`(四单 config)。`App.tsx` 四路由(退仓/退料/报废/入仓)都用通用页;删旧退仓专用三文件(FormPage/LineTable/api)。**领料单(plastic-issues)不动**(另一套头)。`PlasticDocPage`/`PLASTIC_DOC_CONFIGS` 已无路由引用(docs/ 下文件成死代码,留待清理)。

## 决策(AskUserQuestion)
DRY=抽通用供应商单据页(退仓回调到通用件,一处维护);入仓单本身=四单都保留入仓带出🔍;退料/报废 旧 部门/人 列=DB 保留弃用改用供应商头。

## 执行(subagent-driven)
brainstorming(2决策)→ spec → writing-plans(6任务·全码)→ 每任务 sonnet 子代理。Task1 DB / Task2 退料后端 / Task3 报废后端 / Task4 入仓后端+全量回归 / Task5 前端抽通用件四单共用+删旧 / Task6 冒烟四单+终审+合并。三后端按 PlasticReturn/PlasticScrap/PlasticReceipt 顺序串行(非并行·git/build 安全)。**opus 全分支终审 = READY TO MERGE**(8项·三单各四处列名对齐逐列核无错·旧 部门/人 列保留回归绿·库存/前缀/脱敏未动·通用页参数化正确·领料未被波及·删旧无悬空引用)。

## 测试 / 验证
- 后端 `PlasticReturnSupplierFormDbTests`/`PlasticScrapSupplierFormDbTests`/`PlasticReceiptSupplierFormDbTests` 各×1(create 带供应商头+新明细字段 → get 读回断言)。全量 **后端 361**(358+3)/前端 54 全过、tsc 干净。现有 `PlasticIssueReturnServiceDbTests`/`PlasticReturnScrapServiceDbTests`(用旧 部门/人 创建)仍绿。
- **HTTP 冒烟全绿(四单)**:入仓30(SR..005)→ 退仓5(STC..003)→ 退料4(STL..001)→ 报废3(SBF..002),各带供应商头+出库/入仓/电脑+生产单号/塑胶货号 → GET 往返一致 → 审核 → 库存 **30→25→29→26**(入仓+/退仓−/退料+/报废− 方向正确)→ 残留0。

## 合并
分支 `feat-plastic-supplier-docs-form`(6提交)→ `--no-ff` 合并 master `93d7e69`,分支已删。16 文件 +312/−96。

## 里程碑:塑胶五张录入单全部保真重做
领料单(独立头·PlasticIssueFormPage) + 退仓/退料/报废/入仓(供应商头·通用 PlasticSupplierDocFormPage 四单共用)。

## 下一步
P4 塑胶报表(库存月报/进出库统计/各单据查询等);或清理 docs/ 下死代码(PlasticDocPage 等)。
