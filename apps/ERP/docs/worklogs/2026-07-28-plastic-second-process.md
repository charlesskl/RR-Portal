# 塑胶模块：二次加工（喷油/电镀/植发/植绒）规则

日期：2026-07-28

## 背景
对照旧版说明书（`docs/gap-analysis-old-erp-flows.md` 第二节）实现"二次加工"规则：需要两次加工的胶件，按 加工内容（第一次）+ 二次加工内容（第二次）推导类别后缀（BD/AF/AH），发外加工时按 加工次序/加工字母 区分两次加工、分供应商各自下塑胶加工采购单。`塑胶共用物料表.二次加工内容` 列已在 `db/40` 建好，本次补全部逻辑。

## 类别推导映射表

| 类别后缀 | 工序组合（顺序容错） | 第一次加工字母 | 第二次加工字母 |
|---|---|---|---|
| BD | 电镀 + 印喷（无论先后，"先喷油后电镀默认为是先电镀后喷油"） | 电镀 = B | 印喷 = D |
| AF | 印喷 + 植绒 | 印喷 = A | 植绒 = F |
| AH | 印喷 + 植发 | 印喷 = A | 植发 = H |

- 加工字母绑定**工序本身**而非录入次序；"喷油"视同"印喷"（包含匹配，兼容"印喷色""电镀(挂镀)"等自由文本）。
- 组合不在三种之内（如 电镀+植绒、同一工序重复、任一边为空）→ 无后缀。

## 变更清单

**DB 脚本（幂等，沿用 COL_LENGTH 判空约定）**
- `db/42_plastic_second_process.sql` — `塑胶加工采购单明细` ADD `加工次序` nvarchar(10)（第一次/第二次）、`加工字母` nvarchar(4)（B/D/A/F/H）。

**后端**
- `src/ErpApi/Features/Plastics/SecondProcessCategory.cs` — 纯静态函数：`推导后缀(加工内容, 二次加工内容)`（三种映射+顺序容错）、`加工字母(类别后缀, 加工内容)`。
- `PlasticProcessPurchaseOrder/PlasticProcessPurchaseOrderDtos.cs` — BasisRow 补 `二次加工内容`/`二次加工类别`；LineDto 与 CreateLineDto 补 `加工次序`/`加工字母`。
- `PlasticProcessPurchaseOrder/PlasticProcessPurchaseOrderService.cs` — `BasisAsync` 加选 `p.[二次加工内容]` 并在 C# 侧推导 `二次加工类别`；`CreateAsync` 明细 INSERT 带 `加工次序`/`加工字母`；`GetAsync` 明细 SELECT 带回两列。其余下游查询（明细/汇总/进度/欠数）均为显式列清单，新列可空、不影响。
- `PlasticMaterialDoc/PlasticMaterialDocDtos.cs` + `PlasticMaterialDocService.cs` — `ProcessOrderMakeListAsync`（塑胶加工订单制作）加选 `p.[二次加工内容]`；带二次加工的 BOM 行在结果中**展开为两行**：第一次（加工内容=第一次工序，加工字母如 B/A）与第二次（加工内容=二次加工内容，加工字母如 D/F/H），并带 `二次加工类别`，对应旧说明书"加工订单制作会出现两次加工类别的数据"。

**前端**
- `web/src/utils/secondProcess.ts` — `二次加工类别后缀` / `二次加工字母`，与后端同一映射。
- `web/src/pages/plastics/PlasticCommonMaterialPage.tsx` — 表单"二次加工内容"下新增只读"二次加工类别(推导)"提示（useWatch 即时推导，显示类别+两次加工字母）。
- `web/src/api/plasticProcessPurchaseOrder.ts` / `web/src/api/plasticProcessOrderMake.ts` — 类型补新字段。
- `web/src/pages/plastics/PlasticProcessPurchaseOrderPage.tsx` — 调入加工清单时，带 `二次加工类别` 的 BOM 行展开为 第一次/第二次 两条明细（数量默认 0，保存时按既有逻辑过滤数量≤0 的行，用户为当前供应商填对应行即可，**不做自动拆单**）。
- `web/src/pages/plastics/PlasticProcessPurchaseOrderLineTable.tsx` — 明细表新增"加工次序"（Select，支持列筛选）与"加工字母"两列。
- `web/src/pages/plastics/PlasticProcessOrderMakePage.tsx` — 列表新增 二次加工类别/加工次序（支持列筛选）/加工字母 三列，并纳入导出/打印列。

**测试**
- `tests/ErpApi.Tests/SecondProcessCategoryTests.cs` — 纯单元测试 30 例：三种映射、BD 顺序容错（含 喷油 同义）、包含匹配、非二次加工组合、缺边/空白、各类别加工字母、无法识别返回空。
- `tests/ErpApi.Tests/PlasticProcessPurchaseOrderServiceDbTests.cs` — 新增 `Basis_and_Create_carry_second_process_fields`：BOM 行带 喷油+植绒 → basis 带出 `二次加工类别=AF`（普通行为 null）；Create/Get 往返 `加工次序`/`加工字母`。ERP_TEST_DB 未设自动跳过（正常）。

## 验证（macOS）
- `dotnet build src/ErpApi`：通过，0 warning 0 error。
- `dotnet test tests/ErpApi.Tests --filter SecondProcessCategoryTests|PlasticProcessPurchaseOrderServiceDbTests`：通过 30 / 跳过 4（DB 用例未设 ERP_TEST_DB，正常）。
- 全量 `dotnet test tests/ErpApi.Tests`：通过 126 / 跳过 460 / 失败 2 —— 两个失败为**先存问题**且与本改动无关（与 2026-07-28-plastic-mold-and-common-material-fields 日志记录的相同）：`PricingServiceDbTests.Picks_latest_effective_price_on_or_before_date`（非 Skippable DB 用例）、`SemiFinishedShortageControllerTests.Export_returns_bom_csv...`（CSV 换行断言）。
- `cd web && npx tsc -b`：通过。

## 待办 / 交接
- 部署：在 SQL Server 执行 `db/42_plastic_second_process.sql`（测试库另需确认 `db/40` 已执行）。
- 有 ERP_TEST_DB 的环境跑一遍 `Basis_and_Create_carry_second_process_fields` 确认绿。
- BOM 选取带两字母后缀编号的物料属数据录入习惯，未改选料代码（与任务边界一致）。
