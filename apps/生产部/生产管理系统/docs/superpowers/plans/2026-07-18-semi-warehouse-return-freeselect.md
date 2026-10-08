# 半成品退仓单（自由选产品版）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「半成品退仓单」从旧的「按原入仓单核销可退数量」模型改写成截图所示的「自由选产品」模型：选已审核入仓单带出供应商/仓库 → 点“资料”从产品库自由选产品录退仓数量 → 审核实时减半成品库存。

**Architecture:** 复用现有 `半成品退仓单/半成品退仓明细单` 两表（仅调整明细唯一键与 `入仓明细ID` 可空）；ASP.NET Core 控制器保留权限/月结锁/日志，Dapper 服务改为自由选产品（保存时按 `物料编号+仓库` 从已审核入仓明细派生权威 颜色/规格/单位/单价/生产单号，保证实时库存 union 正确净额）；React 页面镜像半成品标签单骨架，明细来源换成复用标签 `products` 选择器。审核不显式过账——现有 `InventorySummaryService.SemiSql` 已把审核过的退仓明细计为 `数量*-1`。

**Tech Stack:** SQL Server migration, ASP.NET Core 8, Dapper, xUnit, React 19, TypeScript, Ant Design 6, Vitest.

## Global Constraints

- 菜单/路由/DI/权限均已存在，不新增接入：菜单 `半成品仓库 > 半成品退仓`，路由 `/semi-warehouse-returns`，权限菜单名 `半成品退仓`，前缀 `BRT`。
- 半成品库存为实时台账，退仓明细必须落库 `仓库 / 物料编号 / 颜色 / 数量`，否则减库存不正确。审核只翻审核位，不写台账。
- 每次只暂存本任务明确列出的文件；工作区有大量无关改动，不运行会覆盖用户文件的格式化命令。
- 后端启动时会锁 `bin/ErpApi.dll`：跑 `dotnet build`/`dotnet test` 前先停掉在跑的后端进程（前端 dev server 不影响）。
- 金额/单价按 `单价` 权限脱敏（list 头金额、get 明细单价金额置 null）。

## File Structure

- `db/migrate_semi_warehouse_returns.sql` — 调整：`入仓明细ID` 改可空、唯一键改 `(单号,物料编号)`，加幂等升级块。
- `src/ErpApi/Features/Warehouse/Semi/SemiWarehouseReturnDtos.cs` — 明细输入加产品字段；新增产品行 DTO。
- `src/ErpApi/Features/Warehouse/Semi/SemiWarehouseReturnService.cs` — 改写保存为自由选产品 + 新增 `ProductsAsync` + `GetAdjacentAsync`；保留 List/Get/Delete/SetApproved。
- `src/ErpApi/Features/Warehouse/Semi/SemiWarehouseReturnController.cs` — 去掉 `basis`，加 `products` 与 `adjacent`。
- `web/src/api/semi.ts` — 重写 SWR 类型 + api（products / adjacent，去 basis）。
- `web/src/utils/semiWarehouseReturn.ts` — 重写合并去重/校验（自由选产品）。
- `web/src/pages/warehouse/SemiWarehouseReturnPage.tsx` — 镜像标签单骨架重写。
- `tests/ErpApi.Tests/SemiWarehouseReturnServiceDbTests.cs`（若不存在则创建）— 全生命周期 + 库存净额。
- `web/src/__tests__/semiWarehouseReturn.test.ts` — utils 纯计算。

---

## Task 1: 调整明细表结构（可空来源ID + 新唯一键）

**Files:**
- Modify: `db/migrate_semi_warehouse_returns.sql`

- [ ] **Step 1: 把 CREATE TABLE 里的 `[入仓明细ID]` 改为可空并换唯一键**

在 `db/migrate_semi_warehouse_returns.sql` 的 `半成品退仓明细单` 定义中：
- 将 `[入仓明细ID] bigint NOT NULL,` 改为 `[入仓明细ID] bigint NULL,`
- 删除 `CONSTRAINT [UQ_半成品退仓明细单_来源] UNIQUE ([单号], [入仓明细ID]),`
- 在 `CONSTRAINT [CK_半成品退仓明细单_数量] CHECK ([数量] > 0)` 之前加入：
  `CONSTRAINT [UQ_半成品退仓明细单_物料] UNIQUE ([单号], [物料编号]),`
- 删除 `CREATE INDEX [IX_半成品退仓明细单_入仓明细ID] ...` 那一行。

- [ ] **Step 2: 追加幂等升级块（处理已按旧结构部署的库）**

在 `COMMIT TRANSACTION;` 之前插入：

```sql
-- 升级：旧结构（入仓明细ID NOT NULL + UQ_来源）迁到自由选产品结构
IF OBJECT_ID(N'[半成品退仓明细单]', N'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = N'UQ_半成品退仓明细单_来源')
        ALTER TABLE [半成品退仓明细单] DROP CONSTRAINT [UQ_半成品退仓明细单_来源];
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_半成品退仓明细单_入仓明细ID' AND object_id = OBJECT_ID(N'[半成品退仓明细单]'))
        DROP INDEX [IX_半成品退仓明细单_入仓明细ID] ON [半成品退仓明细单];
    IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[半成品退仓明细单]') AND name = N'入仓明细ID' AND is_nullable = 0)
        ALTER TABLE [半成品退仓明细单] ALTER COLUMN [入仓明细ID] bigint NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = N'UQ_半成品退仓明细单_物料')
        ALTER TABLE [半成品退仓明细单] ADD CONSTRAINT [UQ_半成品退仓明细单_物料] UNIQUE ([单号], [物料编号]);
END;
```

- [ ] **Step 3: 部署迁移验证结构**

Run:
```powershell
dotnet run --project tools/DbDeploy -- $env:ERP_TEST_DB db/migrate_semi_warehouse_returns.sql
```
Expected: 成功，无报错。

- [ ] **Step 4: Commit**

```bash
git add db/migrate_semi_warehouse_returns.sql
git commit -m "db: relax semi warehouse return detail for free-select model"
```

---

## Task 2: 后端 DTO（明细输入带产品字段 + 产品行 DTO）

**Files:**
- Modify: `src/ErpApi/Features/Warehouse/Semi/SemiWarehouseReturnDtos.cs`

- [ ] **Step 1: 重写 `SemiWarehouseReturnLineInput` 为携带产品快照**

把现有 `SemiWarehouseReturnLineInput` 替换为：

```csharp
public sealed class SemiWarehouseReturnLineInput
{
    public string 配件编号 { get; set; } = "";
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 生产单号 { get; set; }
    public decimal 数量 { get; set; }
    public string? 备注 { get; set; }
}
```

