# 塑胶加工订单制作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** ⑩发外加工「塑胶加工订单制作」——只读单表平铺(已审核 BOM·调整审核='1'),按生产单展开。**塑胶订单制作的克隆**,加 色粉号/加工内容 列。

**Architecture:** 扩 PlasticMaterialDocService 加 ProcessOrderMakeListAsync(克隆 OrderMakeListAsync + 色粉号/加工内容);新 PlasticProcessOrderMakeController。前端单 Tab 平铺页。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + AntD v6 + Vitest。

---

## 前置约定

- 分支 `feat-plastic-process-order-make`;`dotnet`=`C:\Program Files\dotnet\dotnet.exe`,`-c Release`。DB env User scope。提交末尾 Co-Authored-By。
- **冒烟前 `dotnet build -c Release`(锁先按 PID Stop-Process)+ 起后端 `--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`。**
- 完整 SQL/DTO 见 spec `docs/superpowers/specs/2026-06-29-plastic-process-order-make-design.md`(① 后端段)。
- **模板(master·刚建)**:后端 `PlasticMaterialDocService.OrderMakeListAsync` + `PlasticOrderMakeController`(api/plastic-order-make)+ `PlasticOrderMakeServiceDbTests`;前端 `PlasticOrderMakePage` + `api/plasticOrderMake.ts`。**逐项克隆,加 色粉号/加工内容 列、改 Process 命名/端点/菜单。**
- 数据源:`生产制单货号`/`塑胶共用物料表`(色粉号/加工内容/调整审核)/`生产制单`(款号 FK→款号总表)/`塑胶物料资料`(单位)。
- 服务 ctor `PlasticMaterialDocService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)`。MenuCatalog 组"发外加工"已核实。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocDtos.cs` | 加 ProcessOrderMakeRow | 改 |
| `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocService.cs` | 加 ProcessOrderMakeListAsync | 改 |
| `src/ErpApi/Features/Plastics/PlasticProcessOrderMake/PlasticProcessOrderMakeController.cs` | GET·脱敏 | 新建 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加菜单 塑胶加工订单制作 | 改 |
| `db/seed_plastic_process_order_make_perms.sql` | admin 授权 | 新建 |
| `tests/ErpApi.Tests/PlasticProcessOrderMakeServiceDbTests.cs` | 测试 | 新建 |
| `web/src/api/plasticProcessOrderMake.ts` / `PlasticProcessOrderMakePage.tsx` | 前端 | 新建 |
| `web/src/App.tsx` / `web/src/nav/menuTree.tsx` | 路由+菜单 | 改 |

---

## Task 1: 后端 ProcessOrderMakeListAsync + Controller + 菜单 + 种子 + 测试

**Files:** Modify `PlasticMaterialDocDtos.cs`, `PlasticMaterialDocService.cs`, `MenuCatalog.cs`; Create `PlasticProcessOrderMakeController.cs`, `db/seed_plastic_process_order_make_perms.sql`, `PlasticProcessOrderMakeServiceDbTests.cs`

- [ ] **Step 1: DTO** 在 `PlasticMaterialDocDtos.cs` 末尾加 `PlasticProcessOrderMakeRow`(17 字段·见 spec ① DTO 原文·= PlasticOrderMakeRow + 色粉号 + 加工内容)。

- [ ] **Step 2: Service** 在 `PlasticMaterialDocService` 加 `ProcessOrderMakeListAsync(起,止,keyword?)`——SQL **照抄 spec ① 后端段**(= OrderMakeListAsync SQL + SELECT 加 `p.[色粉号], p.[加工内容]`·调整审核='1'·订购数量=用量×计划数量·金额=订购×加工单价)。

- [ ] **Step 3: Controller** Create `src/ErpApi/Features/Plastics/PlasticProcessOrderMake/PlasticProcessOrderMakeController.cs`(克隆 `PlasticOrderMakeController`):`[Route("api/plastic-process-order-make")]`·Menu="塑胶加工订单制作"·`GET ?起=&止=&keyword=`·无单价权限置 加工单价/金额 null·Ok。

- [ ] **Step 4: 菜单** `MenuCatalog.cs` 在 `new("发外加工","发外加工"),` 附近(发外加工组)加 `new("发外加工","塑胶加工订单制作"),`。

- [ ] **Step 5: 种子** Create `db/seed_plastic_process_order_make_perms.sql`(克隆 `db/seed_plastic_order_make_perms.sql` 改菜单 塑胶加工订单制作)·应用两库。

- [ ] **Step 6: 测试** Create `tests/ErpApi.Tests/PlasticProcessOrderMakeServiceDbTests.cs`(克隆 `PlasticOrderMakeServiceDbTests`·加 色粉号/加工内容 断言):种 款号总表(K-PRO 父)→生产制单(PRO-MO·款号 K-PRO·日期 2026-06-10·计划数量 100)→生产制单货号(PRO-MO→货号 H-PRO)→塑胶共用物料表 2 行(塑胶货号 H-PRO·物料 PROPM·用量 2·加工单价 3·**色粉号 C1·加工内容 喷油·调整审核 '1'**;第二行 PROPM2·调整审核 '0')→塑胶物料资料(PROPM·单位 kg)。断言 `ProcessOrderMakeListAsync(2026-06-01..30,"PROPM")` → 仅 1 行·订购数量=200·金额=600·**色粉号=C1·加工内容=喷油**·款号=K-PRO·单位=kg;区间外空·keyword 无关空·调整审核0被滤。清理(反 FK 序)。`using Dapper;`·ctor `new(Factory(), new DocumentNumberGenerator())`。

- [ ] **Step 7: 跑测试** focused PASS;`dotnet test` 全绿(+1)。报告总数。

- [ ] **Step 8: Commit**
```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticProcessOrderMakeServiceDbTests.cs db/seed_plastic_process_order_make_perms.sql
git commit -m @'
feat(塑胶加工订单制作): ProcessOrderMakeList(克隆塑胶订单制作+色粉号/加工内容·脱敏)+Controller+菜单+种子+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 单Tab平铺页 + API + 路由

