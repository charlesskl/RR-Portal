using IndoShipping.Api.Features.Schedules;
using Xunit;
using Tracking = IndoShipping.Api.Features.Schedules.SchedulePoTracking;

namespace IndoShipping.Api.Tests;

public class SchedulePoTrackingTests
{
    static readonly Tracking.Identity Target = new("TOMY", "KIK", "MA-001", "47712A");
    static Tracking.PurchaseLine Line(int id = 1, string orders = "MA-001", string po = "IRRIHS0443", string code = "47712A",
        decimal qty = 2500, decimal received = 2500, decimal spare = 25, string unit = "个", string? source = null) => new()
    {
        Id = id, PoId = id, PoNo = po, SourcePoNo = source, OrderNos = orders, ProductCode = code,
        MaterialId = 7, MaterialName = "彩盒", Unit = unit, PurchaseQty = qty, ReceivedQty = received, SpareQty = spare,
    };
    static Tracking.Movement Move(int id, decimal qty, string status = "shipped", int? line = 1, int? outbound = 10,
        string unit = "PCS", decimal limit = 10000, int material = 7) => new()
    {
        Id = id, ShipmentId = id, Qty = qty, Status = status, PoItemId = line, OutboundId = outbound,
        OutboundQty = limit, MaterialId = material, OutboundMaterialId = 7, Unit = unit,
        PoNo = "IRRIHS0443", ContainerNo = "SYNTHETIC-" + id,
    };
    static List<Tracking.Material> Build(Tracking.PurchaseLine[]? lines = null, Tracking.Movement[]? moves = null,
        Tracking.Identity[]? history = null, Tracking.Identity? target = null) => Tracking.Build(target ?? Target,
            history ?? [Target, Target], lines ?? [Line()], moves ?? []);

    [Fact]
    public void Counts_actual_split_quantities_once_and_separates_statuses_and_spares()
    {
        var movements = new[] { Move(1, 1500), Move(2, 1020, "arrived"), Move(3, 5, "loaded"), Move(4, 800, "draft") };
        var row = Assert.Single(Build(moves: movements));
        Assert.Equal(2500m, row.shipped_qty);
        Assert.Equal(20m, row.shipped_spare_qty);
        Assert.Equal(0m, row.pending_qty);
        Assert.Equal(5m, row.pending_spare_qty);
        Assert.Equal(0m, row.remaining_qty);
        Assert.Equal("complete", row.status);
        Assert.Equal(4, row.records.Count);
        Assert.False(row.records.Last().counted);
        Assert.Null(row.records.Last().regular_qty);
        Assert.Equal(800m, movements.Last().Qty); // The projection never rewrites source data.
    }

    [Fact]
    public void Loaded_and_draft_never_claim_shipped_or_reduce_remaining_quantity()
    {
        var row = Assert.Single(Build(moves: [Move(1, 1000, "loaded"), Move(2, 500, "draft")]));
        Assert.Equal(0m, row.shipped_qty);
        Assert.Equal(1000m, row.pending_qty);
        Assert.Equal(2500m, row.remaining_qty);
        Assert.Equal("unshipped", row.status);
    }

    [Fact]
    public void Shipped_stock_consumes_regular_basis_before_loaded_even_when_created_later()
    {
        var row = Assert.Single(Build(moves: [Move(1, 25, "loaded"), Move(2, 2500)]));
        Assert.Equal(2500m, row.shipped_qty);
        Assert.Equal(0m, row.shipped_spare_qty);
        Assert.Equal(25m, row.pending_spare_qty);
    }

    [Fact]
    public void Exact_order_and_complete_product_keys_do_not_include_similar_keys()
    {
        var row = Assert.Single(Build(lines: [Line(), Line(2, "MA-0010"), Line(3, code: "47712"), Line(4, code: "47712AB")]));
        Assert.Equal(1, row.po_item_id);
        var compound = new Tracking.Identity("Spin Master", "RRI", "A", "123/456/789");
        Assert.Single(Build(lines: [Line(orders: "A", code: "123/456/789")], history: [compound], target: compound));
        Assert.Empty(Build(lines: [Line(orders: "A", code: "123/456/789")], history: [compound], target: compound with { Code = "123" }));
    }

