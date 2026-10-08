using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Warehouse.Finished;

// 成品退货（客户退回，入仓库 +）。两层：成品退货单 + 成品退货明细单(单号 主从 FK)。
// audit 可空(DI 注入;测试不传时不写审计)。
public sealed class FinishedSalesReturnService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo, IAuditLogger? audit = null)
{
    public const string DocType = "成品退货单";
    public const string Prefix = "TH";

    // 从原成品出仓明细单带出退货基准（首版不做累计已退校验）
    public async Task<IReadOnlyList<FinishedSalesReturnBasisRow>> BasisAsync(string 出仓单号)
    {
        using var c = factory.Create();
        return (await c.QueryAsync<FinishedSalesReturnBasisRow>(@"
SELECT [客户编号],[客户名称],[仓库],[生产单号],[款号],[款式],[床号],[色号],[颜色],[尺码],[数量],[单价]
FROM [成品出仓明细单] WHERE [单号]=@出仓单号 ORDER BY [ID]", new { 出仓单号 })).AsList();
    }

    public async Task<string> CreateAsync(FinishedSalesReturnCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("成品退货至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("仓库必填");
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [成品退货单]([单号],[日期],[客户编号],[客户名称],[仓库],[操作员],[审核],[备注])
VALUES(@单号,@日期,@客户编号,@客户名称,@仓库,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.客户编号, dto.客户名称, dto.仓库, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [成品退货明细单]([单号],[出仓单号],[日期],[客户编号],[客户名称],[仓库],[生产单号],[款号],[款式],[床号],[色号],[颜色],[尺码],[数量],[单价],[金额],[审核])
VALUES(@单号,@出仓单号,@日期,@客户编号,@客户名称,@仓库,@生产单号,@款号,@款式,@床号,@色号,@颜色,@尺码,@数量,@单价,@金额,'0')",
                new
                {
                    单号, dto.出仓单号, 日期 = now, dto.客户编号, dto.客户名称, dto.仓库,
                    dto.生产单号, dto.款号, dto.款式, dto.床号, l.色号, l.颜色, l.尺码,
                    l.数量, 单价 = l.单价 ?? 0m, 金额 = l.数量 * (l.单价 ?? 0m)
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<FinishedSalesReturnHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [成品退货单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [客户名称] LIKE @kw;
SELECT [ID],[单号],[客户名称],[仓库],[日期],[操作员],[审核],[审核人],[备注]
FROM [成品退货单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [客户名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<FinishedSalesReturnHeaderDto>()).AsList();
        return new PagedResult<FinishedSalesReturnHeaderDto>(items, total);
    }

    public async Task<FinishedSalesReturnDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[客户名称],[仓库],[日期],[操作员],[审核],[审核人],[备注] FROM [成品退货单] WHERE [单号]=@单号;
SELECT [ID],[款号],[色号],[颜色],[尺码],[数量],[单价],[金额] FROM [成品退货明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<FinishedSalesReturnHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<FinishedSalesReturnLineRowDto>()).AsList();
        return new FinishedSalesReturnDetailDto { 单头 = header, 明细 = lines };
    }

    // 审核:一个事务里翻单头审核位 + 同步明细审核位(成品库存按明细.审核过滤入仓项,两步必须原子;不走 IPostingEngine)。
    // 并发靠单头 UPDLOCK/HOLDLOCK + 同事务回写。
    public async Task<bool> ApproveAsync(string 单号, string user)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [成品退货单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null || 审核 == "1") return false;
        await c.ExecuteAsync(
            "UPDATE [成品退货单] SET [审核]='1',[审核人]=@user,[审核日期]=@now WHERE [单号]=@单号",
            new { 单号, user, now = DateTime.Now }, tx);
        await c.ExecuteAsync("UPDATE [成品退货明细单] SET [审核]='1' WHERE [单号]=@单号", new { 单号 }, tx);
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
            "SELECT ISNULL([审核],'0') FROM [成品退货单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null || 审核 != "1") return false;
        await c.ExecuteAsync(
            "UPDATE [成品退货单] SET [审核]='0',[审核人]=NULL,[审核日期]=NULL WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("UPDATE [成品退货明细单] SET [审核]='0' WHERE [单号]=@单号", new { 单号 }, tx);
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
            "SELECT ISNULL([审核],'0') FROM [成品退货单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的成品退货单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [成品退货明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [成品退货单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
