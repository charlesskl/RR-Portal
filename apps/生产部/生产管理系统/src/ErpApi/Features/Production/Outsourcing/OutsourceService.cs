using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Production.Outsourcing;

// 发外派工（把生产制单按 加工厂×加工项目×色码 发给加工厂）。两层：发外加工单 + 发外加工明细单(单号 主从 FK)。
// 单价取自 发外加工项目.单价（服务端查，不信任前端）；金额=数量×单价。
public sealed class OutsourceService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "发外加工单";
    public const string Prefix = "FW";   // 发外加工单号 = FW + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(OutsourceCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("发外派工至少要有一行明细");
        if (string.IsNullOrWhiteSpace(dto.加工厂编号)) throw new ArgumentException("加工厂必填");
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        var 行 = new List<(OutsourceLineDto l, decimal price)>();
        foreach (var l in dto.明细)
        {
            if (string.IsNullOrWhiteSpace(l.加工项目)) throw new ArgumentException("加工项目必填");
            if (l.数量 <= 0) throw new ArgumentException("发外数量必须大于0");
            var price = await c.ExecuteScalarAsync<decimal?>(
                "SELECT TOP 1 [单价] FROM [发外加工项目] WHERE [加工项目]=@加工项目", new { l.加工项目 }, tx);
            if (price is null) throw new ArgumentException($"加工项目 [{l.加工项目}] 不在发外加工项目费率表中");
            行.Add((l, price.Value));
        }
        var 数量 = 行.Sum(x => x.l.数量);
        var 金额 = 行.Sum(x => x.l.数量 * x.price);

        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [发外加工单]([单号],[日期],[加工厂编号],[加工厂名称],[付款方式],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@加工厂编号,@加工厂名称,@付款方式,@仓库,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.加工厂编号, dto.加工厂名称, dto.付款方式, dto.仓库, 数量, 金额, 操作员 = user, dto.备注 }, tx);

        foreach (var (l, price) in 行)
            await c.ExecuteAsync(@"
INSERT INTO [发外加工明细单]([单号],[日期],[加工厂编号],[加工厂名称],[仓库],[生产单号],[款号],[款式],[床号],
    [加工项目],[色号],[颜色],[尺码],[数量],[单价],[金额],[审核])
VALUES(@单号,@日期,@加工厂编号,@加工厂名称,@仓库,@生产单号,@款号,@款式,@床号,
    @加工项目,@色号,@颜色,@尺码,@数量,@单价,@金额,'0')",
                new
                {
                    单号, 日期 = now, dto.加工厂编号, dto.加工厂名称, dto.仓库, dto.生产单号, dto.款号, dto.款式, dto.床号,
                    l.加工项目, l.色号, l.颜色, l.尺码, l.数量, 单价 = price, 金额 = l.数量 * price
                }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<OutsourceHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [发外加工单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [加工厂编号] LIKE @kw OR [加工厂名称] LIKE @kw;
SELECT [ID],[单号],[加工厂编号],[加工厂名称],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [发外加工单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [加工厂编号] LIKE @kw OR [加工厂名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<OutsourceHeaderDto>()).AsList();
        return new PagedResult<OutsourceHeaderDto>(items, total);
    }

    public async Task<OutsourceDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[加工厂编号],[加工厂名称],[仓库],[日期],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [发外加工单] WHERE [单号]=@单号;
SELECT [ID],[生产单号],[款号],[加工项目],[色号],[颜色],[尺码],[数量],[单价],[金额]
FROM [发外加工明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<OutsourceHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<OutsourceLineRowDto>()).AsList();
        return new OutsourceDetailDto { 单头 = header, 明细 = lines };
    }

    // 删除：仅未审核可删；单号 主从 FK，先删明细后删单头
    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [发外加工单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的发外派工单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [发外加工明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [发外加工单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }

    // 对数（只读聚合）：按 款号×加工项目 归集该发外单的 发外/回收/相差/金额。
    // 发外数量取派工明细(单头审核'1')；回收数量取回收明细(回收单头审核'1')；金额=回收数量×派工单价。
    public async Task<IReadOnlyList<OutsourceReconcileRow>> ReconcileAsync(string 发外单号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<OutsourceReconcileRow>(@"
SELECT d.[款号], MAX(d.[款式]) AS 款式, d.[加工项目],
       SUM(d.[数量]) AS 发外数量,
       ISNULL(r.[回收数量],0) AS 回收数量,
       SUM(d.[数量]) - ISNULL(r.[回收数量],0) AS 相差数量,
       MAX(d.[单价]) AS 单价,
       ISNULL(r.[回收数量],0) * MAX(d.[单价]) AS 金额
FROM [发外加工明细单] d
JOIN [发外加工单] h ON h.[单号]=d.[单号] AND ISNULL(h.[审核],'0')='1'
LEFT JOIN (
    SELECT rd.[款号], rd.[加工项目], SUM(rd.[数量]) AS 回收数量
    FROM [发外回收明细单] rd
    JOIN [发外回收单] rh ON rh.[单号]=rd.[单号] AND ISNULL(rh.[审核],'0')='1'
    WHERE rd.[发外单号]=@发外单号
    GROUP BY rd.[款号], rd.[加工项目]
) r ON r.[款号]=d.[款号] AND r.[加工项目]=d.[加工项目]
WHERE d.[单号]=@发外单号
GROUP BY d.[款号], d.[加工项目], r.[回收数量]
ORDER BY d.[款号], d.[加工项目]", new { 发外单号 });
        return rows.AsList();
    }
}
