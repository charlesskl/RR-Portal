using System.Text.Json;
using System.Security.Claims;
using IndoShipping.Api.Auth;
using Microsoft.EntityFrameworkCore;
using Dapper;
using IndoShipping.Api.Controllers;
using IndoShipping.Api.Features.Bootstrap;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Xunit;

namespace IndoShipping.Api.Tests;

public sealed class PurchaseOrderMergeTests
{
    [Theory]
    [InlineData("IRRMHS001", "HD_GLOBAL")]
    [InlineData("IRRIHS001", "HD_INDUSTRY")]
    [InlineData("20269001", "HSY")]
    [InlineData("unknown", "")]
    public void Buyer_requires_a_recognized_number(string number, string expected) =>
        Assert.Equal(expected, PurchaseOrdersController.PurchaseEntity(number));

    [Theory]
    [InlineData("￥", "CNY")]
    [InlineData("RMB", "CNY")]
    [InlineData("US$", "USD")]
    [InlineData("HK$", "HKD")]
    [InlineData("Rp", "IDR")]
    [InlineData("???", "")]
    public void Currency_aliases_are_normalized(string value, string expected) =>
        Assert.Equal(expected, PurchaseOrdersController.MergeCurrency(value));

    [Theory]
    [InlineData("UPDATE products SET customer='Spin Master' WHERE code='35875'", "不同客户")]
    [InlineData("DELETE FROM products WHERE code='35875'", "客户未能确认")]
    [InlineData("UPDATE po_items SET product_code='35874 / 35875' WHERE id=1; UPDATE products SET customer='Spin Master' WHERE code='35875'", "不同客户")]
    public async Task Merge_rejects_mixed_or_unknown_customers_without_changes(string setup, string error)
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync(setup);
        var before = await f.Items();
        var rejected = Assert.IsType<ConflictObjectResult>(await f.Controller.Merge(new() { ids = [1, 2], target_id = 1 }));
        Assert.Contains(error, JsonSerializer.SerializeToElement(rejected.Value).GetProperty("error").GetString());
        Assert.Equal(before, await f.Items());
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM purchase_orders WHERE merged_into_id IS NOT NULL OR merge_revision>0"));
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM audit_logs"));
    }

    [Fact]
    public async Task Merge_resolves_full_spin_codes_and_old_schedule_customer()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("""
            UPDATE po_items SET product_code='94704/1099803/6077834' WHERE id=1;
            UPDATE po_items SET product_code='97282/1099235/6077462' WHERE id=2;
            INSERT INTO products(code,customer) VALUES ('94704/1099803/6077834','SPIN MASTER');
            INSERT INTO schedules(customer,raw_rows) VALUES ('Spin Master',
                '[{"code":"97282/1099235/6077462","orderNo":"TOMY2"}]');
            """);
        var before = await f.Items();
        Assert.IsType<OkObjectResult>(await f.Controller.Merge(new() { ids = [1, 2], target_id = 1 }));
        Assert.Equal(before, await f.Items());
    }

    [Fact]
    public async Task Merge_moves_original_items_without_repricing_and_retains_history()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var before = await f.Items();
        Assert.IsType<OkObjectResult>(await f.Controller.Merge(new() { ids = [1, 2], target_id = 1 }));
        Assert.Equal(before, await f.Items());
        Assert.Equal(2, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_items WHERE po_id=1"));
        Assert.Equal(3030m, await f.Db.ExecuteScalarAsync<decimal>("SELECT sum(purchase_qty*price) FROM po_items WHERE po_id=1"));
        Assert.Equal(1, await f.Db.ExecuteScalarAsync<int>("SELECT merged_into_id FROM purchase_orders WHERE id=2"));
        Assert.Equal("20269002", await f.Db.ExecuteScalarAsync<string>("SELECT source_po_no FROM po_items WHERE id=2"));
        Assert.Equal(new DateTime(2026, 10, 28), await f.Db.ExecuteScalarAsync<DateTime>("SELECT source_delivery_date FROM po_items WHERE id=2"));
        Assert.Equal(1, await f.Db.ExecuteScalarAsync<int>("SELECT merge_revision FROM purchase_orders WHERE id=1"));
        var audit = await f.Db.ExecuteScalarAsync<string>("SELECT details::text FROM audit_logs WHERE action='merge'");
        using var json = JsonDocument.Parse(audit!);
        Assert.Equal(2, json.RootElement.GetProperty("orders").GetArrayLength());
        Assert.Equal(2, json.RootElement.GetProperty("items").GetArrayLength());
        Assert.IsType<ConflictObjectResult>(await f.Controller.Get(2));
        Assert.IsType<ConflictObjectResult>(await f.Controller.Update(1, new() { po_no = "20269001", items = [] }));
        Assert.IsType<ConflictObjectResult>(await f.Controller.Update(2, new() { po_no = "20269002" }));
        Assert.IsType<NotFoundObjectResult>(await f.Controller.Patch(2, new() { ["status"] = "draft" }));
        Assert.IsType<ConflictObjectResult>(await f.Controller.Delete(1));
        Assert.IsType<ConflictObjectResult>(await f.Controller.Delete(2));
        Assert.Equal(2, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_items WHERE po_id=1"));
        var detail = Assert.IsType<OkObjectResult>(await f.Controller.Get(1));
        var update = JsonSerializer.Deserialize<PurchaseOrdersController.PoBody>(JsonSerializer.Serialize(detail.Value))!;
        update.delivery_date = new DateTime(2026, 12, 1);
        Assert.IsType<OkObjectResult>(await f.Controller.Update(1, update));
        Assert.Equal(before, await f.Items());
        Assert.Equal(new DateTime(2026, 10, 28), await f.Db.ExecuteScalarAsync<DateTime>("SELECT source_delivery_date FROM po_items WHERE id=2"));
        var listing = Assert.IsType<OkObjectResult>(await f.Controller.List());
        using var list = JsonDocument.Parse(JsonSerializer.Serialize(listing.Value));
        Assert.Equal(2, list.RootElement.GetArrayLength()); // target + untouched third PO
        Assert.Contains("20269002", list.RootElement.EnumerateArray().Single(x => x.GetProperty("id").GetInt32() == 1)
            .GetProperty("merged_po_numbers").EnumerateArray().Select(x => x.GetString()));
    }

    [Fact]
    public async Task Whole_order_date_change_preserves_sources_and_audits_every_change()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Controller.Merge(new() { ids = [1, 2], target_id = 1 });
        var detail = Assert.IsType<OkObjectResult>(await f.Controller.Get(1));
        var update = JsonSerializer.Deserialize<PurchaseOrdersController.PoBody>(JsonSerializer.Serialize(detail.Value))!;
        var before = await f.Items();
        update.notes = "note-only";
        Assert.IsType<OkObjectResult>(await f.Controller.Update(1, update));
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_items WHERE has_delivery_date_override"));
        update.apply_delivery_date_all = true;
        Assert.IsType<OkObjectResult>(await f.Controller.Update(1, update));
        Assert.Equal(2, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_items WHERE po_id=1 AND has_delivery_date_override AND delivery_date_override='2026-10-23'"));
        update.apply_delivery_date_all = false;
        update.delivery_date = new DateTime(2026, 11, 2);
        Assert.IsType<OkObjectResult>(await f.Controller.Update(1, update));
        Assert.Equal(2, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_items WHERE po_id=1 AND delivery_date_override='2026-11-02'"));
        Assert.Equal(new DateTime(2026, 10, 28), await f.Db.ExecuteScalarAsync<DateTime>("SELECT source_delivery_date FROM po_items WHERE id=2"));
        update.delivery_date = null;
        Assert.IsType<OkObjectResult>(await f.Controller.Update(1, update));
        Assert.Equal(2, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_items WHERE po_id=1 AND has_delivery_date_override AND delivery_date_override IS NULL"));
        Assert.Equal(3, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM audit_logs WHERE action='change_delivery_date' AND details->'previous_items' IS NOT NULL"));
        Assert.Equal(before, await f.Items());
        await f.Controller.Merge(new() { ids = [1, 3], target_id = 3 });
        Assert.Equal(2, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_items WHERE po_id=3 AND has_delivery_date_override AND delivery_date_override IS NULL"));
    }

    [Fact]
    public async Task Different_order_dates_merge_and_survive_header_edits_and_repeated_merges()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("UPDATE purchase_orders SET order_date='2026-10-20' WHERE id=2");
        var before = await f.Items();
        Assert.IsType<OkObjectResult>(await f.Controller.Merge(new() { ids = [1, 2], target_id = 1 }));
        Assert.Equal(before, await f.Items());
        Assert.Equal(new DateTime(2026, 10, 19), await f.Db.ExecuteScalarAsync<DateTime>("SELECT order_date FROM purchase_orders WHERE id=1"));
        Assert.Equal(new DateTime(2026, 10, 20), await f.Db.ExecuteScalarAsync<DateTime>("SELECT source_order_date FROM po_items WHERE id=2"));
        await f.Controller.Patch(1, new() { ["order_date"] = new DateTime(2026, 10, 21) });
        await f.Db.ExecuteAsync(PurchaseMergeSchema.SchemaSql);
        Assert.IsType<OkObjectResult>(await f.Controller.Merge(new() { ids = [1, 3], target_id = 3 }));
        Assert.Equal(new DateTime(2026, 10, 19), await f.Db.ExecuteScalarAsync<DateTime>("SELECT source_order_date FROM po_items WHERE id=1"));
        Assert.Equal(new DateTime(2026, 10, 20), await f.Db.ExecuteScalarAsync<DateTime>("SELECT source_order_date FROM po_items WHERE id=2"));
        Assert.Equal(before, await f.Items());
    }

    [Fact]
    public async Task Upgrade_backfills_dates_for_previously_merged_items_once()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("ALTER TABLE po_items DROP COLUMN source_order_date; UPDATE po_items SET source_po_no='20269002' WHERE id=2");
        await f.Db.ExecuteAsync(PurchaseMergeSchema.SchemaSql);
        Assert.Equal(new DateTime(2026, 10, 19), await f.Db.ExecuteScalarAsync<DateTime>("SELECT source_order_date FROM po_items WHERE id=2"));
        await f.Db.ExecuteAsync("UPDATE purchase_orders SET order_date='2026-10-25' WHERE id=2");
        await f.Db.ExecuteAsync(PurchaseMergeSchema.SchemaSql);
        Assert.Equal(new DateTime(2026, 10, 19), await f.Db.ExecuteScalarAsync<DateTime>("SELECT source_order_date FROM po_items WHERE id=2"));
    }

    [Fact]
    public async Task Repeated_merge_retains_original_sources_and_null_dates()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("UPDATE purchase_orders SET delivery_date=NULL WHERE id=2");
        Assert.IsType<OkObjectResult>(await f.Controller.Merge(new() { ids = [1, 2], target_id = 1 }));
        Assert.IsType<OkObjectResult>(await f.Controller.Merge(new() { ids = [1, 3], target_id = 3 }));
        Assert.Equal(3, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_items WHERE po_id=3"));
        Assert.Equal("20269002", await f.Db.ExecuteScalarAsync<string>("SELECT source_po_no FROM po_items WHERE id=2"));
        Assert.Null(await f.Db.ExecuteScalarAsync<DateTime?>("SELECT source_delivery_date FROM po_items WHERE id=2"));
        Assert.Equal(2, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM purchase_orders WHERE merged_into_id=3"));
    }

    [Theory]
    [InlineData("UPDATE purchase_orders SET supplier='Other' WHERE id=2")]
    [InlineData("UPDATE purchase_orders SET order_date=NULL WHERE id=2")]
    [InlineData("UPDATE purchase_orders SET status='received' WHERE id=2")]
    [InlineData("UPDATE purchase_orders SET status='settled' WHERE id=2")]
    [InlineData("UPDATE purchase_orders SET status='sent' WHERE id=2")]
    [InlineData("UPDATE purchase_orders SET po_no='IRRMHS001' WHERE id=2")]
    [InlineData("UPDATE po_items SET currency='US$' WHERE id=2")]
    [InlineData("DELETE FROM po_items WHERE po_id=2")]
    [InlineData("INSERT INTO po_receipts(po_item_id,qty) VALUES(2,1)")]
    [InlineData("INSERT INTO outbound(po_item_id,po_no) VALUES(2,'20269002')")]
    [InlineData("INSERT INTO outbound(po_no) VALUES('20269002')")]
    [InlineData("INSERT INTO shipment_items(po_no) VALUES('20269002')")]
    public async Task Invalid_or_occupied_orders_are_rejected_atomically(string setup)
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync(setup);
        var before = await f.Items();
        Assert.IsType<ConflictObjectResult>(await f.Controller.Merge(new() { ids = [1, 2], target_id = 1 }));
        Assert.Equal(before, await f.Items());
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM purchase_orders WHERE merged_into_id IS NOT NULL"));
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM audit_logs"));
    }

    [Fact]
    public async Task Duplicate_or_concurrent_requests_cannot_move_items_twice()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var request = new PurchaseOrdersController.MergeBody { ids = [1, 2], target_id = 1 };
        var results = await Task.WhenAll(f.Controller.Merge(request), f.Controller.Merge(request));
        Assert.Single(results.OfType<OkObjectResult>());
        Assert.Single(results.OfType<ConflictObjectResult>());
        Assert.Equal(2, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_items WHERE po_id=1"));
        Assert.Equal(1, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM audit_logs"));
    }

    [Fact]
    public async Task Receipt_committing_during_merge_is_detected_after_item_lock()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await using var tx = await f.Db.BeginTransactionAsync();
        await f.Db.ExecuteAsync("SELECT id FROM po_items WHERE id=2 FOR UPDATE", transaction: tx);
        var pending = f.Controller.Merge(new() { ids = [1, 2], target_id = 1 });
        await f.Db.ExecuteAsync("INSERT INTO po_receipts(po_item_id,qty) VALUES(2,1)", transaction: tx);
        await tx.CommitAsync();
        Assert.IsType<ConflictObjectResult>(await pending);
        Assert.Equal(2, await f.Db.ExecuteScalarAsync<int>("SELECT po_id FROM po_items WHERE id=2"));
    }

    [Fact]
    public async Task Audit_failure_rolls_back_the_entire_merge()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("DROP TABLE audit_logs");
        await Assert.ThrowsAsync<PostgresException>(() => f.Controller.Merge(new() { ids = [1, 2], target_id = 1 }));
        Assert.Equal(2, await f.Db.ExecuteScalarAsync<int>("SELECT po_id FROM po_items WHERE id=2"));
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM purchase_orders WHERE merged_into_id IS NOT NULL OR merge_revision>0"));
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_items WHERE source_po_no IS NOT NULL"));
    }

    [Fact]
    public async Task Archived_order_cannot_gain_new_shipment_links()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        Assert.IsType<OkObjectResult>(await f.Controller.Merge(new() { ids = [1, 2], target_id = 1 }));
        Assert.IsType<BadRequestObjectResult>(await f.Shipments.Create(new()
        { items = [new() { po_no = "20269002", qty = 1 }] }));
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM shipment_items"));
        Assert.IsType<OkObjectResult>(await f.Shipments.Create(new()
        { items = [new() { po_no = "20269001", qty = 1 }] }));
    }

    [Fact]
    public async Task Shipment_starting_after_merge_check_cannot_attach_to_archived_source()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("""
            CREATE FUNCTION pause_merge() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
                PERFORM pg_advisory_xact_lock(943, 1); RETURN NEW; END $$;
            CREATE TRIGGER pause_merge BEFORE UPDATE OF po_id ON po_items
                FOR EACH ROW EXECUTE FUNCTION pause_merge();
            """);
        await using var gate = await f.Db.BeginTransactionAsync();
        await f.Db.ExecuteAsync("SELECT pg_advisory_xact_lock(943, 1)", transaction: gate);
        var merge = f.Controller.Merge(new() { ids = [1, 2], target_id = 1 });
        Task<IActionResult>? shipment = null;
        try
        {
            // Gate is reached only after Merge's occupancy check; no timing-only sleep.
            await f.WaitForLock("%UPDATE po_items i SET%", "advisory", gate);
            shipment = f.Shipments.Create(new() { items = [new() { po_no = "20269002", qty = 1 }] });
            await f.WaitForLock("%WHERE po_no=ANY(%", "transactionid", gate, shipment);
        }
        finally { await gate.RollbackAsync(); }
        Assert.IsType<OkObjectResult>(await merge);
        Assert.IsType<BadRequestObjectResult>(await shipment!);
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM shipment_items"));
    }

    [Fact]
    public async Task Shipment_committing_before_merge_is_seen_after_header_lock()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("""
            CREATE FUNCTION pause_shipment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
                PERFORM pg_advisory_xact_lock(943, 2); RETURN NEW; END $$;
            CREATE TRIGGER pause_shipment BEFORE INSERT ON shipment_items
                FOR EACH ROW EXECUTE FUNCTION pause_shipment();
            """);
        await using var gate = await f.Db.BeginTransactionAsync();
        await f.Db.ExecuteAsync("SELECT pg_advisory_xact_lock(943, 2)", transaction: gate);
        var shipment = f.Shipments.Create(new() { items = [new() { po_no = "20269002", qty = 1 }] });
        Task<IActionResult>? merge = null;
        try
        {
            await f.WaitForLock("%INSERT INTO shipment_items(%", "advisory", gate);
            merge = f.Controller.Merge(new() { ids = [1, 2], target_id = 1 });
            await f.WaitForLock("%SELECT * FROM purchase_orders%", "transactionid", gate, merge);
        }
        finally { await gate.RollbackAsync(); }
        Assert.IsType<OkObjectResult>(await shipment);
        Assert.IsType<ConflictObjectResult>(await merge!);
        Assert.Equal(2, await f.Db.ExecuteScalarAsync<int>("SELECT po_id FROM po_items WHERE id=2"));
    }

    [Fact]
    public async Task Shipment_update_preserves_existing_rows_when_archived_source_is_rejected()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        Assert.IsType<OkObjectResult>(await f.Shipments.Create(new()
        { items = [new() { po_no = "UNRELATED", qty = 2 }] }));
        Assert.IsType<OkObjectResult>(await f.Controller.Merge(new() { ids = [1, 2], target_id = 1 }));
        Assert.IsType<BadRequestObjectResult>(await f.Shipments.Update(1, new()
        { items = [new() { po_no = "20269002", qty = 1 }] }));
        Assert.Equal("UNRELATED", await f.Db.ExecuteScalarAsync<string>("SELECT po_no FROM shipment_items"));
        Assert.Equal(2m, await f.Db.ExecuteScalarAsync<decimal>("SELECT qty FROM shipment_items"));
    }

    [Theory]
    [InlineData("/api/purchase/merge", "POST", true, false, true, 403)]
    [InlineData("/api/purchase/1", "PUT", true, false, true, 403)]
    [InlineData("/api/purchase/merge", "POST", false, true, true, 403)]
    [InlineData("/api/purchase/1", "PUT", false, true, true, 403)]
    [InlineData("/api/purchase/merge", "POST", true, true, false, 401)]
    [InlineData("/api/purchase/1", "PUT", true, true, false, 401)]
    [InlineData("/api/purchase/merge", "POST", true, true, true, 200)]
    [InlineData("/api/purchase/1", "PUT", true, true, true, 200)]
    public async Task Merge_and_whole_order_date_require_live_purchase_edit_permission(
        string path, string method, bool access, bool edit, bool active, int status)
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("""
            INSERT INTO "Users"("Id","Username","PasswordHash","DisplayName","Userbqrpower","Usereditpower","IsActive","CreatedAt")
                VALUES (1,'synthetic','unused','Synthetic',@access,@edit,@active,now())
            """, new { access = access ? "000010000" : "000000000", edit = edit ? "000010000" : "000000000", active });
        var nextCalled = false;
        var middleware = new ApiPermissionMiddleware(_ => { nextCalled = true; return Task.CompletedTask; });
        var context = new DefaultHttpContext
        { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "1")], "synthetic")) };
        context.Request.Path = path; context.Request.Method = method;
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(f.ConnectionString).Options);
        await middleware.InvokeAsync(context, db);
        Assert.Equal(status, context.Response.StatusCode);
        Assert.Equal(status == 200, nextCalled);
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM audit_logs"));
    }

    private sealed class Fixture : IAsyncDisposable
    {
        public required NpgsqlConnection Db { get; init; }
        public required string Schema { get; init; }
        public required string ConnectionString { get; init; }
        public PurchaseOrdersController Controller => new(new SqlConnectionFactory(ConnectionString))
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };

        public ShipmentsController Shipments => new(new SqlConnectionFactory(ConnectionString))
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };

        public async Task WaitForLock(string query, string waitEvent, NpgsqlTransaction tx, Task? pending = null)
        {
            var until = DateTime.UtcNow.AddSeconds(5);
            while (DateTime.UtcNow < until)
            {
                await Db.ExecuteAsync("SELECT pg_stat_clear_snapshot()", transaction: tx);
                if (await Db.ExecuteScalarAsync<bool>("""
                    SELECT EXISTS(SELECT 1 FROM pg_stat_activity
                        WHERE pid<>pg_backend_pid() AND query LIKE @query AND wait_event=@waitEvent)
                    """, new { query, waitEvent }, tx)) return;
                if (pending?.IsCompleted == true) break;
                await Task.Delay(15);
            }
            Assert.Fail("Expected synthetic PostgreSQL lock boundary was not reached");
        }

        public async Task<string?> Items() => await Db.ExecuteScalarAsync<string>("""
            SELECT jsonb_agg(to_jsonb(i)-'po_id'-'source_po_no'-'source_delivery_date'-'source_order_date'-'delivery_date_override'-'has_delivery_date_override' ORDER BY id)::text FROM po_items i
            """);
        public static async Task<Fixture?> Create()
        {
            var connection = Environment.GetEnvironmentVariable("SUPPLIER_SYNC_TEST_CONNECTION");
            if (string.IsNullOrWhiteSpace(connection)) return null;
            var schema = "purchase_merge_test_" + Guid.NewGuid().ToString("N");
            var cs = new NpgsqlConnectionStringBuilder(connection) { SearchPath = schema }.ConnectionString;
            var db = new NpgsqlConnection(cs);
            await db.OpenAsync();
            await db.ExecuteAsync($"CREATE SCHEMA {schema}");
            await db.ExecuteAsync("""
                CREATE TABLE "Users"("Id" int PRIMARY KEY,"Username" text,"PasswordHash" text,"DisplayName" text,
                    "Userbqrpower" text,"Usereditpower" text,"IsActive" bool,"CreatedAt" timestamptz);
                CREATE TABLE purchase_orders(id serial PRIMARY KEY,po_no text UNIQUE,supplier text,status text DEFAULT 'draft',
                    order_date date,delivery_date date,notes text,created_at timestamp DEFAULT now());
                CREATE TABLE po_items(id serial PRIMARY KEY,po_id int REFERENCES purchase_orders(id),product_code text,
                    material_id int,material_name text,qty numeric,price numeric(22,8),currency text,notes text DEFAULT '',category text,spec text,
                    usage_qty numeric,ordered_qty numeric,material_qty numeric,spoilage_qty numeric,purchase_qty numeric,
                    purchase_unit text,ship_unit text,net_per_pc numeric,eta text,tomy_po text);
                CREATE TABLE po_receipts(id serial PRIMARY KEY,po_item_id int REFERENCES po_items(id),qty numeric,spare_qty numeric DEFAULT 0,
                    receipt_date date,batch_no text);
                CREATE TABLE outbound(po_item_id int REFERENCES po_items(id),po_no text);
                CREATE TABLE shipments(id serial PRIMARY KEY,customer text,container_no text,container_count int,
                    ship_date date,load_date date,bl_no text,rate numeric,status text,created_at timestamp DEFAULT now());
                CREATE TABLE shipment_items(id serial PRIMARY KEY,shipment_id int REFERENCES shipments(id),outbound_id int,
                    material_id int,seq int,kg numeric,qty numeric,cartons int,qty_per_carton text,weighing_qty numeric,
                    purchase_unit text,pallet text,price numeric,currency text,po_no text,po_date date,supplier text,
                    customs_company text,bl_head text,contract_no text,contract_date date,invoice_no text,invoice_date date,
                    invoice_price numeric,product_use text,formula_name text,carton_group text,material_snapshot jsonb,carton_no text);
                CREATE TABLE audit_logs(user_id int,username text,module text,action text,entity_type text,entity_id text,
                    summary text,details jsonb,ip_address text);
                CREATE TABLE products(code text PRIMARY KEY,customer text);
                CREATE TABLE schedules(customer text NOT NULL DEFAULT 'TOMY',raw_rows jsonb);
                INSERT INTO products(code,customer) VALUES ('35874','TOMY'),('35875','TOMY'),('35876','TOMY');
                INSERT INTO purchase_orders(id,po_no,supplier,order_date,delivery_date,notes) VALUES
                    (1,'20269001','Supplier','2026-10-19','2026-10-23','first'),
                    (2,'20269002','Supplier','2026-10-19','2026-10-28','second'),
                    (3,'20269003','Supplier','2026-10-19','2026-11-01','third');
                INSERT INTO po_items(id,po_id,product_code,material_id,material_name,qty,purchase_qty,price,currency,tomy_po,eta) VALUES
                    (1,1,'35874',11,'FSC1',20200,20200,0.08,'¥','TOMY1','2026-12-01'),
                    (2,2,'35875',12,'FSC2',20200,20200,0.07,'RMB','TOMY2','2026-12-02'),
                    (3,3,'35876',13,'FSC3',10,10,0.00529,'¥','TOMY3','2026-12-03');
                """);
            await db.ExecuteAsync(PurchaseMergeSchema.SchemaSql);
            await db.ExecuteAsync(PurchaseMergeSchema.SchemaSql); // upgrade is idempotent
            return new() { Db = db, Schema = schema, ConnectionString = cs };
        }
        public async ValueTask DisposeAsync()
        {
            try { await Db.ExecuteAsync($"DROP SCHEMA {Schema} CASCADE"); }
            finally { await Db.DisposeAsync(); }
        }
    }
}
