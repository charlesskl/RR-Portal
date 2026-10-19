using System.Text.Json;
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
            try
            {
                using var inventoryScope = scopeFactory.CreateScope();
                var inventoryDb = inventoryScope.ServiceProvider.GetRequiredService<AppDbContext>();
                var owners = await inventoryDb.Users.AsNoTracking().Where(value => value.IsActive && value.MailboxAddress != "" && (value.CompanyAccess == "Huadeng" || value.CompanyAccess == "Both" || value.Role == "admin"))
                    .ToListAsync(stoppingToken);
                var mailboxes = new List<(string Company, long? Owner)> { ("Xingxin", null) };
                mailboxes.AddRange(owners.Where(ServerMailboxConfiguration.IsConfigured).Select(user => ("Huadeng", (long?)user.Id)));
                foreach (var mailbox in mailboxes)
                {
                    try
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
                        if (setting.SyncEnabled) await SyncAsync(stoppingToken, mailbox.Company, mailbox.Owner);
                    }
                    // HttpClient timeouts also derive from OperationCanceledException.
                    // Only cancellation of the service's own token stops the worker.
                    catch (Exception error) when (!stoppingToken.IsCancellationRequested)
                    { logger.LogWarning("邮箱 {Mailbox} 同步失败：{ErrorType}", $"{mailbox.Company}:{mailbox.Owner}", error.GetType().Name); }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception error) when (!stoppingToken.IsCancellationRequested)
            { logger.LogWarning("邮箱自动同步轮询失败：{ErrorType}", error.GetType().Name); }
            try { await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
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
            ServerMailboxCredentials? credentials = null;
            var configurationError = "";
            if (company == "Huadeng")
            {
                if (ownerId is null or <= 0) return new { configured = false, imported = 0, error = "请先选择船务员邮箱" };
                owner = await db.Users.AsNoTracking().FirstOrDefaultAsync(value => value.Id == ownerId && value.IsActive && (value.CompanyAccess == "Huadeng" || value.CompanyAccess == "Both" || value.Role == "admin"), cancellationToken);
                if (owner is null || !ServerMailboxConfiguration.TryGet(owner, out var resolvedCredentials, out configurationError))
                    return new { configured = false, imported = 0, error = configurationError };
                credentials = resolvedCredentials;
            }
            var parser = scope.ServiceProvider.GetRequiredService<EmailParserClient>();
            var setting = await db.MailSystemSettings.AsNoTracking().FirstAsync(value => value.Id == db.CompanySettingId, cancellationToken);
            var startDate = setting.StartDate;
            if (string.CompareOrdinal(MailboxDateRules.ReceivedDate(DateTime.UtcNow.ToString("O")), startDate) < 0)
                return new { configured = true, imported = 0, waitingUntil = startDate };
            var state = await db.MailSyncStates.FirstOrDefaultAsync(cancellationToken);
            state ??= new MailSyncState();
            if (db.Entry(state).State == EntityState.Detached) db.MailSyncStates.Add(state);
            if (credentials is not null)
            {
                var identity = ServerMailboxConfiguration.MailboxIdentity(credentials);
                if (state.MailboxIdentity == "")
                {
                    // Older cursors and keys belong to the host/folder saved with that user's mailbox.
                    var legacyIdentity = ServerMailboxConfiguration.MailboxIdentity(owner!.MailboxAddress, owner.MailboxHost, owner.MailboxFolder);
                    var legacyPrefix = $"Huadeng:{ownerId}:{owner.MailboxAddress}:";
                    var legacyItems = await db.ImportEmailItems.Where(value => value.MailboxKey.StartsWith(legacyPrefix)).ToListAsync(cancellationToken);
                    foreach (var item in legacyItems)
                        item.MailboxKey = $"Huadeng:{ownerId}:{legacyIdentity}:{owner.MailboxAddress}:" + item.MailboxKey[legacyPrefix.Length..];
                    state.MailboxIdentity = legacyIdentity;
                }
                if (state.MailboxIdentity != identity)
                {
                    state.MailboxIdentity = identity;
                    state.Address = ""; state.UidValidity = 0; state.LastUid = 0;
                    state.LastSuccessAt = null; state.LastError = "";
                }
                var configurationKey = ServerMailboxConfiguration.ConfigurationKey(credentials);
                if (state.ConfigurationKey != configurationKey)
                {
                    state.ConfigurationKey = configurationKey;
                    state.LastSuccessAt = null; state.LastError = "";
                }
                await db.SaveChangesAsync(cancellationToken);
            }
            try
            {
                var response = await parser.PollMailboxAsync(state.LastUid, startDate, cancellationToken, company, credentials);
                var payload = ReadMailboxPayload(response, credentials?.Address);
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
                        response = await parser.PollMailboxAsync(0, startDate, cancellationToken, company, credentials);
                        payload = ReadMailboxPayload(response, credentials?.Address);
                        if (payload["configured"]?.GetValue<bool>() != true ||
                            payload["address"]?.GetValue<string>() != address ||
                            payload["uid_validity"]?.GetValue<long>() != validity)
                            throw new InvalidOperationException("邮箱身份在读取期间变化，请重试");
                    }
                }

                var incoming = payload["items"]?.AsArray() ?? new JsonArray();
                var batchesByDate = new Dictionary<string, ImportBatch>();
                var contactsByEmail = new Dictionary<string, MailContact>(StringComparer.OrdinalIgnoreCase);
                var imported = 0;
                long previousUid = 0;
                long? blockedUid = null;
                var blockedError = "";
                foreach (var node in incoming)
                {
                    if (node is not JsonObject item) throw new InvalidOperationException("邮箱服务返回了无效邮件记录");
                    var uid = item["mailbox_uid"]?.GetValue<long>() ?? 0;
                    if (uid <= previousUid || uid > uint.MaxValue)
                        throw new InvalidOperationException("邮箱服务返回了无效邮件顺序");
                    previousUid = uid;
                    var key = company == "Huadeng" ? $"Huadeng:{ownerId}:{state.MailboxIdentity}:{address}:{validity}:{uid}" : $"{address}:{validity}:{uid}";
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
                    catch (FormatException error)
                    {
                        if (!failed) throw new InvalidOperationException($"邮件 {uid} 缺少有效收件时间", error);
                        // Commit the known prefix, but never invent a date or advance
                        // across a UID whose server metadata could not be read.
                        blockedUid = uid;
                        blockedError = $"邮件 {uid} 的收件时间读取失败，已保留断点等待重试";
                        break;
                    }
                    if (string.CompareOrdinal(receivedDate, startDate) < 0)
                    {
                        state.LastUid = Math.Max(state.LastUid, uid);
                        continue;
                    }
                    if (failed && item["retryable"]?.GetValue<bool>() == true)
                    {
                        // A transient body/metadata read error must not become a permanent
                        // failed row whose UID the next poll would silently skip.
                        blockedUid = uid;
                        blockedError = $"邮件 {uid} 暂时读取失败，已保留断点等待重试";
                        break;
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
                if (blockedUid is null) state.LastSuccessAt = DateTime.UtcNow;
                state.LastError = blockedError;
                await db.SaveChangesAsync(cancellationToken);
                return new { configured = true, imported, blockedUid, error = blockedError,
                    batch_ids = batchesByDate.Values.Select(value => value.Id).ToArray() };
            }
            catch (Exception error) when (!cancellationToken.IsCancellationRequested)
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

    public async Task<object> RetryFailedAsync(IReadOnlyList<long> itemIds, CancellationToken cancellationToken,
        string company, long? ownerId)
    {
        if (company != "Huadeng" || ownerId is null or <= 0 || itemIds.Count is < 1 or > 5 ||
            itemIds.Any(id => id <= 0) || itemIds.Distinct().Count() != itemIds.Count)
            throw new MailboxRetryRejectedException("请选择华登邮箱及1至5封不同的失败邮件");
        await SyncLock.WaitAsync(cancellationToken);
        try
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Company = company; db.MailOwnerId = ownerId;
            if (await db.ImportEmailItems.CountAsync(item => itemIds.Contains(item.Id), cancellationToken) != itemIds.Count)
                throw new MailboxRetryRejectedException("部分邮件不存在或不属于所选邮箱", 404);
            var owner = await db.Users.AsNoTracking().FirstOrDefaultAsync(value => value.Id == ownerId && value.IsActive &&
                (value.CompanyAccess == "Huadeng" || value.CompanyAccess == "Both" || value.Role == "admin"), cancellationToken);
            if (owner is null || !ServerMailboxConfiguration.TryGet(owner, out var credentials, out _))
                throw new MailboxRetryRejectedException("所选邮箱配置不可用，请联系管理员");
            var state = await db.MailSyncStates.AsNoTracking().SingleOrDefaultAsync(cancellationToken)
                ?? throw new MailboxRetryRejectedException("所选邮箱尚无可核对的同步身份");
            ValidateRetryIdentity(state, credentials);
            var originals = await ReadRetryRows(db, itemIds, state, credentials, cancellationToken);
            var originalByUid = originals.ToDictionary(item => RetryUid(item, ownerId.Value, state, credentials));
            var parser = scope.ServiceProvider.GetRequiredService<EmailParserClient>();
            var payload = ReadMailboxPayload(await parser.RetryMailboxAsync(originalByUid.Keys.Order().ToArray(),
                state.UidValidity, credentials, cancellationToken), null);
            if (payload["configured"]?.GetValue<bool>() != true ||
                payload["uid_validity"]?.GetValue<long>() != state.UidValidity ||
                !string.Equals(payload["address"]?.GetValue<string>(), state.Address, StringComparison.OrdinalIgnoreCase))
                throw new MailboxRetryRejectedException("重试期间邮箱身份发生变化，已保留原数据");
            var results = new Dictionary<long, JsonObject>();
            foreach (var node in payload["items"]!.AsArray())
            {
                if (node is not JsonObject item || item["mailbox_uid"] is not JsonValue uidValue ||
                    !uidValue.TryGetValue<long>(out var uid) || !originalByUid.TryGetValue(uid, out var original) ||
                    !results.TryAdd(uid, item))
                    throw new MailboxRetryRejectedException("邮箱重试返回的邮件集合不一致，已保留原数据");
                var receivedAt = item["mailbox_received_at"]?.ToString() ?? "";
                if (!SameReceivedInstant(original.MailReceivedAt, receivedAt) ||
                    MailboxDateRules.ReceivedDate(receivedAt) != original.MailReceivedDate)
                    throw new MailboxRetryRejectedException("邮箱重试返回的收件时间与原邮件不一致，已保留原数据");
                if (item["status"]?.ToString() is not ("parsed" or "failed"))
                    throw new InvalidOperationException("邮箱重试返回了无效的解析状态");
                if (item["status"]!.ToString() == "parsed" &&
                    (item["message"] is not JsonObject || item["items"] is not JsonArray ||
                     string.IsNullOrWhiteSpace(item["fingerprint"]?.ToString())))
                    throw new InvalidOperationException("邮箱重试返回了不完整的解析结果");
                if (item["status"]!.ToString() == "parsed" && original.Fingerprint != "" && item["fingerprint"]!.ToString() != original.Fingerprint)
                    throw new MailboxRetryRejectedException("邮箱重试返回的邮件内容指纹与原邮件不一致，已保留原数据");
            }
            if (results.Count != originalByUid.Count)
                throw new InvalidOperationException("邮箱重试尚未返回全部指定邮件，请逐封重试");

            // The network request holds no database transaction. Re-read under the write
            // transaction so a user-confirmed or changed item can never be overwritten.
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            var currentOwner = await db.Users.AsNoTracking().FirstOrDefaultAsync(value => value.Id == ownerId && value.IsActive &&
                (value.CompanyAccess == "Huadeng" || value.CompanyAccess == "Both" || value.Role == "admin"), cancellationToken);
            if (currentOwner is null || !ServerMailboxConfiguration.TryGet(currentOwner, out var currentCredentials, out _) ||
                currentCredentials != credentials)
                throw new MailboxRetryRejectedException("邮箱用户绑定在重试期间已变化，已保留原数据");
            var currentState = await db.MailSyncStates.AsNoTracking().SingleAsync(cancellationToken);
            ValidateRetryIdentity(currentState, credentials);
            if (currentState.Address != state.Address || currentState.UidValidity != state.UidValidity ||
                currentState.MailboxIdentity != state.MailboxIdentity)
                throw new MailboxRetryRejectedException("邮箱同步身份已变化，请重新核对");
            var currentRows = await ReadRetryRows(db, itemIds, currentState, credentials, cancellationToken);
            foreach (var current in currentRows)
            {
                var uid = RetryUid(current, ownerId.Value, currentState, credentials);
                var original = originalByUid.GetValueOrDefault(uid);
                if (original is null || current.Id != original.Id || current.ImportBatchId != original.ImportBatchId ||
                    current.MailReceivedAt != original.MailReceivedAt || current.MailReceivedDate != original.MailReceivedDate ||
                    current.Fingerprint != original.Fingerprint || current.ResultJson != original.ResultJson ||
                    current.MailSender != original.MailSender || current.Error != original.Error ||
                    current.MailSubject != original.MailSubject || current.FileName != original.FileName ||
                    current.BusinessFingerprint != original.BusinessFingerprint || current.ShipmentMode != original.ShipmentMode ||
                    current.WorkCategory != original.WorkCategory || current.ClassificationSource != original.ClassificationSource ||
                    current.ClassificationConfidence != original.ClassificationConfidence ||
                    current.NeedsClassificationReview != original.NeedsClassificationReview || current.DuplicateOfItemId != original.DuplicateOfItemId ||
                    current.WorkNote != original.WorkNote || current.ReviewedAt != original.ReviewedAt)
                    throw new MailboxRetryRejectedException("失败邮件在重试期间已变化，请重新核对");
            }
            var recovered = new List<long>();
            var successfulByFingerprint = new Dictionary<string, long>(StringComparer.Ordinal);
            var contacts = new Dictionary<string, MailContact>(StringComparer.OrdinalIgnoreCase);
            foreach (var current in currentRows.OrderBy(row => row.Id))
            {
                var item = results[RetryUid(current, ownerId.Value, currentState, credentials)];
                if (item["status"]!.ToString() == "failed") continue;
                var fingerprint = item["fingerprint"]?.ToString() ?? "";
                var duplicate = fingerprint == "" ? null : await db.ImportEmailItems.AsNoTracking()
                    .Where(value => value.Id != current.Id && value.Status != "failed" && value.Fingerprint == fingerprint)
                    .OrderBy(value => value.Id).Select(value => (long?)value.Id).FirstOrDefaultAsync(cancellationToken);
                if (fingerprint != "" && successfulByFingerprint.TryGetValue(fingerprint, out var priorId))
                    duplicate = duplicate is null ? priorId : Math.Min(duplicate.Value, priorId);
                var sender = item["message"]?["sender"]?.ToString() ?? "";
                await AdjustRetryContacts(db, contacts, current.MailSender, sender, cancellationToken);
                var subject = item["message"]?["subject"]?.ToString() ?? "";
                var classification = MailClassificationRules.ClassifyParsed(subject, item);
                current.FileName = item["filename"]?.ToString() ?? current.FileName;
                current.MailSubject = subject; current.MailSender = sender;
                current.ShipmentMode = classification.Mode; current.WorkCategory = classification.Category;
                current.ClassificationConfidence = classification.Confidence; current.ClassificationSource = classification.Source;
                current.NeedsClassificationReview = classification.NeedsReview;
                current.BusinessFingerprint = item["business_fingerprint"]?.ToString() ?? "";
                current.Fingerprint = fingerprint; current.Status = duplicate is null ? "pending" : "duplicate";
                current.DuplicateOfItemId = duplicate; current.ResultJson = item.ToJsonString(); current.Error = "";
                var batch = current.ImportBatch!;
                if (batch.FailedCount <= 0 || batch.ParsedCount < 0 || batch.TotalCount < batch.ParsedCount + batch.FailedCount)
                    throw new MailboxRetryRejectedException("原邮件批次计数不一致，已保留原数据");
                batch.FailedCount--; batch.ParsedCount++;
                recovered.Add(current.Id);
                if (fingerprint != "") successfulByFingerprint.TryAdd(fingerprint, current.Id);
            }
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new { requested = itemIds.Count, recovered = recovered.Count,
                stillFailed = itemIds.Count - recovered.Count, recoveredItemIds = recovered.ToArray() };
        }
        finally { SyncLock.Release(); }
    }

    private static void ValidateRetryIdentity(MailSyncState state, ServerMailboxCredentials credentials)
    {
        if (state.MailboxIdentity != ServerMailboxConfiguration.MailboxIdentity(credentials) ||
            state.Address != credentials.Address || state.UidValidity is <= 0 or > uint.MaxValue)
            throw new MailboxRetryRejectedException("邮箱配置与原同步身份不一致，已保留原数据");
    }

    private static long RetryUid(ImportEmailItem item, long ownerId, MailSyncState state, ServerMailboxCredentials credentials)
    {
        var segment = item.MailboxKey[(item.MailboxKey.LastIndexOf(':') + 1)..];
        if (!long.TryParse(segment, out var uid) || uid is <= 0 or > uint.MaxValue || uid > state.LastUid ||
            item.MailboxKey != $"Huadeng:{ownerId}:{state.MailboxIdentity}:{credentials.Address}:{state.UidValidity}:{uid}")
            throw new MailboxRetryRejectedException("失败邮件与原邮箱身份不一致，已保留原数据");
        return uid;
    }

    private static async Task<List<ImportEmailItem>> ReadRetryRows(AppDbContext db, IReadOnlyList<long> ids,
        MailSyncState state, ServerMailboxCredentials credentials, CancellationToken cancellationToken)
    {
        var rows = await db.ImportEmailItems.Include(item => item.ImportBatch).Where(item => ids.Contains(item.Id))
            .ToListAsync(cancellationToken);
        if (rows.Count != ids.Count)
            throw new MailboxRetryRejectedException("部分邮件不存在或不属于所选邮箱", 404);
        if (rows.Any(item => item.Company != db.Company || item.MailOwnerId != db.MailOwnerId ||
                item.Status != "failed" || item.HandlingStatus != "Pending" || item.HandlingOutcome != "" ||
                item.WorkNote != "" || item.ReviewedAt is not null ||
                string.Equals(item.ClassificationSource, "Manual", StringComparison.OrdinalIgnoreCase) ||
                item.ImportBatch is not { Kind: "Email", Status: "PendingConfirmation" } ||
                item.ImportBatch.Company != db.Company || item.ImportBatch.MailOwnerId != db.MailOwnerId) ||
            await db.ShipmentTasks.IgnoreQueryFilters().AnyAsync(task => task.SourceImportItemId != null &&
                ids.Contains(task.SourceImportItemId.Value), cancellationToken))
            throw new MailboxRetryRejectedException("邮件不存在、不属于所选邮箱或已处理，已保留原数据");
        await RejectSecondaryTaskSources(db, ids, cancellationToken);
        foreach (var item in rows)
        {
            if (JsonNode.Parse(item.TaskIdsJson) is not JsonArray { Count: 0 })
                throw new MailboxRetryRejectedException("邮件已有任务关联，已保留原数据");
            RetryUid(item, db.MailOwnerId!.Value, state, credentials);
        }
        return rows;
    }

    private static async Task RejectSecondaryTaskSources(AppDbContext db, IReadOnlyList<long> ids, CancellationToken cancellationToken)
    {
        const int maxSourceJsonChars = 64 * 1024, maxTotalChars = 4 * 1024 * 1024, maxTasks = 10_000;
        var taskCount = 0; var totalChars = 0;
        // SourceEmailsJson is shared by all owners within the company. Bound the SQL
        // projection as well as parsing so malformed large rows cannot exhaust the API.
        var sources = db.ShipmentTasks.IgnoreQueryFilters().AsNoTracking().Where(task => task.Company == db.Company)
            .Select(task => task.SourceEmailsJson.Substring(0, maxSourceJsonChars + 1)).Take(maxTasks + 1);
        await foreach (var json in sources.AsAsyncEnumerable().WithCancellation(cancellationToken))
        {
            if (++taskCount > maxTasks || json is null || json.Length > maxSourceJsonChars ||
                (totalChars += json.Length) > maxTotalChars)
                throw new MailboxRetryRejectedException("任务来源资料超出安全核对范围，已保留原数据");
            try
            {
                using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 8 });
                if (document.RootElement.ValueKind != JsonValueKind.Array)
                    throw new JsonException();
                foreach (var source in document.RootElement.EnumerateArray())
                {
                    if (source.ValueKind != JsonValueKind.Object) throw new JsonException();
                    long sourceId = 0;
                    var hasId = false;
                    foreach (var property in source.EnumerateObject())
                    {
                        if (property.Name != "id") continue;
                        if (hasId || property.Value.ValueKind != JsonValueKind.Number ||
                            !property.Value.TryGetInt64(out sourceId) || sourceId <= 0) throw new JsonException();
                        hasId = true;
                    }
                    if (!hasId) throw new JsonException();
                    if (ids.Contains(sourceId))
                        throw new MailboxRetryRejectedException("邮件已有任务来源关联，已保留原数据");
                }
            }
            catch (Exception error) when (error is JsonException or InvalidOperationException)
            { throw new MailboxRetryRejectedException("任务来源资料无法安全核对，已保留原数据"); }
        }
    }

    private static bool SameReceivedInstant(string before, string after) =>
        DateTimeOffset.TryParse(before, System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.None, out var original) &&
        DateTimeOffset.TryParse(after, System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.None, out var received) && original == received;

    private static async Task AdjustRetryContacts(AppDbContext db, Dictionary<string, MailContact> contacts,
        string oldSender, string newSender, CancellationToken cancellationToken)
    {
        var oldEmail = MailClassificationRules.NormalizeEmail(oldSender);
        var newEmail = MailClassificationRules.NormalizeEmail(newSender);
        if (oldEmail == newEmail) return; // Failed headers were already counted on the original import.
        foreach (var (email, delta) in new[] { (oldEmail, -1), (newEmail, 1) })
        {
            if (email == "") continue;
            if (!contacts.TryGetValue(email, out var contact))
            {
                contact = await db.MailContacts.FirstOrDefaultAsync(value => value.Email == email, cancellationToken);
                if (contact is null)
                {
                    if (delta < 0) throw new MailboxRetryRejectedException("原邮件联系人计数不一致，已保留原数据");
                    var internalContact = MailContactRules.IsInternal(email);
                    contact = new MailContact { Email = email, DisplayName = newSender,
                        ContactType = internalContact ? "Internal" : "Unknown", IsConfirmed = internalContact };
                    db.MailContacts.Add(contact);
                }
                contacts[email] = contact;
            }
            if (contact.MessageCount + delta < 0)
                throw new MailboxRetryRejectedException("原邮件联系人计数不一致，已保留原数据");
            contact.MessageCount += delta; contact.UpdatedAt = DateTime.UtcNow;
        }
    }

    private static JsonObject ReadMailboxPayload(ParserResponse response, string? expectedAddress)
    {
        if (response.StatusCode is < 200 or >= 300)
            throw new InvalidOperationException("邮箱连接或读取失败");
        var payload = JsonNode.Parse(response.Body)?.AsObject()
            ?? throw new InvalidOperationException("邮箱服务返回了无效数据");
        if (payload["configured"]?.GetValue<bool>() != true) return payload;
        var address = payload["address"]?.GetValue<string>();
        var validity = payload["uid_validity"]?.GetValue<long>() ?? 0;
        if (string.IsNullOrWhiteSpace(address) || validity is <= 0 or > uint.MaxValue ||
            payload["items"] is not JsonArray ||
            (expectedAddress is not null && !string.Equals(address, expectedAddress, StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException("邮箱服务返回了无效邮箱身份或邮件数据");
        return payload;
    }
}

public sealed class MailboxRetryRejectedException(string message, int statusCode = 409) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}
