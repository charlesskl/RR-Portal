using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;

namespace SprayPlan.Api.Services;

public static class MaterialSchema
{
    // 现有 Docker 数据盘不会重新执行 Prisma db push，启动时幂等应用本次增量表。
    // 测试的空库交由 EnsureCreated 建模，不影响已有表和数据。
    public static async Task Ensure(AppDbContext db)
    {
        await db.Database.OpenConnectionAsync();
        try {
            using var command = db.Database.GetDbConnection().CreateCommand();
            command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='orders'";
            if (Convert.ToInt32(await command.ExecuteScalarAsync()) == 0) return;
            await db.Database.ExecuteSqlRawAsync(Sql);
        } finally { await db.Database.CloseConnectionAsync(); }
    }
    public const string Sql = """
        CREATE TABLE IF NOT EXISTS order_materials (
          id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
          factoryId TEXT NOT NULL DEFAULT 'XINGXIN', orderId INTEGER NOT NULL, partName TEXT NOT NULL,
          arrivedQty INTEGER NOT NULL DEFAULT 0, expectedDate BIGINT, actualDate BIGINT, remark TEXT,
          source TEXT NOT NULL DEFAULT 'manual', autoScheduleEnabled INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 0,
          updatedAt BIGINT NOT NULL, updatedBy TEXT NOT NULL, lastReflowDate BIGINT,
          configuration TEXT NOT NULL DEFAULT '[]', history TEXT NOT NULL DEFAULT '[]',
          CONSTRAINT order_materials_orderId_fkey FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE ON UPDATE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS order_materials_factoryId_orderId_partName_key ON order_materials(factoryId, orderId, partName);
        """;
}
