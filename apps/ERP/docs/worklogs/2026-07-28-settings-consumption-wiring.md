# 设置数据互通：采购物料设置 / 塑胶物料设置 / 功能设置 下游消费接通（2026-07-28）

三组"设置"功能此前只存不消费，本次把数据接到下游单据与分析。未碰共享文件 `web/src/App.tsx`、`web/src/nav/menuTree.tsx`、`src/ErpApi/Program.cs`、`src/ErpApi/Features/Admin/MenuCatalog.cs`、`src/ErpApi/Engines/Posting/PostableDocuments.cs`、`src/ErpApi/Features/MasterData/Controllers.cs`。

## 0. 公共底座：lookup / public 只读端点

下游消费方（录单员）通常没有设置页菜单权限，直接复用 list 端点会 403。两组设置各加一个**任何登录用户可读**的轻量端点（运营默认值，非敏感，只读）：

- `GET api/purchase-material-settings/lookup/{物料编号}` → `{物料编号,默认供应商,最小订量,采购损耗率}`，未设置 404。
- `GET api/plastic-material-settings/lookup/{物料编号}` → `{物料编号,默认仓库,损耗率}`，未设置 404。
- `GET api/feature-settings/public` → 3 个功能设置键值（默认货币 HKD / 单价小数位 4 / 数量小数位 2，读取时补默认值不落库）。

服务层对应新增 `PurchaseMaterialSettingsService.FindAsync` / `PlasticMaterialSettingsService.FindAsync`；`SysConfigSectionController` 提取 `ReadAllAsync()` 供基类 `Get()` 与派生 `Public()` 共用（基类行为不变）。

## 1. 采购物料设置 → 采购流程

### 1a. 辅料采购单（web/src/pages/auxiliary/AuxiliaryPurchaseOrderPage.tsx）选物料预填

采购订单在本系统的"新增明细选物料"入口就是辅料采购单页的辅料资料选择器（生产域 PurchaseOrderDrawer 明细来自 BOM 基准、无自由选料；且两个页面供应商都在**单头**，明细行无行内供应商字段）。接通方式（`fillMaterialRows` 后异步 `applyPurchaseSettings`，全部失败静默跳过）：

- **默认供应商**：表头 供应商编号/名称 均空时，取第一条有设置的物料，按设置文本在供应商资料里**精确匹配（编号或名称）唯一一条**才同时回填编号+名称；匹配不到/多匹配不填——避免只填名称没编号的半填状态（保存强制要求供应商编号）。设置存的是自由文本，故必须经供应商资料解析。
- **最小订量**：行内数量为空/0 时预填为最小订量，并 `message.info` 汇总提示一次。**仅预填+提示，不做硬校验下限**（允许低于最小订量的真实下单，侵入最小）。

纯函数沉到 `web/src/utils/auxiliaryPurchaseOrder.ts`：`minOrderPrefill(数量,最小订量)`、`resolveDefaultSupplier(供应商列表,默认供应商)`。

### 1b. 辅料采购分析（MaterialMasterService.AuxiliaryPurchaseAnalysisAsync）应用采购损耗率

- **口径决策（在后端应用）**：该分析的 `订货数量 = max(需领-库存-在途, 0)` 在 SQL 聚合内计算，现在 SQL 只多带出 `MAX(采购物料设置.采购损耗率)`（DTO 上加 `[JsonIgnore]` 字段，API 返回结构不变），在 C# 侧用 `PurchaseMaterialSettingsService.ApplyLossRate(qty, rate) = qty × (1 + rate/100)` 加成——损耗率计算因此可纯单测，且列展示保持原样（不新增列，订货数量直接是含损耗的建议订量）。
- **不在 `生产BOM物料清单` 链路应用**：`需订数量`（采购分析明细查询/采购领料分析表/物料订单制作/PO 基准 basis）是算法 4 的落库产物，被 4 个查询共享，单点改动会造成页面间口径不一致；如要接，应在算法 4 写库时统一加成，属另一项改动，本日志记录为遗留事项。
- 塑胶侧核查：`PlasticRawMaterialPurchaseAnalysis`（塑胶原料采购分析）无 需订/订货 数量列，无损耗率应用点，按任务约定只接默认仓库（见 2）。

## 2. 塑胶物料设置 → 塑胶单据

塑胶入仓单（PlasticReceiptFormPage，加工入仓等 cfg 复用）与塑胶领料单（PlasticIssueFormPage）的 仓库 在**单头**、明细行无仓库列。接通：两个行表（PlasticReceiptLineTable / PlasticIssueLineTable）新增可选回调 `onMaterialPicked`，选物料回填后触发；父页 handler 查 `plastic-material-settings/lookup`，**表头仓库为空才预填默认仓库**（`utils/plasticSettings.ts` 的 `prefillDefaultWarehouse`，不覆盖已填）。设置未配置/查询失败静默跳过。损耗率无应用点（见 1b），未接。

## 3. 功能设置 → 前端消费

