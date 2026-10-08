# 塑胶入仓查询 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** ⑨塑胶报表「塑胶入仓查询」(拆两步第2步)——只读两 Tab(汇总按物料编号+明细)over 塑胶入仓单/明细单 + 明细双击只读抽屉。带价脱敏。确立 入仓/退仓查询模板。

**Architecture:** 后端扩 PlasticReceiptService 加 ReceiptQueryDetail/Summary + ApprovalFilter;新 PlasticReceiptQueryController。前端两 Tab 页(镜像 PlasticOrderQueryPage)+ 新只读抽屉。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + AntD v6 + Vitest。

---

## 前置约定

- 分支 `feat-plastic-receipt-query`;`dotnet`=`C:\Program Files\dotnet\dotnet.exe`,`-c Release`。DB env User scope。提交末尾 Co-Authored-By。
- **冒烟前 `dotnet build -c Release`(锁先 Stop-Process)+ 起后端 `--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`。**
- 完整 SQL/DTO 见 spec `docs/superpowers/specs/2026-06-29-plastic-receipt-query-design.md`(① 后端段)。
- 模板参照(master):`PlasticScrapQuery`(Controller/汇总按物料编号/脱敏/ApprovalFilter)+ `PlasticScrapQueryServiceDbTests` + 前端 `PlasticScrapQueryPage`/`PlasticScrapDetailDrawer`/`api/plasticScrapQuery.ts`。
- 数据源:头 `塑胶入仓单`(供应商编号/供应商名称/日期/审核/订单单号)+ 明细 `塑胶入仓明细单`(订单单号/生产单号/款号/工模编号/物料编号/物料名称/规格/颜色/塑胶货号/单位/数量/单价/金额/备注·有 [ID])。`塑胶共用物料表`/`塑胶物料资料`(GROUP BY 物料编号)。入仓塑胶表无 FK 到 款号总表(测试免父行)。
- 服务 ctor `PlasticReceiptService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)`;doc GET `api/plastic-receipts`(`plasticDocApi("plastic-receipts").get` 返 {单头,明细})。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `src/ErpApi/Features/Plastics/PlasticReceipt/PlasticReceiptDtos.cs` | 加 2 Query DTO | 改 |
| `src/ErpApi/Features/Plastics/PlasticReceipt/PlasticReceiptService.cs` | ApprovalFilter + Detail/Summary | 改 |
| `src/ErpApi/Features/Plastics/PlasticReceiptQuery/PlasticReceiptQueryController.cs` | /detail+/summary·脱敏 | 新建 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加菜单 塑胶入仓查询 | 改 |
| `db/seed_plastic_receipt_query_perms.sql` | admin 授权 | 新建 |
| `tests/ErpApi.Tests/PlasticReceiptQueryServiceDbTests.cs` | 测试 | 新建 |
| `web/src/api/plasticReceiptQuery.ts` / `PlasticReceiptQueryDetailDrawer.tsx` / `PlasticReceiptQueryPage.tsx` | 前端 | 新建 |
| `web/src/App.tsx` / `web/src/nav/menuTree.tsx` | 路由+菜单 | 改 |

---

## Task 1: 后端 Detail/Summary + Controller + 菜单 + 种子 + 测试

**Files:** Modify `PlasticReceiptDtos.cs`, `PlasticReceiptService.cs`, `MenuCatalog.cs`; Create `PlasticReceiptQueryController.cs`, `db/seed_plastic_receipt_query_perms.sql`, `PlasticReceiptQueryServiceDbTests.cs`

- [ ] **Step 1: DTO** 在 `PlasticReceiptDtos.cs` 末尾加 `PlasticReceiptQueryDetailRow` + `PlasticReceiptQuerySummaryRow`(完整字段见 spec ① DTO 原文)。

