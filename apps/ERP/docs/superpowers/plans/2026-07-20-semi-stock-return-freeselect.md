# 半成品退库单（自由选产品版）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 净新建「半成品退库单」（生产领用料退回半成品仓，库存 **+**）：简领料退回头（部门/退料人）→ 点「资料」自由选产品录退库数量 → 审核实时**增加**半成品库存。

**Architecture:** 净新两表 `半成品退库单`/`半成品退库明细单`；`InventorySummaryService.SemiSql` 加第 5 分支 `半成品退库明细单 数量*+1`；审核走 PostingEngine（加 PostableDocuments 白名单 + DI）。服务镜像已交付的 `SemiIssue`（自由选产品，仓库默认半成品仓，按 物料编号+仓库 从最近已审核入仓明细派生 颜色/规格/单位/单价/生产单号）。React 全屏页镜像出库页去掉右侧库存网格、简化头。前缀 `BTK`。

**Tech Stack:** SQL Server migration、ASP.NET Core 8、Dapper、xUnit、React 19、TypeScript、Ant Design 6、Vitest。

## Global Constraints

- 本单**净新**：新表、新 Service/Controller/DTOs、新 DI、新白名单、新权限种子、菜单占位落地、新路由、union 新分支。
- 半成品库存实时台账，退库明细必须落库 `仓库/物料编号/颜色/数量`，方向 **+**（在 union 分支，不在服务）。审核只翻单头审核位（PostingEngine）。
- 仓库默认 `半成品仓`（DTO 带仓库·服务空→半成品仓·前端硬编码发·测试传 `P5c半成品仓`）。
- **无价单**：明细无单价/金额列、底部仅数量合计、无右侧库存网格。后端仍存单价/金额并保留 `showPrice`/`canSeePrice` 脱敏参。
- 每次只暂存本任务明确列出的文件；工作区有大量无关改动，**绝不 `git add -A`**。
- 后端启动锁 `bin/ErpApi.dll`：跑 `dotnet build`/`dotnet test` 前先停后端进程（前端 dev server 不影响）。
- LocalDB 命名管道每次重启会变；sqlcmd 走 PowerShell，用 `SqlLocalDB info MSSQLLocalDB` 取当前 `Instance pipe name`。

## File Structure

- `db/migrate_semi_stock_returns.sql` — **新建**：幂等 CREATE 两表。
- `db/seed_semi_stock_return_perms.sql` — **新建**：菜单 `半成品退库` 授权。
- `src/ErpApi/Engines/Inventory/InventorySummaryService.cs` — 改：SemiSql 加 `半成品退库明细单` 正号分支。
- `src/ErpApi/Features/Warehouse/Semi/SemiStockReturnDtos.cs` — **新建**：DTOs。
- `src/ErpApi/Features/Warehouse/Semi/SemiStockReturnService.cs` — **新建**：服务。
- `src/ErpApi/Features/Warehouse/Semi/SemiStockReturnController.cs` — **新建**：控制器。
- `src/ErpApi/Program.cs` — 改：DI 注册。
- `src/ErpApi/Engines/Posting/PostableDocuments.cs` — 改：白名单加 `半成品退库单`。
- `src/ErpApi/Features/Admin/MenuCatalog.cs` — 改：加 `new("半成品仓库","半成品退库")`。
- `tests/ErpApi.Tests/SemiStockReturnServiceDbTests.cs` — **新建**：库存 +净额测试。
- `web/src/api/semi.ts` — 改：加 `SSR*` 类型 + `semiStockReturnApi`。
- `web/src/utils/semiStockReturn.ts` — **新建**：合并/校验。
- `web/src/__tests__/semiStockReturn.test.ts` — **新建**：utils 测试。
- `web/src/pages/warehouse/SemiStockReturnPage.tsx` — **新建**：全屏页。
- `web/src/nav/menuTree.tsx` — 改：占位落地。
- `web/src/App.tsx` — 改：import + 路由。

---

## Task 1: DB 迁移（新建两表）

**Files:**
- Create: `db/migrate_semi_stock_returns.sql`

- [ ] **Step 1: 写幂等 CREATE 迁移**

写 `db/migrate_semi_stock_returns.sql`：

```sql
-- 半成品退库单（自由选产品版）：净新两表。库存方向 + 在 union 分支处理。
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'[半成品退库单]', N'U') IS NULL
CREATE TABLE [半成品退库单] (
    [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_半成品退库单] PRIMARY KEY,
    [单号] nvarchar(40) NOT NULL CONSTRAINT [UQ_半成品退库单_单号] UNIQUE,
    [日期] date NOT NULL,
    [部门] nvarchar(80) NULL,
    [退料人] nvarchar(80) NULL,
    [仓库] nvarchar(80) NOT NULL,
    [数量] decimal(18,4) NOT NULL,
    [金额] decimal(18,4) NOT NULL,
    [操作员] nvarchar(80) NULL,
    [审核] char(1) NOT NULL CONSTRAINT [DF_半成品退库单_审核] DEFAULT ('0'),
    [审核人] nvarchar(80) NULL,
    [审核日期] datetime2 NULL,
    [备注] nvarchar(500) NULL,
    CONSTRAINT [CK_半成品退库单_审核] CHECK ([审核] IN ('0','1'))
);

IF OBJECT_ID(N'[半成品退库明细单]', N'U') IS NULL
CREATE TABLE [半成品退库明细单] (
    [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_半成品退库明细单] PRIMARY KEY,
    [单号] nvarchar(40) NOT NULL,
    [日期] date NULL,
    [仓库] nvarchar(80) NULL,
    [订单单号] nvarchar(80) NULL,
    [客户] nvarchar(200) NULL,
    [生产单号] nvarchar(80) NULL,
    [货号] nvarchar(200) NULL,
    [名称] nvarchar(200) NULL,
    [物料编号] nvarchar(80) NOT NULL,
    [物料名称] nvarchar(200) NULL,
    [规格] nvarchar(200) NULL,
    [颜色] nvarchar(80) NULL,
    [单位] nvarchar(40) NULL,
    [数量] decimal(18,4) NOT NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(500) NULL,
    CONSTRAINT [UQ_半成品退库明细单_物料] UNIQUE ([单号],[物料编号])
);

COMMIT TRANSACTION;
```

- [ ] **Step 2: 部署到 erp 与 erp_test**

```bash
dotnet run --project tools/DbDeploy -- "$ERP_DB" db/migrate_semi_stock_returns.sql
dotnet run --project tools/DbDeploy -- "$ERP_TEST_DB" db/migrate_semi_stock_returns.sql
```
Expected: 两库均「完成」，无报错。

- [ ] **Step 3: 验证两表存在（erp_test，PowerShell）**

```powershell
$pipe = 'np:\\.\pipe\LOCALDB#XXXXXXXX\tsql\query'   # 用 SqlLocalDB info MSSQLLocalDB 的 Instance pipe name 替换
sqlcmd -S $pipe -d erp_test -h -1 -W -Q "SET NOCOUNT ON; SELECT name FROM sys.tables WHERE name IN (N'半成品退库单',N'半成品退库明细单') ORDER BY name;"
```
Expected: 列出两表名。

