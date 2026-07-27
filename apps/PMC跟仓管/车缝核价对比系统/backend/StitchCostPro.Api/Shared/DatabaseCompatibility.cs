using Microsoft.EntityFrameworkCore;

namespace StitchCostPro.Api.Shared;

public static class DatabaseCompatibility
{
    public static async Task EnsureAsync(AppDbContext db)
    {
        if (!db.Database.IsRelational()) return;

        if (db.Database.IsNpgsql())
        {
            await EnsurePostgreSqlSchemaAsync(db);
            return;
        }

        await db.Database.ExecuteSqlRawAsync("""
            IF OBJECT_ID(N'dbo.product_import_alias', N'U') IS NULL
            BEGIN
                CREATE TABLE dbo.product_import_alias
                (
                    alias_id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_product_import_alias PRIMARY KEY,
                    product_code NVARCHAR(50) NOT NULL,
                    external_name NVARCHAR(200) NOT NULL,
                    product_id INT NOT NULL,
                    created_by INT NULL,
                    created_at DATETIME2 NOT NULL CONSTRAINT DF_product_import_alias_created_at DEFAULT SYSUTCDATETIME(),
                    updated_by INT NULL,
                    updated_at DATETIME2 NULL,
                    CONSTRAINT FK_product_import_alias_product FOREIGN KEY(product_id) REFERENCES dbo.product(product_id),
                    CONSTRAINT UX_product_import_alias_name UNIQUE(product_code, external_name)
                );
            END
            """);
    }

    private static async Task EnsurePostgreSqlSchemaAsync(AppDbContext db)
    {
        await using var connection = db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
            await connection.OpenAsync();

        await using var checkCommand = connection.CreateCommand();
        checkCommand.CommandText = """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'stitch_cost'
                  AND table_name = 'dept'
            )
            """;
        var schemaExists = (bool)(await checkCommand.ExecuteScalarAsync() ?? false);
        if (schemaExists) return;

        // RR-Portal 的 PostgreSQL 是共享数据库，EnsureCreated 会因其他系统已有表而跳过。
        // 仅当本系统 schema 尚未建立时执行 EF 生成的完整建表脚本。
        await db.Database.ExecuteSqlRawAsync(db.Database.GenerateCreateScript());
    }
}
