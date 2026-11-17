using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace SprayPlan.Api.Data;

public static class ProductFactorySchema
{
    public static async Task Ensure(AppDbContext db)
    {
        await db.Database.OpenConnectionAsync();
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync();
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.Transaction = transaction.GetDbTransaction();
            command.CommandText = "PRAGMA table_info(products)";
            bool exists = false, upgraded = false;
            await using (var reader = await command.ExecuteReaderAsync())
                while (await reader.ReadAsync()) { exists = true; upgraded |= reader.GetString(1) == "factoryId"; }
            if (!exists || upgraded) return;
            using var stream = typeof(ProductFactorySchema).Assembly.GetManifestResourceStream("ProductFactoryMigration.sql")!;
            using var text = new StreamReader(stream);
            command.CommandText = await text.ReadToEndAsync();
            await command.ExecuteNonQueryAsync();
            await transaction.CommitAsync();
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }
}
