using System.Text.Json;
using Dapper;
using IndoShipping.Api.Controllers;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace IndoShipping.Api.Tests;

public sealed class ToolMaterialIntegrationTests
{
    [Fact]
    public async Task Tools_are_separate_idempotent_versioned_and_available_by_id()
    {
        // Explicitly opt in using a disposable test database, never the user's local data.
        var connection = Environment.GetEnvironmentVariable("TOOL_TEST_CONNECTION");
        if (string.IsNullOrWhiteSpace(connection)) return;
        var factory = new SqlConnectionFactory(connection);
        using var c = factory.Create();
        var controller = new ToolMaterialsController(factory);
        var suffix = Guid.NewGuid().ToString("N");
        var tool = new ToolMaterialsController.ToolBody { name_zh = "tool-" + suffix, tool_kind = "工具", related_product_code = "not-a-product", net_per_pc = 0.23m, purchase_price = 35.34m, purchase_currency = "CNY" };
        Assert.IsType<BadRequestObjectResult>(await controller.Save([new() { name_zh = "missing-currency", purchase_price = 0 }]));
        var result = Assert.IsType<OkObjectResult>(await controller.Save([tool]));
        var id = JsonSerializer.SerializeToElement(result.Value).GetProperty("ids")[0].GetInt32();
        Assert.Null(await c.QuerySingleAsync<string?>("SELECT product_code FROM materials WHERE id=@id", new { id }));
        Assert.Equal(0, await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM products WHERE code='not-a-product'"));
        Assert.Equal(35.34m, await c.ExecuteScalarAsync<decimal>("SELECT purchase_price FROM tool_materials WHERE material_id=@id", new { id }));
        Assert.Equal("CNY", await c.ExecuteScalarAsync<string>("SELECT purchase_currency FROM tool_materials WHERE material_id=@id", new { id }));
        Assert.IsType<ConflictObjectResult>(await controller.Save([tool]));
        // The first row in a rejected batch must be rolled back.
        Assert.IsType<ConflictObjectResult>(await controller.Save([
            new() { name_zh = "rollback-" + suffix, tool_kind = "工具" }, tool]));
        Assert.Equal(0, await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM materials WHERE name_zh=@name", new { name = "rollback-" + suffix }));
        tool.id = id; tool.revision = 1; tool.net_per_pc = 0.3m;
        Assert.IsType<OkObjectResult>(await controller.Save([tool]));
        Assert.IsType<ConflictObjectResult>(await controller.Save([tool]));
        Assert.Equal(0.3m, await c.ExecuteScalarAsync<decimal>("SELECT net_per_pc FROM materials WHERE id=@id", new { id }));
        var byIds = Assert.IsType<OkObjectResult>(await new MaterialsController(factory).ByIds(id.ToString()));
        var row = JsonSerializer.SerializeToElement(byIds.Value)[0];
        Assert.Equal("not-a-product", row.GetProperty("product_code").GetString());
        Assert.Equal("工具", row.GetProperty("tool_kind").GetString());
        // Reference by the same global ID in a purchase order, even with no product association.
        var purchases = new PurchaseOrdersController(factory) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        var po = Assert.IsType<OkObjectResult>(await purchases.Create(new()
        {
            po_no = "IT-" + suffix, supplier = "test", items = [new() { material_id = id, product_code = "not-a-product", material_name = tool.name_zh, qty = 2, purchase_qty = 2, ship_unit = "PCE" }]
        }));
        Assert.NotNull(po.Value);
        tool.revision = 2; tool.purchase_price = 0; tool.purchase_currency = "USD"; tool.unit_kg = "SET";
        Assert.IsType<OkObjectResult>(await controller.Save([tool]));
        Assert.Equal(0m, await c.ExecuteScalarAsync<decimal>("SELECT purchase_price FROM tool_materials WHERE material_id=@id", new { id }));
        Assert.Equal("USD", await c.ExecuteScalarAsync<string>("SELECT purchase_currency FROM tool_materials WHERE material_id=@id", new { id }));
        Assert.Equal("PCE", await c.ExecuteScalarAsync<string>("SELECT ship_unit FROM po_items WHERE material_id=@id", new { id }));
        Assert.Equal(1, await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM po_items WHERE material_id=@id", new { id }));
        var costs = Assert.IsType<OkObjectResult>(await purchases.MaterialCostByCode());
        Assert.DoesNotContain("not-a-product", JsonSerializer.Serialize(costs.Value));
        var basicId = await c.ExecuteScalarAsync<int>("INSERT INTO materials(name_zh) VALUES('basic') RETURNING id");
        Assert.IsType<ConflictObjectResult>(await controller.Save([new() { id = basicId, revision = 1, name_zh = "not allowed" }]));
    }
}
