# 塑胶模块 · P1 塑胶共用物料表(按货号的塑胶BOM) · 设计

> 日期:2026-06-25
> 范围:塑胶模块第二个子项目 —— 塑胶共用物料表(按塑胶货号的塑胶注塑BOM)CRUD + 过滤列表页。
> 上游:[[P0 塑胶物料资料]] 已完成(`946cab8`)。本期建塑胶物料单的"带出源"。

## 1. 背景

经与用户澄清:原系统**没有独立的"塑胶物料设置/BOM"表单**;塑胶物料单(按工序/工模列塑胶用料)打开时**从「塑胶共用物料表」自动带出再改**。因此塑胶模块路线修正为:

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 塑胶物料资料(料的主数据) | ✅ `946cab8` |
| **P1** | **塑胶共用物料表**(按塑胶货号的塑胶BOM·塑胶物料单带出源) | ← 本期 |
| P2 | 塑胶物料单 + 塑胶采购分析(用户最初两屏) | |
| P3+ | 塑胶仓库单据 / 报表 | |

塑胶共用物料表 = 按 **塑胶货号** 的塑胶注塑 BOM:每行一种塑胶料(引用 P0 塑胶物料资料的物料编号),带注塑专属参数(整啤净重/原胶件单净重/模腔数/套数/用量)与加工信息。数据流:塑胶物料资料(P0)→ 塑胶共用物料表(P1,按货号定义用料)→ 塑胶物料单(P2,按生产单货号带出)。

## 2. 目标 / 非目标

**目标(P1):**
- 新建 `塑胶共用物料表` 表 + EF 实体。
- 增删改(复用泛型 `MasterCrudController<T>`)。
- 按 客户/塑胶货号/工模编号/关键词/审核情况 过滤的分页列表页。
- 新增/编辑行时,**物料编号**经塑胶物料选择器从 P0 塑胶物料资料选取并回填名称/颜色(P0→P1 关联)。
- 菜单「塑胶共用物料表」占位项落地 + 9 位权限。

**非目标(后续):**
- 塑胶物料单的"带出"逻辑(P2)。
- `调整审核` 的审核工作流(本期仅作存储字段)。
- `用量`/整啤净重/模腔数 的自动计算公式(本期仅作可录字段)。
- 工模表(独立主数据,需要时另开)。

## 3. 数据模型

新建表 `塑胶共用物料表`(列照「塑胶共用物料表」截图):

```sql
CREATE TABLE [塑胶共用物料表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [客户] nvarchar(50) NULL,
    [塑胶货号] nvarchar(40) NULL,        -- 键(按货号的BOM)
    [工模编号] nvarchar(30) NULL,
    [物料名称] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [色粉号] nvarchar(30) NULL,
    [用料名称] nvarchar(40) NULL,
    [加工内容] nvarchar(50) NULL,
    [加工单价] decimal(18,4) NULL,
    [整啤净重] decimal(18,4) NULL,
    [原胶件单净重] decimal(18,4) NULL,
    [整啤模腔数] decimal(18,4) NULL,
    [套数] decimal(18,4) NULL,
    [用量] decimal(18,4) NULL,
    [物料编号] nvarchar(20) NULL,        -- 引用 塑胶物料资料.物料编号
    [共用原料编号] nvarchar(20) NULL,
    [调整审核] nvarchar(5) NULL,
    [备注内容] nvarchar(200) NULL,
    [工模表备注] nvarchar(200) NULL
);
```
脚本:`db/16_plastic_common_materials.sql`(下一序号;P0=15)。

**实体** `src/ErpApi/Data/Entities/塑胶共用物料表.cs`(继承 `MasterEntity`,`[Table("塑胶共用物料表")]`),映射上述全部列,`加工单价` 标 `[PriceField]`(价格脱敏)。

## 4. 后端(沿用 P0 模式)

**4.1 增删改(泛型 CRUD)** —— `src/ErpApi/Features/MasterData/Controllers.cs` 加:
```csharp
[Route("api/master/plastic-common-materials")]
public sealed class PlasticCommonMaterialController(
    MasterCrudService<塑胶共用物料表> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<塑胶共用物料表>(s, p, a, f)
{ protected override string Menu => "塑胶共用物料表"; protected override string TableName => "塑胶共用物料表"; }
```
DbSet 注册 `塑胶共用物料表`;`MasterCrudService<>` 已泛型注册,无额外 DI。

