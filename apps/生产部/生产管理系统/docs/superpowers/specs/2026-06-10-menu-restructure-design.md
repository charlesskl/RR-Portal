# 前端菜单按原系统全量重组 设计

> 兴信B ERP 净室重建 · 导航重组 · 2026-06-10

**目标**：把前端左侧导航**按原系统(bmain.exe)菜单树全量复刻**(用户截图提供)。已建功能接到对应菜单项;未建项=占位页「功能开发中」(可见可点不报错);原树未列出但已建的(销售/工资/考勤/应付)作额外组附底。纯前端,后端不动。

**已确认策略(用户"全部重组")**：
- 复刻全部 ~18 顶层组 + 全部叶子(含 B/C 线塑胶/装配/辅料/原料、各报表查询)。
- 已建功能 → 接现有路由,按 9 位权限(`can(perm,"打开")`)控可见。
- 未建 → 占位页,登录即可见(导航地图)。
- 数据驱动:菜单树集中在 `web/src/nav/menuTree.tsx`(已建),MainLayout 据此渲染。

---

## 1. 菜单树配置（`web/src/nav/menuTree.tsx`，已建）

`MENU_TREE: MenuGroup[]`；`MenuLeaf {label, path?, perm?}`：
- `path` 有值 = 已建路由(如 `/master/客户资料`、`/sales-shipments`);`perm` = 9位权限菜单名(隐藏控制)。
- 无 `path` = 占位。
- 覆盖原树 18 组(基本设置/生产管理/生产报表/采购管理/仓库管理/仓库报表/塑胶采购·仓库·报表/发外加工/原料仓库·报表/外发装配/辅料仓库·报表/半成品仓库·报表/成品仓库) + 额外组(销售/应付/工资/考勤)。

## 2. 占位页（`web/src/pages/PlaceholderPage.tsx`）

读路由参数 `:name`(菜单名),居中卡片显示「【name】 功能开发中」+ 副文「该模块尚未在本系统实现」。AntD `Result`/`Empty` 即可。

## 3. MainLayout 改造（数据驱动）

- 用 `MENU_TREE` 生成 `items`：每组 → 子菜单;每叶 →
  - 有 `perm` 且 `!can(perms, perm, "打开")` → **隐藏**(跳过);
  - 有 `path` → `key=path`;
  - 无 `path`(占位) → `key=/_todo/<encodeURIComponent(label)>`。
- 组内全部叶子被隐藏时,该组不显示(`children.length` 判断)。
- 图标:组级给个默认图标(按 key/label 粗分),叶级可省或统一小图标(避免逐个维护)。
- `onClick` → `nav(key)`。
- **Header 标题**:由 pathname 反查 MENU_TREE 叶子 label(找不到则 `/_todo/:name` 解 name,再不行回退"兴信B ERP")——替换原来超长 if-else 链。

## 4. 路由（`web/src/App.tsx`）

- 加 `<Route path="_todo/:name" element={<PlaceholderPage />} />`(在 MainLayout 子路由下)。
- 现有路由全部保留不动。

## 5. 测试 / 验证

- `npm run build` 通过;现有前端测试不减。
- 冒烟:admin 登录,左栏出现全部原系统菜单组;点已建项进对应页;点占位项进「功能开发中」不报错;受限用户(无某权限)对应已建项隐藏。

## 6. 范围外

- 不补建占位功能(仅导航骨架)。
- 占位项不做权限门控(导航地图性质)。
- 后端/MenuCatalog 不动(占位项无 9 位权限概念)。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 菜单名重复 key(系统用户/用户权限同指 /admin/accounts) | key 用 path,重复 path 的两叶 → 第二个 key 追加后缀(如 `/admin/accounts#用户权限`)避免 React key 冲突;nav 时取 `#` 前真实 path。 |
| 占位项过多(~110) | 仅导航,点击进统一占位页;不影响已建功能。 |
| 已建项隐藏一致性 | 沿用 `can(perm,"打开")`(admin 全有→全见);占位项始终显示。 |
| Header 标题 | 反查菜单树 label,占位用 name 参数。 |
