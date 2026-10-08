# 原料采购订单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ⑪ 原料仓库「原料采购订单」全屏主从录入单,审核纯锁定不动库存,镜像塑胶加工采购单(供应商头+原料明细带价)去 BOM 调入。

**Architecture:** 新两表 `原料采购订单`/`原料采购订单明细`;新 `Features/Plastics/PlasticRawMaterialPurchaseOrder/`(DTOs/Service/Controller)克隆 PlasticProcessPurchaseOrder;审核走 PostingEngine(加白名单)。前端克隆塑胶加工采购单页 + 复用 SupplierPicker/PlasticRawMaterialPicker。

**Tech Stack:** .NET 8 + Dapper;React 18 + TS + Ant Design v6;xUnit + SkippableFact。

---

## Task 1: 建表 SQL + 过账白名单 + DI

**Files:**
- Create: `db/32_raw_material_purchase_order.sql`
- Modify: `src/ErpApi/Engines/Posting/PostableDocuments.cs`
- Modify: `src/ErpApi/Program.cs`

- [ ] **Step 1: 建表 SQL** — `db/32_raw_material_purchase_order.sql`:
```sql
-- 原料采购订单(原料仓库·采购计划)·头 + 明细。审核纯锁定不动库存。EF 不迁移·幂等。
IF OBJECT_ID(N'[原料采购订单]', N'U') IS NULL
CREATE TABLE [原料采购订单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [供应商编号] nvarchar(40) NULL,
    [供应商名称] nvarchar(80) NULL,
    [订购日期] datetime NULL,
    [交货日期] datetime NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[原料采购订单明细]', N'U') IS NULL
CREATE TABLE [原料采购订单明细] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [原料编号] nvarchar(40) NULL,
    [原料名称] nvarchar(80) NULL,
    [规格] nvarchar(60) NULL,
    [单位] nvarchar(20) NULL,
    [单价类型] nvarchar(20) NULL,
    [订货数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
```

- [ ] **Step 2: 应用两库**(localdb 停止态先 `SqlLocalDB start MSSQLLocalDB`,取 `np:\\.\pipe\...`):
```
sqlcmd -S "<pipe>" -d erp -i D:\WebpageERP\db\32_raw_material_purchase_order.sql
sqlcmd -S "<pipe>" -d erp_test -i D:\WebpageERP\db\32_raw_material_purchase_order.sql
```

- [ ] **Step 3: 过账白名单** — `PostableDocuments.cs` 在 `["原料生产需求表"] = "单号",` 之后加:
```csharp
            ["原料采购订单"] = "单号",
```

- [ ] **Step 4: DI(类待 Task2·本任务不编译)** — `Program.cs` 在 `PlasticRawMaterialDemandService` 注册行后加:
```csharp
builder.Services.AddScoped<ErpApi.Features.Plastics.PlasticRawMaterialPurchaseOrder.PlasticRawMaterialPurchaseOrderService>();
```

- [ ] **Step 5: Commit**
```bash
git add db/32_raw_material_purchase_order.sql src/ErpApi/Engines/Posting/PostableDocuments.cs src/ErpApi/Program.cs
git commit -m "feat(原料采购订单): 建表+过账白名单+DI"
```

---

## Task 2: 后端 DTOs + Service + Controller + 菜单/权限

**Files:**
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialPurchaseOrder/PlasticRawMaterialPurchaseOrderDtos.cs`
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialPurchaseOrder/PlasticRawMaterialPurchaseOrderService.cs`
- Create: `src/ErpApi/Features/Plastics/PlasticRawMaterialPurchaseOrder/PlasticRawMaterialPurchaseOrderController.cs`
- Create: `db/seed_raw_material_purchase_order_perms.sql`
- Modify: `src/ErpApi/Features/Admin/MenuCatalog.cs`

- [ ] **Step 1: DTOs** — `PlasticRawMaterialPurchaseOrderDtos.cs`:
```csharp
namespace ErpApi.Features.Plastics.PlasticRawMaterialPurchaseOrder;

public sealed class PlasticRawMaterialPurchaseOrderHeaderDto
{
    public long ID { get; set; }
    public string 单号 { get; set; } = "";
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public DateTime? 订购日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialPurchaseOrderLineDto
{
    public long ID { get; set; }
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public string? 单价类型 { get; set; }
    public decimal 订货数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialPurchaseOrderDetailDto
{
    public PlasticRawMaterialPurchaseOrderHeaderDto? 单头 { get; set; }
    public List<PlasticRawMaterialPurchaseOrderLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticRawMaterialPurchaseOrderCreateLineDto
{
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public string? 单价类型 { get; set; }
    public decimal 订货数量 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticRawMaterialPurchaseOrderCreateDto
{
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 备注 { get; set; }
    public List<PlasticRawMaterialPurchaseOrderCreateLineDto> 明细 { get; set; } = new();
}
```