- [ ] **Step 4: Commit**

```bash
git add db/migrate_semi_stock_returns.sql
git commit -m "db: create semi stock return tables"
```

---

## Task 2: 权限种子

**Files:**
- Create: `db/seed_semi_stock_return_perms.sql`

- [ ] **Step 1: 写权限种子**

写 `db/seed_semi_stock_return_perms.sql`：

```sql
SET XACT_ABORT ON;
BEGIN TRANSACTION;
;WITH [主体] AS (
    SELECT CONVERT(nvarchar(30), LTRIM(RTRIM([用户]))) AS [用户], MAX(NULLIF([名称],N'')) AS [名称]
    FROM [userbqrpower]
    WHERE NULLIF(LTRIM(RTRIM([用户])),N'') IS NOT NULL
    GROUP BY CONVERT(nvarchar(30), LTRIM(RTRIM([用户])))
    UNION ALL SELECT N'admin', N'admin'
), [去重] AS (
    SELECT [用户], COALESCE(MAX([名称]),[用户]) AS [名称] FROM [主体] GROUP BY [用户]
)
MERGE [userbqrpower] WITH (HOLDLOCK) AS T
USING [去重] AS S ON T.[用户]=S.[用户] AND T.[菜单]=N'半成品退库'
WHEN MATCHED THEN UPDATE SET T.[单价]=ISNULL(T.[单价],1), T.[金额]=ISNULL(T.[金额],1)
WHEN NOT MATCHED THEN INSERT ([用户],[名称],[菜单],[打开],[保存],[删除],[打印],[审核],[反审核],[单价],[金额])
VALUES(S.[用户],S.[名称],N'半成品退库',1,1,1,1,1,1,1,1);
COMMIT TRANSACTION;
```

- [ ] **Step 2: 部署到 erp 与 erp_test**

```bash
dotnet run --project tools/DbDeploy -- "$ERP_DB" db/seed_semi_stock_return_perms.sql
dotnet run --project tools/DbDeploy -- "$ERP_TEST_DB" db/seed_semi_stock_return_perms.sql
```
Expected: 两库均「完成」。

- [ ] **Step 3: 验证 admin 有 半成品退库 权限（erp）**

```powershell
$pipe = 'np:\\.\pipe\LOCALDB#XXXXXXXX\tsql\query'
sqlcmd -S $pipe -d erp -h -1 -W -Q "SET NOCOUNT ON; SELECT [打开],[保存],[审核],[单价] FROM [userbqrpower] WHERE [用户]='admin' AND [菜单]=N'半成品退库';"
```
Expected: `1 1 1 1`。

- [ ] **Step 4: Commit**

```bash
git add db/seed_semi_stock_return_perms.sql
git commit -m "db: seed semi stock return permissions"
```

---

## Task 3: 库存 union 加正号分支

**Files:**
- Modify: `src/ErpApi/Engines/Inventory/InventorySummaryService.cs`

- [ ] **Step 1: 在 SemiSql 盘点分支之后、`) t` 之前插入退库分支**

在 `SemiSql` 常量中，找到盘点分支（`FROM [半成品盘点明细单] d JOIN [半成品盘点单] h ...` 的那段），在其后、闭合 `) t` 之前插入：

```sql
    UNION ALL
    SELECT d.物料编号,d.物料名称,d.规格,d.颜色, d.数量        AS 库存
      FROM [半成品退库明细单] d JOIN [半成品退库单] h ON h.单号=d.单号
      WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
```

（正号，与入仓分支同形；退库 = 退回增库存。）

- [ ] **Step 2: 停后端进程后编译**

```powershell
dotnet build src/ErpApi
```
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add src/ErpApi/Engines/Inventory/InventorySummaryService.cs
git commit -m "feat: add semi stock return branch to inventory union"
```

---

## Task 4: 后端 DTO + Service + DB 测试

**Files:**
- Create: `src/ErpApi/Features/Warehouse/Semi/SemiStockReturnDtos.cs`
- Create: `src/ErpApi/Features/Warehouse/Semi/SemiStockReturnService.cs`
- Create: `tests/ErpApi.Tests/SemiStockReturnServiceDbTests.cs`

- [ ] **Step 1: 写 DTOs**

写 `src/ErpApi/Features/Warehouse/Semi/SemiStockReturnDtos.cs`：

```csharp
namespace ErpApi.Features.Warehouse.Semi;

