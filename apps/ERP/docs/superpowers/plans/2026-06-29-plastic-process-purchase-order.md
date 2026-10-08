# 塑胶加工采购单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** ⑩发外加工「塑胶加工采购单」——全屏主从录入单据(头+明细+保存+审核纯锁定+列表/打开/删除),按生产单号从 BOM 调入加工清单。塑胶采购单的发外加工版(加工厂头+加工内容带价明细)。

**Architecture:** 新表 塑胶加工采购单+明细;后端 PlasticProcessPurchaseOrderService/Controller(Create/BasisAsync/List/Get/Delete+过账approve·单价脱敏);过账白名单加表;前端全屏主从页(新 FactoryPicker)+ BOM 调入。镜像塑胶采购单(PlasticPurchaseOrder)。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + AntD v6 + Vitest。

---

## 前置约定

- 分支 `feat-plastic-process-purchase-order`;`dotnet`=`C:\Program Files\dotnet\dotnet.exe`,`-c Release`。DB env User scope。提交末尾 Co-Authored-By。
- **冒烟前 `dotnet build -c Release`(锁先按 PID Stop-Process)+ 起后端 `--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`。**
- 完整表结构/SQL/DTO 见 spec `docs/superpowers/specs/2026-06-29-plastic-process-purchase-order-design.md`。
- **审核三件套(P2 教训)**:① `db/28` 头表含 审核日期列 ② `PostableDocuments.cs` 加 `["塑胶加工采购单"]="单号",` ③ 测试验 approve 翻标志+审核日期非空。
- **坑:生产制单.款号 FK→款号总表**(测试种父反序清)。塑胶服务 DI 显式 `AddScoped`(Program.cs 注册)。
- **模板(master·刚建)**:后端 `PlasticPurchaseOrder/`(Service/Controller/Dtos·Create/Basis/List/Get/Delete/approve)、`PlasticPurchaseOrderServiceDbTests`;前端 `PlasticPurchaseOrderPage`/`PlasticPurchaseOrderLineTable`/`api/plasticPurchaseOrder.ts`、`SupplierPicker`(→克隆 FactoryPicker)、`ProductionPicker`/`PlasticMaterialPicker`。
- 数据源:`塑胶共用物料表`(塑胶货号/工模编号/物料编号/物料名称/用料名称/颜色/加工内容/加工单价)、`生产制单货号`(生产单号/货号)、`生产制单`(生产单号/款号)。`masterApi("factories")`(加工厂资料 list)。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `db/28_plastic_process_purchase_order.sql` | 2 新表 | 新建 |
| `src/ErpApi/Features/Plastics/PlasticProcessPurchaseOrder/PlasticProcessPurchaseOrderDtos.cs` | DTOs | 新建 |
| `.../PlasticProcessPurchaseOrderService.cs` | Create/Basis/List/Get/Delete | 新建 |
| `.../PlasticProcessPurchaseOrderController.cs` | REST+approve·单价脱敏 | 新建 |
| `src/ErpApi/Engines/Posting/PostableDocuments.cs` | 加白名单 | 改 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加菜单 | 改 |
| `src/ErpApi/Program.cs` | 注册 Service | 改 |
| `db/seed_plastic_process_purchase_order_perms.sql` | admin 授权 | 新建 |
| `tests/ErpApi.Tests/PlasticProcessPurchaseOrderServiceDbTests.cs` | 测试 | 新建 |
| `web/src/pages/plastics/FactoryPicker.tsx` | 加工厂选择器 | 新建 |
| `web/src/api/plasticProcessPurchaseOrder.ts` / `PlasticProcessPurchaseOrderLineTable.tsx` / `PlasticProcessPurchaseOrderPage.tsx` | 前端 | 新建 |
| `web/src/App.tsx` / `web/src/nav/menuTree.tsx` | 路由+菜单 | 改 |

---

## Task 1: 后端 表 + Service + Controller + 白名单 + 菜单 + 种子 + 测试

**Files:** Create `db/28_plastic_process_purchase_order.sql`, `PlasticProcessPurchaseOrderDtos.cs`, `PlasticProcessPurchaseOrderService.cs`, `PlasticProcessPurchaseOrderController.cs`, `db/seed_plastic_process_purchase_order_perms.sql`, `PlasticProcessPurchaseOrderServiceDbTests.cs`; Modify `PostableDocuments.cs`, `MenuCatalog.cs`, `Program.cs`

- [ ] **Step 1: DB** Create `db/28_plastic_process_purchase_order.sql`(2 表·见 spec 数据源段)。应用两库。Expected: `ERP_DB ok`/`ERP_TEST_DB ok`。

- [ ] **Step 2: DTOs** Create `PlasticProcessPurchaseOrderDtos.cs`(Header/Line/Detail/CreateLine/Create/BasisRow·见 spec ①)。