- [ ] **Step 2: `SemiWarehouseReturnCreateDto.入仓单号` 保持必填语义（不改），新增产品行 DTO**

在文件末尾追加：

```csharp
public sealed class SemiWarehouseReturnProductQuery
{
    public int Page { get; set; } = 1;
    public int Size { get; set; } = 50;
    public string? Field { get; set; }
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
}

public sealed class SemiWarehouseReturnProductRow
{
    public string 配件编号 { get; set; } = "";
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 生产单号 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 库存单价 { get; set; }
}
```

- [ ] **Step 3: 删除不再使用的 `SemiWarehouseReturnBasisRow` 的核销字段（保留列供 Get 复用）**

`SemiWarehouseReturnBasisRow` 仍被 `SemiWarehouseReturnLineRowDto` 继承用于 Get 返回明细列，保留不动（其 `原入仓数量/已退数量/可退数量` 字段前端 Get 时忽略即可）。无需改动本类。

- [ ] **Step 4: 编译占位（下一任务实现服务后再整体编译）**

本任务不单独编译，DTO 改动随 Task 3 一起验证。

- [ ] **Step 5: Commit**

```bash
git add src/ErpApi/Features/Warehouse/Semi/SemiWarehouseReturnDtos.cs
git commit -m "feat: semi warehouse return line input carries product snapshot"
```

---

## Task 3: 后端 Service 改写（自由选产品保存 + products + adjacent）

**Files:**
- Modify: `src/ErpApi/Features/Warehouse/Semi/SemiWarehouseReturnService.cs`
- Test: `tests/ErpApi.Tests/SemiWarehouseReturnServiceDbTests.cs`

- [ ] **Step 1: 先写会失败的库存净额测试**

在 `tests/ErpApi.Tests/SemiWarehouseReturnServiceDbTests.cs` 写（若文件已存在则替换旧核销测试为下列内容；沿用仓库中其他 `*ServiceDbTests` 的 fixture/连接串获取方式，参照 `tests/ErpApi.Tests/SemiReceiptServiceDbTests.cs` 的 setup 样板）：

```csharp
// 断言：自由选产品建单→审核→半成品库存按 物料编号 减少；反审核恢复。
// 前置：先用 SemiReceiptService 建并审核一张入仓单（供应商/仓库/物料编号=BRT-M1，数量100），
// 再自由选产品退仓30，审核后 InventorySummaryService.SemiFinishedAsync(仓库) 中该物料库存=70。
[Fact]
public async Task Approve_reduces_semi_inventory_by_returned_quantity()
{
    // Arrange: 建审核入仓单（复用 SemiReceiptService，物料编号 M1，仓库 WH1，数量 100）
    var receiptNo = await SeedApprovedReceiptAsync(material: "M1", warehouse: "WH1", qty: 100m, price: 2m);
    var svc = new SemiWarehouseReturnService(Factory, DocNo);
    // Act: 自由选产品退仓 30
    var dto = new SemiWarehouseReturnCreateDto {
        入仓单号 = receiptNo, 日期 = DateTime.Today, 仓库 = "WH1",
        明细 = [ new() { 配件编号 = "M1", 数量 = 30m } ]
    };
    var no = await svc.CreateAsync(dto, "tester");
    await svc.SetApprovedAsync(no, "tester", true);
    // Assert: 库存 70
    var inv = new InventorySummaryService(Factory);
    var rows = await inv.SemiFinishedAsync("WH1");
    Assert.Equal(70m, rows.Single(r => r.物料编号 == "M1").库存);
    // 反审核恢复 100
    await svc.SetApprovedAsync(no, "tester", false);
    rows = await inv.SemiFinishedAsync("WH1");
    Assert.Equal(100m, rows.Single(r => r.物料编号 == "M1").库存);
}
```

> 说明：`SeedApprovedReceiptAsync` 为本测试类私有辅助，用 `SemiReceiptService`（`tests` 已有其 DB 测试可参照）建并审核一张入仓单，明细 `物料编号=M1,物料名称='半成品M1',仓库=WH1,数量=100,单价=2,颜色=''`。`Factory`/`DocNo` 沿用其他 DB 测试类的字段。

- [ ] **Step 2: 运行测试确认失败**

先停后端进程，再：
```powershell
dotnet test tests/ErpApi.Tests --filter Approve_reduces_semi_inventory_by_returned_quantity
```
Expected: FAIL（`CreateAsync` 仍要求 `入仓明细ID`，或编译失败于新 DTO 字段）。

- [ ] **Step 3: 改写 `SaveCoreAsync` 为自由选产品并加派生查询**

用下列实现替换 `SaveCoreAsync`（保留方法签名，去掉 `入仓明细ID` 核销逻辑）：

