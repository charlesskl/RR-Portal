using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using IndoShipping.Api.Controllers;
using IndoShipping.Api.Features.Bootstrap;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Xunit;

namespace IndoShipping.Api.Tests;

// The frontend sends one physical packing row as separate explicit outbound
// allocations. Exercise the unchanged deployed HTTP contract against real PG,
// including numeric/length constraints and transaction rollback, not a mock API.
public sealed class ShipmentMultiOutboundStorageTests
{
    [ShipmentTextStorageTests.ShipmentTextFact]
    public async Task Paged_read_bounds_large_snapshot_payload_and_preserves_all_rows_and_photos()
    {
        await using var f = await Fixture.Create();
        await using var host = await HttpHost.Start(f.Connection);
        var created = await host.Client.PostAsJsonAsync("/api/shipments", Body());
        created.EnsureSuccessStatusCode();
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var snapshot = JsonSerializer.Serialize(new { id = 66, name_zh = "Synthetic material",
            image = "data:image/jpeg;base64," + new string('A', 1_600_000),
            shipment_images = new[] { "data:image/png;base64,AA==", "data:image/png;base64,AQ==" },
            import_source = new { sheet = "合成明细", row = 4, notes = "引号\"与换行\n完整保留" } });
        await f.Db.ExecuteAsync("UPDATE shipment_items SET material_snapshot=CAST(@snapshot AS JSONB) WHERE shipment_id=@id", new { snapshot, id });
        var before = await f.AllSnapshot();
        var first = await host.Client.GetFromJsonAsync<JsonElement>($"/api/shipments/{id}?offset=0&limit=10");
        Assert.Equal(3, first.GetProperty("items_total").GetInt32());
        Assert.Equal(2, first.GetProperty("items").GetArrayLength());
        Assert.Equal(2, first.GetProperty("items_next_offset").GetInt32());
        Assert.True(System.Text.Encoding.UTF8.GetByteCount(first.GetRawText()) < 4 * 1024 * 1024);
        var version = first.GetProperty("items_version").GetString();
        var last = await host.Client.GetFromJsonAsync<JsonElement>($"/api/shipments/{id}?offset=2&limit=10&version={version}");
        Assert.Equal(JsonValueKind.Null, last.GetProperty("items_next_offset").ValueKind);
        var rows = first.GetProperty("items").EnumerateArray().Concat(last.GetProperty("items").EnumerateArray()).ToArray();
        Assert.Equal(3, rows.Length);
        Assert.Equal(3, rows.Select(row => row.GetProperty("id").GetInt32()).Distinct().Count());
        foreach (var row in rows)
        {
            var material = row.GetProperty("material_snapshot");
            Assert.Equal(JsonValueKind.Object, material.ValueKind); // no escaped whole-snapshot string
            Assert.Equal(1_600_023, material.GetProperty("image").GetString()!.Length);
            Assert.Equal(2, material.GetProperty("shipment_images").GetArrayLength());
            Assert.Equal("引号\"与换行\n完整保留", material.GetProperty("import_source").GetProperty("notes").GetString());
        }
        Assert.Equal(before, await f.AllSnapshot()); // read-only, including stock and PO basis
        // A single historical row larger than the byte budget must still make
        // progress. It cannot be silently dropped from the loaded shipment.
        var large = JsonSerializer.Serialize(new { id = 66, name_zh = "Synthetic material", image = new string('B', 5 * 1024 * 1024) });
        await f.Db.ExecuteAsync("UPDATE shipment_items SET material_snapshot=CAST(@large AS JSONB) WHERE id=@key", new { large, key = rows[0].GetProperty("id").GetInt32() });
        var oversized = await host.Client.GetFromJsonAsync<JsonElement>($"/api/shipments/{id}?offset=0&limit=10");
        Assert.Single(oversized.GetProperty("items").EnumerateArray());
        Assert.Equal(1, oversized.GetProperty("items_next_offset").GetInt32());
    }

