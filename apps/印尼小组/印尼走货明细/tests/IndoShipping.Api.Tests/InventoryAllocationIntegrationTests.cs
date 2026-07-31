using System.Security.Claims;
using Dapper;
using IndoShipping.Api.Controllers;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Xunit;

namespace IndoShipping.Api.Tests;

public sealed class InventoryAllocationIntegrationTests
{
    [Fact]
    public async Task Outbound_can_be_split_across_containers_without_over_allocation()
    {
        var encodedPassword = Environment.GetEnvironmentVariable("INDO_PG_APP_PASSWORD_B64");
        if (string.IsNullOrWhiteSpace(encodedPassword))
            return;

        var connectionString = new NpgsqlConnectionStringBuilder
        {
            Host = "127.0.0.1",
            Port = 5432,
            Database = "indo_shipping",
            Username = "indo_shipping",
            Password = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(encodedPassword)),
            SearchPath = "indo_shipping",
            IncludeErrorDetail = false
        }.ConnectionString;
        var factory = new SqlConnectionFactory(connectionString);

        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        var suffix = Guid.NewGuid().ToString("N")[..10];
        var poNo = $"IT-{suffix}";
        int materialId = 0, poId = 0, poItemId = 0, receiptId = 0, outboundId = 0;
        int firstShipmentId = 0, secondShipmentId = 0;

        try
        {
            materialId = await connection.ExecuteScalarAsync<int>(@"
                INSERT INTO materials(name_zh, active) VALUES (@name, TRUE) RETURNING id",
                new { name = $"集成测试物料-{suffix}" });
            poId = await connection.ExecuteScalarAsync<int>(@"
                INSERT INTO purchase_orders(po_no, supplier, status, order_date)
                VALUES (@poNo, 'integration-test', 'received', CURRENT_DATE) RETURNING id",
                new { poNo });
            poItemId = await connection.ExecuteScalarAsync<int>(@"
                INSERT INTO po_items(po_id, material_id, material_name, qty, purchase_qty)
                VALUES (@poId, @materialId, @name, 120, 120) RETURNING id",
                new { poId, materialId, name = $"集成测试物料-{suffix}" });
            receiptId = await connection.ExecuteScalarAsync<int>(@"
                INSERT INTO po_receipts(po_item_id, receipt_date, qty, batch_no)
                VALUES (@poItemId, CURRENT_DATE, 120, 'IT-BATCH') RETURNING id",
                new { poItemId });
            outboundId = await connection.ExecuteScalarAsync<int>(@"
                INSERT INTO outbound(po_item_id, po_no, material_id, qty, out_date, notes)
                VALUES (@poItemId, @poNo, @materialId, 100, CURRENT_DATE, 'integration-test')
                RETURNING id", new { poItemId, poNo, materialId });

            var shipments = Controller(new ShipmentsController(factory));
            var first = await shipments.Create(Shipment(poNo, materialId, outboundId, 60, $"IT-A-{suffix}"));
            firstShipmentId = ResultId(first);

            var tooMuch = await shipments.Create(Shipment(poNo, materialId, outboundId, 50, $"IT-X-{suffix}"));
            var rejected = Assert.IsType<BadRequestObjectResult>(tooMuch);
            using (var errorDocument = System.Text.Json.JsonDocument.Parse(
                       System.Text.Json.JsonSerializer.Serialize(rejected.Value)))
            {
                Assert.Contains(
                    "超过可分配数量 40",
                    errorDocument.RootElement.GetProperty("error").GetString());
            }

            var second = await shipments.Create(Shipment(poNo, materialId, outboundId, 40, $"IT-B-{suffix}"));
            secondShipmentId = ResultId(second);

            var allocated = await connection.ExecuteScalarAsync<decimal>(
                "SELECT COALESCE(SUM(qty), 0) FROM shipment_items WHERE outbound_id=@outboundId",
                new { outboundId });
            Assert.Equal(100m, allocated);

            var outbound = Controller(new OutboundController(factory));
            var shrink = await outbound.Update(outboundId, new OutboundController.CreateBody
            {
                po_item_id = poItemId,
                qty = 99,
                out_date = DateTime.Today
            });
            Assert.IsType<BadRequestObjectResult>(shrink);
            Assert.IsType<ConflictObjectResult>(await outbound.Delete(outboundId));

            Assert.IsType<OkObjectResult>(await shipments.Delete(firstShipmentId));
            firstShipmentId = 0;
            Assert.Equal(40m, await connection.ExecuteScalarAsync<decimal>(
                "SELECT COALESCE(SUM(qty), 0) FROM shipment_items WHERE outbound_id=@outboundId",
                new { outboundId }));

            var auditCount = await connection.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM audit_logs
                WHERE username='integration-test' AND entity_type='shipment'");
            Assert.True(auditCount >= 3);
        }
        finally
        {
            if (firstShipmentId > 0)
                await connection.ExecuteAsync("DELETE FROM shipments WHERE id=@id", new { id = firstShipmentId });
            if (secondShipmentId > 0)
                await connection.ExecuteAsync("DELETE FROM shipments WHERE id=@id", new { id = secondShipmentId });
            if (outboundId > 0)
                await connection.ExecuteAsync("DELETE FROM outbound WHERE id=@id", new { id = outboundId });
            if (receiptId > 0)
                await connection.ExecuteAsync("DELETE FROM po_receipts WHERE id=@id", new { id = receiptId });
            if (poId > 0)
                await connection.ExecuteAsync("DELETE FROM purchase_orders WHERE id=@id", new { id = poId });
            if (materialId > 0)
                await connection.ExecuteAsync("DELETE FROM materials WHERE id=@id", new { id = materialId });
            await connection.ExecuteAsync("DELETE FROM audit_logs WHERE username='integration-test'");
        }
    }

    private static ShipmentsController.ShBody Shipment(
        string poNo, int materialId, int outboundId, decimal qty, string containerNo) => new()
    {
        container_no = containerNo,
        ship_date = DateTime.Today,
        items =
        [
            new ShipmentsController.ShItem
            {
                outbound_id = outboundId,
                material_id = materialId,
                po_no = poNo,
                qty = qty
            }
        ]
    };

    private static T Controller<T>(T controller) where T : ControllerBase
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, "1"),
                    new Claim(ClaimTypes.Name, "integration-test")
                ], "integration-test"))
            }
        };
        return controller;
    }

    private static int ResultId(IActionResult result)
    {
        var ok = Assert.IsType<OkObjectResult>(result);
        var json = System.Text.Json.JsonSerializer.Serialize(ok.Value);
        using var document = System.Text.Json.JsonDocument.Parse(json);
        return document.RootElement.GetProperty("id").GetInt32();
    }
}