public sealed class SemiStockReturnLineInput
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
public sealed class SemiStockReturnCreateDto
{
    public DateTime? 日期 { get; set; }
    public string 仓库 { get; set; } = "";
    public string? 部门 { get; set; }
    public string? 退料人 { get; set; }
    public string? 备注 { get; set; }
    public List<SemiStockReturnLineInput> 明细 { get; set; } = [];
}
public sealed class SemiStockReturnHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 仓库 { get; set; }
    public string? 部门 { get; set; }
    public string? 退料人 { get; set; }
    public DateTime? 日期 { get; set; }
    public DateTime? 审核日期 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SemiStockReturnLineRowDto
{
    public long ID { get; set; }
    public string? 配件编号 { get; set; }
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SemiStockReturnDetailDto
{ public SemiStockReturnHeaderDto? 单头 { get; set; } public List<SemiStockReturnLineRowDto> 明细 { get; set; } = []; }
public sealed class SemiStockReturnProductQuery
{
    public int Page { get; set; } = 1;
    public int Size { get; set; } = 50;
    public string? Field { get; set; }
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
}
public sealed class SemiStockReturnProductRow
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

- [ ] **Step 2: 写 Service**

写 `src/ErpApi/Features/Warehouse/Semi/SemiStockReturnService.cs`。此文件与 `SemiIssueService.cs` 结构一致，仅换表名（半成品退库单/明细单）、DocType/Prefix、头字段（部门/退料人）、类型（SemiStockReturn*）、提示语（退库）。完整内容：

```csharp
using System.Data;
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Warehouse.Semi;

// 半成品退库单（自由选产品版，库存 +）。两层：半成品退库单 + 半成品退库明细单。审核位仅在单头（走 PostingEngine）。
public sealed class SemiStockReturnService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "半成品退库单";
    public const string Prefix = "BTK";
    private const string DefaultWarehouse = "半成品仓";

    public async Task<string> CreateAsync(SemiStockReturnCreateDto dto, string user)
    {
        using var c = factory.Create(); await c.OpenAsync(); using var tx = c.BeginTransaction();
        var date = dto.日期?.Date ?? DateTime.Today;
        var no = await docNo.NextAsync(DocType, Prefix, date, c, tx);
        await SaveCoreAsync(c, tx, no, dto, user, false);
        tx.Commit(); return no;
    }

    public async Task<bool> UpdateAsync(string no, SemiStockReturnCreateDto dto, string user)
    {
        using var c = factory.Create(); await c.OpenAsync(); using var tx = c.BeginTransaction();
        var audit = await c.ExecuteScalarAsync<string?>("SELECT [审核] FROM [半成品退库单] WITH (UPDLOCK,HOLDLOCK) WHERE [单号]=@no", new { no }, tx);
        if (audit is null) return false;
        if (audit == "1") throw new InvalidOperationException("已审核的半成品退库单不能修改，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [半成品退库明细单] WHERE [单号]=@no", new { no }, tx);
        await SaveCoreAsync(c, tx, no, dto, user, true); tx.Commit(); return true;
    }

    private static async Task SaveCoreAsync(IDbConnection c, IDbTransaction tx, string no, SemiStockReturnCreateDto dto, string user, bool update)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("至少选择一行退库产品。");
        if (dto.明细.Any(x => string.IsNullOrWhiteSpace(x.配件编号))) throw new ArgumentException("配件编号必填。");
        if (dto.明细.Any(x => x.数量 <= 0)) throw new ArgumentException("退库数量必须大于 0。");
        if (dto.明细.GroupBy(x => x.配件编号!.Trim(), StringComparer.OrdinalIgnoreCase).Any(g => g.Count() > 1))
            throw new ArgumentException("同一单据内配件编号不能重复。");

        var warehouse = string.IsNullOrWhiteSpace(dto.仓库) ? DefaultWarehouse : dto.仓库.Trim();
        var date = dto.日期?.Date ?? DateTime.Today;

        var lines = new List<(SemiStockReturnLineInput In, ReceiptFacts F)>();
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
            await c.ExecuteAsync(@"UPDATE [半成品退库单] SET [日期]=@date,[仓库]=@wh,[部门]=@部门,[退料人]=@退料人,[数量]=@qty,[金额]=@amt,[操作员]=@user,[备注]=@备注 WHERE [单号]=@no",
                new { no, date, wh = warehouse, dto.部门, dto.退料人, qty = totalQty, amt = totalAmt, user, dto.备注 }, tx);
        else
            await c.ExecuteAsync(@"INSERT INTO [半成品退库单]([单号],[日期],[仓库],[部门],[退料人],[数量],[金额],[操作员],[审核],[备注])
VALUES(@no,@date,@wh,@部门,@退料人,@qty,@amt,@user,'0',@备注)",
                new { no, date, wh = warehouse, dto.部门, dto.退料人, qty = totalQty, amt = totalAmt, user, dto.备注 }, tx);

        foreach (var (input, f) in lines)
        {
            var price = f.单价 ?? 0m;
            await c.ExecuteAsync(@"INSERT INTO [半成品退库明细单]
([单号],[日期],[仓库],[订单单号],[客户],[生产单号],[货号],[名称],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注])
VALUES(@no,@date,@wh,@orderNo,@customer,@prodNo,@goodsNo,@name,@mat,@matName,@spec,@color,@unit,@qty,@price,@amt,@remark)",
                new {
                    no, date, wh = warehouse,
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

    public async Task<PagedResult<SemiStockReturnHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [半成品退库单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [退料人] LIKE @kw;
SELECT [ID],[单号],[仓库],[部门],[退料人],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [半成品退库单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [退料人] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<SemiStockReturnHeaderDto>()).AsList();
        return new PagedResult<SemiStockReturnHeaderDto>(items, total);
    }

    public async Task<SemiStockReturnDetailDto?> GetAsync(string no, bool showPrice = true)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[仓库],[部门],[退料人],[日期],[审核日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [半成品退库单] WHERE [单号]=@no;
SELECT d.[ID],d.[客户],d.[生产单号],d.[货号] AS [产品货号],d.[名称] AS [产品名称],
 d.[物料编号] AS [配件编号],d.[物料名称] AS [产品装配名称],d.[规格],d.[颜色],d.[单位],d.[数量],d.[单价],d.[金额],d.[备注]
FROM [半成品退库明细单] d WHERE d.[单号]=@no ORDER BY d.[ID];", new { no });
        var header = await multi.ReadFirstOrDefaultAsync<SemiStockReturnHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<SemiStockReturnLineRowDto>()).AsList();
        if (!showPrice) { header.金额 = null; foreach (var l in lines) { l.单价 = null; l.金额 = null; } }
        return new SemiStockReturnDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string no)
    {
        using var c = factory.Create(); await c.OpenAsync(); using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [半成品退库单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@no", new { no }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的半成品退库单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [半成品退库明细单] WHERE [单号]=@no", new { no }, tx);
        await c.ExecuteAsync("DELETE FROM [半成品退库单] WHERE [单号]=@no", new { no }, tx);
        tx.Commit(); return true;
    }

    public async Task<PagedResult<SemiStockReturnProductRow>> ProductsAsync(SemiStockReturnProductQuery query, bool canSeePrice)
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
        var items = (await multi.ReadAsync<SemiStockReturnProductRow>()).AsList();
        if (!canSeePrice) foreach (var it in items) { it.加工单价 = null; it.库存单价 = null; }
        return new(items, total);
    }

    public async Task<SemiStockReturnDetailDto?> GetAdjacentAsync(string no, bool next, bool showPrice)
    {
        using var c = factory.Create(); await c.OpenAsync();
        var cur = await c.QuerySingleOrDefaultAsync<AdjacentAnchor>(
            "SELECT [ID],[日期] FROM [半成品退库单] WHERE [单号]=@no", new { no });
        if (cur is null) return null;
        var adj = await c.ExecuteScalarAsync<string?>(next
            ? "SELECT TOP (1) [单号] FROM [半成品退库单] WHERE [日期]>@d OR ([日期]=@d AND [ID]>@id) ORDER BY [日期],[ID];"
            : "SELECT TOP (1) [单号] FROM [半成品退库单] WHERE [日期]<@d OR ([日期]=@d AND [ID]<@id) ORDER BY [日期] DESC,[ID] DESC;",
            new { d = cur.日期, id = cur.ID });
        return adj is null ? null : await GetAsync(adj, showPrice);
    }

    private sealed class AdjacentAnchor { public long ID { get; set; } public DateTime 日期 { get; set; } }
}
```

- [ ] **Step 3: 写 DB 测试**

写 `tests/ErpApi.Tests/SemiStockReturnServiceDbTests.cs`（镜像 `SemiIssueServiceDbTests.cs`，断言库存 **+30**）：

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Warehouse.Semi;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class SemiStockReturnServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private SemiReceiptService ReceiptSvc() => new(Factory(), new DocumentNumberGenerator());
    private SemiStockReturnService Svc() => new(Factory(), new DocumentNumberGenerator());
    private async Task<decimal> Inv() =>
        (await new InventorySummaryService(Factory()).SemiFinishedAsync(P5cTestData.仓库))
            .Where(x => x.物料编号 == P5cTestData.物料编号).Sum(x => x.库存);

    [SkippableFact]
    public async Task Approve_increases_semi_inventory_by_returned_quantity_then_unapprove_restores()
    {
        using var c = fx.Open();
        P5cTestData.Seed(c);
        string? 入仓单号 = null;
        string? 退库单号 = null;
        try
        {
            入仓单号 = await ReceiptSvc().CreateAsync(new SemiReceiptCreateDto
            {
                仓库 = P5cTestData.仓库, 生产单号 = P5cTestData.生产单号, 款号 = P5cTestData.款号,
                供应商编号 = "", 供应商名称 = "测试加工厂",
                明细 =
                [
                    new SemiReceiptLineDto
                    {
                        配件编号 = P5cTestData.物料编号, 客户 = "ZURU", 产品货号 = P5cTestData.款号,
                        产品名称 = "P5c产品", 产品装配名称 = "P5c半成品料A", 生产单号 = P5cTestData.生产单号,
                        单位 = "件", 数量 = 100, 单价 = 2
                    }
                ]
            }, "tester");
            c.Execute("UPDATE [半成品入仓单] SET [审核]='1' WHERE [单号]=@n", new { n = 入仓单号 });
            Assert.Equal(100m, await Inv());

            // 自由选产品退库 30
            退库单号 = await Svc().CreateAsync(new SemiStockReturnCreateDto
            {
                仓库 = P5cTestData.仓库, 部门 = "车间一", 退料人 = "张三",
                明细 = [ new SemiStockReturnLineInput { 配件编号 = P5cTestData.物料编号, 数量 = 30 } ]
            }, "tester");

            // 审核（翻单头审核位，union 加库存）
            c.Execute("UPDATE [半成品退库单] SET [审核]='1' WHERE [单号]=@n", new { n = 退库单号 });
            Assert.Equal(130m, await Inv());

            // 反审核恢复
            c.Execute("UPDATE [半成品退库单] SET [审核]='0' WHERE [单号]=@n", new { n = 退库单号 });
            Assert.Equal(100m, await Inv());
        }
        finally
        {
            if (退库单号 != null)
            {
                c.Execute("DELETE FROM [半成品退库明细单] WHERE [单号]=@n", new { n = 退库单号 });
                c.Execute("DELETE FROM [半成品退库单] WHERE [单号]=@n", new { n = 退库单号 });
            }
            if (入仓单号 != null)
            {
                c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]=@n", new { n = 入仓单号 });
                c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]=@n", new { n = 入仓单号 });
            }
            P5cTestData.Cleanup(c);
        }
    }
}
```

- [ ] **Step 4: 停后端进程后编译并跑测试**

```powershell
dotnet build src/ErpApi
dotnet test tests/ErpApi.Tests --filter Approve_increases_semi_inventory_by_returned_quantity_then_unapprove_restores
```
Expected: 编译通过，测试 PASS（100→130→100）。

- [ ] **Step 5: Commit**

```bash
git add src/ErpApi/Features/Warehouse/Semi/SemiStockReturnDtos.cs src/ErpApi/Features/Warehouse/Semi/SemiStockReturnService.cs tests/ErpApi.Tests/SemiStockReturnServiceDbTests.cs
git commit -m "feat: semi stock return service + dtos + inventory test"
```

---

## Task 5: 后端 Controller + DI + 白名单 + MenuCatalog

**Files:**
- Create: `src/ErpApi/Features/Warehouse/Semi/SemiStockReturnController.cs`
- Modify: `src/ErpApi/Program.cs`
- Modify: `src/ErpApi/Engines/Posting/PostableDocuments.cs`
- Modify: `src/ErpApi/Features/Admin/MenuCatalog.cs`

- [ ] **Step 1: 写 Controller**

写 `src/ErpApi/Features/Warehouse/Semi/SemiStockReturnController.cs`（镜像 `SemiIssueController`，换 Menu/Table/route/service/类型/提示语）：

```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Features.MonthEnd;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Warehouse.Semi;

