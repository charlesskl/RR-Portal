# 半成品出库单（自由选产品版）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「半成品出库单」（现有 `SemiIssue`，即半成品领料单）从旧的「物料编号行」极简录入改写成截图的「自由选产品」模型：领料式头 → 点「资料」从产品库自由选产品录出库数量 → 审核实时减半成品库存。

**Architecture:** 复用现有 `半成品领料单/半成品领料明细单` 两表（仅头加 6 列）；方向减已在 `InventorySummaryService.SemiSql`（`半成品领料明细单 数量*-1`）；审核**复用 PostingEngine**（`半成品领料单` 已在 PostableDocuments 白名单）。Dapper 服务改为自由选产品：保存时仓库默认 `半成品仓`，按 `物料编号+仓库` 从最近已审核 `半成品入仓明细单` 派生权威 颜色/规格/单位/单价/生产单号（保证实时库存 union 按 仓库+物料编号+颜色 正确净额）。React 页面全屏主从重写，明细来源换成复用退仓的 `products` 自由选择器，右侧加库存参考网格。无价单（不显示价格）。

**Tech Stack:** SQL Server migration（幂等 ALTER）、ASP.NET Core 8、Dapper、xUnit、React 19、TypeScript、Ant Design 6、Vitest。

## Global Constraints

- 菜单/路由/DI/权限/白名单均已存在，不新增接入：菜单 `半成品仓库 > 半成品出库单`，路由 `/semi-issues`，权限菜单 `半成品领料`，前缀 `BL`，PostableDocuments 白名单 `半成品领料单`。
- 半成品库存为实时台账，出库明细必须落库 `仓库 / 物料编号 / 颜色 / 数量`，否则减库存不正确。审核只翻单头审核位（走 PostingEngine），不写台账。
- **仓库默认 `半成品仓`**：DTO 保留 `仓库` 字段，服务端 `空→半成品仓`；前端硬编码发 `半成品仓`（无 picker）；DB/集成测试传 `P5c半成品仓` 以复用现有 P5c fixture。
- 每次只暂存本任务明确列出的文件；工作区有大量无关改动，**绝不 `git add -A`**（Task 8 冒烟同样逐文件）。
- 后端启动会锁 `bin/ErpApi.dll`：跑 `dotnet build`/`dotnet test` 前先停掉在跑的后端进程（前端 dev server 不影响）。
- **无价单**：截图明细无单价/金额列、底部仅数量合计；前端不渲染价格。后端仍存 单价/金额（内部记录），并保留 `单价` 权限脱敏参防端点直连泄露。

## File Structure

- `db/migrate_semi_issue_freeselect.sql` — **新建**：幂等 ALTER 给 `半成品领料单` 加 6 列。
- `src/ErpApi/Features/Warehouse/Semi/SemiDtos.cs` — 改：重写 `SemiIssue*` DTO（自由选产品明细 + 富头 + 产品行）。
- `src/ErpApi/Features/Warehouse/Semi/SemiIssueService.cs` — 改：重写 `CreateAsync`→`SaveCoreAsync`，加 `UpdateAsync`/`ProductsAsync`/`GetAdjacentAsync`，重写 `GetAsync` 别名。保留 `ListAsync`/`DeleteAsync`。
- `src/ErpApi/Features/Warehouse/Semi/SemiIssueController.cs` — 改：加 `PUT {单号}`、`GET products`、`GET {单号}/adjacent`；`Get` 传 showPrice；审核/反审核不动。
- `tests/ErpApi.Tests/SemiIssueServiceDbTests.cs` — **替换**（文件已存在，旧 `Create_then_delete_lifecycle` 用旧 DTO，整体替换为自由选库存净额测试）。
- `tests/ErpApi.Tests/P5cApiIntegrationTests.cs` — 改：两处 `/api/semi-issues` 建单改自由选 shape。
- `web/src/api/semi.ts` — 改：重写 `SI*` 类型 + `semiIssueApi`（get/update/products/adjacent）。
- `web/src/utils/semiIssue.ts` — **新建**：`mergeSemiIssueLines`/`validateSemiIssue`。
- `web/src/__tests__/semiIssue.test.ts` — **新建**：utils 纯计算。
- `web/src/pages/warehouse/SemiIssuePage.tsx` — 改：全屏主从重写。
- `web/src/pages/warehouse/SemiIssueCreateDrawer.tsx` — **删除**。

---

## Task 1: DB 迁移（半成品领料单加 6 列）

**Files:**
- Create: `db/migrate_semi_issue_freeselect.sql`

- [ ] **Step 1: 写幂等 ALTER 迁移**

写 `db/migrate_semi_issue_freeselect.sql`：

```sql
-- 半成品出库单（自由选产品版）：半成品领料单 头加 6 列（审核日期已存在，不加）
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF COL_LENGTH(N'半成品领料单', N'拉长') IS NULL
    ALTER TABLE [半成品领料单] ADD [拉长] nvarchar(20) NULL;
IF COL_LENGTH(N'半成品领料单', N'收件人') IS NULL
    ALTER TABLE [半成品领料单] ADD [收件人] nvarchar(20) NULL;
IF COL_LENGTH(N'半成品领料单', N'领料备注') IS NULL
    ALTER TABLE [半成品领料单] ADD [领料备注] nvarchar(40) NULL;
IF COL_LENGTH(N'半成品领料单', N'件数') IS NULL
    ALTER TABLE [半成品领料单] ADD [件数] decimal(18,4) NULL;
IF COL_LENGTH(N'半成品领料单', N'卡板数') IS NULL
    ALTER TABLE [半成品领料单] ADD [卡板数] decimal(18,4) NULL;
IF COL_LENGTH(N'半成品领料单', N'制单人') IS NULL
    ALTER TABLE [半成品领料单] ADD [制单人] nvarchar(20) NULL;

COMMIT TRANSACTION;
```

- [ ] **Step 2: 部署迁移到 erp 与 erp_test**

Run:
```powershell
dotnet run --project tools/DbDeploy -- $env:ERP_DB db/migrate_semi_issue_freeselect.sql
dotnet run --project tools/DbDeploy -- $env:ERP_TEST_DB db/migrate_semi_issue_freeselect.sql
```
Expected: 两库均「完成」，无报错。

- [ ] **Step 3: 验证列已加（erp_test）**

Run（PowerShell，命名管道见记忆 `np:\\.\pipe\LOCALDB#...`；用 `SqlLocalDB info MSSQLLocalDB` 取当前管道）:
```powershell
$pipe = (SqlLocalDB info MSSQLLocalDB | Select-String 'Instance pipe name' ) -replace '.*:\s*',''
sqlcmd -S $pipe -d erp_test -h -1 -W -Q "SET NOCOUNT ON; SELECT name FROM sys.columns WHERE object_id=OBJECT_ID(N'[半成品领料单]') AND name IN (N'拉长',N'收件人',N'领料备注',N'件数',N'卡板数',N'制单人') ORDER BY name;"
```
Expected: 列出 6 个新列名。

