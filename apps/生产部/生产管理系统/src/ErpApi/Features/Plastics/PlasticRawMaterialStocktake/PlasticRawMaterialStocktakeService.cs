using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticRawMaterialStocktake;

// 原料盘点单(原料仓库·以实盘校准账面)。审核 = 自建事务:翻审核位 + UPDATE 塑胶原料资料.库存=盘点数量(按原料编号)。
// 系统数量写库时服务端复算(账面=塑胶原料资料.库存,与审核写回口径一致),不信任前端传入值。
// 反审核按明细 系统数量(盘点入账前账面快照)还原库存 + 写审计日志(口径同物料盘点)。不走通用 IPostingEngine(需在同事务写库存)。
public sealed class PlasticRawMaterialStocktakeService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo, IAuditLogger audit)
{
    public const string DocType = "原料盘点单";
    public const string Prefix = "YPD";   // 原料盘点单号 = YPD + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(PlasticRawMaterialStocktakeCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("原料盘点单至少要有一行明细");
        if (dto.明细.Any(l => l.盘点数量 < 0)) throw new ArgumentException("盘点数量不能为负");
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [原料盘点单]([单号],[日期],[电脑单号],[操作员],[审核],[备注])
VALUES(@单号,@日期,@电脑单号,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.电脑单号, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
        {
            // 系统数量服务端复算(账面=塑胶原料资料.库存,与审核写回/反审核还原同口径),不信任前端传入值;主档不存在=0
            var 系统数量 = await c.ExecuteScalarAsync<decimal>(
                "SELECT CAST(ISNULL([库存],0) AS decimal(18,4)) FROM [塑胶原料资料] WHERE [物料编号]=@原料编号",
                new { l.原料编号 }, tx);
            await c.ExecuteAsync(@"
INSERT INTO [原料盘点明细单]([单号],[原料编号],[原料名称],[产地],[每包重量],[单位],[系统数量],[盘点数量],[盈亏数量],[备注])
VALUES(@单号,@原料编号,@原料名称,@产地,@每包重量,@单位,@系统数量,@盘点数量,@盈亏数量,@备注)",
                new { 单号, l.原料编号, l.原料名称, l.产地, l.每包重量, l.单位, 系统数量, l.盘点数量,
                      盈亏数量 = l.盘点数量 - 系统数量, l.备注 }, tx);
        }

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticRawMaterialStocktakeHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [原料盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[日期],[电脑单号],[操作员],[审核],[审核人],[备注]
FROM [原料盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticRawMaterialStocktakeHeaderDto>()).AsList();
        return new PagedResult<PlasticRawMaterialStocktakeHeaderDto>(items, total);
    }

    public async Task<PlasticRawMaterialStocktakeDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[电脑单号],[操作员],[审核],[审核人],[备注]
FROM [原料盘点单] WHERE [单号]=@单号;
SELECT [ID],[原料编号],[原料名称],[产地],[每包重量],[单位],[系统数量],[盘点数量],[盈亏数量],[备注]
FROM [原料盘点明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticRawMaterialStocktakeHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticRawMaterialStocktakeLineDto>()).AsList();
        return new PlasticRawMaterialStocktakeDetailDto { 单头 = header, 明细 = lines };
    }

    // 审核:一个事务里翻审核位 + 把每行 盘点数量 写回 塑胶原料资料.库存(按原料编号校准账面)。
    public async Task<bool> ApproveAsync(string 单号, string user)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [原料盘点单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null || 审核 == "1") return false;
        await c.ExecuteAsync(
            "UPDATE [原料盘点单] SET [审核]='1',[审核人]=@user,[审核日期]=@now WHERE [单号]=@单号",
            new { 单号, user, now = DateTime.Now }, tx);
        await c.ExecuteAsync(@"
UPDATE m SET m.[库存] = d.[盘点数量]
FROM [塑胶原料资料] m
JOIN [原料盘点明细单] d ON d.[原料编号] = m.[物料编号]
WHERE d.[单号] = @单号 AND d.[原料编号] IS NOT NULL", new { 单号 }, tx);
        tx.Commit();
        return true;
    }

    // 反审核:翻审核位=0,并按明细 系统数量(盘点入账前账面快照)还原 塑胶原料资料.库存 + 写审计日志(口径同物料盘点);跳过主档不存在的原料编号。
    public async Task<bool> UnapproveAsync(string 单号, string user)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [原料盘点单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null || 审核 != "1") return false;
        await c.ExecuteAsync(
            "UPDATE [原料盘点单] SET [审核]='0',[审核人]=NULL,[审核日期]=NULL WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync(@"
UPDATE m SET m.[库存] = d.[系统数量]
FROM [塑胶原料资料] m
JOIN [原料盘点明细单] d ON d.[原料编号] = m.[物料编号]
WHERE d.[单号] = @单号 AND d.[原料编号] IS NOT NULL", new { 单号 }, tx);
        await audit.WriteAsync("原料盘点单", "反审核", user, $"单号={单号}", c, tx);
        tx.Commit();
        return true;
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [原料盘点单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的原料盘点单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [原料盘点明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [原料盘点单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }

    private static string ApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL(h.[审核],'0')='1'",
        "未审核" => " AND ISNULL(h.[审核],'0')<>'1'",
        _ => "",
    };

    public async Task<IReadOnlyList<PlasticRawMaterialStocktakeQuerySummaryRow>> StocktakeQuerySummaryAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) || 物料类别 == "所有类别" ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialStocktakeQuerySummaryRow>($@"
SELECT d.[原料编号],
       MAX(d.[原料名称]) AS 原料名称,
       MAX(d.[产地]) AS 产地,
       MAX(d.[单位]) AS 单位,
       SUM(ISNULL(d.[系统数量],0)) AS 系统数,
       SUM(ISNULL(d.[盘点数量],0)) AS 盘点数,
       SUM(ISNULL(d.[盈亏数量],0)) AS 盈亏数
FROM [原料盘点明细单] d
JOIN [原料盘点单] h ON h.[单号] = d.[单号]
LEFT JOIN [塑胶原料资料] m ON m.[物料编号] = d.[原料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@cat IS NULL OR m.[物料类别] = @cat)
  AND (@kw IS NULL OR d.[原料编号] LIKE @kw OR d.[原料名称] LIKE @kw OR h.[单号] LIKE @kw OR h.[备注] LIKE @kw)
{ApprovalFilter(审核情况)}
GROUP BY d.[原料编号]
ORDER BY d.[原料编号];", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticRawMaterialStocktakeQueryDetailRow>> StocktakeQueryDetailAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) || 物料类别 == "所有类别" ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialStocktakeQueryDetailRow>($@"
SELECT h.[日期],
       d.[单号],
       d.[原料编号],
       d.[原料名称],
       d.[产地],
       d.[单位],
       d.[系统数量],
       d.[盘点数量],
       d.[盈亏数量],
       d.[备注],
       h.[审核]
FROM [原料盘点明细单] d
JOIN [原料盘点单] h ON h.[单号] = d.[单号]
LEFT JOIN [塑胶原料资料] m ON m.[物料编号] = d.[原料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@cat IS NULL OR m.[物料类别] = @cat)
  AND (@kw IS NULL OR d.[原料编号] LIKE @kw OR d.[原料名称] LIKE @kw OR h.[单号] LIKE @kw OR h.[备注] LIKE @kw)
{ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID];", new { qi, qe, kw, cat });
        return rows.AsList();
    }
}
