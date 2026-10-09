using System.Text.Json;
using Dapper;
using IndoShipping.Api.Controllers;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace IndoShipping.Api.Tests;

public class ShipmentCartonIntegrationTests
{
    [Fact]
    public async Task Carton_groups_roundtrip_and_invalid_counts_rollback()
    {
        var connection = Environment.GetEnvironmentVariable("CARTON_TEST_CONNECTION");
        if (string.IsNullOrWhiteSpace(connection)) return;
        var factory = new SqlConnectionFactory(connection);
        using var c = factory.Create();
        var controller = new ShipmentsController(factory) {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        var body = new ShipmentsController.ShBody { items = [
            new() { cartons = 1, carton_group = "same-box", supplier = "A", qty = 2 },
            new() { cartons = 1, carton_group = "same-box", supplier = "A", qty = 3 },
        ] };
        var created = Assert.IsType<OkObjectResult>(await controller.Create(body));
        var id = JsonSerializer.SerializeToElement(created.Value).GetProperty("id").GetInt32();
        Assert.Equal(2, await c.ExecuteScalarAsync<int>("SELECT count(*) FROM shipment_items WHERE shipment_id=@id AND carton_group='same-box'", new { id }));
        var get = Assert.IsType<OkObjectResult>(await controller.Get(id));
        Assert.Contains("same-box", JsonSerializer.Serialize(get.Value));
        body.items![1].cartons = 2;
        Assert.IsType<BadRequestObjectResult>(await controller.Update(id, body));
        Assert.Equal(2, await c.ExecuteScalarAsync<int>("SELECT count(*) FROM shipment_items WHERE shipment_id=@id AND cartons=1", new { id }));
        body.items[1].cartons = 1;
        foreach (var row in body.items) row.carton_group = null;
        Assert.IsType<OkObjectResult>(await controller.Update(id, body));
        Assert.Equal(0, await c.ExecuteScalarAsync<int>("SELECT count(*) FROM shipment_items WHERE shipment_id=@id AND carton_group IS NOT NULL", new { id }));
    }
}