// 半成品退库 REST。审核/反审核仅翻单头审核位（走 PostingEngine，库存引擎按单头 JOIN 过滤审核）。
[ApiController]
[Authorize]
[Route("api/semi-stock-returns")]
public sealed class SemiStockReturnController(
    SemiStockReturnService svc, IPostingEngine posting, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory, PeriodLockService periodLock) : ControllerBase
{
    private const string Menu = "半成品退库";
    private const string Table = "半成品退库单";
    private const string 口径 = "半成品";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    {
        using var c = factory.Create(); await c.OpenAsync();
        await audit.WriteAsync(Table, behavior, CurrentUser, record, c);
    }

    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int size = 20, string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(page, size, keyword));
    }

    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号, await AllowAsync(PermissionAction.单价));
        if (d is null) return NotFound();
        return Ok(d);
    }

    [HttpGet("products")]
    public async Task<IActionResult> Products([FromQuery] SemiStockReturnProductQuery query)
        => !await AllowAsync(PermissionAction.打开) ? Forbid()
           : Ok(await svc.ProductsAsync(query, await AllowAsync(PermissionAction.单价)));

    [HttpGet("{单号}/adjacent")]
    public async Task<IActionResult> Adjacent(string 单号, bool next = false)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        if (await svc.GetAsync(单号, false) is null) return NotFound();
        var adj = await svc.GetAdjacentAsync(单号, next, await AllowAsync(PermissionAction.单价));
        return adj is null ? NoContent() : Ok(adj);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] SemiStockReturnCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await periodLock.EnsureWarehouseOpenAsync(口径, string.IsNullOrWhiteSpace(dto.仓库) ? "半成品仓" : dto.仓库, DateTime.Now); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        string 单号;
        try { 单号 = await svc.CreateAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (SqlException ex) when (ex.Number == 547) { return BadRequest(new { 消息 = "物料/生产单号/款号不存在。" }); }
        await AuditAsync("新增", $"单号={单号}");
        return CreatedAtAction(nameof(Get), new { 单号 }, new { 单号 });
    }

    [HttpPut("{单号}")]
    public async Task<IActionResult> Update(string 单号, [FromBody] SemiStockReturnCreateDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await periodLock.EnsureWarehouseOpenAsync(口径, string.IsNullOrWhiteSpace(dto.仓库) ? "半成品仓" : dto.仓库, DateTime.Now); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        try
        {
            if (!await svc.UpdateAsync(单号, dto, CurrentUser)) return NotFound();
        }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("修改", $"单号={单号}");
        return Ok(await svc.GetAsync(单号, await AllowAsync(PermissionAction.单价)));
    }

    [HttpDelete("{单号}")]
    public async Task<IActionResult> Delete(string 单号)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        try { if (!await svc.DeleteAsync(单号)) return NotFound(); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("删除", $"单号={单号}");
        return NoContent();
    }

    [HttpPost("{单号}/approve")]
    public async Task<IActionResult> Approve(string 单号)
    {
        if (!await AllowAsync(PermissionAction.审核)) return Forbid();
        try { await periodLock.EnsureHeaderOpenAsync(口径, Table, 单号); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        if (!await posting.ApproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "审核失败：单不存在或已审核。" });
        return NoContent();
    }

    [HttpPost("{单号}/unapprove")]
    public async Task<IActionResult> Unapprove(string 单号)
    {
        if (!await AllowAsync(PermissionAction.反审核)) return Forbid();
        try { await periodLock.EnsureHeaderOpenAsync(口径, Table, 单号); }
        catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
        if (!await posting.UnapproveAsync(Table, 单号, CurrentUser))
            return Conflict(new { 消息 = "反审核失败：单不存在或未审核。" });
        return NoContent();
    }
}
```

- [ ] **Step 2: DI 注册（Program.cs）**

在 `src/ErpApi/Program.cs` 中 `builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiIssueService>();` 那一行之后加：

```csharp
builder.Services.AddScoped<ErpApi.Features.Warehouse.Semi.SemiStockReturnService>();
```

- [ ] **Step 3: 白名单（PostableDocuments.cs）**

在 `src/ErpApi/Engines/Posting/PostableDocuments.cs` 的字典里，`["半成品盘点单"] = "单号",` 同行/相邻处加：

```csharp
            ["半成品退库单"] = "单号",
