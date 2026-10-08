# 塑胶订单制作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** ⑦塑胶采购「塑胶订单制作」落地——只读单表平铺查询,把已审核(调整审核='1')的塑胶 BOM 按生产单展开(订购数量=用量×计划数量)。

**Architecture:** 后端扩 PlasticMaterialDocService 加 OrderMakeListAsync(生产制单货号 JOIN 塑胶共用物料表 JOIN 生产制单 LEFT JOIN 塑胶物料资料);新 PlasticOrderMakeController(脱敏)。前端单 Tab 平铺页 + 工具栏 + 导出打印。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Vite + AntD v6 + Vitest。

---

## 前置约定

- 分支 `feat-plastic-order-make`;`dotnet`=`C:\Program Files\dotnet\dotnet.exe`,`-c Release`。DB env User scope。提交末尾 Co-Authored-By。
- **冒烟前 `dotnet build -c Release`(锁先 Stop-Process)+ 起后端 `--contentRoot "D:\WebpageERP\src\ErpApi\bin\Release\net8.0"`。**
- 完整 SQL/DTO 见 spec `docs/superpowers/specs/2026-06-29-plastic-order-make-design.md`(① 后端段)。
- 数据源:`生产制单货号`(生产单号/货号)、`塑胶共用物料表`(塑胶货号/工模编号/物料编号/物料名称/颜色/用料名称/加工单价/用量/调整审核)、`生产制单`(生产单号/款号/日期/计划数量·**款号 FK→款号总表**)、`塑胶物料资料`(物料编号/单位)。
- 镜像源(工具栏/导出):`web/src/pages/plastics/PlasticAnalysisDetailPage.tsx` 或 `PlasticOrderQueryPage.tsx`(取其单表那一半)、`web/src/utils/tableExport.ts`、`web/src/auth/permissions.ts`(can/hidePrice)。
- 服务 ctor `PlasticMaterialDocService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)`;`factory.Create()`。

## 文件结构

| 文件 | 责任 | 新建/改 |
|---|---|---|
| `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocDtos.cs` | 加 PlasticOrderMakeRow | 改 |
| `src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocService.cs` | 加 OrderMakeListAsync | 改 |
| `src/ErpApi/Features/Plastics/PlasticOrderMake/PlasticOrderMakeController.cs` | GET·脱敏 | 新建 |
| `src/ErpApi/Features/Admin/MenuCatalog.cs` | 加菜单 塑胶订单制作 | 改 |
| `db/seed_plastic_order_make_perms.sql` | admin 授权 | 新建 |
| `tests/ErpApi.Tests/PlasticOrderMakeServiceDbTests.cs` | 测试 | 新建 |
| `web/src/api/plasticOrderMake.ts` / `PlasticOrderMakePage.tsx` | 前端 | 新建 |
| `web/src/App.tsx` / `web/src/nav/menuTree.tsx` | 路由+菜单 | 改 |

---

## Task 1: 后端 OrderMakeListAsync + Controller + 菜单 + 种子 + 测试

**Files:** Modify `PlasticMaterialDocDtos.cs`, `PlasticMaterialDocService.cs`, `MenuCatalog.cs`; Create `PlasticOrderMakeController.cs`, `db/seed_plastic_order_make_perms.sql`, `PlasticOrderMakeServiceDbTests.cs`

- [ ] **Step 1: DTO** 在 `PlasticMaterialDocDtos.cs` 末尾加 `PlasticOrderMakeRow`(15 字段·见 spec ① DTO 原文)。

- [ ] **Step 2: Service** 在 `PlasticMaterialDocService` 加 `OrderMakeListAsync(起,止,keyword?)`——SQL **照抄 spec ① 后端段的完整 SQL**(`生产制单货号 g JOIN 塑胶共用物料表 p ON p.塑胶货号=g.货号 JOIN 生产制单 pm ON 生产单号 LEFT JOIN (塑胶物料资料 GROUP BY 物料编号) m`·WHERE 日期区间+调整审核='1'+keyword·订购数量=用量×计划数量·金额=订购数量×加工单价·ORDER BY 生产单号,物料编号)。

- [ ] **Step 3: Controller** Create `src/ErpApi/Features/Plastics/PlasticOrderMake/PlasticOrderMakeController.cs`:
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Plastics.PlasticMaterialDoc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticOrderMake;

