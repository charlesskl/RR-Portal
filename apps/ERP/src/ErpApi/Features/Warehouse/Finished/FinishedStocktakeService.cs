using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Warehouse.Finished;

// 成品盘点（算法7 盈亏）。两层：成品盘点单 + 成品盘点明细单(单号 主从 FK)。
// BasisAsync 从 FinishedGoodsAsync 取系统数量；写库时按同一口径(款号×色号×颜色×尺码 实时聚合)逐行服务端复算,不信任前端传入值；盈亏=盘点−系统；审核后盈亏入库存(已扩展 UNION)。
// audit 可空(DI 注入;测试不传时不写审计)。
public sealed class FinishedStocktakeService(
    ISqlConnectionFactory factory, IDocumentNumberGenerator docNo, IInventorySummaryService inventory, IAuditLogger? audit = null)
{
    public const string DocType = "成品盘点单";
    public const string Prefix = "CP";

    public async Task<IReadOnlyList<FinishedStocktakeBasisRow>> BasisAsync(string 仓库)
    {
        var inv = await inventory.FinishedGoodsAsync(仓库);
        return inv.Select(r => new FinishedStocktakeBasisRow
        {
            款号 = r.款号, 款式 = r.款式, 色号 = r.色号, 颜色 = r.颜色, 尺码 = r.尺码, 系统数量 = r.库存
        }).ToList();
    }

    // 库存聚合键:款号×色号×颜色×尺码(口径同 FinishedGoodsAsync GROUP BY;空值归一为 "")
    private static (string, string, string, string) 库存键(string? 款号, string? 色号, string? 颜色, string? 尺码)
        => (款号?.Trim() ?? "", 色号?.Trim() ?? "", 颜色?.Trim() ?? "", 尺码?.Trim() ?? "");

    public async Task<string> CreateAsync(FinishedStocktakeCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("成品盘点至少要有一行明细");
        if (dto.明细.Any(l => l.盘点数量 < 0)) throw new ArgumentException("盘点数量不能为负");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("仓库必填");
        var now = DateTime.Now;

        // 系统数量服务端复算(口径同 BasisAsync),不信任前端传入值;无库存行=0
        var 系统数量表 = (await inventory.FinishedGoodsAsync(dto.仓库))
            .ToDictionary(r => 库存键(r.款号, r.色号, r.颜色, r.尺码), r => r.库存);

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [成品盘点单]([单号],[日期],[仓库],[操作员],[审核],[备注])
VALUES(@单号,@日期,@仓库,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.仓库, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
        {
            var 系统数量 = 系统数量表.TryGetValue(库存键(l.款号, l.色号, l.颜色, l.尺码), out var q) ? q : 0m;
            await c.ExecuteAsync(@"
INSERT INTO [成品盘点明细单]([单号],[日期],[仓库],[款号],[款式],[色号],[颜色],[尺码],[系统数量],[盘点数量],[盈亏数量],[审核])
VALUES(@单号,@日期,@仓库,@款号,@款式,@色号,@颜色,@尺码,@系统数量,@盘点数量,@盈亏数量,'0')",
                new
                {
                    单号, 日期 = now, dto.仓库, l.款号, l.款式, l.色号, l.颜色, l.尺码,
                    系统数量, l.盘点数量, 盈亏数量 = l.盘点数量 - 系统数量
                }, tx);
        }

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<FinishedStocktakeHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [成品盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw;
SELECT [ID],[单号],[仓库],[日期],[金额],[操作员],[审核],[审核人],[备注]
FROM [成品盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<FinishedStocktakeHeaderDto>()).AsList();
        return new PagedResult<FinishedStocktakeHeaderDto>(items, total);
    }

    public async Task<FinishedStocktakeDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[仓库],[日期],[金额],[操作员],[审核],[审核人],[备注] FROM [成品盘点单] WHERE [单号]=@单号;
SELECT [ID],[款号],[色号],[颜色],[尺码],[系统数量],[盘点数量],[盈亏数量] FROM [成品盘点明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<FinishedStocktakeHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<FinishedStocktakeLineRowDto>()).AsList();
        return new FinishedStocktakeDetailDto { 单头 = header, 明细 = lines };
    }

    // 审核:一个事务里翻单头审核位 + 同步明细审核位(成品库存按明细.审核过滤盈亏项,两步必须原子;不走 IPostingEngine)。
    // 并发靠单头 UPDLOCK/HOLDLOCK + 同事务回写。
    public async Task<bool> ApproveAsync(string 单号, string user)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [成品盘点单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null || 审核 == "1") return false;
        await c.ExecuteAsync(
            "UPDATE [成品盘点单] SET [审核]='1',[审核人]=@user,[审核日期]=@now WHERE [单号]=@单号",
            new { 单号, user, now = DateTime.Now }, tx);
        await c.ExecuteAsync("UPDATE [成品盘点明细单] SET [审核]='1' WHERE [单号]=@单号", new { 单号 }, tx);
        if (audit is not null) await audit.WriteAsync(DocType, "审核", user, $"单号={单号}", c, tx);
        tx.Commit();
        return true;
    }

    // 反审核:同一事务翻回单头审核位 + 明细审核位清零。
    public async Task<bool> UnapproveAsync(string 单号, string user)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [成品盘点单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null || 审核 != "1") return false;
        await c.ExecuteAsync(
            "UPDATE [成品盘点单] SET [审核]='0',[审核人]=NULL,[审核日期]=NULL WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("UPDATE [成品盘点明细单] SET [审核]='0' WHERE [单号]=@单号", new { 单号 }, tx);
        if (audit is not null) await audit.WriteAsync(DocType, "反审核", user, $"单号={单号}", c, tx);
        tx.Commit();
        return true;
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [成品盘点单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的成品盘点单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [成品盘点明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [成品盘点单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