**4.2 过滤列表只读** —— 新 `src/ErpApi/Features/Plastics/PlasticCommonMaterial/`:
- `PlasticCommonMaterialService.ListAsync(客户, 塑胶货号, 工模编号, keyword, 审核情况, page, size)`:精确过滤 客户/塑胶货号/工模编号 + 关键词(物料编号/物料名称/用料名称/共用原料编号 LIKE)+ 审核情况(对 `调整审核`,沿用 `ApprovalFilter`:已审核=`'1'`/未审核≠`'1'`/全部)+ 分页。返回 `PlasticCommonMaterialRow`(全列)。
- `PlasticCommonMaterialController` → `api/plastic-common-materials`,`Menu="塑胶共用物料表"`:`GET ?客户&塑胶货号&工模编号&keyword&审核情况&page&size`;无 `单价` 权限置 `加工单价=null`。
- DI 注册 `PlasticCommonMaterialService`(照 P0 第46行)。

**4.3 权限** —— `MenuCatalog` 加 `("塑胶仓储","塑胶共用物料表")`;`db/seed_plastic_common_perms.sql` 给 admin 授 9 位。

## 5. 前端(镜像 P0 PlasticMaterialMasterPage)

- `web/src/api/plasticCommonMaterial.ts`:`PlasticCommonMaterialRow` 类型(全列)+ `list(客户,塑胶货号,工模编号,keyword,审核情况,page,size)`;CRUD 复用 `masterApi("plastic-common-materials")`。
- `web/src/pages/plastics/PlasticCommonMaterialPage.tsx`:顶部筛选(客户 / 塑胶货号 / 工模编号 / 关键词 / 审核情况下拉)+ 分页表(全列;加工单价按 `hidePrice` 显 `***`)+ 新增/编辑 Modal。
- `web/src/pages/plastics/PlasticMaterialPicker.tsx`:克隆 `web/src/pages/materials/MaterialPicker.tsx`,数据源换 `plasticMaterialMasterApi`(P0)。Modal 表单里 **物料编号** 行配"选料"按钮 → 打开选择器 → 回填 物料编号/物料名称/颜色。
- 路由 `/plastic-common-materials`;菜单 ⑧塑胶仓库 `M("塑胶共用物料表","/plastic-common-materials","塑胶共用物料表")`(替换占位)。

## 6. 测试

- 后端 `tests/ErpApi.Tests/PlasticCommonMaterialServiceDbTests.cs`:
  - list 按 塑胶货号 精确过滤、按 客户 过滤、关键词过滤、分页。
  - 审核情况过滤(已/未审核基于 `调整审核`)。
  - 加工单价脱敏(Controller 层,可加一条)。
- 通用 CRUD 已被现有 MasterCrud 测试覆盖。
- 全量:后端 dotnet test 全过、前端 tsc/vitest 全过、build ✓。

## 7. 验收标准

1. 执行 `db/16_plastic_common_materials.sql` 后表存在。
2. `/plastic-common-materials` 页:筛选(客户/货号/工模/关键词/审核)生效;新增一行(经塑胶物料选择器选料回填物料编号/名称/颜色,填注塑参数)→ 列表可见;编辑/删除生效。
3. 无「塑胶共用物料表·单价」权限者看到加工单价 `***`。
4. 菜单 ⑧塑胶仓库「塑胶共用物料表」可进入。

## 8. 风险 / 决策

- **键 = 塑胶货号**:用户确认按货号的 BOM。
- **CRUD 形态 = 扁平列表 + 逐行增删改**(非"按货号 load+replace"):截图 塑胶共用物料表 是跨货号的大网格 + 顶部筛选,故用扁平列表(同 P0 风格,顶部筛选无左树)。
- **注塑参数/用量 = 可录字段**(不做计算公式):YAGNI,P2 带出时若需公式再加。
- **调整审核 = 存储字段 + 仅作过滤**(无审核按钮工作流):本期 master/BOM 不引入过账。
- **物料编号引用 P0**:经塑胶物料选择器选取;不加外键约束(与现有 BOM/单据松耦合一致)。
