# 塑胶报废查询 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 塑胶报废单 只读两 Tab 查询(**汇总按物料编号** + 明细)+ 双击只读抽屉。**②塑胶退料查询的克隆**,换数据源到 塑胶报废单/明细,汇总改按物料编号。

**Architecture:** 照搬 `PlasticReturnQuery`(②退料查询)模板,数据源换 `塑胶报废单`(头 报废部门/报废人/审核)+ `塑胶报废明细单`(生产单号/款号/物料编号/物料名称/规格/颜色/塑胶货号/单位/数量/单价/金额/备注·有 [ID]·无装配采购·自带塑胶货号)。设计/口径继承 ①spec(共用货号=cm.塑胶货号·共用物料=cm.共用原料编号·两 Tab·只读抽屉·脱敏)。**唯一结构差异:汇总 GROUP BY 物料编号+颜色(非生产单号)。**

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + AntD v6 + Vitest。

---

## 前置约定

- 分支 `feat-plastic-scrap-query`;`dotnet`=`C:\Program Files\dotnet\dotnet.exe`,`-c Release`。提交末尾 Co-Authored-By。
- **冒烟前 `dotnet build -c Release`(锁先 Stop-Process)+ 起后端 `--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`。**
- **参照模板(master)**:`PlasticReturnService.ReturnQueryDetail/Summary` + `PlasticReturnQueryController` + `PlasticReturnQueryServiceDbTests` + 前端 `PlasticReturnQueryPage`/`PlasticReturnDetailDrawer`/`api/plasticReturnQuery.ts`。**逐文件克隆,Return→Scrap、退料→报废、plastic-return→plastic-scrap、塑胶退料单/明细单→塑胶报废单/明细单、退料部门/退料人→报废部门/报废人。**
- 数据源:`PlasticScrapService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)`,DTO `PlasticScrapDtos.cs`,doc 端点 `api/plastic-scraps`。塑胶货号=d.[塑胶货号]。
- **汇总差异**:②退料汇总 GROUP BY 生产单号+款号+物料编号+颜色;③报废汇总 **GROUP BY 物料编号+颜色**,Summary Row **去 生产单号/款号 字段**,SELECT 列=物料编号/物料名称(MAX)/颜色/塑胶货号(MAX d.塑胶货号)/共用货号(MAX cm.塑胶货号)/共用物料(MAX cm.共用原料编号)/物料类别(MAX)/单位(MAX)/数量(SUM)/单价(MAX)/金额(SUM)。明细 Row 保留 生产单号/款号(报废明细有)。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `src/ErpApi/Features/Plastics/PlasticScrap/PlasticScrapDtos.cs` | 加 2 Query DTO | 改 |
| `src/ErpApi/Features/Plastics/PlasticScrap/PlasticScrapService.cs` | ApprovalFilter + Detail/Summary | 改 |
| `src/ErpApi/Features/Plastics/PlasticScrapQuery/PlasticScrapQueryController.cs` | /detail+/summary·脱敏 | 新建 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加菜单 塑胶报废查询 | 改 |
| `db/seed_plastic_scrap_query_perms.sql` | admin 授权 | 新建 |
| `tests/ErpApi.Tests/PlasticScrapQueryServiceDbTests.cs` | 测试 | 新建 |
| `web/src/api/plasticScrapQuery.ts` / `PlasticScrapDetailDrawer.tsx` / `PlasticScrapQueryPage.tsx` | 前端 | 新建 |
| `web/src/App.tsx` / `web/src/nav/menuTree.tsx` | 路由+菜单 | 改 |

---

## Task 1: 后端(克隆退料查询后端·换报废·汇总按物料编号)

**Files:** Modify `PlasticScrapDtos.cs`, `PlasticScrapService.cs`, `MenuCatalog.cs`; Create `PlasticScrapQueryController.cs`, `db/seed_plastic_scrap_query_perms.sql`, `PlasticScrapQueryServiceDbTests.cs`

