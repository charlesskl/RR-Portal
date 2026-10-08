# 加工采购查询 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** ⑩发外加工「加工采购查询」——只读两 Tab(汇总按模具+物料+颜色+加工内容 / 明细)over 塑胶加工采购单/明细 + 明细双击只读抽屉。带价脱敏。

**Architecture:** 扩 PlasticProcessPurchaseOrderService 加 QueryDetail/Summary + ApprovalFilter;新 PlasticProcessPurchaseQueryController。前端两 Tab 页 + 新只读抽屉。镜像塑胶单据查询(PlasticReceiptQuery)。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + AntD v6 + Vitest。

---

## 前置约定

- 分支 `feat-plastic-process-purchase-query`;`dotnet`=`C:\Program Files\dotnet\dotnet.exe`,`-c Release`。DB env User scope。提交末尾 Co-Authored-By。
- **冒烟前 `dotnet build -c Release`(锁先按 PID Stop-Process)+ 起后端 `--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`。**
- 完整 SQL/DTO 见 spec `docs/superpowers/specs/2026-06-29-plastic-process-purchase-query-design.md`(① 后端段)。
- **模板(master)**:`PlasticReceiptQuery`(Controller/两 Tab 脱敏/ApprovalFilter)+ `PlasticReceiptQueryServiceDbTests` + 前端 `PlasticReceiptQueryPage`/`PlasticReceiptQueryDetailDrawer`/`api/plasticReceiptQuery.ts`。
- 数据源:头 `塑胶加工采购单`(日期/加工厂名称/审核/客户名称)+ 明细 `塑胶加工采购单明细`(生产单号/款号/模具编号/物料编号/物料名称/用料名称/颜色/加工内容/数量/单价/金额/备注·有 [ID])。`塑胶共用物料表`/`塑胶物料资料`(GROUP BY 物料编号)。加工采购单塑胶表无 FK 到 款号总表(测试免父行)。
- 服务 ctor `PlasticProcessPurchaseOrderService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)`;doc GET `api/plastic-process-purchase-orders`(`plasticProcessPurchaseOrderApi.get`)。MenuCatalog 组"发外加工"。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `src/ErpApi/Features/Plastics/PlasticProcessPurchaseOrder/PlasticProcessPurchaseOrderDtos.cs` | 加 2 Query DTO | 改 |
| `.../PlasticProcessPurchaseOrderService.cs` | ApprovalFilter + Detail/Summary | 改 |
| `src/ErpApi/Features/Plastics/PlasticProcessPurchaseQuery/PlasticProcessPurchaseQueryController.cs` | /detail+/summary·脱敏 | 新建 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加菜单 加工采购查询 | 改 |
| `db/seed_plastic_process_purchase_query_perms.sql` | admin 授权 | 新建 |
| `tests/ErpApi.Tests/PlasticProcessPurchaseQueryServiceDbTests.cs` | 测试 | 新建 |
| `web/src/api/plasticProcessPurchaseQuery.ts` / `PlasticProcessPurchaseOrderQueryDetailDrawer.tsx` / `PlasticProcessPurchaseQueryPage.tsx` | 前端 | 新建 |
| `web/src/App.tsx` / `web/src/nav/menuTree.tsx` | 路由+菜单 | 改 |

---

## Task 1: 后端 Detail/Summary + Controller + 菜单 + 种子 + 测试

**Files:** Modify `PlasticProcessPurchaseOrderDtos.cs`, `PlasticProcessPurchaseOrderService.cs`, `MenuCatalog.cs`; Create `PlasticProcessPurchaseQueryController.cs`, `db/seed_plastic_process_purchase_query_perms.sql`, `PlasticProcessPurchaseQueryServiceDbTests.cs`

- [ ] **Step 1: DTO** 在 `PlasticProcessPurchaseOrderDtos.cs` 末尾加 `PlasticProcessPurchaseQueryDetailRow`(17 字段)+ `PlasticProcessPurchaseQuerySummaryRow`(10 字段)·见 spec ① DTO 原文。

