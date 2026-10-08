# 塑胶退料查询 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 塑胶退料单 只读两 Tab 查询(汇总按生产单号 + 明细)+ 双击只读抽屉。**①塑胶领料查询的克隆**,换数据源到 塑胶退料单/明细。

**Architecture:** 完全照搬 `PlasticIssueQuery`(①领料查询)模板,数据源换 `塑胶退料单`(头 退料部门/退料人/审核)+ `塑胶退料明细单`(生产单号/款号/物料编号/物料名称/规格/颜色/塑胶货号/单位/数量/单价/金额/备注·**有 [ID]**)。设计/口径继承 ①spec `docs/superpowers/specs/2026-06-27-plastic-issue-query-design.md`(共用货号=cm.塑胶货号·共用物料=cm.共用原料编号·两 Tab·只读抽屉·脱敏·省略次要功能)。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + AntD v6 + Vitest。

---

## 前置约定

- 分支 `feat-plastic-return-query`;`dotnet`=`C:\Program Files\dotnet\dotnet.exe`,`-c Release`。DB env User scope。提交末尾 Co-Authored-By。
- **冒烟前 `dotnet build -c Release`(锁先 Stop-Process)+ 起后端 `--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`。**
- **参照模板(已合并 master)**:后端 `PlasticIssueService.IssueQueryDetail/Summary` + `PlasticIssueQueryController` + `PlasticIssueQueryServiceDbTests`;前端 `PlasticIssueQueryPage` + `PlasticIssueDetailDrawer` + `api/plasticIssueQuery.ts`。**逐文件克隆,把 领料→退料、Issue→Return、plastic-issue→plastic-return、塑胶领料单/明细单→塑胶退料单/明细单、领料部门/领料人→退料部门/退料人 替换。**
- 退料明细**无 装配采购**(领料有),退料查询明细**不要 装配采购 列**;退料明细**自带 塑胶货号**(d.[塑胶货号]),`塑胶货号` 列取 `d.[塑胶货号]`,`共用货号`=cm.[塑胶货号]、`共用物料`=cm.[共用原料编号]。
- 退料 GET 整单:`api/plastic-returns`(`plasticDocApi("plastic-returns").get` 返 {单头,明细})。
- 数据源:`PlasticReturnService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)`,DTO 在 `PlasticReturnDtos.cs`。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `src/ErpApi/Features/Plastics/PlasticReturn/PlasticReturnDtos.cs` | 加 2 Query DTO | 改 |
| `src/ErpApi/Features/Plastics/PlasticReturn/PlasticReturnService.cs` | ApprovalFilter + Detail/Summary | 改 |
| `src/ErpApi/Features/Plastics/PlasticReturnQuery/PlasticReturnQueryController.cs` | /detail+/summary·脱敏 | 新建 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加菜单 塑胶退料查询 | 改 |
| `db/seed_plastic_return_query_perms.sql` | admin 授权 | 新建 |
| `tests/ErpApi.Tests/PlasticReturnQueryServiceDbTests.cs` | 测试 | 新建 |
| `web/src/api/plasticReturnQuery.ts` / `PlasticReturnDetailDrawer.tsx` / `PlasticReturnQueryPage.tsx` | 前端 | 新建 |
| `web/src/App.tsx` / `web/src/nav/menuTree.tsx` | 路由+菜单 | 改 |

---

## Task 1: 后端(克隆领料查询后端·换退料)

**Files:** Modify `PlasticReturnDtos.cs`, `PlasticReturnService.cs`, `MenuCatalog.cs`; Create `PlasticReturnQueryController.cs`, `db/seed_plastic_return_query_perms.sql`, `PlasticReturnQueryServiceDbTests.cs`

- [ ] **Step 1: DTO** 在 `PlasticReturnDtos.cs` 末尾加 `PlasticReturnQueryDetailRow` + `PlasticReturnQuerySummaryRow`,字段同 `PlasticIssueQueryDetailRow`/`SummaryRow` 但把 `领料部门/领料人` 改为 `退料部门/退料人`(明细 Row),其余一致(日期/单号/生产单号/款号/退料部门/退料人/物料编号/物料名称/颜色/塑胶货号/共用物料/共用货号/单位/数量/单价/金额/备注/审核;Summary:生产单号/款号/物料编号/物料名称/颜色/塑胶货号/共用物料/共用货号/物料类别/单位/数量/单价/金额)。**无 装配采购 字段。**

- [ ] **Step 2: Service** 在 `PlasticReturnService` 加 `private static ApprovalFilter`(同领料)+ `ReturnQueryDetailAsync`/`ReturnQuerySummaryAsync`。SQL 照 `PlasticIssueService` 的对应方法克隆,改:
  - 表 `塑胶领料明细单`→`塑胶退料明细单`、`塑胶领料单`→`塑胶退料单`;
  - 头列 `h.[领料部门]`→`h.[退料部门]`、`h.[领料人]`→`h.[退料人]`;
  - 明细 `塑胶货号` 列由 `d.[塑胶货号]` 取(退料明细自带);**删 `d.[装配采购]`**;
  - `共用货号`=`cm.[塑胶货号]`、`共用物料`=`cm.[共用原料编号]` 不变;cm/m 两 LEFT JOIN 子查询不变。
  - 汇总 GROUP BY `d.[生产单号], d.[款号], d.[物料编号], d.[颜色]`,`塑胶货号` 用 `MAX(d.[塑胶货号])`,其余 MAX/SUM 同领料。
  - keyword 过滤同领料(物料编号/名称/生产单号/款号)。