```csharp
private static async Task SaveCoreAsync(System.Data.IDbConnection c, System.Data.IDbTransaction tx, string no, SemiWarehouseReturnCreateDto dto, string user, bool update)
{
    if (string.IsNullOrWhiteSpace(dto.入仓单号)) throw new ArgumentException("请先选择原入仓单号。");
    if (dto.明细.Count == 0) throw new ArgumentException("至少选择一行退仓产品。");
    if (dto.明细.Any(x => string.IsNullOrWhiteSpace(x.配件编号))) throw new ArgumentException("配件编号必填。");
    if (dto.明细.Any(x => x.数量 <= 0)) throw new ArgumentException("退仓数量必须大于 0。");
    if (dto.明细.GroupBy(x => x.配件编号!.Trim(), StringComparer.OrdinalIgnoreCase).Any(g => g.Count() > 1))
        throw new ArgumentException("同一单据内配件编号不能重复。");

    var source = await c.QuerySingleOrDefaultAsync<SemiReceiptHeaderDto>(
        "SELECT * FROM [半成品入仓单] WITH (UPDLOCK,HOLDLOCK) WHERE [单号]=@n AND ISNULL([审核],'0')='1'",
        new { n = dto.入仓单号 }, tx);
    if (source is null) throw new InvalidOperationException("原入仓单不存在或尚未审核。");
    var warehouse = source.仓库;
    var date = dto.日期?.Date ?? DateTime.Today;

    // 按 物料编号 + 仓库 从已审核入仓明细派生权威 颜色/规格/单位/单价/生产单号（保证库存 union 净额正确）
    var lines = new List<(SemiWarehouseReturnLineInput In, ReceiptFacts F)>();
    foreach (var input in dto.明细)
    {
        var mat = input.配件编号!.Trim();
        var f = await c.QuerySingleOrDefaultAsync<ReceiptFacts>(@"
SELECT TOP (1) d.[颜色],d.[规格],d.[单位],d.[单价],d.[生产单号],d.[订单单号],d.[货号],d.[名称],d.[物料名称],d.[客户]
FROM [半成品入仓明细单] d JOIN [半成品入仓单] h ON h.[单号]=d.[单号]
WHERE d.[物料编号]=@mat AND d.[仓库]=@wh AND ISNULL(h.[审核],'0')='1'
ORDER BY d.[ID] DESC;", new { mat, wh = warehouse }, tx) ?? new ReceiptFacts();
        lines.Add((input, f));
    }

    var totalQty = dto.明细.Sum(x => x.数量);
    var totalAmt = lines.Sum(l => l.In.数量 * (l.F.单价 ?? 0m));

    if (update)
        await c.ExecuteAsync(@"UPDATE [半成品退仓单] SET [入仓单号]=@入仓单号,[日期]=@date,[供应商编号]=@sc,[供应商名称]=@sn,[仓库]=@wh,[数量]=@qty,[金额]=@amt,[操作员]=@user,[备注]=@备注 WHERE [单号]=@no",
            new { no, dto.入仓单号, date, sc = source.供应商编号, sn = source.供应商名称, wh = warehouse, qty = totalQty, amt = totalAmt, user, dto.备注 }, tx);
    else
        await c.ExecuteAsync(@"INSERT INTO [半成品退仓单]([单号],[入仓单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[备注]) VALUES(@no,@入仓单号,@date,@sc,@sn,@wh,@qty,@amt,@user,'0',@备注)",
            new { no, dto.入仓单号, date, sc = source.供应商编号, sn = source.供应商名称, wh = warehouse, qty = totalQty, amt = totalAmt, user, dto.备注 }, tx);

    foreach (var (input, f) in lines)
    {
        var price = f.单价 ?? 0m;
        await c.ExecuteAsync(@"INSERT INTO [半成品退仓明细单]
([单号],[入仓单号],[入仓明细ID],[日期],[供应商编号],[供应商名称],[仓库],[订单单号],[客户],[生产单号],[货号],[名称],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注])
VALUES(@no,@receipt,NULL,@date,@sc,@sn,@wh,@orderNo,@customer,@prodNo,@goodsNo,@name,@mat,@matName,@spec,@color,@unit,@qty,@price,@amt,@remark)",
            new {
                no, receipt = dto.入仓单号, date, sc = source.供应商编号, sn = source.供应商名称, wh = warehouse,
                orderNo = f.订单单号, customer = input.客户 ?? f.客户, prodNo = input.生产单号 ?? f.生产单号,
                goodsNo = input.产品货号 ?? f.货号, name = input.产品名称 ?? f.名称,
                mat = input.配件编号!.Trim(), matName = input.产品装配名称 ?? f.物料名称,
                spec = f.规格, color = f.颜色, unit = f.单位,
                qty = input.数量, price, amt = input.数量 * price, remark = input.备注
            }, tx);
    }
}

private sealed class ReceiptFacts
{
    public string? 颜色 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 货号 { get; set; }
    public string? 名称 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 客户 { get; set; }
}
```

- [ ] **Step 4: 简化 `SetApprovedAsync`（去掉可退数量核销校验，仅校验入仓单仍审核）**

把 `SetApprovedAsync` 中 `if (approved) { ... ValidateApprovalAsync ... }` 块替换为仅校验来源入仓单仍为审核态，并删除 `ValidateApprovalAsync` 方法：

```csharp
if (approved)
{
    var sourceApproved = await c.ExecuteScalarAsync<int>(
        "SELECT COUNT(*) FROM [半成品入仓单] WITH (UPDLOCK,HOLDLOCK) WHERE [单号]=@receiptNo AND ISNULL([审核],'0')='1'",
        new { receiptNo = header.入仓单号 }, tx);
    if (sourceApproved == 0) throw new InvalidOperationException("审核失败：原入仓单不存在或已反审核。");
}
```

（删除 `ValidateApprovalAsync` 整个方法，并删除文件顶部对它的调用；`SemiWarehouseReturnLineInput` 已改结构，旧的 `SELECT [入仓明细ID],[数量] ...` 读取行一并删除。）

- [ ] **Step 5: 新增 `ProductsAsync`（复用标签 products CTE + 带 生产单号）**

在类中新增（CTE 与 `SemiFinishedLabelOrderService.QueryProductsAsync` 一致，外层加 `OUTER APPLY` 取最近已审核入仓明细的 生产单号）：

```csharp
public async Task<PagedResult<SemiWarehouseReturnProductRow>> ProductsAsync(SemiWarehouseReturnProductQuery query, bool canSeePrice)
{
    var page = Math.Max(query.Page, 1);
    var size = Math.Clamp(query.Size, 1, 200);
    var keyword = string.IsNullOrWhiteSpace(query.Keyword) ? null : query.Keyword.Trim();
    var match = keyword is null || query.Exact ? keyword : $"%{keyword}%";
    var field = query.Field switch
    {
        "产品名称" => "b.[产品名称]",
        "配件编号" => "b.[配件编号]",
        "客户" => "b.[客户]",
        "产品装配名称" => "b.[产品装配名称]",
        _ => "b.[产品货号]"
    };
    var comparer = query.Exact ? "=" : "LIKE";
    var cte = $@"
WITH LatestHeader AS (
    SELECT h.*, ROW_NUMBER() OVER (PARTITION BY h.[款号] ORDER BY h.[ID] DESC) AS rn
    FROM [款号物料总表] h WHERE NULLIF(LTRIM(RTRIM(h.[款号])), N'') IS NOT NULL
), DetailFallback AS (
    SELECT d.[款号], MAX(NULLIF(LTRIM(RTRIM(d.[客户名称])), N'')) AS [客户名称],
           MAX(NULLIF(LTRIM(RTRIM(d.[客户])), N'')) AS [客户], MAX(NULLIF(LTRIM(RTRIM(d.[款式])), N'')) AS [款式]
    FROM [款号物料明细表] d GROUP BY d.[款号]
), Base AS (
    SELECT COALESCE(NULLIF(LTRIM(RTRIM(s.[配件编号])), N''), h.[产品编号]) AS [配件编号],
           COALESCE(NULLIF(LTRIM(RTRIM(s.[产品装配名称])), N''), NULLIF(LTRIM(RTRIM(h.[款式])), N''), d.[款式]) AS [产品装配名称],
           COALESCE(NULLIF(LTRIM(RTRIM(h.[客户名称])), N''), NULLIF(LTRIM(RTRIM(h.[客户])), N''), d.[客户名称], d.[客户]) AS [客户],
           h.[款号] AS [产品货号], NULLIF(LTRIM(RTRIM(h.[款式])), N'') AS [产品名称],
           q.[单价] AS [加工单价], s.[库存单价HK] AS [库存单价]
    FROM LatestHeader h
    LEFT JOIN [半成品共用物料设置] s ON s.[产品货号]=h.[款号]
    LEFT JOIN DetailFallback d ON d.[款号]=h.[款号]
    OUTER APPLY (SELECT TOP (1) quote.[单价] FROM [装配物料报价] quote WHERE quote.[产品货号]=h.[款号] AND quote.[单价] IS NOT NULL ORDER BY quote.[是否默认] DESC, quote.[顺序], quote.[ID]) q
    WHERE h.rn=1
), Filtered AS (
    SELECT b.*, pf.[生产单号] FROM Base b
    OUTER APPLY (SELECT TOP (1) rd.[生产单号] FROM [半成品入仓明细单] rd JOIN [半成品入仓单] rh ON rh.[单号]=rd.[单号]
                 WHERE rd.[物料编号]=b.[配件编号] AND ISNULL(rh.[审核],'0')='1' AND NULLIF(LTRIM(RTRIM(rd.[生产单号])),N'') IS NOT NULL
                 ORDER BY rd.[ID] DESC) pf
    WHERE NULLIF(LTRIM(RTRIM(b.[配件编号])), N'') IS NOT NULL AND (@keyword IS NULL OR {field} {comparer} @match)
)";
    var sql = $@"{cte}
SELECT COUNT(*) FROM Filtered;
{cte}
SELECT [配件编号],[客户],[产品货号],[产品名称],[产品装配名称],[生产单号],[加工单价],[库存单价]
FROM Filtered ORDER BY [产品货号],[配件编号]
OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;";
    using var c = factory.Create(); await c.OpenAsync();
    using var multi = await c.QueryMultipleAsync(sql, new { keyword, match, page, size });
    var total = await multi.ReadFirstAsync<int>();
    var items = (await multi.ReadAsync<SemiWarehouseReturnProductRow>()).AsList();
    if (!canSeePrice) foreach (var it in items) { it.加工单价 = null; it.库存单价 = null; }
    return new(items, total);
}
```

