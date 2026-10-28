using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Tests.Materials;

public class MaterialSchemaTests
{
    [Fact]
    public async Task UpgradeExistingDatabase_IsIdempotent_PreservesOrders_UsesPrismaMillisecondDates()
    {
        var path = Path.Combine(Path.GetTempPath(), $"spray-material-schema-{Guid.NewGuid():N}.db");
        try {
            await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={path}").Options);
            await db.Database.ExecuteSqlRawAsync("CREATE TABLE orders(id INTEGER PRIMARY KEY, externalOrderNo TEXT); INSERT INTO orders VALUES(1,'KEEP-ORDER');");
            await MaterialSchema.Ensure(db); await MaterialSchema.Ensure(db);
            var date = new DateTime(2026, 10, 28, 0, 0, 0, DateTimeKind.Utc);
            db.OrderMaterials.Add(new OrderMaterial { OrderId = 1, PartName = "A", ExpectedDate = date, UpdatedAt = date, UpdatedBy = "test" });
            await db.SaveChangesAsync(); db.ChangeTracker.Clear();
            Assert.Equal(date, (await db.OrderMaterials.SingleAsync()).ExpectedDate);
            await db.Database.OpenConnectionAsync();
            using var command = db.Database.GetDbConnection().CreateCommand();
            command.CommandText = "SELECT externalOrderNo FROM orders WHERE id=1"; Assert.Equal("KEEP-ORDER", await command.ExecuteScalarAsync());
            command.CommandText = "SELECT expectedDate FROM order_materials"; Assert.Equal(new DateTimeOffset(date).ToUnixTimeMilliseconds(), Convert.ToInt64(await command.ExecuteScalarAsync()));
            await db.Database.CloseConnectionAsync();
        } finally { try { File.Delete(path); } catch { } }
    }
}
