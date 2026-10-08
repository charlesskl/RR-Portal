# 塑胶领料查询 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 塑胶领料单 只读两 Tab 查询(汇总按生产单号 + 明细)+ 明细双击只读抽屉;共用货号=塑胶货号、共用物料=共用原料编号(LEFT JOIN 共用物料表);带价脱敏。确立 4 张塑胶单据查询模板。

**Architecture:** 后端扩 PlasticIssueService 加 IssueQueryDetail/Summary + ApprovalFilter;新 PlasticIssueQueryController。前端两 Tab 页(镜像 PlasticOrderQueryPage)+ 新只读抽屉 PlasticIssueDetailDrawer。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + Ant Design v6 + Vitest。

---

## 前置约定

- 工作目录 `D:\WebpageERP`,分支 `feat-plastic-issue-query`,完成 `--no-ff` 合并 master 删分支。`dotnet`=`C:\Program Files\dotnet\dotnet.exe`,锁 DLL 用 `-c Release`。
- DB env 从 User 取:`ERP_TEST_DB`/`ERP_JWT_KEY`/`ERP_DB`。前端 `npm --prefix D:\WebpageERP\web run test`/`build`。
- 提交末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- **坑:冒烟前 `dotnet build -c Release`(锁 DLL 先 `Stop-Process`)+ 起后端 `--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`(否则 JWT 401)。**
- 完整 SQL 见 spec `docs/superpowers/specs/2026-06-27-plastic-issue-query-design.md`(① 后端段·已含 Detail/Summary 全 SQL)。
- 镜像源:`web/src/pages/plastics/PlasticOrderQueryPage.tsx`(两 Tab+工具栏)、`web/src/api/plasticOrderQuery.ts`、`web/src/api/plasticMaterialMaster.ts`(categories)、`web/src/utils/tableExport.ts`、`web/src/auth/permissions.ts`(can/hidePrice)。
- 数据源:`塑胶领料单`(头 日期/领料部门/领料人/审核)+ `塑胶领料明细单`(装配采购/生产单号/款号/物料编号/模具编号/物料名称/规格/颜色/色粉号/用料名称/仓位号/单位/数量/单价/金额/备注·有 `[ID]`)。`塑胶共用物料表`(物料编号/塑胶货号/共用原料编号)。`塑胶物料资料`(物料编号/物料类别)。
- 领料 GET 整单:`api/plastic-issues`(`PlasticIssueService.GetAsync`)返回 头+明细。前端通用 `plasticDocApi("plastic-issues").get(单号)`。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `src/ErpApi/Features/Plastics/PlasticIssue/PlasticIssueDtos.cs` | 加 2 Query DTO | 改 |
| `src/ErpApi/Features/Plastics/PlasticIssue/PlasticIssueService.cs` | ApprovalFilter + Detail/Summary | 改 |
| `src/ErpApi/Features/Plastics/PlasticIssueQuery/PlasticIssueQueryController.cs` | /detail + /summary·脱敏 | 新建 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加菜单 | 改 |
| `db/seed_plastic_issue_query_perms.sql` | admin 授权 | 新建 |
| `tests/ErpApi.Tests/PlasticIssueQueryServiceDbTests.cs` | Detail/Summary/过滤测试 | 新建 |
| `web/src/api/plasticIssueQuery.ts` | typed API | 新建 |
| `web/src/pages/plastics/PlasticIssueDetailDrawer.tsx` | 只读整单抽屉 | 新建 |
| `web/src/pages/plastics/PlasticIssueQueryPage.tsx` | 两 Tab 查询页 | 新建 |
| `web/src/App.tsx` / `web/src/nav/menuTree.tsx` | 路由 + 菜单 | 改 |

---

## Task 1: 后端 Detail/Summary + Controller + 菜单 + 种子 + 测试

**Files:** Modify `PlasticIssueDtos.cs`, `PlasticIssueService.cs`, `MenuCatalog.cs`; Create `PlasticIssueQueryController.cs`, `db/seed_plastic_issue_query_perms.sql`, `tests/ErpApi.Tests/PlasticIssueQueryServiceDbTests.cs`

- [ ] **Step 1: DTO** 在 `PlasticIssueDtos.cs` 末尾加(每字段独立属性):

```csharp
public sealed class PlasticIssueQueryDetailRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 领料部门 { get; set; }
    public string? 领料人 { get; set; }
    public string? 装配采购 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 共用物料 { get; set; }
    public string? 共用货号 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class PlasticIssueQuerySummaryRow
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 共用物料 { get; set; }
    public string? 共用货号 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}
```

- [ ] **Step 2: Service 方法** 在 `PlasticIssueService` 类内加 `ApprovalFilter` + 两方法。SQL **照抄 spec ① 后端段的 Detail/Summary SQL**(已完整)。方法骨架:

