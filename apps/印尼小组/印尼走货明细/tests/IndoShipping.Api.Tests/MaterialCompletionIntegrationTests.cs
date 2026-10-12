using System.Text.Json;
using Dapper;
using IndoShipping.Api.Controllers;
using IndoShipping.Api.Features.Bootstrap;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Xunit;

namespace IndoShipping.Api.Tests;

public class MaterialCompletionIntegrationTests
{
    [Fact]
    public async Task New_week_keeps_completion_without_duplicate_demand_or_fake_stock()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Acknowledge();
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":10}]""");
        var items = await f.Read();
        Assert.Equal(2, items.GetArrayLength());
        Assert.All(items.EnumerateArray(), x => {
            Assert.True(x.GetProperty("manual_completed").GetBoolean());
            Assert.Equal("covered", x.GetProperty("status").GetString());
            Assert.Equal(0, x.GetProperty("shortage_qty").GetDecimal());
            Assert.Equal(0, x.GetProperty("received_qty").GetDecimal());
            Assert.Equal(0, x.GetProperty("outbound_qty").GetDecimal());
        });
        Assert.Equal(20, Purchase(items).GetProperty("required_qty").GetDecimal());
        foreach (var table in new[] { "po_items", "po_receipts", "outbound" })
            Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {table}"));
    }

    [Fact]
    public async Task Same_week_overwrite_retains_history_and_tracks_only_extra_quantity()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Acknowledge();
        var originalId = await f.Db.ExecuteScalarAsync<long>("SELECT min(id) FROM material_tracking_history");
        await f.Upload("10-01", """[{"code":"A","orderNo":"PO1","qty":15}]""");
        var item = Purchase(await f.Read());
        Assert.Equal(30, item.GetProperty("required_qty").GetDecimal());
        Assert.Equal(10, item.GetProperty("shortage_qty").GetDecimal());
        Assert.False(item.GetProperty("manual_completed").GetBoolean());
        Assert.Equal(20, item.GetProperty("order_details")[0].GetProperty("manual_qty").GetDecimal());
        var old = Purchase(await f.Read(originalId));
        Assert.Equal(20, old.GetProperty("required_qty").GetDecimal());
        Assert.True(old.GetProperty("manual_completed").GetBoolean());
        Assert.Equal(2, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM material_tracking_history"));
        await f.Upload("10-01", """[{"code":"A","orderNo":"PO1","qty":10}]""");
        Assert.Equal(3, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM material_tracking_history"));
        var history = Assert.IsType<OkObjectResult>(await f.Alerts.History());
        Assert.Equal(3, JsonSerializer.SerializeToElement(history.Value).GetArrayLength());
        Assert.IsType<NotFoundObjectResult>(await f.Alerts.List(long.MaxValue));
    }

    [Fact]
    public async Task Backdated_same_week_upload_still_uses_the_new_revision_and_tracks_extra_quantity()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Acknowledge();
        var oldVersion = await f.Db.ExecuteScalarAsync<long>("SELECT min(id) FROM material_tracking_history");
        await f.Upload("10-01", """[{"code":"A","orderNo":"PO1","qty":15}]""", new DateTime(2026, 9, 30));
        var current = Purchase(await f.Read());
        Assert.Equal(30, current.GetProperty("required_qty").GetDecimal());
        Assert.Equal(10, current.GetProperty("shortage_qty").GetDecimal());
        Assert.False(current.GetProperty("manual_completed").GetBoolean());
        var historical = Purchase(await f.Read(oldVersion));
        Assert.Equal(20, historical.GetProperty("required_qty").GetDecimal());
        Assert.True(historical.GetProperty("manual_completed").GetBoolean());
    }

    [Fact]
    public async Task Missing_old_orders_remain_but_new_orders_do_not_inherit_completion()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Acknowledge();
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO2","qty":5}]""");
        var item = Purchase(await f.Read());
        Assert.Equal(30, item.GetProperty("required_qty").GetDecimal());
        Assert.Equal(10, item.GetProperty("shortage_qty").GetDecimal());
        var details = item.GetProperty("order_details").EnumerateArray().ToList();
        Assert.Equal("已送完(手动)", details.Single(x => x.GetProperty("order_no").GetString() == "PO1").GetProperty("status").GetString());
        Assert.Equal(0, details.Single(x => x.GetProperty("order_no").GetString() == "PO2").GetProperty("manual_qty").GetDecimal());
        var version = await f.Db.ExecuteScalarAsync<long>("SELECT max(id) FROM material_tracking_history");
        Assert.Equal(10, Purchase(await f.Read(version)).GetProperty("required_qty").GetDecimal());
    }

    [Fact]
    public async Task Customer_full_product_variant_and_new_material_have_separate_identities()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Acknowledge();
        await f.Db.ExecuteAsync("INSERT INTO materials VALUES(2,'A','M2','新物料','五金','测试供应商',1,true,2)");
        await f.Upload("10-10", """
            [{"code":"A","orderNo":"PO1","qty":10},
             {"code":"A","customer":"other","orderNo":"PO1","qty":10},
             {"code":"A-VARIANT","orderNo":"PO1","qty":10}]
            """);
        var items = await f.Read();
        var original = items.EnumerateArray().Single(x => x.GetProperty("material_id").GetInt32() == 1);
        Assert.Equal(60, original.GetProperty("required_qty").GetDecimal());
        Assert.Equal(40, original.GetProperty("shortage_qty").GetDecimal());
        var added = items.EnumerateArray().Single(x => x.GetProperty("material_id").GetInt32() == 2);
        Assert.Equal(30, added.GetProperty("shortage_qty").GetDecimal());
        Assert.False(added.GetProperty("manual_completed").GetBoolean());
    }

    [Fact]
    public async Task Frozen_BOM_preserves_history_and_usage_increase_does_not_inherit_extra_completion()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Acknowledge();
        var version = await f.Db.ExecuteScalarAsync<long>("SELECT min(id) FROM material_tracking_history");
        await f.Db.ExecuteAsync("UPDATE materials SET usage_qty=3");
        Assert.Equal(10, Purchase(await f.Read()).GetProperty("shortage_qty").GetDecimal());
        Assert.Equal(20, Purchase(await f.Read(version)).GetProperty("required_qty").GetDecimal());
        await f.Db.ExecuteAsync("UPDATE materials SET active=false");
        Assert.Equal(20, Purchase(await f.Read(version)).GetProperty("required_qty").GetDecimal());
    }

    [Fact]
    public async Task Duplicate_lines_sum_within_revision_and_zero_demand_does_not_resurrect_old_quantity()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":4},{"code":"A","orderNo":"PO1","qty":6}]""");
        Assert.Equal(20, Purchase(await f.Read()).GetProperty("required_qty").GetDecimal());
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":0},{"code":"A","orderNo":"PO1","qty":5}]""");
        Assert.Equal(10, Purchase(await f.Read()).GetProperty("required_qty").GetDecimal());
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":0}]""");
        Assert.Empty((await f.Read()).EnumerateArray());
    }

    [Fact]
    public async Task Zero_order_quantity_cancels_historical_materials_even_after_BOM_replacement()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var oldVersion = await f.Db.ExecuteScalarAsync<long>("SELECT min(id) FROM material_tracking_history");
        await f.Db.ExecuteAsync("UPDATE materials SET active=false; INSERT INTO materials VALUES(2,'A','M2','替换物料','五金','测试供应商',1,true,2)");
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":0}]""");
        Assert.Empty((await f.Read()).EnumerateArray());
        Assert.Equal(20, Purchase(await f.Read(oldVersion)).GetProperty("required_qty").GetDecimal());
    }

    [Fact]
    public async Task Cancellation_does_not_remove_other_orders_customers_or_full_product_variants()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Upload("10-02", """
            [{"code":"A","orderNo":"PO1","qty":10},
             {"code":"A","orderNo":"PO2","qty":5},
             {"code":"A","customer":"other","orderNo":"PO1","qty":7},
             {"code":"A-VARIANT","orderNo":"PO1","qty":9}]
            """);
        await f.Db.ExecuteAsync("UPDATE materials SET active=false; INSERT INTO materials VALUES(2,'A','M2','替换物料','五金','测试供应商',1,true,2)");
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":0}]""");
        var item = Purchase(await f.Read());
        Assert.Equal(42, item.GetProperty("required_qty").GetDecimal());
        var details = item.GetProperty("order_details").EnumerateArray().ToList();
        Assert.Equal(3, details.Count);
        Assert.DoesNotContain(details, d => d.GetProperty("order_no").GetString() == "PO1"
            && d.GetProperty("customer").GetString() == ""
            && d.GetProperty("product_code").GetString() == "A");
    }

    [Fact]
    public async Task Missing_order_number_is_not_matched_between_revisions()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        // Replace the bootstrap source before testing unidentified rows.
        await f.Db.ExecuteAsync("DELETE FROM material_tracking_history; DELETE FROM schedules");
        await f.Upload("10-01", """[{"code":"A","qty":10}]""");
        await f.Acknowledge();
        await f.Upload("10-10", """[{"code":"A","qty":10}]""");
        var items = await f.Read();
        Assert.Equal(20, Purchase(items).GetProperty("required_qty").GetDecimal());
        Assert.All(items.EnumerateArray(), x => Assert.False(x.GetProperty("manual_completed").GetBoolean()));
    }

    [Fact]
    public async Task Legacy_null_schedule_rows_do_not_break_history_bootstrap()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("INSERT INTO schedules(week_label,raw_rows) VALUES('空排期',NULL)");
        await f.Upload("10-10", "[]");
        Assert.Equal(3, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM material_tracking_history"));
        Assert.Equal(20, Purchase(await f.Read()).GetProperty("required_qty").GetDecimal());
    }

    [Fact]
    public async Task Invalid_or_stale_hash_does_not_fabricate_completion()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        foreach (var value in new[] { "not-json", "[]", "{\"1\":true}", "{\"1\":\"wrong\"}" })
        {
            await f.Db.ExecuteAsync("INSERT INTO settings VALUES('material_tracking_completed_schedules',@value) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", new { value });
            Assert.All((await f.Read()).EnumerateArray(), x => Assert.False(x.GetProperty("manual_completed").GetBoolean()));
        }
    }

    private static JsonElement Purchase(JsonElement items) => items.EnumerateArray()
        .Single(x => x.GetProperty("tracking_type").GetString() == "purchase");

    private sealed class Fixture(NpgsqlConnection admin, NpgsqlConnection db, string schema, string connection) : IAsyncDisposable
    {
        public NpgsqlConnection Db => db;
        public MaterialAlertsController Alerts { get; } = new(new SqlConnectionFactory(connection));
        public async Task<JsonElement> Read(long? revision = null) => JsonSerializer.SerializeToElement(
            Assert.IsType<OkObjectResult>(await Alerts.List(revision)).Value).GetProperty("items");
        public async Task Acknowledge() => await db.ExecuteAsync("""
            INSERT INTO settings VALUES('material_tracking_completed_schedules',
                (SELECT jsonb_object_agg(id::text,md5(raw_rows::text))::text FROM schedules))
            ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value
            """);
        public async Task Upload(string label, string rows, DateTime? uploadDate = null) => Assert.IsType<OkObjectResult>(
            await new SchedulesController(new SqlConnectionFactory(connection)).Create(new SchedulesController.CreateBody {
                week_label = label, upload_date = uploadDate ?? new DateTime(2026, 10, 10), raw_rows = JsonSerializer.Deserialize<JsonElement>(rows)
            }));
        public static async Task<Fixture?> Create()
        {
            var connection = Environment.GetEnvironmentVariable("SUPPLIER_SYNC_TEST_CONNECTION");
            if (string.IsNullOrWhiteSpace(connection)) return null;
            var schema = "tracking_test_" + Guid.NewGuid().ToString("N");
            var admin = new NpgsqlConnection(connection); await admin.OpenAsync();
            await admin.ExecuteAsync($"CREATE SCHEMA {schema}");
            var scoped = new NpgsqlConnectionStringBuilder(connection) { SearchPath = schema }.ConnectionString;
            var db = new NpgsqlConnection(scoped); await db.OpenAsync();
            var fixture = new Fixture(admin, db, schema, scoped);
            try
            {
                await db.ExecuteAsync("""
                    CREATE TABLE schedules(id int GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, week_label text UNIQUE,
                        upload_date timestamp, raw_rows jsonb, diff_from_prev jsonb);
                    CREATE TABLE settings(key text PRIMARY KEY, value text);
                    CREATE TABLE material_lead_profiles(product_code text, product_name text, category text,
                        component_name text, lead_days int, capacity_per_day numeric, active boolean);
                    CREATE TABLE materials(id int, product_code text, item_no text, name_zh text, category text,
                        supplier text, usage_qty numeric, active boolean, sort_order int);
                    CREATE TABLE products(code text, name text, moldings jsonb, active boolean);
                    CREATE TABLE po_items(id int, material_id int, purchase_qty numeric, qty numeric);
                    CREATE TABLE po_receipts(po_item_id int, qty numeric);
                    CREATE TABLE outbound(po_item_id int, qty numeric);
                    INSERT INTO schedules(week_label,upload_date,raw_rows) VALUES('10-01','2026-10-01',
                        '[{"code":"A","orderNo":"PO1","qty":10}]');
                    INSERT INTO materials VALUES(1,'A','M1','测试物料','五金','测试供应商',2,true,1);
                    INSERT INTO products VALUES('A','测试产品',
                        '[{"moldId":"M1","moldName":"模具","category":"塑胶","parts":[]}]',true);
                    """);
                await db.ExecuteAsync(MaterialTrackingHistory.SchemaSql);
                await using var tx = await db.BeginTransactionAsync();
                await MaterialTrackingHistory.CaptureAsync(db, tx);
                await tx.CommitAsync();
                return fixture;
            }
            catch { await fixture.DisposeAsync(); throw; }
        }
        public async ValueTask DisposeAsync()
        {
            await db.DisposeAsync();
            await admin.ExecuteAsync($"DROP SCHEMA {schema} CASCADE");
            await admin.DisposeAsync();
        }
    }
}
