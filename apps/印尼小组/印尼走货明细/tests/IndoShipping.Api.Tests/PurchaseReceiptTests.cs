using Dapper;
using IndoShipping.Api.Controllers;
using IndoShipping.Api.Features.Bootstrap;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using System.Net;
using System.Text;
using System.Text.Json;
using Npgsql;
using Xunit;

namespace IndoShipping.Api.Tests;

public sealed class PurchaseReceiptTests
{
    [Fact]
    public async Task Edit_updates_original_batch_preserves_metadata_and_audits_before_after()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var id = await f.Db.ExecuteScalarAsync<int>("""
            INSERT INTO po_receipts(po_item_id,receipt_date,qty,spare_qty,batch_no,notes)
            VALUES (1,'2026-10-01',100,5,'original','keep me') RETURNING id
            """);
        Assert.IsType<OkObjectResult>(await f.Controller.UpdateReceipt(id,
            new() { qty=80, spare_qty=10, expected_qty=100, expected_spare_qty=5 }));
        var row = await f.Db.QuerySingleAsync<(decimal Qty,decimal SpareQty,DateTime Date,string Batch,string Notes)>(
            "SELECT qty,spare_qty,receipt_date,batch_no,notes FROM po_receipts WHERE id=@id", new { id });
        Assert.Equal((80m,10m,new DateTime(2026,10,1),"original","keep me"), row);
        Assert.Equal(1, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_receipts"));
        Assert.Equal("sent", await f.Status());
        using var audit = JsonDocument.Parse((await f.Db.ExecuteScalarAsync<string>(
            "SELECT details::text FROM audit_logs WHERE action='update_receipt'"))!);
        Assert.Equal(100m, audit.RootElement.GetProperty("before").GetProperty("qty").GetDecimal());
        Assert.Equal(5m, audit.RootElement.GetProperty("before").GetProperty("spare_qty").GetDecimal());
        Assert.Equal(80m, audit.RootElement.GetProperty("after").GetProperty("qty").GetDecimal());
        Assert.Equal(10m, audit.RootElement.GetProperty("after").GetProperty("spare_qty").GetDecimal());
        Assert.IsType<OkObjectResult>(await f.Controller.UpdateReceipt(id,
            new() { qty=100, spare_qty=10, expected_qty=80, expected_spare_qty=10 }));
        Assert.Equal("received", await f.Status());
    }

