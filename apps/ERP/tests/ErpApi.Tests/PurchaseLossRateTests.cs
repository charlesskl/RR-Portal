using ErpApi.Features.Materials.PurchaseSettings;
using Xunit;

// 采购损耗率应用口径: 需订(订货)数量 × (1 + 损耗率%/100)。
// 消费点: MaterialMasterService.AuxiliaryPurchaseAnalysisAsync(辅料采购分析·订货数量)。
public sealed class PurchaseLossRateTests
{
    [Fact]
    public void NullRate_KeepsQty()
        => Assert.Equal(100m, PurchaseMaterialSettingsService.ApplyLossRate(100m, null));

    [Fact]
    public void ZeroRate_KeepsQty()
        => Assert.Equal(100m, PurchaseMaterialSettingsService.ApplyLossRate(100m, 0m));

    [Fact]
    public void PositiveRate_InflatesQty()
        => Assert.Equal(102.5m, PurchaseMaterialSettingsService.ApplyLossRate(100m, 2.5m));

    [Fact]
    public void ZeroQty_StaysZero()
        => Assert.Equal(0m, PurchaseMaterialSettingsService.ApplyLossRate(0m, 10m));

    [Fact]
    public void FractionalQty_RateAppliedExactly()
        => Assert.Equal(36.63m, PurchaseMaterialSettingsService.ApplyLossRate(33.3m, 10m));
}
