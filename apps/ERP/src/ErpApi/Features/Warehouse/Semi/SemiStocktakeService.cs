using System.Data;
using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Warehouse.Semi;

// 半成品盘点（自由选产品版，算法7 盈亏）。两层：半成品盘点单 + 半成品盘点明细单(单号 主从)。审核位仅在单头。
// 明细列映射：配件编号=物料编号；产品装配名称=物料名称；产品货号=货号；产品名称=名称。库存按 配件编号 汇总（不分颜色，与桌面版一致）。
// 盈亏=盘点−系统；系统数量写库时按 BasisAsync 同口径(库存引擎按物料编号汇总)服务端复算,不信任前端传入值；审核后盈亏经 InventorySummaryService 盘点分支入库存。系统/盘点/盈亏列为 real，写入隐式转、读回 CAST decimal。
public sealed class SemiStocktakeService(
    ISqlConnectionFactory factory, IDocumentNumberGenerator docNo, IInventorySummaryService inventory)
{
    public const string DocType = "半成品盘点单";
    public const string Prefix = "BP";
    private const string DefaultWarehouse = "半成品仓";

    // 系统数量基准：按 物料编号 汇总（合并各颜色），供前端选产品时带出。
    public async Task<IReadOnlyList<SemiStocktakeBasisRow>> BasisAsync(string 仓库)
    {
        var wh = string.IsNullOrWhiteSpace(仓库) ? DefaultWarehouse : 仓库.Trim();
        var inv = await inventory.SemiFinishedAsync(wh);
        return inv
            .GroupBy(r => r.物料编号)
            .Select(g => new SemiStocktakeBasisRow
            {
                物料编号 = g.Key,
                物料名称 = g.Select(x => x.物料名称).FirstOrDefault(x => !string.IsNullOrWhiteSpace(x)),
                规格 = g.Select(x => x.规格).FirstOrDefault(x => !string.IsNullOrWhiteSpace(x)),
                颜色 = null,
                系统数量 = g.Sum(x => x.库存)
            })
            .ToList();
    }

    // 系统数量服务端复算(口径同 BasisAsync:半成品台账按 物料编号 汇总,合并各颜色),不信任前端传入值。
    // 须在事务外调用:库存引擎自开连接,若在删明细后的事务内取数,新连接会被未提交的 DELETE 锁住。
    private async Task<Dictionary<string, decimal>> 系统数量MapAsync(string warehouse)
    {
        var inv = await inventory.SemiFinishedAsync(warehouse);
        return inv.GroupBy(r => (r.物料编号 ?? "").Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Sum(x => x.库存), StringComparer.OrdinalIgnoreCase);
    }

    public async Task<string> CreateAsync(SemiStocktakeCreateDto dto, string user)
    {
        var warehouse = string.IsNullOrWhiteSpace(dto.仓库) ? DefaultWarehouse : dto.仓库.Trim();
        var 系统数量表 = await 系统数量MapAsync(warehouse);
        using var c = factory.Create(); await c.OpenAsync(); using var tx = c.BeginTransaction();
        var date = dto.日期?.Date ?? DateTime.Today;
        var 单号 = await docNo.NextAsync(DocType, Prefix, date, c, tx);
        await SaveCoreAsync(c, tx, 单号, dto, user, false, 系统数量表);
        tx.Commit();
        return 单号;
    }

    public async Task<bool> UpdateAsync(string 单号, SemiStocktakeCreateDto dto, string user)
    {
        var warehouse = string.IsNullOrWhiteSpace(dto.仓库) ? DefaultWarehouse : dto.仓库.Trim();
        var 系统数量表 = await 系统数量MapAsync(warehouse);
        using var c = factory.Create(); await c.OpenAsync(); using var tx = c.BeginTransaction();
        var audit = await c.ExecuteScalarAsync<string?>("SELECT [审核] FROM [半成品盘点单] WITH (UPDLOCK,HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (audit is null) return false;
        if (audit == "1") throw new InvalidOperationException("已审核的半成品盘点单不能修改，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [半成品盘点明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await SaveCoreAsync(c, tx, 单号, dto, user, true, 系统数量表);
        tx.Commit();
        return true;
    }

    private static async Task SaveCoreAsync(IDbConnection c, IDbTransaction tx, string 单号, SemiStocktakeCreateDto dto, string user, bool update,
        IReadOnlyDictionary<string, decimal> 系统数量表)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("至少选择一行盘点产品。");
        if (dto.明细.Any(x => string.IsNullOrWhiteSpace(x.配件编号))) throw new ArgumentException("配件编号必填。");
        if (dto.明细.Any(x => x.盘点数量 < 0)) throw new ArgumentException("盘点数量不能为负。");
        if (dto.明细.GroupBy(x => x.配件编号!.Trim(), StringComparer.OrdinalIgnoreCase).Any(g => g.Count() > 1))
            throw new ArgumentException("同一单据内配件编号不能重复。");

        var warehouse = string.IsNullOrWhiteSpace(dto.仓库) ? DefaultWarehouse : dto.仓库.Trim();
        var date = dto.日期?.Date ?? DateTime.Today;
        decimal 系统数量Of(SemiStocktakeLineInput x) => 系统数量表.TryGetValue(x.配件编号!.Trim(), out var q) ? q : 0m;
        var sysTot = dto.明细.Sum(系统数量Of);
        var cntTot = dto.明细.Sum(x => x.盘点数量);
        var diffTot = dto.明细.Sum(x => x.盘点数量 - 系统数量Of(x));

        if (update)
            await c.ExecuteAsync(@"UPDATE [半成品盘点单] SET [日期]=@date,[仓库]=@wh,[系统数量]=@sysTot,[盘点数量]=@cntTot,[盈亏数量]=@diffTot,[操作员]=@user,[备注]=@备注 WHERE [单号]=@单号",
                new { 单号, date, wh = warehouse, sysTot, cntTot, diffTot, user, dto.备注 }, tx);
        else
            await c.ExecuteAsync(@"INSERT INTO [半成品盘点单]([单号],[日期],[仓库],[系统数量],[盘点数量],[盈亏数量],[操作员],[审核],[备注])
VALUES(@单号,@date,@wh,@sysTot,@cntTot,@diffTot,@user,'0',@备注)",
                new { 单号, date, wh = warehouse, sysTot, cntTot, diffTot, user, dto.备注 }, tx);

        foreach (var l in dto.明细)
        {
            var mat = l.配件编号!.Trim();
            var 系统数量 = 系统数量表.TryGetValue(mat, out var q) ? q : 0m;
            // 规格/颜色 取自该物料最近一张已审核入仓明细，保证盈亏落到正确颜色桶（明细网格不显示颜色，与桌面版一致）。
            var f = await c.QuerySingleOrDefaultAsync<ReceiptFacts>(@"
SELECT TOP (1) d.[规格],d.[颜色],d.[单位]
FROM [半成品入仓明细单] d JOIN [半成品入仓单] h ON h.[单号]=d.[单号]
WHERE d.[物料编号]=@mat AND d.[仓库]=@wh AND ISNULL(h.[审核],'0')='1'
ORDER BY d.[ID] DESC;", new { mat, wh = warehouse }, tx) ?? new ReceiptFacts();
            await c.ExecuteAsync(@"INSERT INTO [半成品盘点明细单]
([单号],[日期],[仓库],[客户],[货号],[名称],[物料编号],[物料名称],[规格],[颜色],[单位],[系统数量],[盘点数量],[盈亏数量],[备注])
VALUES(@单号,@date,@wh,@客户,@货号,@名称,@物料编号,@物料名称,@规格,@颜色,@单位,@系统数量,@盘点数量,@盈亏数量,@备注)",
                new
                {
                    单号, date, wh = warehouse,
                    客户 = l.客户, 货号 = l.产品货号, 名称 = l.产品名称,
                    物料编号 = mat, 物料名称 = l.产品装配名称, f.规格, f.颜色, f.单位,
                    系统数量, 盘点数量 = l.盘点数量, 盈亏数量 = l.盘点数量 - 系统数量, 备注 = l.备注
                }, tx);
        }
    }

    private sealed class ReceiptFacts
    {
        public string? 规格 { get; set; }
        public string? 颜色 { get; set; }
        public string? 单位 { get; set; }
    }

    public async Task<PagedResult<SemiStocktakeHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [半成品盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw;
SELECT [ID],[单号],[仓库],[日期],
       CAST([系统数量] AS decimal(18,4)) AS 系统数量, CAST([盘点数量] AS decimal(18,4)) AS 盘点数量, CAST([盈亏数量] AS decimal(18,4)) AS 盈亏数量,
       [操作员],[审核],[审核人],[备注]
FROM [半成品盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<SemiStocktakeHeaderDto>()).AsList();
        return new PagedResult<SemiStocktakeHeaderDto>(items, total);
    }

    public async Task<SemiStocktakeDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[仓库],[日期],
       CAST([系统数量] AS decimal(18,4)) AS 系统数量, CAST([盘点数量] AS decimal(18,4)) AS 盘点数量, CAST([盈亏数量] AS decimal(18,4)) AS 盈亏数量,
       [操作员],[审核],[审核人],[备注]
FROM [半成品盘点单] WHERE [单号]=@单号;
SELECT [ID],[物料编号] AS [配件编号],[客户],[货号] AS [产品货号],[名称] AS [产品名称],[物料名称] AS [产品装配名称],
       CAST([系统数量] AS decimal(18,4)) AS 系统数量, CAST([盘点数量] AS decimal(18,4)) AS 盘点数量, CAST([盈亏数量] AS decimal(18,4)) AS 盈亏数量,[备注]
FROM [半成品盘点明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<SemiStocktakeHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<SemiStocktakeLineRowDto>()).AsList();
        return new SemiStocktakeDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [半成品盘点单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的半成品盘点单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [半成品盘点明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [半成品盘点单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }

    public async Task<PagedResult<SemiStocktakeProductRow>> ProductsAsync(SemiStocktakeProductQuery query)
    {
        var page = Math.Max(query.Page, 1);
        var size = Math.Clamp(query.Size, 1, 1000);
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
        var items = (await multi.ReadAsync<SemiStocktakeProductRow>()).AsList();
        return new(items, total);
    }

    public async Task<SemiStocktakeDetailDto?> GetAdjacentAsync(string 单号, bool next)
    {
        using var c = factory.Create(); await c.OpenAsync();
        var cur = await c.QuerySingleOrDefaultAsync<AdjacentAnchor>(
            "SELECT [ID],[日期] FROM [半成品盘点单] WHERE [单号]=@单号", new { 单号 });
        if (cur is null) return null;
        var adj = await c.ExecuteScalarAsync<string?>(next
            ? "SELECT TOP (1) [单号] FROM [半成品盘点单] WHERE [日期]>@d OR ([日期]=@d AND [ID]>@id) ORDER BY [日期],[ID];"
            : "SELECT TOP (1) [单号] FROM [半成品盘点单] WHERE [日期]<@d OR ([日期]=@d AND [ID]<@id) ORDER BY [日期] DESC,[ID] DESC;",
            new { d = cur.日期, id = cur.ID });
        return adj is null ? null : await GetAsync(adj);
    }

    private sealed class AdjacentAnchor { public long ID { get; set; } public DateTime? 日期 { get; set; } }
}