**Files:** Create `web/src/api/plasticProcessOrderMake.ts`, `web/src/pages/plastics/PlasticProcessOrderMakePage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: API** Create `web/src/api/plasticProcessOrderMake.ts`(克隆 `plasticOrderMake.ts`·接口加 色粉号?/加工内容?·端点 `/plastic-process-order-make`·导出 `plasticProcessOrderMakeApi`)。

- [ ] **Step 2: 页面** Create `web/src/pages/plastics/PlasticProcessOrderMakePage.tsx`(克隆 `PlasticOrderMakePage`):MENU="塑胶加工订单制作"·API=plasticProcessOrderMakeApi·列在 颜色 后加 色粉号/加工内容(其余 单据日期/生产单号/款号/塑胶货号/工模编号/物料编号/物料名称/颜色/用料名称/单位/用量/计划数量/订购数量/(加工单价/金额 priceHidden)不变)。`hidePrice(perms,"塑胶加工订单制作")`。

- [ ] **Step 3: 路由+菜单** `App.tsx` 加 import + `<Route path="plastic-process-order-make" element={<PlasticProcessOrderMakePage />} />`;`menuTree.tsx` ⑩ 发外加工(group `g-outsource`)占位 `M("塑胶加工订单制作")` → `M("塑胶加工订单制作","/plastic-process-order-make","塑胶加工订单制作")`。

- [ ] **Step 4: 测试+构建** `npm --prefix D:\WebpageERP\web run test`(54)+ `run build`(tsc 干净)。

- [ ] **Step 5: Commit**
```powershell
git add web/src/api/plasticProcessOrderMake.ts web/src/pages/plastics/PlasticProcessOrderMakePage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(塑胶加工订单制作): 前端单Tab BOM平铺页(克隆塑胶订单制作+色粉号/加工内容·脱敏)+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟** Release 重建(锁先按 PID Stop-Process)+ 起后端(`--contentRoot 输出目录`)。Node:种链(款号总表 K-PROS→生产制单 PROS-MO 计划100→生产制单货号 H-PROS→共用物料表 物料 PROSMK 用量2 加工单价3 色粉号 C1 加工内容 喷油 调整审核'1')→ `GET /api/plastic-process-order-make?起=&止=&keyword=PROSMK` 验 订购200/金额600/**色粉号 C1/加工内容 喷油**/款号 K-PROS;调整审核'0'行不出。清理(反序)。
- [ ] **Step 2: opus 全分支终审** 派 opus 审 `feat-plastic-process-order-make`:JOIN(生产制单货号→共用物料表[BOM 1:N·调整审核='1']→生产制单→物料资料)、订购数量=用量×计划数量、金额=订购×加工单价、**色粉号/加工内容带出**、脱敏(加工单价+金额)、菜单(发外加工组)/权限/DI、前端单表+色粉号/加工内容列+导出、测试自洽(含款号总表 FK 父行+调整审核0过滤)、塑胶订单制作(⑦)模板未动。目标 READY。
- [ ] **Step 3: 合并** `git checkout master; git merge --no-ff feat-plastic-process-order-make -m "...(塑胶加工订单制作)..."; git branch -d feat-plastic-process-order-make`。
- [ ] **Step 4: worklog + MEMORY** `docs/worklogs/2026-06-29-plastic-process-order-make.md`;更新记忆。Commit。

---

## 自审清单
- = 塑胶订单制作 克隆 + 色粉号/加工内容·调整审核='1'·订购数量=用量×计划数量·金额=订购×加工单价。
- 脱敏 加工单价+金额。菜单组"发外加工"。
- 款号总表 FK 父行先种反序清·调整审核0 验证被过滤。
- ⑦塑胶订单制作 OrderMakeListAsync 不动(新增并行方法)。
