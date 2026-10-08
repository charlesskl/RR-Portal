# 塑胶退仓查询 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** ⑨塑胶报表「塑胶退仓查询」——只读两 Tab(汇总按物料编号+明细)over 塑胶退仓单/明细单 + 明细双击只读抽屉。**塑胶入仓查询的克隆**,换数据源到退仓。

**Architecture:** 照搬 `PlasticReceiptQuery`(入仓查询)模板,数据源换 `PlasticWarehouseReturn`(头供应商/日期/审核/订单单号 + 明细 订单单号/生产单号/款号/工模编号/物料/颜色/塑胶货号/单位/数量/单价/金额/备注)。设计/口径继承 入仓查询 spec `docs/superpowers/specs/2026-06-29-plastic-receipt-query-design.md`(共用货号=cm.塑胶货号·共用物料=cm.共用原料编号·塑胶货号=d.塑胶货号·供应商=h.供应商名称·汇总按物料编号+颜色·只读抽屉·脱敏)。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + AntD v6 + Vitest。

---

## 前置约定

- 分支 `feat-plastic-wh-return-query`;`dotnet`=`C:\Program Files\dotnet\dotnet.exe`,`-c Release`。提交末尾 Co-Authored-By。
- **冒烟前 `dotnet build -c Release`(锁先 Stop-Process)+ 起后端 `--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`。**
- **参照模板(master·刚合并)**:`PlasticReceiptService.ReceiptQueryDetail/Summary` + `PlasticReceiptQueryController` + `PlasticReceiptQueryServiceDbTests` + 前端 `PlasticReceiptQueryPage`/`PlasticReceiptQueryDetailDrawer`/`api/plasticReceiptQuery.ts`。**逐文件克隆,Receipt→WarehouseReturn、入仓→退仓、plastic-receipt-query→plastic-warehouse-return-query、塑胶入仓单/明细单→塑胶退仓单/明细单、doc 端点 plastic-receipts→plastic-warehouse-returns、菜单 塑胶入仓查询→塑胶退仓查询。**
- 数据源:`PlasticWarehouseReturnService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)`;DTO `PlasticWarehouseReturnDtos.cs`;头 `塑胶退仓单`(供应商名称/日期/审核/订单单号)+ 明细 `塑胶退仓明细单`(订单单号/生产单号/款号/工模编号/物料编号/物料名称/颜色/塑胶货号/单位/数量/单价/金额/备注·有 [ID])。退仓塑胶表无 FK 到 款号总表(测试免父行)。
- 退仓 GET 整单:`api/plastic-warehouse-returns`(`plasticDocApi("plastic-warehouse-returns").get` 返 {单头,明细})。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `src/ErpApi/Features/Plastics/PlasticWarehouseReturn/PlasticWarehouseReturnDtos.cs` | 加 2 Query DTO | 改 |
| `src/ErpApi/Features/Plastics/PlasticWarehouseReturn/PlasticWarehouseReturnService.cs` | ApprovalFilter + Detail/Summary | 改 |
| `src/ErpApi/Features/Plastics/PlasticWarehouseReturnQuery/PlasticWarehouseReturnQueryController.cs` | /detail+/summary·脱敏 | 新建 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加菜单 塑胶退仓查询 | 改 |
| `db/seed_plastic_wh_return_query_perms.sql` | admin 授权 | 新建 |
| `tests/ErpApi.Tests/PlasticWarehouseReturnQueryServiceDbTests.cs` | 测试 | 新建 |
| `web/src/api/plasticWarehouseReturnQuery.ts` / `PlasticWarehouseReturnQueryDetailDrawer.tsx` / `PlasticWarehouseReturnQueryPage.tsx` | 前端 | 新建 |
| `web/src/App.tsx` / `web/src/nav/menuTree.tsx` | 路由+菜单 | 改 |

---

## Task 1: 后端(克隆入仓查询后端·换退仓)

**Files:** Modify `PlasticWarehouseReturnDtos.cs`, `PlasticWarehouseReturnService.cs`, `MenuCatalog.cs`; Create `PlasticWarehouseReturnQueryController.cs`, `db/seed_plastic_wh_return_query_perms.sql`, `PlasticWarehouseReturnQueryServiceDbTests.cs`

- [ ] **Step 1: DTO** 在 `PlasticWarehouseReturnDtos.cs` 末尾加 `PlasticWarehouseReturnQueryDetailRow` + `PlasticWarehouseReturnQuerySummaryRow`,字段**完全同** `PlasticReceiptQueryDetailRow`/`SummaryRow`(日期/单号/订单单号/生产单号/款号/工模编号/物料编号/物料名称/颜色/塑胶货号/共用货号/供应商/单位/数量/单价/金额/备注/审核;Summary:物料编号/物料名称/颜色/塑胶货号/共用货号/共用物料/物料类别/单位/数量/金额)。

- [ ] **Step 2: Service** 在 `PlasticWarehouseReturnService` 加 `private static ApprovalFilter` + `WhReturnQueryDetailAsync`/`WhReturnQuerySummaryAsync`。SQL **克隆入仓查询 ReceiptQueryDetail/Summary**,仅改表名 `塑胶入仓明细单→塑胶退仓明细单`、`塑胶入仓单→塑胶退仓单`(其余 供应商=h.供应商名称·塑胶货号=d.塑胶货号·共用货号=cm.塑胶货号·汇总 GROUP BY 物料编号+颜色 全不变)。`factory` 字段读源确认。

- [ ] **Step 3: Controller** Create `PlasticWarehouseReturnQueryController.cs`(克隆 `PlasticReceiptQueryController`):`Menu="塑胶退仓查询"`、`[Route("api/plastic-warehouse-return-query")]`、注入 `PlasticWarehouseReturnService`、调 `WhReturnQueryDetail/SummaryAsync`、脱敏(明细 单价+金额、汇总 金额)。

