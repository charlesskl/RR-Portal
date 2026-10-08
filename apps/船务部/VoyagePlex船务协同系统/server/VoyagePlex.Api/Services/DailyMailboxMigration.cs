using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using System.Data;
using VoyagePlex.Api.Data;

namespace VoyagePlex.Api.Services;

public static class DailyMailboxMigration
{
    public static void Apply(AppDbContext db)
    {
        var setting = db.MailSystemSettings.Single(value => value.Id == 1);
        if (setting.DailyWorkflowVersion >= DailyMailRules.WorkflowVersion) return;
        // 清理前保留一致的 SQLite 备份；备份失败时不继续删除。
        if (db.ImportEmailItems.Any(item => item.MailboxKey != "") && db.Database.GetDbConnection() is SqliteConnection source)
        {
            if (source.State != ConnectionState.Open) source.Open();
            var backupPath = Path.GetFullPath(source.DataSource) + $".before-daily-mail-{DateTime.UtcNow:yyyyMMddHHmmss}-{Guid.NewGuid():N}.db";
            using var backup = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = backupPath }.ToString());
            backup.Open(); source.BackupDatabase(backup);
        }
        using var transaction = db.Database.BeginTransaction();
        // 只迁移已确认任务的直接来源，不以同 SO 推断未确认邮件的关联。
        var tasks = db.ShipmentTasks.Where(task => task.SourceImportItemId != null && task.SourceEmailsJson == "[]").ToList();
        var sourceIds = tasks.Select(task => task.SourceImportItemId!.Value).Distinct().ToArray();
        var sources = db.ImportEmailItems.Where(item => sourceIds.Contains(item.Id) &&
            (item.Status == "confirmed" || item.Status == "duplicate_confirmed")).ToDictionary(item => item.Id);
        foreach (var task in tasks)
            if (sources.TryGetValue(task.SourceImportItemId!.Value, out var item)) DailyMailRules.RecordSource(task, item, true);
        setting.StartDate = DailyMailRules.StartDate;
        setting.DailyWorkflowVersion = DailyMailRules.WorkflowVersion;
        setting.UpdatedAt = DateTime.UtcNow;
        db.SaveChanges();
        // 任务来源仍用于库存汇总，保留这些记录但不显示在每日收件台。
        db.Database.ExecuteSqlInterpolated($"""
            DELETE FROM ImportEmailItems
            WHERE MailboxKey <> '' AND (MailReceivedDate = '' OR MailReceivedDate < {DailyMailRules.StartDate})
              AND NOT EXISTS (SELECT 1 FROM ShipmentTasks WHERE ShipmentTasks.SourceImportItemId = ImportEmailItems.Id)
              AND NOT EXISTS (SELECT 1 FROM ImportEmailItems AS newer
                WHERE newer.DuplicateOfItemId = ImportEmailItems.Id AND newer.MailReceivedDate >= {DailyMailRules.StartDate})
            """);
        db.Database.ExecuteSqlRaw("""
            UPDATE ImportBatches SET
              TotalCount = (SELECT COUNT(*) FROM ImportEmailItems WHERE ImportBatchId = ImportBatches.Id),
              ParsedCount = (SELECT COUNT(*) FROM ImportEmailItems WHERE ImportBatchId = ImportBatches.Id AND Status <> 'failed'),
              FailedCount = (SELECT COUNT(*) FROM ImportEmailItems WHERE ImportBatchId = ImportBatches.Id AND Status = 'failed')
            WHERE Kind = 'Email';
            DELETE FROM ImportBatches WHERE Kind = 'Email'
              AND NOT EXISTS (SELECT 1 FROM ImportEmailItems WHERE ImportBatchId = ImportBatches.Id);
            """);
        transaction.Commit();
    }
}
