using System.Text.Json;
using Dapper;
using IndoShipping.Api.Controllers;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Xunit;

namespace IndoShipping.Api.Tests;

public class ShipmentOutboundLinkTests
{
    [Fact]
    public async Task Existing_imported_row_can_be_linked_and_reloaded_without_changing_packing_or_stock()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var body = Body(60, imported: true);
        body.items![0].outbound_id = null;
        var id = Id(await f.Controller.Create(body));
        body.items[0].outbound_id = 1;
        Assert.IsType<OkObjectResult>(await f.Controller.Update(id, body));
        var saved = await f.Db.QuerySingleAsync("SELECT * FROM shipment_items WHERE shipment_id=@id", new { id });
        Assert.Equal(1, (int)saved.outbound_id);
        Assert.Equal(66, (int)saved.material_id);
        Assert.Equal(60m, (decimal)saved.qty);
        Assert.Equal(4m, (decimal)saved.kg);
        Assert.Equal("3-4", (string)saved.carton_no);
        Assert.Equal("A", (string)saved.pallet);
        Assert.Equal(23, JsonDocument.Parse((string)saved.material_snapshot).RootElement.GetProperty("length").GetInt32());
        var reload = Assert.IsType<OkObjectResult>(await f.Controller.Get(id));
        Assert.Contains("3-4", JsonSerializer.Serialize(reload.Value));
        Assert.Equal(100m, await f.Db.ExecuteScalarAsync<decimal>("SELECT qty FROM outbound WHERE id=1"));
        Assert.Equal(1, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM shipment_items"));
        Assert.Equal(1, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM materials"));
        // Updating the same container must exclude its own saved allocation.
        Assert.IsType<OkObjectResult>(await f.Controller.Update(id, body));
        Assert.IsType<BadRequestObjectResult>(await f.Controller.Create(Body(41)));
        Assert.IsType<OkObjectResult>(await f.Controller.Create(Body(40)));
    }

    [Theory]
    [InlineData(false, 65, 65)]
    [InlineData(true, 65, 65)]
    [InlineData(true, 66, 65)]
    [InlineData(true, 66, 0)]
    public async Task Wrong_or_unconfirmed_material_is_rejected_without_changes(bool imported, int materialId, int snapshotId)
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var body = Body(1, imported);
        body.items![0].material_id = materialId;
        if (imported) body.items[0].material_snapshot = JsonSerializer.SerializeToElement(new { id = snapshotId, name_zh = "测试" });
        Assert.IsType<BadRequestObjectResult>(await f.Controller.Create(body));
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM shipments"));
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM audit_logs"));
    }

    [Fact]
    public async Task Same_container_rows_are_summed_and_negative_offsets_are_rejected()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var body = Body(60);
        body.items!.Add(Body(41).items![0]);
        Assert.IsType<BadRequestObjectResult>(await f.Controller.Create(body));
        body.items[1].qty = -1;
        Assert.IsType<BadRequestObjectResult>(await f.Controller.Create(body));
        body.items[1].qty = 40;
        Assert.IsType<OkObjectResult>(await f.Controller.Create(body));
    }

    [Fact]
    public async Task Concurrent_containers_cannot_over_allocate()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var results = await Task.WhenAll(f.Controller.Create(Body(60)), f.Controller.Create(Body(60)));
        Assert.Single(results.OfType<OkObjectResult>());
        Assert.Single(results.OfType<BadRequestObjectResult>());
        Assert.Equal(60m, await f.Db.ExecuteScalarAsync<decimal>("SELECT sum(qty) FROM shipment_items"));
    }

    private static int Id(IActionResult result) => JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(result).Value).GetProperty("id").GetInt32();
    private static ShipmentsController.ShBody Body(decimal qty, bool imported = false) => new() { items = [new() {
        outbound_id = 1, material_id = 66, qty = qty, kg = 4, cartons = 2, carton_no = "3-4", pallet = "A",
        material_snapshot = imported ? JsonSerializer.SerializeToElement(new { id = 66, name_zh = "中边模", length = 23 }) : null
    }] };

    private sealed class Fixture : IAsyncDisposable
    {
        public required NpgsqlConnection Db { get; init; }
        public required string Schema { get; init; }
        public required string Connection { get; init; }
        public ShipmentsController Controller => new(new SqlConnectionFactory(Connection)) {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        public static async Task<Fixture?> Create()
        {
            var connection = Environment.GetEnvironmentVariable("SHIPMENT_LINK_TEST_CONNECTION");
            if (string.IsNullOrEmpty(connection)) return null;
            var schema = "shipment_link_test_" + Guid.NewGuid().ToString("N");
            var cs = new NpgsqlConnectionStringBuilder(connection) { SearchPath = schema }.ConnectionString;
            var db = new NpgsqlConnection(cs); await db.OpenAsync();
            await db.ExecuteAsync($"CREATE SCHEMA {schema}");
            await db.ExecuteAsync("""
                CREATE TABLE materials(id int PRIMARY KEY, name_zh text);
                INSERT INTO materials VALUES (66,'中边模');
                CREATE TABLE purchase_orders(id serial PRIMARY KEY,po_no text,merged_into_id int);
                CREATE TABLE po_items(id serial PRIMARY KEY,purchase_unit text);
                CREATE TABLE outbound(id int PRIMARY KEY,qty numeric,material_id int,po_item_id int);
                INSERT INTO outbound VALUES (1,100,66,NULL);
                CREATE TABLE shipments(id serial PRIMARY KEY,customer text,container_no text,container_count int,
                    ship_date date,load_date date,bl_no text,rate numeric,status text,created_at timestamp DEFAULT now());
                CREATE TABLE shipment_items(id serial PRIMARY KEY,shipment_id int REFERENCES shipments(id),outbound_id int,
                    material_id int,seq int,kg numeric,qty numeric,cartons int,qty_per_carton text,weighing_qty numeric,
                    purchase_unit text,pallet text,price numeric,currency text,po_no text,po_date date,supplier text,
                    customs_company text,bl_head text,contract_no text,contract_date date,invoice_no text,invoice_date date,
                    invoice_price numeric,product_use text,formula_name text,carton_group text,material_snapshot jsonb,carton_no text);
                CREATE TABLE audit_logs(user_id int,username text,module text,action text,entity_type text,entity_id text,
                    summary text,details jsonb,ip_address text);
                """);
            return new() { Db = db, Schema = schema, Connection = cs };
        }
        public async ValueTask DisposeAsync()
        {
            try { await Db.ExecuteAsync($"DROP SCHEMA {Schema} CASCADE"); }
            finally { await Db.DisposeAsync(); }
        }
    }
}
