using System.Text.Json;
using Dapper;
using IndoShipping.Api.Controllers;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace IndoShipping.Api.Tests;
public class ShipmentImportIntegrationTests
{
    [Fact]
    public async Task Imported_snapshot_survives_save_reload_without_material_or_stock_changes()
    {
        var connection = Environment.GetEnvironmentVariable("CARTON_TEST_CONNECTION");
        if (string.IsNullOrWhiteSpace(connection)) return;
        var factory = new SqlConnectionFactory(connection);
        using var c = factory.Create();
        var beforeMaterials = await c.ExecuteScalarAsync<int>("SELECT count(*) FROM materials");
        var beforeOutbound = await c.ExecuteScalarAsync<int>("SELECT count(*) FROM outbound");
        var controller = new ShipmentsController(factory) {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        var snapshot = JsonSerializer.SerializeToElement(new { name_zh = "导入工具", name_en = "Imported tool", product_code = "001",
            hs_cn = "000123", length = 23, image = "data:image/png;base64,AA==" });
        var body = new ShipmentsController.ShBody { items = [
            new() { material_snapshot = snapshot, carton_no = "100", cartons = 1, qty = 2, kg = 2,
                price = 35.34m, currency = "US$", po_date = new DateTime(2026, 10, 8) }
        ] };
        var result = Assert.IsType<OkObjectResult>(await controller.Create(body));
        var id = JsonSerializer.SerializeToElement(result.Value).GetProperty("id").GetInt32();
        var saved = await c.QuerySingleAsync<string>("SELECT material_snapshot::text FROM shipment_items WHERE shipment_id=@id", new { id });
        Assert.Equal("000123", JsonDocument.Parse(saved).RootElement.GetProperty("hs_cn").GetString());
        Assert.Null(await c.QuerySingleAsync<int?>("SELECT material_id FROM shipment_items WHERE shipment_id=@id", new { id }));
        var get = Assert.IsType<OkObjectResult>(await controller.Get(id));
        Assert.Contains("100", JsonSerializer.Serialize(get.Value));
        body.items![0].qty = 3;
        Assert.IsType<OkObjectResult>(await controller.Update(id, body));
        Assert.Equal(3m, await c.ExecuteScalarAsync<decimal>("SELECT qty FROM shipment_items WHERE shipment_id=@id", new { id }));
        body.items[0].material_snapshot = JsonSerializer.SerializeToElement("invalid");
        Assert.IsType<BadRequestObjectResult>(await controller.Update(id, body));
        Assert.Equal(beforeMaterials, await c.ExecuteScalarAsync<int>("SELECT count(*) FROM materials"));
        Assert.Equal(beforeOutbound, await c.ExecuteScalarAsync<int>("SELECT count(*) FROM outbound"));
    }
}
