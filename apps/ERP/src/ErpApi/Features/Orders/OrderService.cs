using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Orders;

public sealed class OrderService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "成品客户订货单";
    public const string Prefix = "DD";   // 订单单号 = DD + yyyyMMdd + 3位流水

    // 创建：同一事务内 生成单号 → 订货单(财务头) → 订单总表(款号头) → 订单明细(色×码行)
    public async Task<string> CreateAsync(OrderCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("订单至少要有一行色码数量明细");
        if (string.IsNullOrWhiteSpace(dto.客户编号)) throw new ArgumentException("客户编号必填");
        if (string.IsNullOrWhiteSpace(dto.款号)) throw new ArgumentException("款号必填");

        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 单价 = dto.单价 ?? 0m;
        var 金额合计 = 数量合计 * 单价;
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        // 1. 订货单（财务头）
        await c.ExecuteAsync(@"
INSERT INTO [成品客户订货单]([单号],[日期],[交货日期],[客户编号],[客户名称],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@交货日期,@客户编号,@客户名称,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new
            {
                单号, 日期 = now, dto.交货日期, dto.客户编号, dto.客户名称, dto.仓库,
                数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注
            }, tx);

        // 2. 订单总表（款号头，单号 UNIQUE = 一单一款）
        // 颜色组/尺码组/数量组：原系统宽表习惯的冗余串，仅供人工参考，不参与业务计算(三串顺序互不对齐)
        var 颜色组 = string.Join(",", dto.明细.Select(l => l.颜色).Distinct());
        var 尺码组 = string.Join(",", dto.明细.Select(l => l.尺码).Distinct());
        var 数量组 = string.Join(",", dto.明细.Select(l => l.数量));
        await c.ExecuteAsync(@"
INSERT INTO [成品客户订单总表]([单号],[日期],[交货日期],[客户编号],[客户名称],[仓库],[款号],[款式],
    [数量],[单价],[金额],[颜色组],[尺码组],[数量组],[审核],[备注],[客户款号],[合同号])
VALUES(@单号,@日期,@交货日期,@客户编号,@客户名称,@仓库,@款号,@款式,
    @数量,@单价,@金额,@颜色组,@尺码组,@数量组,'0',@备注,@客户款号,@合同号)",
            new
            {
                单号, 日期 = now, dto.交货日期, dto.客户编号, dto.客户名称, dto.仓库, dto.款号, dto.款式,
                数量 = 数量合计, 单价, 金额 = 金额合计, 颜色组, 尺码组, 数量组, dto.备注, dto.客户款号, dto.合同号
            }, tx);

        // 3. 订单明细（色×码行，FK→总表.单号）
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [成品客户订单明细表]([单号],[日期],[交货日期],[客户编号],[客户名称],[仓库],[款号],[款式],
    [色号],[颜色],[尺码],[数量],[单价],[金额],[审核],[客户款号],[合同号])
VALUES(@单号,@日期,@交货日期,@客户编号,@客户名称,@仓库,@款号,@款式,
    @色号,@颜色,@尺码,@数量,@单价,@金额,'0',@客户款号,@合同号)",
                new
                {
                    单号, 日期 = now, dto.交货日期, dto.客户编号, dto.客户名称, dto.仓库, dto.款号, dto.款式,
                    l.色号, l.颜色, l.尺码, l.数量, 单价, 金额 = l.数量 * 单价, dto.客户款号, dto.合同号
                }, tx);

        tx.Commit();
        return 单号;
    }

    // 分页列表（订货单财务头；关键字模糊匹配 单号/客户编号/客户名称/备注）
    public async Task<PagedResult<OrderHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";

        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [成品客户订货单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [客户编号] LIKE @kw OR [客户名称] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[日期],[交货日期],[客户编号],[客户名称],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [成品客户订货单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [客户编号] LIKE @kw OR [客户名称] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC
OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<OrderHeaderDto>()).AsList();
        return new PagedResult<OrderHeaderDto>(items, total);
    }

    // 详情：财务头 + 款号头 + 色码明细
    public async Task<OrderDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[交货日期],[客户编号],[客户名称],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注] FROM [成品客户订货单] WHERE [单号]=@单号;
SELECT [单号],[款号],[款式],[生产单号],[数量],[单价],[金额],[颜色组],[尺码组],[合同号],[客户款号] FROM [成品客户订单总表] WHERE [单号]=@单号;
SELECT [ID],[色号],[颜色],[尺码],[数量],[单价],[金额] FROM [成品客户订单明细表] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<OrderHeaderDto>();
        if (header is null) return null;
        var style = await multi.ReadFirstOrDefaultAsync<OrderStyleDto>();
        var lines = (await multi.ReadAsync<OrderLineRowDto>()).AsList();
        return new OrderDetailDto { 订货单 = header, 总表 = style, 明细 = lines };
    }

    // 删除：仅未审核可删；FK 顺序 明细→总表→订货单
    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [成品客户订货单] WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的订单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [成品客户订单明细表] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [成品客户订单总表] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [成品客户订货单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
