# 塑胶进度表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** ⑦塑胶采购「塑胶进度表」——只读单表平铺:塑胶采购订单明细 vs 已审核塑胶入仓(按生产单号+物料编号+颜色),订购/入仓/欠数。

**Architecture:** 扩 PlasticPurchaseOrderService 加 ProgressAsync(LEFT JOIN 物料资料单位 + 已审核入仓聚合);新 PlasticPurchaseProgressController。前端单 Tab 平铺页 + 只看欠数。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + AntD v6 + Vitest。

---

## 前置约定

- 分支 `feat-plastic-purchase-progress`;`dotnet`=`C:\Program Files\dotnet\dotnet.exe`,`-c Release`。DB env User scope。提交末尾 Co-Authored-By。
- **冒烟前 `dotnet build -c Release`(锁先按 PID Stop-Process)+ 起后端 `--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`。**
- 完整 SQL/DTO 见 spec `docs/superpowers/specs/2026-06-29-plastic-purchase-progress-design.md`(① 后端段)。
- 数据源:`塑胶采购订单`/`塑胶采购订单明细`(刚建·db/27)、`塑胶入仓单`/`塑胶入仓明细单`(生产单号/物料编号/颜色/数量/审核)、`塑胶物料资料`(物料编号/单位)。
- 镜像源:`PurchaseOrderService.ProgressAsync`(物料订单进度表·同款 LEFT JOIN 入仓聚合)、前端 `PlasticOrderMakePage`(单 Tab 平铺工具栏/导出)。
- 服务 ctor `PlasticPurchaseOrderService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)`。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `src/ErpApi/Features/Plastics/PlasticPurchaseOrder/PlasticPurchaseOrderDtos.cs` | 加 ProgressRow | 改 |
| `src/ErpApi/Features/Plastics/PlasticPurchaseOrder/PlasticPurchaseOrderService.cs` | 加 ProgressAsync | 改 |
| `src/ErpApi/Features/Plastics/PlasticPurchaseProgress/PlasticPurchaseProgressController.cs` | GET·无脱敏 | 新建 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加菜单 塑胶进度表 | 改 |
| `db/seed_plastic_purchase_progress_perms.sql` | admin 授权 | 新建 |
| `tests/ErpApi.Tests/PlasticPurchaseProgressServiceDbTests.cs` | 测试 | 新建 |
| `web/src/api/plasticPurchaseProgress.ts` / `PlasticPurchaseProgressPage.tsx` | 前端 | 新建 |
| `web/src/App.tsx` / `web/src/nav/menuTree.tsx` | 路由+菜单 | 改 |

---

## Task 1: 后端 ProgressAsync + Controller + 菜单 + 种子 + 测试

**Files:** Modify `PlasticPurchaseOrderDtos.cs`, `PlasticPurchaseOrderService.cs`, `MenuCatalog.cs`; Create `PlasticPurchaseProgressController.cs`, `db/seed_plastic_purchase_progress_perms.sql`, `PlasticPurchaseProgressServiceDbTests.cs`

- [ ] **Step 1: DTO** 在 `PlasticPurchaseOrderDtos.cs` 末尾加 `PlasticPurchaseProgressRow`(15 字段·见 spec ① DTO 原文)。

- [ ] **Step 2: Service** 在 `PlasticPurchaseOrderService` 加 `ProgressAsync(供应商?,起?,止?,keyword?,onlyOwed)`——SQL **照抄 spec ① 后端段**(塑胶采购订单明细 d JOIN 塑胶采购订单 o·LEFT JOIN 物料资料单位·LEFT JOIN 已审核入仓聚合[生产单号+物料编号+ISNULL(颜色,'')]·欠数=订购−入仓·供应商/日期/keyword/onlyOwed 过滤)。

- [ ] **Step 3: Controller** Create `src/ErpApi/Features/Plastics/PlasticPurchaseProgress/PlasticPurchaseProgressController.cs`:
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Plastics.PlasticPurchaseOrder;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticPurchaseProgress;

