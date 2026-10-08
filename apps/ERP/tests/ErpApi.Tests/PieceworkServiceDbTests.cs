using Dapper;
using ErpApi.Features.Production.Piecework;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PieceworkServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PieceworkService Svc() => new(Factory());

    private static PieceworkRecordDto Dto() => new()
    {
        生产单号 = P4TestData.生产单号, 床号 = "1",
        明细 =
        [
            new PieceworkLineDto { 工序号 = "02", 货号 = P4TestData.货号, 员工号 = P4TestData.员工号, 颜色 = "黑色", 尺码 = "M", 数量 = 40 },
            new PieceworkLineDto { 工序号 = "02", 货号 = P4TestData.货号, 员工号 = P4TestData.员工号, 颜色 = "白色", 尺码 = "L", 数量 = 30 },
        ]
    };

    [SkippableFact]
    public async Task Record_takes_price_from_process_and_computes_amount()
    {
        using var c = fx.Open();
        P4TestData.Seed(c);
        try
        {
            var n = await Svc().RecordAsync(Dto(), "tester");
            Assert.Equal(2, n);
            Assert.Equal(2.5m, c.ExecuteScalar<decimal>(
                "SELECT TOP 1 [单价] FROM [计件表] WHERE [生产单号]=@s AND [工序号]='02'", new { s = P4TestData.生产单号 }));
            Assert.Equal(100m, c.ExecuteScalar<decimal>(
                "SELECT [金额] FROM [计件表] WHERE [生产单号]=@s AND [数量]=40", new { s = P4TestData.生产单号 }));
            Assert.Equal("0", c.ExecuteScalar<string>(
                "SELECT TOP 1 [审核] FROM [计件表] WHERE [生产单号]=@s", new { s = P4TestData.生产单号 }));
        }
        finally { P4TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Record_rejects_process_not_in_order()
    {
        using var c = fx.Open();
        P4TestData.Seed(c);
        try
        {
            var dto = Dto();
            dto.明细 = [ new PieceworkLineDto { 工序号 = "99", 员工号 = P4TestData.员工号, 数量 = 10 } ];
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().RecordAsync(dto, "tester"));
        }
        finally { P4TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task Record_with_扎号_reads_back_without_cast_error()
    {
        using var c = fx.Open();
        P4TestData.Seed(c);
        try
        {
            await Svc().RecordAsync(new PieceworkRecordDto
            {
                生产单号 = P4TestData.生产单号,
                明细 = [ new PieceworkLineDto { 工序号 = "02", 货号 = P4TestData.货号, 员工号 = P4TestData.员工号, 扎号 = 5, 数量 = 10 } ]
            }, "tester");
            var rows = await Svc().ListByOrderAsync(P4TestData.生产单号);
            Assert.Equal(5, Assert.Single(rows).扎号);
        }
        finally { P4TestData.Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_Approve_Delete_and_Summary()
    {
        using var c = fx.Open();
        P4TestData.Seed(c);
        try
        {
            await Svc().RecordAsync(Dto(), "tester");
            var rows = await Svc().ListByOrderAsync(P4TestData.生产单号);
            Assert.Equal(2, rows.Count);
            Assert.Equal("车缝", rows[0].工序名称);
            Assert.Equal("张三", rows[0].姓名);

            // 汇总前未审核 → 空（汇总只认已审核）
            Assert.Empty(await Svc().SummaryAsync(P4TestData.生产单号));

            // 批量审核 → 汇总出现：员工P4E01 车缝 数量70 金额175
            var approved = await Svc().ApproveByOrderAsync(P4TestData.生产单号, "tester");
            Assert.Equal(2, approved);
            var sum = await Svc().SummaryAsync(P4TestData.生产单号);
            var row = Assert.Single(sum);
            Assert.Equal(P4TestData.员工号, row.员工号);
            Assert.Equal(70m, row.数量);
            Assert.Equal(175m, row.金额);

            // 已审核计件不可删
            var first = (await Svc().ListByOrderAsync(P4TestData.生产单号))[0];
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(first.ID));
        }
        finally { P4TestData.Cleanup(c); }
    }

    // 一单多货号：同一工序号(02车缝)在货号P4H01单价2.5、货号P4H02单价3.5。
    // 计件单价必须按 生产单号+货号+工序号 取，而非仅 生产单号+工序号(否则歧义)。
    [SkippableFact]
    public async Task Record_price_disambiguated_by_货号()
    {
        using var c = fx.Open();
        P4TestData.Seed(c);
        try
        {
            await Svc().RecordAsync(new PieceworkRecordDto
            {
                生产单号 = P4TestData.生产单号,
                明细 =
                [
                    new PieceworkLineDto { 工序号 = "02", 货号 = P4TestData.货号,  员工号 = P4TestData.员工号, 数量 = 10 }, // 单价2.5 → 金额25
                    new PieceworkLineDto { 工序号 = "02", 货号 = P4TestData.货号B, 员工号 = P4TestData.员工号, 数量 = 10 }, // 单价3.5 → 金额35
                ]
            }, "tester");

            Assert.Equal(2.5m, c.ExecuteScalar<decimal>(
                "SELECT [单价] FROM [计件表] WHERE [生产单号]=@s AND [货号]=@h",
                new { s = P4TestData.生产单号, h = P4TestData.货号 }));
            Assert.Equal(25m, c.ExecuteScalar<decimal>(
                "SELECT [金额] FROM [计件表] WHERE [生产单号]=@s AND [货号]=@h",
                new { s = P4TestData.生产单号, h = P4TestData.货号 }));
            Assert.Equal(3.5m, c.ExecuteScalar<decimal>(
                "SELECT [单价] FROM [计件表] WHERE [生产单号]=@s AND [货号]=@h",
                new { s = P4TestData.生产单号, h = P4TestData.货号B }));
            Assert.Equal(35m, c.ExecuteScalar<decimal>(
                "SELECT [金额] FROM [计件表] WHERE [生产单号]=@s AND [货号]=@h",
                new { s = P4TestData.生产单号, h = P4TestData.货号B }));
        }
        finally { P4TestData.Cleanup(c); }
    }
}
