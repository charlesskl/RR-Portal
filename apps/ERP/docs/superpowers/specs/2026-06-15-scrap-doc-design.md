# 报废单（物料报废）设计文档

> 日期：2026-06-15　主题：照退料单纵切克隆出「报废单」，唯一语义差异 = 库存方向取负。

## 目标

新增一张**报废单**，用于记录物料报废（料废掉/销毁），审核过账后从物料库存**扣减**。
界面、录入、选择器、审核/反审核、复制单、打印 全部与退料单一致——因为复用同一套配置驱动的通用单据组件，前端只加一条配置即可白嫖。

## 背景与现状

调研结论：报废单基础设施**完全不存在**（无表、无后端、无前端配置、无权限项），`menuTree.tsx` 里「报废单」当前只是无路由占位菜单。本设计照**退料单纵切**（`MaterialReturn`）逐层克隆。

退料单参照点（已确认）：
- 后端 `src/ErpApi/Features/Materials/MaterialReturn/`：`MaterialReturnController.cs`(103) / `MaterialReturnService.cs`(92) / `MaterialReturnDtos.cs`(34)
- 常量：`DocType="退料单"`、`Prefix="TL"`、`Menu=Table="退料单"`、期间锁 `口径="物料"`
- DI：`Program.cs:47` `AddScoped<MaterialReturnService>()`
- 库存引擎：`MaterialInventoryService.cs` 的 `LedgerUnion`，退料明细单**直接加**(+)、领料/采购退仓 `数量*-1`(−)
- 过账白名单：`PostableDocuments.cs` `["退料单"]="单号"`
- 审核留痕列：`db/03_p0_additions.sql` 对清单内表 ALTER 补 `审核人/审核日期`
- 前端：`materialDocConfigs.ts` `material-returns` 配置 + `MaterialDocRouter` + `menuTree.tsx` + `MenuCatalog.cs`

## 核心语义差异（与退料单唯一的不同）

| 单据 | 库存 UNION 符号 |
|---|---|
| 退料单 | `数量`（+，加库存） |
| 领料单 / 采购退仓 | `数量*-1`（−，减库存） |
| **报废单** | **`数量*-1`（−，减库存）** ← 本设计 |

## 命名约定（已确认）

- 单号前缀 `BF`（= `BF + yyyyMMdd + 3位流水`；经核对现有前缀无冲突）
- 表头部门/经手人字段：`报废部门`、`报废人`
- 后端资源/路由：`api/material-scraps`
- 前端路由：`/materials/material-scraps`；config key `material-scraps`
- 权限菜单名 / 表名 / DocType：`报废单`（归「物料管理」组）

## 分层设计

### 1. 数据库（`db/01_rebuild_schema.sql` + `db/03_p0_additions.sql`）

新建两表，列定义镜像 `退料单` / `退料明细单`：

**`报废单`**（单头）：`ID`(PK) / 单号 / 日期 / 生产单号 / 报废部门 / 报废人 / 仓库 / 数量 / 金额 / 操作员 / 审核 / 备注 / 打印次数 / 已阅用户。

**`报废明细单`**（明细）：`ID`(PK) / 单号 / 日期 / 生产单号 / 款号 / 合同号 / 客户款号 / 报废部门 / 报废人 / 仓库 / 物料类别 / 条码号 / 物料编号 / 物料名称 / 规格 / 颜色 / 单位 / 数量 / 库存单价 / 库存金额 / 单价 / 金额 / 备注 / 预算数量 / 预算单价 / 打印次数。

`db/03_p0_additions.sql`：把 `(N'报废单')` 加入审核留痕列清单（自动 ALTER 补 `审核人/审核日期`）。
> 注：建表脚本是净室重建的幂等基线；现有开发/测试库需重建或手动 ALTER 才生效（与历史新表一致）。

### 2. 后端 Feature（`src/ErpApi/Features/Materials/MaterialScrap/`）

照 `MaterialReturn` 三件套 1:1 克隆，逐字替换 退料→报废、TL→BF、material-returns→material-scraps：