- [ ] **Step 1: DTO** 在 `PlasticScrapDtos.cs` 末尾加:
  - `PlasticScrapQueryDetailRow` = 克隆 `PlasticReturnQueryDetailRow`,把 退料部门/退料人→报废部门/报废人(其余 日期/单号/生产单号/款号/物料编号/物料名称/颜色/塑胶货号/共用物料/共用货号/单位/数量/单价/金额/备注/审核 不变·无装配采购)。
  - `PlasticScrapQuerySummaryRow` = **去 生产单号/款号**,字段=物料编号/物料名称/颜色/塑胶货号/共用物料/共用货号/物料类别/单位/数量/单价/金额。

- [ ] **Step 2: Service** 加 `private static ApprovalFilter`(同模板)+ `ScrapQueryDetailAsync`/`ScrapQuerySummaryAsync`。Detail SQL 克隆退料 Detail,改 表 塑胶报废明细单/塑胶报废单、头 `h.[报废部门]`/`h.[报废人]`,其余不变(塑胶货号=d.[塑胶货号]·cm/m 两 LEFT JOIN 不变·keyword 物料编号/名称/生产单号/款号)。Summary SQL:**GROUP BY d.[物料编号], d.[颜色]**,SELECT `d.[物料编号], MAX(d.[物料名称]) 物料名称, d.[颜色], MAX(d.[塑胶货号]) 塑胶货号, MAX(cm.[塑胶货号]) 共用货号, MAX(cm.[共用原料编号]) 共用物料, MAX(m.[物料类别]) 物料类别, MAX(d.[单位]) 单位, SUM(d.[数量]) 数量, MAX(d.[单价]) 单价, SUM(ISNULL(d.[金额],0)) 金额`,同 JOIN/WHERE(keyword 去 生产单号/款号 可保留亦可),`ORDER BY d.[物料编号]`。`factory` 字段名读源确认。

- [ ] **Step 3: Controller** Create `PlasticScrapQueryController.cs`:克隆 `PlasticReturnQueryController`,改 `Menu="塑胶报废查询"`、`[Route("api/plastic-scrap-query")]`、注入 `PlasticScrapService`、调 `ScrapQueryDetail/SummaryAsync`。脱敏不变。

- [ ] **Step 4: 菜单** `MenuCatalog.cs` 在 `new("塑胶报表","塑胶退料查询"),` 后加 `new("塑胶报表","塑胶报废查询"),`。

- [ ] **Step 5: 种子** Create `db/seed_plastic_scrap_query_perms.sql`(克隆改菜单 塑胶报废查询),应用两库。

- [ ] **Step 6: 测试** Create `PlasticScrapQueryServiceDbTests.cs`:克隆 `PlasticReturnQueryServiceDbTests`,换 表/服务/Scrap 命名、单号 SQ_D1、物料 SQPM、头 报废部门 D1/报废人 P1、共用物料表 SQPM→塑胶货号 H-SQ/共用原料编号 CR-SQ、明细 塑胶货号 H-SQ 数量 5,3。断言 Detail 报废部门/报废人/共用货号=H-SQ/共用物料=CR-SQ/塑胶货号=H-SQ;**Summary 数量=8**(GROUP BY 物料编号·验单行)+ 审核/物料类别/keyword/区间。`using Dapper;`。

- [ ] **Step 7: 跑测试** focused PASS;`dotnet test` 全绿(372→373)。报告总数。

