using ErpApi.Engines.Posting;
using Xunit;

public class PostableDocumentsTests
{
    [Fact]
    public void Known_table_is_allowed()
        => Assert.True(PostableDocuments.IsAllowed("成品入仓单"));

    [Fact]
    public void Unknown_or_injection_is_rejected()
    {
        Assert.False(PostableDocuments.IsAllowed("成品入仓单; DROP TABLE x--"));
        Assert.False(PostableDocuments.IsAllowed("不存在的表"));
    }

    [Fact]
    public void DocNoColumn_defaults_to_单号_and_maps_生产制单_to_生产单号()
    {
        Assert.Equal("单号", PostableDocuments.DocNoColumn("成品入仓单"));
        Assert.Equal("单号", PostableDocuments.DocNoColumn("成品客户订货单"));
        Assert.Equal("生产单号", PostableDocuments.DocNoColumn("生产制单"));
    }

    [Fact]
    public void DocNoColumn_throws_for_non_whitelisted_table()
    {
        Assert.Throws<InvalidOperationException>(() => PostableDocuments.DocNoColumn("不存在的表"));
    }

    [Fact]
    public void DocNoColumn_maps_裁床总表_to_裁床单号()
    {
        Assert.Equal("裁床单号", PostableDocuments.DocNoColumn("裁床总表"));
        Assert.True(PostableDocuments.IsAllowed("裁床总表"));
    }
}
