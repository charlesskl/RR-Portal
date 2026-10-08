# 塑胶采购单(塑胶采购订单)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** ⑦塑胶采购「塑胶采购订单」落地——全屏主从录入单据(头+左明细+保存+审核纯锁定+列表/打开/删除),按生产单号从 BOM 调入明细,右侧只读合并汇总。

**Architecture:** 新表 塑胶采购订单+明细;后端 PlasticPurchaseOrderService/Controller(CreateAsync/BasisAsync/List/Get/Delete + 过账引擎 approve);过账白名单加表;前端全屏主从页 + BOM 调入 + 右侧合并。镜像塑胶物料单(P2)+ 塑胶单据录入页。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + AntD v6 + Vitest。

---

## 前置约定

- 分支 `feat-plastic-purchase-order`;`dotnet`=`C:\Program Files\dotnet\dotnet.exe`,`-c Release`。DB env User scope。提交末尾 Co-Authored-By。
- **冒烟前 `dotnet build -c Release`(锁先 Stop-Process·按 PID)+ 起后端 `--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`。**
- 完整表结构/SQL/DTO 见 spec `docs/superpowers/specs/2026-06-29-plastic-purchase-order-design.md`。
- **审核三件套(P2 教训前置)**:① `db/27` 头表含 审核日期列 ② `src/ErpApi/Engines/Posting/PostableDocuments.cs` 加 `["塑胶采购订单"]="单号",`(现有 `["塑胶物料单"]="单号"` 同款)③ 回归测试验 approve 翻标志+审核日期非空。
- **坑:生产制单.款号 FK→款号总表**,测试/冒烟种 生产制单 须先种 款号总表 父行,反序清。
- 数据源:`塑胶共用物料表`(塑胶货号/工模编号/物料编号/物料名称/颜色/色粉号/用料名称/用量/套数)、`生产制单货号`(生产单号/货号)、`生产制单`(生产单号/款号)。
- 镜像源:后端 `PlasticReceiptService`(Create/List/Get/Delete + Controller approve/unapprove 骨架)、`PlasticMaterialDocService.BasisAsync`(BOM 带料);过账 `PlasticReceiptController` 用 `IPostingEngine`。前端 `PlasticReceiptFormPage`(全屏主从头+列表+CRUD)、`PlasticSupplierDocLineTable`/`PlasticReceiptLineTable`(可编辑行)、`SupplierPicker`/`ProductionPicker`/`PlasticMaterialPicker`。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `db/27_plastic_purchase_order.sql` | 2 新表 | 新建 |
| `src/ErpApi/Features/Plastics/PlasticPurchaseOrder/PlasticPurchaseOrderDtos.cs` | DTOs | 新建 |
| `src/ErpApi/Features/Plastics/PlasticPurchaseOrder/PlasticPurchaseOrderService.cs` | Create/Basis/List/Get/Delete | 新建 |
| `src/ErpApi/Features/Plastics/PlasticPurchaseOrder/PlasticPurchaseOrderController.cs` | REST + approve | 新建 |
| `src/ErpApi/Engines/Posting/PostableDocuments.cs` | 加白名单 | 改 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加菜单 | 改 |
| `src/ErpApi/Program.cs`(若需 DI 注册) | 注册 Service | 改(按现有塑胶服务注册方式) |
| `db/seed_plastic_purchase_order_perms.sql` | admin 授权 | 新建 |
| `tests/ErpApi.Tests/PlasticPurchaseOrderServiceDbTests.cs` | 测试 | 新建 |
| `web/src/api/plasticPurchaseOrder.ts` / `PlasticPurchaseOrderLineTable.tsx` / `PlasticPurchaseOrderPage.tsx` | 前端 | 新建 |
| `web/src/App.tsx` / `web/src/nav/menuTree.tsx` | 路由+菜单 | 改 |

---

## Task 1: 后端 表 + Service + Controller + 白名单 + 菜单 + 种子 + 测试