```

- [ ] **Step 4: MenuCatalog.cs**

在 `src/ErpApi/Features/Admin/MenuCatalog.cs` 中 `new("半成品仓库","半成品退仓"),` 之后加：

```csharp
        new("半成品仓库","半成品退库"),
```

- [ ] **Step 5: 停后端进程后编译**

```powershell
dotnet build src/ErpApi
```
Expected: 通过。

- [ ] **Step 6: Commit**

```bash
git add src/ErpApi/Features/Warehouse/Semi/SemiStockReturnController.cs src/ErpApi/Program.cs src/ErpApi/Engines/Posting/PostableDocuments.cs src/ErpApi/Features/Admin/MenuCatalog.cs
git commit -m "feat: semi stock return controller + DI + posting whitelist + menu catalog"
```

---

## Task 6: 前端 api + utils

**Files:**
- Modify: `web/src/api/semi.ts`
- Create: `web/src/utils/semiStockReturn.ts`
- Create: `web/src/__tests__/semiStockReturn.test.ts`

- [ ] **Step 1: 在 `semi.ts` 加 SSR 类型 + api**

在 `semi.ts` 的领料段之后（或文件内合适处，`semiIssueApi` 定义之后）追加类型与 api：

```ts
export interface SSRProductRow { 配件编号: string; 客户?: string | null; 产品货号?: string | null; 产品名称?: string | null; 产品装配名称?: string | null; 生产单号?: string | null; 加工单价?: number | null; 库存单价?: number | null }
export interface SSRLineInput { 配件编号: string; 客户?: string | null; 产品货号?: string | null; 产品名称?: string | null; 产品装配名称?: string | null; 生产单号?: string | null; 数量: number; 备注?: string | null }
export interface SSRLineRow { ID?: number; 配件编号?: string | null; 客户?: string | null; 产品货号?: string | null; 产品名称?: string | null; 产品装配名称?: string | null; 生产单号?: string | null; 规格?: string | null; 颜色?: string | null; 单位?: string | null; 数量?: number | null; 单价?: number | null; 金额?: number | null; 备注?: string | null }
export interface SSRCreate { 日期?: string; 仓库: string; 部门?: string | null; 退料人?: string | null; 备注?: string | null; 明细: SSRLineInput[] }
export interface SSRHeader { ID?: number; id?: number; 单号?: string; 仓库?: string; 部门?: string | null; 退料人?: string | null; 日期?: string; 审核日期?: string | null; 数量?: number | null; 金额?: number | null; 操作员?: string | null; 审核?: string; 审核人?: string | null; 备注?: string | null }
export interface SSRDetail { 单头: SSRHeader | null; 明细: SSRLineRow[] }

export const semiStockReturnApi = {
  list: (page = 1, size = 20, keyword = "") => api.get<Paged<SSRHeader>>("/semi-stock-returns", { params: { page, size, keyword } }).then(r => r.data),
  get: (单号: string) => api.get<SSRDetail>(`/semi-stock-returns/${enc(单号)}`).then(r => r.data),
  create: (body: SSRCreate) => api.post<{ 单号: string }>("/semi-stock-returns", body).then(r => r.data),
  update: (单号: string, body: SSRCreate) => api.put<SSRDetail>(`/semi-stock-returns/${enc(单号)}`, body).then(r => r.data),
  remove: (单号: string) => api.delete(`/semi-stock-returns/${enc(单号)}`),
  approve: (单号: string) => api.post(`/semi-stock-returns/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/semi-stock-returns/${enc(单号)}/unapprove`),
  products: (params: { page?: number; size?: number; field?: string; keyword?: string; exact?: boolean } = {}) =>
    api.get<Paged<SSRProductRow>>("/semi-stock-returns/products", { params }).then(r => r.data),
  adjacent: (单号: string, next: boolean) =>
    api.get<SSRDetail | undefined>(`/semi-stock-returns/${enc(单号)}/adjacent`, { params: { next } })
      .then(r => r.status === 204 ? undefined : r.data),
};
```

（`enc` / `api` / `Paged` 已在本文件可用。）

- [ ] **Step 2: 先写失败的 utils 测试**

写 `web/src/__tests__/semiStockReturn.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { mergeSemiStockReturnLines, validateSemiStockReturn, type SSRDraftLine } from "../utils/semiStockReturn";

const line = (p: Partial<SSRDraftLine>): SSRDraftLine => ({ key: 0, 配件编号: "", 数量: 0, ...p });

describe("mergeSemiStockReturnLines", () => {
  it("按配件编号去重，保留已存在数量，追加新产品", () => {
    const existing = [line({ key: 1, 配件编号: "A", 数量: 5 })];
    const picked = [{ 配件编号: "A" }, { 配件编号: "B" }];
    const merged = mergeSemiStockReturnLines(existing, picked);
    expect(merged.map(l => l.配件编号)).toEqual(["A", "B"]);
    expect(merged.find(l => l.配件编号 === "A")!.数量).toBe(5);
  });
});

describe("validateSemiStockReturn", () => {
  it("至少一行有效明细", () => {
    expect(validateSemiStockReturn({ 明细: [] })).toBe("请至少录入一行退库产品。");
  });
  it("数量必须大于0", () => {
    expect(validateSemiStockReturn({ 明细: [line({ 配件编号: "A", 数量: 0 })] })).toBe("退库数量必须大于 0。");
  });
  it("配件编号不重复", () => {
    expect(validateSemiStockReturn({ 明细: [line({ 配件编号: "A", 数量: 1 }), line({ 配件编号: "A", 数量: 2 })] })).toBe("配件编号 A 在同一单据中重复。");
  });
  it("通过返回 null", () => {
    expect(validateSemiStockReturn({ 明细: [line({ 配件编号: "A", 数量: 1 })] })).toBeNull();
  });
});
```

- [ ] **Step 3: 运行确认失败**

```powershell
cd web; npx vitest run src/__tests__/semiStockReturn.test.ts
```
Expected: FAIL（`../utils/semiStockReturn` 不存在）。

- [ ] **Step 4: 写 `utils/semiStockReturn.ts`**

```ts
export interface SSRDraftLine {
  key: number;
  配件编号: string;
  客户?: string | null;
  产品货号?: string | null;
  产品名称?: string | null;
  产品装配名称?: string | null;
  生产单号?: string | null;
  数量: number;
  备注?: string | null;
}

