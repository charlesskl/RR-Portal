using System.Text.Json;
using System.Net.Http.Json;
using Dapper;
using IndoShipping.Api.Controllers;
using IndoShipping.Api.Features.Bootstrap;
using IndoShipping.Api.Features.Schedules;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Xunit;

namespace IndoShipping.Api.Tests;

public sealed class CustomerIsolationWriteIntegrationTests
{
    static PurchaseOrdersController.PoItemBody Line(string code, int? id = null) =>
        new() { id = id, product_code = code, qty = 10, purchase_qty = 10, price = 1 };
    static PurchaseOrdersController.PoBody Order(params PurchaseOrdersController.PoItemBody[] lines) =>
        new() { po_no = "20269999", supplier = "test", order_date = new DateTime(2026, 10, 20), items = lines.ToList() };
    static int Id(OkObjectResult result) => JsonSerializer.SerializeToElement(result.Value).GetProperty("id").GetInt32();

    [Theory]
    [InlineData("S100/200/300")]
    [InlineData("UNKNOWN")]
    [InlineData("UNASSIGNED")]
    public async Task Create_rejects_mixed_unknown_and_unassigned_customers_atomically(string code)
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var before = await f.Snapshot();
        Assert.IsType<ConflictObjectResult>(await f.Purchase.Create(Order(Line("T100"), Line(code))));
        Assert.Equal(before, await f.Snapshot());
    }

    [Fact]
    public async Task Update_rejects_cross_customer_append_and_preserves_legacy_quantity_edits()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var id = Id(Assert.IsType<OkObjectResult>(await f.Purchase.Create(Order(Line("T100")))));
        var detail = Assert.IsType<OkObjectResult>(await f.Purchase.Get(id));
        var body = JsonSerializer.Deserialize<PurchaseOrdersController.PoBody>(JsonSerializer.Serialize(detail.Value))!;
        body.items!.Add(Line("S100/200/300"));
        var before = await f.Snapshot();
        Assert.IsType<ConflictObjectResult>(await f.Purchase.Update(id, body));
        Assert.Equal(before, await f.Snapshot());
        // Existing unassigned/retired codes may still receive quantity/date/note edits.
        await f.Db.ExecuteAsync("UPDATE po_items SET product_code='RETIRED' WHERE po_id=@id", new { id });
        detail = Assert.IsType<OkObjectResult>(await f.Purchase.Get(id));
        body = JsonSerializer.Deserialize<PurchaseOrdersController.PoBody>(JsonSerializer.Serialize(detail.Value))!;
        body.items![0].qty = body.items[0].purchase_qty = 12;
        Assert.IsType<OkObjectResult>(await f.Purchase.Update(id, body));
        Assert.Equal(12, await f.Db.ExecuteScalarAsync<decimal>("SELECT purchase_qty FROM po_items WHERE po_id=@id", new { id }));
        body.items.Add(Line("T100"));
        before = await f.Snapshot();
        Assert.IsType<ConflictObjectResult>(await f.Purchase.Update(id, body));
        Assert.Equal(before, await f.Snapshot());
    }

    [Fact]
    public async Task Standalone_tools_are_exempt_only_when_the_material_id_is_registered()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var materialId = await f.Db.ExecuteScalarAsync<int>("""
            INSERT INTO materials(name_zh,category) VALUES ('tool','工具') RETURNING id
            """);
        var line = Line("unrelated-product"); line.material_id = materialId; line.category = "工具";
        Assert.IsType<ConflictObjectResult>(await f.Purchase.Create(Order(line)));
        await f.Db.ExecuteAsync("INSERT INTO tool_materials(material_id,tool_kind) VALUES (@materialId,'工具')", new { materialId });
        Assert.IsType<OkObjectResult>(await f.Purchase.Create(Order(line)));
    }

    [Fact]
    public async Task Concurrent_customer_changes_are_rejected_without_waiting_or_locking_unrelated_products()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await using var other = new NpgsqlConnection(f.ConnectionString); await other.OpenAsync();
        await using var tx = await other.BeginTransactionAsync();
        await other.ExecuteAsync("UPDATE products SET customer='Spin Master' WHERE code='T100'", transaction: tx);
        var before = await f.Snapshot();
        Assert.IsType<ConflictObjectResult>(await f.Purchase.Create(Order(Line("T100"))).WaitAsync(TimeSpan.FromSeconds(2)));
        Assert.Equal(before, await f.Snapshot());
        // A different product can still be purchased while T100 is being edited.
        Assert.IsType<OkObjectResult>(await f.Purchase.Create(Order(Line("T200"))).WaitAsync(TimeSpan.FromSeconds(2)));
        await tx.RollbackAsync();
    }

    [Fact]
    public async Task Linked_schedule_customer_is_checked_under_a_row_lock()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("""
            INSERT INTO schedules(customer,week_label,raw_rows) VALUES ('Spin Master','2026-W42',
                '[{"customer":"Spin Master","code":"OLD/SPIN/SKU","orderNo":"SP-1"}]')
            """);
        var line = Line("OLD/SPIN/SKU"); line.tomy_po = "SP-1";
        await using var other = new NpgsqlConnection(f.ConnectionString); await other.OpenAsync();
        await using var tx = await other.BeginTransactionAsync();
        await other.ExecuteAsync("UPDATE schedules SET customer='TOMY'", transaction: tx);
        var before = await f.Snapshot();
        Assert.IsType<ConflictObjectResult>(await f.Purchase.Create(Order(line)).WaitAsync(TimeSpan.FromSeconds(2)));
        Assert.Equal(before, await f.Snapshot());
        await tx.RollbackAsync();
        Assert.IsType<OkObjectResult>(await f.Purchase.Create(Order(line)));
    }

    [Fact]
    public async Task Schedule_rejects_explicit_catalogue_mismatch_without_changing_history()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var before = await f.Snapshot();
        Assert.IsType<BadRequestObjectResult>(await new SchedulesController(f.Factory).Create(new()
        {
            customer = "Spin Master", week_label = "2026-W42",
            raw_rows = JsonSerializer.SerializeToElement(new[] { new { customer = "Spin Master", code = "T100", qty = 10 } })
        }));
        Assert.Equal(before, await f.Snapshot());
    }

    [Fact]
    public async Task Legacy_explicit_spin_migration_preserves_raw_ids_flags_and_independent_tomy_upload()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.LegacySchedules("""[{"customer":"SPIN","code":"S100/200/300","orderNo":"SP-1","qty":10}]""");
        var raw = await f.Db.ExecuteScalarAsync<string>("SELECT raw_rows::text FROM schedules WHERE id=1");
        var history = ScheduleLineHistory.Build([new(1, "2026-W42", null, raw)]);
        var expectedLine = ScheduleLineHistory.LineKey(history[0].Rows[0]);
        var settings = JsonSerializer.Serialize(ScheduleLineHistory.Freeze(history));
        await f.Db.ExecuteAsync("""
            INSERT INTO settings(key,value) VALUES ('schedule_line_identities',@settings),
                ('material_tracking_completed_schedules',jsonb_build_object('1',md5(@raw))::text)
            ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value
            """, new { settings, raw });
        var before = await f.Snapshot();
        await f.Db.ExecuteAsync(ScheduleCustomerSchema.SchemaSql);
        Assert.Equal("Spin Master", await f.Db.ExecuteScalarAsync<string>("SELECT customer FROM schedules WHERE id=1"));
        // Only the newly derived column differs; all original row data and settings stay byte-identical.
        Assert.Equal(before, await f.Snapshot());
        await f.Db.ExecuteAsync(ScheduleCustomerSchema.SchemaSql);
        Assert.Equal(before, await f.Snapshot());
        var schedules = new SchedulesController(f.Factory);
        var view = JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(await schedules.Get(1)).Value);
        var row = JsonDocument.Parse(view.GetProperty("raw_rows").GetString()!).RootElement[0];
        Assert.Equal(expectedLine, row.GetProperty("_scheduleLineId").GetString());
        Assert.True(row.GetProperty("_legacyPlacedEligible").GetBoolean());
        Assert.IsType<OkObjectResult>(await schedules.Create(new()
        {
            customer = "TOMY", week_label = "2026-W42",
            raw_rows = JsonSerializer.SerializeToElement(new[] { new { customer = "TOMY", code = "T100", orderNo = "T-1", qty = 20 } })
        }));
        Assert.Equal(2, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM schedules"));
        Assert.Equal(raw, await f.Db.ExecuteScalarAsync<string>("SELECT raw_rows::text FROM schedules WHERE id=1"));
    }

    [Theory]
    [InlineData("[{\"customer\":\"Spin Master\"},{\"customer\":\"TOMY\"}]")]
    [InlineData("[{\"customer\":\"unsupported\"}]")]
    public async Task Ambiguous_legacy_customer_migration_rolls_back_atomically(string raw)
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.LegacySchedules(raw);
        var before = await f.Snapshot();
        var error = await Assert.ThrowsAsync<PostgresException>(() => f.Db.ExecuteAsync(ScheduleCustomerSchema.SchemaSql));
        Assert.Contains("requires review", error.MessageText);
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='schedules' AND column_name='customer'"));
        Assert.Equal(before, await f.Snapshot());
        Assert.True(await f.Db.ExecuteScalarAsync<bool>("SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='schedules'::regclass AND conname='legacy_unique_week')"));
    }

    [Fact]
    public async Task Concurrent_bootstraps_migrate_explicit_customer_once_and_remain_idempotent()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.LegacySchedules("""[{"customer":"Spin Master","code":"S100/200/300"}]""");
        var before = await f.Snapshot();
        await using var other = new NpgsqlConnection(f.ConnectionString); await other.OpenAsync();
        await Task.WhenAll(f.Db.ExecuteAsync(ScheduleCustomerSchema.SchemaSql), other.ExecuteAsync(ScheduleCustomerSchema.SchemaSql));
        Assert.Equal("Spin Master", await f.Db.ExecuteScalarAsync<string>("SELECT customer FROM schedules WHERE id=1"));
        Assert.Equal(before, await f.Snapshot());
    }

    [Fact]
    public async Task Slash_sku_materials_save_through_query_route_over_real_http()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var builder = WebApplication.CreateBuilder(); builder.Logging.ClearProviders();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddSingleton<ISqlConnectionFactory>(f.Factory);
        builder.Services.AddControllers().AddApplicationPart(typeof(MaterialsController).Assembly);
        await using var app = builder.Build(); app.MapControllers(); await app.StartAsync();
        try
        {
            using var http = new HttpClient { BaseAddress = new Uri(app.Urls.Single()) };
            using var response = await http.PutAsJsonAsync("/api/materials/bulk/by-code?code=S100%2F200%2F300",
                new { materials = new[] { new { nameZh = "compound material", usage = 2 } } });
            Assert.True(response.IsSuccessStatusCode);
            Assert.Equal(1, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM materials WHERE product_code='S100/200/300' AND name_zh='compound material' AND usage_qty=2"));
        }
        finally { await app.StopAsync(); }
    }

    sealed class Fixture : IAsyncDisposable
    {
        public required NpgsqlConnection Db { get; init; }
        public required string ConnectionString { get; init; }
        public required string Schema { get; init; }
        public SqlConnectionFactory Factory => new(ConnectionString);
        public PurchaseOrdersController Purchase => new(Factory)
            { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        public Task<string?> Snapshot() => Db.ExecuteScalarAsync<string>("""
            SELECT jsonb_build_object(
                'orders',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM purchase_orders p),
                'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM po_items i),
                'schedules',(SELECT jsonb_agg(to_jsonb(s)-'customer' ORDER BY id) FROM schedules s),
                'settings',(SELECT jsonb_agg(to_jsonb(v) ORDER BY key) FROM settings v),
                'history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM material_tracking_history h),
                'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_logs a))::text
            """);
        public async Task LegacySchedules(string raw)
        {
            await Db.ExecuteAsync("""
                ALTER TABLE schedules DROP CONSTRAINT IF EXISTS ix_schedules_customer_week;
                DROP INDEX IF EXISTS ix_schedules_customer_week;
                ALTER TABLE schedules DROP COLUMN customer;
                ALTER TABLE schedules ADD CONSTRAINT legacy_unique_week UNIQUE(week_label);
                INSERT INTO schedules(id,week_label,raw_rows) VALUES (1,'2026-W42',CAST(@raw AS jsonb));
                SELECT setval(pg_get_serial_sequence('schedules','id'),1);
                """, new { raw });
        }
        public static async Task<Fixture?> Create()
        {
            var connection = Environment.GetEnvironmentVariable("SUPPLIER_SYNC_TEST_CONNECTION");
            if (string.IsNullOrWhiteSpace(connection)) return null;
            var schema = "customer_write_test_" + Guid.NewGuid().ToString("N");
            var cs = new NpgsqlConnectionStringBuilder(connection) { SearchPath = schema, Pooling = false }.ConnectionString;
            var db = new NpgsqlConnection(cs); await db.OpenAsync();
            var sql = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory,"db","postgres_schema.sql"));
            await db.ExecuteAsync(sql.Replace("CREATE SCHEMA IF NOT EXISTS indo_shipping;", $"CREATE SCHEMA IF NOT EXISTS {schema};")
                .Replace("SET search_path TO indo_shipping;", $"SET search_path TO {schema};").Replace("indo_shipping.", $"{schema}."));
            await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(cs).Options);
            await DataMigrations.ApplyAsync(context, NullLogger.Instance);
            await db.ExecuteAsync("INSERT INTO products(code,customer) VALUES ('T100','TOMY'),('T200','TOMY'),('S100/200/300','Spin Master'),('UNASSIGNED','')");
            return new() { Db=db, ConnectionString=cs, Schema=schema };
        }
        public async ValueTask DisposeAsync()
        {
            try { await Db.ExecuteAsync($"DROP SCHEMA {Schema} CASCADE"); }
            finally { await Db.DisposeAsync(); }
        }
    }
}