[ApiController]
[Authorize]
[Route("api/plastic-purchase-progress")]
public sealed class PlasticPurchaseProgressController(
    PlasticPurchaseOrderService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶进度表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(string? 供应商 = null, DateTime? 起 = null, DateTime? 止 = null,
        string? keyword = null, bool onlyOwed = false)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        return Ok(await svc.ProgressAsync(供应商, 起, 止, keyword, onlyOwed));
    }
}
```

- [ ] **Step 4: 菜单** `MenuCatalog.cs` 在 `new("塑胶采购","塑胶采购订单"),` 后加 `new("塑胶采购","塑胶进度表"),`。

- [ ] **Step 5: 种子** Create `db/seed_plastic_purchase_progress_perms.sql`(克隆 `db/seed_plastic_purchase_order_perms.sql` 改菜单 塑胶进度表)·应用两库。

- [ ] **Step 6: 测试** Create `tests/ErpApi.Tests/PlasticPurchaseProgressServiceDbTests.cs`(**免款号总表父行**·ProgressAsync 不 JOIN 生产制单):
  - 种 塑胶采购订单(单号 PP_D1·供应商名称 供A·供应商编号 S01·日期=本月10号·审核'1')+ 塑胶采购订单明细(单号 PP_D1·生产单号 PP-MO·款号 K-PP·物料 PPPM·物料名称 ABS粒·模具编号 GM-PP·颜色 黑·数量 10)+ 塑胶物料资料(PPPM·单位 kg)+ 塑胶入仓单(单号 PPR1·审核'1')+ 塑胶入仓明细单(单号 PPR1·生产单号 PP-MO·物料 PPPM·颜色 黑·数量 4)+ 另一张塑胶入仓单(PPR0·审核'0')+明细(数量 99·同键)。
  - 断言 `ProgressAsync(null, 本月1号, 本月末, "PPPM", false)`:单行·订购数量=10·**入仓数量=4(未审核 99 不计)**·欠数=6·单位=kg·采购单号=PP_D1·供应商名称=供A。
  - `onlyOwed=true`:该行欠 6>0 仍在(1 行)。
  - keyword "ZZZ" 空;供应商 "供A" 命中、"无" 空。
  - 清理(采购订单明细/头·物料资料·两入仓明细/头)。`using Dapper;`·ctor `new(Factory(), new DocumentNumberGenerator())`。

- [ ] **Step 7: 跑测试** focused PASS;`dotnet test` 全绿(380→381)。报告总数。

- [ ] **Step 8: Commit**
```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticPurchaseProgressServiceDbTests.cs db/seed_plastic_purchase_progress_perms.sql
git commit -m @'
feat(塑胶进度表): ProgressAsync(采购订单明细vs已审核入仓·生产单号+物料+颜色·欠数)+Controller+菜单+种子+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 单Tab平铺页 + API + 路由