- [ ] **Step 4: Commit**

```bash
git add db/migrate_semi_issue_freeselect.sql
git commit -m "db: add semi issue free-select header columns"
```

---

## Task 2: 后端 DTO 重写（自由选产品明细 + 富头 + 产品行）

**Files:**
- Modify: `src/ErpApi/Features/Warehouse/Semi/SemiDtos.cs`

- [ ] **Step 1: 替换 `// ---- 领料 ----` 整段（第 77-118 行区块）**

把 `SemiIssueLineDto` / `SemiIssueCreateDto` / `SemiIssueHeaderDto` / `SemiIssueLineRowDto` / `SemiIssueDetailDto` 五个类整体替换为下列内容（删除旧 `SemiIssueLineDto`）：

```csharp
// ---- 领料（半成品出库单 · 自由选产品版）----
public sealed class SemiIssueLineInput
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
public sealed class SemiIssueCreateDto
{
    public DateTime? 日期 { get; set; }
    public string 仓库 { get; set; } = "";
    public string? 部门 { get; set; }
    public string? 领料人 { get; set; }
    public string? 拉长 { get; set; }
    public string? 收件人 { get; set; }
    public string? 领料备注 { get; set; }
    public decimal? 件数 { get; set; }
    public decimal? 卡板数 { get; set; }
    public string? 制单人 { get; set; }
    public string? 备注 { get; set; }
    public List<SemiIssueLineInput> 明细 { get; set; } = [];
}
public sealed class SemiIssueHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 仓库 { get; set; }
    public string? 部门 { get; set; }
    public string? 领料人 { get; set; }
    public string? 拉长 { get; set; }
    public string? 收件人 { get; set; }
    public string? 领料备注 { get; set; }
    public decimal? 件数 { get; set; }
    public decimal? 卡板数 { get; set; }
    public string? 制单人 { get; set; }
    public DateTime? 日期 { get; set; }
    public DateTime? 审核日期 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}
public sealed class SemiIssueLineRowDto
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
public sealed class SemiIssueDetailDto
{ public SemiIssueHeaderDto? 单头 { get; set; } public List<SemiIssueLineRowDto> 明细 { get; set; } = []; }
public sealed class SemiIssueProductQuery
{
    public int Page { get; set; } = 1;
    public int Size { get; set; } = 50;
    public string? Field { get; set; }
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
}
public sealed class SemiIssueProductRow
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

- [ ] **Step 2: 编译占位（随 Task 3 整体验证）**

本任务不单独编译，DTO 改动随 Task 3 一起验证。

- [ ] **Step 3: Commit**

```bash
git add src/ErpApi/Features/Warehouse/Semi/SemiDtos.cs
git commit -m "feat: semi issue dtos to free-select product snapshot"
```

---

## Task 3: 后端 Service 重写 + DB 测试

**Files:**
- Modify: `src/ErpApi/Features/Warehouse/Semi/SemiIssueService.cs`
- Modify: `tests/ErpApi.Tests/SemiIssueServiceDbTests.cs`（文件已存在，整体替换）

- [ ] **Step 1: 整体替换现有 DB 测试文件**

`tests/ErpApi.Tests/SemiIssueServiceDbTests.cs` **已存在**（旧 `Create_then_delete_lifecycle` 用旧 `SemiIssueLineDto`，会因 DTO 重写编译失败）。用下列内容**整体替换**该文件（审核用直接翻 `半成品领料单.审核` 位模拟——union 只看该位，PostingEngine 真链路由 Task 5 集成测试覆盖）：

```csharp
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Warehouse.Semi;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class SemiIssueServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private SemiReceiptService ReceiptSvc() => new(Factory(), new DocumentNumberGenerator());
    private SemiIssueService Svc() => new(Factory(), new DocumentNumberGenerator());
    private async Task<decimal> Inv() =>
        (await new InventorySummaryService(Factory()).SemiFinishedAsync(P5cTestData.仓库))
            .Where(x => x.物料编号 == P5cTestData.物料编号).Sum(x => x.库存);

    [SkippableFact]
    public async Task Approve_reduces_semi_inventory_by_issued_quantity_then_unapprove_restores()
    {
        using var c = fx.Open();
        P5cTestData.Seed(c);
        string? 入仓单号 = null;
        string? 出库单号 = null;
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

            // 自由选产品出库 30
            出库单号 = await Svc().CreateAsync(new SemiIssueCreateDto
            {
                仓库 = P5cTestData.仓库, 部门 = "车间一", 领料人 = "张三",
                明细 = [ new SemiIssueLineInput { 配件编号 = P5cTestData.物料编号, 数量 = 30 } ]
            }, "tester");

            // 审核（翻单头审核位，union 减库存）
            c.Execute("UPDATE [半成品领料单] SET [审核]='1' WHERE [单号]=@n", new { n = 出库单号 });
            Assert.Equal(70m, await Inv());

            // 反审核恢复
            c.Execute("UPDATE [半成品领料单] SET [审核]='0' WHERE [单号]=@n", new { n = 出库单号 });
            Assert.Equal(100m, await Inv());
        }
        finally
        {
            if (出库单号 != null)
            {
                c.Execute("DELETE FROM [半成品领料明细单] WHERE [单号]=@n", new { n = 出库单号 });
                c.Execute("DELETE FROM [半成品领料单] WHERE [单号]=@n", new { n = 出库单号 });
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

- [ ] **Step 2: 停后端进程，跑测试确认失败**

先停在跑的后端进程，再：
```powershell
dotnet test tests/ErpApi.Tests --filter Approve_reduces_semi_inventory_by_issued_quantity_then_unapprove_restores
```
Expected: FAIL（编译失败于新 DTO 字段 `SemiIssueLineInput`，或 `CreateAsync` 仍是旧签名）。

- [ ] **Step 3: 重写 `SemiIssueService.cs` 整个文件**

用下列内容整体替换 `src/ErpApi/Features/Warehouse/Semi/SemiIssueService.cs`：

```csharp
using System.Data;
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Warehouse.Semi;

// 半成品出库单（自由选产品版，库存 −）。两层：半成品领料单 + 半成品领料明细单。审核位仅在单头（走 PostingEngine）。
public sealed class SemiIssueService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "半成品领料单";
    public const string Prefix = "BL";
    private const string DefaultWarehouse = "半成品仓";

    public async Task<string> CreateAsync(SemiIssueCreateDto dto, string user)
    {
        using var c = factory.Create(); await c.OpenAsync(); using var tx = c.BeginTransaction();
        var date = dto.日期?.Date ?? DateTime.Today;
        var no = await docNo.NextAsync(DocType, Prefix, date, c, tx);
        await SaveCoreAsync(c, tx, no, dto, user, false);
        tx.Commit(); return no;
    }

    public async Task<bool> UpdateAsync(string no, SemiIssueCreateDto dto, string user)
    {
        using var c = factory.Create(); await c.OpenAsync(); using var tx = c.BeginTransaction();
        var audit = await c.ExecuteScalarAsync<string?>("SELECT [审核] FROM [半成品领料单] WITH (UPDLOCK,HOLDLOCK) WHERE [单号]=@no", new { no }, tx);
        if (audit is null) return false;
        if (audit == "1") throw new InvalidOperationException("已审核的半成品出库单不能修改，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [半成品领料明细单] WHERE [单号]=@no", new { no }, tx);
        await SaveCoreAsync(c, tx, no, dto, user, true); tx.Commit(); return true;
    }

    private static async Task SaveCoreAsync(IDbConnection c, IDbTransaction tx, string no, SemiIssueCreateDto dto, string user, bool update)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("至少选择一行出库产品。");
        if (dto.明细.Any(x => string.IsNullOrWhiteSpace(x.配件编号))) throw new ArgumentException("配件编号必填。");
        if (dto.明细.Any(x => x.数量 <= 0)) throw new ArgumentException("出库数量必须大于 0。");
        if (dto.明细.GroupBy(x => x.配件编号!.Trim(), StringComparer.OrdinalIgnoreCase).Any(g => g.Count() > 1))
            throw new ArgumentException("同一单据内配件编号不能重复。");

        var warehouse = string.IsNullOrWhiteSpace(dto.仓库) ? DefaultWarehouse : dto.仓库.Trim();
        var date = dto.日期?.Date ?? DateTime.Today;

        // 按 物料编号 + 仓库 从最近已审核入仓明细派生权威 颜色/规格/单位/单价/生产单号（保证库存 union 净额正确）
        var lines = new List<(SemiIssueLineInput In, ReceiptFacts F)>();
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
            await c.ExecuteAsync(@"UPDATE [半成品领料单] SET [日期]=@date,[仓库]=@wh,[部门]=@部门,[领料人]=@领料人,[拉长]=@拉长,[收件人]=@收件人,[领料备注]=@领料备注,[件数]=@件数,[卡板数]=@卡板数,[制单人]=@制单人,[数量]=@qty,[金额]=@amt,[操作员]=@user,[备注]=@备注 WHERE [单号]=@no",
                new { no, date, wh = warehouse, dto.部门, dto.领料人, dto.拉长, dto.收件人, dto.领料备注, dto.件数, dto.卡板数, dto.制单人, qty = totalQty, amt = totalAmt, user, dto.备注 }, tx);
        else
            await c.ExecuteAsync(@"INSERT INTO [半成品领料单]([单号],[日期],[仓库],[部门],[领料人],[拉长],[收件人],[领料备注],[件数],[卡板数],[制单人],[数量],[金额],[操作员],[审核],[备注])
VALUES(@no,@date,@wh,@部门,@领料人,@拉长,@收件人,@领料备注,@件数,@卡板数,@制单人,@qty,@amt,@user,'0',@备注)",
                new { no, date, wh = warehouse, dto.部门, dto.领料人, dto.拉长, dto.收件人, dto.领料备注, dto.件数, dto.卡板数, dto.制单人, qty = totalQty, amt = totalAmt, user, dto.备注 }, tx);

        foreach (var (input, f) in lines)
        {
            var price = f.单价 ?? 0m;
            await c.ExecuteAsync(@"INSERT INTO [半成品领料明细单]
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

    public async Task<PagedResult<SemiIssueHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1 || size > 200) size = 20;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [半成品领料单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [领料人] LIKE @kw;
SELECT [ID],[单号],[仓库],[部门],[领料人],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [半成品领料单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [领料人] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<SemiIssueHeaderDto>()).AsList();
        return new PagedResult<SemiIssueHeaderDto>(items, total);
    }

    public async Task<SemiIssueDetailDto?> GetAsync(string no, bool showPrice = true)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[仓库],[部门],[领料人],[拉长],[收件人],[领料备注],[件数],[卡板数],[制单人],[日期],[审核日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [半成品领料单] WHERE [单号]=@no;
SELECT d.[ID],d.[客户],d.[生产单号],d.[货号] AS [产品货号],d.[名称] AS [产品名称],
 d.[物料编号] AS [配件编号],d.[物料名称] AS [产品装配名称],d.[规格],d.[颜色],d.[单位],d.[数量],d.[单价],d.[金额],d.[备注]
FROM [半成品领料明细单] d WHERE d.[单号]=@no ORDER BY d.[ID];", new { no });
        var header = await multi.ReadFirstOrDefaultAsync<SemiIssueHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<SemiIssueLineRowDto>()).AsList();
        if (!showPrice) { header.金额 = null; foreach (var l in lines) { l.单价 = null; l.金额 = null; } }
        return new SemiIssueDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string no)
    {
        using var c = factory.Create(); await c.OpenAsync(); using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [半成品领料单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@no", new { no }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的半成品出库单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [半成品领料明细单] WHERE [单号]=@no", new { no }, tx);
        await c.ExecuteAsync("DELETE FROM [半成品领料单] WHERE [单号]=@no", new { no }, tx);
        tx.Commit(); return true;
    }

    public async Task<PagedResult<SemiIssueProductRow>> ProductsAsync(SemiIssueProductQuery query, bool canSeePrice)
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
        var items = (await multi.ReadAsync<SemiIssueProductRow>()).AsList();
        if (!canSeePrice) foreach (var it in items) { it.加工单价 = null; it.库存单价 = null; }
        return new(items, total);
    }

    public async Task<SemiIssueDetailDto?> GetAdjacentAsync(string no, bool next, bool showPrice)
    {
        using var c = factory.Create(); await c.OpenAsync();
        var cur = await c.QuerySingleOrDefaultAsync<AdjacentAnchor>(
            "SELECT [ID],[日期] FROM [半成品领料单] WHERE [单号]=@no", new { no });
        if (cur is null) return null;
        var adj = await c.ExecuteScalarAsync<string?>(next
            ? "SELECT TOP (1) [单号] FROM [半成品领料单] WHERE [日期]>@d OR ([日期]=@d AND [ID]>@id) ORDER BY [日期],[ID];"
            : "SELECT TOP (1) [单号] FROM [半成品领料单] WHERE [日期]<@d OR ([日期]=@d AND [ID]<@id) ORDER BY [日期] DESC,[ID] DESC;",
            new { d = cur.日期, id = cur.ID });
        return adj is null ? null : await GetAsync(adj, showPrice);
    }

    private sealed class AdjacentAnchor { public long ID { get; set; } public DateTime 日期 { get; set; } }
}
```

- [ ] **Step 4: 停后端进程后编译并跑测试**

```powershell
dotnet build src/ErpApi
dotnet test tests/ErpApi.Tests --filter Approve_reduces_semi_inventory_by_issued_quantity_then_unapprove_restores
```
Expected: 编译通过，测试 PASS（100→70→100）。

- [ ] **Step 5: Commit**

```bash
git add src/ErpApi/Features/Warehouse/Semi/SemiIssueService.cs tests/ErpApi.Tests/SemiIssueServiceDbTests.cs
git commit -m "feat: semi issue free-select save + products + adjacent + inventory test"
```

---

## Task 4: 后端 Controller（加 update/products/adjacent，Get 传 showPrice）

**Files:**
- Modify: `src/ErpApi/Features/Warehouse/Semi/SemiIssueController.cs`

- [ ] **Step 1: 改写 `Get`、`Create` 之间插入 `Update`/`Products`/`Adjacent`**

把 `Get` 方法（第 38-47 行）替换为传 showPrice 版：

```csharp
    [HttpGet("{单号}")]
    public async Task<IActionResult> Get(string 单号)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var d = await svc.GetAsync(单号, await AllowAsync(PermissionAction.单价));
        if (d is null) return NotFound();
        return Ok(d);
    }

    [HttpGet("products")]
    public async Task<IActionResult> Products([FromQuery] SemiIssueProductQuery query)
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
```

> 注意：`products` 与 `adjacent` 路由须放在 `[HttpGet("{单号}")]` **之后**不影响匹配（ASP.NET 属性路由字面量段 `products` 优先于 `{单号}`；`{单号}/adjacent` 段数不同）。保持上面顺序即可。

- [ ] **Step 2: 在 `Create` 之后加 `Update`（PUT）**

在 `Create` 方法之后插入：

```csharp
    [HttpPut("{单号}")]
    public async Task<IActionResult> Update(string 单号, [FromBody] SemiIssueCreateDto dto)
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
```

- [ ] **Step 3: `Create` 里月结锁仓库默认值对齐**

把 `Create` 中 `await periodLock.EnsureWarehouseOpenAsync(口径, dto.仓库, DateTime.Now);`
改为 `await periodLock.EnsureWarehouseOpenAsync(口径, string.IsNullOrWhiteSpace(dto.仓库) ? "半成品仓" : dto.仓库, DateTime.Now);`。

- [ ] **Step 4: 停后端进程后编译**

```powershell
dotnet build src/ErpApi
```
Expected: 通过（无对旧 `SemiIssueLineDto` 的残留引用）。

- [ ] **Step 5: Commit**

```bash
git add src/ErpApi/Features/Warehouse/Semi/SemiIssueController.cs
git commit -m "feat: semi issue controller update + products + adjacent endpoints"
```

---

## Task 5: 更新 P5c 集成测试到自由选 shape

**Files:**
- Modify: `tests/ErpApi.Tests/P5cApiIntegrationTests.cs`

- [ ] **Step 1: 替换两处 `/api/semi-issues` 建单 body**

两处 `client.PostAsJsonAsync("/api/semi-issues", new { ... })`（约在原第 141-143 行与第 179-181 行）的对象整体替换为自由选 shape：

```csharp
            var ci = await client.PostAsJsonAsync("/api/semi-issues", new {
                仓库 = P5cTestData.仓库, 部门 = "车间一", 领料人 = "张三",
                明细 = new[] { new { 配件编号 = P5cTestData.物料编号, 数量 = 30 } } });
```

（第二处同样替换；保留其后 `ll = ...`、`approve`、`Assert.Equal(70m, ...)` 等原逻辑不动。）

> 说明：入仓单已在两测试中先审核，自由选保存时 ReceiptFacts 能派生到 颜色（P5c 入仓两色，取最近 白色）。union 按 物料编号+颜色 分组但**求和**、盘点盈亏用客户端 `系统数量`，故三处总额断言（70/70/68）不变。

- [ ] **Step 2: 停后端进程后跑这两条集成测试**

```powershell
dotnet test tests/ErpApi.Tests --filter FullyQualifiedName~P5cApiIntegrationTests
```
Expected: 相关用例 PASS（若因预存 schema 漂移 skip 则视为 skip，不算失败）。

- [ ] **Step 3: Commit**

```bash
git add tests/ErpApi.Tests/P5cApiIntegrationTests.cs
git commit -m "test: update P5c integration semi-issue calls to free-select shape"
```

---

## Task 6: 前端 api 类型与 utils

**Files:**
- Modify: `web/src/api/semi.ts`
- Create: `web/src/utils/semiIssue.ts`
- Create: `web/src/__tests__/semiIssue.test.ts`

- [ ] **Step 1: 重写 `semi.ts` 中 `// ---- 领料 ----` 类型段 + `semiIssueApi`**

把 `SILine`/`SICreate`/`SIHeader`（第 12-14 行）替换为自由选版，并新增行类型：

```ts
export interface SIProductRow { 配件编号: string; 客户?: string | null; 产品货号?: string | null; 产品名称?: string | null; 产品装配名称?: string | null; 生产单号?: string | null; 加工单价?: number | null; 库存单价?: number | null }
export interface SILineInput { 配件编号: string; 客户?: string | null; 产品货号?: string | null; 产品名称?: string | null; 产品装配名称?: string | null; 生产单号?: string | null; 数量: number; 备注?: string | null }
export interface SILineRow { ID?: number; 配件编号?: string | null; 客户?: string | null; 产品货号?: string | null; 产品名称?: string | null; 产品装配名称?: string | null; 生产单号?: string | null; 规格?: string | null; 颜色?: string | null; 单位?: string | null; 数量?: number | null; 单价?: number | null; 金额?: number | null; 备注?: string | null }
export interface SICreate { 日期?: string; 仓库: string; 部门?: string | null; 领料人?: string | null; 拉长?: string | null; 收件人?: string | null; 领料备注?: string | null; 件数?: number | null; 卡板数?: number | null; 制单人?: string | null; 备注?: string | null; 明细: SILineInput[] }
export interface SIHeader { ID?: number; id?: number; 单号?: string; 仓库?: string; 部门?: string | null; 领料人?: string | null; 拉长?: string | null; 收件人?: string | null; 领料备注?: string | null; 件数?: number | null; 卡板数?: number | null; 制单人?: string | null; 日期?: string; 审核日期?: string | null; 数量?: number | null; 金额?: number | null; 操作员?: string | null; 审核?: string; 审核人?: string | null; 备注?: string | null }
export interface SIDetail { 单头: SIHeader | null; 明细: SILineRow[] }
```

把 `semiIssueApi`（第 44-50 行）替换为：

```ts
export const semiIssueApi = {
  list: (page = 1, size = 20, keyword = "") => api.get<Paged<SIHeader>>("/semi-issues", { params: { page, size, keyword } }).then(r => r.data),
  get: (单号: string) => api.get<SIDetail>(`/semi-issues/${enc(单号)}`).then(r => r.data),
  create: (body: SICreate) => api.post<{ 单号: string }>("/semi-issues", body).then(r => r.data),
  update: (单号: string, body: SICreate) => api.put<SIDetail>(`/semi-issues/${enc(单号)}`, body).then(r => r.data),
  remove: (单号: string) => api.delete(`/semi-issues/${enc(单号)}`),
  approve: (单号: string) => api.post(`/semi-issues/${enc(单号)}/approve`),
  unapprove: (单号: string) => api.post(`/semi-issues/${enc(单号)}/unapprove`),
  products: (params: { page?: number; size?: number; field?: string; keyword?: string; exact?: boolean } = {}) =>
    api.get<Paged<SIProductRow>>("/semi-issues/products", { params }).then(r => r.data),
  adjacent: (单号: string, next: boolean) =>
    api.get<SIDetail | undefined>(`/semi-issues/${enc(单号)}/adjacent`, { params: { next } })
      .then(r => r.status === 204 ? undefined : r.data),
};
```

> 确认文件顶部已 `import { enc } from ...`（退仓 api 已用 `enc`，同文件即有）。若 `enc` 未在本文件定义，参照 `semiWarehouseReturnApi` 的 `enc` 来源保持一致。

- [ ] **Step 2: 先写失败的 utils 测试**

写 `web/src/__tests__/semiIssue.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { mergeSemiIssueLines, validateSemiIssue, type SIDraftLine } from "../utils/semiIssue";

const line = (p: Partial<SIDraftLine>): SIDraftLine => ({ key: 0, 配件编号: "", 数量: 0, ...p });

describe("mergeSemiIssueLines", () => {
  it("按配件编号去重，保留已存在数量，追加新产品", () => {
    const existing = [line({ key: 1, 配件编号: "A", 数量: 5 })];
    const picked = [{ 配件编号: "A" }, { 配件编号: "B" }];
    const merged = mergeSemiIssueLines(existing, picked);
    expect(merged.map(l => l.配件编号)).toEqual(["A", "B"]);
    expect(merged.find(l => l.配件编号 === "A")!.数量).toBe(5);
  });
});

describe("validateSemiIssue", () => {
  it("至少一行有效明细", () => {
    expect(validateSemiIssue({ 明细: [] })).toBe("请至少录入一行出库产品。");
  });
  it("数量必须大于0", () => {
    expect(validateSemiIssue({ 明细: [line({ 配件编号: "A", 数量: 0 })] })).toBe("出库数量必须大于 0。");
  });
  it("配件编号不重复", () => {
    expect(validateSemiIssue({ 明细: [line({ 配件编号: "A", 数量: 1 }), line({ 配件编号: "A", 数量: 2 })] })).toBe("配件编号 A 在同一单据中重复。");
  });
  it("通过返回 null", () => {
    expect(validateSemiIssue({ 明细: [line({ 配件编号: "A", 数量: 1 })] })).toBeNull();
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```powershell
cd web; npx vitest run src/__tests__/semiIssue.test.ts
```
Expected: FAIL（`../utils/semiIssue` 不存在）。

- [ ] **Step 4: 写 `utils/semiIssue.ts`**

```ts
export interface SIDraftLine {
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

export function mergeSemiIssueLines(existing: SIDraftLine[], picked: PickedProduct[]): SIDraftLine[] {
  const seen = new Map(existing.map(l => [l.配件编号.trim(), l]));
  let key = existing.reduce((m, l) => Math.max(m, l.key), 0);
  for (const p of picked) {
    const code = p.配件编号?.trim();
    if (!code || seen.has(code)) continue;
    const row: SIDraftLine = {
      key: ++key, 配件编号: code, 客户: p.客户 ?? null, 产品货号: p.产品货号 ?? null,
      产品名称: p.产品名称 ?? null, 产品装配名称: p.产品装配名称 ?? null,
      生产单号: p.生产单号 ?? null, 数量: 0, 备注: "",
    };
    seen.set(code, row);
  }
  return [...seen.values()];
}

export function validateSemiIssue(input: { 明细: SIDraftLine[] }): string | null {
  const valid = input.明细.filter(l => l.配件编号.trim());
  if (valid.length === 0) return "请至少录入一行出库产品。";
  for (const l of valid) if (Number(l.数量) <= 0) return "出库数量必须大于 0。";
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
cd web; npx vitest run src/__tests__/semiIssue.test.ts
```
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add web/src/api/semi.ts web/src/utils/semiIssue.ts web/src/__tests__/semiIssue.test.ts
git commit -m "feat: semi issue frontend api + free-select utils"
```

---

## Task 7: 前端页面重写（全屏主从 + 右侧库存参考）

**Files:**
- Modify: `web/src/pages/warehouse/SemiIssuePage.tsx`
- Delete: `web/src/pages/warehouse/SemiIssueCreateDrawer.tsx`

- [ ] **Step 1: 删除旧抽屉**

```bash
git rm web/src/pages/warehouse/SemiIssueCreateDrawer.tsx
```

- [ ] **Step 2: 用下列组件整体替换 `SemiIssuePage.tsx`**

要点：工具栏含 新建/打开/保存/删除/**装配采购清单(禁用占位)**/刷新/资料/前单/后单/审核/反审核/表格设置(禁用)/打印/关闭；领料式头（部门/日期/审核日期只读/领料人🔍/拉长🔍/收件人🔍/领料备注下拉/电脑单号只读/备注/操作员只读/件数/卡板数/制单人🔍）；明细列 删除/装配采购(空占位)/配件编号/客户/产品货号/产品名称/产品装配名称/生产单号/数量(录入)/备注；右侧库存参考网格（序号/配件编号/产品装配名称/发料数量/库存数量）；底部仅数量合计。仓库固定 `半成品仓`。资料复用 `SemiFinishedLabelProductPicker`（`permissionMenu="半成品领料"`），人员用 `EmployeePicker`。

```tsx
import { useEffect, useMemo, useState } from "react";
import { Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Statistic, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CheckOutlined, CloseOutlined, CopyOutlined, DeleteOutlined, FileAddOutlined, FolderOpenOutlined, LeftOutlined, PrinterOutlined, ProfileOutlined, ReloadOutlined, RightOutlined, SaveOutlined, SearchOutlined, ShoppingOutlined, TableOutlined, UndoOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useNavigate } from "react-router-dom";
import { semiIssueApi, semiInventoryApi, type SIDetail, type SIHeader, type SemiStockRow } from "../../api/semi";
import { can } from "../../auth/permissions";
import { usePerms } from "../../auth/PermissionContext";
import { mergeSemiIssueLines, validateSemiIssue, type SIDraftLine } from "../../utils/semiIssue";
import SemiFinishedLabelProductPicker, { type SemiFinishedLabelProduct } from "../semi/SemiFinishedLabelProductPicker";
import EmployeePicker from "../materials/EmployeePicker";

const MENU = "半成品领料";
const WAREHOUSE = "半成品仓";
const 领料备注选项 = ["生产领料", "补料", "返工领料"];
const user = () => localStorage.getItem("erp_user") || "admin";
const err = (e: unknown, f: string) => (e as { response?: { data?: { 消息?: string } } }).response?.data?.消息 ?? f;
type HeaderForm = { 单号?: string; 部门?: string; 领料人?: string; 拉长?: string; 收件人?: string; 领料备注?: string; 件数?: number | null; 卡板数?: number | null; 制单人?: string; 日期?: Dayjs; 备注?: string; 操作员?: string };

export default function SemiIssuePage() {
  const [form] = Form.useForm<HeaderForm>(); const perms = usePerms(); const navigate = useNavigate();
  const canOpen = can(perms, MENU, "打开"), canSave = can(perms, MENU, "保存"), canDelete = can(perms, MENU, "删除"), canAudit = can(perms, MENU, "审核"), canReverse = can(perms, MENU, "反审核"), canPrint = can(perms, MENU, "打印");
  const [opened, setOpened] = useState<SIDetail | null>(null); const [lines, setLines] = useState<SIDraftLine[]>([]); const [busy, setBusy] = useState(false);
  const [productOpen, setProductOpen] = useState(false); const [openOpen, setOpenOpen] = useState(false);
  const [empField, setEmpField] = useState<"领料人" | "拉长" | "收件人" | "制单人" | null>(null);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const audited = opened?.单头?.审核 === "1"; const readOnly = audited || !canSave || busy;

  useEffect(() => { void (async () => {
    try { const rows = await semiInventoryApi.list(WAREHOUSE); const m: Record<string, number> = {}; for (const r of rows) m[(r.物料编号 ?? "").trim()] = (m[(r.物料编号 ?? "").trim()] ?? 0) + Number(r.库存 ?? 0); setStockMap(m); } catch { /* 库存参考失败不阻塞 */ }
  })(); }, [opened]);

  const reset = () => { form.setFieldsValue({ 单号: "", 部门: "", 领料人: "", 拉长: "", 收件人: "", 领料备注: 领料备注选项[0], 件数: null, 卡板数: null, 制单人: user(), 日期: dayjs(), 备注: "", 操作员: user() }); setOpened(null); setLines([]); };
  const apply = (d: SIDetail) => {
    const h = d.单头 ?? {} as SIHeader;
    form.setFieldsValue({ 单号: h.单号, 部门: h.部门 ?? "", 领料人: h.领料人 ?? "", 拉长: h.拉长 ?? "", 收件人: h.收件人 ?? "", 领料备注: h.领料备注 ?? 领料备注选项[0], 件数: h.件数 ?? null, 卡板数: h.卡板数 ?? null, 制单人: h.制单人 ?? user(), 日期: h.日期 ? dayjs(h.日期) : dayjs(), 备注: h.备注 ?? "", 操作员: h.操作员 ?? user() });
    setLines((d.明细 ?? []).map((x, i) => ({ key: i + 1, 配件编号: x.配件编号 ?? "", 客户: x.客户, 产品货号: x.产品货号, 产品名称: x.产品名称, 产品装配名称: x.产品装配名称, 生产单号: x.生产单号, 数量: Number(x.数量 ?? 0), 备注: x.备注 ?? "" })));
    setOpened(d);
  };
  const openDoc = async (no: string) => { setBusy(true); try { apply(await semiIssueApi.get(no)); } catch (e) { message.error(err(e, "打开出库单失败")); } finally { setBusy(false); } };
  const pickProducts = (rows: SemiFinishedLabelProduct[]) => setLines(cur => mergeSemiIssueLines(cur, rows.map(p => ({ 配件编号: p.配件编号, 客户: p.客户, 产品货号: p.产品货号, 产品名称: p.产品名称, 产品装配名称: p.产品装配名称, 生产单号: (p as { 生产单号?: string | null }).生产单号 }))));
  const updateLine = (key: number, patch: Partial<SIDraftLine>) => setLines(v => v.map(x => x.key === key ? { ...x, ...patch } : x));

  const buildPayload = () => {
    const h = form.getFieldsValue();
    const issue = validateSemiIssue({ 明细: lines });
    if (issue) { message.error(issue); return null; }
    return { 日期: (h.日期 ?? dayjs()).format("YYYY-MM-DD"), 仓库: WAREHOUSE, 部门: h.部门, 领料人: h.领料人, 拉长: h.拉长, 收件人: h.收件人, 领料备注: h.领料备注, 件数: h.件数 ?? null, 卡板数: h.卡板数 ?? null, 制单人: h.制单人, 备注: h.备注?.trim(),
      明细: lines.filter(x => x.配件编号.trim() && Number(x.数量) > 0).map(x => ({ 配件编号: x.配件编号, 客户: x.客户, 产品货号: x.产品货号, 产品名称: x.产品名称, 产品装配名称: x.产品装配名称, 生产单号: x.生产单号, 数量: Number(x.数量), 备注: x.备注 })) };
  };
  const save = async () => { const body = buildPayload(); if (!body || readOnly) return; setBusy(true); try { const no = opened?.单头 ? (await semiIssueApi.update(opened.单头.单号!, body), opened.单头.单号!) : (await semiIssueApi.create(body)).单号; apply(await semiIssueApi.get(no)); message.success("半成品出库单已保存"); } catch (e) { message.error(err(e, "保存失败")); } finally { setBusy(false); } };
  const audit = async (reverse: boolean) => { if (!opened?.单头?.单号) return; setBusy(true); try { reverse ? await semiIssueApi.unapprove(opened.单头.单号) : await semiIssueApi.approve(opened.单头.单号); apply(await semiIssueApi.get(opened.单头.单号)); message.success(reverse ? "已反审核" : "已审核"); } catch (e) { message.error(err(e, reverse ? "反审核失败" : "审核失败")); } finally { setBusy(false); } };
  const remove = async () => { if (!opened?.单头?.单号) return; setBusy(true); try { await semiIssueApi.remove(opened.单头.单号); reset(); message.success("已删除"); } catch (e) { message.error(err(e, "删除失败")); } finally { setBusy(false); } };
  const move = async (next: boolean) => { if (!opened?.单头?.单号) return; setBusy(true); try { const d = await semiIssueApi.adjacent(opened.单头.单号, next); if (!d) message.info(next ? "已经是最后一张单据" : "已经是第一张单据"); else apply(d); } catch (e) { message.error(err(e, "切换单据失败")); } finally { setBusy(false); } };
  const copy = () => { if (!opened) return; setOpened(null); form.setFieldsValue({ 单号: "", 日期: dayjs(), 操作员: user() }); message.success("已复制为未保存新单"); };

  const totalQty = useMemo(() => lines.reduce((a, x) => a + Number(x.数量 || 0), 0), [lines]);
  const stockRows = useMemo(() => lines.map((l, i) => ({ key: l.key, 序号: i + 1, 配件编号: l.配件编号, 产品装配名称: l.产品装配名称 ?? "", 发料数量: Number(l.数量 || 0), 库存数量: stockMap[l.配件编号.trim()] ?? 0 })), [lines, stockMap]);

  const cols: ColumnsType<SIDraftLine> = [
    { title: "删除", width: 58, fixed: "left", render: (_, x) => <Button type="text" danger icon={<DeleteOutlined />} disabled={readOnly} onClick={() => setLines(v => v.filter(y => y.key !== x.key))} /> },
    { title: "装配采购", width: 90, render: () => "" },
    { title: "配件编号", dataIndex: "配件编号", width: 130 }, { title: "客户", dataIndex: "客户", width: 110 }, { title: "产品货号", dataIndex: "产品货号", width: 140 }, { title: "产品名称", dataIndex: "产品名称", width: 170 }, { title: "产品装配名称", dataIndex: "产品装配名称", width: 190 }, { title: "生产单号", dataIndex: "生产单号", width: 140 },
    { title: "数量", dataIndex: "数量", width: 120, align: "right", render: (_, x) => <InputNumber min={0} value={x.数量} disabled={readOnly} onChange={v => updateLine(x.key, { 数量: Number(v ?? 0) })} style={{ width: "100%" }} /> },
    { title: "备注", dataIndex: "备注", width: 160, render: (_, x) => <Input value={x.备注 ?? ""} disabled={readOnly} onChange={e => updateLine(x.key, { 备注: e.target.value })} /> },
  ];
  const stockCols: ColumnsType<(typeof stockRows)[number]> = [
    { title: "序号", dataIndex: "序号", width: 56 }, { title: "配件编号", dataIndex: "配件编号", width: 120 }, { title: "产品装配名称", dataIndex: "产品装配名称", width: 160 },
    { title: "发料数量", dataIndex: "发料数量", width: 90, align: "right" }, { title: "库存数量", dataIndex: "库存数量", width: 90, align: "right" },
  ];

  if (!canOpen) return <Card variant="borderless"><div style={{ padding: 24, color: "#8c8c8c" }}>无权访问该页面</div></Card>;
  const pick = (name: string) => { setEmpField(name as typeof empField); };
  return <Card title="半成品出库单" variant="borderless" extra={<Space wrap>
    <Button icon={<FileAddOutlined />} disabled={busy} onClick={reset}>新建</Button>
    <Button icon={<FolderOpenOutlined />} disabled={busy} onClick={() => setOpenOpen(true)}>打开</Button>
    <Button type="primary" icon={<SaveOutlined />} disabled={readOnly} loading={busy} onClick={() => void save()}>保存</Button>
    <Popconfirm title="确认删除当前出库单？" disabled={!opened || audited || !canDelete} onConfirm={() => void remove()}><Button icon={<DeleteOutlined />} disabled={!opened || audited || !canDelete}>删除</Button></Popconfirm>
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
    <Form form={form} layout="vertical" size="small" initialValues={{ 日期: dayjs(), 操作员: user(), 制单人: user(), 领料备注: 领料备注选项[0] }}><Row gutter={12}>
      <Col xs={12} sm={8} lg={4}><Form.Item label="部门" name="部门"><Input disabled={readOnly} /></Form.Item></Col>
      <Col xs={12} sm={8} lg={3}><Form.Item label="日期" name="日期"><DatePicker disabled={readOnly} style={{ width: "100%" }} /></Form.Item></Col>
      <Col xs={12} sm={8} lg={4}><Form.Item label="审核日期"><Input readOnly value={opened?.单头?.审核日期 ? String(opened.单头.审核日期).slice(0, 10) : ""} /></Form.Item></Col>
      <Col xs={12} sm={8} lg={4}><Form.Item label="领料人" required><Space.Compact style={{ width: "100%" }}><Form.Item name="领料人" noStyle><Input readOnly /></Form.Item><Button icon={<SearchOutlined />} disabled={readOnly} onClick={() => pick("领料人")} /></Space.Compact></Form.Item></Col>
      <Col xs={12} sm={8} lg={4}><Form.Item label="拉长"><Space.Compact style={{ width: "100%" }}><Form.Item name="拉长" noStyle><Input readOnly /></Form.Item><Button icon={<SearchOutlined />} disabled={readOnly} onClick={() => pick("拉长")} /></Space.Compact></Form.Item></Col>
      <Col xs={12} sm={8} lg={5}><Form.Item label="电脑单号" name="单号"><Input readOnly placeholder="保存后生成" /></Form.Item></Col>
      <Col xs={12} sm={8} lg={4}><Form.Item label="收件人"><Space.Compact style={{ width: "100%" }}><Form.Item name="收件人" noStyle><Input readOnly /></Form.Item><Button icon={<SearchOutlined />} disabled={readOnly} onClick={() => pick("收件人")} /></Space.Compact></Form.Item></Col>
      <Col xs={12} sm={8} lg={4}><Form.Item label="领料备注" name="领料备注"><Select disabled={readOnly} options={领料备注选项.map(v => ({ value: v, label: v }))} /></Form.Item></Col>
      <Col xs={12} sm={8} lg={3}><Form.Item label="件数" name="件数"><InputNumber min={0} disabled={readOnly} style={{ width: "100%" }} /></Form.Item></Col>
      <Col xs={12} sm={8} lg={3}><Form.Item label="卡板数" name="卡板数"><InputNumber min={0} disabled={readOnly} style={{ width: "100%" }} /></Form.Item></Col>
      <Col xs={12} sm={8} lg={4}><Form.Item label="制单人"><Space.Compact style={{ width: "100%" }}><Form.Item name="制单人" noStyle><Input readOnly /></Form.Item><Button icon={<SearchOutlined />} disabled={readOnly} onClick={() => pick("制单人")} /></Space.Compact></Form.Item></Col>
      <Col xs={24} sm={16} lg={6}><Form.Item label="备注" name="备注"><Input disabled={readOnly} /></Form.Item></Col>
      <Col xs={12} sm={8} lg={3}><Form.Item label="操作员" name="操作员"><Input readOnly /></Form.Item></Col>
      <Col xs={12} sm={8} lg={3}><Form.Item label="审核状态"><Tag color={audited ? "success" : "default"}>{audited ? "已审核" : "未审核"}</Tag></Form.Item></Col>
    </Row></Form>
    <Row gutter={12}>
      <Col span={17}>
        <Table<SIDraftLine> rowKey="key" size="small" columns={cols} dataSource={lines} pagination={false} scroll={{ x: 1300, y: "calc(100vh - 470px)" }} />
        <Space size={48} style={{ marginTop: 14 }}><Statistic title="数量合计" value={totalQty} /></Space>
      </Col>
      <Col span={7}>
        <Table rowKey="key" size="small" columns={stockCols} dataSource={stockRows} pagination={false} scroll={{ y: "calc(100vh - 420px)" }} title={() => "库存参考"} />
      </Col>
    </Row>
    <SemiFinishedLabelProductPicker open={productOpen} permissionMenu={MENU} loadProducts={semiIssueApi.products} onPick={rows => { setProductOpen(false); pickProducts(rows); }} onClose={() => setProductOpen(false)} />
    <EmployeePicker open={empField !== null} onPick={(name: string) => { if (empField) form.setFieldsValue({ [empField]: name }); setEmpField(null); }} onClose={() => setEmpField(null)} />
    <Modal title="打开半成品出库单" open={openOpen} onCancel={() => setOpenOpen(false)} footer={null} width={900} destroyOnClose>
      <OpenList onPick={no => { setOpenOpen(false); void openDoc(no); }} />
    </Modal>
  </Card>;
}

function OpenList({ onPick }: { onPick: (no: string) => void }) {
  const [keyword, setKeyword] = useState(""); const [rows, setRows] = useState<SIHeader[]>([]); const [loading, setLoading] = useState(false);
  const load = async () => { setLoading(true); try { setRows((await semiIssueApi.list(1, 100, keyword.trim())).items as SIHeader[]); } catch { message.error("加载出库单失败"); } finally { setLoading(false); } };
  return <>
    <Input.Search allowClear value={keyword} onChange={e => setKeyword(e.target.value)} onSearch={() => void load()} onFocus={() => rows.length === 0 && void load()} placeholder="电脑单号 / 仓库 / 领料人" style={{ width: 320, marginBottom: 12 }} />
    <Table<SIHeader> rowKey={r => r.单号 ?? String(r.ID ?? r.id)} size="small" loading={loading} dataSource={rows} pagination={false} scroll={{ y: 440 }}
      onRow={r => ({ onDoubleClick: () => r.单号 && onPick(r.单号), style: { cursor: "pointer" } })}
      columns={[{ title: "电脑单号", dataIndex: "单号", width: 150 }, { title: "日期", dataIndex: "日期", width: 110, render: v => v?.slice(0, 10) }, { title: "部门", dataIndex: "部门", width: 120 }, { title: "领料人", dataIndex: "领料人", width: 100 }, { title: "数量", dataIndex: "数量", width: 90, align: "right" }, { title: "状态", dataIndex: "审核", width: 90, render: v => <Tag color={v === "1" ? "success" : "default"}>{v === "1" ? "已审核" : "未审核"}</Tag> }]} />
  </>;
}
```

> 实施注意：
> 1. 确认 `EmployeePicker` 的实际 `onPick` 签名（读 `web/src/pages/materials/EmployeePicker.tsx`）——若回调是 `(emp) => emp.姓名` 或 `(name)`，把上面 `onPick` 解构对齐；若组件 props 名不是 `open/onPick/onClose`，对齐之。
> 2. 确认 `semiInventoryApi` 与 `SemiStockRow` 已从 `../../api/semi` 导出（`SemiStockRow` 若未 export，则在 semi.ts 里 `export` 它，或在本页用内联类型 `{ 物料编号?: string; 库存?: number }`）。
> 3. `SemiFinishedLabelProductPicker` 已支持 `loadProducts` prop（退仓同款用法）。

- [ ] **Step 3: 前端类型检查 + 测试**

```powershell
cd web; npx tsc -b; npx vitest run src/__tests__/semiIssue.test.ts
```
Expected: 无类型错误，测试 PASS。

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/warehouse/SemiIssuePage.tsx
git rm web/src/pages/warehouse/SemiIssueCreateDrawer.tsx
git commit -m "feat: rewrite semi issue page to free-select layout"
```

---

## Task 8: 端到端冒烟验证

**Files:** 无（验证任务）

- [ ] **Step 1: 全量测试回归（先停后端进程）**

```powershell
dotnet test tests/ErpApi.Tests
cd web; npx vitest run; npx tsc -b
```
Expected：本功能测试全绿；后端仅剩预存的 `工模编号`/`装配物料报价` schema 漂移失败（与本功能无关）。

- [ ] **Step 2: 启动后端 + 前端**

```powershell
dotnet run --project src/ErpApi   # 端口 5000
cd web; npm run dev               # 端口 5173
```

- [ ] **Step 3: HTTP 冒烟全生命周期**

登录 admin/admin123，用已审核入仓单的物料（如 `SM1`）走：
1. `POST /api/semi-issues`（body `{仓库:"半成品仓",部门:"车间一",领料人:"张三",明细:[{配件编号:"SM1",数量:30}]}`）→ 得 `BL...` 单号。
2. 审核前查 `/api/semi-inventory?仓库=半成品仓` SM1 库存不变；`POST {单号}/approve` → 库存 −30；`{单号}/unapprove` → 恢复。
3. `GET {单号}` 明细别名正确（配件编号/产品装配名称/规格/颜色从入仓派生）；`GET {单号}/adjacent?next=true/false` 前后单；已审删拒 409、未审删 204。

（Chinese JSON 用 `--data-binary @文件`；命名管道见记忆。）

- [ ] **Step 4: 手动对照截图**

半成品仓库 > 半成品出库单：领料式头 + 资料自由选品 + 右侧库存参考 + 底部仅数量合计，布局与截图一致。

- [ ] **Step 5: Commit（若冒烟中有微调，逐文件 add）**

```bash
git add <本功能改动文件>
git commit -m "test: verify semi issue free-select end-to-end"
```

---

## Self-Review 覆盖检查

- 库存口径（实时 union 减库存）→ Task 3 DB 测试 + SaveCore 落 仓库/物料编号/颜色 覆盖。
- 仓库固定半成品仓 → Task 3 SaveCore 默认值 + Task 7 `WAREHOUSE` 常量覆盖。
- 自由选产品（资料）→ Task 3 ProductsAsync + Task 7 SemiFinishedLabelProductPicker 复用覆盖。
- 生产单号带出 → Task 3 products OUTER APPLY + SaveCore 派生覆盖。
- 领料式头字段持久化 → Task 1 加列 + Task 2 DTO + Task 3 SaveCore + Task 7 表单覆盖。
- 右侧库存参考 → Task 7 stockRows + semiInventoryApi 覆盖。
- 无价（不显示价格）→ Task 7 明细无价格列/底部仅数量合计；后端保留 showPrice 脱敏参覆盖。
- 审核复用 PostingEngine → Controller 不动 approve/unapprove；Task 3 DB 测试翻位模拟 + Task 5 集成测试真链路覆盖。
- 前单/后单/复制/删除 → Controller + Service + 页面覆盖。
- 现有测试影响（P5c 集成）→ Task 5 覆盖。
- 接入四处已存在 → Global Constraints 说明，无新增任务。
