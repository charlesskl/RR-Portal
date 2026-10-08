using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Sales;

// 销售退货（纯应收逆向，不进库存账本）。两层：销售退货单 + 销售退货明细单(单号 主从)，带 销售单号 引用原出货。审核仅单头。
public sealed class SalesReturnService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "销售退货单";
    public const string Prefix = "XR";

    // 从原销售出货单带出明细作退货基准（首版不做累计已退校验）
    public async Task<IReadOnlyList<SalesReturnBasisRow>> BasisAsync(string 销售单号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<SalesReturnBasisRow>(@"
SELECT [物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价]
FROM [销售出货明细单] WHERE [单号]=@销售单号 ORDER BY [ID]", new { 销售单号 });
        return rows.AsList();
    }

    public async Task<string> CreateAsync(SalesReturnCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("销售退货至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("仓库必填");
        var now = DateTime.Now;
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [销售退货单]([单号],[销售单号],[日期],[客户编号],[客户名称],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@销售单号,@日期,@客户编号,@客户名称,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, dto.销售单号, 日期 = now, dto.客户编号, dto.客户名称, dto.仓库, 数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [销售退货明细单]([单号],[销售单号],[日期],[客户编号],[客户名称],[仓库],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[库存单价],[库存金额],[单价],[金额],[备注])
VALUES(@单号,@销售单号,@日期,@客户编号,@客户名称,@仓库,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,0,0,@单价,@金额,@备注)",
                new
                {
                    单号, dto.销售单号, 日期 = now, dto.客户编号, dto.客户名称, dto.仓库,
                    l.物料编号, l.物料名称, l.规格, l.颜色, l.单位, l.数量,
                    单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), 备注 = (string?)null
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<SalesReturnHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [销售退货单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [客户名称] LIKE @kw OR [销售单号] LIKE @kw;
SELECT [ID],[单号],[销售单号],[客户编号],[客户名称],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [销售退货单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [客户名称] LIKE @kw OR [销售单号] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<SalesReturnHeaderDto>()).AsList();
        return new PagedResult<SalesReturnHeaderDto>(items, total);
    }

    public async Task<SalesReturnDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[销售单号],[客户编号],[客户名称],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注] FROM [销售退货单] WHERE [单号]=@单号;
SELECT [ID],[销售单号],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[库存单价],[库存金额],[单价],[金额],[备注] FROM [销售退货明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<SalesReturnHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<SalesReturnLineRowDto>()).AsList();
        return new SalesReturnDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [销售退货单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的销售退货单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [销售退货明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [销售退货单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
