# 2026-07-28 接通各单据页 前单/后单/打印 按钮

## 背景

多个单据/报表页面的「前单」「后单」「打印」按钮长期处于 disabled（或弹"打印开发中"）。
参照已可用的 `web/src/pages/warehouse/SemiStocktakePage.tsx` 模式接通，不改后端、不改共享文件
（App.tsx / menuTree.tsx / Program.cs / MenuCatalog.cs / PostableDocuments.cs 均未动）。

## 前单/后单口径

- 新增 `web/src/utils/docNav.ts`：`adjacentDocNo(nos, current, next)` 在单号升序序列
  （`localeCompare` + `numeric: true`，数字段按数值比较）中取当前单的相邻单号。
  前单 = 更早录入的单（较小单号），后单 = 更晚录入的单（较大单号），与后端已有 adjacent
  端点口径一致（参照 `SemiReceiptService.GetAdjacentAsync` 的 ID 比较方向）。
- 各页面 `move(next)` 用该页已有的 list 端点拉列表（size=1000），前端定位相邻单后调用
  页面已有的 `openDoc` 载入；到边界或找不到时 `message.info("已经是第一/最后一张单据")`。
- 过滤口径与各页「打开」列表一致：辅料盘点单按 `仓库=辅料仓` 过滤，辅料采购订单排除
  `生产单号` 非空的行；其余页面列表端点本身已是单类单据，无需额外过滤。
- 按钮禁用条件：`!openedNo || saving`（复用页面已有 busy 状态）。

## 打印接通方式

| 页面 | 方式 |
|---|---|
| AuxiliaryStocktakePage / AuxiliaryPurchaseOrderPage / AssemblyPurchaseOrderPage | `window.print()`，按 `can(perms, MENU, "打印")` 门控（同 SemiStocktakePage 先例） |
| AuxiliaryReceiptPage / AuxiliaryPurchaseReturnPage / AuxiliaryIssuePage / AuxiliaryReturnPage | 项目已有的 `printMaterialDoc`（utils/printDoc.ts，MaterialDocDetailDrawer 先例）：点击时重新 `get(openedNo)` 拉明细，新窗口渲染单头+明细表打印；`hidePrice(perms, API_MENU)` 尊重单价保密；按 `!openedNo || !canPrint` 禁用 |
| AuxiliaryPurchaseProgressPage / AuxiliaryIssueProgressPage | `printTable`（utils/tableExport.ts，塑胶/装配进度表先例），新增 `exportCols` 与网格列对齐，打印 `displayRows` |
| AuxiliaryReportLayout（共享报表布局） | `window.print()`（布局层拿不到结构化行数据，无法用 printTable） |
| BomSetupPage / ProductionNoticePage | `window.print()`，替换原"打印功能开发中/打印开发中"提示 |

## 改动文件

- `web/src/utils/docNav.ts`（新增）
- `web/src/__tests__/docNav.test.ts`（新增，6 个用例）
- `web/src/pages/auxiliary/AuxiliaryStocktakePage.tsx`
- `web/src/pages/auxiliary/AuxiliaryPurchaseOrderPage.tsx`
- `web/src/pages/auxiliary/AuxiliaryPurchaseReturnPage.tsx`
- `web/src/pages/auxiliary/AuxiliaryReceiptPage.tsx`
- `web/src/pages/auxiliary/AuxiliaryIssuePage.tsx`
- `web/src/pages/auxiliary/AuxiliaryReturnPage.tsx`
- `web/src/pages/assembly/AssemblyPurchaseOrderPage.tsx`（保留另一任务启用的保存/审核改动，未触碰）
- `web/src/pages/auxiliary/AuxiliaryReportLayout.tsx`
- `web/src/pages/auxiliary/AuxiliaryPurchaseProgressPage.tsx`
- `web/src/pages/auxiliary/AuxiliaryIssueProgressPage.tsx`
- `web/src/pages/styles/BomSetupPage.tsx`
- `web/src/pages/production/ProductionNoticePage.tsx`

后端零改动。

## 验证

- `cd web && npx tsc -b` 通过。
- `npx vitest run`：docNav.test.ts 6/6 通过；auxiliary/assembly/bom 相关 9 个测试文件
  38/38 通过（中途一次批量运行出现 bomSetupAssemblyPersistence 抖动失败，单跑及复跑均通过，
  为既有测试间干扰，与本次改动无关）。
- `npx eslint` 改动文件：仅剩 13 个既有错误（各页 useEffect 内 setState、
  AuxiliaryReportLayout/BomSetupPage 的常量导出 fast-refresh 限制），均不在本次改动行上。

## 遗留说明

- `window.print()` 会带上应用框架（与 SemiStocktakePage 现状一致）；后续如需单据套打，
  可统一迁到 printMaterialDoc/printTable 风格。
- 打印权限为按用户授权（userbqrpower.打印），未授权用户按钮保持禁用，属预期。