- [ ] **Step 3: Service** Create `PlasticProcessPurchaseOrderService.cs`——READ `PlasticPurchaseOrderService.cs` 作模板。`DocType="塑胶加工采购单"; Prefix="SJ";` + `BasisAsync`(spec SQL·带 加工内容/加工单价 AS 单价)+ `CreateAsync`(数量合计=SUM·金额合计=SUM(数量×单价)·明细金额=数量×(单价??0)·审核'0')+ `ListAsync`(单号/加工厂名称/客户名称 LIKE)+ `GetAsync` + `DeleteAsync`(已审核抛 InvalidOperationException)。

- [ ] **Step 4: Controller** Create `PlasticProcessPurchaseOrderController.cs`——克隆 `PlasticPurchaseOrderController`(`[Route("api/plastic-process-purchase-orders")]`·Menu/Table="塑胶加工采购单"·注入 Service+`IPostingEngine`+`IPermissionService`):`GET`(list·**无单价权限 foreach h.金额=null**)、`GET basis`、`GET {单号}`(**无单价权限 单头金额=null·明细单价=null/金额=null**)、`POST`、`DELETE {单号}`、`POST {单号}/approve`(`posting.ApproveAsync("塑胶加工采购单",单号,user)`)、`POST {单号}/unapprove`。私有 `CanPrice()=perms.HasAsync(user,Menu,单价)`。

- [ ] **Step 5: 过账白名单** `PostableDocuments.cs` 加 `["塑胶加工采购单"] = "单号",`。

- [ ] **Step 6: DI** `Program.cs` 加 `builder.Services.AddScoped<...PlasticProcessPurchaseOrder.PlasticProcessPurchaseOrderService>();`(照 PlasticPurchaseOrderService 行)。

- [ ] **Step 7: 菜单 + 种子** `MenuCatalog.cs` 加 `new("发外加工","塑胶加工采购单"),`;Create `db/seed_plastic_process_purchase_order_perms.sql`(菜单 塑胶加工采购单)·应用两库。

- [ ] **Step 8: 测试** Create `tests/ErpApi.Tests/PlasticProcessPurchaseOrderServiceDbTests.cs`(参照 `PlasticPurchaseOrderServiceDbTests`):
  - 种 款号总表(K-PJ 父)→生产制单(PJ-MO·款号 K-PJ)→生产制单货号(PJ-MO→货号 H-PJ)→塑胶共用物料表(塑胶货号 H-PJ·物料 PJPM·工模编号 GM-PJ·加工内容 喷油·加工单价 3·用料名称 用A·颜色 黑)。
  - `BasisAsync("PJ-MO")` 验 1 行:模具编号=GM-PJ/加工内容=喷油/单价=3/款号=K-PJ。
  - `CreateAsync`(dto 加工厂/客户/2 明细[物料 PJPM·加工内容 喷油·数量 5,3·单价 3])→ 单号 SJ 前缀 → `GetAsync` 头数量=8/金额=24·明细 2 行回读(金额=15/9)。
  - `ApproveAsync`(`IPostingEngine.ApproveAsync("塑胶加工采购单",单号,"tester")` 同入仓审核测试实例化 `new PostingEngine(Factory(), new AuditLogger())`)→ Get 审核='1' 且 审核日期非空。
  - `DeleteAsync` 审核后抛。
  - 清理(反 FK 序)。`using Dapper;`。

- [ ] **Step 9: 跑测试** focused PASS;`dotnet test` 全绿(386→约389)。报告总数。

- [ ] **Step 10: Commit**
```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticProcessPurchaseOrderServiceDbTests.cs db/28_plastic_process_purchase_order.sql db/seed_plastic_process_purchase_order_perms.sql
git commit -m @'
feat(塑胶加工采购单): 新表+Service(Create/Basis加工BOM调入/List/Get/Delete)+Controller(审核纯锁定·单价脱敏·过账白名单)+菜单+种子+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 FactoryPicker + 全屏主从录入页 + 明细行 + API + 路由

**Files:** Create `web/src/pages/plastics/FactoryPicker.tsx`, `web/src/api/plasticProcessPurchaseOrder.ts`, `web/src/pages/plastics/PlasticProcessPurchaseOrderLineTable.tsx`, `web/src/pages/plastics/PlasticProcessPurchaseOrderPage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: FactoryPicker** Create `FactoryPicker.tsx`(克隆 `web/src/pages/plastics/SupplierPicker.tsx`):`masterApi("factories").list(1,200,keyword)`·`FactoryRow{加工厂编号?,加工厂名称?}`·列 加工厂编号/加工厂名称·onPick 返回行·标题"选择加工厂"。