- [ ] **Step 6: 新增 `GetAdjacentAsync`（前单/后单，镜像标签单）**

```csharp
public async Task<SemiWarehouseReturnDetailDto?> GetAdjacentAsync(string no, bool next, bool showPrice)
{
    using var c = factory.Create(); await c.OpenAsync();
    var cur = await c.QuerySingleOrDefaultAsync<(long ID, DateTime 日期)?>(
        "SELECT [ID],[日期] FROM [半成品退仓单] WHERE [单号]=@no", new { no });
    if (cur is null) return null;
    var adj = await c.ExecuteScalarAsync<string?>(next
        ? "SELECT TOP (1) [单号] FROM [半成品退仓单] WHERE [日期]>@d OR ([日期]=@d AND [ID]>@id) ORDER BY [日期],[ID];"
        : "SELECT TOP (1) [单号] FROM [半成品退仓单] WHERE [日期]<@d OR ([日期]=@d AND [ID]<@id) ORDER BY [日期] DESC,[ID] DESC;",
        new { d = cur.Value.日期, id = cur.Value.ID });
    return adj is null ? null : await GetAsync(adj, showPrice);
}
```

（若 Dapper 无法直接映射值元组，改用私有 `HeaderOrderRow { long ID; DateTime 日期; }`，与标签单一致。）

- [ ] **Step 7: 删除 `BasisAsync` / `ReceiptListAsync` 保留判断**

保留 `ReceiptListAsync`（打开入仓单选择器仍用）。删除 `BasisAsync` 方法（自由选产品不再需要）。

- [ ] **Step 8: 停后端进程后编译并跑测试**

```powershell
dotnet build src/ErpApi
dotnet test tests/ErpApi.Tests --filter Approve_reduces_semi_inventory_by_returned_quantity
```
Expected: 编译通过，测试 PASS。

- [ ] **Step 9: Commit**

```bash
git add src/ErpApi/Features/Warehouse/Semi/SemiWarehouseReturnService.cs tests/ErpApi.Tests/SemiWarehouseReturnServiceDbTests.cs
git commit -m "feat: semi warehouse return free-select save + products + adjacent"
```

---

## Task 4: 后端 Controller（去 basis、加 products 与 adjacent）

**Files:**
- Modify: `src/ErpApi/Features/Warehouse/Semi/SemiWarehouseReturnController.cs`

- [ ] **Step 1: 删除 `Basis` 端点，新增 `Products` 与 `Adjacent`**

删除 `[HttpGet("basis")]` 方法。新增：

```csharp
[HttpGet("products")]
public async Task<IActionResult> Products([FromQuery] SemiWarehouseReturnProductQuery query)
    => !await AllowAsync(PermissionAction.打开) ? Forbid()
       : Ok(await service.ProductsAsync(query, await AllowAsync(PermissionAction.单价)));

[HttpGet("{no}/adjacent")]
public async Task<IActionResult> Adjacent(string no, bool next = false)
{
    if (!await AllowAsync(PermissionAction.打开)) return Forbid();
    if (await service.GetAsync(no, false) is null) return NotFound();
    var adj = await service.GetAdjacentAsync(no, next, await AllowAsync(PermissionAction.单价));
    return adj is null ? NoContent() : Ok(adj);
}
```

- [ ] **Step 2: 停后端进程后编译**

```powershell
dotnet build src/ErpApi
```
Expected: 通过（无对 `BasisAsync` 的残留引用）。

- [ ] **Step 3: Commit**

```bash
git add src/ErpApi/Features/Warehouse/Semi/SemiWarehouseReturnController.cs
git commit -m "feat: semi warehouse return controller products + adjacent endpoints"
```

---

## Task 5: 前端 api 类型与 utils 重写

**Files:**
- Modify: `web/src/api/semi.ts`
- Modify: `web/src/utils/semiWarehouseReturn.ts`
- Test: `web/src/__tests__/semiWarehouseReturn.test.ts`

- [ ] **Step 1: 重写 `semi.ts` 中 SWR 类型与 api**

把 `SWRBasisRow / SWRLine / SWRCreate` 及 `semiWarehouseReturnApi.basis` 替换为自由选产品版：

```ts
export interface SWRProductRow { 配件编号: string; 客户?: string | null; 产品货号?: string | null; 产品名称?: string | null; 产品装配名称?: string | null; 生产单号?: string | null; 加工单价?: number | null; 库存单价?: number | null }
export interface SWRLine { ID?: number; 配件编号: string; 客户?: string | null; 产品货号?: string | null; 产品名称?: string | null; 产品装配名称?: string | null; 生产单号?: string | null; 数量: number; 单价?: number | null; 金额?: number | null; 备注?: string | null }
export interface SWRDetail { 单头: SWRHeader; 明细: SWRLine[] }
export interface SWRCreate { 入仓单号: string; 日期: string; 供应商编号?: string; 供应商名称?: string; 仓库: string; 备注?: string; 明细: { 配件编号: string; 客户?: string | null; 产品货号?: string | null; 产品名称?: string | null; 产品装配名称?: string | null; 生产单号?: string | null; 数量: number; 备注?: string | null }[] }
```