- [ ] **Step 2: Service** 在 `PlasticReceiptService` 加 `private static ApprovalFilter` + `ReceiptQueryDetailAsync(起,止,keyword?,审核情况?,物料类别?)` + `ReceiptQuerySummaryAsync(...)`。SQL **照抄 spec ① 后端段**(明细:塑胶入仓明细单 d JOIN 塑胶入仓单 h·LEFT JOIN cm[塑胶货号/共用原料编号]·LEFT JOIN m[物料类别]·供应商=h.供应商名称·塑胶货号=d.塑胶货号·共用货号=cm.塑胶货号;汇总 GROUP BY 物料编号+颜色)。`factory` 字段读源确认。两方法签名返回 `IReadOnlyList<...>`,`using var c=factory.Create()`。

- [ ] **Step 3: Controller** Create `PlasticReceiptQueryController.cs`(克隆 `PlasticScrapQueryController`):`Menu="塑胶入仓查询"`、`[Route("api/plastic-receipt-query")]`、注入 `PlasticReceiptService`、`/detail`+`/summary`、无单价权限置 `单价=null;金额=null`(明细+汇总)。

- [ ] **Step 4: 菜单** `MenuCatalog.cs` 在 `new("塑胶报表","塑胶盘点查询"),` 后加 `new("塑胶报表","塑胶入仓查询"),`。

- [ ] **Step 5: 种子** Create `db/seed_plastic_receipt_query_perms.sql`(克隆 `db/seed_plastic_scrap_query_perms.sql` 改菜单 塑胶入仓查询),应用两库。

- [ ] **Step 6: 测试** Create `PlasticReceiptQueryServiceDbTests.cs`(克隆 `PlasticScrapQueryServiceDbTests`):种 共用物料表(RCPM→塑胶货号 H-RC/共用原料编号 CR-RC)+物料资料(RCPM·物料类别 ABS)+塑胶入仓单(单号 RC_D1·供应商名称 供A·日期 2026-06-10·审核'1'·订单单号 ZCS-RC)+明细(2 行·订单单号 ZCS-RC/生产单号 RC-MO/款号 K-RC/工模编号 GM-RC/物料 RCPM/颜色 黑/塑胶货号 H-RC/数量 5,3/单价 2)→ Detail 验 订单单号=ZCS-RC/工模编号=GM-RC/供应商=供A/共用货号=H-RC/塑胶货号=H-RC/数量;Summary 单行(按物料编号)数量=8/共用货号=H-RC/物料类别=ABS;审核情况(未审核空/已审核2)、物料类别、keyword、区间外空。清理 DELETE 明细/单/共用物料表/物料资料。`using Dapper;`·免款号总表父行。ctor `new(Factory(), new DocumentNumberGenerator())`。

- [ ] **Step 7: 跑测试** focused PASS;`dotnet test` 全绿(375→376)。报告总数。

- [ ] **Step 8: Commit**
```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticReceiptQueryServiceDbTests.cs db/seed_plastic_receipt_query_perms.sql
git commit -m @'
feat(塑胶入仓查询): ReceiptQueryDetail/Summary(订单单号/工模编号/供应商·汇总按物料编号·脱敏)+Controller+菜单+种子+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 两Tab查询页 + 只读抽屉 + API + 路由

**Files:** Create `web/src/api/plasticReceiptQuery.ts`, `web/src/pages/plastics/PlasticReceiptQueryDetailDrawer.tsx`, `web/src/pages/plastics/PlasticReceiptQueryPage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: API** Create `web/src/api/plasticReceiptQuery.ts`(克隆 `plasticScrapQuery.ts`):`PlasticReceiptQueryDetailRow`(日期/单号/订单单号/生产单号/款号/工模编号/物料编号/物料名称/颜色/塑胶货号/共用货号/供应商/单位/数量/单价/金额/备注/审核)+`PlasticReceiptQuerySummaryRow`(物料编号/物料名称/颜色/塑胶货号/共用货号/共用物料/物料类别/单位/数量/金额)+`plasticReceiptQueryApi.detail/summary`(端点 `/plastic-receipt-query/...`)。