[ApiController]
[Authorize]
[Route("api/plastic-order-make")]
public sealed class PlasticOrderMakeController(
    PlasticMaterialDocService svc, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶订单制作";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(DateTime 起, DateTime 止, string? keyword = null)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        var rows = await svc.OrderMakeListAsync(起, 止, keyword);
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.单价))
            foreach (var r in rows) { r.加工单价 = null; r.金额 = null; }
        return Ok(rows);
    }
}
```

- [ ] **Step 4: 菜单** `MenuCatalog.cs` 在 `new("塑胶采购","塑胶物料单"),` 后加 `new("塑胶采购","塑胶订单制作"),`。

- [ ] **Step 5: 种子** Create `db/seed_plastic_order_make_perms.sql`(克隆 `db/seed_plastic_order_query_perms.sql` 改菜单 塑胶订单制作),应用两库(同款 PowerShell foreach 片段)。Expected: `ERP_DB ok`/`ERP_TEST_DB ok`。

- [ ] **Step 6: 测试** Create `tests/ErpApi.Tests/PlasticOrderMakeServiceDbTests.cs`(参照 `PlasticAnalysisDetailServiceDbTests` 的种子风格·**款号总表父行先种**):
  - 种:款号总表(K-OM)→生产制单(生产单号 OM-MO·款号 K-OM·日期 '2026-06-10'·计划数量 100)→生产制单货号(生产单号 OM-MO·货号 H-OM)→塑胶共用物料表 2 行(塑胶货号 H-OM·物料 OMPM·用量 2·加工单价 3·**调整审核 '1'**;第二行 物料 OMPM2·调整审核 '0')→塑胶物料资料(OMPM·单位 kg)。
  - 断言:`OrderMakeListAsync(new(2026,6,1),new(2026,6,30),"OMPM")` → 仅 1 行(调整审核 '1' 那行;OMPM2 被过滤)·订购数量=2×100=200·金额=200×3=600·款号="K-OM"·单位="kg"·塑胶货号="H-OM"。区间外(5 月)空;keyword "ZZZ" 空。
  - 清理(反 FK 序:共用物料表/物料资料/生产制单货号/生产制单/款号总表)。`using Dapper;`。ctor `new(Factory(), new DocumentNumberGenerator())`。
  - **注**:`生产制单货号` 表列名读源确认(应为 生产单号/货号);若该表不存在或列不同,READ `BasisAsync` 用法已证实其存在(`JOIN [生产制单货号] g ON g.[货号]=p.[塑胶货号] WHERE g.[生产单号]=...`)。

- [ ] **Step 7: 跑测试** focused PASS;`dotnet test` 全绿(374→375)。报告总数。

- [ ] **Step 8: Commit**
```powershell
git add src/ErpApi tests/ErpApi.Tests/PlasticOrderMakeServiceDbTests.cs db/seed_plastic_order_make_perms.sql
git commit -m @'
feat(塑胶订单制作): OrderMakeList(BOM平铺·调整审核1·订购数量=用量×计划数量·脱敏)+Controller+菜单+种子+测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: 前端 单Tab平铺页 + API + 路由

**Files:** Create `web/src/api/plasticOrderMake.ts`, `web/src/pages/plastics/PlasticOrderMakePage.tsx`; Modify `web/src/App.tsx`, `web/src/nav/menuTree.tsx`

- [ ] **Step 1: API** Create `web/src/api/plasticOrderMake.ts`:
```typescript
import { api } from "./client";
export interface PlasticOrderMakeRow {
  单据日期?: string; 生产单号?: string; 款号?: string; 塑胶货号?: string; 工模编号?: string; 物料编号?: string;
  物料名称?: string; 颜色?: string; 用料名称?: string; 单位?: string;
  用量?: number | null; 计划数量?: number | null; 订购数量?: number | null; 加工单价?: number | null; 金额?: number | null;
}
export interface PlasticOrderMakeParams { 起: string; 止: string; keyword?: string }
export const plasticOrderMakeApi = {
  list: (p: PlasticOrderMakeParams) => api.get<PlasticOrderMakeRow[]>("/plastic-order-make", { params: p }).then(r => r.data),
};
```

