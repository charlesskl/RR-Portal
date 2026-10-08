using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;

namespace ErpApi.Features.Warehouse.Semi;

public sealed class SemiWarehouseReturnService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "半成品退仓单";
    public const string Prefix = "BRT";

    public async Task<PagedResult<SemiReceiptHeaderDto>> ReceiptListAsync(int page, int size, string? keyword)
    {
        page = Math.Max(1, page); size = Math.Clamp(size, 1, 1000);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [半成品入仓单] WHERE ISNULL([审核],'0')='1' AND (@kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw OR [仓库] LIKE @kw);
SELECT [ID],[单号],[订单单号],[供应商编号],[供应商名称],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [半成品入仓单] WHERE ISNULL([审核],'0')='1' AND (@kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw OR [仓库] LIKE @kw)
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        return new((await multi.ReadAsync<SemiReceiptHeaderDto>()).AsList(), total);
    }

    public async Task<PagedResult<SemiWarehouseReturnHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        page = Math.Max(1, page); size = Math.Clamp(size, 1, 1000);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [半成品退仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [入仓单号] LIKE @kw OR [供应商名称] LIKE @kw;
SELECT * FROM [半成品退仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [入仓单号] LIKE @kw OR [供应商名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        return new((await multi.ReadAsync<SemiWarehouseReturnHeaderDto>()).AsList(), total);
    }

    public async Task<SemiWarehouseReturnDetailDto?> GetAsync(string no, bool showPrice = true)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT * FROM [半成品退仓单] WHERE [单号]=@no;
SELECT d.[ID],d.[入仓明细ID],d.[订单单号],d.[客户],d.[生产单号],d.[货号] AS [产品货号],d.[名称] AS [产品名称],
 d.[物料编号] AS [配件编号],d.[物料名称] AS [产品装配名称],d.[规格],d.[颜色],d.[单位],d.[数量],d.[单价],d.[金额],d.[备注]
FROM [半成品退仓明细单] d WHERE d.[单号]=@no ORDER BY d.[ID];", new { no });
        var header = await multi.ReadFirstOrDefaultAsync<SemiWarehouseReturnHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<SemiWarehouseReturnLineRowDto>()).AsList();
        if (!showPrice) { header.金额 = null; foreach (var line in lines) { line.单价 = null; line.金额 = null; } }
        return new() { 单头 = header, 明细 = lines };
    }

    public async Task<string> CreateAsync(SemiWarehouseReturnCreateDto dto, string user)
    {
        using var c = factory.Create(); await c.OpenAsync(); using var tx = c.BeginTransaction();
        var date = dto.日期?.Date ?? DateTime.Today;
        var no = await docNo.NextAsync(DocType, Prefix, date, c, tx);
        await SaveCoreAsync(c, tx, no, dto, user, false);
        tx.Commit(); return no;
    }

    public async Task<bool> UpdateAsync(string no, SemiWarehouseReturnCreateDto dto, string user)
    {
        using var c = factory.Create(); await c.OpenAsync(); using var tx = c.BeginTransaction();
        var audit = await c.ExecuteScalarAsync<string?>("SELECT [审核] FROM [半成品退仓单] WITH (UPDLOCK,HOLDLOCK) WHERE [单号]=@no", new { no }, tx);
        if (audit is null) return false;
        if (audit == "1") throw new InvalidOperationException("已审核的半成品出仓单不能修改，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [半成品退仓明细单] WHERE [单号]=@no", new { no }, tx);
        await SaveCoreAsync(c, tx, no, dto, user, true); tx.Commit(); return true;
    }

    private static async Task SaveCoreAsync(System.Data.IDbConnection c, System.Data.IDbTransaction tx, string no, SemiWarehouseReturnCreateDto dto, string user, bool update)
    {
        if (string.IsNullOrWhiteSpace(dto.入仓单号)) throw new ArgumentException("请先选择原入仓单号。");
        if (dto.明细.Count == 0) throw new ArgumentException("至少选择一行出仓产品。");
        if (dto.明细.Any(x => string.IsNullOrWhiteSpace(x.配件编号))) throw new ArgumentException("配件编号必填。");
        if (dto.明细.Any(x => x.数量 <= 0)) throw new ArgumentException("出仓数量必须大于 0。");
        if (dto.明细.GroupBy(x => x.配件编号!.Trim(), StringComparer.OrdinalIgnoreCase).Any(g => g.Count() > 1))
            throw new ArgumentException("同一单据内配件编号不能重复。");

        var source = await c.QuerySingleOrDefaultAsync<SemiReceiptHeaderDto>(
            "SELECT * FROM [半成品入仓单] WITH (UPDLOCK,HOLDLOCK) WHERE [单号]=@n AND ISNULL([审核],'0')='1'",
            new { n = dto.入仓单号 }, tx);
        if (source is null) throw new InvalidOperationException("原入仓单不存在或尚未审核。");
        var warehouse = source.仓库;
        var date = dto.日期?.Date ?? DateTime.Today;

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

    public async Task<bool> DeleteAsync(string no)
    {
        using var c = factory.Create(); await c.OpenAsync(); using var tx = c.BeginTransaction();
        var audit = await c.ExecuteScalarAsync<string?>("SELECT [审核] FROM [半成品退仓单] WITH (UPDLOCK,HOLDLOCK) WHERE [单号]=@no", new { no }, tx);
        if (audit is null) return false; if (audit == "1") throw new InvalidOperationException("已审核单据不能删除。");
        await c.ExecuteAsync("DELETE FROM [半成品退仓明细单] WHERE [单号]=@no; DELETE FROM [半成品退仓单] WHERE [单号]=@no;", new { no }, tx); tx.Commit(); return true;
    }

    public async Task<bool> SetApprovedAsync(string no, string user, bool approved)
    {
        using var c = factory.Create(); await c.OpenAsync(); using var tx = c.BeginTransaction();
        var header = await c.QuerySingleOrDefaultAsync<SemiWarehouseReturnHeaderDto>("SELECT * FROM [半成品退仓单] WITH (UPDLOCK,HOLDLOCK) WHERE [单号]=@no", new { no }, tx);
        if (header is null || (approved ? header.审核 == "1" : header.审核 != "1")) return false;
        if (approved)
        {
            var sourceApproved = await c.ExecuteScalarAsync<int>(@"
SELECT COUNT(*) FROM [半成品入仓单] WITH (UPDLOCK,HOLDLOCK)
WHERE [单号]=@receiptNo AND ISNULL([审核],'0')='1';", new { receiptNo = header.入仓单号 }, tx);
            if (sourceApproved == 0) throw new InvalidOperationException("审核失败：原入仓单不存在或已反审核。");
        }
        await c.ExecuteAsync(approved ? "UPDATE [半成品退仓单] SET [审核]='1',[审核人]=@user,[审核日期]=SYSDATETIME() WHERE [单号]=@no" : "UPDATE [半成品退仓单] SET [审核]='0',[审核人]=NULL,[审核日期]=NULL WHERE [单号]=@no", new { no, user }, tx);
        tx.Commit(); return true;
    }

    public async Task<PagedResult<SemiWarehouseReturnProductRow>> ProductsAsync(SemiWarehouseReturnProductQuery query, bool canSeePrice)
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
        var items = (await multi.ReadAsync<SemiWarehouseReturnProductRow>()).AsList();
        if (!canSeePrice) foreach (var it in items) { it.加工单价 = null; it.库存单价 = null; }
        return new(items, total);
    }

    public async Task<SemiWarehouseReturnDetailDto?> GetAdjacentAsync(string no, bool next, bool showPrice)
    {
        using var c = factory.Create(); await c.OpenAsync();
        var cur = await c.QuerySingleOrDefaultAsync<AdjacentAnchor>(
            "SELECT [ID],[日期] FROM [半成品退仓单] WHERE [单号]=@no", new { no });
        if (cur is null) return null;
        var adj = await c.ExecuteScalarAsync<string?>(next
            ? "SELECT TOP (1) [单号] FROM [半成品退仓单] WHERE [日期]>@d OR ([日期]=@d AND [ID]>@id) ORDER BY [日期],[ID];"
            : "SELECT TOP (1) [单号] FROM [半成品退仓单] WHERE [日期]<@d OR ([日期]=@d AND [ID]<@id) ORDER BY [日期] DESC,[ID] DESC;",
            new { d = cur.日期, id = cur.ID });
        return adj is null ? null : await GetAsync(adj, showPrice);
    }

    private sealed class AdjacentAnchor { public long ID { get; set; } public DateTime 日期 { get; set; } }
}