interface PickedProduct {
  配件编号: string;
  客户?: string | null;
  产品货号?: string | null;
  产品名称?: string | null;
  产品装配名称?: string | null;
  生产单号?: string | null;
}

export function mergeSemiStockReturnLines(existing: SSRDraftLine[], picked: PickedProduct[]): SSRDraftLine[] {
  const seen = new Map(existing.map(l => [l.配件编号.trim(), l]));
  let key = existing.reduce((m, l) => Math.max(m, l.key), 0);
  for (const p of picked) {
    const code = p.配件编号?.trim();
    if (!code || seen.has(code)) continue;
    const row: SSRDraftLine = {
      key: ++key, 配件编号: code, 客户: p.客户 ?? null, 产品货号: p.产品货号 ?? null,
      产品名称: p.产品名称 ?? null, 产品装配名称: p.产品装配名称 ?? null,
      生产单号: p.生产单号 ?? null, 数量: 0, 备注: "",
    };
    seen.set(code, row);
  }
  return [...seen.values()];
}

export function validateSemiStockReturn(input: { 明细: SSRDraftLine[] }): string | null {
  const valid = input.明细.filter(l => l.配件编号.trim());
  if (valid.length === 0) return "请至少录入一行退库产品。";
  for (const l of valid) if (Number(l.数量) <= 0) return "退库数量必须大于 0。";
  const seen = new Set<string>();
  for (const l of valid) {
    const code = l.配件编号.trim();
    if (seen.has(code)) return `配件编号 ${code} 在同一单据中重复。`;
    seen.add(code);
  }
  return null;
}
```

- [ ] **Step 5: 运行确认通过**

```powershell
cd web; npx vitest run src/__tests__/semiStockReturn.test.ts
```
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add web/src/api/semi.ts web/src/utils/semiStockReturn.ts web/src/__tests__/semiStockReturn.test.ts
git commit -m "feat: semi stock return frontend api + free-select utils"
```

---

## Task 7: 前端页面 + 菜单 + 路由

**Files:**
- Create: `web/src/pages/warehouse/SemiStockReturnPage.tsx`
- Modify: `web/src/nav/menuTree.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: 写页面**

写 `web/src/pages/warehouse/SemiStockReturnPage.tsx`（镜像出库页去掉右侧库存网格、简化头为 部门/日期/退料人/电脑单号/备注/操作员）：

```tsx
import { useMemo, useState } from "react";
import { Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Row, Space, Statistic, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CheckOutlined, CloseOutlined, CopyOutlined, DeleteOutlined, FileAddOutlined, FolderOpenOutlined, LeftOutlined, PrinterOutlined, ProfileOutlined, ReloadOutlined, RightOutlined, SaveOutlined, SearchOutlined, ShoppingOutlined, TableOutlined, UndoOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useNavigate } from "react-router-dom";
import { semiStockReturnApi, type SSRDetail, type SSRHeader } from "../../api/semi";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import { mergeSemiStockReturnLines, validateSemiStockReturn, type SSRDraftLine } from "../../utils/semiStockReturn";
import SemiFinishedLabelProductPicker, { type SemiFinishedLabelProduct } from "../semi/SemiFinishedLabelProductPicker";
import EmployeePicker from "../materials/EmployeePicker";

