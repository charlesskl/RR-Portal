using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Payables;

// 采购付款（供应商级挂账，冲应付，不碰库存）。两层：采购付款单 + 采购付款明细单(单号 主从)。审核仅单头(明细无审核列)。
public sealed class PurchasePaymentService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "采购付款单";
    public const string Prefix = "CF";

    public async Task<string> CreateAsync(PurchasePaymentCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("采购付款至少要有一行明细");
        var now = DateTime.Now;
        var 金额合计 = dto.明细.Sum(l => l.付款金额);

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [采购付款单]([入仓单号],[单号],[日期],[金额],[操作员],[审核],[备注])
VALUES(@入仓单号,@单号,@日期,@金额,@操作员,'0',@备注)",
            new { dto.入仓单号, 单号, 日期 = now, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [采购付款明细单]([入仓单号],[单号],[日期],[供应商编号],[供应商名称],[货款金额],[付款金额],[尚欠金额],[备注])
VALUES(@入仓单号,@单号,@日期,@供应商编号,@供应商名称,@货款金额,@付款金额,@尚欠金额,@备注)",
                new
                {
                    入仓单号 = l.入仓单号 ?? dto.入仓单号, 单号, 日期 = now,
                    l.供应商编号, l.供应商名称, 货款金额 = l.货款金额 ?? 0, l.付款金额, 尚欠金额 = l.尚欠金额 ?? 0, 备注 = (string?)null
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PurchasePaymentHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [采购付款单] WHERE @kw IS NULL OR [单号] LIKE @kw;
SELECT [ID],[入仓单号],[单号],[日期],[金额],[操作员],[审核],[审核人],[备注]
FROM [采购付款单] WHERE @kw IS NULL OR [单号] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PurchasePaymentHeaderDto>()).AsList();
        return new PagedResult<PurchasePaymentHeaderDto>(items, total);
    }

    public async Task<PurchasePaymentDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[入仓单号],[单号],[日期],[金额],[操作员],[审核],[审核人],[备注] FROM [采购付款单] WHERE [单号]=@单号;
SELECT [ID],[入仓单号],[供应商编号],[供应商名称],[货款金额],[付款金额],[尚欠金额],[备注] FROM [采购付款明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PurchasePaymentHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PurchasePaymentLineRowDto>()).AsList();
        return new PurchasePaymentDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [采购付款单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的采购付款单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [采购付款明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [采购付款单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
