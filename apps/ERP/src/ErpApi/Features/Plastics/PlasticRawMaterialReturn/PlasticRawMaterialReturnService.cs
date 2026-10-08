using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticRawMaterialReturn;

// 原料退仓单(原料仓库·退回供应商)。v1 审核 = 纯锁定(走通用过账引擎只翻 审核='1',不动库存;库存台账延后)。
public sealed class PlasticRawMaterialReturnService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "原料退仓单";
    public const string Prefix = "YTC";   // 原料退仓单号 = YTC + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(PlasticRawMaterialReturnCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("原料出仓单至少要有一行明细");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0m));
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [原料退仓单]([单号],[供应商编号],[供应商名称],[日期],[电脑单号],[入仓单号],[单价类型],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@供应商编号,@供应商名称,@日期,@电脑单号,@入仓单号,@单价类型,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, dto.供应商编号, dto.供应商名称, 日期 = now, dto.电脑单号, dto.入仓单号, dto.单价类型,
                  数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [原料退仓明细单]([单号],[原料编号],[原料名称],[产地],[每包重量],[单价类型],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@原料编号,@原料名称,@产地,@每包重量,@单价类型,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, l.原料编号, l.原料名称, l.产地, l.每包重量, l.单价类型, l.单位, l.数量, l.单价,
                      金额 = l.数量 * (l.单价 ?? 0m), l.备注 }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticRawMaterialReturnHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [原料退仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw;
SELECT [ID],[单号],[供应商编号],[供应商名称],[日期],[电脑单号],[入仓单号],[单价类型],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [原料退仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticRawMaterialReturnHeaderDto>()).AsList();
        return new PagedResult<PlasticRawMaterialReturnHeaderDto>(items, total);
    }

    public async Task<PlasticRawMaterialReturnDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[供应商编号],[供应商名称],[日期],[电脑单号],[入仓单号],[单价类型],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [原料退仓单] WHERE [单号]=@单号;
SELECT [ID],[原料编号],[原料名称],[产地],[每包重量],[单价类型],[单位],[数量],[单价],[金额],[备注]
FROM [原料退仓明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticRawMaterialReturnHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticRawMaterialReturnLineDto>()).AsList();
        return new PlasticRawMaterialReturnDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [原料退仓单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的原料出仓单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [原料退仓明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [原料退仓单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }

    private static string ApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL(h.[审核],'0')='1'",
        "未审核" => " AND ISNULL(h.[审核],'0')<>'1'",
        _ => "",
    };

    public async Task<IReadOnlyList<PlasticRawMaterialReturnQueryDetailRow>> ReturnQueryDetailAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) || 物料类别 == "所有类别" ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialReturnQueryDetailRow>($@"
SELECT h.[日期],
       d.[单号],
       h.[供应商编号],
       h.[供应商名称],
       d.[原料编号],
       d.[原料名称],
       d.[产地],
       d.[单价类型],
       d.[单位],
       d.[数量],
       d.[单价],
       d.[金额],
       d.[备注],
       h.[审核]
FROM [原料退仓明细单] d
JOIN [原料退仓单] h ON h.[单号] = d.[单号]
LEFT JOIN [塑胶原料资料] m ON m.[物料编号] = d.[原料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@cat IS NULL OR m.[物料类别] = @cat)
  AND (@kw IS NULL OR d.[原料编号] LIKE @kw OR d.[原料名称] LIKE @kw OR h.[单号] LIKE @kw
       OR h.[电脑单号] LIKE @kw OR h.[入仓单号] LIKE @kw OR h.[供应商编号] LIKE @kw OR h.[供应商名称] LIKE @kw)
{ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID];", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticRawMaterialReturnQuerySummaryRow>> ReturnQuerySummaryAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) || 物料类别 == "所有类别" ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialReturnQuerySummaryRow>($@"
SELECT d.[原料编号],
       MAX(d.[原料名称]) AS 原料名称,
       MAX(d.[产地]) AS 产地,
       MAX(d.[单位]) AS 单位,
       SUM(ISNULL(d.[数量],0)) AS 退仓数量,
       SUM(ISNULL(d.[金额],0)) AS 金额
FROM [原料退仓明细单] d
JOIN [原料退仓单] h ON h.[单号] = d.[单号]
LEFT JOIN [塑胶原料资料] m ON m.[物料编号] = d.[原料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@cat IS NULL OR m.[物料类别] = @cat)
  AND (@kw IS NULL OR d.[原料编号] LIKE @kw OR d.[原料名称] LIKE @kw OR h.[单号] LIKE @kw
       OR h.[电脑单号] LIKE @kw OR h.[入仓单号] LIKE @kw OR h.[供应商编号] LIKE @kw OR h.[供应商名称] LIKE @kw)
{ApprovalFilter(审核情况)}
GROUP BY d.[原料编号]
ORDER BY d.[原料编号];", new { qi, qe, kw, cat });
        return rows.AsList();
    }
}
