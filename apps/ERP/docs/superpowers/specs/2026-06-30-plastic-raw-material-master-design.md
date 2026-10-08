# 塑胶原料资料表 · 设计 · 2026-06-30

## 目标

① 基本设置「塑胶原料资料表」——可编辑主数据页(左 物料类别 树 + 右表格 + 增删改),**保存/删除按权限**(无权限只读)。镜像 塑胶物料资料(PlasticMaterialMaster)。塑胶原料=ABS/PP/PVC 等树脂,字段在塑胶物料基础上加 商品名称/起订量(MOQ)/安全库存。**新表 `塑胶原料资料`**。

## 范围与决策(已确认)

- 编辑方式 = **弹窗增删改**(Modal·同塑胶物料资料·`canSave/canDelete` 门控)。
- 字段 = 镜像塑胶物料资料 + 加 **商品名称 / 起订量 / 安全库存**。
- 单价/销售价按权限脱敏。

## ① 后端

**新表**(`db/30_plastic_raw_material.sql`·EF 不迁移·幂等):
```sql
IF OBJECT_ID(N'[塑胶原料资料]', N'U') IS NULL
CREATE TABLE [塑胶原料资料] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [物料类别] nvarchar(40) NULL,
    [物料编号] nvarchar(40) NULL,
    [物料名称] nvarchar(80) NULL,
    [规格] nvarchar(60) NULL,
    [颜色] nvarchar(30) NULL,
    [单位] nvarchar(20) NULL,
    [仓位号] nvarchar(30) NULL,
    [商品名称] nvarchar(80) NULL,
    [单价] decimal(18,4) NULL,
    [销售价] decimal(18,4) NULL,
    [起订量] decimal(18,4) NULL,
    [安全库存] decimal(18,4) NULL,
    [库存] decimal(18,4) NULL,
    [最低库存] decimal(18,4) NULL,
    [最高库存] decimal(18,4) NULL,
    [供应商编号] nvarchar(40) NULL,
    [供应商名称] nvarchar(80) NULL,
    [款号] nvarchar(40) NULL,
    [货币] nvarchar(20) NULL,
    [备注] nvarchar(200) NULL
);
```

**实体**(`src/ErpApi/Data/Entities/塑胶原料资料.cs`·: MasterEntity·只映射可改字段+PriceField·镜像 塑胶物料资料.cs 加 商品名称/起订量/安全库存):
```csharp
using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("塑胶原料资料")]
public sealed class 塑胶原料资料 : MasterEntity
{
    [Column("物料类别")] public string? 物料类别 { get; set; }
    [Column("物料编号")] public string? 物料编号 { get; set; }
    [Column("物料名称")] public string? 物料名称 { get; set; }
    [Column("规格")] public string? 规格 { get; set; }
    [Column("颜色")] public string? 颜色 { get; set; }
    [Column("单位")] public string? 单位 { get; set; }
    [Column("仓位号")] public string? 仓位号 { get; set; }
    [Column("商品名称")] public string? 商品名称 { get; set; }
    [Column("单价"), PriceField] public decimal? 单价 { get; set; }
    [Column("销售价"), PriceField] public decimal? 销售价 { get; set; }
    [Column("起订量")] public decimal? 起订量 { get; set; }
    [Column("安全库存")] public decimal? 安全库存 { get; set; }
    [Column("供应商编号")] public string? 供应商编号 { get; set; }
    [Column("款号")] public string? 款号 { get; set; }
    [Column("货币")] public string? 货币 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
```

**DbContext**(`src/ErpApi/Data/ErpDbContext.cs`·在 塑胶物料资料 DbSet 后加):
```csharp
    public DbSet<塑胶原料资料> 塑胶原料资料 => Set<塑胶原料资料>();
```

