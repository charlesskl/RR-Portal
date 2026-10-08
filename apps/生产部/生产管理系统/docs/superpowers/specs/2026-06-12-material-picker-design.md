# 物料明细行 · 物料选择器 设计

**日期**：2026-06-12
**模块**：物料单据录入行（领料/退料/采购入仓/采购退仓 共享 `MaterialLineTable`）

## 目标

把共享物料明细行的"物料下拉框"（当前加载前 500 条）换成**点击弹出的可搜索物料选择器**：点录入行的物料单元格 → 弹出可搜索的物料资料列表（物料编号/名称/规格/材料/颜色/单位 + 只查有库存 + 分页）→ 选一行带回填该录入行。解决 500 条上限，贴原系统「产品资料查询」。四种物料单据一起受益。

## 现状与复用

- 共享 `MaterialLineTable`（`web/src/pages/materials/MaterialLineTable.tsx`）：物料列是 antd `Select`（`materials` prop 提供选项，由 `MaterialDocCreateDrawer` 预加载 `masterApi("materials").list(1,500)`，超 500 条仅前 500）。选中后 `pickMaterial` 用 `materials` 列表回填 名称/规格/单位/单价。`DocLine` 已含 物料编号/物料名称/物料类别/规格/颜色/单位/数量/单价/金额/订单单号/生产单号/款号。
- 已有可复用端点 `GET /api/material-master?类别=&keyword=&page=&size=`（`MaterialMasterController`/`MaterialMasterService`，返回 `PagedResult<MaterialRow>`，`MaterialRow` 含 ID/物料类别/物料编号/物料名称/规格/颜色/单位/单价/销售价/库存/最低库存/最高库存/供应商编号/供应商名称/备注；单价/销售价 按「物料资料·单价」权限脱敏）。前端 `materialMasterApi.list(类别?, keyword?, page=1, size=50)`（`web/src/api/materialMaster.ts`）。
- `物料资料` 表有 `库存` 列。

## 后端（小改，无新端点）

- `MaterialMasterService.ListAsync` 增加参数 `bool onlyStock`（默认 false）。在 COUNT 与分页两段的 WHERE 都加：`AND (@onlyStock = 0 OR ISNULL([库存],0) > 0)`。参数对象加 `onlyStock = onlyStock ? 1 : 0`。
- `MaterialMasterController.List` 方法签名加 `bool onlyStock = false`，传入 `svc.ListAsync(类别, keyword, page, size, onlyStock)`。价格脱敏不变（无「单价」权限仍把每行 单价/销售价 置 null）。
- 兼容：现有 `MaterialMasterPage` 调用 `ListAsync(类别, keyword, page, size)`——`onlyStock` 作为新尾参，默认 false，不影响（C# 需在调用处补默认值或保持可选参；服务方法把 onlyStock 放最后并给默认值 `= false`）。

## 前端

- `api/materialMaster.ts`：`list` 加可选 `onlyStock?: boolean` 尾参 → `GET /material-master` 的 `params` 带 `onlyStock`。`MaterialMasterPage` 调用不变（不传 onlyStock）。
- 新组件 `web/src/pages/materials/MaterialPicker.tsx`（Modal）：
  - props：`open`、`hidePriceCols?: boolean`、`onPick(row: MaterialRow)`、`onClose()`。
  - 内容：搜索 `Input.Search`（占位"物料编号/名称/规格/颜色/供应商"）+ `☑只查有库存`（默认不勾）+ 表格（列 物料编号/物料名称/规格/材料(物料类别)/颜色/单位/库存；价格列 单价 在 `!hidePriceCols` 时显示）+ 分页（pageSize 50）。
  - 数据：`materialMasterApi.list(undefined, keyword, page, 50, onlyStock)`；打开/搜索/翻页/切换只查有库存 时查询。点行 → `onPick(row)` 后 `onClose()`。
- `MaterialLineTable.tsx`：
  - 删除 `materials` prop、`pickMaterial`、物料 `Select` 列。
  - 物料列改为**可点单元格**：显示 `物料编号 物料名称`（空则「选物料」链接）；点击 `setPickFor(i)` 打开 `MaterialPicker`。
  - `fillFromMaterial(row)`：回填该行 `物料编号/物料名称/物料类别/规格/颜色/单位`，`单价 = hidePriceCols ? null : (row.单价 ?? null)`。
  - 渲染 `<MaterialPicker open={matPickFor!==null} hidePriceCols={hidePriceCols} onPick={fillFromMaterial} onClose={()=>setMatPickFor(null)} />`。
  - 既有「款号选订单」列（`enableOrderPicker`）保持不变，与物料选择器并存。
- `MaterialDocCreateDrawer.tsx`：删除"预加载 `masterApi("materials").list(1,500)` → `materials` 状态"逻辑；`MaterialLineTable` 调用去掉 `materials={...}`（其余 props 不变）。

## 测试

- 后端 `MaterialMasterDbTests` 扩一个用例：种 有库存物料(库存>0) + 无库存物料(库存=0)，`ListAsync(onlyStock:true)` 只返回有库存的；`onlyStock:false` 两者都在。
- 后端 API：现有 `MaterialMasterApiTests` 不破坏（新增尾参默认 false）；可加 `?onlyStock=true` 断言（可选）。
- 前端：`npm run build` 通过；选择器以 UI 为主，无新增纯函数单测。

## 取舍与边界

1. **换掉下拉框**：物料只能从选择器选（解决 500 上限）。
2. 共享改进：四种物料单据共用；`MaterialLineTable` 去 `materials` 依赖、`MaterialDocCreateDrawer` 去预加载。
3. 复用 `/api/material-master`，只加 `onlyStock` 一个参数，不新增端点。
4. **单选**：点物料填当前录入行，不做多选批量加行。
5. 价格脱敏沿用：选择器/回填的 单价 在无「物料资料·单价」权限时为空（与现状一致）。
6. 选择器按 `/api/material-master` 的物料资料全集搜索（不限分类）；材料列= 物料类别。
