using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using VoyagePlex.Api.Data;
using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

public sealed class MailboxSyncService(IServiceScopeFactory scopeFactory, ILogger<MailboxSyncService> logger)
    : BackgroundService
{
    private static readonly SemaphoreSlim SyncLock = new(1, 1);
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var nextSync = new Dictionary<string, DateTime>();
        while (!stoppingToken.IsCancellationRequested)
        {
            using (var inventoryScope = scopeFactory.CreateScope())
            {
                var inventoryDb = inventoryScope.ServiceProvider.GetRequiredService<AppDbContext>();
                var owners = await inventoryDb.Users.AsNoTracking().Where(value => value.IsActive && value.MailboxAddress != "" && value.MailboxSecretProtected != "" && (value.CompanyAccess == "Huadeng" || value.CompanyAccess == "Both" || value.Role == "admin"))
                    .Select(value => value.Id).ToListAsync(stoppingToken);
                var mailboxes = new List<(string Company, long? Owner)> { ("Xingxin", null) };
                mailboxes.AddRange(owners.Select(id => ("Huadeng", (long?)id)));
                foreach (var mailbox in mailboxes)
                {
                    using var scope = scopeFactory.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                    db.Company = mailbox.Company; db.MailOwnerId = mailbox.Owner;
                    var setting = await db.MailSystemSettings.FirstOrDefaultAsync(stoppingToken);
                    if (setting is null)
                    {
                        setting = new MailSystemSetting { Id = db.CompanySettingId, DailyWorkflowVersion = DailyMailRules.WorkflowVersion };
                        db.MailSystemSettings.Add(setting); await db.SaveChangesAsync(stoppingToken);
                    }
                    var key = $"{mailbox.Company}:{mailbox.Owner}";
                    if (nextSync.GetValueOrDefault(key) > DateTime.UtcNow) continue;
                    nextSync[key] = DateTime.UtcNow.AddMinutes(Math.Clamp(setting.SyncIntervalMinutes, 1, 1440));
                    try { if (setting.SyncEnabled) await SyncAsync(stoppingToken, mailbox.Company, mailbox.Owner); }
                    catch (Exception error) when (error is not OperationCanceledException)
                    { logger.LogWarning("邮箱 {Mailbox} 同步失败：{ErrorType}", key, error.GetType().Name); }
                }
            }
            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        }
    }

    public async Task<object> SyncAsync(CancellationToken cancellationToken, string company = "Xingxin", long? ownerId = null)
    {
        await SyncLock.WaitAsync(cancellationToken);
        try
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Company = company; db.MailOwnerId = ownerId;
            AppUser? owner = null;
            if (company == "Huadeng")
            {
                if (ownerId is null or <= 0) return new { configured = false, imported = 0, error = "请先选择船务员邮箱" };
                owner = await db.Users.AsNoTracking().FirstOrDefaultAsync(value => value.Id == ownerId && value.IsActive && (value.CompanyAccess == "Huadeng" || value.CompanyAccess == "Both" || value.Role == "admin"), cancellationToken);
                if (owner is null || owner.MailboxAddress == "" || owner.MailboxSecretProtected == "") return new { configured = false, imported = 0 };
            }
            var parser = scope.ServiceProvider.GetRequiredService<EmailParserClient>();
            var setting = await db.MailSystemSettings.AsNoTracking().FirstAsync(value => value.Id == db.CompanySettingId, cancellationToken);
            var startDate = setting.StartDate;
            if (string.CompareOrdinal(MailboxDateRules.ReceivedDate(DateTime.UtcNow.ToString("O")), startDate) < 0)
                return new { configured = true, imported = 0, waitingUntil = startDate };
            var state = await db.MailSyncStates.FirstOrDefaultAsync(cancellationToken);
            state ??= new MailSyncState();
            if (db.Entry(state).State == EntityState.Detached) db.MailSyncStates.Add(state);
            try
            {
                var response = await parser.PollMailboxAsync(state.LastUid, startDate, cancellationToken, company, owner);
                if (response.StatusCode is < 200 or >= 300)
                    throw new InvalidOperationException("邮箱连接或读取失败");
                var payload = JsonNode.Parse(response.Body)?.AsObject()
                    ?? throw new InvalidOperationException("邮箱服务返回了无效数据");
                if (payload["configured"]?.GetValue<bool>() != true)
                    return new { configured = false, imported = 0 };

                var address = payload["address"]?.GetValue<string>() ?? "";
                var validity = payload["uid_validity"]?.GetValue<long>() ?? 0;
                if (address != state.Address || validity != state.UidValidity)
                {
                    var hadCursor = state.LastUid > 0;
                    state.Address = address;
                    state.UidValidity = validity;
                    state.LastUid = 0;
                    if (hadCursor)
                    {
                        response = await parser.PollMailboxAsync(0, startDate, cancellationToken, company, owner);
                        if (response.StatusCode is < 200 or >= 300) throw new InvalidOperationException("邮箱读取失败");
                        payload = JsonNode.Parse(response.Body)?.AsObject()
                            ?? throw new InvalidOperationException("邮箱服务返回了无效数据");
                    }
                }

                var incoming = payload["items"]?.AsArray() ?? new JsonArray();
                var batchesByDate = new Dictionary<string, ImportBatch>();
                var contactsByEmail = new Dictionary<string, MailContact>(StringComparer.OrdinalIgnoreCase);
                var imported = 0;
                foreach (var node in incoming)
                {
                    if (node is not JsonObject item) continue;
                    var uid = item["mailbox_uid"]?.GetValue<long>() ?? 0;
                    if (uid <= 0) continue;
                    var key = company == "Huadeng" ? $"Huadeng:{ownerId}:{address}:{validity}:{uid}" : $"{address}:{validity}:{uid}";
                    if (await db.ImportEmailItems.AnyAsync(value => value.MailboxKey == key, cancellationToken))
                    {
                        state.LastUid = Math.Max(state.LastUid, uid);
                        continue;
                    }
                    var fingerprint = item["fingerprint"]?.GetValue<string>() ?? "";
                    var duplicate = string.IsNullOrEmpty(fingerprint) ? null : await db.ImportEmailItems
                        .AsNoTracking().Where(value => value.Fingerprint == fingerprint)
                        .OrderBy(value => value.Id).FirstOrDefaultAsync(cancellationToken);
                    var failed = item["status"]?.ToString() == "failed";
                    var receivedAt = item["mailbox_received_at"]?.ToString() ?? "";
                    string receivedDate;
                    try { receivedDate = MailboxDateRules.ReceivedDate(receivedAt); }
                    catch (FormatException error) { throw new InvalidOperationException($"邮件 {uid} 缺少有效收件时间", error); }
                    if (string.CompareOrdinal(receivedDate, startDate) < 0)
                    {
                        state.LastUid = Math.Max(state.LastUid, uid);
                        continue;
                    }
                    if (!batchesByDate.TryGetValue(receivedDate, out var batch))
                    {
                        batch = new ImportBatch
                        {
                            Kind = "Email", FileName = $"{receivedDate} 收到的邮件",
                            MailReceivedDate = receivedDate, Status = "PendingConfirmation",
                            ParserVersion = "mailbox-imap",
                        };
                        batchesByDate.Add(receivedDate, batch);
                    }
                    var sender = item["message"]?["sender"]?.ToString() ?? "";
                    var contactEmail = MailClassificationRules.NormalizeEmail(sender);
                    MailContact? contact = null;
                    if (contactEmail != "" && !contactsByEmail.TryGetValue(contactEmail, out contact))
                    {
                        contact = await db.MailContacts.FirstOrDefaultAsync(value => value.Email == contactEmail, cancellationToken);
                        if (contact is not null) contactsByEmail[contactEmail] = contact;
                    }
                    if (contact is null && contactEmail != "")
                    {
                        var internalContact = MailContactRules.IsInternal(contactEmail);
                        contact = new MailContact { Email = contactEmail, DisplayName = sender,
                            ContactType = internalContact ? "Internal" : "Unknown", IsConfirmed = internalContact };
                        db.MailContacts.Add(contact);
                        contactsByEmail[contactEmail] = contact;
                    }
                    if (contact is not null) { contact.MessageCount++; contact.UpdatedAt = DateTime.UtcNow; }
                    var subject = item["message"]?["subject"]?.ToString() ?? "";
                    var classification = MailClassificationRules.ClassifyParsed(subject, item);
                    batch.EmailItems.Add(new ImportEmailItem
                    {
                        MailboxKey = key, FileName = item["filename"]?.ToString() ?? $"mail-{uid}.eml",
                        MailSubject = subject, MailSender = sender,
                        MailReceivedAt = receivedAt,
                        MailReceivedDate = receivedDate,
                        ShipmentMode = classification.Mode,
                        WorkCategory = classification.Category, ClassificationConfidence = classification.Confidence,
                        ClassificationSource = classification.Source, NeedsClassificationReview = classification.NeedsReview,
                        BusinessFingerprint = item["business_fingerprint"]?.ToString() ?? "", Fingerprint = fingerprint, Status = failed ? "failed" : duplicate is null ? "pending" : "duplicate",
                        DuplicateOfItemId = duplicate?.Id, ResultJson = item.ToJsonString(),
                        Error = item["error"]?.ToString() ?? "",
                    });
                    state.LastUid = Math.Max(state.LastUid, uid);
                    imported++;
                    batch.TotalCount++;
                    if (failed) batch.FailedCount++; else batch.ParsedCount++;
                }
                db.ImportBatches.AddRange(batchesByDate.Values);
                state.LastSuccessAt = DateTime.UtcNow;
                state.LastError = "";
                await db.SaveChangesAsync(cancellationToken);
                return new { configured = true, imported,
                    batch_ids = batchesByDate.Values.Select(value => value.Id).ToArray() };
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                logger.LogError("邮箱同步写入失败：{ErrorType}", error.GetType().Name);
                db.ChangeTracker.Clear();
                var errorState = await db.MailSyncStates.FirstOrDefaultAsync(cancellationToken);
                errorState ??= new MailSyncState();
                if (db.Entry(errorState).State == EntityState.Detached) db.MailSyncStates.Add(errorState);
                errorState.LastError = "邮箱同步失败，请检查邮箱设置或联系管理员";
                await db.SaveChangesAsync(cancellationToken);
                throw;
            }
        }
        finally { SyncLock.Release(); }
    }
}
