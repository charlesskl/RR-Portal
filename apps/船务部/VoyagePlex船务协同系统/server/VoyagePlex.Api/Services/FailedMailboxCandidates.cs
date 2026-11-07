using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using VoyagePlex.Api.Data;
using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

/// <summary>Read-only, bounded metadata for administrators. A selectable row is not a completed retry.</summary>
public static class FailedMailboxCandidates
{
    public const int PageSize = 20;

    public static async Task<object> ReadAsync(AppDbContext db, long actorId, int page, CancellationToken cancellationToken)
    {
        if (db.Company is not ("Xingxin" or "Huadeng") ||
            (db.Company == "Huadeng" && db.MailOwnerId is null or <= 0 or > int.MaxValue - 1000) ||
            (db.Company == "Xingxin" && db.MailOwnerId is not null))
            throw new MailboxRetryRejectedException("请选择有效厂区；华登须先选择船务员邮箱", 400);
        if (page < 1 || page > int.MaxValue / PageSize)
            throw new MailboxRetryRejectedException("页码无效", 400);

        // Keep count, identity and page in one read snapshot; no settings, cursors or mail rows are written.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        if (actorId <= 0 || !await db.Users.AsNoTracking().AnyAsync(user => user.Id == actorId && user.IsActive &&
                user.Role == "admin", cancellationToken))
            throw new MailboxRetryRejectedException("只有管理员可以查看失败邮件补信候选", 403);

        var ownerId = db.Company == "Huadeng" ? db.MailOwnerId!.Value : 0;
        ServerMailboxCredentials? credentials = null;
        var ownerReady = db.Company == "Xingxin";
        if (!ownerReady)
        {
            var owner = await db.Users.AsNoTracking().Where(user => user.Id == ownerId && user.IsActive &&
                    (user.CompanyAccess == "Huadeng" || user.CompanyAccess == "Both" || user.Role == "admin"))
                .Select(user => new AppUser { Id = user.Id, Username = user.Username, MailboxAddress = user.MailboxAddress })
                .SingleOrDefaultAsync(cancellationToken);
            if (owner is null)
                throw new MailboxRetryRejectedException("所选邮箱用户不可用，请重新选择", 400);
            ownerReady = ServerMailboxConfiguration.TryGet(owner, out credentials, out _);
        }
        var state = await db.MailSyncStates.AsNoTracking().Select(value => new
        {
            value.Id, Address = value.Address.Substring(0, 321), Identity = value.MailboxIdentity.Substring(0, 129),
            value.UidValidity, value.LastUid, value.LastSuccessAt, HasError = value.LastError != ""
        }).SingleOrDefaultAsync(cancellationToken);
        var identityReady = ownerReady && state is not null && !string.IsNullOrWhiteSpace(state.Address) &&
            state.Address.Length <= 320 && !state.Address.Any(char.IsControl) && state.UidValidity is > 0 and <= uint.MaxValue &&
            state.LastUid is >= 0 and <= uint.MaxValue &&
            (db.Company == "Xingxin" ? state.Id == 1 : credentials is not null && state.Address == credentials.Address &&
                state.Identity == ServerMailboxConfiguration.MailboxIdentity(credentials));

        // Explicit owner predicate also protects Xingxin from malformed non-shared rows.
        var query = db.ImportEmailItems.AsNoTracking().Where(item => item.Company == db.Company &&
            item.MailOwnerId == ownerId && item.MailboxKey != "" && item.Status == "failed");
        var total = await query.CountAsync(cancellationToken);
        // Never materialize ResultJson/Error or unbounded row strings. Batch checks remain SQL booleans.
        var rows = await query.OrderByDescending(item => item.Id).Skip((page - 1) * PageSize).Take(PageSize)
            .Select(item => new
            {
                item.Id, MailReceivedAt = item.MailReceivedAt.Substring(0, 80), MailSubject = item.MailSubject.Substring(0, 240),
                MailboxKey = item.MailboxKey.Substring(0, 1025), TaskIds = item.TaskIdsJson.Substring(0, 1025),
                Untouched = item.HandlingStatus == "Pending" && item.HandlingOutcome == "" && item.WorkNote == "" &&
                    item.ReviewedAt == null && item.ClassificationSource.ToLower() != "manual",
                BatchReady = item.ImportBatch != null && item.ImportBatch.Company == db.Company &&
                    item.ImportBatch.MailOwnerId == ownerId && item.ImportBatch.Kind == "Email" &&
                    item.ImportBatch.Status == "PendingConfirmation"
            }).ToListAsync(cancellationToken);
        var ids = rows.Select(row => row.Id).ToArray();
        var directlyLinked = await db.ShipmentTasks.IgnoreQueryFilters().AsNoTracking()
            .Where(task => task.SourceImportItemId != null && ids.Contains(task.SourceImportItemId.Value))
            .Select(task => task.SourceImportItemId!.Value).Distinct().ToListAsync(cancellationToken);
        var items = rows.Select(row =>
        {
            long? uid = null;
            if (identityReady && row.MailboxKey.Length <= 1024)
            {
                var segment = row.MailboxKey[(row.MailboxKey.LastIndexOf(':') + 1)..];
                if (long.TryParse(segment, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) &&
                    parsed is > 0 and <= uint.MaxValue && parsed <= state!.LastUid && segment == parsed.ToString(CultureInfo.InvariantCulture))
                {
                    var expected = ownerId == 0 ? $"{state.Address}:{state.UidValidity}:{segment}"
                        : $"Huadeng:{ownerId}:{state.Identity}:{state.Address}:{state.UidValidity}:{segment}";
                    if (row.MailboxKey == expected) uid = parsed;
                }
            }
            var reason = !row.Untouched ? "邮件已有人工处理，请先核对现有记录"
                : !row.BatchReady ? "邮件批次状态不允许重试"
                : directlyLinked.Contains(row.Id) || !EmptyTaskIds(row.TaskIds) ? "邮件已有任务关联或关联资料需核对"
                : !identityReady ? "邮箱同步身份或绑定尚未核对，请联系管理员"
                : uid is null ? "邮件与当前邮箱同步身份不一致，请联系管理员"
                : "初步可选；提交时将再次核对权限、邮箱身份、任务关联和原邮件内容";
            return new
            {
                row.Id, row.MailReceivedAt, row.MailSubject, MailboxUid = uid,
                CanRetry = row.Untouched && row.BatchReady && !directlyLinked.Contains(row.Id) && EmptyTaskIds(row.TaskIds) && uid is not null,
                Reason = reason
            };
        }).ToArray();
        return new
        {
            Company = db.Company, OwnerId = db.Company == "Xingxin" ? (long?)null : ownerId, Address = identityReady ? state!.Address : "",
            Page = page, PageSize, Total = total, Items = items, SelectionLimit = 5, PreliminaryOnly = true,
            Status = new { IdentityReady = identityReady, LastAttemptAt = (DateTime?)null,
                LastSuccessAt = state?.LastSuccessAt, HasError = state?.HasError ?? false }
        };
    }

    private static bool EmptyTaskIds(string value)
    {
        if (value.Length > 1024) return false;
        try
        {
            using var document = JsonDocument.Parse(value, new JsonDocumentOptions { MaxDepth = 4 });
            return document.RootElement.ValueKind == JsonValueKind.Array && document.RootElement.GetArrayLength() == 0;
        }
        catch (JsonException) { return false; }
    }
}
