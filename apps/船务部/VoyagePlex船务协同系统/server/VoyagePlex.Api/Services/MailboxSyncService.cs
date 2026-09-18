using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using VoyagePlex.Api.Data;
using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

public sealed class MailboxSyncService(IServiceScopeFactory scopeFactory, ILogger<MailboxSyncService> logger)
    : BackgroundService
{
    private static readonly SemaphoreSlim SyncLock = new(1, 1);
    private static readonly TimeSpan SyncInterval = TimeSpan.FromMinutes(5);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(SyncInterval);
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await SyncAsync(stoppingToken); }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                logger.LogWarning(error, "邮箱同步失败");
            }
            if (!await timer.WaitForNextTickAsync(stoppingToken)) break;
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
                    var receivedAt = item["mailbox_received_at"]?.ToString() ?? "";
                    string receivedDate;
                    try { receivedDate = MailboxDateRules.ReceivedDate(receivedAt); }
                    catch (FormatException error) { throw new InvalidOperationException($"邮件 {uid} 缺少有效收件时间", error); }
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
                    batch.EmailItems.Add(new ImportEmailItem
                    {
                        MailboxKey = key, FileName = item["filename"]?.ToString() ?? $"mail-{uid}.eml",
                        MailSubject = item["message"]?["subject"]?.ToString() ?? "",
                        MailSender = item["message"]?["sender"]?.ToString() ?? "",
                        MailReceivedAt = receivedAt,
                        MailReceivedDate = receivedDate,
                        Fingerprint = fingerprint, Status = failed ? "failed" : duplicate is null ? "pending" : "duplicate",
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
