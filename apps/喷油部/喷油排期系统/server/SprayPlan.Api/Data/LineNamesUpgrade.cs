using Microsoft.EntityFrameworkCore;

namespace SprayPlan.Api.Data;

public static class LineNamesUpgrade
{
    public static async Task Ensure(AppDbContext db)
    {
        await db.Database.OpenConnectionAsync();
        try
        {
            // 首次启动和测试环境可能尚未建表。
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='production_lines'";
            if (Convert.ToInt64(await command.ExecuteScalarAsync()) == 0) return;

            // 同一条语句原子更新；工艺、ID、产能及所有关联保持不变。
            // 精确限定旧名称和厂区，重复启动不覆盖自定义名称或华登拉别。
            await db.Database.ExecuteSqlRawAsync("""
                UPDATE production_lines
                SET name = CASE craftType WHEN '手喷' THEN 'A拉：手喷' ELSE 'B拉：自动喷' END
                WHERE factoryId = 'XINGXIN' AND (
                    (craftType = '手喷' AND name IN ('B拉', 'B拉：手喷')) OR
                    (craftType = '自动喷' AND name IN ('A拉', 'A拉：自动喷'))
                );
                """);
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }
}