```csharp
    private static string ApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL(h.[审核],'0')='1'",
        "未审核" => " AND ISNULL(h.[审核],'0')<>'1'",
        _ => "",
    };

    public async Task<IReadOnlyList<PlasticIssueQueryDetailRow>> IssueQueryDetailAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticIssueQueryDetailRow>($@"<spec Detail SQL>", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticIssueQuerySummaryRow>> IssueQuerySummaryAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticIssueQuerySummaryRow>($@"<spec Summary SQL>", new { qi, qe, kw, cat });
        return rows.AsList();
    }
```
注:`factory` 字段名以 `PlasticIssueService` 现有 ctor 为准(读源确认,通常 `factory`)。`<spec ... SQL>` 用 spec 里完整 SQL 原文替换(含 `{ApprovalFilter(审核情况)}` 插值)。

- [ ] **Step 3: Controller** Create `src/ErpApi/Features/Plastics/PlasticIssueQuery/PlasticIssueQueryController.cs`:

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Plastics.PlasticIssue;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticIssueQuery;

[ApiController]
[Authorize]
[Route("api/plastic-issue-query")]
public sealed class PlasticIssueQueryController(
    PlasticIssueService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶领料查询";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> CanPrice() => perms.HasAsync(CurrentUser, Menu, PermissionAction.单价);

    [HttpGet("detail")]
    public async Task<IActionResult> Detail(DateTime 起, DateTime 止, string? keyword = null,
        [FromQuery(Name = "审核情况")] string? 审核情况 = null, [FromQuery(Name = "物料类别")] string? 物料类别 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.IssueQueryDetailAsync(起, 止, keyword, 审核情况, 物料类别);
        if (!await CanPrice()) foreach (var r in rows) { r.单价 = null; r.金额 = null; }
        return Ok(rows);
    }

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(DateTime 起, DateTime 止, string? keyword = null,
        [FromQuery(Name = "审核情况")] string? 审核情况 = null, [FromQuery(Name = "物料类别")] string? 物料类别 = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.IssueQuerySummaryAsync(起, 止, keyword, 审核情况, 物料类别);
        if (!await CanPrice()) foreach (var r in rows) { r.单价 = null; r.金额 = null; }
        return Ok(rows);
    }
}
```

- [ ] **Step 4: 菜单** `MenuCatalog.cs` 在 `new("塑胶报表","塑胶标签查询"),` 后加 `new("塑胶报表","塑胶领料查询"),`。

- [ ] **Step 5: 种子** Create `db/seed_plastic_issue_query_perms.sql`(admin 9 位·菜单 塑胶领料查询·照 `db/seed_plastic_label_query_perms.sql` 改菜单名),应用两库(同 label 查询的 PowerShell 片段)。Expected: `ERP_DB ok`/`ERP_TEST_DB ok`。

- [ ] **Step 6: 测试** Create `tests/ErpApi.Tests/PlasticIssueQueryServiceDbTests.cs`(参照 `PlasticLabelQueryServiceDbTests`):种 塑胶共用物料表(物料编号 IQPM→塑胶货号 H-IQ/共用原料编号 CR-IQ)+塑胶物料资料(IQPM·物料类别 ABS)+塑胶领料单(单号 IQ_D1·日期 2026-06-10·审核'1'·领料部门 D1/领料人 P1)+塑胶领料明细单(2 行·生产单号 IQ-MO/款号 K-IQ/物料 IQPM/颜色 黑/数量 5,3/单价 2)→ `IssueQueryDetailAsync(2026-06-01..30,"IQPM",null,null)` 2 行·验 共用货号="H-IQ"/共用物料="CR-IQ"/塑胶货号="H-IQ"/领料部门="D1"/领料人="P1"/审核="1";`IssueQuerySummaryAsync` 1 行·数量=8/共用货号="H-IQ"/物料类别="ABS";审核情况(未审核空/已审核2)、物料类别(不存在空/ABS 2)、区间外空。清理 DELETE 明细/单/共用物料表/物料资料。**含 `using Dapper;`。** ctor 以 PlasticIssueService 现有签名为准。

- [ ] **Step 7: 跑测试** `dotnet test --filter "FullyQualifiedName~PlasticIssueQueryServiceDbTests"` PASS;`dotnet test` 全绿(370→371)。报告总数。

- [ ] **Step 8: Commit**
```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticIssueQueryServiceDbTests.cs db/seed_plastic_issue_query_perms.sql
git commit -m @'
feat(塑胶领料查询): IssueQueryDetail/Summary(共用物料/货号LEFT JOIN·脱敏)+Controller+菜单+种子+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 两Tab查询页 + 只读抽屉 + API + 路由

