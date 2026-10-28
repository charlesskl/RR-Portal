using System.Text.Json;
using System.Security.Claims;
using System.Diagnostics;
using Dapper;
using IndoShipping.Api.Auth;
using IndoShipping.Api.Controllers;
using IndoShipping.Api.Features.Bootstrap;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace IndoShipping.Api.Tests;

public class ShipmentOutboundLinkTests
{
    [Fact]
    public async Task Purchase_unit_price_survives_create_update_and_reload_at_eight_decimals()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("ALTER TABLE shipment_items ALTER COLUMN price TYPE numeric(18,4); UPDATE outbound SET qty=900000 WHERE id=1");
        var legacy = Body(1); legacy.items![0].outbound_id = null;
        legacy.items[0].price = 99999999999999.1234m;
        var legacyId = Id(await f.Controller.Create(legacy));
        await f.Db.ExecuteAsync(PurchasePricePrecision.SchemaSql);
        await f.Db.ExecuteAsync(PurchasePricePrecision.SchemaSql);
        Assert.Equal(99999999999999.1234m, await f.Db.ExecuteScalarAsync<decimal>(
            "SELECT price FROM shipment_items WHERE shipment_id=@id", new { id = legacyId }));

        var body = Body(300000); body.items![0].price = .00056m; body.items[0].kg = 87;
        var id = Id(await f.Controller.Create(body));
        var saved = JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(await f.Controller.Get(id)).Value)
            .GetProperty("items")[0];
        Assert.Equal(.00056m, saved.GetProperty("price").GetDecimal());
        Assert.Equal(168m, await f.Db.ExecuteScalarAsync<decimal>(
            "SELECT price*qty FROM shipment_items WHERE shipment_id=@id", new { id }));
        body.items[0].qty = 100000; body.items[0].price = .00068m;
        Assert.IsType<OkObjectResult>(await f.Controller.Update(id, body));
        var updated = JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(await f.Controller.Get(id)).Value)
            .GetProperty("items")[0];
        Assert.Equal(.00068m, updated.GetProperty("price").GetDecimal());
        Assert.Equal(68m, await f.Db.ExecuteScalarAsync<decimal>(
            "SELECT price*qty FROM shipment_items WHERE shipment_id=@id", new { id }));
        Assert.Equal(99999999999999.1234m, await f.Db.ExecuteScalarAsync<decimal>(
            "SELECT price FROM shipment_items WHERE shipment_id=@id", new { id = legacyId }));
        Assert.Equal(900000m, await f.Db.ExecuteScalarAsync<decimal>("SELECT qty FROM outbound WHERE id=1"));
    }

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

    [Theory]
    [InlineData("wrong-material")]
    [InlineData("unconfirmed-snapshot")]
    [InlineData("over-allocation")]
    [InlineData("missing-outbound")]
    [InlineData("negative-offset")]
    [InlineData("null-quantity")]
    public async Task Rejected_link_update_preserves_existing_header_rows_audit_and_stock(string kind)
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var original = Body(60, imported: true); original.container_no = "ORIGINAL";
        original.items![0].outbound_id = null;
        var id = Id(await f.Controller.Create(original));
        var before = await f.Snapshot();
        var update = Body(60, imported: true); update.container_no = "MUST-NOT-PERSIST";
        switch (kind)
        {
            case "wrong-material": update.items![0].material_id = 65; break;
            case "unconfirmed-snapshot": update.items![0].material_snapshot = JsonSerializer.SerializeToElement(new { name_zh = "测试" }); break;
            case "over-allocation": update.items![0].qty = 101; break;
            case "missing-outbound": update.items![0].outbound_id = 999; break;
            case "negative-offset": update.items!.Add(Body(-1).items![0]); break;
            case "null-quantity": update.items![0].qty = null; break;
        }
        Assert.IsType<BadRequestObjectResult>(await f.Controller.Update(id, update));
        Assert.Equal(before, await f.Snapshot());
    }

    [Fact]
    public async Task Database_failure_after_header_update_and_row_delete_rolls_back_the_whole_put()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var original = Body(60, imported: true); original.items![0].outbound_id = null;
        var id = Id(await f.Controller.Create(original));
        await f.Db.ExecuteAsync("ALTER TABLE shipment_items ADD CONSTRAINT synthetic_failure CHECK (qty<>13)");
        var before = await f.Snapshot();
        var update = Body(13, imported: true); update.container_no = "MUST-NOT-PERSIST";
        var error = await Assert.ThrowsAsync<PostgresException>(() => f.Controller.Update(id, update));
        Assert.Equal("23514", error.SqlState);
        Assert.Equal(before, await f.Snapshot());
    }

    [Fact]
    public async Task Reverse_input_orders_take_outbound_locks_in_the_same_order()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("INSERT INTO outbound VALUES (2,100,66,NULL)");
        var firstBody = Body(60); firstBody.items!.Add(new() { outbound_id = 2, material_id = 66, qty = 60 });
        var secondBody = Body(60); secondBody.items!.Insert(0, new() { outbound_id = 2, material_id = 66, qty = 60 });
        await using var blocker = new NpgsqlConnection(f.Connection); await blocker.OpenAsync();
        await using var transaction = await blocker.BeginTransactionAsync();
        await blocker.ExecuteAsync("SELECT id FROM outbound WHERE id=1 FOR UPDATE", transaction: transaction);
        var a = "shipment_a_" + Guid.NewGuid().ToString("N");
        var b = "shipment_b_" + Guid.NewGuid().ToString("N");
        var first = f.NamedController(a).Create(firstBody);
        await f.WaitForLock(a, first);
        var second = f.NamedController(b).Create(secondBody);
        await f.WaitForLock(b, second);
        await transaction.CommitAsync();
        var results = await Task.WhenAll(first, second).WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Single(results.OfType<OkObjectResult>());
        Assert.Single(results.OfType<BadRequestObjectResult>());
        Assert.Equal(new[] { 60m, 60m }, (await f.Db.QueryAsync<decimal>("SELECT sum(qty) FROM shipment_items GROUP BY outbound_id ORDER BY outbound_id")).ToArray());
    }

    [Fact]
    public async Task Concurrent_existing_container_links_cannot_claim_the_same_remaining_quantity()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var original = Body(60, imported: true); original.items![0].outbound_id = null;
        var firstId = Id(await f.Controller.Create(original));
        var secondId = Id(await f.Controller.Create(original));
        var results = await Task.WhenAll(f.Controller.Update(firstId, Body(60, imported: true)), f.Controller.Update(secondId, Body(60, imported: true)));
        Assert.Single(results.OfType<OkObjectResult>());
        Assert.Single(results.OfType<BadRequestObjectResult>());
        Assert.Equal(60m, await f.Db.ExecuteScalarAsync<decimal>("SELECT sum(qty) FROM shipment_items WHERE outbound_id=1"));
        Assert.Equal(1, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM shipment_items WHERE outbound_id IS NULL"));
        Assert.Equal(3, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM audit_logs"));
    }

    [Fact]
    public async Task Material_confirmation_is_checked_after_waiting_for_the_outbound_lock()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var original = Body(60, imported: true); original.items![0].outbound_id = null;
        var id = Id(await f.Controller.Create(original));
        await using var blocker = new NpgsqlConnection(f.Connection); await blocker.OpenAsync();
        await using var transaction = await blocker.BeginTransactionAsync();
        await blocker.ExecuteAsync("UPDATE outbound SET material_id=67 WHERE id=1", transaction: transaction);
        var name = "shipment_material_" + Guid.NewGuid().ToString("N");
        var pending = f.NamedController(name).Update(id, Body(60, imported: true));
        await f.WaitForLock(name, pending);
        await transaction.CommitAsync();
        Assert.IsType<BadRequestObjectResult>(await pending);
        Assert.Null(await f.Db.ExecuteScalarAsync<int?>("SELECT outbound_id FROM shipment_items WHERE shipment_id=@id", new { id }));
        Assert.Equal(1, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM audit_logs"));
    }

    [Theory]
    [InlineData(0, 401)]
    [InlineData(1, 403)]
    [InlineData(2, 403)]
    [InlineData(3, 200)]
    public async Task Association_update_keeps_existing_shipment_module_authorization(int userId, int expectedStatus)
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var original = Body(60, imported: true); original.items![0].outbound_id = null;
        var id = Id(await f.Controller.Create(original));
        var before = await f.Snapshot();
        var context = new DefaultHttpContext();
        context.Request.Path = "/api/shipments/" + id; context.Request.Method = "PUT";
        if (userId != 0) context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "synthetic"));
        var nextCalled = false;
        var middleware = new ApiPermissionMiddleware(async ctx => {
            nextCalled = true;
            var controller = f.Controller; controller.ControllerContext.HttpContext = ctx;
            Assert.IsType<OkObjectResult>(await controller.Update(id, Body(60, imported: true)));
        });
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(f.Connection).Options);
        await middleware.InvokeAsync(context, db);
        Assert.Equal(expectedStatus, context.Response.StatusCode);
        Assert.Equal(expectedStatus == 200, nextCalled);
        if (expectedStatus != 200) Assert.Equal(before, await f.Snapshot());
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
        public ShipmentsController NamedController(string name) => new(new SqlConnectionFactory(
            new NpgsqlConnectionStringBuilder(Connection) { ApplicationName = name }.ConnectionString)) {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        public Task<string?> Snapshot() => Db.ExecuteScalarAsync<string>("""
            SELECT jsonb_build_object(
                'shipments',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM shipments x),
                'items',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM shipment_items x),
                'audit',(SELECT jsonb_agg(to_jsonb(x)) FROM audit_logs x),
                'materials',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM materials x),
                'outbound',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM outbound x),
                'receipts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM po_receipts x))::text
            """);
        public async Task WaitForLock(string name, Task pending)
        {
            var timer = Stopwatch.StartNew();
            while (timer.Elapsed < TimeSpan.FromSeconds(5))
            {
                if (await Db.ExecuteScalarAsync<int>("SELECT count(*) FROM pg_stat_activity WHERE application_name=@name AND wait_event_type='Lock'", new { name }) > 0) return;
                Assert.False(pending.IsCompleted, "Controller completed before reaching the expected outbound row lock");
                await Task.Delay(20);
            }
            Assert.Fail("Controller never reached the expected row lock");
        }
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
                CREATE TABLE "Users"("Id" int PRIMARY KEY,"Username" text,"PasswordHash" text,"DisplayName" text,
                    "Userbqrpower" text,"Usereditpower" text,"IsActive" boolean,"CreatedAt" timestamp);
                INSERT INTO "Users" VALUES
                    (1,'no-access','synthetic','none','000000000','000000000',true,now()),
                    (2,'readonly','synthetic','readonly','000000001','000000000',true,now()),
                    (3,'editor','synthetic','editor','000000001','000000001',true,now());
                CREATE TABLE po_receipts(id int PRIMARY KEY,qty numeric,notes text);
                INSERT INTO po_receipts VALUES (1,100,'preserve inbound stock');
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
