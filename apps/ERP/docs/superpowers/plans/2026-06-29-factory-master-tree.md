# 加工厂资料增强(左分类树 + 传真)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 加工厂资料 升级为左「加工厂类别」分类树 + 右表(镜像物料资料),补传真列。

**Architecture:** 后端镜像 MaterialMaster 新 FactoryMaster(categories+过滤列表);实体加传真映射(DB列已存在)。前端新 FactoryMasterPage(克隆 MaterialMasterPage)+ MasterRouter 特例路由。CRUD 仍走 masterApi("factories")。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + AntD v6 + Vitest。

---

## 前置约定

- 分支 `feat-factory-master-tree`;`dotnet`=`C:\Program Files\dotnet\dotnet.exe`,`-c Release`。DB env User scope。提交末尾 Co-Authored-By。
- **冒烟前 `dotnet build -c Release`(锁先按 PID Stop-Process)+ 起后端 `--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`。**
- 完整 SQL/DTO 见 spec `docs/superpowers/specs/2026-06-29-factory-master-tree-design.md`。
- **传真 DB 列已存在**(`db/01` 加工厂资料 有 [传真])→ 仅实体加映射·无迁移。
- 镜像源:`src/ErpApi/Features/Materials/MaterialMaster/`(Service/Controller/Dtos)、`web/src/pages/materials/MaterialMasterPage.tsx`、`web/src/api/materialMaster.ts`、`web/src/api/master.ts`(`masterApi`)。
- 加工厂 UNIQUE 约束:`加工厂资料.加工厂编号` UNIQUE(测试种子用唯一编号)。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `src/ErpApi/Data/Entities/加工厂资料.cs` | 加 传真 映射 | 改 |
| `src/ErpApi/Features/Materials/FactoryMaster/FactoryMasterDtos.cs` | DTOs | 新建 |
| `src/ErpApi/Features/Materials/FactoryMaster/FactoryMasterService.cs` | categories+list | 新建 |
| `src/ErpApi/Features/Materials/FactoryMaster/FactoryMasterController.cs` | /categories+list | 新建 |
| `src/ErpApi/Program.cs`(若需) | 注册 FactoryMasterService | 改 |
| `tests/ErpApi.Tests/FactoryMasterServiceDbTests.cs` | 测试 | 新建 |
| `web/src/api/factoryMaster.ts` / `FactoryMasterPage.tsx` | 前端 | 新建 |
| `web/src/pages/master/MasterRouter.tsx` | 加工厂资料 特例路由 | 改 |

---

## Task 1: 后端 实体传真 + FactoryMaster + 测试

**Files:** Modify `加工厂资料.cs`, (`Program.cs`); Create `FactoryMasterDtos.cs`, `FactoryMasterService.cs`, `FactoryMasterController.cs`, `FactoryMasterServiceDbTests.cs`

- [ ] **Step 1: 实体** `src/ErpApi/Data/Entities/加工厂资料.cs` 在 `[Column("电话")]...电话` 后加 `[Column("传真")] public string? 传真 { get; set; }`。

- [ ] **Step 2: DTOs** Create `FactoryMasterDtos.cs`(`FactoryCategoryNode` + `FactoryRow`·见 spec ①)。namespace 用 `ErpApi.Features.Materials.FactoryMaster`。

- [ ] **Step 3: Service** Create `FactoryMasterService.cs`(克隆 `MaterialMasterService` 结构·换表 加工厂资料/类别列 加工厂类别):`CategoriesAsync()` + `ListAsync(类别?,keyword?,page,size)`(SQL 见 spec ①·返回 `PagedResult<FactoryRow>`;`PagedResult`/`ISqlConnectionFactory` 命名空间照 MaterialMasterService 引用)。

- [ ] **Step 4: Controller** Create `FactoryMasterController.cs`(克隆 `MaterialMasterController`):`[Route("api/factory-master")]`·Menu="加工厂资料"·注入 `FactoryMasterService`+`IPermissionService`·`GET categories`(打开→CategoriesAsync)·`GET`(打开→ListAsync·参数 类别/keyword/page/size)。无脱敏。

- [ ] **Step 5: DI** READ `Program.cs`——若 `MaterialMasterService` 显式 `AddScoped`,照样加 `builder.Services.AddScoped<...FactoryMaster.FactoryMasterService>();`(在 MaterialMasterService 行附近);若扫描则免。

- [ ] **Step 6: 测试** Create `tests/ErpApi.Tests/FactoryMasterServiceDbTests.cs`:
  - 种 加工厂资料 2 行:(加工厂类别 N'类A'·加工厂编号 N'FAC-T1'·加工厂名称 N'厂甲'·传真 N'F1'·联系人 N'张')、(加工厂类别 N'类B'·加工厂编号 N'FAC-T2'·加工厂名称 N'厂乙')。
  - `CategoriesAsync()`:含 类A(数量≥1)、类B(数量≥1)。
  - `ListAsync("类A",null,1,50)`:命中 FAC-T1·传真="F1"·联系人="张"。
  - `ListAsync(null,"厂乙",1,50)`:命中 FAC-T2(keyword 名称)。
  - `ListAsync("类不存在",null,1,50)`:Total 0。
  - 清理 DELETE FAC-T1/FAC-T2。`using Dapper;`·Factory()/ctor 照 `MaterialMasterServiceDbTests` 模板(`new FactoryMasterService(Factory())`)。

