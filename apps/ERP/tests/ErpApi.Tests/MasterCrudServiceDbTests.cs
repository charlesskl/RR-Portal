using ErpApi.Data;
using ErpApi.Data.Entities;
using ErpApi.Features.MasterData;
using Microsoft.EntityFrameworkCore;
using Xunit;

[Collection("db")]
public class MasterCrudServiceDbTests(DbFixture fx)
{
    private (ErpDbContext db, MasterCrudService<客户资料> svc) Make()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var db = new ErpDbContext(new DbContextOptionsBuilder<ErpDbContext>()
            .UseSqlServer(fx.ConnectionString!).Options);
        db.客户资料.RemoveRange(db.客户资料.Where(c => c.客户编号!.StartsWith("CRUD")));
        db.SaveChanges();
        return (db, new MasterCrudService<客户资料>(db));
    }

    [SkippableFact]
    public async Task Create_get_update_delete_roundtrip()
    {
        var (db, svc) = Make();
        var created = await svc.CreateAsync(new 客户资料 { 客户编号 = "CRUD1", 客户名称 = "甲", 客户类别 = "A" });
        Assert.True(created.ID > 0);

        var got = await svc.GetAsync(created.ID);
        Assert.Equal("甲", got!.客户名称);

        got.客户名称 = "乙";
        Assert.True(await svc.UpdateAsync(created.ID, got));
        Assert.Equal("乙", (await svc.GetAsync(created.ID))!.客户名称);

        Assert.True(await svc.DeleteAsync(created.ID));
        Assert.Null(await svc.GetAsync(created.ID));
        db.Dispose();
    }

    [SkippableFact]
    public async Task List_paging_and_keyword()
    {
        var (db, svc) = Make();
        for (int i = 0; i < 3; i++)
            await svc.CreateAsync(new 客户资料 { 客户编号 = $"CRUD{i}", 客户名称 = $"模糊匹配{i}", 客户类别 = "A" });

        var page = await svc.ListAsync(1, 2, "模糊匹配");
        Assert.Equal(3, page.Total);
        Assert.Equal(2, page.Items.Count);

        var none = await svc.ListAsync(1, 20, "不存在的关键字XYZ");
        Assert.Equal(0, none.Total);
        db.Dispose();
    }
}