**Files:** Create `db/27_plastic_purchase_order.sql`, `PlasticPurchaseOrderDtos.cs`, `PlasticPurchaseOrderService.cs`, `PlasticPurchaseOrderController.cs`, `db/seed_plastic_purchase_order_perms.sql`, `PlasticPurchaseOrderServiceDbTests.cs`; Modify `PostableDocuments.cs`, `MenuCatalog.cs`, (`Program.cs` if needed)

- [ ] **Step 1: DB** Create `db/27_plastic_purchase_order.sql`(2 表·见 spec 数据源段原文)。应用两库(PowerShell foreach·`[IO.File]::ReadAllText`)。Expected: `ERP_DB ok`/`ERP_TEST_DB ok`。

- [ ] **Step 2: DTOs** Create `PlasticPurchaseOrderDtos.cs`(Header/Line/Detail/CreateLine/Create/BasisRow·见 spec ①)。

- [ ] **Step 3: Service** Create `PlasticPurchaseOrderService.cs`——READ `PlasticReceiptService.cs`(Create/List/Get/Delete 骨架)+ `PlasticMaterialDocService.BasisAsync`(BOM SQL)作模板。实现 `const DocType="塑胶采购订单"; const Prefix="SP";` + `BasisAsync`(spec SQL)+ `CreateAsync`(数量合计=SUM·SP单号·插头+明细·审核'0')+ `ListAsync` + `GetAsync` + `DeleteAsync`(已审核抛 InvalidOperationException)。`factory`/`docNo` 字段同 PlasticReceiptService。

- [ ] **Step 4: Controller** Create `PlasticPurchaseOrderController.cs`——克隆 `PlasticReceiptController` 骨架(`[Route("api/plastic-purchase-orders")]`·Menu="塑胶采购订单"·注入 `PlasticPurchaseOrderService`+`IPostingEngine posting`+`IPermissionService perms`):`GET`(List·打开)、`GET basis`(打开·`svc.BasisAsync(生产单号)`)、`GET {单号}`(打开)、`POST`(保存)、`DELETE {单号}`(删除·Conflict 捕 InvalidOperationException)、`POST {单号}/approve`(审核·`posting.ApproveAsync("塑胶采购订单",单号,user)`)、`POST {单号}/unapprove`。**无脱敏**(采购单无价)。Table 常量="塑胶采购订单"。

- [ ] **Step 5: 过账白名单** `src/ErpApi/Engines/Posting/PostableDocuments.cs` 在 `["塑胶物料单"] = "单号",` 附近加 `["塑胶采购订单"] = "单号",`。

- [ ] **Step 6: DI** 若 `PlasticReceiptService` 等在 `Program.cs` 显式注册(`AddScoped`),照样注册 `PlasticPurchaseOrderService`;若塑胶服务靠程序集扫描则免改。READ `Program.cs` 确认现有塑胶服务注册方式并对齐。

- [ ] **Step 7: 菜单 + 种子** `MenuCatalog.cs` 在 `new("塑胶采购","塑胶订单制作"),` 后加 `new("塑胶采购","塑胶采购订单"),`;Create `db/seed_plastic_purchase_order_perms.sql`(克隆 order-make 种子改菜单 塑胶采购订单)·应用两库。

