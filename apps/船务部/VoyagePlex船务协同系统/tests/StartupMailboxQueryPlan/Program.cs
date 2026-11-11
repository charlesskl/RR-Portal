using System.Data.Common;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using VoyagePlex.Api.Data;
using VoyagePlex.Api.Entities;
using VoyagePlex.Api.Services;

// Only a unique temporary synthetic SQLite file is opened. No host configuration,
// HTTP server, parser, real credentials or network service is used.
var root = Path.Combine(Path.GetTempPath(), "voyage-startup-query-plan-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var plans = new PagePlans();
var checks = new List<string>();
try
{
    var options = new DbContextOptionsBuilder<AppDbContext>()
        .UseSqlite($"Data Source={Path.Combine(root, "synthetic.db")}")
        .AddInterceptors(plans).Options;
    using var db = new AppDbContext(options);
    db.Database.EnsureCreated();
    CompanySchema.Apply(db);
    db.Database.ExecuteSqlRaw("UPDATE MailSystemSettings SET SyncEnabled=0");
    using (var tx = db.Database.BeginTransaction())
    {
        foreach (var (company, owner) in new[] { ("Xingxin", 0L), ("Huadeng", 7L), ("Huadeng", 8L) })
        {
            db.Company = company; db.MailOwnerId = owner;
            var batch = new ImportBatch { Kind = "Email", MailReceivedDate = "" };
            db.ImportBatches.Add(batch); db.SaveChanges();
            for (var n = 1; n <= 521; n++)
            {
                // Sparse IDs, differently ordered dates, manual rows and multiple
                // owners reproduce indexes/filter selectivity absent in empty DBs.
                var id = n * 10L + (company == "Xingxin" ? 1 : owner == 7 ? 2 : 3);
                var item = new ImportEmailItem
                {
                    Id = id, ImportBatchId = batch.Id, MailboxKey = $"synthetic:{company}:{owner}:{n}",
                    MailReceivedAt = n % 13 == 0 ? "" : "2026-10-13T01:00:00Z",
                    MailReceivedDate = n % 13 == 0 ? "" : $"2026-10-{9 + n % 20:D2}",
                    MailSubject = "RELEASE CFS SO SYNTHETIC", MailSender = "sender@example.invalid",
                    ResultJson = JsonSerializer.Serialize(new { message = new { subject = "RELEASE CFS SO SYNTHETIC", sender = "sender@example.invalid" }, mailbox_received_at = "2026-10-13T01:00:00Z", padding = new string('x', 4096) }),
                    ClassificationSource = n % 11 == 0 ? "Manual" : "System", ShipmentMode = "FCL",
                    HandlingStatus = "Confirmed", HandlingOutcome = "NoTask", TaskIdsJson = "[123]",
                    Fingerprint = $"synthetic-fingerprint:{id}", Status = "parsed"
                };
                db.ImportEmailItems.Add(item);
                db.ShipmentTasks.Add(new ShipmentTask { Id = id, SourceImportItemId = id, SourceGroupKey = id.ToString(), SoNumber = $"synthetic-{id}", EmailSubject = "", DestinationCountry = "synthetic" });
            }
            db.SaveChanges(); db.ChangeTracker.Clear();
        }
        tx.Commit();
    }
    db.Company = "Xingxin"; db.MailOwnerId = null;
    var before = db.ImportEmailItems.IgnoreQueryFilters().AsNoTracking().OrderBy(x => x.Id).ToArray();
    var tasksBefore = db.ShipmentTasks.IgnoreQueryFilters().AsNoTracking().OrderBy(x => x.Id).ToArray();
    // Positive control: the realistic company/date index selects a range then
    // sorts on Id. Test checks a plan, not an environment-sensitive elapsed time.
    using (var command = db.Database.GetDbConnection().CreateCommand())
    {
        command.CommandText = "EXPLAIN QUERY PLAN SELECT * FROM ImportEmailItems WHERE Company='Xingxin' AND Id>0 AND MailboxKey<>'' AND MailReceivedDate>='2026-10-08' AND ClassificationSource<>'Manual' ORDER BY Id LIMIT 8";
        if (command.Connection!.State != System.Data.ConnectionState.Open) command.Connection.Open();
        using var reader = command.ExecuteReader();
        var original = new List<string>(); while (reader.Read()) original.Add(reader.GetString(3));
        Require(original.Any(x => x.Contains("USE TEMP B-TREE")), "fixture must expose the original repeated-sort query plan");
        checks.Add("real company/date distribution reproduces original repeated-sort plan");
    }
    plans.Enabled = true;
    db.Company = "Huadeng"; db.MailOwnerId = 7;
    StartupMailboxMaintenance.BackfillMetadata(db);
    StartupMailboxMaintenance.RefreshContactsAndClassification(db, "2026-10-08");
    StartupMailboxMaintenance.BackfillShipmentEmailSubjects(db);
    plans.Enabled = false;
    var afterOwner = db.ImportEmailItems.IgnoreQueryFilters().AsNoTracking().OrderBy(x => x.Id).ToArray();
    Require(before.Where(x => x.Company != "Huadeng" || x.MailOwnerId != 7)
        .Select(Json).SequenceEqual(afterOwner.Where(x => x.Company != "Huadeng" || x.MailOwnerId != 7).Select(Json)), "other company and other mailbox owner unchanged");
    Require(afterOwner.Where(x => x.Company == "Huadeng" && x.MailOwnerId == 7).All(x => x.MailReceivedAt != "" && x.MailReceivedDate != ""), "all selected-owner metadata pages completed");
    Require(afterOwner.Where(x => x.Company == "Huadeng" && x.MailOwnerId == 7 && x.ClassificationSource != "Manual").All(x => x.ShipmentMode == "Warehouse"), "all owner classifications completed");
    var afterTasksOwner = db.ShipmentTasks.IgnoreQueryFilters().AsNoTracking().OrderBy(x => x.Id).ToArray();
    Require(afterTasksOwner.Where(x => x.Id % 10 == 2).All(x => x.EmailSubject == "RELEASE CFS SO SYNTHETIC"), "selected-owner subjects completed");
    Require(tasksBefore.Where(x => x.Id % 10 != 2).Select(Json).SequenceEqual(afterTasksOwner.Where(x => x.Id % 10 != 2).Select(Json)), "source query respects owner and company filters");
    checks.Add("composable raw pages retain EF company and personal mailbox filtering");
    plans.Enabled = true;
    db.Company = "Xingxin"; db.MailOwnerId = null;
    StartupMailboxMaintenance.BackfillMetadata(db);
    StartupMailboxMaintenance.RefreshContactsAndClassification(db, "2026-10-08");
    StartupMailboxMaintenance.BackfillShipmentEmailSubjects(db);
    plans.Enabled = false;
    var after = db.ImportEmailItems.IgnoreQueryFilters().AsNoTracking().OrderBy(x => x.Id).ToArray();
    Require(before.Select(x => x.Id).SequenceEqual(after.Select(x => x.Id)), "all sparse IDs preserved");
    var old = before.ToDictionary(x => x.Id);
    foreach (var row in after)
    {
        var previous = old[row.Id];
        Require(Json(new { row.Company, row.MailOwnerId, row.MailboxKey, row.ResultJson, row.Status, row.HandlingStatus, row.HandlingOutcome, row.TaskIdsJson, row.Fingerprint, row.ImportBatchId }) ==
            Json(new { previous.Company, previous.MailOwnerId, previous.MailboxKey, previous.ResultJson, previous.Status, previous.HandlingStatus, previous.HandlingOutcome, previous.TaskIdsJson, previous.Fingerprint, previous.ImportBatchId }), "mail identity, body and business outcome preserved");
        if (previous.ClassificationSource == "Manual") Require(row.ClassificationSource == "Manual" && row.ShipmentMode == previous.ShipmentMode, "manual classification preserved");
    }
    Require(after.Where(x => x.Company == "Xingxin" && x.ClassificationSource != "Manual").All(x => x.ShipmentMode == "Warehouse"), "Xingxin page sequence complete");
    Require(after.Where(x => x.Company == "Xingxin").All(x => x.MailReceivedAt != "" && x.MailReceivedDate != ""), "Xingxin metadata pages complete");
    checks.Add("sparse identity, original mail contents, manual classifications and business outcomes preserved");
    Require(plans.Commands.Count > 200, "many actual EF pages exercised");
    Require(plans.Commands.Any(x => x.Sql.Contains("ImportBatches")), "metadata Include query tested");
    Require(plans.Commands.Any(x => x.Sql.Contains("ShipmentTasks")), "task page query tested");
    Require(plans.Commands.All(x => x.HasCompanyParameter), "EF scope values remain parameterized");
    checks.Add("all actual EF pages use primary-key ranges; only bounded metadata Include results may be sorted");
    Console.WriteLine(JsonSerializer.Serialize(new { passed = checks.Count, failed = 0, skipped = 0, pageQueries = plans.Commands.Count, checks, distinctPlans = plans.Commands.Select(x => string.Join("; ", x.Plan)).Distinct(), productionAccess = false, externalNetwork = false }, new JsonSerializerOptions { WriteIndented = true }));
}
finally
{
    SqliteConnection.ClearAllPools();
    Directory.Delete(root, true);
}
static string Json<T>(T value) => JsonSerializer.Serialize(value);
static void Require(bool condition, string message) { if (!condition) throw new Exception(message); }

sealed class PagePlans : DbCommandInterceptor
{
    public bool Enabled { get; set; }
    public List<(string Sql, List<string> Plan, bool HasCompanyParameter)> Commands { get; } = [];
    public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
    {
        if (!Enabled || !command.CommandText.Contains("LIMIT")) return result;
        using var explain = command.Connection!.CreateCommand();
        explain.Transaction = command.Transaction;
        explain.CommandText = "EXPLAIN QUERY PLAN " + command.CommandText;
        foreach (DbParameter source in command.Parameters)
        {
            var p = explain.CreateParameter(); p.ParameterName = source.ParameterName; p.Value = source.Value; p.DbType = source.DbType; explain.Parameters.Add(p);
        }
        var plan = new List<string>();
        using (var reader = explain.ExecuteReader()) while (reader.Read()) plan.Add(reader.GetString(3));
        // EF's Include joins the batch after the 8-row LIMIT coroutine, then
        // may sort those 8 results. That bounded outer sort is harmless; plain
        // classification/task pages must not sort the historical match set.
        var boundedInclude = command.CommandText.Contains("ImportBatches") && plan.Any(x => x.StartsWith("CO-ROUTINE"));
        if ((!boundedInclude && plan.Any(x => x.Contains("USE TEMP B-TREE"))) ||
            !plan.Any(x => x.Contains("INTEGER PRIMARY KEY (rowid>?)")))
            throw new Exception("Startup page does not use a bounded primary-key range: " + string.Join("; ", plan));
        var companyParameter = command.Parameters.Cast<DbParameter>().Any(p => Equals(p.Value, "Xingxin") || Equals(p.Value, "Huadeng"));
        Commands.Add((command.CommandText, plan, companyParameter));
        return result;
    }
}
