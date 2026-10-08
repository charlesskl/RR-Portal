using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticRawMaterialDemand;

// 原料生产需求表(原料仓库·生产领料需求计划)。审核 = 纯锁定(走通用过账引擎只翻 审核='1',不动任何库存)。
public sealed class PlasticRawMaterialDemandService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "原料生产需求表";
    public const string Prefix = "YLX";   // 原料生产需求单号 = YLX + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(PlasticRawMaterialDemandCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("原料生产需求表至少要有一行明细");
        var kg = dto.明细.Sum(l => l.需求数量KG);
        var bags = dto.明细.Sum(l => l.需求数量包);
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [原料生产需求表]([单号],[啤机生产单号],[开单日期],[制单人],[领料备注],[生产车间],[操作员],[数量KG],[数量包],[审核],[备注])
VALUES(@单号,@啤机生产单号,@开单日期,@制单人,@领料备注,@生产车间,@操作员,@数量KG,@数量包,'0',@备注)",
            new { 单号, dto.啤机生产单号, 开单日期 = now, dto.制单人, dto.领料备注, dto.生产车间,
                  操作员 = user, 数量KG = kg, 数量包 = bags, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [原料生产需求明细单]([单号],[原料编号],[原料名称],[每包重量],[单位],[需求数量KG],[需求数量包],[备注])
VALUES(@单号,@原料编号,@原料名称,@每包重量,@单位,@需求数量KG,@需求数量包,@备注)",
                new { 单号, l.原料编号, l.原料名称, l.每包重量, l.单位, l.需求数量KG, l.需求数量包, l.备注 }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticRawMaterialDemandHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [原料生产需求表] WHERE @kw IS NULL OR [单号] LIKE @kw OR [啤机生产单号] LIKE @kw OR [制单人] LIKE @kw;
SELECT [ID],[单号],[啤机生产单号],[开单日期],[制单人],[领料备注],[生产车间],[操作员],[数量KG],[数量包],[审核],[审核人],[备注]
FROM [原料生产需求表] WHERE @kw IS NULL OR [单号] LIKE @kw OR [啤机生产单号] LIKE @kw OR [制单人] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticRawMaterialDemandHeaderDto>()).AsList();
        return new PagedResult<PlasticRawMaterialDemandHeaderDto>(items, total);
    }

    public async Task<PlasticRawMaterialDemandDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[啤机生产单号],[开单日期],[制单人],[领料备注],[生产车间],[操作员],[数量KG],[数量包],[审核],[审核人],[备注]
FROM [原料生产需求表] WHERE [单号]=@单号;
SELECT [ID],[原料编号],[原料名称],[每包重量],[单位],[需求数量KG],[需求数量包],[备注]
FROM [原料生产需求明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticRawMaterialDemandHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticRawMaterialDemandLineDto>()).AsList();
        return new PlasticRawMaterialDemandDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<IReadOnlyList<PlasticRawMaterialDemandSummaryRow>> SummaryAsync(
        DateTime 起, DateTime 止, string? keyword, string? 领料备注, string? 审核情况)
    {
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var remark = string.IsNullOrWhiteSpace(领料备注) ? null : 领料备注.Trim();
        var audit = 审核情况 switch
        {
            "已审核" => "1",
            "未审核" => "0",
            _ => null
        };
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialDemandSummaryRow>(@"
SELECT h.[单号], h.[开单日期], h.[生产车间], h.[领料备注], h.[啤机生产单号],
       d.[原料编号], d.[原料名称], d.[每包重量], d.[单位], d.[需求数量KG], d.[需求数量包], d.[备注],
       h.[制单人], h.[操作员], h.[审核]
FROM [原料生产需求表] h
JOIN [原料生产需求明细单] d ON d.[单号] = h.[单号]
WHERE h.[开单日期] >= @qi AND h.[开单日期] < @qe
  AND (@remark IS NULL OR h.[领料备注] = @remark)
  AND (@audit IS NULL OR ISNULL(h.[审核],'0') = @audit)
  AND (@kw IS NULL OR h.[单号] LIKE @kw OR h.[啤机生产单号] LIKE @kw OR h.[生产车间] LIKE @kw
       OR d.[原料编号] LIKE @kw OR d.[原料名称] LIKE @kw OR h.[制单人] LIKE @kw)
ORDER BY h.[开单日期] DESC, h.[单号] DESC, d.[ID];", new { qi, qe, kw, remark, audit });
        return rows.AsList();
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [原料生产需求表] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的原料生产需求表不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [原料生产需求明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [原料生产需求表] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