- [ ] **Step 2: API** Create `web/src/api/plasticProcessPurchaseOrder.ts`:Header/Line/Detail/Basis 接口 + `plasticProcessPurchaseOrderApi`(list/basis(生产单号)/get/create/remove/approve/unapprove·端点 `/plastic-process-purchase-orders`)。

- [ ] **Step 3: 明细行** Create `PlasticProcessPurchaseOrderLineTable.tsx`(克隆 `PlasticPurchaseOrderLineTable`·改列):生产单号(🔍ProductionPicker)|款号|模具编号|物料编号(🔍PlasticMaterialPicker 带出名称/颜色)|物料名称(只读)|用料名称|颜色|加工内容|数量(InputNumber)|单价(InputNumber·`hidePrice` 隐藏)|金额(=数量×单价·`hidePrice` 隐藏)|备注|删除。

- [ ] **Step 4: 录入页** Create `PlasticProcessPurchaseOrderPage.tsx`(克隆 `PlasticPurchaseOrderPage`·去右侧合并·加 hidePrice):头 加工厂(FactoryPicker·hidden 加工厂编号)/日期(只读 today)/交货日期(DatePicker)/客户名称(Input)/收货仓库(Input)/收货人(Input)/操作员(只读)/备注;调入加工清单(ProductionPicker→`basis`→setLines·数量默认0·单价从 basis 带)+ 左 `PlasticProcessPurchaseOrderLineTable` + 底部 数量合计/金额合计(`!priceHidden` 才显金额)+ 历史列表(openDoc/审核/反审核/删除)。MENU="塑胶加工采购单"·`priceHidden=hidePrice(perms,MENU)`·`can` 守卫。保存校验≥1 行(物料编号+数量>0)。

- [ ] **Step 5: 路由+菜单** `App.tsx` 加 import + `<Route path="plastic-process-purchase-orders" element={<PlasticProcessPurchaseOrderPage />} />`;`menuTree.tsx` ⑩ 占位 `M("塑胶加工采购单")` → 带路由。

- [ ] **Step 6: 测试+构建** `npm --prefix D:\WebpageERP\web run test`(54)+ `run build`(tsc 干净)。

- [ ] **Step 7: Commit**
```powershell
git add web/src/pages/plastics/FactoryPicker.tsx web/src/api/plasticProcessPurchaseOrder.ts web/src/pages/plastics/PlasticProcessPurchaseOrderLineTable.tsx web/src/pages/plastics/PlasticProcessPurchaseOrderPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(塑胶加工采购单): 前端全屏主从录入页(FactoryPicker+加工BOM调入+加工内容带价·单价脱敏+审核)+明细行+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟** Release 重建(锁先按 PID Stop-Process)+ 起后端(`--contentRoot 输出目录`)。Node:种链(款号总表 K-PJS→生产制单 PJS-MO→生产制单货号 H-PJS→共用物料表 物料 PJSMK 加工内容 喷油 加工单价3 工模 GM-PJS)→ `GET /api/plastic-process-purchase-orders/basis?生产单号=PJS-MO` 带出 模具编号/加工内容/单价3 → `POST /api/plastic-process-purchase-orders`(加工厂/客户/明细 物料 PJSMK 数量5+3 单价3)→ 单号 SJ… → `GET /{单号}` 头数量8/金额24/明细2 → `POST /{单号}/approve` → Get 审核='1'。清理(反 FK 序)。Expected: BOM 调入带出加工内容/单价、保存回读、审核翻标志。
- [ ] **Step 2: opus 全分支终审** 派 opus 审 `feat-plastic-process-purchase-order`:新表/DTO/Service(BasisAsync 带加工内容/加工单价·CreateAsync 金额=数量×单价/SJ单号·Delete 拦)、**审核三件套(PostableDocuments+审核日期+approve 不动库存)**、**单价/金额脱敏(list/get·明细+头金额)**、Controller/DI、前端全屏主从(FactoryPicker+加工BOM调入+加工内容带价+审核)、测试自洽(款号总表 FK+审核日期)、库存/其它模块未动。目标 READY。
- [ ] **Step 3: 合并** `git checkout master; git merge --no-ff feat-plastic-process-purchase-order -m "...(塑胶加工采购单·⑩占位落地)..."; git branch -d feat-plastic-process-purchase-order`。
- [ ] **Step 4: worklog + MEMORY** `docs/worklogs/2026-06-29-plastic-process-purchase-order.md`;更新记忆。Commit。

---

## 自审清单
- 审核三件套(白名单+审核日期列+测试)·纯锁定不动库存。
- BasisAsync 带 加工内容/加工单价(单价)·CreateAsync 金额=数量×单价。
- **单价/金额脱敏**(此单带价·明细单价/金额+头金额)。
- 新 FactoryPicker(masterApi("factories"))。
- 款号总表 FK 父行先种反序清·DI 显式 AddScoped。
- 镜像塑胶采购单 head+detail+审核+BOM调入。