- [ ] **Step 7: 跑测试** focused PASS;`dotnet test` 全绿(381→382)。报告总数。

- [ ] **Step 8: Commit**
```powershell
git add src/ErpApi tests/ErpApi.Tests/FactoryMasterServiceDbTests.cs
git commit -m @'
feat(加工厂资料): 实体补传真+FactoryMaster(categories+过滤列表·镜像物料资料)+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 FactoryMasterPage + API + 路由特例

**Files:** Create `web/src/api/factoryMaster.ts`, `web/src/pages/master/FactoryMasterPage.tsx`; Modify `web/src/pages/master/MasterRouter.tsx`

- [ ] **Step 1: API** Create `web/src/api/factoryMaster.ts`:
```typescript
import { api } from "./client";
import type { Paged } from "./master";
export interface FactoryCategoryNode { 类别?: string; 数量: number }
export interface FactoryRow {
  ID: number; 加工厂类别?: string; 加工厂编号?: string; 加工厂名称?: string; 联系人?: string;
  手机?: string; 电话?: string; 传真?: string; 联系地址?: string; 付款方式?: string; 备注?: string;
}
export const factoryMasterApi = {
  categories: () => api.get<FactoryCategoryNode[]>("/factory-master/categories").then(r => r.data),
  list: (类别?: string, keyword?: string, page = 1, size = 50) =>
    api.get<Paged<FactoryRow>>("/factory-master", { params: { 类别, keyword, page, size } }).then(r => r.data),
};
```

- [ ] **Step 2: 页面** Create `web/src/pages/master/FactoryMasterPage.tsx`(克隆 `web/src/pages/materials/MaterialMasterPage.tsx`·去价格/库存相关):
  - MENU="加工厂资料";左 `Tree`(加工厂类别·`factoryMasterApi.categories()`·含「全部」节点 key=ALL);右 `Table`(列 加工厂编号/加工厂名称/加工厂类别/联系人/手机/电话/**传真**/联系地址/付款方式/备注);关键词 Search + 分页;新增/修改弹窗 `Form`(字段 加工厂类别/加工厂编号/加工厂名称/联系人/手机/电话/传真/联系地址/付款方式/备注)+ 删除 Popconfirm,走 `masterApi("factories")`(create/update/remove·import from `../../api/master`);`can(perms,MENU,...)` 守卫;选类别/搜索 → `factoryMasterApi.list(类别,keyword,page,size)`。**去掉 MaterialMasterPage 的 单价/销售价/库存/onlyStock/hidePrice。**

- [ ] **Step 3: 路由特例** 改 `web/src/pages/master/MasterRouter.tsx`:import FactoryMasterPage;在 cfg 查找逻辑前加:
```tsx
  const decoded = menu ? decodeURIComponent(menu) : "";
  if (decoded === "加工厂资料") return <FactoryMasterPage />;
```
(保持其余 cfg 驱动不变;menuTree 加工厂资料 路由 `/master/加工厂资料` 不变。)

- [ ] **Step 4: 测试+构建** `npm --prefix D:\WebpageERP\web run test`(54)+ `run build`(tsc 干净)。

- [ ] **Step 5: Commit**
```powershell
git add web/src/api/factoryMaster.ts web/src/pages/master/FactoryMasterPage.tsx web/src/pages/master/MasterRouter.tsx
git commit -m @'
feat(加工厂资料): 前端左加工厂类别分类树+右表(传真列·新增改删走masterApi)+路由特例

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟** Release 重建(锁先按 PID Stop-Process)+ 起后端(`--contentRoot 输出目录`)。Node:种 加工厂资料 2 行(类A 带传真 FX·类B)→ `GET /api/factory-master/categories` 验类A/类B 计数 → `GET /api/factory-master?类别=类A` 验 传真=FX/联系人 → 清理。Expected: 类别计数 + 类别过滤 + 传真带出。
- [ ] **Step 2: opus 全分支终审** 派 opus 审 `feat-factory-master-tree`:实体传真映射(DB列已存在·无迁移)、FactoryMaster categories(GROUP BY 加工厂类别 COUNT)/list(类别+keyword 过滤·传真列·分页)、Controller 权限/DI、前端左树右表(传真列·CRUD 走 masterApi("factories")·去价格)、MasterRouter 特例不破坏其余 cfg 驱动、测试自洽、其它 master/模块未动。目标 READY。
- [ ] **Step 3: 合并** `git checkout master; git merge --no-ff feat-factory-master-tree -m "...(加工厂资料左分类树+传真)..."; git branch -d feat-factory-master-tree`。
- [ ] **Step 4: worklog + MEMORY** `docs/worklogs/2026-06-29-factory-master-tree.md`;更新记忆。Commit。

---

## 自审清单
- 传真 DB 列已存在→仅实体映射·无迁移·CRUD(MasterCrudController)自动含。
- FactoryMaster 镜像 MaterialMaster(categories GROUP BY 加工厂类别·list 类别/keyword 过滤·传真列)。
- 前端去 MaterialMasterPage 的价格/库存;CRUD 走 masterApi("factories")。
- MasterRouter 仅特例 加工厂资料→FactoryMasterPage·其余 cfg 驱动不变。
- 测试种子用唯一 加工厂编号(UNIQUE 约束)。