`semiWarehouseReturnApi`：删除 `basis`，新增：

```ts
  products: (params: { page?: number; size?: number; field?: string; keyword?: string; exact?: boolean } = {}) =>
    api.get<Paged<SWRProductRow>>("/semi-warehouse-returns/products", { params }).then(r => r.data),
  adjacent: (单号: string, next: boolean) =>
    api.get<SWRDetail | undefined>(`/semi-warehouse-returns/${enc(单号)}/adjacent`, { params: { next } })
      .then(r => r.status === 204 ? undefined : r.data),
```

（`SWRHeader` 不变，保留。）

- [ ] **Step 2: 重写 utils 纯计算（先写失败测试）**

`web/src/__tests__/semiWarehouseReturn.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { mergeSemiWarehouseReturnLines, validateSemiWarehouseReturn, type SWRDraftLine } from "../utils/semiWarehouseReturn";

const line = (p: Partial<SWRDraftLine>): SWRDraftLine => ({ key: 0, 配件编号: "", 数量: 0, ...p });

describe("mergeSemiWarehouseReturnLines", () => {
  it("按配件编号去重，保留已存在数量，追加新产品", () => {
    const existing = [line({ key: 1, 配件编号: "A", 数量: 5 })];
    const picked = [{ 配件编号: "A" }, { 配件编号: "B", 库存单价: 2 }];
    const merged = mergeSemiWarehouseReturnLines(existing, picked);
    expect(merged.map(l => l.配件编号)).toEqual(["A", "B"]);
    expect(merged.find(l => l.配件编号 === "A")!.数量).toBe(5);
  });
});

describe("validateSemiWarehouseReturn", () => {
  it("入仓单号必选", () => {
    expect(validateSemiWarehouseReturn({ 入仓单号: "", 明细: [line({ 配件编号: "A", 数量: 1 })] })).toBe("请先选择原入仓单号。");
  });
  it("至少一行有效明细", () => {
    expect(validateSemiWarehouseReturn({ 入仓单号: "R1", 明细: [] })).toBe("请至少录入一行退仓产品。");
  });
  it("数量必须大于0", () => {
    expect(validateSemiWarehouseReturn({ 入仓单号: "R1", 明细: [line({ 配件编号: "A", 数量: 0 })] })).toBe("退仓数量必须大于 0。");
  });
  it("配件编号不重复", () => {
    expect(validateSemiWarehouseReturn({ 入仓单号: "R1", 明细: [line({ 配件编号: "A", 数量: 1 }), line({ 配件编号: "A", 数量: 2 })] })).toBe("配件编号 A 在同一单据中重复。");
  });
  it("通过返回 null", () => {
    expect(validateSemiWarehouseReturn({ 入仓单号: "R1", 明细: [line({ 配件编号: "A", 数量: 1 })] })).toBeNull();
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```powershell
cd web; npx vitest run src/__tests__/semiWarehouseReturn.test.ts
```
Expected: FAIL（旧 utils 签名不符）。

- [ ] **Step 4: 用自由选产品版替换 `utils/semiWarehouseReturn.ts`**

```ts
export interface SWRDraftLine {
  key: number;
  配件编号: string;
  客户?: string | null;
  产品货号?: string | null;
  产品名称?: string | null;
  产品装配名称?: string | null;
  生产单号?: string | null;
  数量: number;
  单价?: number | null;
  备注?: string | null;
}

interface PickedProduct {
  配件编号: string;
  客户?: string | null;
  产品货号?: string | null;
  产品名称?: string | null;
  产品装配名称?: string | null;
  生产单号?: string | null;
  库存单价?: number | null;
}

export function mergeSemiWarehouseReturnLines(existing: SWRDraftLine[], picked: PickedProduct[]): SWRDraftLine[] {
  const seen = new Map(existing.map(l => [l.配件编号.trim(), l]));
  let key = existing.reduce((m, l) => Math.max(m, l.key), 0);
  for (const p of picked) {
    const code = p.配件编号?.trim();
    if (!code || seen.has(code)) continue;
    const row: SWRDraftLine = {
      key: ++key, 配件编号: code, 客户: p.客户 ?? null, 产品货号: p.产品货号 ?? null,
      产品名称: p.产品名称 ?? null, 产品装配名称: p.产品装配名称 ?? null,
      生产单号: p.生产单号 ?? null, 数量: 0, 单价: p.库存单价 ?? null, 备注: "",
    };
    seen.set(code, row);
  }
  return [...seen.values()];
}

export function validateSemiWarehouseReturn(input: { 入仓单号?: string; 明细: SWRDraftLine[] }): string | null {
  if (!input.入仓单号?.trim()) return "请先选择原入仓单号。";
  const valid = input.明细.filter(l => l.配件编号.trim());
  if (valid.length === 0) return "请至少录入一行退仓产品。";
  for (const l of valid) if (Number(l.数量) <= 0) return "退仓数量必须大于 0。";
  const seen = new Set<string>();
  for (const l of valid) {
    const code = l.配件编号.trim();
    if (seen.has(code)) return `配件编号 ${code} 在同一单据中重复。`;
    seen.add(code);
  }
  return null;
}
```

- [ ] **Step 5: 运行测试确认通过**

```powershell
cd web; npx vitest run src/__tests__/semiWarehouseReturn.test.ts
```
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add web/src/api/semi.ts web/src/utils/semiWarehouseReturn.ts web/src/__tests__/semiWarehouseReturn.test.ts
git commit -m "feat: semi warehouse return frontend api + free-select utils"
```

---

## Task 6: 前端页面重写（镜像标签单骨架 + 截图布局）

**Files:**
- Modify: `web/src/pages/warehouse/SemiWarehouseReturnPage.tsx`

- [ ] **Step 1: 用下列组件整体替换页面**

要点：工具栏含 新建/打开/保存/删除/复制单/刷新/资料/前单/后单/审核/反审核/表格设置(禁用)/打印/关闭；表头 供应商🔍/日期/电脑单号(只读)/入仓单号🔍/备注/操作员(只读)/审核状态 Tag；明细列 删除/配件编号/客户/产品货号/产品名称/产品装配名称/生产单号/数量(录入)/备注；底部 数量+金额(脱敏)。产品选择复用 `SemiFinishedLabelProductPicker`（`permissionMenu="半成品退仓"`），供应商用 `SupplierPicker`（`../plastics/SupplierPicker`），入仓单用内联 ListPicker 返回整行以带出 供应商/仓库。

