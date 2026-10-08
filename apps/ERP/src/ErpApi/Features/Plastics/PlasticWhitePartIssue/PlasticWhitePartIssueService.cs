using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticWhitePartIssue;

// 白件领料单(发外加工·白件半成品发外)。审核后由 PlasticInventoryService 实时聚合扣减塑胶仓库存(白件都在塑胶仓,台账按固定仓库=塑胶仓记 −)。
// 明细按生产单号从塑胶共用物料表 BOM 调入(单位取塑胶物料资料;发外采购无源由用户录入)。
public sealed class PlasticWhitePartIssueService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "白件领料单";
    public const string Prefix = "BJL";   // 白件领料单号 = BJL + yyyyMMdd + 3位流水

    public async Task<IReadOnlyList<PlasticWhitePartIssueBasisRow>> BasisAsync(string 生产单号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticWhitePartIssueBasisRow>(@"
SELECT g.[生产单号], pm.[款号], p.[工模编号] AS 模具编号, p.[物料编号], p.[物料名称],
       p.[颜色], p.[用料名称], m.[单位]
FROM [塑胶共用物料表] p
JOIN [生产制单货号] g ON g.[货号] = p.[塑胶货号]
LEFT JOIN [生产制单] pm ON pm.[生产单号] = g.[生产单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = p.[物料编号]
WHERE g.[生产单号] = @生产单号
ORDER BY p.[ID]", new { 生产单号 });
        return rows.AsList();
    }

    public async Task<string> CreateAsync(PlasticWhitePartIssueCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("白件领料单至少要有一行明细");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [白件领料单]([单号],[日期],[领料部门],[领料人],[胶箱数],[卡板数],[领料备注],[数量],[操作员],[电脑单号],[审核],[备注])
VALUES(@单号,@日期,@领料部门,@领料人,@胶箱数,@卡板数,@领料备注,@数量,@操作员,@电脑单号,'0',@备注)",
            new { 单号, 日期 = now, dto.领料部门, dto.领料人, dto.胶箱数, dto.卡板数, dto.领料备注,
                  数量 = 数量合计, 操作员 = user, dto.电脑单号, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [白件领料明细单]([单号],[发外采购],[生产单号],[款号],[物料编号],[模具编号],[物料名称],[颜色],[用料名称],[单位],[数量],[备注])
VALUES(@单号,@发外采购,@生产单号,@款号,@物料编号,@模具编号,@物料名称,@颜色,@用料名称,@单位,@数量,@备注)",
                new { 单号, l.发外采购, l.生产单号, l.款号, l.物料编号, l.模具编号, l.物料名称, l.颜色,
                      l.用料名称, l.单位, l.数量, l.备注 }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticWhitePartIssueHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [白件领料单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [领料部门] LIKE @kw OR [领料人] LIKE @kw;
SELECT [ID],[单号],[日期],[领料部门],[领料人],[胶箱数],[卡板数],[领料备注],[数量],[操作员],[电脑单号],[审核],[审核人],[备注],[主管审核],[主管审核人],[经理审核],[经理审核人]
FROM [白件领料单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [领料部门] LIKE @kw OR [领料人] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticWhitePartIssueHeaderDto>()).AsList();
        return new PagedResult<PlasticWhitePartIssueHeaderDto>(items, total);
    }

    public async Task<PlasticWhitePartIssueDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[领料部门],[领料人],[胶箱数],[卡板数],[领料备注],[数量],[操作员],[电脑单号],[审核],[审核人],[备注],[主管审核],[主管审核人],[经理审核],[经理审核人]
FROM [白件领料单] WHERE [单号]=@单号;
SELECT [ID],[发外采购],[生产单号],[款号],[物料编号],[模具编号],[物料名称],[颜色],[用料名称],[单位],[数量],[备注]
FROM [白件领料明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticWhitePartIssueHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticWhitePartIssueLineDto>()).AsList();
        return new PlasticWhitePartIssueDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [白件领料单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的白件领料单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [白件领料明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [白件领料单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