const MENU = "半成品退库";
const WAREHOUSE = "半成品仓";
const user = () => localStorage.getItem("erp_user") || "admin";
const err = (e: unknown, f: string) => (e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? f;
type HeaderForm = { 单号?: string; 部门?: string; 退料人?: string; 日期?: Dayjs; 备注?: string; 操作员?: string };

export default function SemiStockReturnPage() {
  const [form] = Form.useForm<HeaderForm>(); const perms = usePerms(); const navigate = useNavigate();
  const canOpen = can(perms, MENU, "打开"), canSave = can(perms, MENU, "保存"), canDelete = can(perms, MENU, "删除"), canAudit = can(perms, MENU, "审核"), canReverse = can(perms, MENU, "反审核"), canPrint = can(perms, MENU, "打印");
  const [opened, setOpened] = useState<SSRDetail | null>(null); const [lines, setLines] = useState<SSRDraftLine[]>([]); const [busy, setBusy] = useState(false);
  const [productOpen, setProductOpen] = useState(false); const [openOpen, setOpenOpen] = useState(false); const [empOpen, setEmpOpen] = useState(false);
  const audited = opened?.单头?.审核 === "1"; const readOnly = audited || !canSave || busy;

  const reset = () => { form.setFieldsValue({ 单号: "", 部门: "", 退料人: "", 日期: dayjs(), 备注: "", 操作员: user() }); setOpened(null); setLines([]); };
  const apply = (d: SSRDetail) => {
    const h = d.单头 ?? {} as SSRHeader;
    form.setFieldsValue({ 单号: h.单号, 部门: h.部门 ?? "", 退料人: h.退料人 ?? "", 日期: h.日期 ? dayjs(h.日期) : dayjs(), 备注: h.备注 ?? "", 操作员: h.操作员 ?? user() });
    setLines((d.明细 ?? []).map((x, i) => ({ key: i + 1, 配件编号: x.配件编号 ?? "", 客户: x.客户, 产品货号: x.产品货号, 产品名称: x.产品名称, 产品装配名称: x.产品装配名称, 生产单号: x.生产单号, 数量: Number(x.数量 ?? 0), 备注: x.备注 ?? "" })));
    setOpened(d);
  };
  const openDoc = async (no: string) => { setBusy(true); try { apply(await semiStockReturnApi.get(no)); } catch (e) { message.error(err(e, "打开退库单失败")); } finally { setBusy(false); } };
  const pickProducts = (rows: SemiFinishedLabelProduct[]) => setLines(cur => mergeSemiStockReturnLines(cur, rows.map(p => ({ 配件编号: p.配件编号, 客户: p.客户, 产品货号: p.产品货号, 产品名称: p.产品名称, 产品装配名称: p.产品装配名称, 生产单号: (p as { 生产单号?: string | null }).生产单号 }))));
  const updateLine = (key: number, patch: Partial<SSRDraftLine>) => setLines(v => v.map(x => x.key === key ? { ...x, ...patch } : x));

  const buildPayload = () => {
    const h = form.getFieldsValue();
    const issue = validateSemiStockReturn({ 明细: lines });
    if (issue) { message.error(issue); return null; }
    return { 日期: (h.日期 ?? dayjs()).format("YYYY-MM-DD"), 仓库: WAREHOUSE, 部门: h.部门, 退料人: h.退料人, 备注: h.备注?.trim(),
      明细: lines.filter(x => x.配件编号.trim() && Number(x.数量) > 0).map(x => ({ 配件编号: x.配件编号, 客户: x.客户, 产品货号: x.产品货号, 产品名称: x.产品名称, 产品装配名称: x.产品装配名称, 生产单号: x.生产单号, 数量: Number(x.数量), 备注: x.备注 })) };
  };
  const save = async () => { const body = buildPayload(); if (!body || readOnly) return; setBusy(true); try { const no = opened?.单头 ? (await semiStockReturnApi.update(opened.单头.单号!, body), opened.单头.单号!) : (await semiStockReturnApi.create(body)).单号; apply(await semiStockReturnApi.get(no)); message.success("半成品退库单已保存"); } catch (e) { message.error(err(e, "保存失败")); } finally { setBusy(false); } };
  const audit = async (reverse: boolean) => { if (!opened?.单头?.单号) return; setBusy(true); try { reverse ? await semiStockReturnApi.unapprove(opened.单头.单号) : await semiStockReturnApi.approve(opened.单头.单号); apply(await semiStockReturnApi.get(opened.单头.单号)); message.success(reverse ? "已反审核" : "已审核"); } catch (e) { message.error(err(e, reverse ? "反审核失败" : "审核失败")); } finally { setBusy(false); } };
  const remove = async () => { if (!opened?.单头?.单号) return; setBusy(true); try { await semiStockReturnApi.remove(opened.单头.单号); reset(); message.success("已删除"); } catch (e) { message.error(err(e, "删除失败")); } finally { setBusy(false); } };
  const move = async (next: boolean) => { if (!opened?.单头?.单号) return; setBusy(true); try { const d = await semiStockReturnApi.adjacent(opened.单头.单号, next); if (!d) message.info(next ? "已经是最后一张单据" : "已经是第一张单据"); else apply(d); } catch (e) { message.error(err(e, "切换单据失败")); } finally { setBusy(false); } };
  const copy = () => { if (!opened) return; setOpened(null); form.setFieldsValue({ 单号: "", 日期: dayjs(), 操作员: user() }); message.success("已复制为未保存新单"); };

  const totalQty = useMemo(() => lines.reduce((a, x) => a + Number(x.数量 || 0), 0), [lines]);
  const cols: ColumnsType<SSRDraftLine> = [
    { title: "删除", width: 58, fixed: "left", render: (_, x) => <Button type="text" danger icon={<DeleteOutlined />} disabled={readOnly} onClick={() => setLines(v => v.filter(y => y.key !== x.key))} /> },
    { title: "装配采购", width: 90, render: () => "" },
    { title: "配件编号", dataIndex: "配件编号", width: 130 }, { title: "客户", dataIndex: "客户", width: 110 }, { title: "产品货号", dataIndex: "产品货号", width: 140 }, { title: "产品名称", dataIndex: "产品名称", width: 170 }, { title: "产品装配名称", dataIndex: "产品装配名称", width: 190 }, { title: "生产单号", dataIndex: "生产单号", width: 140 },
    { title: "数量", dataIndex: "数量", width: 120, align: "right", render: (_, x) => <InputNumber min={0} value={x.数量} disabled={readOnly} onChange={v => updateLine(x.key, { 数量: Number(v ?? 0) })} style={{ width: "100%" }} /> },
    { title: "备注", dataIndex: "备注", width: 160, render: (_, x) => <Input value={x.备注 ?? ""} disabled={readOnly} onChange={e => updateLine(x.key, { 备注: e.target.value })} /> },
  ];

  if (!canOpen) return <Card variant="borderless"><div style={{ padding: 24, color: "#8c8c8c" }}>无权访问该页面</div></Card>;
  return <Card title="半成品退库单" variant="borderless" extra={<Space wrap>
    <Button icon={<FileAddOutlined />} disabled={busy} onClick={reset}>新建</Button>
    <Button icon={<FolderOpenOutlined />} disabled={busy} onClick={() => setOpenOpen(true)}>打开</Button>
    <Button type="primary" icon={<SaveOutlined />} disabled={readOnly} loading={busy} onClick={() => void save()}>保存</Button>
    <Popconfirm title="确认删除当前退库单？" disabled={!opened || audited || !canDelete} onConfirm={() => void remove()}><Button icon={<DeleteOutlined />} disabled={!opened || audited || !canDelete}>删除</Button></Popconfirm>
    <Button icon={<ShoppingOutlined />} disabled title="装配采购清单（后续）">装配采购清单</Button>
    <Button icon={<ReloadOutlined />} disabled={!opened || busy} onClick={() => opened?.单头?.单号 && void openDoc(opened.单头.单号)}>刷新</Button>
    <Button icon={<ProfileOutlined />} disabled={readOnly} onClick={() => setProductOpen(true)}>资料</Button>
    <Button icon={<LeftOutlined />} disabled={!opened || busy} onClick={() => void move(false)}>前单</Button>
    <Button icon={<RightOutlined />} disabled={!opened || busy} onClick={() => void move(true)}>后单</Button>
    <Button icon={<CopyOutlined />} disabled={!opened || !canSave} onClick={copy}>复制单</Button>
    <Button icon={<CheckOutlined />} disabled={!opened || audited || !canAudit} onClick={() => void audit(false)}>审核</Button>
    <Button icon={<UndoOutlined />} disabled={!opened || !audited || !canReverse} onClick={() => void audit(true)}>反审核</Button>
    <Button icon={<TableOutlined />} disabled>表格设置</Button>
    <Button icon={<PrinterOutlined />} disabled={!canPrint} onClick={() => window.print()}>打印</Button>
    <Button danger icon={<CloseOutlined />} disabled={busy} onClick={() => window.history.length > 1 ? navigate(-1) : navigate("/")}>关闭</Button>
  </Space>}>
    <Form form={form} layout="vertical" size="small" initialValues={{ 日期: dayjs(), 操作员: user() }}><Row gutter={12}>
      <Col xs={12} sm={8} lg={5}><Form.Item label="部门" name="部门"><Input disabled={readOnly} /></Form.Item></Col>
      <Col xs={12} sm={8} lg={4}><Form.Item label="日期" name="日期"><DatePicker disabled={readOnly} style={{ width: "100%" }} /></Form.Item></Col>
      <Col xs={12} sm={8} lg={5}><Form.Item label="退料人" required><Space.Compact style={{ width: "100%" }}><Form.Item name="退料人" noStyle><Input readOnly /></Form.Item><Button icon={<SearchOutlined />} disabled={readOnly} onClick={() => setEmpOpen(true)} /></Space.Compact></Form.Item></Col>
      <Col xs={12} sm={8} lg={5}><Form.Item label="电脑单号" name="单号"><Input readOnly placeholder="保存后生成" /></Form.Item></Col>
      <Col xs={24} sm={16} lg={8}><Form.Item label="备注" name="备注"><Input disabled={readOnly} /></Form.Item></Col>
      <Col xs={12} sm={8} lg={4}><Form.Item label="操作员" name="操作员"><Input readOnly /></Form.Item></Col>
      <Col xs={12} sm={8} lg={4}><Form.Item label="审核状态"><Tag color={audited ? "success" : "default"}>{audited ? "已审核" : "未审核"}</Tag></Form.Item></Col>
    </Row></Form>
    <Table<SSRDraftLine> rowKey="key" size="small" columns={cols} dataSource={lines} pagination={false} scroll={{ x: 1300, y: "calc(100vh - 430px)" }} />
    <Space size={48} style={{ marginTop: 14 }}><Statistic title="数量合计" value={totalQty} /></Space>
    <SemiFinishedLabelProductPicker open={productOpen} permissionMenu={MENU}
      loadProducts={q => semiStockReturnApi.products(q) as unknown as Promise<{ items: SemiFinishedLabelProduct[]; total: number }>}
      onPick={rows => { setProductOpen(false); pickProducts(rows); }} onClose={() => setProductOpen(false)} />
    <EmployeePicker open={empOpen} onPick={(name: string) => { form.setFieldsValue({ 退料人: name }); setEmpOpen(false); }} onClose={() => setEmpOpen(false)} />
    <Modal title="打开半成品退库单" open={openOpen} onCancel={() => setOpenOpen(false)} footer={null} width={900} destroyOnClose>
      <OpenList onPick={no => { setOpenOpen(false); void openDoc(no); }} />
    </Modal>
  </Card>;
}

function OpenList({ onPick }: { onPick: (no: string) => void }) {
  const [keyword, setKeyword] = useState(""); const [rows, setRows] = useState<SSRHeader[]>([]); const [loading, setLoading] = useState(false);
  const load = async () => { setLoading(true); try { setRows((await semiStockReturnApi.list(1, 100, keyword.trim())).items as SSRHeader[]); } catch { message.error("加载退库单失败"); } finally { setLoading(false); } };
  return <>
    <Input.Search allowClear value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={() => void load()} onFocus={() => rows.length === 0 && void load()} placeholder="电脑单号 / 仓库 / 退料人" style={{ width: 320, marginBottom: 12 }} />
    <Table<SSRHeader> rowKey={r => r.单号 ?? String(r.ID ?? r.id)} size="small" loading={loading} dataSource={rows} pagination={false} scroll={{ y: 440 }}
      onRow={r => ({ onDoubleClick: () => r.单号 && onPick(r.单号), style: { cursor: "pointer" } })}
      columns={[{ title: "电脑单号", dataIndex: "单号", width: 150 }, { title: "日期", dataIndex: "日期", width: 110, render: v => v?.slice(0, 10) }, { title: "部门", dataIndex: "部门", width: 120 }, { title: "退料人", dataIndex: "退料人", width: 100 }, { title: "数量", dataIndex: "数量", width: 90, align: "right" }, { title: "状态", dataIndex: "审核", width: 90, render: v => <Tag color={v === "1" ? "success" : "default"}>{v === "1" ? "已审核" : "未审核"}</Tag> }]} />
  </>;
}
```

- [ ] **Step 2: 菜单占位落地（menuTree.tsx）**

把 `web/src/nav/menuTree.tsx` 第 162 行 `M("半成品退库单"),` 改为：

```tsx
    M("半成品退库单", "/semi-stock-returns", "半成品退库"),
```

- [ ] **Step 3: 路由（App.tsx）**

在 `web/src/App.tsx` `import SemiIssuePage from "./pages/warehouse/SemiIssuePage";` 之后加：

```tsx
import SemiStockReturnPage from "./pages/warehouse/SemiStockReturnPage";
```

在 `<Route path="semi-issues" element={<SemiIssuePage />} />` 之后加：

```tsx
          <Route path="semi-stock-returns" element={<SemiStockReturnPage />} />
```

- [ ] **Step 4: 类型检查 + 测试**

```powershell
cd web; npx tsc -b; npx vitest run src/__tests__/semiStockReturn.test.ts
```
Expected: 无类型错误，测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/warehouse/SemiStockReturnPage.tsx web/src/nav/menuTree.tsx web/src/App.tsx
git commit -m "feat: semi stock return page + menu + route"
```

---

## Task 8: 端到端冒烟验证

**Files:** 无（验证任务）

- [ ] **Step 1: 全量回归（先停后端进程）**

```powershell
dotnet test tests/ErpApi.Tests
cd web; npx vitest run; npx tsc -b
```
Expected：本功能测试全绿；后端仅剩预存 `工模编号`/`装配物料报价` schema 漂移失败（与本功能无关）。

- [ ] **Step 2: 启动后端 + 前端**

```powershell
dotnet run --project src/ErpApi   # 端口 5000
cd web; npm run dev               # 端口 5173
```

- [ ] **Step 3: HTTP 冒烟全生命周期**

登录 admin/admin123，用已审核入仓单的物料（如 `SM1`，半成品仓）走：
1. `POST /api/semi-stock-returns`（body `{仓库:"半成品仓",部门:"车间一",退料人:"张三",明细:[{配件编号:"SM1",数量:30}]}`）→ 得 `BTK...` 单号。
2. 审核前查 `/api/semi-inventory?仓库=半成品仓` SM1 库存不变；`POST {单号}/approve` → 库存 **+30**；`{单号}/unapprove` → 恢复。
3. `GET {单号}` 明细别名正确（配件编号/产品装配名称/规格/颜色从入仓派生）；`GET {单号}/adjacent?next=true/false` 前后单；已审删拒 409、未审删 204。

（Chinese JSON 用 `--data-binary @文件`；命名管道用 PowerShell + `SqlLocalDB info`。）

- [ ] **Step 4: 手动对照截图**

半成品仓库 > 半成品退库单：简头（部门/日期/退料人🔍/电脑单号/备注/操作员）+ 资料自由选品 + 明细八列 + 底部仅数量合计 + **无右侧网格**，布局与截图一致。

- [ ] **Step 5: Commit（若冒烟中有微调，逐文件 add）**

```bash
git add <本功能改动文件>
git commit -m "test: verify semi stock return free-select end-to-end"
```

---

## Self-Review 覆盖检查

- 净新表 → Task 1；权限种子 → Task 2；union +分支 → Task 3。
- 库存口径（实时 union +库存）→ Task 3 分支 + Task 4 SaveCore 落 仓库/物料编号/颜色 + DB 测试（+30）覆盖。
- 仓库固定半成品仓 → Task 4 SaveCore 默认 + Controller 月结锁默认 + Task 7 `WAREHOUSE` 常量覆盖。
- 自由选产品（资料）→ Task 4 ProductsAsync + Task 7 SemiFinishedLabelProductPicker 复用覆盖。
- 简领料头（部门/退料人）→ Task 1 表 + Task 4 DTO/SaveCore + Task 7 表单覆盖。
- 无价 / 无右侧网格 → Task 7 页面覆盖；后端保留 showPrice 脱敏。
- 审核走 PostingEngine → Task 5 Controller + 白名单；Task 4 DB 测试翻位模拟。
- 前后单/复制/删除 → Controller + Service + 页面覆盖。
- 接入（DI/白名单/MenuCatalog/菜单/路由）→ Task 5 + Task 7 覆盖。
- 现有测试影响：无（净新，不改现有单据）。