- **`MaterialScrapDtos.cs`**：`MaterialScrapCreateDto`(报废部门/报废人/仓库/备注/明细) + `MaterialScrapHeaderDto`(含 单号/日期/数量/金额/操作员/审核/审核人/备注) + `MaterialScrapDetailDto`(单头+明细) + 复用共享 `MaterialDocLineDto`。
- **`MaterialScrapService.cs`**：`DocType="报废单"`、`Prefix="BF"`。`CreateAsync` 单头 INSERT `[报废单]` + 循环明细 INSERT `[报废明细单]`（含生产单号/款号），事务、单号引擎、`审核='0'` 初始。`ListAsync`(分页+关键字搜 单号/报废部门/报废人/备注) / `GetAsync`(单头+明细)。
- **`MaterialScrapController.cs`**：路由 `api/material-scraps`；`Menu=Table="报废单"`、`口径="物料"`。Actions 与退料单同：List/Get(打开)、Create(保存)、Delete(删除)、Approve/Unapprove(审核/反审核，走 `IPostingEngine`)。创建查 `EnsureWarehouseOpenAsync`、审核查 `EnsureHeaderOpenAsync`。无「单价」权限时 `MaskDetail` 清空 单价/金额。审计 `audit.WriteAsync`。
- **DI**：`Program.cs` 补 `AddScoped<MaterialScrapService>()`。

### 3. 库存引擎（`MaterialInventoryService.cs`）

`LedgerUnion` 末尾追加一支（符号取负，只认已审核）：
```sql
UNION ALL
SELECT h.[仓库], d.[物料编号], ..., d.[数量]*-1
  FROM [报废明细单] d JOIN [报废单] h ON d.[单号]=h.[单号]
 WHERE ISNULL(h.[审核],'0')='1'
```
注释更新为：`物料库存 = 采购入仓(+) + 退料(+) − 领料(−) − 采购退仓(−) − 报废(−)`。

### 4. 过账白名单（`PostableDocuments.cs`）

`Map` 补 `["报废单"]="单号"`。

### 5. 权限（`MenuCatalog.cs` + 种子）

- `MenuCatalog.All` 补 `new("物料管理","报废单")`。
- 权限种子 SQL（`db/seed_*` 中给超管/角色发齐 9 位权限的位置）补「报废单」记录，使现有账号可用；与退料单同组同档。

### 6. 前端

- **`materialDocConfigs.ts`** 新增：
  ```ts
  "material-scraps": {
    resource: "material-scraps", menu: "报废单", title: "报废", usageCols: true,
    headerFields: [
      { name: "报废部门", label: "部门" }, { name: "日期", label: "日期", type: "date-today" },
      { name: "报废人", label: "报废人", type: "employee" }, { name: "单号", label: "电脑单号", type: "docno" },
      { name: "操作员", label: "操作员", type: "operator" }, { name: "仓库", label: "仓库", required: true },
      { name: "备注", label: "备注" },
    ],
    listExtra: [{ name: "报废部门", label: "报废部门" }, { name: "报废人", label: "报废人" }, { name: "仓库", label: "仓库" }],
  }
  ```
- **路由**：`MaterialDocRouter`/`AppRouter` 已按 `:doc` 参数通用解析，确认 `/materials/material-scraps` 命中 config 即可（如有显式 route 列表则补一条）。
- **`menuTree.tsx`**：占位 `M("报废单")` 改为 `M("报废单","/materials/material-scraps","报废单")`。
- 录入/明细/选择器/复制单/打印 全部复用现有通用组件，零额外前端代码。

### 7. 测试

- **后端 `MaterialScrapDbTests`**：建单往返（单头+明细字段含生产单号/款号回读一致）；**审核后 `MaterialInventoryService` 该物料库存按报废数量减少**；反审核后恢复。镜像 `MaterialReturnDbTests` + 退料的库存断言（符号相反）。
- **前端**：`materialDocConfigs` 含 `material-scraps`、字段/usageCols 正确（纯配置断言；录入逻辑由现有 42 测试覆盖）。

## 数据流

录入抽屉（通用组件，按 config 渲染表头+明细行，🔍 选生产制单/物料/报废人）→ `POST /api/material-scraps`（CreateDto）→ `MaterialScrapService.CreateAsync`（事务写 报废单+报废明细单，审核='0'）→ 列表点「审核」→ `POST /{单号}/approve` → `PostingEngine.ApproveAsync("报废单",...)`（写 审核='1'/审核人/审核日期）→ `MaterialInventoryService` 实时聚合时该单 `数量*-1` 计入 → 物料库存扣减。

## 错误处理

沿用退料单：明细为空 / 未指定仓库 → 400；期间已锁 → 409；审核失败（单不存在或已审核）→ 409；无权限 → 403；价格保密由后端 `MaskDetail` 落实。

## 不做（YAGNI / 延后）

- 「装配采购」列保持空占位（依赖未建的外发装配模块），与退料单一致。
- 报废原因/报废类别等扩展字段：本期不加，保持与退料单同构。
- 报废单查询报表：延后（与领料/退料查询报表同批延后）。
