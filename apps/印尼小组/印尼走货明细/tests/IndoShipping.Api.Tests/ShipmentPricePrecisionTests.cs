using Dapper;
using IndoShipping.Api.Features.Bootstrap;
using IndoShipping.Domain.Entities;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace IndoShipping.Api.Tests;

public class ShipmentPricePrecisionTests
{
    [Fact]
    public async Task Legacy_shipment_price_column_widens_idempotently_without_changing_existing_values()
    {
        var cs = Environment.GetEnvironmentVariable("SUPPLIER_SYNC_TEST_CONNECTION");
        if (string.IsNullOrWhiteSpace(cs)) return;
        await using var db = new NpgsqlConnection(cs); await db.OpenAsync();
        // Both tables are session-local so the migration cannot reach business tables.
        await db.ExecuteAsync("CREATE TEMP TABLE po_items(price numeric(22,8)); CREATE TEMP TABLE shipment_items(id int,price numeric(18,4)); INSERT INTO shipment_items VALUES(1,99999999999999.1234),(2,0),(3,NULL)");
        await db.ExecuteAsync(PurchasePricePrecision.SchemaSql);
        await db.ExecuteAsync(PurchasePricePrecision.SchemaSql);
        Assert.Equal("numeric(22,8)", await db.ExecuteScalarAsync<string>(
            "SELECT format_type(atttypid,atttypmod) FROM pg_attribute WHERE attrelid=to_regclass('shipment_items') AND attname='price'"));
        Assert.Equal(99999999999999.1234m, await db.ExecuteScalarAsync<decimal>("SELECT price FROM shipment_items WHERE id=1"));
        Assert.Equal(0m, await db.ExecuteScalarAsync<decimal>("SELECT price FROM shipment_items WHERE id=2"));
        Assert.Null(await db.ExecuteScalarAsync<decimal?>("SELECT price FROM shipment_items WHERE id=3"));
        foreach (var price in new[] { .00056m, .12345678m, .00000001m, 0m })
        {
            await db.ExecuteAsync("INSERT INTO shipment_items VALUES(4,@price)", new { price });
            Assert.Equal(price, await db.ExecuteScalarAsync<decimal>("SELECT price FROM shipment_items WHERE id=4"));
            await db.ExecuteAsync("DELETE FROM shipment_items WHERE id=4");
        }
    }

    [Fact]
    public async Task Existing_higher_precision_shipment_price_is_not_narrowed()
    {
        var cs = Environment.GetEnvironmentVariable("SUPPLIER_SYNC_TEST_CONNECTION");
        if (string.IsNullOrWhiteSpace(cs)) return;
        await using var db = new NpgsqlConnection(cs); await db.OpenAsync();
        await db.ExecuteAsync("CREATE TEMP TABLE po_items(price numeric(22,8)); CREATE TEMP TABLE shipment_items(price numeric(24,10)); INSERT INTO shipment_items VALUES(.1234567891)");
        await db.ExecuteAsync(PurchasePricePrecision.SchemaSql);
        Assert.Equal(.1234567891m, await db.ExecuteScalarAsync<decimal>("SELECT price FROM shipment_items"));
        Assert.Equal("numeric(24,10)", await db.ExecuteScalarAsync<string>(
            "SELECT format_type(atttypid,atttypmod) FROM pg_attribute WHERE attrelid=to_regclass('shipment_items') AND attname='price'"));
    }

    [Fact]
    public void Shipment_price_mapping_matches_purchase_price_precision()
    {
        using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql("Host=127.0.0.1;Database=synthetic;Username=synthetic").Options);
        Assert.Equal("numeric(22,8)", db.Model.FindEntityType(typeof(ShipmentItem))!
            .FindProperty(nameof(ShipmentItem.Price))!.GetColumnType());
    }
}
