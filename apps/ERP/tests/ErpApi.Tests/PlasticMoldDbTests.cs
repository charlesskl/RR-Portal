using ErpApi.Data;
using ErpApi.Data.Entities;
using ErpApi.Features.MasterData;
using Microsoft.EntityFrameworkCore;
using Xunit;

[Collection("db")]
public class PlasticMoldDbTests(DbFixture fx)
{
    private (ErpDbContext db, MasterCrudService<工模表> svc) Make()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var db = new ErpDbContext(new DbContextOptionsBuilder<ErpDbContext>()
            .UseSqlServer(fx.ConnectionString!).Options);
        db.工模表.RemoveRange(db.工模表.Where(m => m.工模编号!.StartsWith("MT-CRUD")));
        db.SaveChanges();
        return (db, new MasterCrudService<工模表>(db));
    }

    [SkippableFact]
    public async Task Create_get_update_delete_roundtrip()
    {
        var (db, svc) = Make();
        var created = await svc.CreateAsync(new 工模表
        {
            工模编号 = "MT-CRUD1", 工模名称 = "车头壳模", 颜色 = "绿色/7481C", 色粉号 = "GF01",
            整啤模腔数 = 4, 水口比例 = 0.1m, 模具日产量 = 5000, 整啤毛重 = 120, 整啤净重 = 108,
            啤机机型 = "120T", 啤机价钱 = 300, 胶件啤工价 = 0.5m, 用料名称 = "ABS",
            胶料单价 = 12, 原胶料单价 = 11, 备注 = "测试",
        });
        Assert.True(created.ID > 0);

        var got = await svc.GetAsync(created.ID);
        Assert.Equal("MT-CRUD1", got!.工模编号);
        Assert.Equal("绿色/7481C", got.颜色);
        Assert.Equal(4m, got.整啤模腔数);
        Assert.Equal(0.1m, got.水口比例);
        Assert.Equal(5000m, got.模具日产量);
        Assert.Equal(120m, got.整啤毛重);
        Assert.Equal(108m, got.整啤净重);
        Assert.Equal("120T", got.啤机机型);
        Assert.Equal(300m, got.啤机价钱);
        Assert.Equal(0.5m, got.胶件啤工价);
        Assert.Equal(12m, got.胶料单价);
        Assert.Equal(11m, got.原胶料单价);

        got.工模名称 = "车头壳模改"; got.胶料单价 = 13;
        Assert.True(await svc.UpdateAsync(created.ID, got));
        var after = await svc.GetAsync(created.ID);
        Assert.Equal("车头壳模改", after!.工模名称);
        Assert.Equal(13m, after.胶料单价);

        Assert.True(await svc.DeleteAsync(created.ID));
        Assert.Null(await svc.GetAsync(created.ID));
        db.Dispose();
    }

    [SkippableFact]
    public async Task List_keyword_matches_编号与名称()
    {
        var (db, svc) = Make();
        await svc.CreateAsync(new 工模表 { 工模编号 = "MT-CRUD2", 工模名称 = "模糊匹配模" });

        var page = await svc.ListAsync(1, 20, "MT-CRUD2");
        Assert.Contains(page.Items, m => m.工模编号 == "MT-CRUD2");
        var byName = await svc.ListAsync(1, 20, "模糊匹配模");
        Assert.Contains(byName.Items, m => m.工模编号 == "MT-CRUD2");

        db.工模表.RemoveRange(db.工模表.Where(m => m.工模编号!.StartsWith("MT-CRUD")));
        await db.SaveChangesAsync();
        db.Dispose();
    }
}
