using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Materials.MaterialScrap;

// 报废单（物料报废，库存−）。两层：报废单 + 报废明细单。库存方向由 MaterialInventoryService 统一处理。
public sealed class MaterialScrapService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "报废单";
    public const string Prefix = "BF";   // 报废单号 = BF + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(MaterialScrapCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("报废单至少要有一行物料明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("报废单必须指定仓库");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [报废单]([单号],[日期],[报废部门],[报废人],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@报废部门,@报废人,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.报废部门, dto.报废人, dto.仓库,
                  数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [报废明细单]([单号],[日期],[仓库],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注],[生产单号],[款号])
VALUES(@单号,@日期,@仓库,@物料类别,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,@单价,@金额,@备注,@生产单号,@款号)",
                new { 单号, 日期 = now, dto.仓库, l.物料类别, l.物料编号, l.物料名称, l.规格, l.颜色, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注, l.生产单号, l.款号 }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<MaterialScrapHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [报废单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [报废部门] LIKE @kw OR [报废人] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[日期],[报废部门],[报废人],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [报废单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [报废部门] LIKE @kw OR [报废人] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<MaterialScrapHeaderDto>()).AsList();
        return new PagedResult<MaterialScrapHeaderDto>(items, total);
    }

    public async Task<MaterialScrapDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[报废部门],[报废人],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [报废单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[物料类别],[规格],[颜色],[单位],[数量],[单价],[金额],[备注],[生产单号],[款号]
FROM [报废明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<MaterialScrapHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<MaterialDocLineDto>()).AsList();
        return new MaterialScrapDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [报废单] WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的报废单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [报废明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [报废单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }

    // 审核情况过滤片段："已审核"→已审核；"未审核"→非已审核；其它/空→全部。
    private static string ApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL(o.[审核],'0') = '1'",
        "未审核" => " AND ISNULL(o.[审核],'0') <> '1'",
        _ => "",
    };

    // 报废单查询·明细：每行一条报废明细(只读·无价格)。过滤 日期区间/关键词/物料类别/审核情况。
    public async Task<IReadOnlyList<MaterialScrapQueryDetailRow>> ScrapQueryDetailAsync(
        DateTime? 起, DateTime? 止, string? keyword, string? 物料类别, string? 审核情况)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var 止Excl = 止?.Date.AddDays(1);
        using var c = factory.Create();
        var rows = await c.QueryAsync<MaterialScrapQueryDetailRow>($@"
SELECT d.[生产单号], d.[款号], d.[日期], d.[单号], d.[报废部门], d.[报废人],
       d.[物料编号], d.[物料名称], d.[物料类别], d.[规格], d.[颜色], d.[单位],
       d.[数量], d.[备注], o.[审核]
FROM [报废明细单] d
JOIN [报废单] o ON o.[单号] = d.[单号]
WHERE (@起 IS NULL OR d.[日期] >= @起)
  AND (@止 IS NULL OR d.[日期] < @止)
  AND (@kw IS NULL OR d.[单号] LIKE @kw OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw
       OR d.[报废部门] LIKE @kw OR d.[报废人] LIKE @kw
       OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[规格] LIKE @kw)
  AND (@cat IS NULL OR d.[物料类别] = @cat){ApprovalFilter(审核情况)}
ORDER BY d.[日期] DESC, d.[单号], d.[ID];",
            new { 起, 止 = 止Excl, kw, cat });
        return rows.AsList();
    }

    // 报废单查询·汇总：按 生产单号+物料编号+规格+颜色 合并(原系统"按生产单号")，SUM(数量)=报废数量。
    public async Task<IReadOnlyList<MaterialScrapSummaryRow>> ScrapQuerySummaryAsync(
        DateTime? 起, DateTime? 止, string? keyword, string? 物料类别, string? 审核情况)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var 止Excl = 止?.Date.AddDays(1);
        using var c = factory.Create();
        var rows = await c.QueryAsync<MaterialScrapSummaryRow>($@"
SELECT d.[生产单号], MAX(d.[款号]) AS 款号, d.[物料编号], MAX(d.[物料名称]) AS 物料名称,
       MAX(d.[物料类别]) AS 物料类别, d.[规格], d.[颜色], MAX(d.[单位]) AS 单位, SUM(d.[数量]) AS 报废数量
FROM [报废明细单] d
JOIN [报废单] o ON o.[单号] = d.[单号]
WHERE (@起 IS NULL OR d.[日期] >= @起)
  AND (@止 IS NULL OR d.[日期] < @止)
  AND (@kw IS NULL OR d.[单号] LIKE @kw OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw
       OR d.[报废部门] LIKE @kw OR d.[报废人] LIKE @kw
       OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[规格] LIKE @kw)
  AND (@cat IS NULL OR d.[物料类别] = @cat){ApprovalFilter(审核情况)}
GROUP BY d.[生产单号], d.[物料编号], d.[规格], d.[颜色]
ORDER BY d.[生产单号], d.[物料编号], d.[规格], d.[颜色];",
            new { 起, 止 = 止Excl, kw, cat });
        return rows.AsList();
    }
}