- [ ] **Step 4: 菜单** `MenuCatalog.cs` 在 `new("塑胶报表","塑胶入仓查询"),` 后加 `new("塑胶报表","塑胶退仓查询"),`。

- [ ] **Step 5: 种子** Create `db/seed_plastic_wh_return_query_perms.sql`(克隆 `db/seed_plastic_receipt_query_perms.sql` 改菜单 塑胶退仓查询),应用两库。

- [ ] **Step 6: 测试** Create `PlasticWarehouseReturnQueryServiceDbTests.cs`(克隆 `PlasticReceiptQueryServiceDbTests`):换 表/服务/WhReturn 命名、单号 WR_D1、物料 WRPM、头供应商 供B/订单单号 ZCS-WR、塑胶货号 H-WR/工模 GM-WR/共用物料表 WRPM→H-WR/CR-WR。断言 Detail 订单单号=ZCS-WR/工模编号=GM-WR/供应商=供B/共用货号=H-WR/塑胶货号=H-WR;Summary 单行数量8;审核/物料类别/keyword/区间。`using Dapper;`·免款号总表父行。

- [ ] **Step 7: 跑测试** focused PASS;`dotnet test` 全绿(376→377)。报告总数。

- [ ] **Step 8: Commit**
```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticWarehouseReturnQueryServiceDbTests.cs db/seed_plastic_wh_return_query_perms.sql
git commit -m @'
feat(塑胶退仓查询): WhReturnQueryDetail/Summary(克隆入仓查询换退仓·汇总按物料编号·脱敏)+Controller+菜单+种子+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端(克隆入仓查询前端·换退仓)

**Files:** Create `web/src/api/plasticWarehouseReturnQuery.ts`, `web/src/pages/plastics/PlasticWarehouseReturnQueryDetailDrawer.tsx`, `web/src/pages/plastics/PlasticWarehouseReturnQueryPage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: API** Create `web/src/api/plasticWarehouseReturnQuery.ts`:克隆 `plasticReceiptQuery.ts`,接口字段同(Receipt→WhReturn 命名),端点 `/plastic-warehouse-return-query/detail`+`/summary`,导出 `plasticWarehouseReturnQueryApi`。

- [ ] **Step 2: 抽屉** Create `PlasticWarehouseReturnQueryDetailDrawer.tsx`:克隆 `PlasticReceiptQueryDetailDrawer`,menu="塑胶退仓查询"、`plasticDocApi("plastic-warehouse-returns")`、标题 塑胶退仓单(头 单号/日期/供应商名称/订单单号/审核·明细列同入仓)。

- [ ] **Step 3: 查询页** Create `PlasticWarehouseReturnQueryPage.tsx`:克隆 `PlasticReceiptQueryPage`,MENU="塑胶退仓查询"、API=plasticWarehouseReturnQueryApi、抽屉=PlasticWarehouseReturnQueryDetailDrawer(明细/汇总列同入仓不变)。

- [ ] **Step 4: 路由+菜单** `App.tsx` 加 import + `<Route path="plastic-warehouse-return-query" element={<PlasticWarehouseReturnQueryPage />} />`;`menuTree.tsx` ⑨ 占位 `M("塑胶退仓查询")` → 带路由。

- [ ] **Step 5: 测试+构建** `npm --prefix D:\WebpageERP\web run test`(54)+ `run build`(tsc 干净)。

- [ ] **Step 6: Commit**
```powershell
git add web/src/api/plasticWarehouseReturnQuery.ts web/src/pages/plastics/PlasticWarehouseReturnQueryDetailDrawer.tsx web/src/pages/plastics/PlasticWarehouseReturnQueryPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(塑胶退仓查询): 前端两Tab查询页+只读抽屉(克隆入仓查询换退仓·双击开单·脱敏)+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟** 克隆 `smoke_receipt_query.js` 换退仓(端点 plastic-warehouse-return-query·种 塑胶退仓单/明细单 WR·供应商 供B·订单单号 ZCS-WR·工模 GM-WR·物料 WRSMK·塑胶货号 H-WR·共用物料表 WRSMK→H-WR/CR-WR·数量 5/3)。Release 重建(锁先 Stop-Process)+ `--contentRoot 输出目录`。Expected: detail 订单单号/工模/供应商/共用货号;summary 单行数量8;未审核空。
- [ ] **Step 2: opus 全分支终审** 派 opus 审 `feat-plastic-wh-return-query`:JOIN 1:1、列映射(订单单号/工模编号/供应商=h.供应商名称·塑胶货号=d.塑胶货号·共用货号=cm.塑胶货号)、汇总 GROUP BY 物料编号+颜色、ApprovalFilter、脱敏两 Tab+抽屉、菜单/权限/DI、双击 plastic-warehouse-returns、测试自洽、入仓查询/录入模板未动。目标 READY。
- [ ] **Step 3: 合并** `git checkout master; git merge --no-ff feat-plastic-wh-return-query -m "...(塑胶退仓查询)..."; git branch -d feat-plastic-wh-return-query`。
- [ ] **Step 4: worklog + MEMORY** `docs/worklogs/2026-06-29-plastic-wh-return-query.md`;更新记忆(**塑胶入仓/退仓查询完成·⑨塑胶报表查询全齐**)。Commit。

---

## 自审清单
- 克隆点:Receipt→WhReturn·入仓→退仓·表名·端点 plastic-warehouse-returns·菜单/路由。
- 列/汇总口径/脱敏/抽屉/测试 与入仓查询完全一致(仅数据源换退仓)。
- 退仓塑胶表无 FK 免父行。