- [ ] **Step 2: 页面** Create `web/src/pages/plastics/PlasticOrderMakePage.tsx`(单 Tab 平铺·克隆 `PlasticAnalysisDetailPage` 的工具栏/导出/脱敏骨架,去掉它的"完成情况"过滤与汇总,改列):
  - 工具栏:上月/本月/下月 + `DatePicker.RangePicker`(默认本月)+ `Input.Search`(占位"生产单号/款号/物料")+ 导出EXCIL/打印 + 顶部 `共 ${rows.length} 条`。
  - 列(`ColumnsType<PlasticOrderMakeRow>`):单据日期(slice 10)/生产单号/款号/塑胶货号/工模编号/物料编号/物料名称/颜色/用料名称/单位/用量/计划数量/订购数量/(加工单价/金额·`hidePrice(perms,"塑胶订单制作")` 隐藏·金额 toFixed2)。
  - 权限:`can(perms,"塑胶订单制作","打开")` 守卫;无权显示无权卡片。
  - 导出/打印用 `tableExport`(downloadCsv/printTable·ExportCol·金额/日期 fmt)。
  - 加载:`plasticOrderMakeApi.list({起,止,keyword})`·useEffect 依赖 range/keyword(keyword 用 onSearch 触发)。

- [ ] **Step 3: 路由+菜单** `App.tsx` 加 import + `<Route path="plastic-order-make" element={<PlasticOrderMakePage />} />`(塑胶路由附近);`menuTree.tsx` ⑦ 塑胶采购 占位 `M("塑胶订单制作")` → `M("塑胶订单制作","/plastic-order-make","塑胶订单制作")`。

- [ ] **Step 4: 测试+构建** `npm --prefix D:\WebpageERP\web run test`(54)+ `run build`(tsc 干净)。

- [ ] **Step 5: Commit**
```powershell
git add web/src/api/plasticOrderMake.ts web/src/pages/plastics/PlasticOrderMakePage.tsx web/src/App.tsx web/src/nav/menuTree.tsx
git commit -m @'
feat(塑胶订单制作): 前端单Tab BOM平铺只读页(订购数量=用量×计划数量·导出打印·单价脱敏)+路由+菜单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: 冒烟 + 终审 + 合并 + worklog

- [ ] **Step 1: 冒烟** Release 重建(锁先 Stop-Process)+ 起后端(`--contentRoot 输出目录`)。Node axios:种链(款号总表 K-OMS→生产制单 OMS-MO 计划数量 100→生产制单货号 货号 H-OMS→共用物料表 物料 OMSMK 用量2 加工单价3 调整审核'1'→物料资料 OMSMK 单位 kg)→ `GET /api/plastic-order-make?起=<本月1>&止=<本月末>&keyword=OMSMK` 验 订购数量=200/金额=600/款号 K-OMS/单位 kg;另起一行 调整审核'0' 不出。清理(反序)。Expected: 订购数量=用量×计划数量·调整审核过滤生效。
- [ ] **Step 2: opus 全分支终审** 派 opus 审 `feat-plastic-order-make`:JOIN(生产制单货号→共用物料表[BOM 1:N 正常]→生产制单[1:1]→物料资料[GROUP 1:1])、调整审核='1' 过滤、订购数量=用量×计划数量、金额=订购数量×加工单价、脱敏(加工单价+金额)、菜单/权限/DI、前端单表+导出+脱敏、测试自洽(含款号总表 FK 父行+调整审核 0 被过滤)。目标 READY。
- [ ] **Step 3: 合并** `git checkout master; git merge --no-ff feat-plastic-order-make -m "...(塑胶订单制作)..."; git branch -d feat-plastic-order-make`。
- [ ] **Step 4: worklog + MEMORY** `docs/worklogs/2026-06-29-plastic-order-make.md`;更新记忆(⑦塑胶采购 塑胶订单制作 done)。Commit。

---

## 自审清单
- 已审核口径=塑胶共用物料表.调整审核='1';订购数量=用量×计划数量;金额=订购数量×加工单价;订单单号省略(无源)。
- JOIN:p JOIN g 按 塑胶货号=货号(BOM 展开 1:N 正常),pm/m 1:1。
- 脱敏 加工单价+金额(单一 List·无汇总 Tab)。
- 测试款号总表 FK 父行先种·调整审核'0' 行验证被过滤。
- 菜单组"塑胶采购"已核;前端去掉镜像页的完成情况/汇总。
