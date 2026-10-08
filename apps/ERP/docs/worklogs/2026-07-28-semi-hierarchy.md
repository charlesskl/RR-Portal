# 2026-07-28 多层级半成品 BOM 递归展开

对应缺口：`docs/gap-analysis-old-erp-flows.md` 第三节"多层级半成品规则"。旧版语义：半成品从"小"到"大"设置、最后设成品；成品 BOM 必须调入下级半成品，否则既按半成品出了物料又直接扣物料库存，造成物料重复出库。

## 半成品行的标识方案（免加列）

- `款号物料明细表` 不加列：BOM 明细行的 `物料编号` 存在于 `半成品共用物料设置.产品货号` 中，即判定为"调入的下级半成品行"。
- 理由：生产展开（算法4）与保存校验需要同一判定口径，存在性判定对历史数据零迁移；`db/` 下 44 已被并行任务（装配采购单）占用，且本方案无需脚本，故没有新增 db/45。
- 已知边界（记录在案，实践中可接受）：
  - `款号物料明细表.物料编号` 为 nvarchar(20)，`款号总表.款号` 为 nvarchar(30)，超过 20 字的款号无法作为半成品行存入（现存数据均为短款号）。
  - 若某真实物料编号与半成品款号同名，会被当作半成品行展开；属命名冲突，旧系统语义下半成品款号本来就不应再当普通物料直调。

## 递归展开口径（算法4）

- 新引擎 `src/ErpApi/Engines/Bom/SemiBomExpander.cs`（纯函数、可单测）：
  - `Expand`：从根款号沿 BOM 向下走；普通物料行产出需求行，用量沿层级逐层相乘（成品用量 × 上级半成品用量 × …）；半成品行不产出需求行，用其自身 BOM 递归替换展开——保证"成品调入了半成品"时按半成品 BOM 扣物料、不重复扣。
  - 环保护：路径栈检测 A→B→A（含自引用），就地停止该分支并在结果 `警告` 中标注路径，环外物料照常展开。
  - 层级上限 `MaxDepth = 10`，超限截断并标注警告。
  - `FindDuplicateMaterialWarnings`：保存校验用，见下。
- `ProductionService.ExpandBomAsync`（`src/ErpApi/Features/Production/ProductionService.cs`）改为：先取 `半成品共用物料设置.产品货号` 全集（OrdinalIgnoreCase）作判定集，按款号缓存 BOM 行，调用 `Expand` 后逐叶级物料行落 `生产BOM物料清单`；展开警告经 `ILogger<ProductionService>`（可选注入，测试手工 new 不受影响）输出。落库口径（库存/需订/金额/单头物料金额）不变。

## 保存警告（不强制阻止）

- `StyleService.ReplaceMaterialsAsync` 返回值改为 `Task<IReadOnlyList<string>>`：提交前在同一事务内调用 `SemiBomExpander.FindDuplicateMaterialWarnings`——本 BOM 直接列出的物料若同时是某个被调入半成品的（递归）组成物料，产出"重复扣料"警告；半成品展开中的环/超层级警告一并带回。
- `StyleController.PutMaterials` 由 204 改为 `200 { 警告: [...] }`（无警告时为空数组）；前端保存成功仍照常，有警告时 `Modal.warning` 列出，不阻止。
- 新增 `GET /api/styles/semi-options`（款号资料·打开权限）：返回已在 `半成品共用物料设置` 设置的款号（款号/款式/类别/需求用量/单位），供 BOM 弹窗调入下级半成品。

## 前端（web/src/pages/styles/BomSetupPage.tsx、web/src/api/styles.ts）

- 物料选择弹窗改为 Tabs"物料/半成品"：半成品页列出 `semi-options`，点选后行内存款号+名称（款式带出）、用量默认取半成品 `需求用量`（可手工改）、不再弹供应商选择。
- BOM 明细行尾新增"半成品"紫色 Tag（行编号命中判定集时显示）。
- 保存后读取响应 `警告` 数组，非空则 Modal 提示。
- `stylesApi` 增加 `semiOptions` 与 `SemiOption` 类型。

## 测试与验证

- 纯单元测试 `tests/ErpApi.Tests/SemiBomExpanderTests.cs`（9 个）：两层/三层展开与用量连乘、环 A→B→A、自引用、超 10 层上限、重复物料警告（直接/嵌套组成）、无重叠无警告、重复校验带出环警告——全部通过。
- DB 集成测试 `tests/ErpApi.Tests/SemiHierarchyDbTests.cs`（3 个，依赖 ERP_TEST_DB，未设置自动跳过）：保存警告有/无、生产制单递归展开（2×3×10=60、半成品行不落需求行、物料金额=300）。
- 验证结果：
  - `dotnet build src/ErpApi` 通过（0 警告 0 错误）。
  - `dotnet test`（相关过滤 SemiBomExpander|SemiHierarchy|ProductionService|Style）：通过 13、跳过 33（DB 测试无 ERP_TEST_DB）、失败 0。
  - 全量 `dotnet test`：135 通过 / 470 跳过 / 2 失败，两个失败均为与本改动无关的既有问题：`PricingServiceDbTests`（无连接串的环境性失败）、`SemiFinishedShortageControllerTests.Export`（CSV 引号断言）。
  - `cd web && npx tsc -b` 通过；`npx vitest run src/__tests__/bomSetupAssemblyPersistence.test.ts` 12/12 通过。

## 改动文件

- 新增：`src/ErpApi/Engines/Bom/SemiBomExpander.cs`、`tests/ErpApi.Tests/SemiBomExpanderTests.cs`、`tests/ErpApi.Tests/SemiHierarchyDbTests.cs`
- 修改：`src/ErpApi/Features/Production/ProductionService.cs`、`src/ErpApi/Features/Styles/StyleService.cs`、`src/ErpApi/Features/Styles/StyleDtos.cs`、`src/ErpApi/Features/Styles/StyleController.cs`、`web/src/api/styles.ts`、`web/src/pages/styles/BomSetupPage.tsx`
- 未触碰：Features/Assembly/*、web/src/pages/assembly/*、db/44（并行任务范围）；无 schema 变更。
