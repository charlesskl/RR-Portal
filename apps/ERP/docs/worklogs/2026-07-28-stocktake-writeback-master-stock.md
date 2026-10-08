# 来料盘点差异回写主档库存（采购分析扣数联动）

日期：2026-07-28

## 背景
旧 ERP 的"盘点少数影响后续采购分析扣数"在 Web 版不成立：物料盘点单（`盘点单`/`盘点明细单`，路由 api/material-stocktakes）审核只经 PostingEngine 翻单头审核位，盈亏（盘点−系统）只进库存台账引擎（`MaterialInventoryService` 实时聚合），**不回写 `物料资料.库存` 静态主档字段**；而辅料采购分析 `AuxiliaryPurchaseAnalysisAsync` 的"库存数量"读的是 `物料资料.库存`，盘点差异因此不影响采购分析。

## 回写口径（照塑胶原料盘点先例）
先例：`PlasticRawMaterialStocktakeService.ApproveAsync` 自建事务，翻审核位 + `UPDATE 塑胶原料资料.库存 = 盘点数量`（按编号 JOIN 明细）。
本次物料盘点照抄同一模式与口径：

- **审核**：一个事务里 翻单头审核位（审核/审核人/审核日期，与 PostingEngine 原语义一致）+ `UPDATE 物料资料.库存 = CAST(盘点数量 AS decimal(18,4))`（`物料资料.库存` 为 decimal(18,4)，明细数量列为 real，显式 CAST）。即**盘点数覆盖**，不是盈亏累加。
- **反审核**：先例（塑胶原料盘点）不回滚库存（盘前值不可知）；但物料盘点明细单存有 `系统数量`（盘点入账前账面快照），按任务要求**反审核把 `物料资料.库存` 还原为明细 `系统数量`**。这是与先例的唯一差异，属有意为之。
- **容错**：明细物料编号在主档不存在时 UPDATE…JOIN 静默跳过（正常由 FK_163 保证存在）；并发靠单头 `UPDLOCK, HOLDLOCK` + 同事务回写，重复审核/反审核按状态判断幂等返回 false。
- 审核/反审核审计日志（`IAuditLogger`，行为=审核/反审核）写入同一事务，替代原 PostingEngine 内部的审计写入。

## 变更清单
**修改**
- `src/ErpApi/Features/Materials/MaterialStocktake/MaterialStocktakeService.cs` — 新增 `ApproveAsync`/`UnapproveAsync`（自建事务：翻审核位 + 回写/还原 `物料资料.库存` + 审计）；构造函数注入 `IAuditLogger`。
- `src/ErpApi/Features/Materials/MaterialStocktake/MaterialStocktakeController.cs` — approve/unapprove 端点由 `IPostingEngine` 改为调用 service（保证翻审核位与回写同事务）；移除 `IPostingEngine` 依赖。
- `tests/ErpApi.Tests/MaterialStocktakeServiceDbTests.cs` — `Svc()` 注入 NoOp 审计；种子 `物料资料.库存=100`；新增两个 DB 集成用例：
  - `Approve_writes_盘点数量_back_to_master_stock`：系统100盘80，审核后 `物料资料.库存`=80、审核位=1，重复审核幂等。
  - `Unapprove_restores_master_stock_to_系统数量`：审核后 80 → 反审核还原为 100、审核位=0，重复反审核幂等。

## 采购分析侧确认（无需改动）
`MaterialMasterService.AuxiliaryPurchaseAnalysisAsync`（`src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterService.cs:95-101`）：`库存数量 = MAX(ISNULL(m.库存,0))`，`可用库存 = 库存+在途−需领`，`订货数量 = max(需领−库存−在途, 0)`。审核回写后该查询直接读到新库存，盘亏 → 库存下降 → 订货数量上升，"盘点少数影响后续采购分析扣数"联动成立。**口径注意**：`物料资料.库存` 是物料级全局静态字段（不分仓库），盘点单按仓库盘点，回写以该单明细盘点数覆盖全局主档值——与塑胶原料盘点先例同一口径，多仓并存时以最后一次审核的盘点单为准。

## 验证（macOS）
- `dotnet build src/ErpApi`：通过，0 warning 0 error。
- `dotnet test tests/ErpApi.Tests`：通过 77 / 跳过 444 / 失败 2。两个失败与本次无关且为先存问题：
  - `PricingServiceDbTests.Picks_latest_effective_price_on_or_before_date` — 未设 ERP_TEST_DB 且该用例非 Skippable（ConnectionString 未初始化）。
  - `SemiFinishedShortageControllerTests.Export_returns_bom_csv...` — CSV 转义断言与环境换行相关，非本改动路径。
- 新增的 2 个用例及既有 DB 用例因未设置 ERP_TEST_DB 自动跳过（共 444 跳过），属正常；设好测试库后应直接通过。

## 待办
- 有 ERP_TEST_DB 的环境跑一遍 `MaterialStocktakeServiceDbTests` 两个新用例确认绿。
- 无 DB 迁移（`物料资料.库存`、`盘点单.审核人/审核日期` 均为既有列，PostingEngine 此前已在写）。