**Files:** Create `web/src/api/plasticIssueQuery.ts`, `web/src/pages/plastics/PlasticIssueDetailDrawer.tsx`, `web/src/pages/plastics/PlasticIssueQueryPage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: API** `web/src/api/plasticIssueQuery.ts`:

```typescript
import { api } from "./client";
export interface PlasticIssueQueryDetailRow {
  日期?: string; 单号?: string; 生产单号?: string; 款号?: string; 领料部门?: string; 领料人?: string; 装配采购?: string;
  物料编号?: string; 物料名称?: string; 颜色?: string; 塑胶货号?: string; 共用物料?: string; 共用货号?: string; 单位?: string;
  数量?: number | null; 单价?: number | null; 金额?: number | null; 备注?: string; 审核?: string;
}
export interface PlasticIssueQuerySummaryRow {
  生产单号?: string; 款号?: string; 物料编号?: string; 物料名称?: string; 颜色?: string; 塑胶货号?: string;
  共用物料?: string; 共用货号?: string; 物料类别?: string; 单位?: string; 数量?: number | null; 单价?: number | null; 金额?: number | null;
}
export interface PlasticIssueQueryParams { 起: string; 止: string; keyword?: string; 审核情况?: string; 物料类别?: string }
export const plasticIssueQueryApi = {
  detail: (p: PlasticIssueQueryParams) => api.get<PlasticIssueQueryDetailRow[]>("/plastic-issue-query/detail", { params: p }).then(r => r.data),
  summary: (p: PlasticIssueQueryParams) => api.get<PlasticIssueQuerySummaryRow[]>("/plastic-issue-query/summary", { params: p }).then(r => r.data),
};
```

- [ ] **Step 2: 只读抽屉** `web/src/pages/plastics/PlasticIssueDetailDrawer.tsx`:先 READ `web/src/api/plasticDocs.ts`(`plasticDocApi("plastic-issues").get` 返回 `{单头,明细}`)与现成某 `*DetailDrawer`(如物料侧 `MaterialDocDetailDrawer.tsx`)对照。实现 props `{ open: boolean; 单号?: string; onClose: () => void }`:open 且有单号时 GET 拉单,Drawer 内 Descriptions 头(单号/日期/领料部门/领料人/审核)+ Table 明细(物料编号/物料名称/规格/颜色/单位/数量/单价/金额/备注·`hidePrice(perms,"塑胶领料查询")` 隐藏单价/金额)。

```tsx
import { useEffect, useState } from "react";
import { Drawer, Descriptions, Table, Tag } from "antd";
import { plasticDocApi } from "../../api/plasticDocs";
import { hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

export default function PlasticIssueDetailDrawer({ open, 单号, onClose }: { open: boolean; 单号?: string; onClose: () => void }) {
  const perms = usePerms();
  const priceHidden = hidePrice(perms, "塑胶领料查询");
  const [head, setHead] = useState<Record<string, unknown> | null>(null);
  const [lines, setLines] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    if (!open || !单号) return;
    plasticDocApi("plastic-issues").get(单号).then(d => {
      setHead((d.单头 ?? null) as Record<string, unknown> | null);
      setLines((d.明细 ?? []) as Record<string, unknown>[]);
    }).catch(() => { setHead(null); setLines([]); });
  }, [open, 单号]);
  const cols = [
    { title: "物料编号", dataIndex: "物料编号" }, { title: "物料名称", dataIndex: "物料名称" },
    { title: "规格", dataIndex: "规格" }, { title: "颜色", dataIndex: "颜色" },
    { title: "单位", dataIndex: "单位" }, { title: "数量", dataIndex: "数量", align: "right" as const },
    ...(priceHidden ? [] : [
      { title: "单价", dataIndex: "单价", align: "right" as const },
      { title: "金额", dataIndex: "金额", align: "right" as const },
    ]),
    { title: "备注", dataIndex: "备注" },
  ];
  return (
    <Drawer open={open} onClose={onClose} width={900} title={`塑胶领料单 ${单号 ?? ""}`}>
      {head && (
        <Descriptions size="small" column={3} bordered style={{ marginBottom: 16 }}>
          <Descriptions.Item label="单号">{String(head.单号 ?? "")}</Descriptions.Item>
          <Descriptions.Item label="日期">{String(head.日期 ?? "").slice(0, 10)}</Descriptions.Item>
          <Descriptions.Item label="领料部门">{String(head.领料部门 ?? "")}</Descriptions.Item>
          <Descriptions.Item label="领料人">{String(head.领料人 ?? "")}</Descriptions.Item>
          <Descriptions.Item label="审核">{head.审核 === "1" ? <Tag color="green">已审核</Tag> : <Tag>未审核</Tag>}</Descriptions.Item>
        </Descriptions>
      )}
      <Table rowKey={(_, i) => String(i)} size="small" dataSource={lines} columns={cols} pagination={false} scroll={{ x: "max-content" }} />
    </Drawer>
  );
}
```
注:`plasticDocApi("plastic-issues").get` 返回结构若不同(如 `单头` 实为 `头`),以 READ 实际类型为准修正。

- [ ] **Step 3: 查询页** `web/src/pages/plastics/PlasticIssueQueryPage.tsx`:克隆 `PlasticOrderQueryPage.tsx`,改:MENU="塑胶领料查询"、API=plasticIssueQueryApi、明细列=[日期/单号/生产单号/款号/领料部门/领料人/装配采购/物料编号/物料名称/颜色/塑胶货号/共用物料/共用货号/单位/数量/(单价/金额 priceHidden 隐藏)/备注/审核]、汇总列=[生产单号/款号/物料编号/物料名称/颜色/塑胶货号/共用物料/共用货号/单位/数量/(单价/金额 隐藏)]、明细 `onDoubleClick` → `setViewing(r.单号)` 打开 `PlasticIssueDetailDrawer`。导出按 Tab。列用 `ColumnsType<Row>` 标注。`审核` 列渲染 已审核/未审核。

- [ ] **Step 4: 路由+菜单** `App.tsx` 加 import + `<Route path="plastic-issue-query" element={<PlasticIssueQueryPage />} />`;`menuTree.tsx` 占位 `M("塑胶领料查询")` → `M("塑胶领料查询","/plastic-issue-query","塑胶领料查询")`。

- [ ] **Step 5: 测试+构建** `npm --prefix D:\WebpageERP\web run test`(54 不减)+ `run build`(tsc 干净)。

- [ ] **Step 6: Commit**
```powershell
git add web/src/api/plasticIssueQuery.ts web/src/pages/plastics/PlasticIssueDetailDrawer.tsx web/src/pages/plastics/PlasticIssueQueryPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(塑胶领料查询): 前端两Tab查询页+只读抽屉(双击开单·单价脱敏)+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟** 确保 Release 新(`dotnet build -c Release`·锁先 Stop-Process)→ 起后端(`--contentRoot 输出目录`)。Node axios:种链(共用物料表 ISMK→塑胶货号 H-IS/共用原料编号 CR-IS·物料资料·领料单本月审核1 领料部门/人·明细物料 ISMK 数量 5/3 单价 2)→ `GET /api/plastic-issue-query/detail?起=&止=&keyword=ISMK` 2 行(共用货号 H-IS/共用物料 CR-IS/领料部门/人)→ `/summary` 1 行(数量 8)→ 清理。Expected: 共用货号/共用物料/领料部门人 正确,汇总数量 8。

