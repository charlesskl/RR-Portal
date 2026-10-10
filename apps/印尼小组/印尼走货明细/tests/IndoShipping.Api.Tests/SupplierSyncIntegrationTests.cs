using Dapper;
using IndoShipping.Api.Controllers;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Xunit;
using Npgsql;

namespace IndoShipping.Api.Tests;

public class SupplierSyncIntegrationTests
{
    [Fact]
    public async Task Register_once_switch_without_renaming_and_edit_by_id()
    {
        await using var fixture = await Fixture.Create();
        if (fixture is null) return;
        var factory = fixture.Factory;
        var c = fixture.Connection;
        var controller = new DictionariesController(factory);
        var registration = new DictionariesController.SupplierSyncBody {
            entries = [new() { supplier = "公司A" }, new() { supplier = "公司A" }] };
        Assert.IsType<OkObjectResult>(await controller.SyncSuppliers(registration));
        Assert.IsType<OkObjectResult>(await controller.SyncSuppliers(registration));
        Assert.Equal(1, await c.ExecuteScalarAsync<int>("SELECT count(*) FROM dict_supplier"));
        Assert.IsType<OkObjectResult>(await controller.SyncSuppliers(new() {
            confirmChanges = true, entries = [new() { supplier = "公司B", previousSupplier = "公司A" }] }));
        Assert.Equal(2, await c.ExecuteScalarAsync<int>("SELECT count(*) FROM dict_supplier"));
        var id = await c.ExecuteScalarAsync<int>("SELECT id FROM dict_supplier WHERE full_name='公司A'");
        await c.ExecuteAsync(@"INSERT INTO materials VALUES ('公司A', '');
            INSERT INTO shipment_items VALUES ('公司A', '');
            INSERT INTO purchase_orders VALUES ('公司A');");
        Assert.IsType<OkObjectResult>(await controller.UpdateSupplier(id, new() {
            keyword = "简称A", full = "新全称A", customs = "报关公司", nameEn = "Company",
            addressZh = "地址", addressEn = "Address", phone = "123", email = "a@example.com", contact = "联系人" }));
        Assert.Equal("新全称A", await c.ExecuteScalarAsync<string>("SELECT full_name FROM dict_supplier WHERE id=@id", new { id }));
        foreach (var table in new[] { "materials", "shipment_items", "purchase_orders" })
            Assert.Equal("简称A", await c.ExecuteScalarAsync<string>($"SELECT supplier FROM {table}"));
        Assert.Equal("地址", await c.ExecuteScalarAsync<string>("SELECT address_zh FROM dict_supplier WHERE id=@id", new { id }));
        await controller.SyncSuppliers(new() { entries = [new() { supplier = "简称A" }, new() { supplier = "新全称A" }] });
        Assert.Equal(2, await c.ExecuteScalarAsync<int>("SELECT count(*) FROM dict_supplier"));
        Assert.Equal("公司B", await c.ExecuteScalarAsync<string>("SELECT full_name FROM dict_supplier WHERE id<>@id", new { id }));
    }

    [Fact]
    public async Task Concurrent_renames_keep_references_on_the_final_supplier()
    {
        await using var fixture = await Fixture.Create();
        if (fixture is null) return;
        var c = fixture.Connection;
        var controller = new DictionariesController(fixture.Factory);
        await controller.SyncSuppliers(new() { entries = [new() { supplier = "Old" }] });
        var id = await c.ExecuteScalarAsync<int>("SELECT id FROM dict_supplier");
        await c.ExecuteAsync(@"INSERT INTO materials VALUES ('Old',''); INSERT INTO shipment_items VALUES ('Old','');
            INSERT INTO purchase_orders VALUES ('Old');
            CREATE FUNCTION slow_write() RETURNS trigger LANGUAGE plpgsql AS
            'BEGIN PERFORM pg_sleep(0.2); RETURN NEW; END';
            CREATE TRIGGER slow_update BEFORE UPDATE ON dict_supplier FOR EACH ROW EXECUTE FUNCTION slow_write();");
        var first = controller.UpdateSupplier(id, new() { keyword = "First", full = "First Company" });
        await Task.Delay(30);
        var second = controller.UpdateSupplier(id, new() { keyword = "Second", full = "Second Company" });
        foreach (var result in await Task.WhenAll(first, second)) Assert.IsType<OkObjectResult>(result);
        var names = (await c.QueryAsync<string>("SELECT keyword FROM dict_supplier UNION SELECT full_name FROM dict_supplier")).ToArray();
        foreach (var table in new[] { "materials", "shipment_items", "purchase_orders" })
            Assert.Contains(await c.ExecuteScalarAsync<string>($"SELECT supplier FROM {table}"), names);
    }

    [Fact]
    public async Task Concurrent_registration_and_profile_creation_do_not_duplicate_supplier()
    {
        await using var fixture = await Fixture.Create();
        if (fixture is null) return;
        var c = fixture.Connection;
        var controller = new DictionariesController(fixture.Factory);
        await c.ExecuteAsync(@"CREATE FUNCTION slow_write() RETURNS trigger LANGUAGE plpgsql AS
            'BEGIN PERFORM pg_sleep(0.2); RETURN NEW; END';
            CREATE TRIGGER slow_insert BEFORE INSERT ON dict_supplier FOR EACH ROW EXECUTE FUNCTION slow_write();");
        var registration = controller.SyncSuppliers(new() { entries = [new() { supplier = "Concurrent" }] });
        await Task.Delay(30);
        var creation = controller.CreateSupplier(new() { keyword = "Concurrent", full = "Concurrent" });
        await Task.WhenAll(registration, creation);
        Assert.Equal(1, await c.ExecuteScalarAsync<int>("SELECT count(*) FROM dict_supplier"));
    }

    private sealed class Fixture : IAsyncDisposable
    {
        public required NpgsqlConnection Connection { get; init; }
        public required SqlConnectionFactory Factory { get; init; }
        public required string Schema { get; init; }
        public static async Task<Fixture?> Create()
        {
            // CI/local-only disposable PostgreSQL. Each test owns and removes a unique schema.
            var connection = Environment.GetEnvironmentVariable("SUPPLIER_SYNC_TEST_CONNECTION");
            if (string.IsNullOrWhiteSpace(connection)) return null;
            var schema = "supplier_test_" + Guid.NewGuid().ToString("N");
            var options = new NpgsqlConnectionStringBuilder(connection) { SearchPath = schema };
            var c = new NpgsqlConnection(options.ConnectionString);
            await c.OpenAsync();
            await c.ExecuteAsync($"CREATE SCHEMA {schema}");
            await c.ExecuteAsync(@"
            CREATE TABLE dict_supplier(id serial PRIMARY KEY, keyword varchar(128), full_name varchar(256),
              customs_company text, name_en text, address_zh text, address_en text,
              phone text, email text, contact text, priority integer DEFAULT 0);
            CREATE TABLE materials(supplier text, customs_company text);
            CREATE TABLE shipment_items(supplier text, customs_company text);
            CREATE TABLE purchase_orders(supplier text);");

            return new() { Connection = c, Factory = new(options.ConnectionString), Schema = schema };
        }
        public async ValueTask DisposeAsync()
        {
            try { await Connection.ExecuteAsync($"DROP SCHEMA {Schema} CASCADE"); }
            finally { await Connection.DisposeAsync(); }
        }
    }
}
