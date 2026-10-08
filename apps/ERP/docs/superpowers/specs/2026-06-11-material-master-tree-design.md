# 物料资料（左类别树 + 右物料表）设计

**日期**：2026-06-11
**模块**：仓库管理 → 物料资料（菜单已存在，当前指向通用主数据 CRUD `/master/物料资料`）

## 目标

把「物料资料」做成原系统布局：**左侧物料分类树 + 右侧物料网格**。点左侧某分类 → 右侧列出该类物料；支持新增 / 编辑 / 删除。**替换**现有通用 CRUD 页（菜单「物料资料」改指新页）。

## 现状与复用

- `物料资料` 是 `MasterEntity`，已有通用 CRUD：`MaterialController` at `/api/master/materials`（List `page/size/keyword` + Get + Create + Update + Delete，含权限门禁与价格脱敏 via `[PriceField]`）。本设计**复用其增删改/Get**，仅新增"分类树 + 按类别过滤列表"两个只读端点（通用 List 的 keyword 是对所有字符串列模糊 OR，无法精确按类别过滤）。
- `物料资料` 表列（`db/01_rebuild_schema.sql`）：物料类别, 条码号, 物料编号, 物料名称, 批号, 规格, 颜色, 单位, 客户, 单价, 销售价, 库存, 最低库存, 最高库存, 备注, 供应商编号, 供应商名称, 款号 …
- `物料资料` 实体（`src/ErpApi/Data/Entities/物料资料.cs`）：`单价`/`销售价` 标了 `[PriceField]`（脱敏字段，已被生成）。

## 数据与口径

- **左树**：节点来源 = `SELECT DISTINCT [物料类别] FROM [物料资料] WHERE [物料类别] 非空`，外加一个「全部」根节点。
  - 选「全部」→ 右侧列全部物料；选某分类 → 右侧 `WHERE [物料类别] = @类别`。
  - 分类本身仍在现有「物料类别」主数据页维护；本页左树只反映物料上实际出现的分类（保证点了都有数）。
- **右网格**：分页列表，列 物料编号 / 物料名称 / 物料类别 / 规格 / 颜色 / 单位 / 单价 / 销售价 / 库存 / 最低库存 / 最高库存 / 供应商编号 / 备注。`单价`/`销售价` 在无「单价」权限时后端置 null。

## 后端

新增聚焦只读控制器 `MaterialMasterController`（`src/ErpApi/Features/Materials/MaterialMaster/`），权限菜单「物料资料」，复用 `ISqlConnectionFactory` + `IPermissionService`：

- `GET /api/material-master/categories` → `IReadOnlyList<MaterialCategoryNode>`：
  ```sql
  SELECT [物料类别] AS 类别, COUNT(*) AS 数量
  FROM [物料资料]
  WHERE [物料类别] IS NOT NULL AND LTRIM(RTRIM([物料类别])) <> ''
  GROUP BY [物料类别]
  ORDER BY [物料类别];
  ```
  权限 `打开`。DTO `MaterialCategoryNode { string? 类别; int 数量; }`。
- `GET /api/material-master?类别=&keyword=&page=&size=` → `PagedResult<MaterialRow>`：
  ```sql
  -- 计数 + 分页两段（QueryMultiple）；@类别 为空=不过滤，否则精确等于；@kw 模糊匹配 物料编号/物料名称/规格/颜色/供应商名称
  WHERE (@类别 IS NULL OR [物料类别] = @类别)
    AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [规格] LIKE @kw OR [颜色] LIKE @kw OR [供应商名称] LIKE @kw)
  ORDER BY [物料编号] OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;
  ```
  权限 `打开`；返回后若无「单价」权限，把每行 `单价`/`销售价` 置 null（后端落实）。DTO `MaterialRow`（含 ID + 上述展示列）。
- **增删改/取单条复用** `/api/master/materials`（`MaterialController`，已有审计+权限+脱敏）。新增物料时前端默认带上当前选中分类到 `物料类别` 字段。

## 前端

- API `web/src/api/materialMaster.ts`：`materialMasterApi.categories()`、`materialMasterApi.list({类别,keyword,page,size})`；写操作用现有 `masterApi("materials")`（create/update/remove/get）。
- 新页 `web/src/pages/materials/MaterialMasterPage.tsx`：
  - 左 `Tree`（「全部」根 + 各分类节点，节点带数量徽标），选中切换右侧过滤。
  - 右 `Table`（上述列 + 分页 + 关键字搜索框），价格列在无权限时显示 `***`。
  - 工具条：新增 / 编辑 / 删除（受「物料资料」保存/删除 权限控制）；新增/编辑用弹窗表单（复用物料字段，价格字段无权限不显示）；新增默认填当前分类。
  - 无「物料资料·打开」权限时显示无权提示。
- 菜单/路由：`menuTree.tsx` 把 `M("物料资料", "/master/物料资料", "物料资料")` 改为 `M("物料资料", "/material-master", "物料资料")`；`App.tsx` 加 `/material-master` 路由。旧通用页配置保留在 `configs.ts`（其它入口/无害），仅菜单改指。

## 测试

- 后端 DbTest `MaterialMasterDbTests`：种 2 个分类各若干物料 + 1 个无类别物料，断言：categories 返回 2 个分类及正确数量（无类别不计）；list 按 `类别` 精确过滤、按 keyword 过滤、分页 total 正确；无价格权限路径由控制器脱敏（在 API 测试覆盖）。
- 后端 API 测试 `MaterialMasterApiTests`：无「打开」权限→403；categories/list 正常返回；无「单价」权限时 list 行的 单价/销售价 为 null，有权限可见。
- 前端：构建通过（页面以 UI 为主，无新增纯函数单测）。

## 取舍与边界

1. 替换现有通用页入口（菜单改指）；不保留旧 `/master/物料资料` 菜单项。`configs.ts` 中 `物料资料` 配置不删（避免连带影响），仅不再被菜单引用。
2. 写操作（增删改）复用成熟的 `/api/master/materials`，本模块只新增"树 + 按类别过滤列表"两个读端点，避免重复 CRUD。
3. 左树取 distinct `物料资料.物料类别`（点了都有数），分类维护仍在「物料类别」页。
4. 价格脱敏沿用 `[PriceField]` 机制：通用 CRUD 自动脱敏；新读端点在控制器内显式置 null。
5. 只做单层分类树（物料类别是平铺字符串），不做多级。
