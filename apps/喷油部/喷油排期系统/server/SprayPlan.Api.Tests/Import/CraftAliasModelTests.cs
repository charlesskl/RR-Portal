using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using Xunit;

namespace SprayPlan.Api.Tests.Import;

// 验证 craft_aliases 表与 product_parts.craftDetail 列能被 EnsureCreated 建出并读写。
public class CraftAliasModelTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    public async Task InitializeAsync() { _factory = new ApiFactory(); await _factory.SeedAsync(); }
    public Task DisposeAsync() { _factory.Dispose(); return Task.CompletedTask; }

    [Fact]
    public async Task CraftAlias_And_CraftDetail_Persist()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.CraftAliases.Add(new CraftAlias { Alias = "散枪", Category = "手喷", CreatedAt = DateTime.UtcNow });
        var p = new Product { ProductNo = "T1", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            Items = { new ProductItem { ItemName = "主体", Parts = { new ProductPart { PartName = "头", Craft = "手喷", CraftDetail = "散枪" } } } } };
        db.Products.Add(p);
        await db.SaveChangesAsync();

        var alias = await db.CraftAliases.SingleAsync(x => x.Alias == "散枪");
        Assert.Equal("手喷", alias.Category);
        var part = await db.ProductParts.SingleAsync(x => x.PartName == "头");
        Assert.Equal("散枪", part.CraftDetail);
    }
}
