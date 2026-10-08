using ErpApi.Data;
using ErpApi.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Xunit;

[Collection("db")]
public class ErpDbContextDbTests(DbFixture fx)
{
    private ErpDbContext Ctx()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var opts = new DbContextOptionsBuilder<ErpDbContext>()
            .UseSqlServer(fx.ConnectionString!).Options;
        return new ErpDbContext(opts);
    }

    [SkippableFact]
    public async Task Insert_then_read_customer()
    {
        using var db = Ctx();
        var existing = await db.客户资料.Where(c => c.客户编号 == "P1T").ToListAsync();
        db.客户资料.RemoveRange(existing);
        await db.SaveChangesAsync();

        db.客户资料.Add(new 客户资料 { 客户编号 = "P1T", 客户名称 = "测试客户", 客户类别 = "甲" });
        await db.SaveChangesAsync();

        var got = await db.客户资料.SingleAsync(c => c.客户编号 == "P1T");
        Assert.Equal("测试客户", got.客户名称);
        Assert.True(got.ID > 0);
    }
}