- [ ] **Step 2: opus 全分支终审** 派 opus 审 `feat-plastic-issue-query`:JOIN(领料明细→单头·LEFT JOIN 共用物料表[GROUP 1:1]·LEFT JOIN 物料资料[GROUP 1:1])不放大、共用货号=塑胶货号/共用物料=共用原料编号、汇总 GROUP BY 生产单号+款号+物料编号+颜色、ApprovalFilter、单价/金额脱敏(明细+汇总)、菜单/权限/DI、前端两 Tab+双击只读抽屉(GET plastic-issues)+categories+导出、测试自洽。目标 READY。

- [ ] **Step 3: 合并** `git checkout master; git merge --no-ff feat-plastic-issue-query -m "..."; git branch -d feat-plastic-issue-query`(消息含 塑胶领料查询)。

- [ ] **Step 4: worklog + MEMORY** Create `docs/worklogs/2026-06-27-plastic-issue-query.md`;更新塑胶记忆(标 #2-4 退料/报废/盘点查询 待做·模板已立)。Commit。

---

## 自审清单(已核对)

- Spec 覆盖:DTO/方法/Controller/菜单/种子/测试=Task1;api/抽屉/页/路由=Task2;冒烟/终审/合并=Task3。
- 类型一致:前端 Row 接口=后端 DTO;detail/summary=Controller 端点。
- JOIN 1:1:共用物料表/物料资料 均 GROUP BY 物料编号 子查询。
- 脱敏:明细+汇总 单价/金额 无权限置 null;前端 hidePrice 隐藏 + 抽屉 hidePrice。
- 双击:PlasticIssueDetailDrawer 按单号 GET plastic-issues。
- 共用映射:共用货号=塑胶货号、共用物料=共用原料编号(已确认)。
- content root + Release 新:冒烟 Step1 明确。
