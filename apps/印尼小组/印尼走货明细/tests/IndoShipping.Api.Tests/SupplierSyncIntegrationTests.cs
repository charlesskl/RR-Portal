using Dapper;
using IndoShipping.Api.Controllers;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace IndoShipping.Api.Tests;

public class SupplierSyncIntegrationTests
{
    [Fact]
    public async Task Register_once_switch_without_renaming_and_edit_by_id()
    {
        // Must point to a disposable database; never use the application's database.
        var connection = Environment.GetEnvironmentVariable("SUPPLIER_SYNC_TEST_CONNECTION");
        if (string.IsNullOrEmpty(connection)) return;
        var factory = new SqlConnectionFactory(connection);
        using var c = factory.Create();
        await c.ExecuteAsync(@"
            CREATE TABLE dict_supplier(id serial PRIMARY KEY, keyword text, full_name text,
              customs_company text, name_en text, address_zh text, address_en text,
              phone text, email text, contact text, priority integer DEFAULT 0);
            CREATE TABLE materials(supplier text, customs_company text);
            CREATE TABLE shipment_items(supplier text, customs_company text);
            CREATE TABLE purchase_orders(supplier text);");
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
}
