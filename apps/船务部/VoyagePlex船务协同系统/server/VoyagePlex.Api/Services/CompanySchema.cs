using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using VoyagePlex.Api.Data;

namespace VoyagePlex.Api.Services;

public static class CompanySchema
{
    public static void Apply(AppDbContext db)
    {
        var connection = db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open) connection.Open();
        var backedUp = false;
        foreach (var table in new[] { "ShipmentTasks", "ImportBatches", "ImportEmailItems", "MailContacts", "Users" })
        {
            var columns = new HashSet<string>();
            using (var command = connection.CreateCommand())
            {
                command.CommandText = $"PRAGMA table_info('{table}')";
                using var reader = command.ExecuteReader();
                while (reader.Read()) columns.Add(reader.GetString(1));
            }
            if (columns.Count == 0) continue;
            var column = table == "Users" ? "CompanyAccess" : "Company";
            if (!columns.Contains(column))
            {
                if (!backedUp && connection is SqliteConnection source && source.DataSource != ":memory:")
                {
                    var path = Path.GetFullPath(source.DataSource) + $".before-company-{DateTime.UtcNow:yyyyMMddHHmmss}-{Guid.NewGuid():N}.db";
                    using var backup = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path }.ToString());
                    backup.Open(); source.BackupDatabase(backup); backedUp = true;
                }
                // Table and column identifiers come only from the fixed schema list above.
                var sql = $"ALTER TABLE {table} ADD COLUMN {column} TEXT NOT NULL DEFAULT 'Xingxin'";
                db.Database.ExecuteSqlRaw(sql);
            }
            if (table == "ShipmentTasks" && !columns.Contains("ExportDetailsJson"))
                db.Database.ExecuteSqlRaw("ALTER TABLE ShipmentTasks ADD COLUMN ExportDetailsJson TEXT NOT NULL DEFAULT '{{}}'");
        }
        PersonalMailboxSchema.Apply(db);
        db.Database.ExecuteSqlRaw("""
            DROP INDEX IF EXISTS IX_MailContacts_Email;

            CREATE INDEX IF NOT EXISTS IX_ShipmentTasks_Company_SoNumber ON ShipmentTasks (Company, SoNumber);
            CREATE INDEX IF NOT EXISTS IX_ImportEmailItems_Company_MailReceivedDate ON ImportEmailItems (Company, MailReceivedDate);
            INSERT OR IGNORE INTO MailSystemSettings (Id, SyncEnabled, SyncIntervalMinutes, RetentionDays, StartDate, DailyWorkflowVersion, UpdatedAt)
            VALUES (2, 1, 5, 180, '2026-10-08', 1, CURRENT_TIMESTAMP);
            """);
    }
}