    [Fact]
    public async Task Edit_respects_other_batches_and_other_items_when_recalculating_status()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var id = await f.Db.ExecuteScalarAsync<int>("""
            UPDATE purchase_orders SET status='sent' WHERE id=1;
            INSERT INTO po_items(id,po_id,qty,purchase_qty) VALUES (3,1,20,20);
            INSERT INTO po_receipts(po_item_id,receipt_date,qty,spare_qty) VALUES (1,CURRENT_DATE,40,0);
            INSERT INTO po_receipts(po_item_id,receipt_date,qty,spare_qty) VALUES (1,CURRENT_DATE,50,0) RETURNING id;
            """);
        Assert.IsType<BadRequestObjectResult>(await f.Controller.UpdateReceipt(id,
            new() { qty=61, spare_qty=0, expected_qty=50, expected_spare_qty=0 }));
        Assert.IsType<OkObjectResult>(await f.Controller.UpdateReceipt(id,
            new() { qty=60, spare_qty=0, expected_qty=50, expected_spare_qty=0 }));
        Assert.Equal("sent", await f.Status()); // another material is still outstanding
        Assert.Equal(100m, await f.Db.ExecuteScalarAsync<decimal>("SELECT SUM(qty) FROM po_receipts WHERE po_item_id=1"));
    }

    [Fact]
    public async Task Edit_spares_protects_outbound_and_supports_spare_only_batches()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        Assert.IsType<OkObjectResult>(await f.Controller.CreateReceipt(1, new() { qty=100 }));
        Assert.IsType<OkObjectResult>(await f.Controller.CreateReceipt(1, new() { spare_qty=10 }));
        var id = await f.Db.ExecuteScalarAsync<int>("SELECT id FROM po_receipts WHERE qty=0");
        await f.Db.ExecuteAsync("INSERT INTO outbound(po_item_id,qty) VALUES (1,105)");
        Assert.IsType<ConflictObjectResult>(await f.Controller.UpdateReceipt(id,
            new() { qty=0, spare_qty=4, expected_qty=0, expected_spare_qty=10 }));
        Assert.Equal(10m, await f.Db.ExecuteScalarAsync<decimal>("SELECT spare_qty FROM po_receipts WHERE id=@id", new { id }));
        Assert.IsType<OkObjectResult>(await f.Controller.UpdateReceipt(id,
            new() { qty=0, spare_qty=5, expected_qty=0, expected_spare_qty=10 }));
        Assert.Equal("received", await f.Status());
    }

    [Theory]
    [InlineData(-1,5)]
    [InlineData(5,-1)]
    [InlineData(0,0)]
    [InlineData(101,0)]
    public async Task Edit_rejects_invalid_quantities_without_writes(int qty, int spare)
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var id = await f.Db.ExecuteScalarAsync<int>("""
            INSERT INTO po_receipts(po_item_id,receipt_date,qty,spare_qty) VALUES (1,CURRENT_DATE,100,0) RETURNING id
            """);
        Assert.IsType<BadRequestObjectResult>(await f.Controller.UpdateReceipt(id,
            new() { qty=qty, spare_qty=spare, expected_qty=100, expected_spare_qty=0 }));
        Assert.Equal(100m, await f.Db.ExecuteScalarAsync<decimal>("SELECT qty FROM po_receipts WHERE id=@id", new { id }));
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM audit_logs"));
    }

    [Fact]
    public async Task Edit_rejects_stale_missing_and_unrepresentable_values()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var id = await f.Db.ExecuteScalarAsync<int>("""
            INSERT INTO po_receipts(po_item_id,receipt_date,qty,spare_qty) VALUES (1,CURRENT_DATE,100,0) RETURNING id
            """);
        Assert.IsType<ConflictObjectResult>(await f.Controller.UpdateReceipt(id,
            new() { qty=80, spare_qty=0, expected_qty=99, expected_spare_qty=0 }));
        Assert.IsType<BadRequestObjectResult>(await f.Controller.UpdateReceipt(id, new() { qty=80, spare_qty=0 }));
        Assert.IsType<BadRequestObjectResult>(await f.Controller.UpdateReceipt(id,
            new() { qty=0.00001m, spare_qty=0, expected_qty=100, expected_spare_qty=0 }));
        Assert.IsType<BadRequestObjectResult>(await f.Controller.UpdateReceipt(id,
            new() { qty=0, spare_qty=100000000000000m, expected_qty=100, expected_spare_qty=0 }));
        Assert.IsType<NotFoundObjectResult>(await f.Controller.UpdateReceipt(999999,
            new() { qty=80, spare_qty=0, expected_qty=100, expected_spare_qty=0 }));
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM audit_logs"));
    }

    [Fact]
    public async Task Concurrent_edits_do_not_silently_overwrite_each_other()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var id = await f.Db.ExecuteScalarAsync<int>("""
            INSERT INTO po_receipts(po_item_id,receipt_date,qty,spare_qty) VALUES (1,CURRENT_DATE,100,0) RETURNING id
            """);
        var results = await Task.WhenAll(
            f.Controller.UpdateReceipt(id, new() { qty=80, spare_qty=0, expected_qty=100, expected_spare_qty=0 }),
            f.Controller.UpdateReceipt(id, new() { qty=90, spare_qty=0, expected_qty=100, expected_spare_qty=0 }));
        Assert.Single(results.OfType<OkObjectResult>());
        Assert.Single(results.OfType<ConflictObjectResult>());
        Assert.Equal(1, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM audit_logs"));
    }

    [Fact]
    public async Task Concurrent_edit_and_outbound_never_create_negative_inventory()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var id = await f.Db.ExecuteScalarAsync<int>("""
            INSERT INTO po_receipts(po_item_id,receipt_date,qty,spare_qty) VALUES (1,CURRENT_DATE,100,0) RETURNING id
            """);
        var outbound = new OutboundController(new SqlConnectionFactory(f.ConnectionString))
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        var results = await Task.WhenAll(
            f.Controller.UpdateReceipt(id, new() { qty=80, spare_qty=0, expected_qty=100, expected_spare_qty=0 }),
            outbound.Create(new() { po_item_id=1, qty=90 }));
        Assert.Single(results.OfType<OkObjectResult>());
        Assert.Contains(results, x => x is ConflictObjectResult or BadRequestObjectResult);
        Assert.True(await f.Db.ExecuteScalarAsync<decimal>("""
            SELECT (SELECT COALESCE(SUM(qty+spare_qty),0) FROM po_receipts) -
                   (SELECT COALESCE(SUM(qty),0) FROM outbound)
            """) >= 0);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Completed_order_accepts_spares_and_deletion_preserves_completion(bool bulk)
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("INSERT INTO po_receipts(po_item_id,receipt_date,qty,spare_qty) VALUES (1,CURRENT_DATE,100,0)");
        var result = bulk
            ? await f.Controller.CreateBulkReceipt(1, new() { items = [new() { po_item_id = 1, qty = 0, spare_qty = 5 }] })
            : await f.Controller.CreateReceipt(1, new() { qty = 0, spare_qty = 5 });
        Assert.IsType<OkObjectResult>(result);
        Assert.Equal(100m, await f.Db.ExecuteScalarAsync<decimal>("SELECT SUM(qty) FROM po_receipts WHERE po_item_id=1"));
        Assert.Equal(5m, await f.Db.ExecuteScalarAsync<decimal>("SELECT SUM(spare_qty) FROM po_receipts WHERE po_item_id=1"));
        Assert.Equal("received", await f.Status());
        Assert.Equal(1, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM audit_logs"));
        var receiptId = await f.Db.ExecuteScalarAsync<int>("SELECT id FROM po_receipts WHERE spare_qty=5");
        // 备品已被领用时仍不允许删除导致库存不足。
        await f.Db.ExecuteAsync("INSERT INTO outbound(po_item_id,qty) VALUES (1,103)");
        Assert.IsType<ConflictObjectResult>(await f.Controller.DeleteReceipt(receiptId));
        await f.Db.ExecuteAsync("DELETE FROM outbound");
        Assert.IsType<OkObjectResult>(await f.Controller.DeleteReceipt(receiptId));
        Assert.Equal("received", await f.Status());
        Assert.Equal(0m, await f.Db.ExecuteScalarAsync<decimal>("SELECT SUM(spare_qty) FROM po_receipts"));
        var normalId = await f.Db.ExecuteScalarAsync<int>("SELECT id FROM po_receipts");
        Assert.IsType<OkObjectResult>(await f.Controller.DeleteReceipt(normalId));
        Assert.Equal("sent", await f.Status());
    }

    [Fact]
    public async Task Bulk_accepts_mixed_completed_and_open_lines_and_spares_do_not_reduce_shortage()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("""
            UPDATE purchase_orders SET status='sent' WHERE id=1;
            INSERT INTO po_items(id,po_id,qty,purchase_qty) VALUES (3,1,20,20);
            INSERT INTO po_receipts(po_item_id,receipt_date,qty,spare_qty) VALUES (1,CURRENT_DATE,100,0);
            """);
        Assert.IsType<OkObjectResult>(await f.Controller.CreateBulkReceipt(1, new() { items = [
            new() { po_item_id=1, qty=0, spare_qty=5 },
            new() { po_item_id=3, qty=10, spare_qty=50 },
        ] }));
        Assert.Equal("sent", await f.Status());
        Assert.Equal(10m, await f.Db.ExecuteScalarAsync<decimal>("SELECT SUM(qty) FROM po_receipts WHERE po_item_id=3"));
        Assert.IsType<OkObjectResult>(await f.Controller.CreateReceipt(3, new() { qty=10, spare_qty=0 }));
        Assert.Equal("received", await f.Status());
    }

    [Theory]
    [InlineData(-1, 5)]
    [InlineData(0, -1)]
    [InlineData(0, 0)]
    [InlineData(1, 5)]
    public async Task Invalid_and_over_receipts_are_rejected_by_both_endpoints(int qty, int spare)
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("INSERT INTO po_receipts(po_item_id,receipt_date,qty,spare_qty) VALUES (1,CURRENT_DATE,100,0)");
        Assert.IsType<BadRequestObjectResult>(await f.Controller.CreateReceipt(1, new() { qty=qty, spare_qty=spare }));
        Assert.IsType<BadRequestObjectResult>(await f.Controller.CreateBulkReceipt(1, new() { items = [
            new() { po_item_id=1, qty=qty, spare_qty=spare },
        ] }));
        Assert.Equal(1, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_receipts"));
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM audit_logs"));
    }

    [Fact]
    public async Task Bulk_spares_cannot_reference_another_order_and_failure_is_atomic()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        Assert.IsType<BadRequestObjectResult>(await f.Controller.CreateBulkReceipt(1, new() { items = [
            new() { po_item_id=1, spare_qty=5 }, new() { po_item_id=2, spare_qty=5 },
        ] }));
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_receipts"));
        Assert.IsType<BadRequestObjectResult>(await f.Controller.CreateBulkReceipt(1, new() { items = [
            new() { po_item_id=1, spare_qty=5 }, new() { po_item_id=1, qty=-1, spare_qty=5 },
        ] }));
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_receipts"));
    }

    [Fact]
    public async Task Legacy_check_upgrade_is_transactional_concurrent_idempotent_and_preserves_rows()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("""
            INSERT INTO po_receipts(po_item_id,receipt_date,qty,spare_qty,batch_no,notes)
            VALUES (1,'2026-10-01',12.3456,3.4567,'legacy','preserve exactly');
            ALTER TABLE po_receipts DROP CONSTRAINT "CK_po_receipts_qty_or_spare_positive";
            ALTER TABLE po_receipts ADD CONSTRAINT "CK_po_receipts_qty_positive" CHECK (qty > 0);
            """);
        var before = await Snapshot(f.Db);
        await using (var tx = await f.Db.BeginTransactionAsync())
        {
            await f.Db.ExecuteAsync(PurchaseReceiptQuantitySchema.SchemaSql, transaction: tx);
            await tx.RollbackAsync();
        }
        Assert.Equal(1, await f.Db.ExecuteScalarAsync<int>("""
            SELECT count(*) FROM pg_constraint WHERE conrelid='po_receipts'::regclass
              AND conname='CK_po_receipts_qty_positive'
            """));
        async Task Upgrade()
        {
            await using var connection = new NpgsqlConnection(f.ConnectionString);
            await connection.OpenAsync();
            await connection.ExecuteAsync(PurchaseReceiptQuantitySchema.SchemaSql);
        }
        await Task.WhenAll(Upgrade(), Upgrade());
        await f.Migrate();
        await f.Migrate();
        Assert.Equal(before, await Snapshot(f.Db));
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("""
            SELECT count(*) FROM pg_constraint WHERE conrelid='po_receipts'::regclass
              AND conname='CK_po_receipts_qty_positive'
            """));
        Assert.Equal(1, await f.Db.ExecuteScalarAsync<int>("""
            SELECT count(*) FROM pg_constraint WHERE conrelid='po_receipts'::regclass
              AND conname='CK_po_receipts_qty_or_spare_positive' AND convalidated
            """));
        Assert.IsType<OkObjectResult>(await f.Controller.CreateReceipt(1, new() { spare_qty=0.0001m }));
        Assert.IsType<OkObjectResult>(await f.Controller.CreateBulkReceipt(1, new() { items = [
            new() { po_item_id=1, spare_qty=0.2345m },
        ] }));
        Assert.Equal(12.3456m, await f.Db.ExecuteScalarAsync<decimal>("SELECT SUM(qty) FROM po_receipts"));
        Assert.Equal(3.6913m, await f.Db.ExecuteScalarAsync<decimal>("SELECT SUM(spare_qty) FROM po_receipts"));
    }

    [Fact]
    public async Task Legacy_database_without_spare_column_adds_it_before_replacing_the_check()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("""
            ALTER TABLE po_receipts DROP CONSTRAINT "CK_po_receipts_qty_or_spare_positive";
            ALTER TABLE po_receipts ADD CONSTRAINT "CK_po_receipts_qty_positive" CHECK (qty > 0);
            ALTER TABLE po_receipts DROP COLUMN spare_qty;
            INSERT INTO po_receipts(po_item_id,receipt_date,qty) VALUES (1,CURRENT_DATE,100);
            """);
        await f.Migrate();
        Assert.Equal(100m, await f.Db.ExecuteScalarAsync<decimal>("SELECT qty FROM po_receipts"));
        Assert.Equal(0m, await f.Db.ExecuteScalarAsync<decimal>("SELECT spare_qty FROM po_receipts"));
        Assert.IsType<OkObjectResult>(await f.Controller.CreateReceipt(1, new() { spare_qty=1 }));
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(-1, 5)]
    [InlineData(0, -1)]
    [InlineData(1, -1)]
    public async Task Fresh_schema_rejects_empty_or_negative_receipts_directly(int qty, int spare)
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var error = await Assert.ThrowsAsync<PostgresException>(() => f.Db.ExecuteAsync("""
            INSERT INTO po_receipts(po_item_id,receipt_date,qty,spare_qty)
            VALUES (1,CURRENT_DATE,@qty,@spare)
            """, new { qty, spare }));
        Assert.Equal(PostgresErrorCodes.CheckViolation, error.SqlState);
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_receipts"));
    }

    [Fact]
    public async Task Decimal_spares_increase_available_inventory_without_reducing_shortage()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        Assert.IsType<OkObjectResult>(await f.Controller.CreateReceipt(1, new() { qty=99.875m }));
        Assert.IsType<OkObjectResult>(await f.Controller.CreateReceipt(1, new() { spare_qty=0.25m }));
        using var list = JsonDocument.Parse(JsonSerializer.Serialize(Assert.IsType<OkObjectResult>(await f.Controller.List()).Value));
        var po = list.RootElement.EnumerateArray().Single(x => x.GetProperty("id").GetInt32() == 1);
        Assert.Equal(0.125m, po.GetProperty("shortage_qty").GetDecimal());
        Assert.Equal(0.25m, po.GetProperty("spare_qty").GetDecimal());
        var outbound = new OutboundController(new SqlConnectionFactory(f.ConnectionString))
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        Assert.IsType<OkObjectResult>(await outbound.Create(new() { po_item_id=1, qty=100.125m }));
        Assert.IsType<BadRequestObjectResult>(await outbound.Create(new() { po_item_id=1, qty=0.0001m }));
        var spareId = await f.Db.ExecuteScalarAsync<int>("SELECT id FROM po_receipts WHERE qty=0");
        Assert.IsType<ConflictObjectResult>(await f.Controller.DeleteReceipt(spareId));
        await f.Db.ExecuteAsync("DELETE FROM outbound");
        Assert.IsType<OkObjectResult>(await f.Controller.DeleteReceipt(spareId));
        Assert.Equal("sent", await f.Status());
    }

    [Fact]
    public async Task Concurrent_single_and_bulk_receipts_do_not_over_receive_or_lose_spares()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("UPDATE purchase_orders SET status='sent'; UPDATE po_items SET purchase_qty=1,qty=1 WHERE id=1");
        var results = await Task.WhenAll(
            f.Controller.CreateReceipt(1, new() { qty=0.6m, spare_qty=0.25m }),
            f.Controller.CreateBulkReceipt(1, new() { items = [new() { po_item_id=1, qty=0.6m, spare_qty=0.25m }] }));
        Assert.Single(results.OfType<OkObjectResult>());
        Assert.Single(results.OfType<BadRequestObjectResult>());
        var spareResults = await Task.WhenAll(
            f.Controller.CreateReceipt(1, new() { spare_qty=0.125m }),
            f.Controller.CreateBulkReceipt(1, new() { items = [new() { po_item_id=1, spare_qty=0.125m }] }));
        Assert.All(spareResults, x => Assert.IsType<OkObjectResult>(x));
        Assert.Equal(0.6m, await f.Db.ExecuteScalarAsync<decimal>("SELECT SUM(qty) FROM po_receipts"));
        Assert.Equal(0.5m, await f.Db.ExecuteScalarAsync<decimal>("SELECT SUM(spare_qty) FROM po_receipts"));
        Assert.Equal(3, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM audit_logs"));
        Assert.Equal("sent", await f.Status());
    }

    [Fact]
    public async Task Concurrent_spare_deletion_and_outbound_never_create_negative_inventory()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        Assert.IsType<OkObjectResult>(await f.Controller.CreateReceipt(1, new() { qty=100 }));
        Assert.IsType<OkObjectResult>(await f.Controller.CreateReceipt(1, new() { spare_qty=5 }));
        var spareId = await f.Db.ExecuteScalarAsync<int>("SELECT id FROM po_receipts WHERE qty=0");
        var outbound = new OutboundController(new SqlConnectionFactory(f.ConnectionString))
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        var results = await Task.WhenAll(f.Controller.DeleteReceipt(spareId), outbound.Create(new() { po_item_id=1, qty=105 }));
        Assert.Single(results.OfType<OkObjectResult>());
        Assert.Contains(results, x => x is ConflictObjectResult or BadRequestObjectResult);
        Assert.True(await f.Db.ExecuteScalarAsync<decimal>("""
            SELECT (SELECT COALESCE(SUM(qty+spare_qty),0) FROM po_receipts) -
                   (SELECT COALESCE(SUM(qty),0) FROM outbound)
            """) >= 0);
        Assert.Equal("received", await f.Status());
    }

    [Theory]
    [InlineData("NaN")]
    [InlineData("\"NaN\"")]
    [InlineData("\"Infinity\"")]
    [InlineData("1e1000")]
    public async Task Invalid_decimal_json_is_rejected_by_http_model_binding(string value)
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddSingleton<ISqlConnectionFactory>(new SqlConnectionFactory(f.ConnectionString));
        builder.Services.AddControllers().AddApplicationPart(typeof(PurchaseOrdersController).Assembly);
        await using var app = builder.Build();
        app.MapControllers();
        await app.StartAsync();
        using var client = new HttpClient { BaseAddress = new Uri(app.Urls.Single()) };
        using var single = await client.PostAsync("/api/purchase/items/1/receipts",
            new StringContent($"{{\"qty\":0,\"spare_qty\":{value}}}", Encoding.UTF8, "application/json"));
        using var bulk = await client.PostAsync("/api/purchase/1/receipts/bulk",
            new StringContent($"{{\"items\":[{{\"po_item_id\":1,\"qty\":0,\"spare_qty\":{value}}}]}}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, single.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, bulk.StatusCode);
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_receipts"));
        await app.StopAsync();
    }

    private static Task<string?> Snapshot(NpgsqlConnection db) => db.ExecuteScalarAsync<string>("""
        SELECT jsonb_build_object(
            'receipts', (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM po_receipts r),
            'users', (SELECT jsonb_agg(to_jsonb(u) ORDER BY "Id") FROM "Users" u))::text
        """);

    private sealed class Fixture : IAsyncDisposable
    {
        public required NpgsqlConnection Db { get; init; }
        public required string Schema { get; init; }
        public required string ConnectionString { get; init; }
        public PurchaseOrdersController Controller => new(new SqlConnectionFactory(ConnectionString))
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        public Task<string?> Status() => Db.ExecuteScalarAsync<string>("SELECT status FROM purchase_orders WHERE id=1");
        public async Task Migrate()
        {
            await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(ConnectionString).Options);
            await DataMigrations.ApplyAsync(context, NullLogger.Instance);
        }

        public static async Task<Fixture?> Create()
        {
            var connection = Environment.GetEnvironmentVariable("SUPPLIER_SYNC_TEST_CONNECTION");
            if (string.IsNullOrWhiteSpace(connection)) return null;
            var schema = "purchase_receipt_test_" + Guid.NewGuid().ToString("N");
            var cs = new NpgsqlConnectionStringBuilder(connection) { SearchPath = schema }.ConnectionString;
            var db = new NpgsqlConnection(cs);
            await db.OpenAsync();
            await db.ExecuteAsync($"CREATE SCHEMA {schema}");
            // Use the shipped DDL, including numeric precision, NOT NULL and CHECK constraints.
            // Only schema names change so concurrent test fixtures never touch business tables.
            var script = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "db", "postgres_schema.sql"));
            await db.ExecuteAsync(script
                .Replace("CREATE SCHEMA IF NOT EXISTS indo_shipping;", $"CREATE SCHEMA IF NOT EXISTS {schema};")
                .Replace("SET search_path TO indo_shipping;", $"SET search_path TO {schema};")
                .Replace("indo_shipping.", $"{schema}."));
            await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(cs).Options);
            await DataMigrations.ApplyAsync(context, NullLogger.Instance);
            await db.ExecuteAsync("""
                INSERT INTO purchase_orders(id,po_no,status) VALUES (1,'IRRIHS0396','received'),(2,'OTHER','sent');
                INSERT INTO po_items(id,po_id,qty,purchase_qty) VALUES (1,1,100,100),(2,2,10,10);
                """);
            return new() { Db=db, Schema=schema, ConnectionString=cs };
        }
        public async ValueTask DisposeAsync()
        {
            try { await Db.ExecuteAsync($"DROP SCHEMA {Schema} CASCADE"); }
            finally { await Db.DisposeAsync(); }
        }
    }
}
