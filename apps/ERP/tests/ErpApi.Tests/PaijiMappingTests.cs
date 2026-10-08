using ErpApi.Features.Plastics.PlasticPurchaseOrder;
using ErpApi.Integrations.Paiji;
using Xunit;

// 排产系统字段映射与换算的纯函数测试(不碰 HTTP/DB)。
public class PaijiMappingTests
{
    [Theory]
    [InlineData("兴信A车间", "AT")]     // 兴信A 已断开正式A车间,接入测试版
    [InlineData("兴信A(测试版)", "AT")] // 测试车间(排产系统 workshop=AT)
    [InlineData("兴信装配A车间", "A")]  // 不含「兴信A」子串,仍归 A
    [InlineData("兴信B车间", "B")]
    [InlineData("兴信装配B车间", "B")]
    [InlineData("东莞华登塑胶制品有限公司", "C")]
    [InlineData("华登（河源）玩具制品有限公司", "C")]
    [InlineData("某某外发供应商", "W")]  // 其余归外发部
    [InlineData(null, "W")]
    public void 车间映射(string? 供应商名称, string 期望)
        => Assert.Equal(期望, PaijiMapper.车间(供应商名称));

    [Theory]
    [InlineData(100, 6, 17)]    // ceil(100/6)=17
    [InlineData(100, 5, 20)]    // 整除不取上整
    [InlineData(100, null, 100)] // 套数空 → 数量
    [InlineData(100, 0, 100)]    // 套数 0 → 数量
    [InlineData(1, 6, 1)]
    public void 需啤数换算(decimal 数量, int? 套数, long 期望)
        => Assert.Equal(期望, PaijiMapper.需啤数(数量, 套数));

    [Fact]
    public void 啤重优先整啤净重()
        => Assert.Equal(150m, PaijiMapper.啤重G(new PaijiMaterialInfo { 整啤净重 = 150m, 原胶件单净重 = 25m }));

    [Fact]
    public void 啤重回落原胶件单净重()
        => Assert.Equal(25m, PaijiMapper.啤重G(new PaijiMaterialInfo { 整啤净重 = null, 原胶件单净重 = 25m }));

    [Fact]
    public void 啤重都查不到给0()
    {
        Assert.Equal(0m, PaijiMapper.啤重G(new PaijiMaterialInfo()));
        Assert.Equal(0m, PaijiMapper.啤重G(null));
    }

    [Theory]
    [InlineData(150, 17, 2.55)]  // 150×17/1000
    [InlineData(150, 1, 0.15)]
    [InlineData(0, 17, 0)]       // 啤重0 → 0
    public void 用料KG换算(decimal 啤重, long 需啤数, decimal 期望)
        => Assert.Equal(期望, PaijiMapper.用料KG(啤重, 需啤数));

    [Fact]
    public void 备注带ERP追溯标记与交期()
    {
        var 单头 = new PlasticPurchaseOrderHeaderDto
        { 单号 = "SP20260904001", 交货日期 = new DateTime(2026, 9, 30), 备注 = "测试备注" };
        Assert.Equal("ERP:SP20260904001 交期:2026-09-30 测试备注",
            PaijiMapper.备注(单头.单号, 单头.交货日期, 单头.备注));
        Assert.Equal("ERP:SP20260904001", PaijiMapper.备注("SP20260904001", null, null));
    }

    [Fact]
    public void 整行映射()
    {
        var 单头 = new PlasticPurchaseOrderHeaderDto { 单号 = "SP20260904001", 编号 = "PO123", 交货日期 = null };
        var 行 = new PlasticPurchaseOrderLineDto
        {
            生产单号 = "SC20260903001", 款号 = "92125-S001-3L", 物料编号 = "RAINB-7M-01-粉白猫",
            模具编号 = "MJ-01", 套数 = 6, 数量 = 100, 颜色 = "粉白", 色粉号 = "C9", 用料名称 = "ABS",
        };
        var r = PaijiMapper.BuildRow("A", 单头, 行, new PaijiMaterialInfo { 整啤净重 = 150m });
        Assert.Equal("A", r.Workshop);
        Assert.Equal("92125-S001-3L", r.ProductCode);
        Assert.Equal("MJ-01", r.MoldName);
        Assert.Equal("粉白", r.Color);
        Assert.Equal("C9", r.ColorPowderNo);
        Assert.Equal("ABS", r.MaterialType);
        Assert.Equal(150m, r.ShotWeight);
        Assert.Equal(17, r.QuantityNeeded);
        Assert.Equal(2.55m, r.MaterialKg);
        Assert.Equal("SC20260903001", r.OrderNo);
        Assert.Equal("PO123", r.SerialNo);
        Assert.Equal(0, r.PackingQty);
        Assert.Equal("ERP:SP20260904001", r.OrderNotes);
    }
}
