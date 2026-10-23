using System.Text.Json;
using Dapper;
using IndoShipping.Api.Controllers;
using IndoShipping.Api.Features.Bootstrap;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Xunit;

namespace IndoShipping.Api.Tests;

public class ScheduleCustomerIntegrationTests
{
    [Fact]
    public async Task Customer_periods_remain_independent_and_compound_product_codes_round_trip()
    {
        var connection = Environment.GetEnvironmentVariable("SUPPLIER_SYNC_TEST_CONNECTION");
        if (string.IsNullOrWhiteSpace(connection)) return;
        var schema = "schedule_customer_test_" + Guid.NewGuid().ToString("N");
        var options = new NpgsqlConnectionStringBuilder(connection) { SearchPath = schema };
        await using var db = new NpgsqlConnection(options.ConnectionString);
        await db.OpenAsync();
        await db.ExecuteAsync($"CREATE SCHEMA {schema}");
        try
        {
            await db.ExecuteAsync("""
                CREATE TABLE schedules(id serial PRIMARY KEY, week_label text, upload_date timestamp,
                    raw_rows jsonb, diff_from_prev jsonb);
                CREATE UNIQUE INDEX "IX_schedules_week_label" ON schedules(week_label);
                CREATE TABLE settings(key text PRIMARY KEY, value text);
                CREATE TABLE images(id int PRIMARY KEY, data_url text);
                CREATE TABLE materials(id int, product_code text, item_no text, name_zh text, category text,
                    supplier text, usage_qty numeric, active boolean, image_id int, sort_order int);
                CREATE TABLE products(code text PRIMARY KEY, name text, hs_cn text, hs_id text,
                    customer text, moldings jsonb, active boolean DEFAULT true, updated_at timestamp);
                INSERT INTO schedules(week_label,upload_date,raw_rows,diff_from_prev)
                VALUES ('2026-W42','2026-10-12',
                    '[{"customer":"TOMY","code":"47712A","orderNo":"MA","qty":100}]','{}');
                """);
            var before = await db.ExecuteScalarAsync<string>("SELECT raw_rows::text FROM schedules WHERE id=1");
            await db.ExecuteAsync(ScheduleCustomerSchema.SchemaSql);
            await db.ExecuteAsync(ScheduleCustomerSchema.SchemaSql);
            Assert.Equal(before, await db.ExecuteScalarAsync<string>("SELECT raw_rows::text FROM schedules WHERE id=1"));
            await db.ExecuteAsync(MaterialTrackingHistory.SchemaSql);
            var factory = new SqlConnectionFactory(options.ConnectionString);
            var controller = new SchedulesController(factory);
            async Task<int> Upload(string customer, string week, string code, int qty)
            {
                var body = new SchedulesController.CreateBody
                {
                    customer = customer, week_label = week, upload_date = new DateTime(2026, 10, 19),
                    raw_rows = JsonSerializer.SerializeToElement(new[] { new { customer, code, orderNo = "MA", qty } })
                };
                var result = JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(await controller.Create(body)).Value);
                return result.GetProperty("id").GetInt32();
            }
            async Task<JsonElement> View(int id) =>
                JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(await controller.Get(id)).Value);
            const string fullCode = "97282/1099235/6077462";
            var spinId = await Upload("Spin Master", "2026-W42", fullCode, 100);
            Assert.NotEqual(1, spinId);
            Assert.Equal(spinId, await Upload("SPIN MASTER", "2026-W42", fullCode, 200));
            Assert.Equal(2, await db.ExecuteScalarAsync<int>("SELECT count(*) FROM schedules"));
            Assert.Equal(before, await db.ExecuteScalarAsync<string>("SELECT raw_rows::text FROM schedules WHERE id=1"));
            var firstSpinRows = JsonSerializer.Deserialize<JsonElement>((await View(spinId)).GetProperty("raw_rows").GetString()!);
            var tomyId = await Upload("TOMY", "2026-W43", "47712A", 150);
            var spinNextId = await Upload("Spin Master", "2026-W44", fullCode, 250);
            var spinNext = await View(spinNextId);
            var spinNextRows = JsonSerializer.Deserialize<JsonElement>(spinNext.GetProperty("raw_rows").GetString()!);
            Assert.Equal(firstSpinRows[0].GetProperty("_scheduleLineId").GetString(),
                spinNextRows[0].GetProperty("_scheduleLineId").GetString());
            var diff = JsonSerializer.Deserialize<JsonElement>(spinNext.GetProperty("diff_from_prev").GetString()!);
            Assert.Equal(1, diff.GetProperty("changed").GetArrayLength());
            Assert.Equal(0, diff.GetProperty("removed").GetArrayLength());
            var latest = JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(await controller.Latest()).Value);
            var latestRows = JsonSerializer.Deserialize<JsonElement>(latest.GetProperty("raw_rows").GetString()!);
            Assert.Equal(2, latestRows.GetArrayLength());
            Assert.Contains(latest.GetProperty("schedules").EnumerateArray(), r => r.GetProperty("id").GetInt32() == tomyId);
            Assert.Contains(latestRows.EnumerateArray(), r => r.GetProperty("code").GetString() == fullCode && r.GetProperty("qty").GetInt32() == 250);
            Assert.IsType<BadRequestObjectResult>(await controller.Create(new()
            {
                customer = "TOMY", week_label = "2026-W44",
                raw_rows = JsonSerializer.Deserialize<JsonElement>("""[{"customer":"Spin Master","code":"97282"}]""")
            }));

            var products = new ProductsController(factory);
            Assert.IsType<OkObjectResult>(await products.UpsertByCode(fullCode,
                new(fullCode, "10寸阿奇", "", "", "Spin Master", new object[0])));
            var product = JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(await products.GetByCode(fullCode)).Value);
            Assert.Equal(fullCode, product.GetProperty("code").GetString());
            Assert.Equal("Spin Master", product.GetProperty("customer").GetString());
            Assert.IsType<NotFoundObjectResult>(await products.GetByCode("97282"));
        }
        finally { await db.ExecuteAsync($"DROP SCHEMA {schema} CASCADE"); }
    }
}