    [Theory]
    [InlineData("MA-001; MA-002", "47712A")]
    [InlineData("MA-001；MA-002", "47712A")]
    [InlineData("MA-001", "47712A / 47800A")]
    [InlineData("", "47712A")]
    public void Shared_or_unlinked_purchase_rows_are_not_silently_attributed(string orders, string code)
    {
        var row = Assert.Single(Build(lines: [Line(orders: orders, code: code)], moves: [Move(1, 1000)]));
        Assert.Equal("review", row.status);
        Assert.Null(row.purchase_qty);
        Assert.Null(row.shipped_qty);
        Assert.Null(row.remaining_qty);
        Assert.False(row.records.Single().counted);
        Assert.NotEmpty(row.issues);
    }

    [Fact]
    public void Prefix_disambiguates_rri_rrm_without_inventing_a_customer()
    {
        var history = new[] { Target, Target with { Source = "RRM" } };
        Assert.Single(Build(lines: [Line(), Line(2, po: "IRRMHS0443")], history: history));
        var unknown = Assert.Single(Build(lines: [Line(po: "2610000001")], history: history));
        Assert.Equal("review", unknown.status);
        Assert.Null(unknown.shipped_qty);
        var merged = Assert.Single(Build(lines: [Line(po: "MERGED-1", source: "IRRIHS0443")], history: history));
        Assert.Equal("unshipped", merged.status);
        var customers = new[] { Target, Target with { Customer = "Spin Master" } };
        Assert.Equal("review", Assert.Single(Build(history: customers)).status);
        Assert.Empty(Build(history: [Target with { Customer = "Spin Master" }]));
    }

    [Theory]
    [InlineData(null, null, "PCS", 10000, 7)]
    [InlineData(null, 10, "PCS", 10000, 7)]
    [InlineData(1, 10, "KGM", 10000, 7)]
    [InlineData(1, 10, "PCS", 10000, 8)]
    [InlineData(1, 10, "PCS", 99, 7)]
    public void Missing_batch_wrong_unit_material_and_overallocation_are_reviewed(int? line, int? outbound, string unit, int limit, int material)
    {
        var row = Assert.Single(Build(moves: [Move(1, 100, line: line, outbound: outbound, unit: unit, limit: limit, material: material)]));
        Assert.Equal("review", row.status);
        Assert.Null(row.shipped_qty);
        Assert.Null(row.remaining_qty);
        Assert.NotEmpty(row.records.Single().issues);
    }

    [Fact]
    public void Multiple_containers_cannot_repeat_the_whole_outbound_quantity()
    {
        var row = Assert.Single(Build(moves: [Move(1, 60, limit: 100), Move(2, 40, limit: 100)]));
        Assert.Equal(100m, row.shipped_qty);
        Assert.Equal(2400m, row.remaining_qty);
        Assert.Equal("partial", row.status);
        var overflow = Assert.Single(Build(moves: [Move(1, 60, limit: 100), Move(2, 50, limit: 100)]));
        Assert.Equal("review", overflow.status);
        Assert.Null(overflow.shipped_qty);
    }

    [Fact]
    public void Receipts_and_shipments_stay_in_purchase_units_not_declaration_weights()
    {
        var row = Assert.Single(Build(lines: [Line(qty: 12.5m, received: 12.5m, spare: 0, unit: "KGM")],
            moves: [Move(1, 3.25m, unit: "千克"), Move(2, 1.75m, "loaded", unit: "KG")]));
        Assert.Equal(3.25m, row.shipped_qty);
        Assert.Equal(1.75m, row.pending_qty);
        Assert.Equal(9.25m, row.remaining_qty);
        var noBasis = Assert.Single(Build(lines: [Line(received: 0, spare: 0)], moves: [Move(1, 100)]));
        Assert.Equal("review", noBasis.status);
        Assert.Null(noBasis.shipped_spare_qty);
    }

    [Fact]
    public void Unknown_status_and_zero_purchase_do_not_show_completed()
    {
        Assert.Equal("review", Assert.Single(Build(moves: [Move(1, 10, "unknown")])).status);
        Assert.Equal("review", Assert.Single(Build(lines: [Line(qty: 0)])).status);
        var missing = new Tracking.Movement { Id = 1, ShipmentId = 1, PoItemId = 1, OutboundId = 10,
            OutboundQty = 100, MaterialId = 7, OutboundMaterialId = 7, Status = "shipped", Unit = "PCS", HasQuantity = false };
        var row = Assert.Single(Build(moves: [missing]));
        Assert.Equal("review", row.status);
        Assert.Null(row.shipped_qty);
        Assert.Null(row.records.Single().qty);
    }
}