**Files:** Create `web/src/api/plasticPurchaseProgress.ts`, `web/src/pages/plastics/PlasticPurchaseProgressPage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: API** Create `web/src/api/plasticPurchaseProgress.ts`:
```typescript
import { api } from "./client";
export interface PlasticPurchaseProgressRow {
  订购日期?: string; 交货日期?: string; 采购单号?: string; 生产单号?: string; 款号?: string;
  物料编号?: string; 物料名称?: string; 模具编号?: string; 颜色?: string; 单位?: string;
  订购数量?: number | null; 入仓数量?: number | null; 欠数?: number | null; 供应商名称?: string; 审核?: string;
}
export interface PlasticPurchaseProgressParams { 供应商?: string; 起: string; 止: string; keyword?: string; onlyOwed?: boolean }
export const plasticPurchaseProgressApi = {
  list: (p: PlasticPurchaseProgressParams) => api.get<PlasticPurchaseProgressRow[]>("/plastic-purchase-progress", { params: p }).then(r => r.data),
};
```

- [ ] **Step 2: 页面** Create `web/src/pages/plastics/PlasticPurchaseProgressPage.tsx`(克隆 `PlasticOrderMakePage` 单 Tab 平铺·加供应商/只看欠数):
  - 工具栏:上月/本月/下月 + `DatePicker.RangePicker`(默认本月)+ 供应商 `Input`(placeholder 供应商)+ `Input.Search`(关键词·生产单号/款号/物料)+ **只看欠数 `Checkbox`** + 导出EXCEL/打印 + `共 ${rows.length} 条`。
  - 列(`ColumnsType<PlasticPurchaseProgressRow>`):订购日期(slice10)/交货日期(slice10)/采购单号/生产单号/款号/物料编号/物料名称/模具编号/颜色/单位/订购数量/入仓数量/欠数/供应商名称/审核(已审核/未审核)。**无价格列。**
  - 加载:`plasticPurchaseProgressApi.list({供应商,起,止,keyword,onlyOwed})`·useEffect 依赖 range/供应商/keyword/onlyOwed(keyword 用 onSearch)。
  - 权限:`can(perms,"塑胶进度表","打开")` 守卫。导出/打印用 `tableExport`(日期/审核 fmt)。

- [ ] **Step 3: 路由+菜单** `App.tsx` 加 import + `<Route path="plastic-purchase-progress" element={<PlasticPurchaseProgressPage />} />`;`menuTree.tsx` ⑦ 占位 `M("塑胶进度表")` → `M("塑胶进度表","/plastic-purchase-progress","塑胶进度表")`。

- [ ] **Step 4: 测试+构建** `npm --prefix D:\WebpageERP\web run test`(54)+ `run build`(tsc 干净)。

- [ ] **Step 5: Commit**
```powershell
git add web/src/api/plasticPurchaseProgress.ts web/src/pages/plastics/PlasticPurchaseProgressPage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(塑胶进度表): 前端单Tab平铺进度页(订购/入仓/欠数·只看欠数·导出打印)+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟** Release 重建(锁先按 PID Stop-Process)+ 起后端(`--contentRoot 输出目录`)。Node:种 塑胶采购订单 PPS1(供应商 供A·本月·审核1)+明细(生产单号 PPS-MO·物料 PPSMK·颜色黑·数量10)+物料资料(PPSMK 单位kg)+已审核入仓(生产单号 PPS-MO·物料 PPSMK·颜色黑·数量4)+未审核入仓(数量99)→ `GET /api/plastic-purchase-progress?起=&止=&keyword=PPSMK` 验 订购10/入仓4(未审核99不计)/欠6;`&onlyOwed=true` 该行在。清理。Expected: 入仓只计已审核·欠数=订购−入仓。
- [ ] **Step 2: opus 全分支终审** 派 opus 审 `feat-plastic-purchase-progress`:JOIN(采购订单明细→采购订单·LEFT JOIN 物料资料单位[GROUP 1:1]·LEFT JOIN 已审核入仓聚合[生产单号+物料+颜色键])、入仓只计审核='1'、欠数=订购−入仓、供应商/日期半开/keyword/onlyOwed 过滤、菜单/权限/DI、前端单表+只看欠数+导出、测试自洽(未审核入仓不计·免款号总表父行)、其它模块未动。目标 READY。
- [ ] **Step 3: 合并** `git checkout master; git merge --no-ff feat-plastic-purchase-progress -m "...(塑胶进度表)..."; git branch -d feat-plastic-purchase-progress`。
- [ ] **Step 4: worklog + MEMORY** `docs/worklogs/2026-06-29-plastic-purchase-progress.md`;更新记忆(塑胶进度表 done·进度明细表待做)。Commit。

---

## 自审清单
- 入仓关联键=生产单号+物料编号+ISNULL(颜色,'')·只计审核='1'·欠数=订购−入仓(可负)。
- 日期过滤按采购订单 o.日期·半开。
- 无价格→无脱敏。
- 测试免款号总表父行(ProgressAsync 不 JOIN 生产制单)·验未审核入仓不计。
- 镜像物料 PurchaseOrderService.ProgressAsync(同款入仓聚合 LEFT JOIN)。
