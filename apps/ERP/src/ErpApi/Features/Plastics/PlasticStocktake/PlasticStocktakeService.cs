using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticStocktake;

// 塑胶盘点(盈亏)。两层:塑胶盘点单 + 塑胶盘点明细单。审核位仅在单头。
// BasisAsync 从 PlasticInventoryService.ListAsync 取系统数量;写库时按同一口径逐行服务端复算(不信任前端传入值);盈亏=盘点−系统;审核后盈亏入库存(库存引擎按盈亏数量聚合)。
public sealed class PlasticStocktakeService(
    ISqlConnectionFactory factory, IDocumentNumberGenerator docNo, PlasticInventoryService inventory)
{
    public const string DocType = "塑胶盘点单";
    public const string Prefix = "SPD";

    public async Task<IReadOnlyList<PlasticStocktakeBasisRow>> BasisAsync(string 仓库)
    {
        var inv = await inventory.ListAsync(仓库, null);
        return inv.Select(r => new PlasticStocktakeBasisRow
        {
            物料编号 = r.物料编号, 物料名称 = r.物料名称, 规格 = r.规格, 单位 = r.单位, 仓位号 = r.仓位号, 系统数量 = r.库存数量
        }).ToList();
    }

    public async Task<string> CreateAsync(PlasticStocktakeCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("塑胶盘点单至少要有一行明细");
        if (dto.明细.Any(l => l.盘点数量 < 0)) throw new ArgumentException("盘点数量不能为负");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("塑胶盘点单必须指定仓库");
        var now = DateTime.Now;
        // 系统数量服务端复算(口径同 BasisAsync:库存引擎按 物料编号×仓库 实时聚合),不信任前端传入值;无台账行=0
        var 系统数量表 = (await inventory.ListAsync(dto.仓库, null))
            .ToDictionary(r => r.物料编号 ?? "", r => r.库存数量, StringComparer.OrdinalIgnoreCase);
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);
        await c.ExecuteAsync(@"
INSERT INTO [塑胶盘点单]([单号],[日期],[仓库],[操作员],[审核],[备注])
VALUES(@单号,@日期,@仓库,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.仓库, 操作员 = user, dto.备注 }, tx);
        foreach (var l in dto.明细)
        {
            var 系统数量 = 系统数量表.TryGetValue(l.物料编号 ?? "", out var q) ? q : 0m;
            await c.ExecuteAsync(@"
INSERT INTO [塑胶盘点明细单]([单号],[日期],[仓库],[物料编号],[物料名称],[规格],[仓位号],[单位],[系统数量],[盘点数量],[盈亏数量])
VALUES(@单号,@日期,@仓库,@物料编号,@物料名称,@规格,@仓位号,@单位,@系统数量,@盘点数量,@盈亏数量)",
                new
                {
                    单号, 日期 = now, dto.仓库, l.物料编号, l.物料名称, l.规格, l.仓位号, l.单位,
                    系统数量, l.盘点数量, 盈亏数量 = l.盘点数量 - 系统数量
                }, tx);
        }
        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticStocktakeHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [塑胶盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[仓库],[日期],[操作员],[审核],[审核人],[备注]
FROM [塑胶盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticStocktakeHeaderDto>()).AsList();
        return new PagedResult<PlasticStocktakeHeaderDto>(items, total);
    }

    public async Task<PlasticStocktakeDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[仓库],[日期],[操作员],[审核],[审核人],[备注] FROM [塑胶盘点单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[规格],[仓位号],[单位],[系统数量],[盘点数量],[盈亏数量]
FROM [塑胶盘点明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticStocktakeHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticStocktakeLineRowDto>()).AsList();
        return new PlasticStocktakeDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [塑胶盘点单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的塑胶盘点单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [塑胶盘点明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [塑胶盘点单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }

    private static string ApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL(h.[审核],'0')='1'",
        "未审核" => " AND ISNULL(h.[审核],'0')<>'1'",
        _ => ""
    };

    public async Task<IReadOnlyList<PlasticStocktakeQueryDetailRow>> StocktakeQueryDetailAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticStocktakeQueryDetailRow>($@"
SELECT h.[日期], d.[单号], d.[物料编号], d.[物料名称], d.[颜色], cm.[塑胶货号] AS 塑胶货号, cm.[塑胶货号] AS 共用货号,
       d.[单位], d.[系统数量], d.[盘点数量], d.[盈亏数量],
       m.[单价] AS 单价, d.[盈亏数量]*ISNULL(m.[单价],0) AS 金额, d.[备注], h.[审核]
FROM [塑胶盘点明细单] d
JOIN [塑胶盘点单] h ON h.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([塑胶货号]) AS 塑胶货号 FROM [塑胶共用物料表] GROUP BY [物料编号]) cm ON cm.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([单价]) AS 单价 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID]", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticStocktakeQuerySummaryRow>> StocktakeQuerySummaryAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticStocktakeQuerySummaryRow>($@"
SELECT d.[物料编号], MAX(d.[物料名称]) AS 物料名称, d.[颜色], MAX(cm.[塑胶货号]) AS 塑胶货号, MAX(m.[物料类别]) AS 物料类别, MAX(d.[单位]) AS 单位,
       SUM(d.[系统数量]) AS 系统数量, SUM(d.[盘点数量]) AS 盘点数量, SUM(d.[盈亏数量]) AS 盈亏数量,
       MAX(m.[单价]) AS 单价, SUM(d.[盈亏数量]*ISNULL(m.[单价],0)) AS 金额
FROM [塑胶盘点明细单] d
JOIN [塑胶盘点单] h ON h.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([塑胶货号]) AS 塑胶货号 FROM [塑胶共用物料表] GROUP BY [物料编号]) cm ON cm.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([单价]) AS 单价 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
GROUP BY d.[物料编号], d.[颜色]
ORDER BY d.[物料编号]", new { qi, qe, kw, cat });
        return rows.AsList();
    }
}
