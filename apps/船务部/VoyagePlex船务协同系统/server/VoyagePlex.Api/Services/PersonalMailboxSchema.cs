using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using VoyagePlex.Api.Data;

namespace VoyagePlex.Api.Services;

public static class PersonalMailboxSchema
{
    public static void Apply(AppDbContext db)
    {
        var connection = db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open) connection.Open();
        var backedUp = false;
        var additions = new Dictionary<string, Dictionary<string, string>>
        {
            ["ImportBatches"] = new() { ["MailOwnerId"] = "INTEGER NOT NULL DEFAULT 0" },
            ["ImportEmailItems"] = new() { ["MailOwnerId"] = "INTEGER NOT NULL DEFAULT 0", ["BusinessFingerprint"] = "TEXT NOT NULL DEFAULT ''" },
            ["MailContacts"] = new() { ["MailOwnerId"] = "INTEGER NOT NULL DEFAULT 0" },
            ["Users"] = new() { ["MailboxAddress"] = "TEXT NOT NULL DEFAULT ''", ["MailboxHost"] = "TEXT NOT NULL DEFAULT 'imap.exmail.qq.com'", ["MailboxFolder"] = "TEXT NOT NULL DEFAULT 'INBOX'", ["MailboxSecretProtected"] = "TEXT NOT NULL DEFAULT ''", ["MailboxTestStatus"] = "TEXT NOT NULL DEFAULT 'Unknown'", ["MailboxTestedAt"] = "TEXT NULL" },
            ["ShipmentTasks"] = new() { ["ResponsibleUserId"] = "INTEGER NOT NULL DEFAULT 0", ["ResponsibleUserName"] = "TEXT NOT NULL DEFAULT ''", ["SourceMailboxAddress"] = "TEXT NOT NULL DEFAULT ''" },
        };
        foreach (var (table, fields) in additions)
        {
            var columns = new HashSet<string>();
            using (var command = connection.CreateCommand())
            {
                command.CommandText = $"PRAGMA table_info('{table}')";
                using var reader = command.ExecuteReader();
                while (reader.Read()) columns.Add(reader.GetString(1));
            }
            if (columns.Count == 0) continue;
            foreach (var (column, declaration) in fields)
            {
                if (columns.Contains(column)) continue;
                if (!backedUp && connection is SqliteConnection source && source.DataSource != ":memory:")
                {
                    using var backup = new SqliteConnection($"Data Source={Path.GetFullPath(source.DataSource)}.before-personal-mail-{DateTime.UtcNow:yyyyMMddHHmmss}-{Guid.NewGuid():N}.db");
                    backup.Open(); source.BackupDatabase(backup); backedUp = true;
                }
                var sql = $"ALTER TABLE {table} ADD COLUMN {column} {declaration}";
                db.Database.ExecuteSqlRaw(sql);
            }
        }
        db.Database.ExecuteSqlRaw("""
            UPDATE ImportEmailItems SET BusinessFingerprint = COALESCE(json_extract(CASE WHEN json_valid(ResultJson) THEN ResultJson ELSE NULL END, '$.business_fingerprint'), '') WHERE BusinessFingerprint = '';
            DROP INDEX IF EXISTS IX_MailContacts_Company_Email;
            CREATE UNIQUE INDEX IF NOT EXISTS IX_MailContacts_Company_MailOwnerId_Email ON MailContacts (Company, MailOwnerId, Email);
            CREATE INDEX IF NOT EXISTS IX_ImportEmailItems_Company_BusinessFingerprint ON ImportEmailItems (Company, BusinessFingerprint);
            CREATE INDEX IF NOT EXISTS IX_ImportEmailItems_Company_MailOwnerId_MailReceivedDate ON ImportEmailItems (Company, MailOwnerId, MailReceivedDate);
            """);
    }
}