- [ ] **Step 2: Service** — `PlasticRawMaterialPurchaseOrderService.cs`(镜像 PlasticProcessPurchaseOrderService 去 BasisAsync·头换供应商·明细换原料+单价类型):
```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticRawMaterialPurchaseOrder;

// 原料采购订单(原料仓库·采购计划)。审核 = 纯锁定(走通用过账引擎只翻 审核='1',不动库存)。
public sealed class PlasticRawMaterialPurchaseOrderService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "原料采购订单";
    public const string Prefix = "YCD";   // 原料采购订单号 = YCD + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(PlasticRawMaterialPurchaseOrderCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("原料采购订单至少要有一行明细");
        var 数量合计 = dto.明细.Sum(l => l.订货数量);
        var 金额合计 = dto.明细.Sum(l => l.订货数量 * (l.单价 ?? 0m));
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [原料采购订单]([单号],[供应商编号],[供应商名称],[订购日期],[交货日期],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@供应商编号,@供应商名称,@订购日期,@交货日期,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, dto.供应商编号, dto.供应商名称, 订购日期 = now, dto.交货日期,
                  数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [原料采购订单明细]([单号],[原料编号],[原料名称],[规格],[单位],[单价类型],[订货数量],[单价],[金额],[备注])
VALUES(@单号,@原料编号,@原料名称,@规格,@单位,@单价类型,@订货数量,@单价,@金额,@备注)",
                new { 单号, l.原料编号, l.原料名称, l.规格, l.单位, l.单价类型, l.订货数量, l.单价,
                      金额 = l.订货数量 * (l.单价 ?? 0m), l.备注 }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticRawMaterialPurchaseOrderHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [原料采购订单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw;
SELECT [ID],[单号],[供应商编号],[供应商名称],[订购日期],[交货日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [原料采购订单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticRawMaterialPurchaseOrderHeaderDto>()).AsList();
        return new PagedResult<PlasticRawMaterialPurchaseOrderHeaderDto>(items, total);
    }

    public async Task<PlasticRawMaterialPurchaseOrderDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[供应商编号],[供应商名称],[订购日期],[交货日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [原料采购订单] WHERE [单号]=@单号;
SELECT [ID],[原料编号],[原料名称],[规格],[单位],[单价类型],[订货数量],[单价],[金额],[备注]
FROM [原料采购订单明细] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticRawMaterialPurchaseOrderHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticRawMaterialPurchaseOrderLineDto>()).AsList();
        return new PlasticRawMaterialPurchaseOrderDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [原料采购订单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的原料采购订单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [原料采购订单明细] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [原料采购订单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
```

- [ ] **Step 3: Controller** — `PlasticRawMaterialPurchaseOrderController.cs`(镜像 PlasticProcessPurchaseOrderController·带价脱敏):
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Plastics.PlasticRawMaterialPurchaseOrder;

