using System.Text.Json;
using Dapper;
using IndoShipping.Api.Controllers;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Xunit;

namespace IndoShipping.Api.Tests;

public class MaterialCompletionIntegrationTests
{
    [Fact]
    public async Task Snapshot_completes_purchase_and_production_without_creating_stock_and_expires_on_schedule_changes()
    {
        var connection = Environment.GetEnvironmentVariable("SUPPLIER_SYNC_TEST_CONNECTION");
        if (string.IsNullOrWhiteSpace(connection)) return;
        var schema = "completion_test_" + Guid.NewGuid().ToString("N");
        await using var admin = new NpgsqlConnection(connection);
        await admin.OpenAsync();
        await admin.ExecuteAsync($"CREATE SCHEMA {schema}");
        try
        {
            var scoped = new NpgsqlConnectionStringBuilder(connection) { SearchPath = schema }.ConnectionString;
            await using var db = new NpgsqlConnection(scoped);
            await db.OpenAsync();
            await db.ExecuteAsync("""
                CREATE TABLE schedules(id int, week_label text, upload_date timestamp, raw_rows jsonb);
                CREATE TABLE settings(key text PRIMARY KEY, value text);
                CREATE TABLE material_lead_profiles(product_code text, product_name text, category text,
                    component_name text, lead_days int, capacity_per_day numeric, active boolean);
                CREATE TABLE materials(id int, product_code text, item_no text, name_zh text, category text,
                    supplier text, usage_qty numeric, active boolean, sort_order int);
                CREATE TABLE products(code text, name text, moldings jsonb, active boolean);
                CREATE TABLE po_items(id int, material_id int, purchase_qty numeric, qty numeric);
                CREATE TABLE po_receipts(po_item_id int, qty numeric);
                CREATE TABLE outbound(po_item_id int, qty numeric);
                INSERT INTO schedules VALUES(1,'历史排期',CURRENT_TIMESTAMP,
                    '[{"code":"A","orderNo":"PO1","qty":10}]');
                INSERT INTO materials VALUES(1,'A','M1','测试物料','五金','测试供应商',2,true,1);
                INSERT INTO products VALUES('A','测试产品',
                    '[{"moldId":"M1","moldName":"模具","category":"塑胶","parts":[]}]',true);
                """);
            var controller = new MaterialAlertsController(new SqlConnectionFactory(scoped));
            async Task<JsonElement> Read()
            {
                var result = Assert.IsType<OkObjectResult>(await controller.List());
                return JsonSerializer.SerializeToElement(result.Value).GetProperty("items");
            }
            var original = await Read();
            Assert.Equal(2, original.GetArrayLength());
            Assert.All(original.EnumerateArray(), x => Assert.NotEqual("covered", x.GetProperty("status").GetString()));
            await db.ExecuteAsync(@"INSERT INTO settings VALUES('material_tracking_completed_schedules',
                (SELECT jsonb_object_agg(id::text,md5(raw_rows::text))::text FROM schedules))");
            var completed = await Read();
            Assert.All(completed.EnumerateArray(), x => {
                Assert.True(x.GetProperty("manual_completed").GetBoolean());
                Assert.Equal("covered", x.GetProperty("status").GetString());
                Assert.Equal("已送完(手动)", x.GetProperty("workflow_status").GetString());
                Assert.Equal(0, x.GetProperty("shortage_qty").GetDecimal());
                Assert.Equal(0, x.GetProperty("received_qty").GetDecimal());
                Assert.Equal(0, x.GetProperty("outbound_qty").GetDecimal());
                Assert.All(x.GetProperty("order_details").EnumerateArray(), d =>
                    Assert.Equal("已送完(手动)", d.GetProperty("status").GetString()));
            });
            Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM po_items"));
            Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM po_receipts"));
            Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM outbound"));
            // A new upload with identical order data is not part of the acknowledged snapshot.
            await db.ExecuteAsync("INSERT INTO schedules SELECT 2,'新版',CURRENT_TIMESTAMP+interval '1 day',raw_rows FROM schedules WHERE id=1");
            Assert.All((await Read()).EnumerateArray(), x => Assert.False(x.GetProperty("manual_completed").GetBoolean()));
            await db.ExecuteAsync("DELETE FROM schedules WHERE id=2; UPDATE schedules SET raw_rows=jsonb_set(raw_rows,'{0,qty}','20')");
            Assert.All((await Read()).EnumerateArray(), x => Assert.False(x.GetProperty("manual_completed").GetBoolean()));
            await db.ExecuteAsync("UPDATE schedules SET raw_rows=jsonb_set(raw_rows,'{0,qty}','10')");
            foreach (var invalid in new[] { "not-json", "[]", "{\"1\":true}", "{\"1\":\"wrong\"}" })
            {
                await db.ExecuteAsync("UPDATE settings SET value=@invalid", new { invalid });
                Assert.All((await Read()).EnumerateArray(), x => Assert.False(x.GetProperty("manual_completed").GetBoolean()));
            }
        }
        finally { await admin.ExecuteAsync($"DROP SCHEMA {schema} CASCADE"); }
    }
}
