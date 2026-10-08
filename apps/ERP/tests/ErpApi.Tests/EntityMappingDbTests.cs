using ErpApi.Data;
using ErpApi.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Xunit;

[Collection("db")]
public class EntityMappingDbTests(DbFixture fx)
{
    private ErpDbContext Ctx()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        return new ErpDbContext(new DbContextOptionsBuilder<ErpDbContext>()
            .UseSqlServer(fx.ConnectionString!).Options);
    }

    [SkippableFact]
    public async Task All_entities_query_without_mapping_error()
    {
        using var db = Ctx();
        _ = await db.供应商类别.Take(1).ToListAsync();
        _ = await db.供应商资料.Take(1).ToListAsync();
        _ = await db.加工厂类别.Take(1).ToListAsync();
        _ = await db.加工厂资料.Take(1).ToListAsync();
        _ = await db.物料类别.Take(1).ToListAsync();
        _ = await db.物料资料.Take(1).ToListAsync();
        _ = await db.部门信息.Take(1).ToListAsync();
        _ = await db.人事档案.Take(1).ToListAsync();
        _ = await db.报价类别.Take(1).ToListAsync();
        _ = await db.报价资料.Take(1).ToListAsync();
        _ = await db.款号总表.Take(1).ToListAsync();
        _ = await db.款号明细表.Take(1).ToListAsync();
        _ = await db.款号物料明细表.Take(1).ToListAsync();
        Assert.True(true);
    }
}
