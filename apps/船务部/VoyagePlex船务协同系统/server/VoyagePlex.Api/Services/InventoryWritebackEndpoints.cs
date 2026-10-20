using Microsoft.EntityFrameworkCore;
using System.Text.Json.Nodes;
using VoyagePlex.Api.Data;
using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

public static class InventoryWritebackEndpoints
{
    public static void EnsureSchema(AppDbContext db)
    {
        db.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS InventoryWritebacks (
                Id INTEGER PRIMARY KEY AUTOINCREMENT, Company TEXT NOT NULL, TaskId INTEGER NOT NULL,
                OperationId TEXT NOT NULL, State TEXT NOT NULL, SnapshotJson TEXT NOT NULL, ResultJson TEXT NOT NULL,
                ActorId INTEGER NOT NULL, ActorName TEXT NOT NULL, CreatedAt TEXT NOT NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS IX_InventoryWritebacks_Company_TaskId ON InventoryWritebacks(Company, TaskId);
            CREATE TABLE IF NOT EXISTS InventoryFileClaims (Filename TEXT PRIMARY KEY NOT NULL, OperationId TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS TaskEditAudits (
                Id INTEGER PRIMARY KEY AUTOINCREMENT, Company TEXT NOT NULL, TaskId INTEGER NOT NULL,
                OwnerId INTEGER NOT NULL, ActorId INTEGER NOT NULL, ActorName TEXT NOT NULL, Action TEXT NOT NULL, CreatedAt TEXT NOT NULL);
            """);
    }

    public static void RecordEdit(AppDbContext db, ShipmentTask task, AppUser actor, string action) =>
        db.TaskEditAudits.Add(new TaskEditAudit { TaskId = task.Id, OwnerId = task.ResponsibleUserId,
            ActorId = actor.Id, ActorName = actor.DisplayName, Action = action });

    public static void MapInventoryWritebacks(this WebApplication app)
    {
        app.MapGet("/api/inventory/writebacks", async (AppDbContext db, CancellationToken ct) =>
        {
            var records = await db.InventoryWritebacks.AsNoTracking().Where(row => row.State != "Completed").OrderBy(row => row.Id).ToListAsync(ct);
            return Results.Ok(records.GroupBy(row => row.OperationId).Select(group => new {
                operationId = group.Key, state = group.First().State, actorName = group.First().ActorName,
                taskIds = group.Select(row => row.TaskId), result = JsonNode.Parse(group.First().ResultJson) }));
        });
        app.MapPost("/api/inventory/writebacks/{action}", async (string action, JsonObject body, HttpContext context, AppDbContext db, CancellationToken ct) =>
        {
            var actor = (AppUser)context.Items["CurrentUser"]!;
            if (actor.Role is not ("admin" or "warehouse")) return Results.Json(new { error = "当前账号无权回写库存" }, statusCode: 403);
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            try
            {
                if (action == "begin")
                {
                    var ids = (body["taskIds"] as JsonArray ?? []).Select(node => long.TryParse(node?.ToString(), out var id) ? id : 0).ToArray();
                    if (ids.Length is < 1 or > 500 || ids.Any(id => id <= 0) || ids.Distinct().Count() != ids.Length)
                        return Results.BadRequest(new { error = "任务编号无效" });
                    var tasks = await db.ShipmentTasks.Where(task => ids.Contains(task.Id)).ToListAsync(ct);
                    if (tasks.Count != ids.Length) return Results.NotFound(new { error = "任务不存在或属于其他厂区" });
                    if (await db.InventoryWritebacks.AnyAsync(row => ids.Contains(row.TaskId), ct))
                        return Results.Conflict(new { error = "任务已有回写记录，请先核对待恢复记录；已完成的任务不可重复扣库存" });
                    var operation = Guid.NewGuid().ToString("N");
                    var items = new JsonArray();
                    foreach (var id in ids)
                    {
                        var task = tasks.Single(task => task.Id == id);
                        if (task.Status != "PendingShipment") return Results.BadRequest(new { error = $"任务 #{id} 不是待走货状态" });
                        if ((JsonNode.Parse(task.ItemsJson) as JsonArray ?? []).Any(item => item?["inventory_writeback_task_id"]?.ToString() == id.ToString()))
                            return Results.Conflict(new { error = $"任务 #{id} 已有旧版回写标记，不可重复扣库存" });
                        var confirmation = new JsonObject { ["confirmedOwnerId"] = body["ownerConfirmations"]?[id.ToString()]?.DeepClone() };
                        if (TaskSafetyRules.OwnerWarning(task, actor, confirmation) is object warning) return Results.Json(warning, statusCode: 409);
                        var cargo = JsonNode.Parse(task.ItemsJson)?.AsArray() ?? [];
                        var snapshot = new JsonObject { ["items"] = cargo.DeepClone(), ["offset"] = items.Count,
                            ["updatedAt"] = task.UpdatedAt.ToString("O"), ["transportReference"] = task.TransportReference };
                        db.InventoryWritebacks.Add(new InventoryWriteback { TaskId = id, OperationId = operation,
                            SnapshotJson = snapshot.ToJsonString(), ActorId = actor.Id, ActorName = actor.DisplayName });
                        foreach (var item in cargo.OfType<JsonObject>())
                        {
                            var copy = item.DeepClone().AsObject();
                            copy["writeback_task_id"] = id.ToString(); copy["outbound_trip"] = task.TransportReference;
                            items.Add(copy);
                        }
                    }
                    if (items.Count == 0) return Results.BadRequest(new { error = "任务没有货物明细" });
                    await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
                    return Results.Ok(new { operationId = operation, ownerConfirmations = body["ownerConfirmations"]?.DeepClone(), payload = new JsonObject { ["task_id"] = operation,
                        ["outbound_date"] = DateTime.Today.ToString("yyyy-MM-dd"), ["items"] = items } });
                }
                var operationId = body["operationId"]?.ToString() ?? "";
                var rows = await db.InventoryWritebacks.Where(row => row.OperationId == operationId).OrderBy(row => row.Id).ToListAsync(ct);
                if (rows.Count == 0) return Results.NotFound(new { error = "回写记录不存在" });
                foreach (var row in rows)
                {
                    var task = await db.ShipmentTasks.SingleOrDefaultAsync(task => task.Id == row.TaskId, ct);
                    if (task is null) return Results.Conflict(new { error = "任务已不存在，请人工核对库存" });
                    var confirmation = new JsonObject { ["confirmedOwnerId"] = body["ownerConfirmations"]?[row.TaskId.ToString()]?.DeepClone() };
                    if (TaskSafetyRules.OwnerWarning(task, actor, confirmation) is object warning) return Results.Json(warning, statusCode: 409);
                }
                if (action == "prepared")
                {
                    if (rows.Any(row => row.State != "Preparing")) return Results.Conflict(new { error = "回写阶段已变化，请核对恢复记录" });
                    var result = body["result"] as JsonObject ?? throw new InvalidOperationException("缺少回写方案");
                    var files = result["files"] as JsonArray ?? [];
                    if (files.Count == 0) throw new InvalidOperationException("回写方案没有文件");
                    foreach (var file in files)
                    {
                        var name = file?["filename"]?.ToString() ?? "";
                        if (name.Length == 0 || name != Path.GetFileName(name) || !ValidHash(file?["beforeHash"]) || !ValidHash(file?["afterHash"]))
                            throw new InvalidOperationException("回写文件记录无效");
                        if (await db.InventoryFileClaims.AnyAsync(claim => claim.Filename == name.ToUpperInvariant(), ct))
                            return Results.Conflict(new { error = $"库存文件 {name} 正在其他回写中，请先处理待恢复记录" });
                        db.InventoryFileClaims.Add(new InventoryFileClaim { Filename = name.ToUpperInvariant(), OperationId = operationId });
                    }
                    foreach (var row in rows) { row.State = "Prepared"; row.ResultJson = result.ToJsonString(); }
                }
                else if (action == "writing")
                {
                    if (rows.Any(row => row.State != "Prepared")) return Results.Conflict(new { error = "此回写已开始或已完成，不可再次写入文件" });
                    foreach (var row in rows) row.State = "Writing";
                }
                else if (action == "cancel")
                {
                    if (rows.Any(row => row.State is not ("Preparing" or "Prepared")))
                        return Results.Conflict(new { error = "文件可能已写入，不能直接解除记录，请先核对文件" });
                    db.InventoryWritebacks.RemoveRange(rows);
                    await db.InventoryFileClaims.Where(claim => claim.OperationId == operationId).ExecuteDeleteAsync(ct);
                }
                else if (action == "rollback")
                {
                    if (body["confirmRollback"]?.ToString().ToLowerInvariant() != "true" || rows.Any(row => row.State != "Writing"))
                        return Results.Conflict(new { error = "请先停止原写入窗口，并人工核对全部原表" });
                    var result = JsonNode.Parse(rows[0].ResultJson)!;
                    var expected = result["files"] as JsonArray ?? [];
                    var evidence = body["files"] as JsonArray ?? [];
                    if (expected.Count == 0 || expected.Any(file => !evidence.Any(value => value?["filename"]?.ToString() == file?["filename"]?.ToString() && value?["hash"]?.ToString() == file?["beforeHash"]?.ToString())))
                        return Results.Conflict(new { error = "文件尚未全部恢复到写入前，未解除记录" });
                    foreach (var row in rows)
                    {
                        var task = await db.ShipmentTasks.SingleAsync(task => task.Id == row.TaskId, ct);
                        RecordEdit(db, task, actor, "InventoryWritebackManuallyRestored");
                    }
                    db.InventoryWritebacks.RemoveRange(rows);
                    await db.InventoryFileClaims.Where(claim => claim.OperationId == operationId).ExecuteDeleteAsync(ct);
                }
                else if (action == "complete")
                {
                    if (rows.All(row => row.State == "Completed")) return Results.Ok(new { completed = true, taskIds = rows.Select(row => row.TaskId) });
                    if (rows.Any(row => row.State != "Writing")) return Results.Conflict(new { error = "回写尚未进入文件写入阶段" });
                    var result = JsonNode.Parse(rows[0].ResultJson)!.AsObject();
                    var evidence = body["files"] as JsonArray ?? [];
                    foreach (var file in result["files"]!.AsArray())
                        if (!evidence.Any(value => value?["filename"]?.ToString() == file?["filename"]?.ToString() && value?["hash"]?.ToString() == file?["afterHash"]?.ToString()))
                            return Results.Conflict(new { error = "文件与写入后记录不一致，未补存完成状态；请人工核对，勿重复扣库存" });
                    foreach (var row in rows)
                    {
                        var task = await db.ShipmentTasks.SingleAsync(task => task.Id == row.TaskId, ct);
                        var snapshot = JsonNode.Parse(row.SnapshotJson)!;
                        if (task.UpdatedAt.ToString("O") != snapshot["updatedAt"]?.ToString() || task.Status != "PendingShipment")
                            return Results.Conflict(new { error = $"任务 #{task.Id} 在回写期间被修改，请人工核对；文件不可再次扣减" });
                        var cargo = snapshot["items"]!.DeepClone().AsArray();
                        var offset = snapshot["offset"]!.GetValue<int>();
                        for (var index = 0; index < cargo.Count; index++)
                        {
                            cargo[index]!["inventory_writeback_task_id"] = task.Id.ToString();
                            cargo[index]!["inventory_writeback_at"] = DateTime.UtcNow.ToString("O");
                            cargo[index]!["inventory_writeback_date"] = result["outbound_date"]?.DeepClone();
                            cargo[index]!["inventory_writeback_allocations"] = new JsonArray((result["allocations"] as JsonArray ?? []).Where(value => value?["item_index"]?.ToString() == (offset + index).ToString()).Select(value => value?.DeepClone()).ToArray());
                        }
                        task.ItemsJson = cargo.ToJsonString(); task.Status = "Completed";
                        task.CompletedDate = DateOnly.FromDateTime(DateTime.Today); task.UpdatedAt = DateTime.UtcNow;
                        row.State = "Completed"; RecordEdit(db, task, actor, "InventoryWritebackCompleted");
                    }
                    await db.InventoryFileClaims.Where(claim => claim.OperationId == operationId).ExecuteDeleteAsync(ct);
                }
                else return Results.BadRequest(new { error = "未知回写操作" });
                await db.SaveChangesAsync(ct); await transaction.CommitAsync(ct);
                return Results.Ok(new { operationId, state = action is "cancel" or "rollback" ? "Cancelled" : rows[0].State, taskIds = rows.Select(row => row.TaskId) });
            }
            catch (DbUpdateException) { return Results.Conflict(new { error = "任务或文件正在回写，请刷新并核对记录，不要重复操作" }); }
            catch (InvalidOperationException error) { return Results.BadRequest(new { error = error.Message }); }
        });
    }
    private static bool ValidHash(JsonNode? value) => value?.ToString() is string hash && hash.Length == 64 && hash.All(Uri.IsHexDigit);
}