- [ ] **Step 8: Commit**
```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticScrapQueryServiceDbTests.cs db/seed_plastic_scrap_query_perms.sql
git commit -m @'
feat(塑胶报废查询): ScrapQueryDetail/Summary(克隆退料查询换报废·汇总按物料编号·脱敏)+Controller+菜单+种子+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端(克隆退料查询前端·换报废)

**Files:** Create `web/src/api/plasticScrapQuery.ts`, `web/src/pages/plastics/PlasticScrapDetailDrawer.tsx`, `web/src/pages/plastics/PlasticScrapQueryPage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: API** Create `web/src/api/plasticScrapQuery.ts`:克隆 `plasticReturnQuery.ts`,Return→Scrap、退料部门/退料人→报废部门/报废人、Summary 接口**去 生产单号/款号**、端点 `/plastic-scrap-query/detail`+`/summary`、导出 `plasticScrapQueryApi`。

- [ ] **Step 2: 抽屉** Create `PlasticScrapDetailDrawer.tsx`:克隆 `PlasticReturnDetailDrawer`,menu="塑胶报废查询"、`plasticDocApi("plastic-scraps")`、标题 塑胶报废单、Descriptions 头 报废部门/报废人。

- [ ] **Step 3: 查询页** Create `PlasticScrapQueryPage.tsx`:克隆 `PlasticReturnQueryPage`,MENU="塑胶报废查询"、API=plasticScrapQueryApi、抽屉=PlasticScrapDetailDrawer、明细列 退料部门/退料人→报废部门/报废人(其余不变)、**汇总列去 生产单号/款号**(=物料编号/物料名称/颜色/塑胶货号/共用物料/共用货号/单位/数量/[单价/金额 priceHidden])。

- [ ] **Step 4: 路由+菜单** `App.tsx` 加 import + `<Route path="plastic-scrap-query" element={<PlasticScrapQueryPage />} />`;`menuTree.tsx` 占位 `M("塑胶报废查询")` → 带路由。

- [ ] **Step 5: 测试+构建** `npm --prefix D:\WebpageERP\web run test`(54)+ `run build`(tsc 干净)。

- [ ] **Step 6: Commit**
```powershell
git add web/src/api/plasticScrapQuery.ts web/src/pages/plastics/PlasticScrapDetailDrawer.tsx web/src/pages/plastics/PlasticScrapQueryPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(塑胶报废查询): 前端两Tab查询页+只读抽屉(克隆退料查询换报废·汇总按物料编号·脱敏)+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟** 克隆 `smoke_return_query.js` 换报废(端点 plastic-scrap-query·种 塑胶报废单/明细单 SQ·头报废部门/报废人·物料 BSMK·共用物料表 BSMK→H-BS/CR-BS·塑胶货号 H-BS)。Release 重建(锁先 Stop-Process)+ `--contentRoot 输出目录`。Expected: detail 共用货号 H-BS/共用物料 CR-BS/报废部门/报废人;summary 数量 8(单行·按物料编号);未审核空。
- [ ] **Step 2: opus 全分支终审** 派 opus 审 `feat-plastic-scrap-query`:JOIN 1:1、报废部门/人、塑胶货号=d.塑胶货号、**汇总 GROUP BY 物料编号+颜色(非生产单号)且 Summary 无生产单号/款号字段**、ApprovalFilter、脱敏两 Tab+抽屉、菜单/权限/DI、双击 plastic-scraps、测试自洽、退料/领料模板未动。目标 READY。
- [ ] **Step 3: 合并** `git checkout master; git merge --no-ff feat-plastic-scrap-query -m "...(塑胶报废查询)..."; git branch -d feat-plastic-scrap-query`。
- [ ] **Step 4: worklog + MEMORY** `docs/worklogs/2026-06-27-plastic-scrap-query.md`;更新记忆(③done·④盘点待做)。Commit。

---

## 自审清单
- 克隆点:Return→Scrap·退料→报废·头部门人·端点 plastic-scrap·菜单/路由。
- **关键差异:汇总 GROUP BY 物料编号+颜色(非生产单号)·Summary Row/列去 生产单号/款号。** 其余(明细列/脱敏/JOIN 1:1/ApprovalFilter/抽屉/测试)同②。
- 数据源差异已核:报废明细自带 塑胶货号·无装配采购(同退料)。
