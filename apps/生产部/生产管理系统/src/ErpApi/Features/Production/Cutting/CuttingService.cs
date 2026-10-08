using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Production.Cutting;

// 裁床单（把生产制单按床/扎/色码裁剪）。两层：裁床总表 + 裁床明细表，按"裁床单号"串联(无主从FK)。
public sealed class CuttingService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "裁床总表";
    public const string Prefix = "CB";   // 裁床单号 = CB + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(CuttingCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("裁床单至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.生产单号)) throw new ArgumentException("生产单号必填");

        var 裁床数量 = dto.明细.Sum(l => l.数量);
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        var 裁床单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [裁床总表]([裁床单号],[生产单号],[货号],[客户编号],[客户名称],[加工厂编号],[加工厂名称],
    [款号],[款式],[客户款号],[合同号],[日期],[床号],[裁床数量],[布种],[操作员],[审核],[备注])
VALUES(@裁床单号,@生产单号,@货号,@客户编号,@客户名称,@加工厂编号,@加工厂名称,
    @款号,@款式,@客户款号,@合同号,@日期,@床号,@裁床数量,@布种,@操作员,'0',@备注)",
            new
            {
                裁床单号, dto.生产单号, dto.货号, dto.客户编号, dto.客户名称, dto.加工厂编号, dto.加工厂名称,
                dto.款号, dto.款式, dto.客户款号, dto.合同号, 日期 = now, dto.床号,
                裁床数量, dto.布种, 操作员 = user, dto.备注
            }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [裁床明细表]([裁床单号],[生产单号],[客户编号],[客户名称],[款号],[款式],[日期],[床号],
    [扎号],[缸号],[颜色],[尺码],[数量],[计件数量],[备注],[有效])
VALUES(@裁床单号,@生产单号,@客户编号,@客户名称,@款号,@款式,@日期,@床号,
    @扎号,@缸号,@颜色,@尺码,@数量,@计件数量,@备注,'1')",
                new
                {
                    裁床单号, dto.生产单号, dto.客户编号, dto.客户名称, dto.款号, dto.款式, 日期 = now, dto.床号,
                    l.扎号, l.缸号, l.颜色, l.尺码, l.数量, 计件数量 = l.计件数量 ?? l.数量, l.备注
                }, tx);

        tx.Commit();
        return 裁床单号;
    }

    public async Task<PagedResult<CuttingHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [裁床总表]
WHERE @kw IS NULL OR [裁床单号] LIKE @kw OR [生产单号] LIKE @kw OR [款号] LIKE @kw OR [床号] LIKE @kw;
SELECT [ID],[裁床单号],[生产单号],[货号],[款号],[款式],[客户名称],[加工厂名称],[日期],[床号],[裁床数量],[布种],[操作员],[审核],[审核人],[备注]
FROM [裁床总表]
WHERE @kw IS NULL OR [裁床单号] LIKE @kw OR [生产单号] LIKE @kw OR [款号] LIKE @kw OR [床号] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<CuttingHeaderDto>()).AsList();
        return new PagedResult<CuttingHeaderDto>(items, total);
    }

    public async Task<CuttingDetailDto?> GetAsync(string 裁床单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[裁床单号],[生产单号],[货号],[款号],[款式],[客户名称],[加工厂名称],[日期],[床号],[裁床数量],[布种],[操作员],[审核],[审核人],[备注]
FROM [裁床总表] WHERE [裁床单号]=@裁床单号;
SELECT [ID],[扎号],[缸号],[颜色],[尺码],[数量],[计件数量],[备注]
FROM [裁床明细表] WHERE [裁床单号]=@裁床单号 ORDER BY [ID];",
            new { 裁床单号 });
        var header = await multi.ReadFirstOrDefaultAsync<CuttingHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<CuttingLineDto>()).AsList();
        return new CuttingDetailDto { 单头 = header, 明细 = lines };
    }

    // 删除：仅未审核可删；裁床单号串联(无FK)，先删明细后删总表
    public async Task<bool> DeleteAsync(string 裁床单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [裁床总表] WHERE [裁床单号]=@裁床单号", new { 裁床单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的裁床单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [裁床明细表] WHERE [裁床单号]=@裁床单号", new { 裁床单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [裁床总表] WHERE [裁床单号]=@裁床单号", new { 裁床单号 }, tx);
        tx.Commit();
        return true;
    }
}