    [ShipmentTextStorageTests.ShipmentTextFact]
    public async Task Paged_read_rejects_cross_page_edits_and_invalid_limits_without_mutating_data()
    {
        await using var f = await Fixture.Create();
        await using var host = await HttpHost.Start(f.Connection);
        var created = await host.Client.PostAsJsonAsync("/api/shipments", Body());
        created.EnsureSuccessStatusCode();
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var first = await host.Client.GetFromJsonAsync<JsonElement>($"/api/shipments/{id}?offset=0&limit=1");
        var version = first.GetProperty("items_version").GetString();
        // Change only an item, not its header: xmin of every row participates.
        await f.Db.ExecuteAsync("UPDATE shipment_items SET invoice_no='changed' WHERE shipment_id=@id AND seq=2", new { id });
        var before = await f.AllSnapshot();
        Assert.Equal(HttpStatusCode.Conflict, (await host.Client.GetAsync($"/api/shipments/{id}?offset=1&limit=1&version={version}")).StatusCode);
        foreach (var query in new[] { "offset=-1&limit=10", "limit=0", "limit=51" })
            Assert.Equal(HttpStatusCode.BadRequest, (await host.Client.GetAsync($"/api/shipments/{id}?{query}")).StatusCode);
        Assert.Equal(before, await f.AllSnapshot());
        var fresh = await host.Client.GetFromJsonAsync<JsonElement>($"/api/shipments/{id}?offset=0&limit=1");
        version = fresh.GetProperty("items_version").GetString();
        await f.Db.ExecuteAsync("UPDATE po_receipts SET qty=7,spare_qty=3 WHERE id=11");
        Assert.Equal(HttpStatusCode.Conflict, (await host.Client.GetAsync($"/api/shipments/{id}?offset=1&limit=1&version={version}")).StatusCode);
        var legacy = await host.Client.GetFromJsonAsync<JsonElement>($"/api/shipments/{id}");
        Assert.Equal(3, legacy.GetProperty("items").GetArrayLength());
    }

