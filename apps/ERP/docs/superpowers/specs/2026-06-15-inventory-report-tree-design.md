# 库存统计表 加物料分类树 + 货号/材料列 设计文档

> 日期：2026-06-15　主题：增强现有「库存统计表」(物料库存查询页 `/material-inventory`)，对齐原系统——左侧加物料分类树筛选，表格加 货号、材料(物料类别) 两列。

## 目标

把现有物料库存查询页 `MaterialInventoryPage` 从「平铺表 + 仓库/关键字搜索」升级为原系统「库存统计表」样式：**左侧物料分类树**（按物料类别筛选）+ 表格补 **货号 / 材料(物料类别)** 两列。货号与物料类别从 `物料资料` 主数据带出。

## 背景与现状

- 现有页 `web/src/pages/materials/MaterialInventoryPage.tsx`：仓库输入 + 关键字搜索 + 平铺表（物料编号/物料名称/规格/单位/仓库/库存数量）。菜单 `menuTree.tsx:81 M("库存统计表","/material-inventory","物料库存")`、权限菜单 `物料库存`。
- 后端 `MaterialInventoryController`（`GET /api/material-inventory?仓库=&keyword=`）→ `IMaterialInventoryService.ListAsync(仓库, keyword)`。`ListAsync` 用 `LedgerUnion` 按 `物料编号×仓库` 聚合，返回 `MaterialStockRow`（物料编号/物料名称/规格/单位/仓库/库存数量），**不含 货号/物料类别**。
- 数据可得（已核实 `db/01_rebuild_schema.sql` `物料资料` 表）：`物料资料` 有 `货号 nvarchar(40)`、`物料类别 nvarchar(20)`、`物料编号`。
- 可复用：`materialMasterApi.categories()`（`GET /material-master/categories` → `MaterialCategoryNode[]`）给分类树供数据；`MaterialMasterPage.tsx` 的 `treeData`/`onSelect`/选中类别筛选 模式。

## 分层设计

### 1. 后端

**`MaterialStockRow.cs`**：加两个可空字段
```csharp
public string? 货号 { get; set; }
public string? 物料类别 { get; set; }
```

**`MaterialInventoryService.cs`**：
- `IMaterialInventoryService.ListAsync` 签名加可空 `物料类别` 参数：`ListAsync(string? 仓库, string? keyword, string? 物料类别 = null)`。
- `ListAsync` SQL 在现有按 `物料编号×仓库` 聚合的结果上 **LEFT JOIN 物料资料去重子查询** 带出 货号/物料类别，并按 `物料类别` 过滤：
  ```sql
  SELECT t.[物料编号], MAX(t.[物料名称]) AS 物料名称, MAX(t.[规格]) AS 规格, MAX(t.[单位]) AS 单位,
         t.[仓库], SUM(t.[数量]) AS 库存数量,
         MAX(m.[货号]) AS 货号, MAX(m.[物料类别]) AS 物料类别
  FROM ({LedgerUnion}) t
  LEFT JOIN (SELECT [物料编号], MAX([货号]) AS 货号, MAX([物料类别]) AS 物料类别
             FROM [物料资料] GROUP BY [物料编号]) m ON m.[物料编号]=t.[物料编号]
  WHERE (@wh IS NULL OR t.[仓库]=@wh)
    AND (@kw IS NULL OR t.[物料编号] LIKE @kw OR t.[物料名称] LIKE @kw OR t.[规格] LIKE @kw)
    AND (@cat IS NULL OR m.[物料类别]=@cat)
  GROUP BY t.[物料编号], t.[仓库]
  HAVING SUM(t.[数量]) <> 0
  ORDER BY t.[物料编号], t.[仓库]
  ```
  > 物料资料子查询先按 物料编号 GROUP BY + MAX 去重，避免一物料编号多行导致聚合行翻倍。`@cat` 为空时不过滤。`StockOfAsync`（单物料库存）不变——只 `ListAsync` 改。

**`MaterialInventoryController.cs`**：`List` 加 `物料类别` 查询参数，透传：
```csharp
public async Task<IActionResult> List(string? 仓库 = null, string? keyword = null, [FromQuery(Name="物料类别")] string? 物料类别 = null)
{ ... var rows = await inventory.ListAsync(仓库, keyword, 物料类别); return Ok(rows); }
```

### 2. 前端

**`web/src/api/materialInventory.ts`**：
- `MaterialStockRow` 类型加 `货号?: string; 物料类别?: string`。
- `list()` 加 `物料类别?` 参数：`list(仓库?, keyword?, 物料类别?)` → `GET /material-inventory` params `{仓库, keyword, 物料类别}`。

**`web/src/pages/materials/MaterialInventoryPage.tsx`**：
- 引入 `materialMasterApi.categories()` 取分类，构造 `treeData`（根节点「全部」+ 各物料类别叶子，模式照 `MaterialMasterPage.tsx`）。
- 左侧放 `<Tree>`（selectedKeys=选中类别；onSelect 设选中类别，空=全部），右侧表格。布局用 AntD `Row/Col`（如左 6 列树 + 右 18 列表）或 flex，与物料资料页风格一致。
- 表格列顺序：物料编号 / **货号** / 物料名称 / 规格 / **材料(=物料类别)** / 单位 / 仓库 / 库存数量。
- `load` 把选中类别作为 `物料类别` 参数传 `list`；选中类别变化时重查。仓库输入、关键字搜索 保留。

### 3. 测试

- **后端 `MaterialInventoryDbTests`** 新增：① ListAsync 返回行带出 货号/物料类别（Seed 物料资料带 货号/物料类别 + 入仓造库存，断言行的 货号/物料类别 非空且正确）；② 传 `物料类别` 过滤只返回该类别物料（造两个不同类别物料，断言筛选）。
- **前端**：UI 为主，不强制单测（沿用项目前端纯逻辑测试约定，本次无新纯函数）。

## 数据流

进页 → 取分类树（`/material-master/categories`）渲染左树 → 选类别/输仓库/搜关键字 → `GET /material-inventory?仓库=&keyword=&物料类别=` → `ListAsync`（LedgerUnion 聚合 + JOIN 物料资料带 货号/物料类别 + 按类别过滤）→ 表格展示（含货号/材料列）。

## 错误处理

沿用现状：加载失败 `message.error`；分类树取数失败静默（不阻塞主表）。仅「打开」权限（库存查询无价格，无成本保密）。

## 不做（YAGNI / 延后）

- 颜色列（库存按 物料编号×仓库 聚合不分颜色，用户未要）。
- 库存单价/金额、最低/最高库存预警列。
- 分类树的多级层级（物料类别是平铺单层，照物料资料页现状即可）。
- 原系统工具栏（更新/打印/表格设置 等桌面特性）。