```tsx
import { useMemo, useState } from "react";
import { Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Row, Space, Statistic, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CheckOutlined, CloseOutlined, CopyOutlined, DeleteOutlined, FileAddOutlined, FolderOpenOutlined, LeftOutlined, PrinterOutlined, ProfileOutlined, ReloadOutlined, RightOutlined, SaveOutlined, SearchOutlined, TableOutlined, UndoOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useNavigate } from "react-router-dom";
import { semiWarehouseReturnApi, type SRHeader, type SWRDetail } from "../../api/semi";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import { mergeSemiWarehouseReturnLines, validateSemiWarehouseReturn, type SWRDraftLine } from "../../utils/semiWarehouseReturn";
import SemiFinishedLabelProductPicker, { type SemiFinishedLabelProduct } from "../semi/SemiFinishedLabelProductPicker";
import SupplierPicker from "../plastics/SupplierPicker";

const MENU = "半成品退仓";
const user = () => localStorage.getItem("erp_user") || "admin";
const err = (e: unknown, f: string) => (e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? f;
type HeaderForm = { 单号?: string; 入仓单号?: string; 供应商编号?: string; 供应商名称?: string; 日期?: Dayjs; 仓库?: string; 备注?: string; 操作员?: string };

function ReceiptPicker({ open, onPick, onClose }: { open: boolean; onPick: (r: SRHeader) => void; onClose: () => void }) {
  const [keyword, setKeyword] = useState(""); const [rows, setRows] = useState<SRHeader[]>([]); const [loading, setLoading] = useState(false);
  const load = async () => { setLoading(true); try { setRows((await semiWarehouseReturnApi.receipts(1, 100, keyword.trim())).items ?? []); } catch { message.error("加载入仓单失败"); } finally { setLoading(false); } };
  return <Modal title="选择原入仓单（仅已审核）" open={open} afterOpenChange={o => o && void load()} onCancel={onClose} footer={null} width={940} destroyOnClose>
    <Input.Search allowClear value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={() => void load()} placeholder="单号 / 供应商 / 仓库" style={{ width: 340, marginBottom: 12 }} />
    <Table<SRHeader> rowKey={r => r.单号 ?? String(r.id)} size="small" loading={loading} dataSource={rows} pagination={false} scroll={{ y: 440 }}
      onRow={r => ({ onDoubleClick: () => onPick(r), style: { cursor: "pointer" } })}
      columns={[{ title: "入仓单号", dataIndex: "单号", width: 150 }, { title: "日期", dataIndex: "日期", width: 110, render: v => v?.slice(0, 10) }, { title: "供应商", dataIndex: "供应商名称", width: 220 }, { title: "仓库", dataIndex: "仓库", width: 120 }, { title: "数量", dataIndex: "数量", width: 100, align: "right" }]} />
  </Modal>;
}

export default function SemiWarehouseReturnPage() {
  const [form] = Form.useForm<HeaderForm>(); const perms = usePerms(); const navigate = useNavigate();
  const canOpen = can(perms, MENU, "打开"), canSave = can(perms, MENU, "保存"), canDelete = can(perms, MENU, "删除"), canAudit = can(perms, MENU, "审核"), canReverse = can(perms, MENU, "反审核"), canPrint = can(perms, MENU, "打印"), canPrice = can(perms, MENU, "单价");
  const [opened, setOpened] = useState<SWRDetail | null>(null); const [lines, setLines] = useState<SWRDraftLine[]>([]); const [busy, setBusy] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false); const [receiptOpen, setReceiptOpen] = useState(false); const [productOpen, setProductOpen] = useState(false); const [openOpen, setOpenOpen] = useState(false);
  const audited = opened?.单头.审核 === "1"; const readOnly = audited || !canSave || busy;

  const reset = () => { form.setFieldsValue({ 单号: "", 入仓单号: "", 供应商编号: "", 供应商名称: "", 日期: dayjs(), 仓库: "", 备注: "", 操作员: user() }); setOpened(null); setLines([]); };
  const apply = (d: SWRDetail) => {
    form.setFieldsValue({ ...d.单头, 日期: dayjs(d.单头.日期), 操作员: d.单头.操作员 ?? user() });
    setLines(d.明细.map((x, i) => ({ key: i + 1, 配件编号: x.配件编号, 客户: x.客户, 产品货号: x.产品货号, 产品名称: x.产品名称, 产品装配名称: x.产品装配名称, 生产单号: x.生产单号, 数量: Number(x.数量), 单价: x.单价 ?? null, 备注: x.备注 ?? "" })));
    setOpened(d);
  };
  const openDoc = async (no: string) => { setBusy(true); try { apply(await semiWarehouseReturnApi.get(no)); } catch (e) { message.error(err(e, "打开退仓单失败")); } finally { setBusy(false); } };
  const selectReceipt = (r: SRHeader) => { form.setFieldsValue({ 入仓单号: r.单号, 供应商编号: r.供应商编号, 供应商名称: r.供应商名称, 仓库: r.仓库 }); setReceiptOpen(false); };
  const pickProducts = (rows: SemiFinishedLabelProduct[]) => setLines(cur => mergeSemiWarehouseReturnLines(cur, rows.map(p => ({ 配件编号: p.配件编号, 客户: p.客户, 产品货号: p.产品货号, 产品名称: p.产品名称, 产品装配名称: p.产品装配名称, 生产单号: (p as { 生产单号?: string | null }).生产单号, 库存单价: p.库存单价 }))));
  const updateLine = (key: number, patch: Partial<SWRDraftLine>) => setLines(v => v.map(x => x.key === key ? { ...x, ...patch } : x));

  const buildPayload = () => {
    const h = form.getFieldsValue();
    const issue = validateSemiWarehouseReturn({ 入仓单号: h.入仓单号, 明细: lines });
    if (issue) { message.error(issue); return null; }
    return { 入仓单号: h.入仓单号!, 日期: (h.日期 ?? dayjs()).format("YYYY-MM-DD"), 供应商编号: h.供应商编号, 供应商名称: h.供应商名称, 仓库: h.仓库 ?? "", 备注: h.备注?.trim(),
      明细: lines.filter(x => x.配件编号.trim() && Number(x.数量) > 0).map(x => ({ 配件编号: x.配件编号, 客户: x.客户, 产品货号: x.产品货号, 产品名称: x.产品名称, 产品装配名称: x.产品装配名称, 生产单号: x.生产单号, 数量: Number(x.数量), 备注: x.备注 })) };
  };
  const save = async () => { const body = buildPayload(); if (!body || readOnly) return; setBusy(true); try { const no = opened ? (await semiWarehouseReturnApi.update(opened.单头.单号, body), opened.单头.单号) : (await semiWarehouseReturnApi.create(body)).单号; apply(await semiWarehouseReturnApi.get(no)); message.success("半成品退仓单已保存"); } catch (e) { message.error(err(e, "保存失败")); } finally { setBusy(false); } };
  const audit = async (reverse: boolean) => { if (!opened) return; setBusy(true); try { reverse ? await semiWarehouseReturnApi.unapprove(opened.单头.单号) : await semiWarehouseReturnApi.approve(opened.单头.单号); apply(await semiWarehouseReturnApi.get(opened.单头.单号)); message.success(reverse ? "已反审核" : "已审核"); } catch (e) { message.error(err(e, reverse ? "反审核失败" : "审核失败")); } finally { setBusy(false); } };
  const remove = async () => { if (!opened) return; setBusy(true); try { await semiWarehouseReturnApi.remove(opened.单头.单号); reset(); message.success("已删除"); } catch (e) { message.error(err(e, "删除失败")); } finally { setBusy(false); } };
  const move = async (next: boolean) => { if (!opened) return; setBusy(true); try { const d = await semiWarehouseReturnApi.adjacent(opened.单头.单号, next); if (!d) message.info(next ? "已经是最后一张单据" : "已经是第一张单据"); else apply(d); } catch (e) { message.error(err(e, "切换单据失败")); } finally { setBusy(false); } };
  const copy = () => { if (!opened) return; setOpened(null); form.setFieldsValue({ 单号: "", 日期: dayjs(), 操作员: user() }); message.success("已复制为未保存新单"); };

  const totals = useMemo(() => lines.reduce((a, x) => ({ qty: a.qty + Number(x.数量 || 0), amount: a.amount + Number(x.数量 || 0) * Number(x.单价 || 0) }), { qty: 0, amount: 0 }), [lines]);
  const cols: ColumnsType<SWRDraftLine> = [
    { title: "删除", width: 58, fixed: "left", render: (_, x) => <Button type="text" danger icon={<DeleteOutlined />} disabled={readOnly} onClick={() => setLines(v => v.filter(y => y.key !== x.key))} /> },
    { title: "配件编号", dataIndex: "配件编号", width: 130 }, { title: "客户", dataIndex: "客户", width: 120 }, { title: "产品货号", dataIndex: "产品货号", width: 140 }, { title: "产品名称", dataIndex: "产品名称", width: 180 }, { title: "产品装配名称", dataIndex: "产品装配名称", width: 200 }, { title: "生产单号", dataIndex: "生产单号", width: 140 },
    { title: "数量", dataIndex: "数量", width: 120, align: "right", render: (_, x) => <InputNumber min={0} value={x.数量} disabled={readOnly} onChange={v => updateLine(x.key, { 数量: Number(v ?? 0) })} style={{ width: "100%" }} /> },
    { title: "备注", dataIndex: "备注", width: 180, render: (_, x) => <Input value={x.备注 ?? ""} disabled={readOnly} onChange={e => updateLine(x.key, { 备注: e.target.value })} /> },
  ];

  if (!canOpen) return <Card variant="borderless"><div style={{ padding: 24, color: "#8c8c8c" }}>无权访问该页面</div></Card>;
  const receiptNo = Form.useWatch("入仓单号", form) ?? "";
  return <Card title="半成品退仓单" variant="borderless" extra={<Space wrap>
    <Button icon={<FileAddOutlined />} disabled={busy} onClick={reset}>新建</Button>
    <Button icon={<FolderOpenOutlined />} disabled={busy} onClick={() => setOpenOpen(true)}>打开</Button>
    <Button type="primary" icon={<SaveOutlined />} disabled={readOnly} loading={busy} onClick={() => void save()}>保存</Button>
    <Popconfirm title="确认删除当前退仓单？" disabled={!opened || audited || !canDelete} onConfirm={() => void remove()}><Button icon={<DeleteOutlined />} disabled={!opened || audited || !canDelete}>删除</Button></Popconfirm>
    <Button icon={<CopyOutlined />} disabled={!opened || !canSave} onClick={copy}>复制单</Button>
    <Button icon={<ReloadOutlined />} disabled={!opened || busy} onClick={() => opened && void openDoc(opened.单头.单号)}>刷新</Button>
    <Button icon={<ProfileOutlined />} disabled={readOnly} onClick={() => setProductOpen(true)}>资料</Button>
    <Button icon={<LeftOutlined />} disabled={!opened || busy} onClick={() => void move(false)}>前单</Button>
    <Button icon={<RightOutlined />} disabled={!opened || busy} onClick={() => void move(true)}>后单</Button>
    <Button icon={<CheckOutlined />} disabled={!opened || audited || !canAudit} onClick={() => void audit(false)}>审核</Button>
    <Button icon={<UndoOutlined />} disabled={!opened || !audited || !canReverse} onClick={() => void audit(true)}>反审核</Button>
    <Button icon={<TableOutlined />} disabled>表格设置</Button>
    <Button icon={<PrinterOutlined />} disabled={!canPrint} onClick={() => window.print()}>打印</Button>
    <Button danger icon={<CloseOutlined />} disabled={busy} onClick={() => window.history.length > 1 ? navigate(-1) : navigate("/")}>关闭</Button>
  </Space>}>
    <Form form={form} layout="vertical" size="small" initialValues={{ 日期: dayjs(), 操作员: user() }}><Row gutter={12}>
      <Col xs={24} sm={12} lg={5}><Form.Item label="供应商" required><Space.Compact style={{ width: "100%" }}><Form.Item name="供应商名称" noStyle><Input readOnly placeholder="选入仓单自动带出" /></Form.Item><Button icon={<SearchOutlined />} disabled={readOnly} onClick={() => setSupplierOpen(true)} /></Space.Compact></Form.Item><Form.Item name="供应商编号" hidden><Input /></Form.Item></Col>
      <Col xs={12} sm={8} lg={3}><Form.Item label="日期" name="日期"><DatePicker disabled={readOnly} style={{ width: "100%" }} /></Form.Item></Col>
      <Col xs={12} sm={8} lg={4}><Form.Item label="电脑单号" name="单号"><Input readOnly placeholder="保存后生成" /></Form.Item></Col>
      <Col xs={24} sm={12} lg={5}><Form.Item label="入仓单号" required><Space.Compact style={{ width: "100%" }}><Form.Item name="入仓单号" noStyle><Input readOnly placeholder="请先选择原入仓单" /></Form.Item><Button icon={<SearchOutlined />} disabled={readOnly} onClick={() => setReceiptOpen(true)} /></Space.Compact></Form.Item></Col>
      <Col xs={24} sm={12} lg={4}><Form.Item label="审核状态"><Tag color={audited ? "success" : "default"}>{audited ? "已审核" : "未审核"}</Tag></Form.Item><Form.Item name="仓库" hidden><Input /></Form.Item></Col>
      <Col xs={24} sm={16} lg={7}><Form.Item label="备注" name="备注"><Input disabled={readOnly} /></Form.Item></Col>
      <Col xs={12} sm={8} lg={4}><Form.Item label="操作员" name="操作员"><Input readOnly /></Form.Item></Col>
    </Row></Form>
    <Table<SWRDraftLine> rowKey="key" size="small" columns={cols} dataSource={lines} pagination={false} scroll={{ x: 1400, y: "calc(100vh - 455px)" }} />
    <Space size={48} style={{ marginTop: 14 }}><Statistic title="数量合计" value={totals.qty} /><Statistic title="金额合计" value={canPrice ? totals.amount : 0} precision={2} formatter={canPrice ? undefined : () => "***"} /></Space>
    <SupplierPicker open={supplierOpen} onPick={(s: { 编号?: string; 名称?: string }) => { form.setFieldsValue({ 供应商编号: s.编号, 供应商名称: s.名称 }); setSupplierOpen(false); }} onClose={() => setSupplierOpen(false)} />
    <ReceiptPicker open={receiptOpen} onPick={selectReceipt} onClose={() => setReceiptOpen(false)} />
    <SemiFinishedLabelProductPicker open={productOpen} permissionMenu={MENU} onPick={rows => { setProductOpen(false); pickProducts(rows); }} onClose={() => setProductOpen(false)} />
    <Modal title="打开半成品退仓单" open={openOpen} onCancel={() => setOpenOpen(false)} footer={null} width={980} destroyOnClose>
      <OpenList onPick={no => { setOpenOpen(false); void openDoc(no); }} />
    </Modal>
  </Card>;
}

function OpenList({ onPick }: { onPick: (no: string) => void }) {
  const [keyword, setKeyword] = useState(""); const [rows, setRows] = useState<SRHeader[]>([]); const [loading, setLoading] = useState(false);
  const load = async () => { setLoading(true); try { setRows((await semiWarehouseReturnApi.list(1, 100, keyword.trim())).items as unknown as SRHeader[]); } catch { message.error("加载退仓单失败"); } finally { setLoading(false); } };
  return <>
    <Input.Search allowClear value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={() => void load()} onFocus={() => rows.length === 0 && void load()} placeholder="电脑单号 / 入仓单号 / 供应商" style={{ width: 340, marginBottom: 12 }} />
    <Table<SRHeader> rowKey={r => r.单号 ?? String(r.id)} size="small" loading={loading} dataSource={rows} pagination={false} scroll={{ y: 440 }}
      onRow={r => ({ onDoubleClick: () => r.单号 && onPick(r.单号), style: { cursor: "pointer" } })}
      columns={[{ title: "电脑单号", dataIndex: "单号", width: 150 }, { title: "入仓单号", dataIndex: "入仓单号", width: 150 }, { title: "日期", dataIndex: "日期", width: 110, render: v => v?.slice(0, 10) }, { title: "供应商", dataIndex: "供应商名称", width: 200 }, { title: "数量", dataIndex: "数量", width: 90, align: "right" }, { title: "状态", dataIndex: "审核", width: 90, render: v => <Tag color={v === "1" ? "success" : "default"}>{v === "1" ? "已审核" : "未审核"}</Tag> }]} />
  </>;
}
```