- [ ] **Step 2: Service** 加 `private static ApprovalFilter` + `QueryDetailAsync(起,止,keyword?,审核情况?,物料类别?)` + `QuerySummaryAsync(...)`。SQL **照抄 spec ① 后端段**(明细 塑胶加工采购单明细 JOIN 单头 + LEFT JOIN 物料资料[单位/物料类别];汇总 GROUP BY 模具编号+物料编号+颜色+加工内容 + LEFT JOIN 共用物料表[共用原料编号])。`factory` 字段读源确认。

- [ ] **Step 3: Controller** Create `PlasticProcessPurchaseQueryController.cs`(克隆 `PlasticReceiptQueryController`):`Menu="加工采购查询"`、`[Route("api/plastic-process-purchase-query")]`、注入 `PlasticProcessPurchaseOrderService`、`/detail`(无单价权限置 单价/金额 null)、`/summary`(无单价权限置 总金额 null)。

- [ ] **Step 4: 菜单** `MenuCatalog.cs` 在 `new("发外加工","塑胶加工采购单"),` 后加 `new("发外加工","加工采购查询"),`。

- [ ] **Step 5: 种子** Create `db/seed_plastic_process_purchase_query_perms.sql`(克隆 `db/seed_plastic_process_purchase_order_perms.sql` 改菜单 加工采购查询)·应用两库。

- [ ] **Step 6: 测试** Create `tests/ErpApi.Tests/PlasticProcessPurchaseQueryServiceDbTests.cs`(参照 `PlasticReceiptQueryServiceDbTests`):种 共用物料表(物料 GQPM→共用原料编号 CR-GQ)+物料资料(GQPM·单位 kg·物料类别 ABS)+塑胶加工采购单(单号 GQ_D1·加工厂名称 甲厂·日期 2026-06-10·审核'1')+明细(2 行·生产单号 GQ-MO/款号 K-GQ/模具编号 GM-GQ/物料 GQPM/颜色 黑/加工内容 喷油/数量 5,3/单价 2/金额 10,6)→ `QueryDetailAsync(2026-06-01..30,"GQPM",null,null)` 2 行·验 加工厂名称=甲厂/模具编号=GM-GQ/加工内容=喷油/单位=kg/数量;`QuerySummaryAsync` 单行(按模具+物料+颜色+加工内容)·订购数量=8/总金额=16/共用物料=CR-GQ/物料类别=ABS;审核情况(未审核空/已审核2)、物料类别(ABS 2/不存在空)、keyword、区间外空。清理 DELETE 明细/单/共用物料表/物料资料。`using Dapper;`·免款号总表父行。

- [ ] **Step 7: 跑测试** focused PASS;`dotnet test` 全绿(389→390)。报告总数。

- [ ] **Step 8: Commit**
```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticProcessPurchaseQueryServiceDbTests.cs db/seed_plastic_process_purchase_query_perms.sql
git commit -m @'
feat(加工采购查询): QueryDetail/Summary(塑胶加工采购单·汇总按模具+物料+颜色+加工内容·共用物料·脱敏)+Controller+菜单+种子+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 两Tab查询页 + 只读抽屉 + API + 路由

**Files:** Create `web/src/api/plasticProcessPurchaseQuery.ts`, `web/src/pages/plastics/PlasticProcessPurchaseOrderQueryDetailDrawer.tsx`, `web/src/pages/plastics/PlasticProcessPurchaseQueryPage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: API** Create `web/src/api/plasticProcessPurchaseQuery.ts`(克隆 `plasticReceiptQuery.ts`):Detail Row(单据日期/单号/加工厂名称/生产单号/款号/模具编号/物料编号/物料名称/用料名称/颜色/加工内容/单位/数量/单价/金额/备注/审核)+ Summary Row(模具编号/物料编号/物料名称/颜色/共用物料/加工内容/物料类别/单位/订购数量/总金额)+ `plasticProcessPurchaseQueryApi.detail/summary`(端点 `/plastic-process-purchase-query/...`)。

