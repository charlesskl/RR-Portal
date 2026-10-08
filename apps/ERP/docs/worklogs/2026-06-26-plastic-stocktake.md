# 塑胶盘点(盈亏±)(塑胶模块 P3d · P3 收官)· 2026-06-26

## 做了什么
塑胶 P3 仓库收官子阶段。**镜像物料 `MaterialStocktake`**(非克隆退仓/报废),但精简(无月结锁/审计,塑胶模块无月结):
- **塑胶盘点单**(头`塑胶盘点单`+明细`塑胶盘点明细单`·SPD单号):选仓 → `basis` 从 `PlasticInventoryService.ListAsync` 拉账面系统数量(带仓位号)→ 录实盘 → 盈亏=盘点−系统 → 审核后**有符号盈亏**入库存。
- **库存引擎** `PlasticInventoryService.LedgerUnion` 加第 6 支 `d.[盈亏数量]`(有符号·非`*-1`),现 **6 支**(入仓+/领料−/退料+/退仓−/报废−/盘点±),注释收尾,**P3 库存全部接通**。
- **专用前端页**(非通用单据组件——盘点列 系统/盘点/盈亏 异构):`PlasticStocktakePage`(仓库输入+带出库存+录盘点数+提交+列表审核/删除)+ `api/plasticStocktake.ts` + 路由 + 填 menuTree 占位。
- **改进**:数量列 `decimal(18,4)`(物料侧是 `real` 要 CAST;塑胶新建表免 CAST)。db/21;白名单+MenuCatalog+DI 同步。

## 执行(subagent-driven)
brainstorming(AskUserQuestion 定 前缀 SPD、范围=只录入单不做查询报表)→ spec(自审修 basis 不带颜色)→ writing-plans(5任务·全码)→ 每任务 sonnet 子代理(TDD)。Task1建表/Task2 DTO+Service/Task3 Controller+wiring+库存第6支/Task4前端(**子代理中途 API 断连·只建了 api 文件,控制器逐步直接补完页面+路由+菜单**)/Task5冒烟+终审+合并。**opus 全分支终审 = READY TO MERGE**(逐项核对:第6支用盈亏数量有符号、盈亏=盘点−系统、白名单+审核列、精简controller、basis正确、decimal免CAST、前端↔DTO一致,零需修)。

## 测试 / 验证
- 后端 `PlasticStocktakeServiceDbTests`×3(basis 拉账面、create 盈亏=−10/SPD/删除守卫、空明细/空仓库拒)+ `PlasticInventoryServiceDbTests` 追加盘点联动(入仓100审核→100、盘点系统100盘点90审核→盈亏−10→库存90)。全量 **后端 356**(352+4)/前端 54 全过、tsc 干净、vite build 成功。
- **HTTP 冒烟全绿**:重启后端 → admin 登录 → 入仓100(SR..002)→ `basis?仓库=盘点仓`=100 → 盘点录90(SPD20260626001)→ 审核 → `GET /api/plastic-inventory`=**90**,清理残留 0。

## 合并
分支 `feat-plastic-stocktake`(4提交)→ `--no-ff` 合并 master `673a1ac`,分支已删。15 文件 +473。

## 里程碑:P3 塑胶仓库全部完成
P3a 库存引擎+入仓 → P3b 领料/退料 → P3c 退仓/报废 → P3d 盘点,库存 6 支(入仓+/领料−/退料+/退仓−/报废−/盘点±)全接通,审核即过账。

## 下一步
P4 塑胶报表(塑胶库存月报表/进出库统计/订购单查询/标签查询/入仓·退仓·领料·退料·报废·盘点 查询 等 14 项)。塑胶盘点查询报表(明细/汇总带价·专用只读抽屉)在 P4 做。
