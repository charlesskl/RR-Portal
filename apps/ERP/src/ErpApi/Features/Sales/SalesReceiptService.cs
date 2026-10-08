using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Sales;

// 销售收款（客户级挂账，冲应收，不碰库存）。两层：销售收款单 + 销售收款明细单(单号 主从)。审核仅单头(明细无审核列)。
public sealed class SalesReceiptService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "销售收款单";
    public const string Prefix = "XK";

    public async Task<string> CreateAsync(SalesReceiptCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("销售收款至少要有一行明细");
        var now = DateTime.Now;
        var 金额合计 = dto.明细.Sum(l => l.收款金额);

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [销售收款单]([出仓单号],[单号],[日期],[金额],[操作员],[审核],[备注])
VALUES(@出仓单号,@单号,@日期,@金额,@操作员,'0',@备注)",
            new { dto.出仓单号, 单号, 日期 = now, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [销售收款明细单]([出仓单号],[单号],[日期],[客户编号],[客户名称],[货款金额],[收款金额],[应收金额],[备注])
VALUES(@出仓单号,@单号,@日期,@客户编号,@客户名称,@货款金额,@收款金额,@应收金额,@备注)",
                new
                {
                    出仓单号 = l.出仓单号 ?? dto.出仓单号, 单号, 日期 = now,
                    l.客户编号, l.客户名称, 货款金额 = l.货款金额 ?? 0, l.收款金额, 应收金额 = l.应收金额 ?? 0, 备注 = (string?)null
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<SalesReceiptHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [销售收款单] WHERE @kw IS NULL OR [单号] LIKE @kw;
SELECT [ID],[出仓单号],[单号],[日期],[金额],[操作员],[审核],[审核人],[备注]
FROM [销售收款单] WHERE @kw IS NULL OR [单号] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<SalesReceiptHeaderDto>()).AsList();
        return new PagedResult<SalesReceiptHeaderDto>(items, total);
    }

    public async Task<SalesReceiptDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[出仓单号],[单号],[日期],[金额],[操作员],[审核],[审核人],[备注] FROM [销售收款单] WHERE [单号]=@单号;
SELECT [ID],[出仓单号],[客户编号],[客户名称],[货款金额],[收款金额],[应收金额],[备注] FROM [销售收款明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<SalesReceiptHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<SalesReceiptLineRowDto>()).AsList();
        return new SalesReceiptDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [销售收款单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的销售收款单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [销售收款明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [销售收款单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