> 实施注意：确认 `SupplierPicker` 的实际 `onPick` 回调签名（读 `web/src/pages/plastics/SupplierPicker.tsx`），把上面 `onPick` 的解构字段名对齐其真实字段（编号/名称）。确认 `SemiFinishedLabelProduct` 是否含 `生产单号`；不含则如上用类型断言读取（后端 products 已返回该字段）。

- [ ] **Step 2: 前端类型检查 + 构建**

```powershell
cd web; npx tsc -b; npx vitest run src/__tests__/semiWarehouseReturn.test.ts
```
Expected: 无类型错误，测试 PASS。

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/warehouse/SemiWarehouseReturnPage.tsx
git commit -m "feat: rewrite semi warehouse return page to free-select layout"
```

---

## Task 7: 端到端冒烟验证

**Files:** 无（验证任务）

- [ ] **Step 1: 停后端进程，重启后端 + 前端**

```powershell
dotnet run --project src/ErpApi   # 端口 5000
cd web; npm run dev               # 端口 5173
```

- [ ] **Step 2: 手动走全生命周期并对照截图**

用 admin/admin123 登录 → 半成品仓库 > 半成品退仓单：
1. 选入仓单号(已审核) → 供应商/仓库自动带出。
2. 点“资料” → 选 2 个产品 → 明细出现，生产单号带出。
3. 录数量 → 底部数量/金额合计更新。
4. 保存 → 电脑单号 `BRT...` 生成。
5. 审核 → 半成品库存统计表对应物料减少对应数量；反审核恢复。
6. 前单/后单/复制单/删除(已审核禁删)逐一验证。

Expected: 页面布局与截图一致（表头六字段 + 工具栏 + 明细八列 + 底部数量/金额），库存净额正确。

- [ ] **Step 3: 全量测试回归**

```powershell
# 停后端进程
dotnet test tests/ErpApi.Tests
cd web; npx vitest run
```
Expected: 全绿。

- [ ] **Step 4: Commit（若冒烟中有微调）**

```bash
git add -A
git commit -m "test: verify semi warehouse return free-select end-to-end"
```

---

## Self-Review 覆盖检查

- 库存口径(实时 union 减库存) → Task 3 Step 1 测试 + SaveCore 落 仓库/物料编号/颜色 覆盖。
- 入仓单号必选带出供应商/仓库 → Task 3 SaveCore + Task 6 selectReceipt + utils 校验覆盖。
- 自由选产品(资料) → Task 3 ProductsAsync + Task 6 SemiFinishedLabelProductPicker 复用覆盖。
- 生产单号带出 → Task 3 products OUTER APPLY + SaveCore 派生覆盖。
- 明细列/工具栏/底部合计对照截图 → Task 6 页面覆盖。
- 脱敏 → Service `showPrice` + 页面 `canPrice` 覆盖。
- 审核/反审核/删除/前后单/复制 → Controller + Service + 页面覆盖。
- 接入四处已存在 → Global Constraints 说明，无新增任务。
