using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Features.Products;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Tests;

public class ProductImportTests
{
    [Fact]
    public async Task 产品级核价可以预览并导入全部价格字段()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db = new AppDbContext(options);
        var service = new ProductImportService(db, new FakeCurrentUser());
        var input = new ImportRowInput(
            4, "ZURU", "15752", "布偶猫", 2.68m, 2.18m, 2.18m, 2.34m, "测试导入");

        var preview = await service.PreviewAsync(1, [input]);

        var row = Assert.Single(preview.Rows);
        Assert.Equal("ok", row.Status);
        Assert.True(row.WillCreateProduct);
        Assert.Equal(1, preview.WillWriteCount);

        var result = await service.CommitAsync(new ImportCommitReq(1,
            [new ImportCommitRow(4, "ZURU", "15752", "布偶猫", 2.68m, 2.18m, 2.18m, 2.34m, "测试导入", true)]));

        Assert.Equal(1, result.CreatedProducts);
        Assert.Equal(1, result.WrittenQuotes);
        var product = await db.Products.SingleAsync();
        var quote = await db.ProductQuotes.SingleAsync();
        Assert.Equal("15752", product.SeriesCode);
        Assert.Equal("布偶猫", product.ProductName);
        Assert.Equal("ZURU", quote.CustomerName);
        Assert.Equal(2.68m, quote.CustomerQuoteExcl);
        Assert.Equal(2.18m, quote.InternalPriceExcl);
        Assert.Equal(2.18m, quote.DongguanPriceExcl);
        Assert.Equal(2.34m, quote.HunanPriceExcl);
        Assert.Equal("测试导入", quote.Remark);
    }

    private sealed class FakeCurrentUser : ICurrentUser
    {
        public int? UserId => 1;
        public int? DeptId => 1;
        public string? Username => "admin";
        public string? Userbqrpower => null;
        public string? Role => "管理员";
    }
}
