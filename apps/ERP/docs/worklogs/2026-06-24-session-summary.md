# 会话记录 · 2026-06-24（仓库报表 8 张查询页批量复刻）

> 本次会话：按原系统截图，逐个复刻「仓库报表」菜单组下的查询页（占位项落地），全部 TDD + E2E + 合并 master。

## 总览

| # | 功能 | 路由 | 数据源 | 合并 commit |
|---|------|------|--------|------|
| 1 | 订购单查询 | `/purchase-order-query` | 采购订单/采购明细单 | `a0e6380` |
| — | ↑工具栏对齐(月份/日期类型/导出/打印) | — | — | `4fe592c` |
| — | ↑物料分类树改顶部下拉(放供应商旁) | — | — | `113dc07` |
| 2 | 来料标签查询 | `/material-label-query` | 采购入仓单/明细 | `90f7877` |
| 3 | 采购入仓查询 | `/purchase-receipt-query` | 采购入仓单/明细(全列) | `5e6a2fd` |
| 4 | 采购退仓单查询 | `/purchase-return-query` | 采购退仓单/明细 | `605b571` |
| 5 | 领料单查询 | `/material-issue-query` | 领料单/领料明细单 | `c44529b` |
| 6 | 退料单查询 | `/material-return-query` | 退料单/退料明细单 | `51a6b4d` |
| 7 | 报废单查询 | `/material-scrap-query` | 报废单/报废明细单 | `0408c69` |

测试演进：后端 303 → **326**（+23）；前端 42 → **54**（+12）。每张页 build ✓ + puppeteer E2E 截图验证。

## 统一架构（7 张页共用的复刻模式）

**后端**（每个 Service 内扩 2 个只读端点，零新表/零迁移）：
- `XxxQueryDetailAsync`（明细单 JOIN 单头·半开日期区间 `< 止.AddDays(1)`·`ApprovalFilter(审核情况)`·物料类别/keyword 过滤）
- `XxxQuerySummaryAsync`（GROUP BY 物料编号+规格+颜色，或 +生产单号）
- Controller 加 `GET .../xxx-query/detail|summary`，无价格列的页免脱敏

**前端**（复用件，避免重复造）：
- 纯逻辑 `utils/materialLabelQuery.ts` `buildLabelQuery`（ALL/全部/空串→undefined，已测）
- 通用 `utils/tableExport.ts`（`buildCsv`/`downloadCsv`/`printTable`，buildCsv 已测）
- 双击明细 → `MaterialDocDetailDrawer`（采购入仓/领料/退料/报废 通用物料单据）或 `PurchaseOrderDrawer`（订购）
- 工具栏：上月/本月/下月(默认本月) + 日期范围 + 审核情况(全部/已审核/未审核) + 物料类别下拉 + 关键词 + 导出EXCEL + 打印
- 表格 `white-space:nowrap` + `scroll.x:max-content`（内容一行显示+横向滚动）

## 关键决策

- **省略无数据源的列**：原系统的 每箱数量/预计标签数/实需标签数（来料标签查询）、装配采购/类型（退料/报废查询）在重建库无对应字段，经确认省略。
- **字段映射**（采购入仓查询）：原系统 单号/入库单号 两列，重建库明细只有一个 单号 → 入库单号=`d.单号`(双击键)、单号=`d.条码号`。
- **汇总按生产单号**：退料/报废查询的汇总对齐原系统「按生产单号」勾选态，GROUP BY 生产单号+物料+规格+颜色，列含 生产单号/款号。订购/来料标签/入仓/退仓查询为纯物料汇总。
- **未做项**：采购退仓查询的「汇总按供应商」切换 checkbox（暂缓，可加）。

## 验证与运维

- 每张页：停后端(解锁 ErpApi.exe)→ `dotnet test` 单测过 → 重启后端 → 种 dev 演示单 → puppeteer 登录(admin/admin123)驱动页 → 截图 + 双击抽屉。
- dev DB 留有演示单：`POQDEMO`(订购) `RKDEMO`(入仓) `CTDEMO`(退仓) `LLDEMO`(领料) `TLDEMO`(退料) `BFDEMO`(报废)，均可删。
- 每张页有独立 worklog：`docs/worklogs/2026-06-24-*.md`；设计文档 `docs/superpowers/specs/2026-06-24-purchase-order-query-design.md`。

## 仓库报表组进度

✅ 库存统计表 · ✅ 库存月报表 · ✅ 订购单查询 · ✅ 来料标签查询 · ✅ 采购入仓查询 · ✅ 采购退仓查询 · ✅ 领料单查询 · ✅ 退料单查询 · ✅ 报废单查询 · ⬜ 库存盘点查询(占位，待复刻)
