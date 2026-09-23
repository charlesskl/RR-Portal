using System.Text.Json.Nodes;
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
        while (!stoppingToken.IsCancellationRequested)
        {
            var enabled = true; var intervalMinutes = 5;
            using (var scope = scopeFactory.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var setting = await db.MailSystemSettings.AsNoTracking().FirstOrDefaultAsync(value => value.Id == 1, stoppingToken);
                if (setting is not null) { enabled = setting.SyncEnabled; intervalMinutes = Math.Clamp(setting.SyncIntervalMinutes, 1, 1440); }
            }
            try { if (enabled) await SyncAsync(stoppingToken); }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                logger.LogWarning(error, "邮箱同步失败");
            }
            await Task.Delay(TimeSpan.FromMinutes(intervalMinutes), stoppingToken);
        }
    }

    public async Task<object> SyncAsync(CancellationToken cancellationToken)
    {
        await SyncLock.WaitAsync(cancellationToken);
        try
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var parser = scope.ServiceProvider.GetRequiredService<EmailParserClient>();
            var state = await db.MailSyncStates.FirstOrDefaultAsync(cancellationToken);
            state ??= new MailSyncState();
            if (db.Entry(state).State == EntityState.Detached) db.MailSyncStates.Add(state);
            try
            {
                var response = await parser.PollMailboxAsync(state.LastUid, cancellationToken);
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
                        response = await parser.PollMailboxAsync(0, cancellationToken);
                        if (response.StatusCode is < 200 or >= 300) throw new InvalidOperationException("邮箱读取失败");
                        payload = JsonNode.Parse(response.Body)?.AsObject()
                            ?? throw new InvalidOperationException("邮箱服务返回了无效数据");
                    }
                }

                var incoming = payload["items"]?.AsArray() ?? new JsonArray();
                var batchesByDate = new Dictionary<string, ImportBatch>();
                var imported = 0;
                foreach (var node in incoming)
                {
                    if (node is not JsonObject item) continue;
                    var uid = item["mailbox_uid"]?.GetValue<long>() ?? 0;
                    if (uid <= 0) continue;
                    var key = $"{address}:{validity}:{uid}";
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
                    var itemError = item["error"]?.ToString() ?? "";
                    var receivedAt = item["mailbox_received_at"]?.ToString() ?? "";
                    string receivedDate;
                    try
                    {
                        receivedDate = MailboxDateRules.ReceivedDate(receivedAt);
                    }
                    catch (FormatException)
                    {
                        // 单封邮件收件时间无效不能中断整批，否则断点永远停在同一 UID 反复重试；
                        // 记为失败项归入“未知日期”批次，断点照常推进
                        failed = true;
                        itemError = string.IsNullOrEmpty(itemError) ? "邮件缺少有效收件时间" : itemError;
                        receivedDate = "";
                    }
                    var batchKey = string.IsNullOrEmpty(receivedDate) ? "未知日期" : receivedDate;
                    if (!batchesByDate.TryGetValue(batchKey, out var batch))
                    {
                        batch = new ImportBatch
                        {
                            Kind = "Email",
                            FileName = string.IsNullOrEmpty(receivedDate) ? "收件时间未知的邮件" : $"{receivedDate} 收到的邮件",
                            MailReceivedDate = receivedDate, Status = "PendingConfirmation",
                            ParserVersion = "mailbox-imap",
                        };
                        batchesByDate.Add(batchKey, batch);
                    }
                    var sender = item["message"]?["sender"]?.ToString() ?? "";
                    var contactEmail = MailClassificationRules.NormalizeEmail(sender);
                    var contact = contactEmail == "" ? null : await db.MailContacts.FirstOrDefaultAsync(value => value.Email == contactEmail, cancellationToken);
                    if (contact is null && contactEmail != "")
                    {
                        var internalContact = MailContactRules.IsInternal(contactEmail);
                        contact = new MailContact { Email = contactEmail, DisplayName = sender,
                            ContactType = internalContact ? "Internal" : "Unknown", IsConfirmed = internalContact };
                        db.MailContacts.Add(contact);
                    }
                    if (contact is not null) { contact.MessageCount++; contact.UpdatedAt = DateTime.UtcNow; }
                    var subject = item["message"]?["subject"]?.ToString() ?? "";
                    var classification = MailClassificationRules.Classify(subject);
                    batch.EmailItems.Add(new ImportEmailItem
                    {
                        MailboxKey = key, FileName = item["filename"]?.ToString() ?? $"mail-{uid}.eml",
                        MailSubject = subject, MailSender = sender,
                        MailReceivedAt = receivedAt,
                        MailReceivedDate = receivedDate,
                        WorkCategory = classification.Category, ClassificationConfidence = classification.Confidence,
                        ClassificationSource = classification.Source, NeedsClassificationReview = classification.NeedsReview,
                        Fingerprint = fingerprint, Status = failed ? "failed" : duplicate is null ? "pending" : "duplicate",
                        DuplicateOfItemId = duplicate?.Id, ResultJson = item.ToJsonString(),
                        Error = itemError,
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
                db.ChangeTracker.Clear();
                var errorState = await db.MailSyncStates.FirstOrDefaultAsync(cancellationToken);
                errorState ??= new MailSyncState();
                if (db.Entry(errorState).State == EntityState.Detached) db.MailSyncStates.Add(errorState);
                errorState.LastError = error.Message;
                await db.SaveChangesAsync(cancellationToken);
                throw;
            }
        }
        finally { SyncLock.Release(); }
    }
}
