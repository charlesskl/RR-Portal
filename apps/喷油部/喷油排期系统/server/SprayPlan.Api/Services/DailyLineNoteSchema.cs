using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;

namespace SprayPlan.Api.Services;

public static class DailyLineNoteSchema
{
    public static async Task Ensure(AppDbContext db)
    {
        await db.Database.OpenConnectionAsync();
        try
        {
            using var command = db.Database.GetDbConnection().CreateCommand();
            command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='production_lines'";
            if (Convert.ToInt32(await command.ExecuteScalarAsync()) == 0) return;
            await db.Database.ExecuteSqlRawAsync(Sql);
        }
        finally { await db.Database.CloseConnectionAsync(); }
    }

    public const string Sql = """
        CREATE TABLE IF NOT EXISTS daily_line_notes (
          id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
          factoryId TEXT NOT NULL DEFAULT 'XINGXIN', lineId INTEGER NOT NULL,
          noteDate BIGINT NOT NULL, text TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0,
          updatedAt BIGINT NOT NULL, updatedBy TEXT NOT NULL,
          FOREIGN KEY (lineId) REFERENCES production_lines(id) ON DELETE RESTRICT ON UPDATE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS daily_line_notes_factoryId_lineId_noteDate_key
          ON daily_line_notes(factoryId, lineId, noteDate);
        """;
}
