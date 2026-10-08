using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Production;

// MO单录入：生产通知单MO单 表的查询 + 整组替换保存（独立于主单据保存）。
public sealed class MoTrackingService(ISqlConnectionFactory factory)
{
    public async Task<List<MoLineDto>> GetAsync(string 生产单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        var rows = await c.QueryAsync<MoLineDto>(@"
SELECT [序号],[接单日期],[正单合同号],[产品货号],[产品名称],[接单数量],
       [装箱方式],[订单总箱数],[验货日期],[备注]
FROM [生产通知单MO单] WHERE [生产单号]=@生产单号 ORDER BY [序号],[ID]",
            new { 生产单号 });
        return rows.AsList();
    }

    // 整组替换：DELETE 该生产单号全部行 → 逐行 INSERT（序号=有效行序）。全空行跳过。事务内原子。
    public async Task SaveAsync(string 生产单号, IReadOnlyList<MoLineDto> rows)
    {
        var valid = rows.Where(r => !(
            string.IsNullOrWhiteSpace(r.正单合同号) &&
            string.IsNullOrWhiteSpace(r.产品货号) &&
            string.IsNullOrWhiteSpace(r.产品名称) &&
            r.接单数量 is null)).ToList();

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        await c.ExecuteAsync("DELETE FROM [生产通知单MO单] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);

        var 序号 = 0;
        foreach (var r in valid)
        {
            序号++;
            await c.ExecuteAsync(@"
INSERT INTO [生产通知单MO单]([生产单号],[序号],[接单日期],[正单合同号],[产品货号],[产品名称],
    [接单数量],[装箱方式],[订单总箱数],[验货日期],[备注])
VALUES(@生产单号,@序号,@接单日期,@正单合同号,@产品货号,@产品名称,
    @接单数量,@装箱方式,@订单总箱数,@验货日期,@备注)",
                new
                {
                    生产单号, 序号, r.接单日期, r.正单合同号, r.产品货号, r.产品名称,
                    r.接单数量, r.装箱方式, r.订单总箱数, r.验货日期, r.备注
                }, tx);
        }

        tx.Commit();
    }
}
