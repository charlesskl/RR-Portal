# 塑胶库存统计表 保真增强 · 设计 · 2026-06-26

## 目标

把 P3a 建的简版 `PlasticInventoryPage`(`/plastic-inventory`,菜单「塑胶库存」)增强为对齐原系统的**塑胶库存统计表**:左物料分类树 + 全列(补 工模编号/塑胶货号/颜色/单价/金额)+ 单价/金额按权限脱敏 + 导出EXCEL/打印 + 底部汇总。镜像物料侧 `MaterialInventoryPage` 的「左树 + 物料类别过滤 + 关键词」模式。这是 P4 塑胶报表的第一张。

## 范围与决策(已确认)

- 列:**全加**——在现有基础列上补 工模编号/塑胶货号/颜色/单价/金额;单价/金额按「塑胶库存·单价」权限脱敏。
- 工具/过滤:**导出EXCEL+打印(复用 `utils/tableExport`)+ 左分类树 + 关键词 + 仓库 + 底部汇总**。类型下拉/精确查询/按款号查询/零库存显隐切换 **v1 省略**。
- 增强**现有 `/plastic-inventory` 页**(不新建路由/页)。

## 架构

库存口径不变(`PlasticInventoryService` 的 6 支 UNION 实时聚合,仅审核='1',按 物料编号×仓库)。本次只在 `ListAsync` 的外层 SELECT 上**多 LEFT JOIN 带出展示列**(颜色/单价 来自 `塑胶物料资料`;工模编号/塑胶货号 来自 `塑胶共用物料表`),并加 `物料类别` 过滤参;金额 = 库存数量 × 单价(展示用,不影响库存)。Controller 加单价/金额脱敏。前端重写页面为「左树 + 全列 + 导出/打印 + 汇总」,复用现成 `categories` 端点与 `tableExport` 工具。

## ① 后端

**`src/ErpApi/Engines/Inventory/PlasticInventoryService.cs`**
- `PlasticStockRow` 加字段:`颜色`、`工模编号`、`塑胶货号`、`单价`(decimal?)、`金额`(decimal?)。
- `ListAsync` 签名加 `string? 物料类别 = null`。外层查询:
  - 现有已 `LEFT JOIN (SELECT 物料编号, MAX(物料类别), MAX(仓位号) FROM 塑胶物料资料 GROUP BY 物料编号) m`;扩展该子查询同时 `MAX(颜色) AS 颜色, MAX(单价) AS 单价`。
  - 新增 `LEFT JOIN (SELECT 物料编号, MAX(工模编号) AS 工模编号, MAX(塑胶货号) AS 塑胶货号 FROM 塑胶共用物料表 GROUP BY 物料编号) g ON g.物料编号 = t.物料编号`。
  - SELECT 加 `m.[颜色]`、`g.[工模编号]`、`g.[塑胶货号]`、`m.[单价]`、`SUM(t.[数量]) * ISNULL(m.[单价],0) AS 金额`(金额随 GROUP 聚合;`m.[单价]` 进 GROUP BY 或用 MAX)。
  - WHERE 加 `(@cat IS NULL OR m.[物料类别] = @cat)`;现有 仓库/关键词过滤保留;关键词 LIKE 加 `g.[塑胶货号]`/`g.[工模编号]` 可选。
  - `HAVING SUM(t.[数量]) <> 0` 保留(库存非零行)。
- 单元测试用 `Svc().ListAsync(...)` 直连,不动接口注入。

**`src/ErpApi/Engines/Inventory/PlasticInventoryController.cs`**
- List 端点加 `物料类别` 查询参,透传 ListAsync。
- 单价/金额脱敏:取得行后,若 `!await perms.HasAsync(user, "塑胶库存", PermissionAction.单价)`,把每行 `单价=null; 金额=null`。

**左树**:复用现成 `GET api/plastic-material-master/categories`(类别+数量),后端零改。

## ② 前端

**`web/src/api/plasticInventory.ts`**
- `PlasticStockRow` 加 `颜色?`、`工模编号?`、`塑胶货号?`、`单价?: number|null`、`金额?: number|null`。
- `list(仓库?, keyword?, 物料类别?)` 加第三参,拼到 params。

**`web/src/pages/plastics/PlasticInventoryPage.tsx`**(重写,镜像 `MaterialInventoryPage`)
- 左 `Tree`:`plasticMaterialMasterApi.categories()` → 节点(全部 + 各物料类别)。选中设 `物料类别` 并重查。
- 顶部工具栏:仓库输入、关键词搜索、导出EXCEL 按钮(`tableExport` 导出当前列+行)、打印按钮(`tableExport` 打印)。
- 表列:物料编号 | 工模编号 | 物料名称 | 规格 | 颜色 | 材料(物料类别) | 仓位号 | 单位 | 仓库 | 库存数量 | 单价 | 金额。`hidePrice(perms,"塑胶库存")` 为真时去掉 单价/金额 两列。
- 底部:库存数量合计、金额合计(脱敏时不显金额)——用 `Table` summary 或页脚 `Statistic`。
- 权限:沿用现有 `can(perms,"塑胶库存","打开")` 守卫。

## ③ 测试

- 后端 `PlasticInventoryServiceDbTests` 追加:种 1 物料(塑胶物料资料含 物料类别/颜色/单价)+ 共用物料表(工模编号/塑胶货号)+ 入仓审核 100 → `ListAsync(仓库, keyword)` 读回该行 颜色/工模编号/塑胶货号/单价、金额=100×单价;`ListAsync(仓库, kw, 物料类别="不存在")` 返回空(过滤生效)。清理。
- 全量 `dotnet test` 绿(361 → 362)。
- 前端 `npm --prefix web run test`(54)+ `build` tsc 干净。
- 冒烟:登录 → 入仓审核某物料 → `GET api/plastic-inventory?keyword=...` 返回 颜色/工模编号/塑胶货号/单价/金额;无单价权限用户拿到 单价/金额=null;`?物料类别=` 过滤生效。

## 不做(YAGNI)

- 类型下拉、精确查询、按款号查询(最后一张单款号物料)。
- 零库存显隐切换(需从 塑胶物料资料 全量 LEFT JOIN 库存以显示零movement物料,改动较大,留后续)。
- 表格设置(列自定义)。

## 执行

writing-plans → subagent-driven 逐任务 → opus 全分支终审 → 分支 `feat-plastic-inventory-report` `--no-ff` 合并 master 删分支 → worklog + 更新 MEMORY.md(P4 塑胶报表第一张)。
