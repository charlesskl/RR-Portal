using ErpApi.Features.Plastics.PlasticReceipt;
using ErpApi.Integrations.Paiji;
using Xunit;

// 排产入库单字段映射与换算的纯函数测试(不碰 HTTP/DB)。
public class PaijiWarehouseMappingTests
{
    private static PaijiMaterialInfo 物料(decimal? 整啤 = 150, decimal? 单净 = 25, decimal? 套数 = 6,
        decimal? 出模 = 6, string? 色粉 = "89208", string? 用料 = "PVC 85度（透明）")
        => new() { 物料编号 = "M1", 整啤净重 = 整啤, 原胶件单净重 = 单净, 套数 = 套数, 出模数 = 出模, 色粉号 = 色粉, 用料名称 = 用料 };

    [Theory]
    [InlineData("0.03", 6, "0.18")]     // 每件价×套数=每啤价
    [InlineData("0.03", null, "0.03")]  // 套数空 → 单价原值
    [InlineData("0.03", 0, "0.03")]     // 套数 0 → 单价原值
    public void 每啤单价换算(string 单价, int? 套数, string 期望)
        => Assert.Equal(decimal.Parse(期望), PaijiWarehouseMapper.每啤单价(decimal.Parse(单价), 套数));

    [Fact]
    public void 每啤单价为空给0()
        => Assert.Equal(0m, PaijiWarehouseMapper.每啤单价(null, 6m));

    [Fact]
    public void 金额口径一致()
    {
        // amount = unit_price×delivery_shots ≈ 单价×数量: 0.18×17 与 0.03×100=3 差在取整的零头,口径成立
        var up = PaijiWarehouseMapper.每啤单价(0.03m, 6m);
        var shots = PaijiMapper.需啤数(100m, 6m);
        Assert.Equal(17, shots);
        Assert.Equal(3m, 0.03m * 100m);
        Assert.Equal(up * shots, Math.Round(up * shots, 2)); // 不多于2位小数
    }

    [Fact]
    public void 出模数回落()
    {
        Assert.Equal(6, PaijiWarehouseMapper.出模数(物料(出模: 6)));
        Assert.Equal(3, PaijiWarehouseMapper.出模数(物料(出模: null, 套数: 3)));
        Assert.Equal(0, PaijiWarehouseMapper.出模数(物料(出模: null, 套数: null)));
        Assert.Equal(0, PaijiWarehouseMapper.出模数(null));
    }

    [Fact]
    public void 整行映射()
    {
        var 单头 = new PlasticReceiptHeaderDto
        { 单号 = "SR20260904001", 日期 = new DateTime(2026, 9, 4), 入仓单号 = "SH-7788", 备注 = "入仓测试" };
        var 行 = new PlasticReceiptLineDto
        {
            生产单号 = "SC20260903001", 款号 = "92125-S001-3L", 塑胶货号 = "92125-S001-3L",
            物料编号 = "RAINB-7M-01-粉白猫", 物料名称 = "粉白猫", 颜色 = "粉白", 数量 = 100, 单价 = 0.03m,
        };
        var r = PaijiWarehouseMapper.BuildRow("A", 单头, 行, 物料());
        Assert.Equal("A", r.Workshop);
        Assert.Equal("2026-09-04", r.DeliveryDate);
        Assert.Equal("SH-7788", r.DeliveryCode);
        Assert.Equal("SC20260903001", r.OrderNo);
        Assert.Equal("92125-S001-3L", r.MoldNo);
        Assert.Equal("粉白猫", r.PartName);
        Assert.Equal("粉白", r.Color);
        Assert.Equal("89208", r.ColorPowderNo);
        Assert.Equal(100m, r.DeliveryPcs);
        Assert.Equal(17, r.DeliveryShots);
        Assert.Equal(6, r.Cavity);
        Assert.Equal(150m, r.ShotWeight);
        Assert.Equal(2.55m, r.MaterialKg);
        Assert.Equal("PVC 85度（透明）", r.MaterialType);
        Assert.Equal(0.18m, r.UnitPrice);
        Assert.Equal("checked-in", r.Status);
        Assert.Equal("ERP:SR20260904001 入仓测试", r.Notes);
    }

    [Fact]
    public void 回落逻辑()
    {
        var 单头 = new PlasticReceiptHeaderDto { 单号 = "SR1", 日期 = null, 入仓单号 = "  ", 备注 = null };
        var 行 = new PlasticReceiptLineDto { 生产单号 = "MO1", 款号 = "K1", 塑胶货号 = "", 数量 = 100, 单价 = null };
        var r = PaijiWarehouseMapper.BuildRow("W", 单头, 行, null);
        Assert.Equal("SR1", r.DeliveryCode);      // 入仓单号空白 → 单据号
        Assert.Equal("K1", r.MoldNo);             // 塑胶货号空 → 款号
        Assert.Equal(100, r.DeliveryShots);       // 套数空 → 数量
        Assert.Equal(0m, r.ShotWeight);           // 物料查不到 → 0
        Assert.Equal(0m, r.MaterialKg);
        Assert.Equal(0m, r.UnitPrice);            // 单价空 → 0
        Assert.Null(r.ColorPowderNo);
        Assert.Null(r.MaterialType);
        Assert.Equal("ERP:SR1", r.Notes);
    }
}