- [ ] **Step 2: 抽屉** Create `PlasticReceiptQueryDetailDrawer.tsx`(克隆 `PlasticScrapDetailDrawer`):menu="塑胶入仓查询"、`plasticDocApi("plastic-receipts")`、标题 塑胶入仓单、Descriptions 头 单号/日期/供应商名称/订单单号/审核、明细列 订单单号/生产单号/款号/工模编号/物料编号/物料名称/颜色/塑胶货号/单位/数量/(单价/金额 hidePrice 隐藏)/备注。

- [ ] **Step 3: 查询页** Create `PlasticReceiptQueryPage.tsx`(克隆 `PlasticScrapQueryPage`):MENU="塑胶入仓查询"、API=plasticReceiptQueryApi、抽屉=PlasticReceiptQueryDetailDrawer。明细列 日期/单号/订单单号/生产单号/款号/工模编号/物料编号/物料名称/颜色/塑胶货号/共用货号/供应商/单位/数量/(单价/金额 priceHidden)/备注/审核;汇总列 物料编号/物料名称/颜色/塑胶货号/共用货号/共用物料/单位/数量/(金额 priceHidden)。`ColumnsType<Row>` 标注。

- [ ] **Step 4: 路由+菜单** `App.tsx` 加 import + `<Route path="plastic-receipt-query" element={<PlasticReceiptQueryPage />} />`;`menuTree.tsx` ⑨ 占位 `M("塑胶入仓查询")` → `M("塑胶入仓查询","/plastic-receipt-query","塑胶入仓查询")`。

- [ ] **Step 5: 测试+构建** `npm --prefix D:\WebpageERP\web run test`(54)+ `run build`(tsc 干净)。

- [ ] **Step 6: Commit**
```powershell
git add web/src/api/plasticReceiptQuery.ts web/src/pages/plastics/PlasticReceiptQueryDetailDrawer.tsx web/src/pages/plastics/PlasticReceiptQueryPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(塑胶入仓查询): 前端两Tab查询页+只读抽屉(双击开单·单价脱敏)+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟** Release 重建(锁先 Stop-Process)+ 起后端(`--contentRoot 输出目录`)。Node:种 共用物料表 RCSMK→H-RC·物料资料·塑胶入仓单(供应商 供A·订单单号 ZCS-RC·审核1)·明细(工模 GM-RC·物料 RCSMK·塑胶货号 H-RC·数量 5/3·单价2)→ `GET /api/plastic-receipt-query/detail?keyword=RCSMK` 验 订单单号/工模编号/供应商/共用货号;`/summary` 单行 数量8;未审核空。清理。
- [ ] **Step 2: opus 全分支终审** 派 opus 审 `feat-plastic-receipt-query`:JOIN 1:1、塑胶货号=d.塑胶货号、共用货号=cm.塑胶货号、供应商=h.供应商名称、汇总 GROUP BY 物料编号+颜色 数量/金额 SUM、ApprovalFilter、脱敏两 Tab+抽屉、订单单号/工模编号、菜单/权限/DI、双击 plastic-receipts、测试自洽、其它查询/录入模板未动。目标 READY。
- [ ] **Step 3: 合并** `git checkout master; git merge --no-ff feat-plastic-receipt-query -m "...(塑胶入仓查询·拆两步第2步)..."; git branch -d feat-plastic-receipt-query`。
- [ ] **Step 4: worklog + MEMORY** `docs/worklogs/2026-06-29-plastic-receipt-query.md`;更新记忆(塑胶入仓查询 done·退仓查询待克隆)。Commit。

---

## 自审清单
- 共用货号=cm.塑胶货号·共用物料=cm.共用原料编号·塑胶货号=d.塑胶货号·供应商=h.供应商名称。
- 汇总按物料编号+颜色(已拍板)·数量/金额 SUM。
- 脱敏 单价/金额 明细+汇总+抽屉。
- 双击 PlasticReceiptQueryDetailDrawer 按单号 GET plastic-receipts。
- 测试免款号总表父行(入仓塑胶表无 FK)。
