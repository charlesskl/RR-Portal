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

        // postgres_schema.sql 全量幂等（CREATE ... IF NOT EXISTS / ON CONFLICT DO NOTHING /
        // DO $$ 守卫），每次启动都执行：首启建表，后续 schema 增量（ALTER ADD COLUMN
        // IF NOT EXISTS 等）也能自愈落地，无需人工迁移流程。
        var scriptPath = Path.Combine(AppContext.BaseDirectory, "db", "postgres_schema.sql");
        if (!File.Exists(scriptPath))
            throw new FileNotFoundException($"未找到建表脚本 {scriptPath}（镜像应 COPY db/postgres_schema.sql）");
        // 不能用 ExecuteSqlRawAsync：EF 会把 SQL 过 string.Format，
        // 脚本里 CHECK 正则的 '{9}' 会被当占位符直接 FormatException。
        // 走原生 ADO.NET 命令，无格式化、支持多语句批量执行。
        await using var command = connection.CreateCommand();
        command.CommandText = await File.ReadAllTextAsync(scriptPath);
        command.CommandTimeout = 120;
        await command.ExecuteNonQueryAsync();
    }
}