- **钩子**：`web/src/auth/featureSettings.ts`。`useFeatureSettings()` 首次使用经 `api/feature-settings/public` 拉一次并模块级缓存；失败回落默认值（HKD/4/2）且**不缓存失败**（下次重试），同步抛错也经 `Promise.resolve().then` 包装转为回落——页面永不因此挂掉。`parseFeatureSettings` 缺键/非法值逐项回落默认（货币仅收 HKD/RMB/USD/EUR，小数位仅 0-6 整数）。
- **① 货币默认值**（接了 2 个表单）：
  - 物料资料新增（MaterialMasterPage.openCreate）：隐藏字段 货币 默认 `toDocCurrency(默认货币)`（HKD→HK$，对齐单据沿用写法）。
  - 款号资料报价行（BomSetupPage）：`newQuoteRow` 增加 defaultCurrency 参数；选合作方时 加工厂=默认货币、供应商=供应商资料货币 ?? 默认货币。
- **② 小数位**：项目里**没有集中的数字格式化函数**——各页面本地 `toFixed(2/4)` 散布（grep 确认 utils/ 下无公共封装）。按任务约定不扫荡存量；在钩子里提供了 `formatPrice/formatQty(v, settings)` 作为扩散入口：**新增页面/新增公共格式化一律走这两个助手**，存量页面后续按需替换本地 toFixed 时接入即可。

## 测试

- 后端新增 `tests/ErpApi.Tests/PurchaseLossRateTests.cs`（5 个纯单测）：损耗率 null/0 不加成、2.5% → ×1.025、0 数量保持 0、小数精确。
- 前端新增 `web/src/__tests__/settingsConsumption.test.ts`（12 个）：minOrderPrefill / resolveDefaultSupplier / prefillDefaultWarehouse / parseFeatureSettings / toDocCurrency / formatPrice·formatQty。
- 修复一处测试暴露的缺陷：`clampDigits` 对缺键 `Number(null)===0` 误判为合法值，已改为空值先回落默认。

## 验证

- `dotnet build src/ErpApi`：0 警告 0 错误。
- `dotnet test tests/ErpApi.Tests`：**205 通过 / 507 跳过 / 0 失败**（ERP_TEST_DB 未设，DB 集成测试自动跳过属正常，含本次相关的 PurchaseMaterialSettings/PlasticMaterialSettings DbTests）。
- `cd web && npx tsc -b`：通过。
- `cd web && npx vitest run`：**271 全过**（59 文件，含 bomSetupAssemblyPersistence 等受影响页面既有测试）。

## 改动文件

后端：
- `src/ErpApi/Features/Materials/PurchaseSettings/PurchaseMaterialSettingsDtos.cs`（+PurchaseMaterialSettingLookup）
- `src/ErpApi/Features/Materials/PurchaseSettings/PurchaseMaterialSettingsService.cs`（+FindAsync、+ApplyLossRate）
- `src/ErpApi/Features/Materials/PurchaseSettings/PurchaseMaterialSettingsController.cs`（+lookup 端点）
- `src/ErpApi/Features/Plastics/MaterialSettings/PlasticMaterialSettingsDtos.cs`（+PlasticMaterialSettingLookup）
- `src/ErpApi/Features/Plastics/MaterialSettings/PlasticMaterialSettingsService.cs`（+FindAsync）
- `src/ErpApi/Features/Plastics/MaterialSettings/PlasticMaterialSettingsController.cs`（+lookup 端点）
- `src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterService.cs`（辅料采购分析 LEFT JOIN 采购物料设置 + C# 侧损耗率加成）
- `src/ErpApi/Features/Materials/MaterialMaster/MaterialMasterDtos.cs`（AuxiliaryPurchaseAnalysisRow + [JsonIgnore] 采购损耗率）
- `src/ErpApi/Features/SystemConfig/BasicSettingsControllers.cs`（基类提取 ReadAllAsync；FeatureSettingsController + public 端点）

前端：
- `web/src/api/purchaseMaterialSettings.ts`、`web/src/api/plasticMaterialSettings.ts`（+lookup）
- `web/src/auth/featureSettings.ts`（新，钩子+解析+格式化助手）
- `web/src/utils/auxiliaryPurchaseOrder.ts`（+minOrderPrefill/resolveDefaultSupplier）
- `web/src/utils/plasticSettings.ts`（新，prefillDefaultWarehouse）
- `web/src/pages/auxiliary/AuxiliaryPurchaseOrderPage.tsx`（选料预填默认供应商/最小订量）
- `web/src/pages/plastics/PlasticReceiptLineTable.tsx`、`PlasticIssueLineTable.tsx`（+onMaterialPicked）
- `web/src/pages/plastics/PlasticReceiptFormPage.tsx`、`PlasticIssueFormPage.tsx`（预填默认仓库）
- `web/src/pages/materials/MaterialMasterPage.tsx`（新增物料货币默认值）
- `web/src/pages/styles/BomSetupPage.tsx`（报价行货币默认值）

测试：
- `tests/ErpApi.Tests/PurchaseLossRateTests.cs`（新）
- `web/src/__tests__/settingsConsumption.test.ts`（新）

## 遗留事项

- `生产BOM物料清单.需订数量` 链路（采购分析明细查询/采购领料分析表/物料订单制作/PO 基准）未应用采购损耗率，需在算法 4 写库处统一加成，避免多页面口径不一致。
- 小数位（系统.单价小数位/数量小数位）存量页面本地 toFixed 未扫荡；扩散方式：新代码统一用 `auth/featureSettings.ts` 的 `formatPrice/formatQty`。
- 无需主会话补的注册：三组控制器均为 ASP.NET 自动发现，服务此前已在 Program.cs 注册（今天建设置时已加），前端无新路由/菜单。