[ApiController]
[Authorize]
[Route("api/plastic-raw-material-purchase-order")]
public sealed class PlasticRawMaterialPurchaseOrderController(
    PlasticRawMaterialPurchaseOrderService svc, IPostingEngine posting, IPermissionService perms) : ControllerBase
{
    private const string Menu = "原料采购订单";
    private const string Table = "原料采购订单";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private Task<bool> CanPrice() => perms.HasAsync(CurrentUser, Menu, PermissionAction.单价);

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var result = await svc.ListAsync(page, size, keyword);
        if (!await CanPrice())
            foreach (var h in result.Items) h.金额 = null;
        return Ok(result);
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号);
        if (d is null) return NotFound();
        if (!await CanPrice())
        {
            if (d.单头 is not null) d.单头.金额 = null;
            foreach (var l in d.明细) { l.单价 = null; l.金额 = null; }
        }
        return Ok(d);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] PlasticRawMaterialPurchaseOrderCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        return CreatedAtAction(nameof(Get), new { 单号 }, new { 单号 });
    }

    [HttpDelete("{单号}")]
    public async Task<IActionResult> Delete(string 单号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try { if (!await svc.DeleteAsync(单号)) return NotFound(); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        return NoContent();
    }

    [HttpPost("{单号}/approve")]
    public async Task<IActionResult> Approve(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        if (!await posting.ApproveAsync(Table, 单号, CurrentUser)) return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        return NoContent();
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        if (!await posting.UnapproveAsync(Table, 单号, CurrentUser)) return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        return NoContent();
    }
}
```

- [ ] **Step 4: 菜单 + 权限种子** — `MenuCatalog.cs` 的 `All` 加 `new("原料仓库","原料采购订单"),`(原料仓库组就近)。
`db/seed_raw_material_purchase_order_perms.sql`（**先 `ls db/ | grep raw_material_purchase_order` 确认未占用**）:
```sql
-- 开发用:给 admin 授予 原料采购订单 菜单 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] = N'原料采购订单';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'原料采购订单',1,1,1,1,1,1,1,1,1);
```
应用两库。

- [ ] **Step 5: 编译** → `dotnet build src/ErpApi/ErpApi.csproj -c Debug`(0 错误)。
- [ ] **Step 6: Commit**
```bash
git add src/ErpApi/Features/Plastics/PlasticRawMaterialPurchaseOrder/ src/ErpApi/Features/Admin/MenuCatalog.cs db/seed_raw_material_purchase_order_perms.sql
git commit -m "feat(原料采购订单): 后端DTOs+Service+Controller+菜单权限"
```

---

## Task 3: 后端 DB 测试

**Files:** Create `tests/ErpApi.Tests/PlasticRawMaterialPurchaseOrderServiceDbTests.cs`

- [ ] **Step 1: 写测试**(镜像 PlasticProcessPurchaseOrderServiceDbTests·无 basis):
```csharp
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Posting;
using ErpApi.Features.Plastics.PlasticRawMaterialPurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PlasticRawMaterialPurchaseOrderServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private PlasticRawMaterialPurchaseOrderService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [原料采购订单明细] WHERE [原料编号]=N'YCD-PM'");
        c.Execute("DELETE FROM [原料采购订单] WHERE [供应商名称]=N'YCD测试供应商'");
    }

    private static PlasticRawMaterialPurchaseOrderCreateDto MakeDto() => new()
    {
        供应商编号 = "S01",
        供应商名称 = "YCD测试供应商",
        明细 =
        {
            new() { 原料编号 = "YCD-PM", 原料名称 = "ABS粒", 规格 = "规X", 单位 = "kg", 单价类型 = "含税", 订货数量 = 5, 单价 = 3 },
            new() { 原料编号 = "YCD-PM", 原料名称 = "ABS粒", 规格 = "规X", 单位 = "kg", 单价类型 = "含税", 订货数量 = 3, 单价 = 3 },
        }
    };

    [SkippableFact]
    public async Task Create_then_Get_sums_and_amount()
    {
        using var c = fx.Open(); Clean(c);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.StartsWith("YCD", 单号);
            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal(8m, d!.单头!.数量);
            Assert.Equal(24m, d.单头!.金额);
            Assert.Equal(2, d.明细.Count);
            Assert.Equal("YCD-PM", d.明细[0].原料编号);
            Assert.Equal("含税", d.明细[0].单价类型);
            Assert.Equal(15m, d.明细[0].金额);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Approve_flips_审核_and_writes_审核日期()
    {
        using var c = fx.Open(); Clean(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.True(await engine.ApproveAsync("原料采购订单", 单号, "tester"));
            var d = await Svc().GetAsync(单号);
            Assert.Equal("1", d!.单头!.审核);
            var 审核日期 = c.ExecuteScalar<DateTime?>("SELECT [审核日期] FROM [原料采购订单] WHERE [单号]=@单号", new { 单号 });
            Assert.NotNull(审核日期);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Delete_approved_throws()
    {
        using var c = fx.Open(); Clean(c);
        var engine = new PostingEngine(Factory(), new AuditLogger());
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");
            Assert.True(await engine.ApproveAsync("原料采购订单", 单号, "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(单号));
        }
        finally { Clean(c); }
    }
}
```
注:`DbFixture`/`fx.Open()`/`PostingEngine(Factory(), new AuditLogger())` 以 `PlasticProcessPurchaseOrderServiceDbTests.cs` 为准。原料采购订单无 FK,不种父行。

- [ ] **Step 2-4**:本测试 3 passed → 全量(409→412)→ commit `test(原料采购订单): create求和金额/approve/delete已审核抛错`。

---

## Task 4: 前端 api + LineTable + Page + 路由 + 菜单

**Files:**
- Create: `web/src/api/plasticRawMaterialPurchaseOrder.ts`
- Create: `web/src/pages/plastics/PlasticRawMaterialPurchaseOrderLineTable.tsx`
- Create: `web/src/pages/plastics/PlasticRawMaterialPurchaseOrderPage.tsx`
- Modify: `web/src/App.tsx` / `web/src/nav/menuTree.tsx`

- [ ] **Step 1: api** — `web/src/api/plasticRawMaterialPurchaseOrder.ts`:
```ts
import { api } from "./client";
import type { Paged } from "./master";

export interface RMPOLine {
  id?: number;
  原料编号?: string; 原料名称?: string; 规格?: string; 单位?: string; 单价类型?: string;
  订货数量?: number; 单价?: number | null; 金额?: number | null; 备注?: string;
}
export interface RMPOHeader {
  id: number; 单号?: string; 供应商编号?: string; 供应商名称?: string; 订购日期?: string; 交货日期?: string;
  数量?: number | null; 金额?: number | null; 操作员?: string; 审核?: string; 审核人?: string; 备注?: string;
}
export interface RMPODetail { 单头?: RMPOHeader; 明细: RMPOLine[] }

const enc = encodeURIComponent;
const base = "/plastic-raw-material-purchase-order";
export const plasticRawMaterialPurchaseOrderApi = {
  list: (page = 1, size = 10, keyword = "") => api.get<Paged<RMPOHeader>>(base, { params: { page, size, keyword } }).then(r => r.data),
  get: (单号: string) => api.get<RMPODetail>(`${base}/${enc(单号)}`).then(r => r.data),
  create: (body: Record<string, unknown>) => api.post<{ 单号: string }>(base, body).then(r => r.data),
  remove: (单号: string) => api.delete(`${base}/${enc(单号)}`),
  approve: (单号: string) => api.post(`${base}/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`${base}/${enc(单号)}/unapprove`),
};
```

- [ ] **Step 2: LineTable** — `web/src/pages/plastics/PlasticRawMaterialPurchaseOrderLineTable.tsx`(克隆 PlasticProcessPurchaseOrderLineTable·原料编号🔍 PlasticRawMaterialPicker·单价类型 Select):
```tsx
import { useState, type Dispatch, type SetStateAction } from "react";
import { Button, Input, InputNumber, Select, Table } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import PlasticRawMaterialPicker from "./PlasticRawMaterialPicker";
import type { PlasticRawMaterialRow } from "../../api/plasticRawMaterialMaster";
import type { RMPOLine } from "../../api/plasticRawMaterialPurchaseOrder";

// 原料采购订单明细可编辑行:原料编号🔍|原料名称只读|规格|单位|单价类型(下拉)|订货数量|单价|金额|备注|删除。带价 hidePrice。
export default function PlasticRawMaterialPurchaseOrderLineTable({ value, onChange, readOnly, hidePrice }: {
  value: RMPOLine[];
  onChange: Dispatch<SetStateAction<RMPOLine[]>>;
  readOnly?: boolean;
  hidePrice?: boolean;
}) {
  const setLine = (i: number, patch: Partial<RMPOLine>) =>
    onChange(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const [matPickFor, setMatPickFor] = useState<number | null>(null);

  const fillFromMaterial = (row: PlasticRawMaterialRow) => {
    if (matPickFor === null) return;
    setLine(matPickFor, {
      原料编号: row.物料编号 ?? undefined, 原料名称: row.物料名称 ?? undefined,
      规格: row.规格 ?? undefined, 单位: row.单位 ?? undefined, 单价: row.单价 ?? undefined,
    });
  };

  const txt = (val: string | undefined, on: (s: string) => void, w: number) =>
    <Input style={{ width: w }} value={val ?? ""} disabled={readOnly} onChange={e => on(e.target.value)} />;
  const ro = (v?: string | number | null) => <span>{v ?? ""}</span>;
  const lineAmt = (r: RMPOLine) => Number(r.订货数量 ?? 0) * Number(r.单价 ?? 0);

  const columns: ColumnsType<RMPOLine> = [
    { title: "原料编号", dataIndex: "原料编号", width: 150, render: (_, r, i) =>
      <Input style={{ width: 128 }} value={r.原料编号 ?? ""} disabled={readOnly} onChange={e => setLine(i, { 原料编号: e.target.value })}
        suffix={readOnly ? null : <SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={() => setMatPickFor(i)} />} /> },
    { title: "原料名称", dataIndex: "原料名称", width: 150, render: (v: string) => ro(v) },
    { title: "规格", dataIndex: "规格", width: 100, render: (_, r, i) => txt(r.规格, s => setLine(i, { 规格: s }), 88) },
    { title: "单位", dataIndex: "单位", width: 70, render: (_, r, i) => txt(r.单位, s => setLine(i, { 单位: s }), 58) },
    { title: "单价类型", dataIndex: "单价类型", width: 100, render: (_, r, i) =>
      <Select style={{ width: 88 }} disabled={readOnly} value={r.单价类型} onChange={v => setLine(i, { 单价类型: v })}
        options={[{ value: "含税" }, { value: "未税" }]} /> },
    { title: "订货数量", dataIndex: "订货数量", width: 100, render: (_, r, i) => <InputNumber min={0} precision={2} style={{ width: 88 }} disabled={readOnly} value={r.订货数量 ?? 0} onChange={n => setLine(i, { 订货数量: Number(n ?? 0) })} /> },
    ...(hidePrice ? [] : [
      { title: "单价", dataIndex: "单价", width: 100, render: (_: unknown, r: RMPOLine, i: number) => <InputNumber min={0} precision={4} style={{ width: 88 }} disabled={readOnly} value={r.单价 ?? 0} onChange={n => setLine(i, { 单价: Number(n ?? 0) })} /> },
      { title: "金额", dataIndex: "_amt", width: 100, align: "right" as const, render: (_: unknown, r: RMPOLine) => lineAmt(r).toFixed(2) },
    ]),
    { title: "备注", dataIndex: "备注", width: 130, render: (_, r, i) => txt(r.备注, s => setLine(i, { 备注: s }), 118) },
    ...(readOnly ? [] : [{ title: "", key: "_op", width: 50, render: (_: unknown, __: RMPOLine, i: number) => <a onClick={() => onChange(prev => prev.filter((_, j) => j !== i))}>删除</a> }]),
  ];

  return (
    <div>
      <Table size="small" rowKey={(_: RMPOLine, i?: number) => String(i)} pagination={false}
        dataSource={value} columns={columns} scroll={{ x: "max-content" }} />
      {!readOnly && <Button icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={() => onChange(prev => [...prev, { 订货数量: 0, 单价类型: "含税" }])}>加一行</Button>}
      <PlasticRawMaterialPicker open={matPickFor !== null} onPick={fillFromMaterial} onClose={() => setMatPickFor(null)} />
    </div>
  );
}
```

- [ ] **Step 3: Page** — `web/src/pages/plastics/PlasticRawMaterialPurchaseOrderPage.tsx`(克隆 PlasticProcessPurchaseOrderPage·去调入清单·SupplierPicker 头·DatePicker 交货日期):
```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Col, DatePicker, Form, Input, Popconfirm, Row, Space, Statistic, Table, Tag, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { plasticRawMaterialPurchaseOrderApi, type RMPOHeader, type RMPOLine } from "../../api/plasticRawMaterialPurchaseOrder";
import SupplierPicker from "./SupplierPicker";
import PlasticRawMaterialPurchaseOrderLineTable from "./PlasticRawMaterialPurchaseOrderLineTable";
import { can, hidePrice } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";

const MENU = "原料采购订单";
const today = () => new Date().toLocaleDateString("zh-CN");
const currentUser = () => localStorage.getItem("erp_user") ?? "";

export default function PlasticRawMaterialPurchaseOrderPage() {
  const perms = usePerms();
  const canOpen = can(perms, MENU, "打开");
  const priceHidden = hidePrice(perms, MENU);
  const [form] = Form.useForm<Record<string, unknown>>();
  const [lines, setLines] = useState<RMPOLine[]>([]);
  const [rows, setRows] = useState<RMPOHeader[]>([]);
  const [opened, setOpened] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [supOpen, setSupOpen] = useState(false);
  const readOnly = opened !== null;

  const loadRows = useCallback(async () => {
    try { setRows((await plasticRawMaterialPurchaseOrderApi.list(1, 50, "")).items); }
    catch { message.error("加载原料采购订单失败"); }
  }, []);
  useEffect(() => { if (canOpen) loadRows(); }, [canOpen, loadRows]);

  const reset = useCallback(() => {
    form.resetFields();
    form.setFieldsValue({ 订购日期: today(), 操作员: currentUser() });
    setLines([]); setOpened(null);
  }, [form]);
  useEffect(() => { reset(); }, [reset]);

  const openDoc = async (单号: string) => {
    try {
      const d = await plasticRawMaterialPurchaseOrderApi.get(单号);
      const h = d.单头 ?? {} as RMPOHeader;
      form.setFieldsValue({
        供应商编号: h.供应商编号, 供应商名称: h.供应商名称, 备注: h.备注, 操作员: h.操作员,
        订购日期: h.订购日期?.slice(0, 10),
        交货日期: h.交货日期 ? dayjs(h.交货日期) : undefined,
      });
      setLines(d.明细 ?? []); setOpened(单号);
    } catch { message.error("打开原料采购订单失败"); }
  };

  const save = async () => {
    if (readOnly) { message.info("查看模式:请先「新建」再录入"); return; }
    let v: Record<string, unknown>;
    try { v = await form.validateFields(); } catch { return; }
    const ok = lines.filter(l => l.原料编号 && Number(l.订货数量) > 0);
    if (ok.length === 0) { message.error("请至少录入一行有效明细(原料编号+订货数量)"); return; }
    const 交货日期 = v.交货日期 ? (v.交货日期 as dayjs.Dayjs).format("YYYY-MM-DD") : null;
    setSaving(true);
    try {
      await plasticRawMaterialPurchaseOrderApi.create({ ...v, 交货日期, 明细: ok });
      message.success("原料采购订单已创建"); reset(); loadRows();
    } catch (e) {
      message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "创建失败");
    } finally { setSaving(false); }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); message.success(ok); loadRows(); }
    catch (e) { message.error((e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? "操作失败"); }
  };

  const 数量合计 = lines.reduce((s, l) => s + Number(l.订货数量 ?? 0), 0);
  const 金额合计 = lines.reduce((s, l) => s + Number(l.订货数量 ?? 0) * Number(l.单价 ?? 0), 0);

  const listColumns: ColumnsType<RMPOHeader> = [
    { title: "单号", dataIndex: "单号", key: "单号", render: (v: string) => <a onClick={() => openDoc(v)} className="erp-num">{v}</a> },
    { title: "供应商", dataIndex: "供应商名称", key: "供应商名称" },
    { title: "数量", dataIndex: "数量", key: "数量" },
    { title: "订购日期", dataIndex: "订购日期", key: "订购日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "交货日期", dataIndex: "交货日期", key: "交货日期", render: (v?: string) => v?.slice(0, 10) },
    { title: "状态", dataIndex: "审核", key: "审核", render: (v?: string) => v === "1" ? <Tag color="green" style={{ borderRadius: 6 }}>已审核</Tag> : <Tag style={{ borderRadius: 6 }}>未审核</Tag> },
    {
      title: "操作", key: "_op",
      render: (_: unknown, row: RMPOHeader) => (
        <Space>
          {row.审核 !== "1" && can(perms, MENU, "审核") && <a onClick={() => act(() => plasticRawMaterialPurchaseOrderApi.approve(row.单号!), "已审核")}>审核</a>}
          {row.审核 === "1" && can(perms, MENU, "反审核") && <a onClick={() => act(() => plasticRawMaterialPurchaseOrderApi.unapprove(row.单号!), "已反审核")}>反审核</a>}
          {row.审核 !== "1" && can(perms, MENU, "删除") && (
            <Popconfirm title="确认删除该原料采购订单?" onConfirm={() => act(() => plasticRawMaterialPurchaseOrderApi.remove(row.单号!), "已删除")}><a>删除</a></Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  if (!canOpen) {
    return <Card variant="borderless"><div style={{ padding: 24, color: "#999" }}>无权访问该页面（缺少"原料采购订单·打开"权限）。</div></Card>;
  }

  return (
    <Card title={`原料采购订单${readOnly ? `（查看 ${opened}）` : "（新建）"}`} variant="borderless"
      extra={
        <Space wrap>
          <Button onClick={reset}>新建</Button>
          {can(perms, MENU, "保存") && <Button type="primary" loading={saving} disabled={readOnly} onClick={save}>保存</Button>}
          <Button onClick={() => window.print()}>打印</Button>
        </Space>
      }>
      <Form form={form} layout="vertical" size="small">
        <Row gutter={12}>
          <Col span={7}>
            <Form.Item name="供应商名称" label="供应商" rules={[{ required: true, message: "请选供应商" }]}>
              <Input readOnly placeholder="点🔍选供应商"
                suffix={readOnly ? null : <SearchOutlined style={{ cursor: "pointer", color: "#1677ff" }} onClick={() => setSupOpen(true)} />} />
            </Form.Item>
            <Form.Item name="供应商编号" hidden><Input /></Form.Item>
          </Col>
          <Col span={4}><Form.Item name="订购日期" label="订购日期"><Input disabled /></Form.Item></Col>
          <Col span={4}><Form.Item name="交货日期" label="交货日期"><DatePicker style={{ width: "100%" }} disabled={readOnly} /></Form.Item></Col>
          <Col span={4}><Form.Item name="操作员" label="操作员"><Input disabled /></Form.Item></Col>
          <Col span={5}><Form.Item name="备注" label="备注"><Input disabled={readOnly} /></Form.Item></Col>
        </Row>
      </Form>

      <PlasticRawMaterialPurchaseOrderLineTable value={lines} onChange={setLines} readOnly={readOnly} hidePrice={priceHidden} />

      <Space style={{ marginTop: 16 }} size={32}>
        <Statistic title="数量合计" value={数量合计} />
        {!priceHidden && <Statistic title="金额合计" value={金额合计} precision={2} />}
        <Statistic title="制单人" value={currentUser()} />
      </Space>

      <div style={{ marginTop: 24 }}>
        <Table rowKey="id" size="middle" dataSource={rows} columns={listColumns} pagination={{ pageSize: 10 }} />
      </div>

      <SupplierPicker open={supOpen}
        onPick={row => form.setFieldsValue({ 供应商编号: row.供应商编号, 供应商名称: row.供应商名称 })}
        onClose={() => setSupOpen(false)} />
    </Card>
  );
}
```
注:`SupplierPicker` 的 onPick 行字段(供应商编号/供应商名称)以现有 `web/src/pages/plastics/SupplierPicker.tsx` 为准——若字段名不同照其改。`PlasticRawMaterialRow` 字段(物料编号/物料名称/规格/单位/单价)来自 `plasticRawMaterialMaster.ts`。

- [ ] **Step 4: 路由 + 菜单** — `App.tsx` import + `<Route path="plastic-raw-material-purchase-order" .../>`;`menuTree.tsx` `M("原料采购订单")` → 三参。
- [ ] **Step 5: tsc + vitest** → `cd web && npx tsc --noEmit`(0)；`npx vitest run`(54)。
- [ ] **Step 6: Commit** `feat(原料采购订单): 前端 api+LineTable+录入页+路由+菜单`。

---

## Task 5: HTTP 冒烟 + 终审 + 合并

- [ ] **Step 1**: Release 编译(锁先 PID Stop-Process)+ 起后端 `--contentRoot`。
- [ ] **Step 2 冒烟**:登录 → POST 建(2 明细·5/3·单价3)→ approve → GET 验 审核1/数量8/金额24/明细2/单价类型含税 → 已审核删拒409 → 反审核后删。
- [ ] **Step 3 opus 终审**:① 审核纯锁定不动库存·白名单仅加一行;② INSERT 列对齐·数量/金额 SUM·金额=订货数量×单价;③ 已审核删抛错;④ 前缀 YCD;⑤ 单价/金额脱敏(list 金额·get 单价/金额)·菜单/权限(**种子文件名未撞**)/DI/路由/menuTree 齐;⑥ 前端 SupplierPicker+PlasticRawMaterialPicker 回填·单价类型下拉·hidePrice 隐藏单价/金额列+合计·审核/删除门控;⑦ 全参数化·未动既有。READY 才合并。
- [ ] **Step 4 合并**:`--no-ff` 合并 master·删分支;worklog `docs/worklogs/2026-06-30-raw-material-purchase-order.md`;MEMORY。
