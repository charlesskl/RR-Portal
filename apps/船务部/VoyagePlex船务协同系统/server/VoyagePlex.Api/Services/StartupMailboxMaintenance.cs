using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using VoyagePlex.Api.Data;
using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

/// <summary>Startup maintenance must not retain every historical mail body.</summary>
public static class StartupMailboxMaintenance
{
    private const int PageSize = 8;

    // These keyset pages must walk the INTEGER PRIMARY KEY. A company/date index
    // otherwise rescans all matching historical mail and sorts it on every page.
    // FromSqlRaw stays composable: EF still adds company/owner filters and binds
    // their parameters. NOT INDEXED permits SQLite's rowid/INTEGER PRIMARY KEY.

    public static void BackfillMetadata(AppDbContext db)
    {
        using var transaction = db.Database.BeginTransaction();
        long lastId = 0;
        while (true)
        {
            var page = db.ImportEmailItems.FromSqlRaw("SELECT * FROM \"ImportEmailItems\" NOT INDEXED").Include(item => item.ImportBatch)
                .Where(item => item.Id > lastId && item.MailboxKey != "" &&
                    (item.MailReceivedAt == "" || item.MailReceivedDate == ""))
                .OrderBy(item => item.Id).Take(PageSize).ToList();
            if (page.Count == 0) break;
            foreach (var item in page)
            {
                try
                {
                    var parsed = JsonNode.Parse(item.ResultJson);
                    item.MailSubject = parsed?["message"]?["subject"]?.ToString() ?? "";
                    item.MailSender = parsed?["message"]?["sender"]?.ToString() ?? "";
                    item.MailReceivedAt = parsed?["mailbox_received_at"]?.ToString() ?? "";
                    if (item.MailReceivedAt != "") item.MailReceivedDate = MailboxDateRules.ReceivedDate(item.MailReceivedAt);
                    if (item.ImportBatch is not null && item.ImportBatch.MailReceivedDate == "" && item.MailReceivedAt != "")
                        item.ImportBatch.MailReceivedDate = item.MailReceivedDate;
                }
                catch (Exception error) when (error is JsonException or FormatException)
                {
                    // Retain malformed historical mail exactly as before for manual review.
                }
            }
            db.SaveChanges();
            lastId = page[^1].Id;
            db.ChangeTracker.Clear();
            page.Clear();
        }
        transaction.Commit();
    }

    public static void RefreshContactsAndClassification(AppDbContext db, string startDate)
    {
        using var transaction = db.Database.BeginTransaction();
        // Project only sender text; ResultJson can contain large attachment payloads.
        var senders = new Dictionary<string, (string DisplayName, int Count)>();
        foreach (var sender in db.ImportEmailItems.AsNoTracking()
            .Where(item => item.MailboxKey != "" && item.MailReceivedDate.CompareTo(startDate) >= 0)
            .OrderBy(item => item.Id).Select(item => item.MailSender).AsEnumerable())
        {
            var email = MailClassificationRules.NormalizeEmail(sender);
            if (email == "") continue;
            senders[email] = senders.TryGetValue(email, out var group)
                ? (group.DisplayName, group.Count + 1) : (sender, 1);
        }
        var existingContacts = db.MailContacts.ToDictionary(contact => contact.Email, StringComparer.OrdinalIgnoreCase);
        foreach (var (email, group) in senders)
        {
            if (!existingContacts.TryGetValue(email, out var contact))
            {
                contact = new MailContact { Email = email, DisplayName = group.DisplayName };
                db.MailContacts.Add(contact);
                existingContacts[email] = contact;
            }
            contact.MessageCount = group.Count;
            contact.UpdatedAt = DateTime.UtcNow;
            if (MailContactRules.IsInternal(contact.Email))
            {
                contact.ContactType = "Internal";
                contact.IsConfirmed = true;
            }
        }
        db.SaveChanges();
        long lastId = 0;
        while (true)
        {
            var page = db.ImportEmailItems.FromSqlRaw("SELECT * FROM \"ImportEmailItems\" NOT INDEXED").Where(item => item.Id > lastId && item.MailboxKey != "" &&
                    item.MailReceivedDate.CompareTo(startDate) >= 0 && item.ClassificationSource != "Manual")
                .OrderBy(item => item.Id).Take(PageSize).ToList();
            if (page.Count == 0) break;
            foreach (var item in page)
            {
                var classification = MailClassificationRules.ClassifyStored(item.MailSubject, item.ResultJson);
                item.ShipmentMode = classification.Mode;
                item.WorkCategory = classification.Category;
                item.ClassificationConfidence = classification.Confidence;
                item.ClassificationSource = classification.Source;
                item.NeedsClassificationReview = classification.NeedsReview;
            }
            db.SaveChanges();
            lastId = page[^1].Id;
            db.ChangeTracker.Clear();
            page.Clear();
        }
        transaction.Commit();
    }

    public static void BackfillShipmentEmailSubjects(AppDbContext db)
    {
        using var transaction = db.Database.BeginTransaction();
        long lastId = 0;
        while (true)
        {
            var page = db.ShipmentTasks.FromSqlRaw("SELECT * FROM \"ShipmentTasks\" NOT INDEXED").Where(task => task.Id > lastId &&
                    task.EmailSubject == "" && task.SourceImportItemId != null)
                .OrderBy(task => task.Id).Take(PageSize).ToList();
            if (page.Count == 0) break;
            var sourceIds = page.Select(task => task.SourceImportItemId!.Value).Distinct().ToArray();
            var imports = db.ImportEmailItems.AsNoTracking().Where(item => sourceIds.Contains(item.Id))
                .Select(item => new { item.Id, item.ResultJson }).ToDictionary(item => item.Id);
            foreach (var task in page)
            {
                if (!imports.TryGetValue(task.SourceImportItemId!.Value, out var item)) continue;
                var subject = JsonNode.Parse(item.ResultJson)?["message"]?["subject"]?.ToString()?.Trim();
                if (!string.IsNullOrWhiteSpace(subject)) task.EmailSubject = subject;
            }
            db.SaveChanges();
            lastId = page[^1].Id;
            db.ChangeTracker.Clear();
            imports.Clear();
            page.Clear();
        }
        transaction.Commit();
    }
}
