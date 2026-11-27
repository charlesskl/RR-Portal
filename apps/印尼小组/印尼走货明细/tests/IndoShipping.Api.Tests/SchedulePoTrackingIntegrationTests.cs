using System.Text.Json;
using Dapper;
using IndoShipping.Api.Controllers;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Xunit;

namespace IndoShipping.Api.Tests;

public sealed class SchedulePoTrackingIntegrationTests
{
    static async Task Database(Func<NpgsqlConnection, SchedulePoTrackingController, Task> test)
    {
        var connection = Environment.GetEnvironmentVariable("SUPPLIER_SYNC_TEST_CONNECTION");
        if (string.IsNullOrWhiteSpace(connection)) return;
        var schema = "po_tracking_" + Guid.NewGuid().ToString("N");
        var options = new NpgsqlConnectionStringBuilder(connection) { SearchPath = schema };
        await using var db = new NpgsqlConnection(options.ConnectionString);
        await db.OpenAsync();
        await db.ExecuteAsync($"CREATE SCHEMA {schema}");
        try
        {
            await db.ExecuteAsync("""
                CREATE TABLE schedules(id int PRIMARY KEY,customer text,raw_rows jsonb);
                CREATE TABLE materials(id int PRIMARY KEY,name_zh text,spec text);
                CREATE TABLE purchase_orders(id int PRIMARY KEY,po_no text,supplier text);
                CREATE TABLE po_items(id int PRIMARY KEY,po_id int,source_po_no text,product_code text,tomy_po text,
                    material_id int,material_name text,spec text,purchase_unit text,purchase_qty numeric,qty numeric);
                CREATE TABLE po_receipts(id int PRIMARY KEY,po_item_id int,qty numeric,spare_qty numeric);
                CREATE TABLE outbound(id int PRIMARY KEY,po_item_id int,po_no text,material_id int,qty numeric,out_date date);
                CREATE TABLE shipments(id int PRIMARY KEY,status text,container_no text,ship_date date,load_date date);
                CREATE TABLE shipment_items(id int PRIMARY KEY,shipment_id int,outbound_id int,material_id int,
                    po_no text,purchase_unit text,qty numeric);
                INSERT INTO schedules VALUES (1,'TOMY','[{"source":"KIK","code":"47712A","orderNo":"MA-1","productName":"示例","eta":"2026-12-05"}]'),
                    (2,'TOMY','[{"source":"KIK","code":"47712A","orderNo":"MA-1"}]'),
                    (3,'TOMY','[{"source":"RRM","code":"47712A","orderNo":"MA-1"}]');
                INSERT INTO materials VALUES(7,'彩盒','规格');
                INSERT INTO purchase_orders VALUES (1,'IRRIHS0443','测试供应商'),(2,'IRRMHS0443','其他来源');
                INSERT INTO po_items VALUES(1,1,NULL,'47712A','MA-1',7,'彩盒','规格','个',2500,2500),
                    (2,2,NULL,'47712A','MA-1',7,'彩盒','规格','个',5000,5000);
                INSERT INTO po_receipts VALUES(1,1,1000,10),(2,1,1500,15);
                INSERT INTO outbound VALUES(10,1,'IRRIHS0443',7,2525,'2026-11-17');
                INSERT INTO shipments VALUES(1,'arrived','TEST-A','2026-11-18','2026-11-17'),
                    (2,'shipped','TEST-B','2026-11-24','2026-11-23'),(3,'loaded','TEST-C',NULL,'2026-11-27');
                INSERT INTO shipment_items VALUES(1,1,10,7,'IRRIHS0443','PCS',1000),
                    (2,2,10,7,'IRRIHS0443','PCS',500),(3,3,10,7,'IRRIHS0443','PCS',1025);
                """);
            await test(db, new SchedulePoTrackingController(new SqlConnectionFactory(options.ConnectionString)));
        }
        finally { await db.ExecuteAsync($"DROP SCHEMA {schema} CASCADE"); }
    }
    static async Task<JsonElement> View(SchedulePoTrackingController controller, int id = 1, string order = "MA-1", string code = "47712A", string source = "KIK") =>
        JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(await controller.Get(id, order, code, source)).Value);

    [Fact]
    public async Task Reads_a_consistent_PO_projection_without_fanout_history_duplication_or_writes() => await Database(async (db, controller) =>
    {
        var before = await Snapshot(db);
        var result = await View(controller);
        Assert.Equal(1, result.GetProperty("material_count").GetInt32());
        Assert.Equal(1, result.GetProperty("purchase_order_count").GetInt32());
        var row = Assert.Single(result.GetProperty("materials").EnumerateArray());
        Assert.Equal(2500m, row.GetProperty("received_qty").GetDecimal());
        Assert.Equal(25m, row.GetProperty("received_spare_qty").GetDecimal());
        Assert.Equal(1500m, row.GetProperty("shipped_qty").GetDecimal());
        Assert.Equal(1000m, row.GetProperty("pending_qty").GetDecimal());
        Assert.Equal(25m, row.GetProperty("pending_spare_qty").GetDecimal());
        Assert.Equal(1000m, row.GetProperty("remaining_qty").GetDecimal());
        Assert.Equal(3, row.GetProperty("records").GetArrayLength());
        Assert.Equal(before, await Snapshot(db));
        // Changing the actual shipment status is reflected on the next read, not a cached PO flag.
        await db.ExecuteAsync("UPDATE shipments SET status='shipped' WHERE id=3");
        var refreshed = await View(controller);
        Assert.Equal(1, refreshed.GetProperty("completed_count").GetInt32());
        Assert.Equal(2500m, refreshed.GetProperty("materials")[0].GetProperty("shipped_qty").GetDecimal());
        Assert.Equal(25m, refreshed.GetProperty("materials")[0].GetProperty("shipped_spare_qty").GetDecimal());
        await db.ExecuteAsync("UPDATE shipment_items SET qty=NULL WHERE id=2");
        var missing = await View(controller);
        Assert.Equal(JsonValueKind.Null, missing.GetProperty("materials")[0].GetProperty("shipped_qty").ValueKind);
        Assert.Contains(missing.GetProperty("materials")[0].GetProperty("issues").EnumerateArray(), issue => issue.GetString()!.Contains("数量缺失"));
        Assert.Equal(JsonValueKind.Null, missing.GetProperty("materials")[0].GetProperty("records")[1].GetProperty("qty").ValueKind);
    });

    [Fact]
    public async Task Validates_selected_schedule_and_surfaces_unlinked_and_shared_records_instead_of_zeroes() => await Database(async (db, controller) =>
    {
        Assert.IsType<NotFoundObjectResult>(await controller.Get(99, "MA-1", "47712A", "KIK"));
        Assert.IsType<NotFoundObjectResult>(await controller.Get(1, "MA-10", "47712A", "KIK"));
        Assert.IsType<NotFoundObjectResult>(await controller.Get(1, "MA-1", "47712A", "RRM"));
        Assert.IsType<BadRequestObjectResult>(await controller.Get(1, "", "47712A", "KIK"));
        var rrm = await View(controller, 3, source: "RRM");
        Assert.Equal("IRRMHS0443", rrm.GetProperty("materials")[0].GetProperty("po_no").GetString());
        await db.ExecuteAsync("""
            INSERT INTO shipments VALUES(4,'shipped','UNLINKED','2026-11-26',NULL);
            INSERT INTO shipment_items VALUES(4,4,NULL,7,'IRRIHS0443','PCS',20);
            """);
        var unlinked = await View(controller);
        var row = unlinked.GetProperty("materials")[0];
        Assert.Equal("review", row.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, row.GetProperty("shipped_qty").ValueKind);
        Assert.Equal(4, row.GetProperty("records").GetArrayLength());
        await db.ExecuteAsync("UPDATE po_items SET tomy_po='MA-1；MA-2' WHERE id=1");
        var shared = await View(controller);
        Assert.Equal(JsonValueKind.Null, shared.GetProperty("materials")[0].GetProperty("purchase_qty").ValueKind);
        Assert.Equal(1, shared.GetProperty("review_count").GetInt32());
    });

    [Fact]
    public async Task Draft_does_not_invalidate_a_fully_allocated_batch_until_loaded() => await Database(async (db, controller) =>
    {
        await db.ExecuteAsync("""
            INSERT INTO shipments VALUES(4,'draft','DRAFT',NULL,NULL);
            INSERT INTO shipment_items VALUES(4,4,10,7,'IRRIHS0443','PCS',1);
            """);
        var row = (await View(controller)).GetProperty("materials")[0];
        Assert.Equal(1500m, row.GetProperty("shipped_qty").GetDecimal());
        Assert.Equal(1000m, row.GetProperty("pending_qty").GetDecimal());
        var draft = row.GetProperty("records").EnumerateArray().Single(r => r.GetProperty("status").GetString() == "draft");
        Assert.False(draft.GetProperty("counted").GetBoolean());

        await db.ExecuteAsync("UPDATE shipments SET status='loaded' WHERE id=4");
        var overallocated = (await View(controller)).GetProperty("materials")[0];
        Assert.Equal("review", overallocated.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, overallocated.GetProperty("shipped_qty").ValueKind);
    });

    [Fact]
    public async Task Purchase_quantity_preserves_legacy_fallback_zero_and_unknown() => await Database(async (db, controller) =>
    {
        await db.ExecuteAsync("UPDATE po_items SET purchase_qty=NULL WHERE id=1");
        var legacy = (await View(controller)).GetProperty("materials")[0];
        Assert.Equal(2500m, legacy.GetProperty("purchase_qty").GetDecimal());

        await db.ExecuteAsync("UPDATE po_items SET qty=NULL WHERE id=1");
        var unknown = (await View(controller)).GetProperty("materials")[0];
        Assert.Equal(JsonValueKind.Null, unknown.GetProperty("purchase_qty").ValueKind);
        Assert.Equal(JsonValueKind.Null, unknown.GetProperty("remaining_qty").ValueKind);
        Assert.Equal("review", unknown.GetProperty("status").GetString());

        await db.ExecuteAsync("UPDATE po_items SET purchase_qty=0, qty=2500 WHERE id=1");
        var zero = (await View(controller)).GetProperty("materials")[0];
        Assert.Equal(0m, zero.GetProperty("purchase_qty").GetDecimal());
    });

    static async Task<string?> Snapshot(NpgsqlConnection db) => await db.ExecuteScalarAsync<string>("""
        SELECT jsonb_build_array(
            (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM schedules t),
            (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM po_items t),
            (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM po_receipts t),
            (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM outbound t),
            (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM shipments t),
            (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM shipment_items t))::text
        """);
}