- [ ] **Step 3: Controller** Create `PlasticReturnQueryController.cs`:克隆 `PlasticIssueQueryController`,改 `Menu="塑胶退料查询"`、`[Route("api/plastic-return-query")]`、注入 `PlasticReturnService`、调 `ReturnQueryDetail/SummaryAsync`。脱敏(单价+金额·明细+汇总)不变。

- [ ] **Step 4: 菜单** `MenuCatalog.cs` 在 `new("塑胶报表","塑胶领料查询"),` 后加 `new("塑胶报表","塑胶退料查询"),`。

- [ ] **Step 5: 种子** Create `db/seed_plastic_return_query_perms.sql`(克隆 `db/seed_plastic_issue_query_perms.sql` 改菜单 塑胶退料查询),应用两库。

- [ ] **Step 6: 测试** Create `PlasticReturnQueryServiceDbTests.cs`:克隆 `PlasticIssueQueryServiceDbTests`,换 表/服务/Return 命名、单号前缀 RQ_D1、物料 RQPM、头 退料部门 D1/退料人 P1。种 共用物料表(RQPM→塑胶货号 H-RQ/共用原料编号 CR-RQ)+物料资料(ABS)+退料单(审核1·退料部门/人)+明细(物料 RQPM·**塑胶货号 H-RQ**·数量 5,3·单价 2)。断言 Detail 退料部门/退料人/共用货号=H-RQ/共用物料=CR-RQ/塑胶货号=H-RQ + Summary 数量8 + 审核/物料类别/keyword/区间。`using Dapper;`。

- [ ] **Step 7: 跑测试** focused PASS;`dotnet test` 全绿(371→372)。报告总数。

- [ ] **Step 8: Commit**
```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticReturnQueryServiceDbTests.cs db/seed_plastic_return_query_perms.sql
git commit -m @'
feat(塑胶退料查询): ReturnQueryDetail/Summary(克隆领料查询换退料·共用物料/货号·脱敏)+Controller+菜单+种子+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端(克隆领料查询前端·换退料)

**Files:** Create `web/src/api/plasticReturnQuery.ts`, `web/src/pages/plastics/PlasticReturnDetailDrawer.tsx`, `web/src/pages/plastics/PlasticReturnQueryPage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: API** Create `web/src/api/plasticReturnQuery.ts`:克隆 `plasticIssueQuery.ts`,接口字段 领料部门/领料人→退料部门/退料人(无装配采购),端点 `/plastic-return-query/detail`+`/summary`,导出 `plasticReturnQueryApi`。

- [ ] **Step 2: 抽屉** Create `PlasticReturnDetailDrawer.tsx`:克隆 `PlasticIssueDetailDrawer`,改 menu="塑胶退料查询"、`plasticDocApi("plastic-returns")`、标题「塑胶退料单」、Descriptions 头 退料部门/退料人。

- [ ] **Step 3: 查询页** Create `PlasticReturnQueryPage.tsx`:克隆 `PlasticIssueQueryPage`,改 MENU="塑胶退料查询"、API=plasticReturnQueryApi、抽屉=PlasticReturnDetailDrawer、明细列把 领料部门/领料人→退料部门/退料人 **并删 装配采购 列**(其余 日期/单号/生产单号/款号/物料编号/物料名称/颜色/塑胶货号/共用物料/共用货号/单位/数量/单价/金额/备注/审核 不变),汇总列同领料。

- [ ] **Step 4: 路由+菜单** `App.tsx` 加 import + `<Route path="plastic-return-query" element={<PlasticReturnQueryPage />} />`;`menuTree.tsx` 占位 `M("塑胶退料查询")` → `M("塑胶退料查询","/plastic-return-query","塑胶退料查询")`。

- [ ] **Step 5: 测试+构建** `npm --prefix D:\WebpageERP\web run test`(54)+ `run build`(tsc 干净)。

- [ ] **Step 6: Commit**
```powershell
git add web/src/api/plasticReturnQuery.ts web/src/pages/plastics/PlasticReturnDetailDrawer.tsx web/src/pages/plastics/PlasticReturnQueryPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(塑胶退料查询): 前端两Tab查询页+只读抽屉(克隆领料查询换退料·双击开单·脱敏)+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟** 克隆 `smoke_issue_query.js` 换 退料(端点 plastic-return-query·种 塑胶退料单/明细单 RQ·头退料部门/退料人·明细带 塑胶货号 H-RS·物料 RSMK·共用物料表 RSMK→H-RS/CR-RS)。确保 Release 新(锁先 Stop-Process)+ `--contentRoot 输出目录`。Expected: detail 共用货号 H-RS/共用物料 CR-RS/退料部门/退料人;summary 数量 8;未审核空。
- [ ] **Step 2: opus 全分支终审** 派 opus 审 `feat-plastic-return-query`:JOIN 1:1、共用映射、塑胶货号=d.塑胶货号、汇总 GROUP、ApprovalFilter、脱敏两 Tab+抽屉、退料部门/人、无装配采购、菜单/权限/DI、双击 plastic-returns、测试自洽。目标 READY。
- [ ] **Step 3: 合并** `git checkout master; git merge --no-ff feat-plastic-return-query -m "...(塑胶退料查询)..."; git branch -d feat-plastic-return-query`。
- [ ] **Step 4: worklog + MEMORY** `docs/worklogs/2026-06-27-plastic-return-query.md`;更新记忆(②done·③报废④盘点待做)。Commit。

---

## 自审清单
- 克隆点:表/服务/命名/菜单/路由 领料→退料;头 领料部门/人→退料部门/人;删 装配采购;塑胶货号=d.塑胶货号(退料明细自带)。
- 脱敏/JOIN 1:1/ApprovalFilter/抽屉/测试 结构同①不变。
- 数据源差异已核:退料明细无装配采购、自带塑胶货号。