- [ ] **Step 2: 抽屉** Create `PlasticProcessPurchaseOrderQueryDetailDrawer.tsx`(克隆 `PlasticReceiptQueryDetailDrawer`):menu="加工采购查询"、`plasticProcessPurchaseOrderApi.get(单号)`(import from `api/plasticProcessPurchaseOrder`)、标题 塑胶加工采购单、Descriptions 头 单号/日期/加工厂名称/客户名称/审核、明细列 生产单号/款号/模具编号/物料编号/物料名称/用料名称/颜色/加工内容/数量/(单价/金额 hidePrice)/备注。

- [ ] **Step 3: 查询页** Create `PlasticProcessPurchaseQueryPage.tsx`(克隆 `PlasticReceiptQueryPage`):MENU="加工采购查询"、API=plasticProcessPurchaseQueryApi、抽屉=PlasticProcessPurchaseOrderQueryDetailDrawer。明细列 单据日期/单号/加工厂名称/生产单号/款号/模具编号/物料编号/物料名称/用料名称/颜色/加工内容/单位/数量/(单价/金额 priceHidden)/备注/审核;汇总列 模具编号/物料编号/物料名称/颜色/共用物料/加工内容/单位/订购数量/(总金额 priceHidden)。`ColumnsType<Row>`。

- [ ] **Step 4: 路由+菜单** `App.tsx` 加 import + `<Route path="plastic-process-purchase-query" element={<PlasticProcessPurchaseQueryPage />} />`;`menuTree.tsx` ⑩ 占位 `M("加工采购查询")` → `M("加工采购查询","/plastic-process-purchase-query","加工采购查询")`。

- [ ] **Step 5: 测试+构建** `npm --prefix D:\WebpageERP\web run test`(54)+ `run build`(tsc 干净)。

- [ ] **Step 6: Commit**
```powershell
git add web/src/api/plasticProcessPurchaseQuery.ts web/src/pages/plastics/PlasticProcessPurchaseOrderQueryDetailDrawer.tsx web/src/pages/plastics/PlasticProcessPurchaseQueryPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(加工采购查询): 前端两Tab查询页+只读抽屉(双击开单·单价脱敏)+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟** Release 重建(锁先按 PID Stop-Process)+ 起后端(`--contentRoot 输出目录`)。Node:种 共用物料表 GQSMK→CR-GQ·物料资料·塑胶加工采购单(加工厂 甲厂·审核1)·明细(模具 GM-GQ·物料 GQSMK·加工内容 喷油·数量 5/3·单价 2)→ `GET /api/plastic-process-purchase-query/detail?keyword=GQSMK` 验 加工厂名称/模具编号/加工内容/单位;`/summary` 单行 订购数量8/共用物料 CR-GQ;未审核空。清理。
- [ ] **Step 2: opus 全分支终审** 派 opus 审 `feat-plastic-process-purchase-query`:JOIN 1:1、汇总 GROUP BY 模具+物料+颜色+加工内容(MAX/SUM)、共用物料=cm.共用原料编号、单位/物料类别=物料资料、ApprovalFilter、脱敏(明细单价/金额+汇总总金额+抽屉)、菜单(发外加工组)/权限/DI、双击 plastic-process-purchase-orders、测试自洽(免款号总表父行)、塑胶加工采购单录入/其它模块未动。目标 READY。
- [ ] **Step 3: 合并** `git checkout master; git merge --no-ff feat-plastic-process-purchase-query -m "...(加工采购查询)..."; git branch -d feat-plastic-process-purchase-query`。
- [ ] **Step 4: worklog + MEMORY** `docs/worklogs/2026-06-29-plastic-process-purchase-query.md`;更新记忆。Commit。

---

## 自审清单
- 汇总 GROUP BY 模具编号+物料编号+颜色+加工内容·非分组列 MAX/SUM·订购数量=SUM数量·总金额=SUM金额。
- 共用物料=cm.共用原料编号·单位/物料类别=物料资料。
- 脱敏 单价/金额(明细)+总金额(汇总)+抽屉。
- 双击 PlasticProcessPurchaseOrderQueryDetailDrawer 按单号 GET plastic-process-purchase-orders。
- 测试免款号总表父行(加工采购单塑胶表无 FK)。
