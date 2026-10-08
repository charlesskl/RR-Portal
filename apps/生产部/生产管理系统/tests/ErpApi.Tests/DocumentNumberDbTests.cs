using Dapper;
using ErpApi.Engines.DocumentNumber;
using Xunit;

[Collection("db")]
public class DocumentNumberDbTests(DbFixture fx)
{
    [SkippableFact]
    public async Task Concurrent_requests_produce_unique_numbers()
    {
        var bizDate = new DateTime(2026, 6, 3);
        using (var clean = fx.Open())
            clean.Execute("DELETE FROM [单号流水表] WHERE [单据类型]='TST'");

        var gen = new DocumentNumberGenerator();
        var results = new System.Collections.Concurrent.ConcurrentBag<string>();
        await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => Task.Run(async () =>
        {
            using var c = fx.Open();
            using var tx = c.BeginTransaction();
            results.Add(await gen.NextAsync("TST", "TST", bizDate, c, tx));
            tx.Commit();
        })));

        Assert.Equal(20, results.Distinct().Count()); // 无重复
    }
}
