# 会话工作日志 · 2026-06-15 物料盘点单建成

> 该会话进度存档(「保存聊天记录」)。结构化跨会话记忆见
> `C:\Users\DELL\.claude\projects\D--WebpageERP\memory\erp-material-stocktake-0615.md`。
> 设计 spec:`docs/superpowers/specs/2026-06-15-material-stocktake-design.md`;实现计划:`docs/superpowers/plans/2026-06-15-material-stocktake.md`。
> 同日前一项:报废单(见 `2026-06-15-scrap-doc.md`)。

## 需求

用户发来原系统**盘点单**截图(表头 日期/电脑单号/操作员/备注;明细列 物料编号/货号/物料名称/规格/材料/颜色/单位/**系统数量/盘点数量/盈亏数量**/备注;底部 系统/盘点/盈亏 合计)。隐含意图:照前两次的节奏把这张表也建出来。

## 关键判断(brainstorm 起点)

**物料盘点 ≠ 退料/报废克隆**。它有盘点专属逻辑:系统数量=账面库存(从库存引擎拉、只读)、盘点数量=实盘录入、盈亏=盘点−系统、审核后盈亏调整库存(可正可负)。所以**不是照 MaterialReturn 克隆,而是照「半成品盘点 SemiStocktake」镜像**——后者(及成品盘点)是完整范本(Controller/Service/DTO/库存UNION/前端独立页)。

## 调研结论(已核实)

- **物料盘点表早就存在**:`[盘点单]`+`[盘点明细单]`(`01_rebuild_schema.sql:2157`),含 系统数量/盘点数量/盈亏数量(**`real` 型**)/库存单价/库存金额。审核留痕列已由 `03_p0_additions.sql` 补(盘点单在清单内)。过账白名单早有 `["盘点单"]="单号"`。**零 DB 迁移。**
- 半成品/成品盘点是完美镜像源;物料库存引擎 `MaterialInventoryService.LedgerUnion` **还没**含盘点,要加一支。
- 「系统数量」由后端 `basis` 接口从库存引擎按仓库拉、前端填(同 SemiStocktake)。
- MenuCatalog 缺注册、menuTree 是占位、前端页+后端三件套全无。

## Scope 决策(3 项已确认)

1. 录入方式:**选仓 → 带出底稿**(镜像 SemiStocktake;原图无仓库但盘点必须按仓)。
2. 单号前缀:**`PD`**(成品=CP/半成品=BP;PD 无冲突)。
3. 明细**不出价格列**(库存单价/金额);颜色/货号对物料留空(物料库存按 物料编号×仓库 聚合,不分颜色)。

## 改动（13 文件，+514/−5，8 commits）

| 层 | 文件 | 改动 |
|---|---|---|
| 后端 | `Features/Materials/MaterialStocktake/MaterialStocktakeDtos.cs`(新) | Basis/Line/Create/Header/LineRow/Detail,字段 颜色→单位 |
| 后端 | `MaterialStocktakeService.cs`(新) | `DocType="盘点单"`、`Prefix="PD"`;`BasisAsync` 从 `IMaterialInventoryService.ListAsync` 取 系统数量=库存数量;`CreateAsync` 写两表 盈亏=盘点−系统;real 列传 decimal、读回 CAST decimal |
| 后端 | `MaterialStocktakeController.cs`(新) | 路由 `api/material-stocktakes`,`Menu/Table="盘点单"`、口径物料;`basis` 端点 + List/Get/Create/Delete/approve/unapprove |
| 后端 | `Program.cs` | DI 注册 MaterialStocktakeService(第49行) |
| 引擎 | `MaterialInventoryService.cs` | LedgerUnion 加盘点分支 `CAST(d.[盈亏数量] AS decimal(18,4))`(**有符号,不乘-1**);注释 `± 盘点盈亏(±)` |
| 权限 | `MenuCatalog.cs` | 加 `("物料管理","盘点单")` |
| 权限 | `db/seed_stocktake_perms.sql`(新) | admin 盘点单 9 位权限(已对两库执行) |
| 前端 | `api/materialStocktake.ts`(新) | MS* 类型 + materialStocktakeApi(basis/list/create/remove/approve/unapprove) |
| 前端 | `pages/materials/MaterialStocktakePage.tsx`(新) | 镜像 SemiStocktakePage:仓库选择器+带出底稿+盘点数量录入+盈亏实时算+提交+列表审核 |
| 前端 | `App.tsx` | import + **专用路由** `<Route path="materials/material-stocktake">`(非 `materials/:doc` 通配) |
| 前端 | `menuTree.tsx:77` | 「库存盘点单」占位补 `/materials/material-stocktake` perm「盘点单」 |
| 测试 | `MaterialStocktakeServiceDbTests.cs`(新) | basis 取系统数量 + 建单盈亏往返 + 空行/空仓拒绝(4 测) |
| 测试 | `MaterialInventoryDbTests.cs` | 加 `StockOf_applies_approved_盘点盈亏`(入100盘80→库存80);并修 Cleanup 补清盘点表+stray P3RKTX(测试隔离) |

**核心**:盘点明细的 `盈亏数量` 作为有符号台账调整入库存 UNION(盘盈+/盘亏−),账面对齐实盘。与成品/半成品盘点同哲学。

## 流程与验证

- 工作流:brainstorm(3 决策)→ spec(committed `1a57b5e`)→ plan(committed `9ce8292`)→ **subagent-driven**(7 任务,fresh 子代理/任务,每批 spec+质量审,终审独立子代理 APPROVED)。
- 子代理执行:T1+T2 DTOs/Service → T3 库存分支 → T4+T5 Controller/权限 → T6 前端;子代理自查出并修了两处测试隔离回归(T3 盘点 FK + stray 单号)。
- 后端 **302/302**(原 297 +5 新)、前端 **42/42**、`tsc+build` 净。
- 终审 APPROVED,无 Critical/Important;2 个 Minor(账面0物料不入底稿=既有行为;静态路由优先于 `:doc` 通配=无冲突)。
- 浏览器冒烟(puppeteer `tmp/shot/stocktake-smoke.cjs`):`物料盘点` 页选「物料仓」「带出库存」→ 真实账面 M001 纯棉布料 系统数量 75,底稿列 物料编号/物料名称/规格/单位/系统数量/盘点数量/盈亏 正确。

## 收尾

- 合并:`feat-material-stocktake` --no-ff → master(`423b70e`),分支已删。
- 服务:执行前停后端避锁;权限种子对 erp+erp_test 各跑;验证后起后端 5000(Release)+ 前端 5173。admin/admin123。
- 用法:物料管理 → 库存盘点单 → 填仓库 → 带出库存 → 录实盘数 → 提交 → 审核;审核后账面对齐实盘。

## 已知局限 / 仍延后

- **账面为 0 的物料不出现在底稿**(`MaterialInventoryService.ListAsync` 带 `HAVING SUM(数量)<>0`,与半成品盘点同源)——暂无法直接录"账面0实有N"盘盈。
- 盘点单查询报表(`库存盘点查询` 仍占位);桌面工具栏「更新」按钮(本期用「带出库存」一次成型)。
