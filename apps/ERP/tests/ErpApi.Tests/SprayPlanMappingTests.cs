using ErpApi.Features.Plastics.PlasticPurchaseOrder;
using ErpApi.Integrations.SprayPlan;
using Xunit;

// 喷油部排期系统(sprayplan)字段映射的纯函数测试(不连真服务器)。
public class SprayPlanMappingTests
{
    [Theory]
    [InlineData("喷油部", true)]
    [InlineData("兴信喷油部", true)]
    [InlineData("兴信喷油车间", true)]   // 含「喷油」即推(喷油车间供应商真名)
    [InlineData("兴信A车间", false)]
    [InlineData("东莞市欧格达喷码设备有限公司", false)]   // 喷码≠喷油,不推
    [InlineData(null, false)]
    public void 触发条件(string? 供应商名称, bool 期望)
        => Assert.Equal(期望, SprayPlanMapper.要推送(供应商名称));

    [Theory]
    [InlineData("SP20260907001", 1, "K1", "SP20260907001")]       // 单款号=单号
    [InlineData("SP20260907001", 2, "K1", "SP20260907001-K1")]    // 多款号=单号-款号
    public void 外部订单号(string 单号, int 款号数, string 款号, string 期望)
        => Assert.Equal(期望, SprayPlanMapper.ExternalOrderNo(单号, 款号数, 款号));

    private static PlasticPurchaseOrderHeaderDto 单头() => new()
    {
        单号 = "SP20260907001", 供应商名称 = "喷油部",
        日期 = new DateTime(2026, 9, 7), 交货日期 = new DateTime(2026, 9, 20),
    };

    [Fact]
    public void 单款号分组建单()
    {
        var 明细 = new List<PlasticPurchaseOrderLineDto>
        {
            new() { 款号 = "92125-S001", 物料名称 = "面壳", 数量 = 100.4m },
            new() { 款号 = "92125-S001", 物料名称 = "底壳", 数量 = 99.5m },
        };
        var drafts = SprayPlanMapper.BuildDrafts(单头(), 明细);
        var d = Assert.Single(drafts);
        Assert.Equal("92125-S001", d.ProductNo);
        Assert.Equal("SP20260907001", d.Order.ExternalOrderNo);
        Assert.Equal("2026-09-07", d.Order.OrderDate);
        Assert.Equal("2026-09-20", d.Order.DeliveryDate);
        Assert.Equal("ERP:塑胶采购订单 SP20260907001 供应商 喷油部", d.Order.Remark);
        Assert.Equal(2, d.Order.PartQtys!.Count);
        Assert.Equal("面壳", d.Order.PartQtys[0].PartName);
        Assert.Equal(100, d.Order.PartQtys[0].Qty);      // 四舍五入
        Assert.Equal(1, d.Order.PartQtys[0].PartOrder);
        Assert.Equal(100, d.Order.PartQtys[1].Qty);      // 99.5 → 100(AwayFromZero)
        Assert.Equal(2, d.Order.PartQtys[1].PartOrder);
        // 建产品请求带部位,craft 留空
        Assert.Equal("92125-S001", d.Product.ProductNo);
        Assert.Equal(2, d.Product.Parts!.Count);
        Assert.Equal("面壳", d.Product.Parts[0].PartName);
        Assert.Null(d.Product.Parts[0].Craft);
    }

    [Fact]
    public void 多款号分组_外部订单号带款号后缀()
    {
        var 明细 = new List<PlasticPurchaseOrderLineDto>
        {
            new() { 款号 = "K1", 物料名称 = "A件", 数量 = 10 },
            new() { 款号 = "K2", 物料名称 = "B件", 数量 = 20 },
        };
        var drafts = SprayPlanMapper.BuildDrafts(单头(), 明细);
        Assert.Equal(2, drafts.Count);
        Assert.Equal("SP20260907001-K1", drafts[0].Order.ExternalOrderNo);
        Assert.Equal("SP20260907001-K2", drafts[1].Order.ExternalOrderNo);
        Assert.Single(drafts[0].Order.PartQtys!);
        Assert.Equal(20, drafts[1].Order.PartQtys![0].Qty);
    }

    [Fact]
    public void 交货日期可空()
    {
        var h = 单头(); h.交货日期 = null;
        var d = SprayPlanMapper.BuildDrafts(h, [new PlasticPurchaseOrderLineDto { 款号 = "K1", 物料名称 = "A", 数量 = 1 }]);
        Assert.Null(d[0].Order.DeliveryDate);
    }

    [Fact]
    public void 换号重推_取第一个空闲号()
    {
        // 基础号空闲时从 -R2 开始
        Assert.Equal("SP1-R2", SprayPlanMapper.空闲重推号("SP1", new HashSet<string> { "SP1" }));
        // -R2 被占(含 archived 占号)跳到 -R3
        Assert.Equal("SP1-R3", SprayPlanMapper.空闲重推号("SP1", new HashSet<string> { "SP1", "SP1-R2" }));
        Assert.Equal("SP1-R4", SprayPlanMapper.空闲重推号("SP1",
            new HashSet<string> { "SP1", "SP1-R2", "SP1-R3" }));
    }
}
