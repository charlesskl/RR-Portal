using IndoShipping.Api.Features.Purchasing;
using Xunit;

namespace IndoShipping.Api.Tests;

public class PurchaseCustomerIsolationTests
{
    static readonly PurchaseCustomerIsolation.Product[] Products = [
        new("94704/1099803/6077834", "SPIN"), new("97282/1099235/6077462", "Spin Master"),
        new("47669", "TOMY"), new("LEGACY", null)
    ];

    [Fact]
    public void Compound_codes_remain_whole_inside_merged_lines()
    {
        Assert.Equal(["94704/1099803/6077834", "97282/1099235/6077462"],
            PurchaseCustomerIsolation.Codes("94704/1099803/6077834 / 97282/1099235/6077462", Products.Select(p => p.Code)));
        Assert.Equal("Spin Master", PurchaseCustomerIsolation.Resolve("94704/1099803/6077834 / 97282/1099235/6077462", "", Products, []));
    }

    [Theory]
    [InlineData("47669TSCA")]
    public void Catalogue_supports_legacy_tomy_codes(string code) =>
        Assert.Equal("TOMY", PurchaseCustomerIsolation.Resolve(code, "", Products, []));

    [Fact]
    public void Missing_and_mixed_customers_are_rejected()
    {
        Assert.Throws<InvalidOperationException>(() => PurchaseCustomerIsolation.Resolve("LEGACY", "", Products, []));
        Assert.Throws<InvalidOperationException>(() => PurchaseCustomerIsolation.Resolve("94704/1099803/6077834 / 47669", "", Products, []));
        Assert.Throws<InvalidOperationException>(() => PurchaseCustomerIsolation.Resolve("94704/1099803/6077835", "", Products, []));
        Assert.Throws<InvalidOperationException>(() => PurchaseCustomerIsolation.Resolve("", "", Products, []));
    }

    [Fact]
    public void Unknown_compound_skus_are_not_reinterpreted_as_known_component_products()
    {
        PurchaseCustomerIsolation.Product[] prefixes = [new("100", "TOMY"), new("200", "TOMY"), new("300", "TOMY")];
        Assert.Throws<InvalidOperationException>(() => PurchaseCustomerIsolation.Resolve("100/200/300", "", prefixes, []));
    }

    [Fact]
    public void Linked_history_wins_over_changed_catalogue_but_ambiguous_history_is_rejected()
    {
        PurchaseCustomerIsolation.Schedule[] schedules = [new("47669", "PO", "Spin Master")];
        Assert.Equal("Spin Master", PurchaseCustomerIsolation.Resolve("47669", "PO", Products, schedules));
        Assert.Equal("TOMY", PurchaseCustomerIsolation.Resolve("47669", "OTHER", Products, schedules));
        Assert.Throws<InvalidOperationException>(() => PurchaseCustomerIsolation.Resolve("47669", "PO", Products,
            [.. schedules, new("47669", "PO", "TOMY")]));
    }
}
