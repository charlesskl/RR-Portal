# 塑胶模块 · P0 塑胶物料资料(地基) · 设计

> 日期:2026-06-25
> 范围:塑胶独立模块的第一个子项目 —— 塑胶物料主数据 CRUD + 左树右表查询页。
> 上游决策:用户确认"完整搭塑胶独立模块",按 P0地基→P1塑胶BOM→P2采购两屏→P3仓库→P4报表 拆分,先做 P0。

## 1. 背景与动机

原系统(兴信B)有一整套与「物料/辅料/原料」并列的**塑胶模块**(菜单组 ⑦塑胶采购 / ⑧塑胶仓库 / ⑨塑胶报表,共 30+ 项)。重建系统里塑胶模块**零表、零数据、零后端、零实体**(遗留库 153 张表无一张塑胶表;`物料资料.物料类别` 仅 辅料/面料)。

用户展示的两屏(塑胶采购物料分析 + 塑胶物料单)属于 P2,但它们依赖塑胶主数据(P0)和塑胶BOM(P1)才有数据。因此从 **P0 塑胶物料资料** 这块地基开始。

塑胶物料资料是塑胶原料的主数据表,等价于物料侧的 `物料资料`。**字段口径(用户确认):镜像 `物料资料` + 新增 `仓位号`**(塑胶物料单里可见的塑胶特有库位字段)。

## 2. 目标 / 非目标

**目标(P0):**
- 新建 `塑胶物料资料` 表 + EF 实体。
- 塑胶物料资料的增删改(复用现有泛型 `MasterCrudController<T>`)。
- 塑胶物料资料的左分类树 + 右分页表只读查询页(镜像 `物料资料` 页)。
- 菜单占位项「塑胶物料资料」落地 + 9 位权限。

**非目标(后续阶段):**
- P1 塑胶BOM(塑胶物料设置)、P2 塑胶采购分析/塑胶物料单/塑胶采购订单、P3 塑胶仓库单据、P4 塑胶报表。
- 工模表、塑胶共用物料表(P0 暂不做,需要时另开)。
- 塑胶库存引擎接入(无单据无库存流水,P0 不涉及;`库存` 列先作为可录字段存在,与物料侧一致)。

## 3. 数据模型

新建表 `塑胶物料资料`,镜像 `物料资料`(见 `db/01_rebuild_schema.sql`)结构 + 新增 `[仓位号]`。

```sql
CREATE TABLE [塑胶物料资料] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [物料类别] nvarchar(20) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [规格] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [单位] nvarchar(20) NULL,
    [仓位号] nvarchar(30) NULL,          -- 塑胶新增:库位
    [单价] decimal(18,4) NULL,
    [销售价] decimal(18,4) NULL,
    [库存] decimal(18,4) NULL,
    [最低库存] decimal(18,4) NULL,
    [最高库存] decimal(18,4) NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(50) NULL,
    [款号] nvarchar(40) NULL,
    [货币] nvarchar(20) NULL,
    [备注] nvarchar(max) NULL
);
```

脚本:`db/NN_plastic_material_master.sql`(取 `db/` 下一个序号)。

**实体** `src/ErpApi/Data/Entities/塑胶物料资料.cs`(镜像 `物料资料.cs`,继承 `MasterEntity`):

```csharp
[Table("塑胶物料资料")]
public sealed class 塑胶物料资料 : MasterEntity
{
    [Column("物料类别")] public string? 物料类别 { get; set; }
    [Column("物料编号")] public string? 物料编号 { get; set; }
    [Column("物料名称")] public string? 物料名称 { get; set; }
    [Column("规格")] public string? 规格 { get; set; }
    [Column("颜色")] public string? 颜色 { get; set; }
    [Column("单位")] public string? 单位 { get; set; }
    [Column("仓位号")] public string? 仓位号 { get; set; }
    [Column("单价"), PriceField] public decimal? 单价 { get; set; }
    [Column("销售价"), PriceField] public decimal? 销售价 { get; set; }
    [Column("供应商编号")] public string? 供应商编号 { get; set; }
    [Column("款号")] public string? 款号 { get; set; }
    [Column("货币")] public string? 货币 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
```

注:`库存/最低库存/最高库存/供应商名称` 在表里存在、供只读 list 读取(与 `物料资料` 一致:实体不映射、读路径用 DTO 取),CRUD 不直接编辑库存(库存由后续单据流水驱动)。`MasterEntity` 提供 `ID`。需在 `ErpDbContext` 注册 `DbSet<塑胶物料资料>`(若泛型 CRUD 依赖)。

## 4. 后端

