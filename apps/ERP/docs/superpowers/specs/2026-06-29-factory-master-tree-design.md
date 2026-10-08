# 加工厂资料增强(左分类树 + 传真)· 设计 · 2026-06-29

## 目标

把 加工厂资料 从通用配置驱动平铺页升级为**左「加工厂类别」分类树 + 右加工厂资料表**(镜像物料资料 `MaterialMasterPage`),并补 **传真** 列。

## 范围与决策(已确认)

- 加左侧 加工厂类别 分类树(点类别过滤右表)+ 补传真列。镜像物料资料左树右表。
- **传真 DB 列已存在**(`db/01` 加工厂资料 有 [传真] nvarchar(30))→ 仅实体加映射,**无迁移**。
- CRUD 仍走现成 `MasterCrudController<加工厂资料>`(`masterApi("factories")`),实体加 传真 后增改自动含。
- 加工厂类别 master(factory-categories)沿用不动。

## 架构

后端镜像 `MaterialMaster`:新 `FactoryMaster`(Service+Controller+Dtos)提供 `/categories`(按 加工厂类别 计数)+ 过滤列表(含传真)。实体 `加工厂资料` 加 传真 映射。前端新 `FactoryMasterPage`(克隆 `MaterialMasterPage`)+ `api/factoryMaster.ts`;`MasterRouter` 把 加工厂资料 特例路由到 FactoryMasterPage。

## ① 后端

**实体**(`src/ErpApi/Data/Entities/加工厂资料.cs`)加:
```csharp
    [Column("传真")] public string? 传真 { get; set; }
```
(放在 电话 后·DB 列已存在。)

**`Features/Materials/FactoryMaster/`**(镜像 `MaterialMaster`):
- `FactoryMasterDtos.cs`:
```csharp
public sealed class FactoryCategoryNode { public string? 类别 { get; set; } public int 数量 { get; set; } }
public sealed class FactoryRow
{
    public long ID { get; set; }
    public string? 加工厂类别 { get; set; }
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public string? 联系人 { get; set; }
    public string? 手机 { get; set; }
    public string? 电话 { get; set; }
    public string? 传真 { get; set; }
    public string? 联系地址 { get; set; }
    public string? 付款方式 { get; set; }
    public string? 备注 { get; set; }
}
```
- `FactoryMasterService.cs`(`(ISqlConnectionFactory factory)`):
  - `CategoriesAsync()`:`SELECT [加工厂类别] AS 类别, COUNT(*) AS 数量 FROM [加工厂资料] WHERE [加工厂类别] IS NOT NULL AND LTRIM(RTRIM([加工厂类别]))<>'' GROUP BY [加工厂类别] ORDER BY [加工厂类别]`。
  - `ListAsync(类别?, keyword?, page, size)`:`COUNT + SELECT [ID],[加工厂类别],[加工厂编号],[加工厂名称],[联系人],[手机],[电话],[传真],[联系地址],[付款方式],[备注] FROM [加工厂资料] WHERE (@cat IS NULL OR [加工厂类别]=@cat) AND (@kw IS NULL OR [加工厂编号] LIKE @kw OR [加工厂名称] LIKE @kw OR [联系人] LIKE @kw) ORDER BY [加工厂编号] OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY`(`PagedResult<FactoryRow>`)。
- `FactoryMasterController.cs`(`[Route("api/factory-master")]`·菜单 `加工厂资料`·注入 `FactoryMasterService`+`IPermissionService`):`GET categories`(打开→CategoriesAsync)、`GET ?类别=&keyword=&page=&size=`(打开→ListAsync)。无脱敏。
- DI:`Program.cs` 若 MaterialMasterService 显式 `AddScoped` 则照样注册 `FactoryMasterService`(读确认)。
- 菜单/权限:沿用现有「加工厂资料」(无需加菜单/种子)。

## ② 前端

- `api/factoryMaster.ts`:`FactoryCategoryNode{类别?,数量}` + `FactoryRow`(同后端) + `factoryMasterApi.categories()` + `.list(类别?,keyword?,page,size)`(端点 `/factory-master/categories`、`/factory-master`)。
- `FactoryMasterPage.tsx`(克隆 `MaterialMasterPage`·去价格相关):左 `Tree`(加工厂类别·factoryMasterApi.categories·含「全部」)+ 右 `Table`(列 加工厂编号/加工厂名称/加工厂类别/联系人/手机/电话/**传真**/联系地址/付款方式/备注)+ 新增/修改/删除弹窗(Form 字段同列·走 `masterApi("factories")` 的 create/update/remove)+ 关键词搜索 + 分页。MENU="加工厂资料"·`can` 守卫。
- `MasterRouter.tsx`:`const decoded = menu ? decodeURIComponent(menu) : "";` `if (decoded === "加工厂资料") return <FactoryMasterPage/>;`(在 cfg 查找前)。其余不变。

## ③ 测试

- 后端 `FactoryMasterServiceDbTests`:种 加工厂资料 2 行(类别 A 一行带传真 F1、类别 B 一行)→ `CategoriesAsync` 验类别 A/B 各计数;`ListAsync("A",null,1,50)` 1 行·传真=F1;`ListAsync(null,"关键词",..)` keyword 过滤;`ListAsync(null,null,..)` 2 行。清理。`using Dapper;`。
- 全量 `dotnet test` 绿(381→382);前端 54 + tsc 干净。
- 冒烟:种 → `GET /api/factory-master/categories` 类别计数 + `GET /api/factory-master?类别=A` 传真带出。**起后端 `--contentRoot 输出目录` + 冒烟前 `dotnet build -c Release`(锁先按 PID Stop-Process)。**

## 不做(YAGNI)

- DB 迁移(传真列已存在)、加工厂类别 master 改动、价格/脱敏。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-factory-master-tree` `--no-ff` 合并 → worklog + MEMORY。