**通用 CRUD 控制器**(`Features/MasterData/Controllers.cs` 加·镜像 PlasticMaterialController):
```csharp
[Route("api/master/plastic-raw-materials")]
public sealed class PlasticRawMaterialController(
    MasterCrudService<塑胶原料资料> s, IPermissionService p, IAuditLogger a, ISqlConnectionFactory f)
    : MasterCrudController<塑胶原料资料>(s, p, a, f)
{ protected override string Menu => "塑胶原料资料表"; protected override string TableName => "塑胶原料资料"; }
```
(`MasterCrudService<>` 已开放泛型注册·`PriceField`/保存/删除/单价 权限 由基类自动处理。需 `using ErpApi.Data.Entities;` 已在该文件。)

**读控制器 + 服务**(新 `Features/Plastics/PlasticRawMaterialMaster/`·克隆 PlasticMaterialMaster):
- DTOs `PlasticRawMaterialCategoryNode{类别,数量}` + `PlasticRawMaterialRow{ID/物料类别/物料编号/物料名称/规格/颜色/单位/仓位号/商品名称/单价/销售价/起订量/安全库存/库存/最低库存/最高库存/供应商编号/供应商名称/备注}`。
- `PlasticRawMaterialMasterService`:`CategoriesAsync`(GROUP BY 物料类别 COUNT)+ `ListAsync(类别,keyword,page,size,onlyStock)`(SELECT 上述列·keyword LIKE 物料编号/名称/规格/颜色/供应商名称/商品名称·分页)。
- `PlasticRawMaterialMasterController`(`api/plastic-raw-material-master`·Menu `塑胶原料资料表`·`/categories`+`/`·无单价权限置 单价/销售价 null)。
- `Program.cs` 注册 `PlasticRawMaterialMasterService`。

**菜单 + 权限**:`MenuCatalog.cs` 加 `new("基本设置","塑胶原料资料表")`;`db/seed_plastic_raw_material_perms.sql` admin 9 位(两库)。

## ② 前端(克隆 `PlasticMaterialMasterPage`)

- `api/plasticRawMaterialMaster.ts`:`PlasticRawMaterialCategoryNode` + `PlasticRawMaterialRow`(全列含 商品名称/起订量/安全库存)+ `plasticRawMaterialMasterApi{categories,list}` → `/plastic-raw-material-master`;CRUD 复用 `masterApi("plastic-raw-materials")`。
- `PlasticRawMaterialMasterPage.tsx`:`MENU="塑胶原料资料表"`;左树(全部塑胶原料 + 类别)+ 右表(列 物料编号/物料名称/类别/规格/颜色/商品名称/单位/单价[脱敏]/销售价[脱敏]/起订量/安全库存/库存/供应商/备注 + 操作 编辑/删除)+ 新增/编辑 Modal(字段:物料编号必填/物料名称/物料类别/规格/颜色/单位/仓位号/商品名称/单价/销售价/起订量/安全库存/供应商编号/备注·单价销售价 priceHidden 时隐藏)。`canSave/canDelete` 门控。
- `App.tsx`:import + `<Route path="plastic-raw-material-master" element={<PlasticRawMaterialMasterPage />} />`。
- `menuTree.tsx` line 27:`M("塑胶原料资料表")` → `M("塑胶原料资料表","/plastic-raw-material-master","塑胶原料资料表")`。

## ③ 测试

- 后端 `PlasticRawMaterialMasterDbTests`(镜像 PlasticMaterialMasterDbTests):种 塑胶原料资料(类别 ABS·物料编号 R-T1·商品名称/起订量/安全库存)→ CategoriesAsync 含 ABS·数量≥1;ListAsync 类别=ABS 命中/keyword 命中/onlyStock;商品名称/起订量/安全库存 读出。Clean 删种子。
- 全量 `dotnet test` 绿(401→≥402);前端 54 + `tsc` 干净。
- **HTTP 冒烟**:登录 → POST `/api/master/plastic-raw-materials`(建)→ GET `/api/plastic-raw-material-master/categories`+`/`(验商品名称/起订量/安全库存)→ PUT 改 → DELETE。清理。**起后端 Release(锁先 PID Stop-Process)+ `--contentRoot 输出目录`;node axios `proxy:false`。**

## 不做(YAGNI)

- 行内编辑、批量导入、原料采购/库存联动(后续)。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-raw-material-master` `--no-ff` 合并 master → worklog + MEMORY。