**4.1 增删改(泛型 CRUD,零新基础设施)**
`src/ErpApi/Features/MasterData/Controllers.cs` 加:
```csharp
[Route("api/master/plastic-materials")]
public sealed class PlasticMaterialController(
    MasterCrudService<塑胶物料资料> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<塑胶物料资料>(s, p, a, f)
{ protected override string Menu => "塑胶物料资料"; protected override string TableName => "塑胶物料资料"; }
```
白嫖泛型 CRUD 自带的审计、价格脱敏([PriceField] 字段按 `单价` 权限)。需在 DI 注册 `MasterCrudService<塑胶物料资料>`(若不是自动注册,照 `物料资料` 的注册处补一行)。

**4.2 左树 + 右表只读(镜像 MaterialMaster)**
新 `src/ErpApi/Features/Plastics/PlasticMaterialMaster/`:
- `PlasticMaterialMasterService.cs`:
  - `CategoriesAsync()` —— `SELECT 物料类别 AS 类别, COUNT(*) AS 数量 FROM [塑胶物料资料] WHERE 物料类别 非空 GROUP BY 物料类别`(复用 `MaterialCategoryNode` DTO)。
  - `ListAsync(类别, keyword, page, size)` —— 分类精确过滤 + 关键词(物料编号/名称/规格/颜色/供应商名称 LIKE)+ 分页;返回 `PlasticMaterialRow`(镜像 `MaterialRow` + `仓位号`)。
- `PlasticMaterialMasterController.cs` → `api/plastic-material-master`,`Menu="塑胶物料资料"`:`GET categories`、`GET ?类别&keyword&page&size`(无 `单价` 权限则置 `单价/销售价=null`)。

**4.3 权限**
- `MenuCatalog`(`src/ErpApi/Features/Admin/MenuCatalog.cs`)加菜单名 `塑胶物料资料`(进 9 位权限矩阵)。
- `db/seed_plastic_perms.sql`:给 `admin` 授 `塑胶物料资料` 9 位(照 `seed_stocktake_perms.sql`)。

## 5. 前端(镜像 MaterialMasterPage)

- `web/src/api/plasticMaterialMaster.ts`:`categories()` + `list(类别,keyword,page,size)`;类型 `PlasticMaterialRow`(= `MaterialRow` + `仓位号?`)、复用 `MaterialCategoryNode`。CRUD 复用 `masterApi("plastic-materials")`。
- `web/src/pages/plastics/PlasticMaterialMasterPage.tsx`:克隆 `MaterialMasterPage`:
  - 左「全部塑胶物料」分类树;右分页表:列 物料编号/名称/类别/规格/颜色/单位/**仓位号**/单价/销售价/库存/最低库存/供应商/备注 + 操作。
  - 新增/编辑 Modal:表单含 **仓位号** 字段;价格字段按 `hidePrice` 隐藏;价格列 `***`。
- 路由 `web/src/App.tsx`:`<Route path="plastic-material-master" element={<PlasticMaterialMasterPage/>} />`。
- 菜单 `web/src/nav/menuTree.tsx` ⑧塑胶仓库:`M("塑胶物料资料","/plastic-material-master","塑胶物料资料")`。

## 6. 测试

- 后端 `tests/ErpApi.Tests/PlasticMaterialMasterServiceDbTests.cs`(镜像物料侧 MaterialMaster 测试):
  - categories 按非空类别去重计数。
  - list 分类精确过滤 + 关键词过滤 + 分页。
  - 价格脱敏在 Controller 层(无 `单价` 权限置 null)—— 与物料侧同模式,可加一条覆盖。
- 通用 CRUD(增删改)已被现有 `MasterCrud` 测试覆盖,不重复造。
- 全量:后端 dotnet test 全过、前端 tsc/vitest 全过、build ✓。

## 7. 验收标准

1. 执行 `db/NN_plastic_material_master.sql` 后 `塑胶物料资料` 表存在。
2. admin 授权后 `/plastic-material-master` 页可见:左树(空库时只有"全部塑胶物料")、右表、新增可建一条带 仓位号 的塑胶物料、编辑/删除生效、关键词/分类过滤生效。
3. 无「塑胶物料资料·单价」权限的用户看到单价/销售价为 `***`。
4. 菜单 ⑧塑胶仓库「塑胶物料资料」可点进入。

## 8. 风险 / 决策

- **独立表 vs 复用物料资料**:用户选独立模块 → 独立表 `塑胶物料资料`,与 `物料资料` 物理隔离(塑胶后续单据/库存均走塑胶表系)。
- **分类来源**:左树分类直接取 `塑胶物料资料.物料类别` 去重(同物料侧),不另建 `塑胶物料类别` 表(YAGNI;需要分类主数据时 P0 之后再补)。
- **库存列**:P0 仅作为可读列,真实库存流水在 P3 塑胶仓库单据 + 库存引擎接入后才有意义。
```
