using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticWarehouseReturn;

// 塑胶退仓单(库存−,退回供应商出仓)。两层:塑胶退仓单 + 塑胶退仓明细单。审核后由 PlasticInventoryService 实时聚合(−)。
public sealed class PlasticWarehouseReturnService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "塑胶退仓单";
    public const string Prefix = "STC";

    public async Task<string> CreateAsync(PlasticWarehouseReturnCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("塑胶退仓单至少要有一行物料明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("塑胶退仓单必须指定仓库");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));
        var now = DateTime.Now;
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);
        await c.ExecuteAsync(@"
INSERT INTO [塑胶退仓单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[备注],[出库单号],[入仓单号],[电脑单号],[订单单号])
VALUES(@单号,@日期,@供应商编号,@供应商名称,@仓库,@数量,@金额,@操作员,'0',@备注,@出库单号,@入仓单号,@电脑单号,@订单单号)",
            new { 单号, 日期 = now, dto.供应商编号, dto.供应商名称, dto.仓库, 数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注,
                  dto.出库单号, dto.入仓单号, dto.电脑单号, dto.订单单号 }, tx);
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [塑胶退仓明细单]([单号],[日期],[仓库],[生产单号],[款号],[工模编号],[物料编号],[物料名称],[规格],[颜色],[塑胶货号],[订单单号],[仓位号],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@日期,@仓库,@生产单号,@款号,@工模编号,@物料编号,@物料名称,@规格,@颜色,@塑胶货号,@订单单号,@仓位号,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, 日期 = now, dto.仓库, l.生产单号, l.款号, l.工模编号, l.物料编号, l.物料名称, l.规格, l.颜色, l.塑胶货号,
                      订单单号 = l.订单单号 ?? dto.订单单号, l.仓位号, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注 }, tx);
        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticWarehouseReturnHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [塑胶退仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [塑胶退仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticWarehouseReturnHeaderDto>()).AsList();
        return new PagedResult<PlasticWarehouseReturnHeaderDto>(items, total);
    }

    public async Task<PlasticWarehouseReturnDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注],[出库单号],[入仓单号],[电脑单号],[订单单号]
FROM [塑胶退仓单] WHERE [单号]=@单号;
SELECT [ID],[生产单号],[款号],[工模编号],[物料编号],[物料名称],[规格],[颜色],[塑胶货号],[订单单号],[仓位号],[单位],[数量],[单价],[金额],[备注]
FROM [塑胶退仓明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticWarehouseReturnHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticWarehouseReturnLineDto>()).AsList();
        return new PlasticWarehouseReturnDetailDto { 单头 = header, 明细 = lines };
    }

    private static string ApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL(h.[审核],'0')='1'",
        "未审核" => " AND ISNULL(h.[审核],'0')<>'1'",
        _ => "",
    };

    public async Task<IReadOnlyList<PlasticWarehouseReturnQueryDetailRow>> WhReturnQueryDetailAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticWarehouseReturnQueryDetailRow>($@"
SELECT h.[日期], d.[单号], d.[订单单号], d.[生产单号], d.[款号], d.[工模编号], d.[物料编号], d.[物料名称], d.[颜色],
       d.[塑胶货号] AS 塑胶货号, cm.[塑胶货号] AS 共用货号, h.[供应商名称] AS 供应商,
       d.[单位], d.[数量], d.[单价], d.[金额], d.[备注], h.[审核]
FROM [塑胶退仓明细单] d
JOIN [塑胶退仓单] h ON h.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([塑胶货号]) AS 塑胶货号, MAX([共用原料编号]) AS 共用原料编号
           FROM [塑胶共用物料表] GROUP BY [物料编号]) cm ON cm.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[订单单号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID]", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticWarehouseReturnQuerySummaryRow>> WhReturnQuerySummaryAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticWarehouseReturnQuerySummaryRow>($@"
SELECT d.[物料编号], MAX(d.[物料名称]) AS 物料名称, d.[颜色],
       MAX(d.[塑胶货号]) AS 塑胶货号, MAX(cm.[塑胶货号]) AS 共用货号,
       MAX(cm.[共用原料编号]) AS 共用物料, MAX(m.[物料类别]) AS 物料类别, MAX(d.[单位]) AS 单位,
       SUM(d.[数量]) AS 数量, SUM(ISNULL(d.[金额],0)) AS 金额
FROM [塑胶退仓明细单] d
JOIN [塑胶退仓单] h ON h.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([塑胶货号]) AS 塑胶货号, MAX([共用原料编号]) AS 共用原料编号
           FROM [塑胶共用物料表] GROUP BY [物料编号]) cm ON cm.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[订单单号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
GROUP BY d.[物料编号], d.[颜色]
ORDER BY d.[物料编号]", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [塑胶退仓单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的塑胶退仓单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [塑胶退仓明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [塑胶退仓单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
