using Microsoft.EntityFrameworkCore;

namespace IndoShipping.Infrastructure.Persistence;

public static class DatabaseCompatibility
{
    public static async Task EnsureAsync(AppDbContext db)
    {
        if (!db.Database.IsRelational()) return;

        await using var connection = db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
            await connection.OpenAsync();

        // RR-Portal 的 PostgreSQL 是共享数据库，EnsureCreated 会因其他系统已有表而跳过。
        // 仅当本系统 schema 尚未建立时执行建表脚本（postgres_schema.sql，含 EF 未映射的
        // images 表和历史增量列，比 GenerateCreateScript 更全；语句全部幂等）。
        await using var checkCommand = connection.CreateCommand();
        checkCommand.CommandText = """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'indo_shipping'
                  AND table_name = 'Users'
            )
            """;
        var schemaExists = (bool)(await checkCommand.ExecuteScalarAsync() ?? false);
        if (schemaExists) return;

        var scriptPath = Path.Combine(AppContext.BaseDirectory, "db", "postgres_schema.sql");
        if (!File.Exists(scriptPath))
            throw new FileNotFoundException($"未找到建表脚本 {scriptPath}（镜像应 COPY db/postgres_schema.sql）");
        await db.Database.ExecuteSqlRawAsync(await File.ReadAllTextAsync(scriptPath));
    }
}