    [ShipmentTextStorageTests.ShipmentTextFact]
    public async Task Multiple_outbound_allocations_roundtrip_original_purchase_basis_without_stock_changes()
    {
        await using var f = await Fixture.Create();
        await using var host = await HttpHost.Start(f.Connection);
        var protectedBefore = await f.ProtectedSnapshot();
        var body = Body();
        var created = await host.Client.PostAsJsonAsync("/api/shipments", body);
        created.EnsureSuccessStatusCode();
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        await AssertSaved(host.Client, f, id);
        var firstIds = (await f.Db.QueryAsync<int>("SELECT id FROM shipment_items WHERE shipment_id=@id ORDER BY seq", new { id })).ToArray();
        (await host.Client.PutAsJsonAsync($"/api/shipments/{id}", body)).EnsureSuccessStatusCode();
        await AssertSaved(host.Client, f, id);
        var secondIds = (await f.Db.QueryAsync<int>("SELECT id FROM shipment_items WHERE shipment_id=@id ORDER BY seq", new { id })).ToArray();
        // This is existing PUT behavior: row PKs are recreated, while all source
        // outbound/material IDs and business values remain explicit and exact.
        Assert.Empty(firstIds.Intersect(secondIds));
        Assert.Equal(protectedBefore, await f.ProtectedSnapshot());
        Assert.Equal(2, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM audit_logs WHERE entity_type='shipment' AND entity_id=@id", new { id = id.ToString() }));
    }

    [ShipmentTextStorageTests.ShipmentTextFact]
    public async Task Invalid_batch_rejects_whole_create_and_update_and_preserves_saved_allocations()
    {
        await using var f = await Fixture.Create();
        await using var host = await HttpHost.Start(f.Connection);
        var body = Body();
        var created = await host.Client.PostAsJsonAsync("/api/shipments", body);
        created.EnsureSuccessStatusCode();
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var before = await f.AllSnapshot();
        foreach (var invalid in new[] { "over-cap", "zero", "missing-quantity", "wrong-material", "mismatched-cartons" })
        {
            var bad = Body();
            switch (invalid)
            {
                case "over-cap": bad.items![2].qty = 11; break;
                case "zero": bad.items![2].qty = 0; break;
                case "missing-quantity": bad.items![2].qty = null; break;
                case "wrong-material": bad.items![2].material_id = 67; break;
                case "mismatched-cartons": bad.items![2].cartons = 3; break;
            }
            var post = await host.Client.PostAsJsonAsync("/api/shipments", bad);
            Assert.Equal(HttpStatusCode.BadRequest, post.StatusCode);
            Assert.Equal(before, await f.AllSnapshot());
            var put = await host.Client.PutAsJsonAsync($"/api/shipments/{id}", bad);
            Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
            Assert.Equal(before, await f.AllSnapshot());
        }
        await AssertSaved(host.Client, f, id);
    }

    [ShipmentTextStorageTests.ShipmentTextFact]
    public async Task Later_insert_failure_rolls_back_header_earlier_batches_deletions_and_audit()
    {
        await using var f = await Fixture.Create();
        await using var host = await HttpHost.Start(f.Connection);
        var body = Body();
        var created = await host.Client.PostAsJsonAsync("/api/shipments", body);
        created.EnsureSuccessStatusCode();
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        await f.Db.ExecuteAsync("ALTER TABLE shipment_items ADD CONSTRAINT synthetic_fail_later CHECK (invoice_no <> 'reject-third')");
        var before = await f.AllSnapshot();
        body.container_no = "must rollback";
        body.items![0].qty = 2;
        body.items[2].invoice_no = "reject-third";
        Assert.Equal(HttpStatusCode.InternalServerError, (await host.Client.PostAsJsonAsync("/api/shipments", body)).StatusCode);
        Assert.Equal(before, await f.AllSnapshot());
        Assert.Equal(HttpStatusCode.InternalServerError, (await host.Client.PutAsJsonAsync($"/api/shipments/{id}", body)).StatusCode);
        Assert.Equal(before, await f.AllSnapshot());
    }

    private static ShipmentsController.ShBody Body() => new()
    {
        customer = "RRI", container_no = "SYNTHETIC-1053", items = Enumerable.Range(0, 3).Select(i => new ShipmentsController.ShItem
        {
            outbound_id = 11 + i, material_id = 66, qty = 1, kg = i == 0 ? .3334m : .3333m,
            cartons = 2, carton_group = "synthetic-multi-batch", carton_no = "1-2", qty_per_carton = new string('装', 100),
            pallet = new string('板', 100), contract_no = new string('合', 100), invoice_no = new string('票', 100),
            po_no = "IRRI-SYNTHETIC-" + (11 + i), po_date = new DateTime(2026, 10, 10 + i),
            purchase_unit = "个", price = i == 0 ? .00056m : i == 1 ? .12345678m : 0m,
            currency = "US$", supplier = "Synthetic supplier", customs_company = "Synthetic customs",
            material_snapshot = JsonSerializer.SerializeToElement(new { id = 66, name_zh = "Synthetic material", unit_kg = "KGM", shipment_outbound_link_group = "synthetic-multi-batch" })
        }).ToList()
    };

    private static async Task AssertSaved(HttpClient client, Fixture f, int id)
    {
        var response = await client.GetAsync($"/api/shipments/{id}");
        response.EnsureSuccessStatusCode();
        var result = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items");
        Assert.Equal(3, result.GetArrayLength());
        for (var i = 0; i < 3; i++)
        {
            var item = result[i]; var expected = Body().items![i];
            Assert.Equal(11 + i, item.GetProperty("outbound_id").GetInt32());
            Assert.Equal(66, item.GetProperty("material_id").GetInt32());
            Assert.Equal(1m, item.GetProperty("qty").GetDecimal());
            Assert.Equal(expected.kg, item.GetProperty("kg").GetDecimal());
            Assert.Equal(expected.price, item.GetProperty("price").GetDecimal());
            Assert.Equal(expected.po_no, item.GetProperty("po_no").GetString());
            Assert.Equal(expected.po_date!.Value.ToString("yyyy-MM-dd"), item.GetProperty("po_date").GetString()![..10]);
            Assert.Equal("个", item.GetProperty("purchase_unit").GetString());
            Assert.Equal("US$", item.GetProperty("currency").GetString());
            Assert.Equal(i == 0 ? .8m : i == 1 ? 1m : 0m, item.GetProperty("purchase_charge_ratio").GetDecimal());
            foreach (var field in new[] { "qty_per_carton", "pallet", "contract_no", "invoice_no" })
                Assert.Equal(100, item.GetProperty(field).GetString()!.Length);
            var snapshot = item.GetProperty("material_snapshot");
            if (snapshot.ValueKind == JsonValueKind.String) snapshot = JsonDocument.Parse(snapshot.GetString()!).RootElement;
            Assert.Equal("synthetic-multi-batch", snapshot.GetProperty("shipment_outbound_link_group").GetString());
        }
        Assert.Equal(3m, await f.Db.ExecuteScalarAsync<decimal>("SELECT SUM(qty) FROM shipment_items WHERE shipment_id=@id", new { id }));
        Assert.Equal(1m, await f.Db.ExecuteScalarAsync<decimal>("SELECT SUM(kg) FROM shipment_items WHERE shipment_id=@id", new { id }));
        // Shared physical carton count: grouped rows carry the same two cartons.
        Assert.Equal(2, await f.Db.ExecuteScalarAsync<int>("SELECT SUM(cartons)::int FROM (SELECT MAX(cartons) AS cartons FROM shipment_items WHERE shipment_id=@id GROUP BY carton_group) x", new { id }));
    }

    private sealed class Fixture : IAsyncDisposable
    {
        public required NpgsqlConnection Db { get; init; }
        public required string Connection { get; init; }
        public required string AdminConnection { get; init; }
        public required string Database { get; init; }
        public Task<string?> ProtectedSnapshot() => Db.ExecuteScalarAsync<string>("""
            SELECT jsonb_build_object('materials',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM materials x),
                'outbound',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM outbound x),
                'receipts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM po_receipts x),
                'purchase_orders',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM purchase_orders x),
                'po_items',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM po_items x))::text
            """);
        public async Task<string> AllSnapshot() => (await ProtectedSnapshot()) + await Db.ExecuteScalarAsync<string>("""
            SELECT jsonb_build_object('shipments',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM shipments x),
                'items',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM shipment_items x),
                'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM audit_logs x))::text
            """);
        public static async Task<Fixture> Create()
        {
            var input = Environment.GetEnvironmentVariable("SHIPMENT_TEXT_TEST_CONNECTION")!;
            var parsed = new NpgsqlConnectionStringBuilder(input);
            Assert.True(parsed.Host is "127.0.0.1" or "localhost" or "::1");
            var adminCs = new NpgsqlConnectionStringBuilder(input) { SearchPath = "", Pooling = false }.ConnectionString;
            var database = "shipment_multi_test_" + Guid.NewGuid().ToString("N");
            await using (var admin = new NpgsqlConnection(adminCs)) { await admin.OpenAsync(); await admin.ExecuteAsync($"CREATE DATABASE {database} TEMPLATE template0"); }
            var cs = new NpgsqlConnectionStringBuilder(input) { Database = database, SearchPath = "indo_shipping", Pooling = false }.ConnectionString;
            var db = new NpgsqlConnection(cs); await db.OpenAsync();
            var f = new Fixture { Db = db, Connection = cs, AdminConnection = adminCs, Database = database };
            try
            {
                await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(cs).Options);
                await DatabaseCompatibility.EnsureAsync(context);
                await DataMigrations.ApplyAsync(context, NullLogger.Instance);
                await db.ExecuteAsync("""
                    INSERT INTO materials(id,name_zh) VALUES (66,'Synthetic material'),(67,'Different material');
                    INSERT INTO purchase_orders(id,po_no) VALUES (11,'IRRI-SYNTHETIC-11'),(12,'IRRI-SYNTHETIC-12'),(13,'IRRI-SYNTHETIC-13');
                    INSERT INTO po_items(id,po_id,material_id,qty,price,purchase_unit) VALUES (11,11,66,10,.00056,'个'),(12,12,66,10,.12345678,'个'),(13,13,66,10,0,'个');
                    INSERT INTO po_receipts(id,po_item_id,receipt_date,qty,spare_qty) VALUES (11,11,CURRENT_DATE,8,2),(12,12,CURRENT_DATE,10,0),(13,13,CURRENT_DATE,0,10);
                    INSERT INTO outbound(id,material_id,po_item_id,qty,po_no) VALUES (11,66,11,10,'IRRI-SYNTHETIC-11'),(12,66,12,10,'IRRI-SYNTHETIC-12'),(13,66,13,10,'IRRI-SYNTHETIC-13');
                    """);
                return f;
            }
            catch { await f.DisposeAsync(); throw; }
        }
        public async ValueTask DisposeAsync()
        {
            await Db.DisposeAsync(); await using var admin = new NpgsqlConnection(AdminConnection);
            await admin.OpenAsync(); await admin.ExecuteAsync($"DROP DATABASE {Database}");
        }
    }

    private sealed class HttpHost(WebApplication app, HttpClient client) : IAsyncDisposable
    {
        public HttpClient Client => client;
        public static async Task<HttpHost> Start(string connection)
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing", Args = [] });
            builder.Configuration.Sources.Clear(); builder.Configuration.AddInMemoryCollection(); builder.Logging.ClearProviders();
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Services.AddSingleton<ISqlConnectionFactory>(new SqlConnectionFactory(connection));
            builder.Services.AddControllers().AddApplicationPart(typeof(ShipmentsController).Assembly);
            var app = builder.Build(); app.MapControllers(); await app.StartAsync();
            return new(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()) });
        }
        public async ValueTask DisposeAsync() { client.Dispose(); await app.StopAsync(); await app.DisposeAsync(); }
    }
}