- [ ] **Step 8: 测试** Create `tests/ErpApi.Tests/PlasticPurchaseOrderServiceDbTests.cs`(参照 `PlasticReceiptProcessingColsDbTests` + `PlasticOrderMakeServiceDbTests`):
  - 种 款号总表(K-PO 父)→生产制单(PO-MO·款号 K-PO)→生产制单货号(PO-MO→货号 H-PO)→塑胶共用物料表(塑胶货号 H-PO·物料 POPM·工模编号 GM-PO·用量2·套数3·颜色黑·色粉号 C1·用料名称 用A)→物料资料(POPM)。
  - `BasisAsync("PO-MO")` 验 1 行:模具编号=GM-PO/套数=3/色粉号=C1/款号=K-PO/物料名称。
  - `CreateAsync`(dto 供应商/客户/2 明细[物料 POPM·数量 5,3])→ 单号 SP 前缀 → `GetAsync` 头数量合计=8·明细 2 行回读一致。
  - `ApproveAsync`(用 `new PostingEngine(...)` 或经 service?——用过账引擎:种子已建表+白名单已加;直接 `IPostingEngine.ApproveAsync("塑胶采购订单",单号,"tester")`,然后 Get 验 审核='1' 且 审核日期非空)。**PostingEngine 构造按其现有 ctor**(读 `PostingEngine.cs` + 现有过账测试如塑胶入仓审核测试)。
  - `DeleteAsync` 审核后抛 InvalidOperationException。
  - 清理(反 FK 序:采购订单明细/头·共用物料表·物料资料·生产制单货号·生产制单·款号总表)。`using Dapper;`。
  - **注**:若过账引擎实例化依赖多,审核用例可改为经 Controller 集成测试或最小化——优先用现有"塑胶入仓单 approve"测试的同款实例化方式(READ 它)。

- [ ] **Step 9: 跑测试** focused PASS;`dotnet test` 全绿(377→约380)。报告总数。

- [ ] **Step 10: Commit**
```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticPurchaseOrderServiceDbTests.cs db/27_plastic_purchase_order.sql db/seed_plastic_purchase_order_perms.sql
git commit -m @'
feat(塑胶采购单): 新表+Service(Create/Basis BOM调入/List/Get/Delete)+Controller(审核纯锁定·过账白名单)+菜单+种子+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 全屏主从录入页 + 明细行 + 右侧合并 + API + 路由

**Files:** Create `web/src/api/plasticPurchaseOrder.ts`, `web/src/pages/plastics/PlasticPurchaseOrderLineTable.tsx`, `web/src/pages/plastics/PlasticPurchaseOrderPage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: API** Create `web/src/api/plasticPurchaseOrder.ts`:Header/Line/Detail/Basis 接口 + `plasticPurchaseOrderApi`:`list(page,size,kw)`/`basis(生产单号)`/`get(单号)`/`create(body)`/`remove(单号)`/`approve(单号)`/`unapprove(单号)`(端点 `/plastic-purchase-orders`·`/basis`·`/{单号}`·`/{单号}/approve`·`/{单号}/unapprove`)。

- [ ] **Step 2: 明细行** Create `PlasticPurchaseOrderLineTable.tsx`(克隆 `PlasticReceiptLineTable` 改列):列序 生产单号(🔍ProductionPicker)|款号|物料编号(🔍PlasticMaterialPicker 带出名称/颜色)|物料名称(只读)|模具编号|用量|套数|数量(InputNumber)|颜色|色粉号|用料名称|备注|删除。`readOnly` 查看态禁用。无价格列。

