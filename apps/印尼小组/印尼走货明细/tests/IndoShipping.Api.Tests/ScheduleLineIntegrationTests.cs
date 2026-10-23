using System.Text.Json;
using Dapper;
using IndoShipping.Api.Controllers;
using IndoShipping.Api.Features.Bootstrap;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Xunit;

namespace IndoShipping.Api.Tests;

public class ScheduleLineIntegrationTests
{
    [Fact]
    public async Task Existing_history_and_new_upload_use_the_same_line_matching_without_changing_manual_flags()
    {
        var connection = Environment.GetEnvironmentVariable("SUPPLIER_SYNC_TEST_CONNECTION");
        if (string.IsNullOrWhiteSpace(connection)) return;
        var schema = "schedule_line_test_" + Guid.NewGuid().ToString("N");
        var options = new NpgsqlConnectionStringBuilder(connection) { SearchPath = schema };
        await using var db = new NpgsqlConnection(options.ConnectionString);
        await db.OpenAsync();
        await db.ExecuteAsync($"CREATE SCHEMA {schema}");
        try
        {
            await db.ExecuteAsync("""
                CREATE TABLE schedules(id serial PRIMARY KEY, week_label text UNIQUE, upload_date timestamp,
                    raw_rows jsonb, diff_from_prev jsonb);
                CREATE TABLE settings(key text PRIMARY KEY, value text);
                CREATE TABLE materials(id int, product_code text, item_no text, name_zh text, category text,
                    supplier text, usage_qty numeric, active boolean);
                CREATE TABLE products(code text, name text, moldings jsonb, active boolean);
                INSERT INTO settings VALUES ('schedule_placed_manual','["MA|47712A"]');
                """);
            await db.ExecuteAsync(MaterialTrackingHistory.SchemaSql);
            await db.ExecuteAsync(ScheduleCustomerSchema.SchemaSql);
            var controller = new SchedulesController(new SqlConnectionFactory(options.ConnectionString));
            const string old = """{"source":"KIK","customer":"TOMY","code":"47712A","orderNo":"MA","qty":100,"eta":"2026-11-01"}""";
            const string added = """{"source":"KIK","customer":"TOMY","code":"47712A","orderNo":"MA","qty":200,"eta":"2026-12-01"}""";
            await db.ExecuteAsync("""
                INSERT INTO schedules(week_label,upload_date,raw_rows,diff_from_prev)
                VALUES ('2026-W42','2026-10-12',CAST(@old AS jsonb),'{}'),
                       ('26-10-19','2026-10-19',CAST(@current AS jsonb),'{}');
                """, new { old = $"[{old}]", current = $"[{old},{added}]" });
            var beforeRaw = await db.ExecuteScalarAsync<string>("SELECT raw_rows::text FROM schedules WHERE id=2");
            var view = JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(await controller.Get(2)).Value);
            using var rows = JsonDocument.Parse(view.GetProperty("raw_rows").GetString()!);
            using var diff = JsonDocument.Parse(view.GetProperty("diff_from_prev").GetString()!);
            Assert.Equal(1, diff.RootElement.GetProperty("added").GetArrayLength());
            Assert.True(rows.RootElement[0].GetProperty("_legacyPlacedEligible").GetBoolean());
            Assert.False(rows.RootElement[1].GetProperty("_legacyPlacedEligible").GetBoolean());
            var oldId = rows.RootElement[0].GetProperty("_scheduleLineId").GetString();
            var newId = rows.RootElement[1].GetProperty("_scheduleLineId").GetString();
            Assert.NotEqual(oldId, newId);
            Assert.Equal(beforeRaw, await db.ExecuteScalarAsync<string>("SELECT raw_rows::text FROM schedules WHERE id=2"));
            Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM settings WHERE key='schedule_line_identities'"));
            Assert.Equal("[\"MA|47712A\"]", await db.ExecuteScalarAsync<string>("SELECT value FROM settings WHERE key='schedule_placed_manual'"));

            // Re-upload with rows reversed: no deduplication, old/new identities remain stable.
            Assert.IsType<OkObjectResult>(await controller.Create(new()
            {
                week_label = "26-10-19", upload_date = new DateTime(2026, 10, 19),
                raw_rows = JsonSerializer.Deserialize<JsonElement>($"[{added},{old}]"),
            }));
            view = JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(await controller.Get(2)).Value);
            using var reordered = JsonDocument.Parse(view.GetProperty("raw_rows").GetString()!);
            Assert.Equal(newId, reordered.RootElement[0].GetProperty("_scheduleLineId").GetString());
            Assert.Equal(oldId, reordered.RootElement[1].GetProperty("_scheduleLineId").GetString());
            using var storedDiff = JsonDocument.Parse((await db.ExecuteScalarAsync<string>("SELECT diff_from_prev::text FROM schedules WHERE id=2"))!);
            Assert.Equal(1, storedDiff.RootElement.GetProperty("added").GetArrayLength());
        }
        finally { await db.ExecuteAsync($"DROP SCHEMA {schema} CASCADE"); }
    }

    [Fact]
    public async Task Reupload_and_earlier_backfill_preserve_manual_ids_existing_raw_and_material_completion_hashes()
    {
        var connection = Environment.GetEnvironmentVariable("SUPPLIER_SYNC_TEST_CONNECTION");
        if (string.IsNullOrWhiteSpace(connection)) return;
        var schema = "schedule_identity_test_" + Guid.NewGuid().ToString("N");
        var options = new NpgsqlConnectionStringBuilder(connection) { SearchPath = schema };
        await using var db = new NpgsqlConnection(options.ConnectionString);
        await db.OpenAsync();
        await db.ExecuteAsync($"CREATE SCHEMA {schema}");
        try
        {
            await db.ExecuteAsync("""
                CREATE TABLE schedules(id serial PRIMARY KEY, week_label text UNIQUE, upload_date timestamp,
                    raw_rows jsonb, diff_from_prev jsonb);
                CREATE TABLE settings(key text PRIMARY KEY, value text);
                CREATE TABLE materials(id int, product_code text, item_no text, name_zh text, category text,
                    supplier text, usage_qty numeric, active boolean);
                CREATE TABLE products(code text, name text, moldings jsonb, active boolean);
                """);
            await db.ExecuteAsync(MaterialTrackingHistory.SchemaSql);
            await db.ExecuteAsync(ScheduleCustomerSchema.SchemaSql);
            const string old = """{"source":"KIK","customer":"TOMY","code":"47712A","orderNo":"MA","qty":100,"eta":"2026-11-01"}""";
            const string added = """{"source":"KIK","customer":"TOMY","code":"47800A","orderNo":"MA","qty":200,"eta":"2026-12-01"}""";
            await db.ExecuteAsync("""
                INSERT INTO schedules(week_label,upload_date,raw_rows,diff_from_prev)
                VALUES ('2026-W42','2026-10-12',CAST(@old AS jsonb),'{}'),
                       ('2026-W43','2026-10-19',CAST(@current AS jsonb),'{}');
                INSERT INTO settings VALUES ('material_tracking_completed_schedules',
                    (SELECT jsonb_build_object('1',md5(raw_rows::text))::text FROM schedules WHERE id=1));
                """, new { old = $"[{old}]", current = $"[{old},{added}]" });
            var controller = new SchedulesController(new SqlConnectionFactory(options.ConnectionString));
            async Task<JsonElement> Rows(int id)
            {
                var view = JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(await controller.Get(id)).Value);
                return JsonSerializer.Deserialize<JsonElement>(view.GetProperty("raw_rows").GetString()!);
            }
            var initial = await Rows(2);
            var oldId = initial[0].GetProperty("_scheduleLineId").GetString()!;
            var newId = initial[1].GetProperty("_scheduleLineId").GetString()!;
            var manual = JsonSerializer.Serialize(new[] { oldId, newId, "MA|47712A" });
            var production = JsonSerializer.Serialize(new Dictionary<string, bool> { [newId] = true });
            await db.ExecuteAsync("""
                INSERT INTO settings VALUES ('schedule_placed_manual',@manual),('schedule_production_placed_manual',@production);
                """, new { manual, production });
            var originalRaw = await db.ExecuteScalarAsync<string>("SELECT raw_rows::text FROM schedules WHERE id=1");
            var originalHash = await db.ExecuteScalarAsync<string>("SELECT md5(raw_rows::text) FROM schedules WHERE id=1");
            var completion = await db.ExecuteScalarAsync<string>("SELECT value FROM settings WHERE key='material_tracking_completed_schedules'");
            var changed = added.Replace("200", "250").Replace("2026-12-01", "2026-12-08");
            changed = changed[..^1] + ",\"_scheduleLineId\":\"line:forged\",\"_legacyPlacedEligible\":true}";
            Assert.IsType<OkObjectResult>(await controller.Create(new()
            {
                week_label = "2026-W43", upload_date = new DateTime(2026, 10, 19),
                raw_rows = JsonSerializer.Deserialize<JsonElement>($"[{changed},{old}]"),
            }));
            var edited = await Rows(2);
            Assert.Equal(newId, edited[0].GetProperty("_scheduleLineId").GetString());
            Assert.Equal(oldId, edited[1].GetProperty("_scheduleLineId").GetString());
            Assert.Equal(originalRaw, await db.ExecuteScalarAsync<string>("SELECT raw_rows::text FROM schedules WHERE id=1"));
            Assert.Equal(originalHash, await db.ExecuteScalarAsync<string>("SELECT md5(raw_rows::text) FROM schedules WHERE id=1"));
            var currentRaw = await db.ExecuteScalarAsync<string>("SELECT raw_rows::text FROM schedules WHERE id=2");
            Assert.DoesNotContain("_schedule", currentRaw);
            Assert.DoesNotContain("_legacy", currentRaw);
            Assert.True(await db.ExecuteScalarAsync<bool>("SELECT acknowledged FROM material_tracking_history WHERE schedule_id=1 ORDER BY id DESC LIMIT 1"));
            Assert.IsType<OkObjectResult>(await controller.Create(new()
            {
                week_label = "2026-W41", upload_date = new DateTime(2026, 10, 20),
                raw_rows = JsonSerializer.Deserialize<JsonElement>($"[{old}]"),
            }));
            var after = await Rows(2);
            Assert.Equal(newId, after[0].GetProperty("_scheduleLineId").GetString());
            Assert.Equal(oldId, after[1].GetProperty("_scheduleLineId").GetString());
            var backfillId = await db.ExecuteScalarAsync<int>("SELECT id FROM schedules WHERE week_label='2026-W41'");
            var earlier = await Rows(backfillId);
            Assert.Equal(oldId, earlier[0].GetProperty("_scheduleLineId").GetString());
            Assert.True(earlier[0].GetProperty("_legacyPlacedEligible").GetBoolean());
            Assert.True(earlier[0].GetProperty("_legacyProductionEligible").GetBoolean());
            var firstView = JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(await controller.Get(1)).Value);
            var firstDiff = JsonSerializer.Deserialize<JsonElement>(firstView.GetProperty("diff_from_prev").GetString()!);
            Assert.Equal(0, firstDiff.GetProperty("added").GetArrayLength());
            Assert.Equal(0, firstDiff.GetProperty("removed").GetArrayLength());
            Assert.Equal(0, firstDiff.GetProperty("changed").GetArrayLength());
            Assert.Equal(originalRaw, await db.ExecuteScalarAsync<string>("SELECT raw_rows::text FROM schedules WHERE id=1"));
            Assert.Equal(currentRaw, await db.ExecuteScalarAsync<string>("SELECT raw_rows::text FROM schedules WHERE id=2"));
            Assert.Equal(completion, await db.ExecuteScalarAsync<string>("SELECT value FROM settings WHERE key='material_tracking_completed_schedules'"));
            Assert.Equal(manual, await db.ExecuteScalarAsync<string>("SELECT value FROM settings WHERE key='schedule_placed_manual'"));
            Assert.Equal(production, await db.ExecuteScalarAsync<string>("SELECT value FROM settings WHERE key='schedule_production_placed_manual'"));
            var beforeGet = await db.ExecuteScalarAsync<string>("SELECT jsonb_agg(to_jsonb(s) ORDER BY key)::text FROM settings s");
            await Rows(2); await Rows(backfillId);
            Assert.Equal(beforeGet, await db.ExecuteScalarAsync<string>("SELECT jsonb_agg(to_jsonb(s) ORDER BY key)::text FROM settings s"));
        }
        finally { await db.ExecuteAsync($"DROP SCHEMA {schema} CASCADE"); }
    }
}
