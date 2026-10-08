# 半成品盘点单 → 自由选产品版重写

日期：2026-07-21
分支：codex/semi-finished-label-order

## 背景
桌面版「半成品盘点单」截图对照：单据式（工具栏 新建/打开/资料/前单/后单/审核…），「资料」自由选产品，
明细列 配件编号/产品货号/产品名称/产品装配名称/系统数量/盘点数量/盈亏数量/备注，底部合计三项。
现有 Web 页是老的「输入仓库→带出全仓库存逐行盘」形态，与桌面版差距大——本次重写为自由选产品版，默认半成品仓。

## 关键发现（省了大量工作）
- **无需 DB 迁移**：`半成品盘点明细单`（`01_rebuild_schema.sql`）已含 货号/名称/客户/单位 列；`半成品盘点单` 已在过账白名单；库存 union 的盘点分支已消费 `盈亏数量`；`半成品盘点` 权限已存在。
- 列映射：配件编号=物料编号，产品装配名称=物料名称，产品货号=货号，产品名称=名称（与报废/出库/退库一致）。
- 资料弹窗 MZFPCU 与报废单 MZFAD **数据完全一致**，仅列标题不同（共用产品货号/共用产品名称）→ 复用同一 products 查询 + picker，加两个列名 props。
- `SS*` 命名冲突：报废块已占用 `SS*`，盘点旧类型也叫 `SS*`。重写页面时把 semi 盘点类型改前缀 `STK*`（`sales.ts` 的 `SS*` 是独立模块，不受影响）。

## 系统数量 / 仓库
- 表头无仓库字段，固定「半成品仓」。
- 系统数量 = 配件编号在半成品仓的当前库存，**按配件编号汇总各颜色**（`BasisAsync` GroupBy 物料编号 求和）。前端挂载时预载 basis→Map，选产品时带出，盘点数量默认等于系统数量。
- 盈亏=盘点−系统；审核后经 `InventorySummaryService` 盘点分支入库存。
- 已知取舍：明细不落 `颜色`（桌面版无颜色列），盈亏落在 (物料编号, NULL) 桶；单物料合计正确，但与实际颜色分桶不完全对齐——与桌面语义一致。

## 变更清单
**新增**
- `web/src/utils/semiStocktake.ts` + `web/src/__tests__/semiStocktake.test.ts`

**修改**
- `src/ErpApi/Features/Warehouse/Semi/SemiDtos.cs` — 盘点 DTO 改自由选产品形（LineInput/HeaderDto/LineRowDto + ProductQuery/ProductRow）
- `SemiStocktakeService.cs` — 重写 Create/Get（新列映射+表头合计）、新增 Update/Products/GetAdjacent、BasisAsync 按物料编号汇总
- `SemiStocktakeController.cs` — 新增 products/adjacent/update 端点，仓库空默认半成品仓
- `web/src/api/semi.ts` — 盘点类型 `SS*`→`STK*`，semiStocktakeApi 加 get/update/products/adjacent
- `web/src/pages/warehouse/SemiStocktakePage.tsx` — 重写为单据式（工具栏/表头/明细网格/合计）
- `web/src/pages/semi/SemiFinishedLabelProductPicker.tsx` — 加可选列名 props `goodsTitle`/`nameTitle`（默认产品货号/产品名称）

## 验证（Windows）
- `dotnet build WebpageERP.sln`；`dotnet test tests\ErpApi.Tests\ErpApi.Tests.csproj`
- `cd web && npm run build && npm run test`（含 semiStocktake.test.ts）
- 无 DB 迁移/种子改动，无需重新部署库。
- 冒烟：进入「半成品盘点单」→资料选产品（系统数量自动带出）→改盘点数量→保存生成 `BP+日期+序号`→审核→「半成品库存统计表」按盈亏调整。

## 待办
- 本机无 dotnet/node，未本地编译/跑测试。
- 若需颜色级盘点精度，另议（桌面版本身不分颜色）。
