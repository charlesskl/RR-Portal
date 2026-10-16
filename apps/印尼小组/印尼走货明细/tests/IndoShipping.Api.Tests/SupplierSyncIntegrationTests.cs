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
    public async Task Delete_reports_each_usage_and_keeps_supplier_until_all_references_are_removed()
    {
        await using var fixture = await Fixture.Create();
        if (fixture is null) return;
        var c = fixture.Connection;
        await AddUsageColumns(c);
        await c.ExecuteAsync(@"
            INSERT INTO dict_supplier(keyword,full_name) VALUES ('Alpha','Alpha Company');
            INSERT INTO materials(supplier,product_code,material_code,name_zh)
                VALUES (' ALPHA ','L21106','01020096','公仔左右手');
            INSERT INTO purchase_orders(supplier,po_no) VALUES ('alpha company','PO001');
            INSERT INTO shipments(id,container_no) VALUES (1,'CONTAINER001');
            INSERT INTO shipment_items(supplier,shipment_id,material_id) VALUES ('Alpha',1,1),('Alpha',99,99);");
        var controller = new DictionariesController(fixture.Factory);
        var conflict = Assert.IsType<ConflictObjectResult>(await controller.DeleteSupplier(1));
        var report = System.Text.Json.JsonSerializer.SerializeToElement(conflict.Value);
        Assert.Equal(4, report.GetProperty("total").GetInt32());
        Assert.False(report.GetProperty("truncated").GetBoolean());
        var usages = report.GetProperty("usages").EnumerateArray().ToArray();
        Assert.Contains(usages, u => u.GetProperty("materialCode").GetString() == "01020096"
            && u.GetProperty("productCode").GetString() == "L21106");
        Assert.Contains(usages, u => u.GetProperty("document").GetString() == "PO001");
        Assert.Contains(usages, u => u.GetProperty("document").GetString() == "CONTAINER001");
        Assert.Contains(usages, u => u.GetProperty("type").GetString() == "走货明细"
            && u.GetProperty("document").ValueKind == System.Text.Json.JsonValueKind.Null);
        Assert.Equal(1, await c.ExecuteScalarAsync<int>("SELECT count(*) FROM dict_supplier"));
        await c.ExecuteAsync("DELETE FROM materials; DELETE FROM purchase_orders; DELETE FROM shipment_items;");
        Assert.IsType<OkObjectResult>(await controller.DeleteSupplier(1));
        Assert.IsType<NotFoundResult>(await controller.DeleteSupplier(1));
    }

    [Fact]
    public async Task Delete_caps_each_usage_category_and_ignores_empty_supplier_aliases()
    {
        await using var fixture = await Fixture.Create();
        if (fixture is null) return;
        var c = fixture.Connection;
        await AddUsageColumns(c);
        await c.ExecuteAsync(@"
            INSERT INTO dict_supplier(keyword,full_name) VALUES ('Alpha','Company'),('','Unused Company');
            INSERT INTO materials(supplier) SELECT 'Alpha' FROM generate_series(1,105);
            INSERT INTO materials(supplier) VALUES (''),(NULL),('Other');
            INSERT INTO purchase_orders(supplier,po_no) VALUES ('Company','PO002');");
        var controller = new DictionariesController(fixture.Factory);
        var conflict = Assert.IsType<ConflictObjectResult>(await controller.DeleteSupplier(1));
        var report = System.Text.Json.JsonSerializer.SerializeToElement(conflict.Value);
        Assert.Equal(106, report.GetProperty("total").GetInt32());
        Assert.True(report.GetProperty("truncated").GetBoolean());
        Assert.Equal(101, report.GetProperty("usages").GetArrayLength());
        Assert.Contains(report.GetProperty("usages").EnumerateArray(), u => u.GetProperty("document").GetString() == "PO002");
        Assert.IsType<OkObjectResult>(await controller.DeleteSupplier(2));
        Assert.Equal(108, await c.ExecuteScalarAsync<int>("SELECT count(*) FROM materials"));
    }

    private static Task<int> AddUsageColumns(NpgsqlConnection c) => c.ExecuteAsync(@"
        ALTER TABLE materials ADD COLUMN id serial PRIMARY KEY, ADD COLUMN product_code text,
            ADD COLUMN material_code text, ADD COLUMN name_zh text;
        ALTER TABLE purchase_orders ADD COLUMN id serial PRIMARY KEY, ADD COLUMN po_no text;
        ALTER TABLE shipment_items ADD COLUMN id serial PRIMARY KEY, ADD COLUMN shipment_id int, ADD COLUMN material_id int;
        CREATE TABLE shipments(id int PRIMARY KEY, container_no text);");

    [Fact]
    public async Task Renaming_archive_preserves_all_material_and_document_snapshots()
    {
        await using var fixture = await Fixture.Create();
        if (fixture is null) return;
        var c = fixture.Connection;
        var controller = new DictionariesController(fixture.Factory);
        await controller.CreateSupplier(new() { keyword = "Alpha", full = "Unique Company", customs = "Customs A" });
        await controller.CreateSupplier(new() { keyword = "Beta", full = "Shared Company", customs = "Customs B" });
        await controller.CreateSupplier(new() { keyword = "Gamma", full = "Alpha", customs = "Customs C" });
        var id = await c.ExecuteScalarAsync<int>("SELECT id FROM dict_supplier WHERE keyword='Alpha'");
        Assert.IsType<ConflictObjectResult>(await controller.CreateSupplier(new() {
            keyword = " aLpHa ", full = "Another Company" }));
        await c.ExecuteAsync(@"INSERT INTO materials VALUES (' aLpHa ','Historical Customs'),
            (' UNIQUE COMPANY ','Customs A'), ('Shared Company','Customs B');
            INSERT INTO shipment_items SELECT * FROM materials;
            INSERT INTO purchase_orders SELECT supplier FROM materials;");
        Assert.IsType<OkObjectResult>(await controller.UpdateSupplier(id, new() {
            keyword = "New Alpha", full = "Shared Company", customs = "New Customs A" }));
        foreach (var table in new[] { "materials", "shipment_items" })
        {
            Assert.Equal("Historical Customs", await c.ExecuteScalarAsync<string>(
                $"SELECT customs_company FROM {table} WHERE supplier=' aLpHa '"));
            Assert.Equal("Customs B", await c.ExecuteScalarAsync<string>(
                $"SELECT customs_company FROM {table} WHERE supplier='Shared Company'"));
            Assert.Equal("Customs A", await c.ExecuteScalarAsync<string>(
                $"SELECT customs_company FROM {table} WHERE supplier=' UNIQUE COMPANY '"));
            Assert.Equal(0, await c.ExecuteScalarAsync<int>($"SELECT count(*) FROM {table} WHERE supplier='New Alpha'"));
        }
        Assert.Equal(1, await c.ExecuteScalarAsync<int>("SELECT count(*) FROM purchase_orders WHERE supplier=' UNIQUE COMPANY '"));
        Assert.Equal("New Alpha", await c.ExecuteScalarAsync<string>("SELECT keyword FROM dict_supplier WHERE id=@id", new { id }));
        Assert.Equal(1, await c.ExecuteScalarAsync<int>("SELECT count(*) FROM purchase_orders WHERE supplier=' aLpHa '"));
        Assert.Equal(1, await c.ExecuteScalarAsync<int>("SELECT count(*) FROM purchase_orders WHERE supplier='Shared Company'"));
        Assert.Equal("Alpha", await c.ExecuteScalarAsync<string>("SELECT full_name FROM dict_supplier WHERE keyword='Gamma'"));
    }

    [Fact]
    public async Task Shared_company_names_are_allowed_but_display_names_remain_unique()
    {
        await using var fixture = await Fixture.Create();
        if (fixture is null) return;
        var c = fixture.Connection;
        var controller = new DictionariesController(fixture.Factory);
        Assert.IsType<OkObjectResult>(await controller.CreateSupplier(new() {
            keyword = "供应商A", full = "共同公司", customs = "报关A" }));
        Assert.IsType<OkObjectResult>(await controller.CreateSupplier(new() {
            keyword = "供应商B", full = "共同公司", customs = "报关B" }));
        Assert.IsType<OkObjectResult>(await controller.CreateSupplier(new() {
            keyword = "供应商C", full = "原公司", customs = "报关C" }));
        var id = await c.ExecuteScalarAsync<int>("SELECT id FROM dict_supplier WHERE keyword='供应商C'");
        Assert.IsType<OkObjectResult>(await controller.UpdateSupplier(id, new() {
            keyword = "供应商C", full = "共同公司", customs = "报关C" }));
        Assert.Equal(3, await c.ExecuteScalarAsync<int>("SELECT count(*) FROM dict_supplier WHERE full_name='共同公司'"));
        Assert.IsType<ConflictObjectResult>(await controller.CreateSupplier(new() {
            keyword = " 供应商A ", full = "另一公司" }));
        Assert.IsType<ConflictObjectResult>(await controller.UpdateSupplier(id, new() {
            keyword = "供应商A", full = "另一公司" }));
        await c.ExecuteAsync(@"INSERT INTO materials VALUES ('供应商A','报关A'), ('供应商C','报关C'), ('共同公司','历史报关');
            INSERT INTO shipment_items SELECT * FROM materials;
            INSERT INTO purchase_orders SELECT supplier FROM materials;");
        Assert.IsType<OkObjectResult>(await controller.UpdateSupplier(id, new() {
            keyword = "新供应商C", full = "新公司C", customs = "新报关C" }));
        foreach (var table in new[] { "materials", "shipment_items" })
        {
            Assert.Equal("报关A", await c.ExecuteScalarAsync<string>($"SELECT customs_company FROM {table} WHERE supplier='供应商A'"));
            Assert.Equal("历史报关", await c.ExecuteScalarAsync<string>($"SELECT customs_company FROM {table} WHERE supplier='共同公司'"));
            Assert.Equal("报关C", await c.ExecuteScalarAsync<string>($"SELECT customs_company FROM {table} WHERE supplier='供应商C'"));
        }
        Assert.Equal(1, await c.ExecuteScalarAsync<int>("SELECT count(*) FROM purchase_orders WHERE supplier='共同公司'"));
        Assert.Equal("共同公司", await c.ExecuteScalarAsync<string>("SELECT full_name FROM dict_supplier WHERE keyword='供应商A'"));
    }

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
            Assert.Equal("公司A", await c.ExecuteScalarAsync<string>($"SELECT supplier FROM {table}"));
        Assert.Equal("地址", await c.ExecuteScalarAsync<string>("SELECT address_zh FROM dict_supplier WHERE id=@id", new { id }));
        await controller.SyncSuppliers(new() { entries = [new() { supplier = "简称A" }, new() { supplier = "新全称A" }] });
        Assert.Equal(2, await c.ExecuteScalarAsync<int>("SELECT count(*) FROM dict_supplier"));
        Assert.Equal("公司B", await c.ExecuteScalarAsync<string>("SELECT full_name FROM dict_supplier WHERE id<>@id", new { id }));
    }

    [Fact]
    public async Task Concurrent_archive_edits_do_not_rewrite_references()
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
        foreach (var table in new[] { "materials", "shipment_items", "purchase_orders" })
            Assert.Equal("Old", await c.ExecuteScalarAsync<string>($"SELECT supplier FROM {table}"));
    }

    [Fact]
    public async Task Selecting_existing_supplier_cannot_overwrite_its_base_profile()
    {
        await using var fixture = await Fixture.Create(); if (fixture is null) return;
        var c = fixture.Connection;
        var controller = new DictionariesController(fixture.Factory);
        await controller.CreateSupplier(new() { keyword = "显示名", full = "公司全称", customs = "原报关",
            nameEn = "Original Company", addressZh = "原地址", phone = "123", email = "old@example.com" });
        var before = await c.ExecuteScalarAsync<string>("SELECT row_to_json(d)::text FROM dict_supplier d");
        foreach (var name in new[] { "显示名", "公司全称" })
            Assert.IsType<OkObjectResult>(await controller.SyncSuppliers(new() {
                confirmChanges = true, entries = [new() { supplier = name, previousSupplier = "其他供应商", customs = "不同报关" }] }));
        Assert.Equal(before, await c.ExecuteScalarAsync<string>("SELECT row_to_json(d)::text FROM dict_supplier d"));
        Assert.Equal(1, await c.ExecuteScalarAsync<int>("SELECT count(*) FROM dict_supplier"));
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