- [ ] **Step 3: 录入页** Create `PlasticPurchaseOrderPage.tsx`(克隆 `PlasticReceiptFormPage` 全屏主从结构):
  - 头 Form:供应商名称(只读+🔍SupplierPicker·hidden 供应商编号)/日期(只读 today)/交货日期(`DatePicker`)/客户名称/交货地点/编号/操作员(只读 currentUser)/备注。
  - 工具栏 extra:新建(reset)/保存/**调入清单**(开 ProductionPicker)/打印(window.print)。
  - 调入清单:ProductionPicker onPick(row) → `plasticPurchaseOrderApi.basis(row.生产单号)` → setLines(BOM 行·数量默认 0)。
  - 左 `PlasticPurchaseOrderLineTable` value=lines。
  - **右侧只读合并** Table:`useMemo` 按 物料编号 GROUP 求 SUM(数量)→ 行 {序号(index+1)/物料编号/物料名称/数量合计};放在左表右侧(Row/Col 布局 或 左右两 Table)。
  - 底部 `Statistic 数量合计`=Σ数量。
  - 保存:validateFields + 至少一行(物料编号+数量>0)→ `create({...v,明细:ok})` → reset+loadRows。
  - 历史列表 Table(rows=list):单号 a 点 openDoc(GET 回填 readOnly)·列 单号/供应商名称/客户名称/数量/日期/状态(审核 Tag)/操作(can 审核→approve·can 反审核→unapprove·can 删除→Popconfirm remove)。
  - 守卫 `can(perms,"塑胶采购订单","打开")`。
- 弹窗:SupplierPicker、ProductionPicker、(明细内)PlasticMaterialPicker。

- [ ] **Step 4: 路由+菜单** `App.tsx` 加 import + `<Route path="plastic-purchase-orders" element={<PlasticPurchaseOrderPage />} />`;`menuTree.tsx` ⑦ 占位 `M("塑胶采购订单")` → `M("塑胶采购订单","/plastic-purchase-orders","塑胶采购订单")`。

- [ ] **Step 5: 测试+构建** `npm --prefix D:\WebpageERP\web run test`(54)+ `run build`(tsc 干净)。

- [ ] **Step 6: Commit**
```powershell
git add web/src/api/plasticPurchaseOrder.ts web/src/pages/plastics/PlasticPurchaseOrderLineTable.tsx web/src/pages/plastics/PlasticPurchaseOrderPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(塑胶采购单): 前端全屏主从录入页(BOM调入+右侧只读合并+审核)+明细行+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟** Release 重建(锁先 Stop-Process 按 PID)+ 起后端(`--contentRoot 输出目录`)。Node:种链(款号总表 K-POS→生产制单 POS-MO→生产制单货号 H-POS→共用物料表 物料 POSMK 工模 GM-POS 用量2 套数3 色粉 C1)→ `GET /api/plastic-purchase-orders/basis?生产单号=POS-MO` 验带出 模具编号/套数/色粉号/款号 → `POST /api/plastic-purchase-orders`(供应商/客户/明细 物料 POSMK 数量5+3)→ 单号 SP… → `GET /{单号}` 头数量8/明细2 → `POST /{单号}/approve` → `GET` 审核='1'·审核日期非空。清理(反 FK 序)。Expected: BOM 调入带出、保存回读、审核翻标志+审核日期。
- [ ] **Step 2: opus 全分支终审** 派 opus 审 `feat-plastic-purchase-order`:新表/DTO/Service(BasisAsync BOM 口径同 PlasticMaterialDocService·CreateAsync 数量合计/SP 单号·Delete 已审核拦截)、**审核三件套(PostableDocuments 白名单+审核日期列+approve 翻标志不动库存·无库存引擎读此单)**、Controller 权限/动作、DI 注册、前端全屏主从(BOM 调入+右侧 useMemo 合并+审核/反审核/删除)、测试自洽(含款号总表 FK 父行+审核日期断言)、库存/其它模块未动。目标 READY。
- [ ] **Step 3: 合并** `git checkout master; git merge --no-ff feat-plastic-purchase-order -m "...(塑胶采购单·⑦占位落地)..."; git branch -d feat-plastic-purchase-order`。
- [ ] **Step 4: worklog + MEMORY** `docs/worklogs/2026-06-29-plastic-purchase-order.md`;更新记忆(塑胶采购订单 done)。Commit。

---

## 自审清单
- 审核三件套(白名单+审核日期列+测试)前置·纯锁定不动库存。
- BasisAsync BOM 口径=`塑胶共用物料表 JOIN 生产制单货号 ON 货号=塑胶货号`+生产制单款号(模具编号=工模编号)。
- 数量列用户录(BOM 调入带 用量/套数·数量默认 0)。
- 右侧合并=前端 useMemo 按物料编号 SUM(标签三列省略)。
- 款号总表 FK 父行先种反序清。
- 镜像塑胶物料单 head+detail+审核;前端镜像 PlasticReceiptFormPage 全屏主从。
