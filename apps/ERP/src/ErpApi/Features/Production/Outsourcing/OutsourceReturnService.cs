using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Production.Outsourcing;

// 发外回收（加工厂交回成品）。两层：发外回收单 + 发外回收明细单(单号 主从 FK)。
// 按 发外单号 关联派工(无 FK，约定串联)；欠数=该(发外单+加工项目+颜色+尺码)发外数量−累计已审核回收。
public sealed class OutsourceReturnService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "发外回收单";
    public const string Prefix = "FH";   // 发外回收单号 = FH + yyyyMMdd + 3位流水

    // 带出基准：派工明细(单头审核'1')按(生产单,款,项目,色号,颜色,尺码)汇总发外数量，减累计已审核回收=欠数
    public async Task<IReadOnlyList<OutsourceReturnBasisRow>> BasisAsync(string 发外单号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<OutsourceReturnBasisRow>(@"
SELECT d.[生产单号], d.[款号], MAX(d.[款式]) AS 款式, d.[加工项目], d.[色号], d.[颜色], d.[尺码],
       SUM(d.[数量]) AS 发外数量,
       ISNULL(r.[已回收],0) AS 已回收,
       SUM(d.[数量]) - ISNULL(r.[已回收],0) AS 欠数,
       MAX(d.[单价]) AS 单价
FROM [发外加工明细单] d
JOIN [发外加工单] h ON h.[单号]=d.[单号] AND ISNULL(h.[审核],'0')='1'
LEFT JOIN (
    SELECT rd.[款号], rd.[加工项目], ISNULL(rd.[颜色],'') AS 颜色k, ISNULL(rd.[尺码],'') AS 尺码k, SUM(rd.[数量]) AS 已回收
    FROM [发外回收明细单] rd
    JOIN [发外回收单] rh ON rh.[单号]=rd.[单号] AND ISNULL(rh.[审核],'0')='1'
    WHERE rd.[发外单号]=@发外单号
    GROUP BY rd.[款号], rd.[加工项目], ISNULL(rd.[颜色],''), ISNULL(rd.[尺码],'')
) r ON r.[款号]=d.[款号] AND r.[加工项目]=d.[加工项目]
      AND r.[颜色k]=ISNULL(d.[颜色],'') AND r.[尺码k]=ISNULL(d.[尺码],'')
WHERE d.[单号]=@发外单号
GROUP BY d.[生产单号], d.[款号], d.[加工项目], d.[色号], d.[颜色], d.[尺码], r.[已回收]
ORDER BY d.[款号], d.[加工项目], d.[颜色], d.[尺码]", new { 发外单号 });
        return rows.AsList();
    }

    public async Task<string> CreateAsync(OutsourceReturnCreateDto dto, string user)
    {
        var 明细 = dto.明细.Where(l => l.回收数量 > 0).ToList();
        if (明细.Count == 0) throw new ArgumentException("回收至少要有一行回收数量大于0的明细");
        if (string.IsNullOrWhiteSpace(dto.发外单号)) throw new ArgumentException("发外单号必填");
        if (string.IsNullOrWhiteSpace(dto.加工厂编号)) throw new ArgumentException("加工厂必填");
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        var 发外审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [发外加工单] WHERE [单号]=@发外单号", new { dto.发外单号 }, tx);
        if (发外审核 is null) throw new ArgumentException($"发外单 [{dto.发外单号}] 不存在");
        if (发外审核 != "1") throw new ArgumentException($"发外单 [{dto.发外单号}] 未审核，不能回收");

        var 回收单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);
        var 发外数量合计 = 明细.Sum(l => l.发外数量);
        var 回收数量合计 = 明细.Sum(l => l.回收数量);

        var lines = new List<(OutsourceReturnLineDto l, decimal price, decimal owed)>();
        foreach (var l in 明细)
        {
            var price = await c.ExecuteScalarAsync<decimal?>(@"
SELECT TOP 1 [单价] FROM [发外加工明细单]
WHERE [单号]=@发外单号 AND [加工项目]=@加工项目 AND ISNULL([颜色],'')=ISNULL(@颜色,'') AND ISNULL([尺码],'')=ISNULL(@尺码,'')",
                new { dto.发外单号, l.加工项目, l.颜色, l.尺码 }, tx);
            if (price is null)
                throw new ArgumentException($"回收明细 [{l.加工项目} {l.颜色} {l.尺码}] 在发外单 [{dto.发外单号}] 中找不到对应派工行");
            var 已回收 = await c.ExecuteScalarAsync<decimal?>(@"
SELECT ISNULL(SUM(rd.[数量]),0) FROM [发外回收明细单] rd
JOIN [发外回收单] rh ON rh.[单号]=rd.[单号] AND ISNULL(rh.[审核],'0')='1'
WHERE rd.[发外单号]=@发外单号 AND rd.[加工项目]=@加工项目
  AND ISNULL(rd.[颜色],'')=ISNULL(@颜色,'') AND ISNULL(rd.[尺码],'')=ISNULL(@尺码,'')",
                new { dto.发外单号, l.加工项目, l.颜色, l.尺码 }, tx) ?? 0m;
            var owed = l.发外数量 - (已回收 + l.回收数量);
            lines.Add((l, price.Value, owed));
        }

        await c.ExecuteAsync(@"
INSERT INTO [发外回收单]([单号],[发外单号],[日期],[加工厂编号],[加工厂名称],[仓库],[发外数量],[回收数量],[相差数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@发外单号,@日期,@加工厂编号,@加工厂名称,@仓库,@发外数量,@回收数量,@相差数量,@金额,@操作员,'0',@备注)",
            new
            {
                单号 = 回收单号, dto.发外单号, 日期 = now, dto.加工厂编号, dto.加工厂名称, dto.仓库,
                发外数量 = 发外数量合计, 回收数量 = 回收数量合计, 相差数量 = 发外数量合计 - 回收数量合计,
                金额 = lines.Sum(x => x.l.回收数量 * x.price), 操作员 = user, dto.备注
            }, tx);

        foreach (var (l, price, owed) in lines)
            await c.ExecuteAsync(@"
INSERT INTO [发外回收明细单]([单号],[发外单号],[日期],[加工厂编号],[加工厂名称],[仓库],[生产单号],[款号],[款式],
    [加工项目],[色号],[颜色],[尺码],[发外数量],[数量],[欠数],[单价],[金额],[审核])
VALUES(@单号,@发外单号,@日期,@加工厂编号,@加工厂名称,@仓库,@生产单号,@款号,@款式,
    @加工项目,@色号,@颜色,@尺码,@发外数量,@数量,@欠数,@单价,@金额,'0')",
                new
                {
                    单号 = 回收单号, dto.发外单号, 日期 = now, dto.加工厂编号, dto.加工厂名称, dto.仓库,
                    l.生产单号, l.款号, l.款式, l.加工项目, l.色号, l.颜色, l.尺码,
                    l.发外数量, 数量 = l.回收数量, 欠数 = owed, 单价 = price, 金额 = l.回收数量 * price
                }, tx);

        tx.Commit();
        return 回收单号;
    }

    public async Task<PagedResult<OutsourceReturnHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [发外回收单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [发外单号] LIKE @kw OR [加工厂名称] LIKE @kw;
SELECT [ID],[单号],[发外单号],[加工厂编号],[加工厂名称],[日期],[发外数量],[回收数量],[相差数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [发外回收单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [发外单号] LIKE @kw OR [加工厂名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<OutsourceReturnHeaderDto>()).AsList();
        return new PagedResult<OutsourceReturnHeaderDto>(items, total);
    }

    public async Task<OutsourceReturnDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[发外单号],[加工厂编号],[加工厂名称],[日期],[发外数量],[回收数量],[相差数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [发外回收单] WHERE [单号]=@单号;
SELECT [ID],[款号],[加工项目],[颜色],[尺码],[发外数量],[数量],[欠数],[单价],[金额]
FROM [发外回收明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<OutsourceReturnHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<OutsourceReturnLineRowDto>()).AsList();
        return new OutsourceReturnDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [发外回收单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的发外回收单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [发外回收明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [发外回收单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
