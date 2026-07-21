using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using Xunit;

namespace SprayPlan.Api.Tests.Inventory;

public class InventoryApiTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateClient();
        await _factory.SeedAsync();
        await SeedInventoryFixture();
    }
    public Task DisposeAsync() { _client.Dispose(); _factory.Dispose(); return Task.CompletedTask; }

    private async Task Login(string u, string p)
        => (await _client.PostAsJsonAsync("/api/auth/login", new { username = u, password = p })).EnsureSuccessStatusCode();

    // 种 1 产品 + 1 订单
    // 部位"耳朵"：2 条实绩行（累计良品 195），无流水 → 成品=195、散件=0
    // 部位"身体"：1 条实绩行（良品 100）+ owner 出账 -20 + 散件入账 30 → 成品=80、散件=30
    private async Task SeedInventoryFixture()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = DateTime.UtcNow;

        var prod = new Product { ProductNo = "11494", CreatedBy = "admin", CreatedAt = now, UpdatedAt = now, Status = "active" };
        db.Products.Add(prod); await db.SaveChangesAsync();

        var order = new Order { ExternalOrderNo = "ZWZ001", ProductId = prod.Id, OrderDate = now, Status = "in_production", CreatedBy = "admin", CreatedAt = now, UpdatedAt = now };
        db.Orders.Add(order); await db.SaveChangesAsync();

        // 部位"耳朵"：2 条实绩，无流水。报数 130+85=215、入库 120+75=195 → 成品195、车间存数20
        db.ProductionPlans.AddRange(
            new ProductionPlan { PlanDate = now, LineId = 1, OrderId = order.Id, ItemName = "兔子", PartName = "耳朵", PlannedQty = 100, GoodQty = 120, ReportedQty = 130, CreatedBy = "admin", CreatedAt = now, LastModifiedAt = now },
            new ProductionPlan { PlanDate = now, LineId = 1, OrderId = order.Id, ItemName = "兔子", PartName = "耳朵", PlannedQty = 100, GoodQty = 75, ReportedQty = 85, CreatedBy = "admin", CreatedAt = now, LastModifiedAt = now }
        );

        // 部位"身体"：1 条实绩 + 2 条流水（owner 出账 -20 + 散件入账 30）
        db.ProductionPlans.Add(
            new ProductionPlan { PlanDate = now, LineId = 1, OrderId = order.Id, ItemName = "兔子", PartName = "身体", PlannedQty = 100, GoodQty = 100, CreatedBy = "admin", CreatedAt = now, LastModifiedAt = now }
        );
        await db.SaveChangesAsync();

        db.InventoryMoves.AddRange(
            // owner 出账（成品被领走）：FinishedInStock = cumGood + Delta = 100 + (-20) = 80
            new InventoryMove { ProductId = prod.Id, ItemName = "兔子", PartName = "身体", OwnerOrderId = order.Id, Delta = -20, Reason = "assembly_pickup", CreatedBy = "admin", CreatedAt = now },
            // 散件入账（滚筒超产）：LooseAvailable = 30
            new InventoryMove { ProductId = prod.Id, ItemName = "兔子", PartName = "身体", OwnerOrderId = null, Delta = 30, Reason = "tumbler_excess", CreatedBy = "admin", CreatedAt = now }
        );
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Query_Unauthenticated_401()
    {
        var r = await _client.GetAsync("/api/inventory/query");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Query_ReturnsFinishedFromGoodQty_LooseZero()
    {
        await Login("viewer", "viewer123");
        var rows = await _client.GetFromJsonAsync<List<InvRow>>("/api/inventory/query");
        var ear = rows!.Single(r => r.PartName == "耳朵");
        Assert.Equal("11494", ear.ProductNo);
        Assert.Equal(195, ear.FinishedInStock);   // 120 + 75
        Assert.Equal(20, ear.WorkshopStock);       // 报数(130+85) − 入库(120+75) = 215 − 195
        Assert.Equal(0, ear.LooseAvailable);
    }

    // 验证有流水时 InventoryCalc 公式派生正确（§2.3）
    [Fact]
    public async Task Query_WithMoves_ReturnsCorrectFinishedAndLoose()
    {
        await Login("viewer", "viewer123");
        var rows = await _client.GetFromJsonAsync<List<InvRow>>("/api/inventory/query");
        // 部位"身体"：cumGood=100, ownerDelta=-20 → FinishedInStock=80；looseDelta=30 → LooseAvailable=30
        var body = rows!.Single(r => r.PartName == "身体");
        Assert.Equal(80, body.FinishedInStock);
        Assert.Equal(30, body.LooseAvailable);
    }

    private record InvRow(int ProductId, string ProductNo, string CustomerName, string ItemName, string PartName, int FinishedInStock, int WorkshopStock, int LooseAvailable);
}
