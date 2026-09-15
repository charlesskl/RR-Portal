using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Http.Features;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Security.Cryptography;
using Microsoft.VisualBasic.FileIO;
using VoyagePlex.Api.Data;
using VoyagePlex.Api.Entities;
using VoyagePlex.Api.Services;

var builder = WebApplication.CreateBuilder(args);

const long maxEmailFileBytes = 25L * 1024 * 1024;
const long maxEmailBatchBytes = 200L * 1024 * 1024;
const long multipartRequestLimitBytes = maxEmailBatchBytes + 5L * 1024 * 1024;

builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = multipartRequestLimitBytes);
builder.Services.Configure<FormOptions>(options => options.MultipartBodyLengthLimit = multipartRequestLimitBytes);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=voyageplex.db"));
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddHttpClient<EmailParserClient>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["EmailParser:BaseUrl"] ?? "http://localhost:8091");
    client.Timeout = TimeSpan.FromMinutes(5);
});
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins("http://localhost:3000", "http://127.0.0.1:3000").AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();
using (var scope = app.Services.CreateScope())
{
    var database = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    database.Database.EnsureCreated();
    EnsureShipmentTaskSchema(database);
    BackfillConfirmedShipmentTasks(database);
    BackfillShipmentEmailSubjects(database);
    BackfillDestinationCountries(database);
    database.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS InspectionMappings (
            Id INTEGER NOT NULL CONSTRAINT PK_InspectionMappings PRIMARY KEY AUTOINCREMENT,
            GroupName TEXT NOT NULL, InspectionSource TEXT NOT NULL, IsExcluded INTEGER NOT NULL,
            Customer TEXT NOT NULL, ProductCode TEXT NOT NULL, ProductName TEXT NOT NULL,
            Owner TEXT NOT NULL, ProductionPlace TEXT NOT NULL, Note TEXT NOT NULL,
            UpdatedAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS IX_InspectionMappings_GroupName_ProductCode
        ON InspectionMappings (GroupName, ProductCode);
        CREATE TABLE IF NOT EXISTS ProductInfos (
            Id INTEGER NOT NULL CONSTRAINT PK_ProductInfos PRIMARY KEY AUTOINCREMENT,
            LegacyId INTEGER NOT NULL, Customer TEXT NOT NULL, ProductCode TEXT NOT NULL,
            ProductName TEXT NOT NULL, QuantityPerBox INTEGER NULL, ToyCategory TEXT NOT NULL,
            FactoryRemark TEXT NOT NULL, GrossWeightPerBox TEXT NULL, NetWeightPerBox TEXT NULL,
            Source TEXT NOT NULL, UpdatedAt TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS IX_ProductInfos_ProductCode_QuantityPerBox
        ON ProductInfos (ProductCode COLLATE NOCASE, IFNULL(QuantityPerBox, -1));
        CREATE TABLE IF NOT EXISTS ProductNameMappings (
            Id INTEGER NOT NULL CONSTRAINT PK_ProductNameMappings PRIMARY KEY AUTOINCREMENT,
            ProductCodeKey TEXT NOT NULL, QuantityPerBox INTEGER NOT NULL,
            EnglishName TEXT NOT NULL, EnglishNameKey TEXT NOT NULL, ChineseName TEXT NOT NULL,
            CreatedAt TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS IX_ProductNameMappings_ProductCodeKey_QuantityPerBox_EnglishNameKey
        ON ProductNameMappings (ProductCodeKey, QuantityPerBox, EnglishNameKey);
        CREATE TABLE IF NOT EXISTS Users (
            Id INTEGER NOT NULL CONSTRAINT PK_Users PRIMARY KEY AUTOINCREMENT,
            Username TEXT NOT NULL, DisplayName TEXT NOT NULL, Role TEXT NOT NULL,
            PasswordHash TEXT NOT NULL, IsActive INTEGER NOT NULL,
            CreatedAt TEXT NOT NULL, UpdatedAt TEXT NOT NULL, LastLoginAt TEXT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS IX_Users_Username ON Users (Username);
        CREATE TABLE IF NOT EXISTS UserSessions (
            Id INTEGER NOT NULL CONSTRAINT PK_UserSessions PRIMARY KEY AUTOINCREMENT,
            UserId INTEGER NOT NULL, TokenHash TEXT NOT NULL, CreatedAt TEXT NOT NULL,
            ExpiresAt TEXT NOT NULL,
            CONSTRAINT FK_UserSessions_Users_UserId FOREIGN KEY (UserId) REFERENCES Users (Id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS IX_UserSessions_TokenHash ON UserSessions (TokenHash);
        CREATE INDEX IF NOT EXISTS IX_UserSessions_UserId ON UserSessions (UserId);
        """);
    SeedSystemSettings(database, app.Environment.ContentRootPath);
}
app.UseCors();
if (app.Environment.IsDevelopment()) { app.UseSwagger(); app.UseSwaggerUI(); }

const string sessionCookie = "voyageplex_session";
var validRoles = new[] { "admin", "shipping", "warehouse" };

app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value ?? "";
    var anonymous = path is "/api/health" or "/api/auth/login" or "/api/auth/setup-status" or "/api/auth/setup" ||
        (app.Environment.IsDevelopment() && path.StartsWith("/swagger", StringComparison.Ordinal));
    if (anonymous) { await next(); return; }

    var token = context.Request.Cookies[sessionCookie];
    if (string.IsNullOrWhiteSpace(token)) { context.Response.StatusCode = StatusCodes.Status401Unauthorized; await context.Response.WriteAsJsonAsync(new { error = "请先登录" }); return; }
    string tokenHash;
    try { tokenHash = PasswordService.TokenHash(token); }
    catch (FormatException) { context.Response.StatusCode = StatusCodes.Status401Unauthorized; await context.Response.WriteAsJsonAsync(new { error = "登录已失效" }); return; }
    var db = context.RequestServices.GetRequiredService<AppDbContext>();
    var session = await db.UserSessions.Include(value => value.User).FirstOrDefaultAsync(value => value.TokenHash == tokenHash);
    if (session is null || session.ExpiresAt <= DateTime.UtcNow || !session.User.IsActive)
    {
        if (session is not null) { db.UserSessions.Remove(session); await db.SaveChangesAsync(); }
        context.Response.Cookies.Delete(sessionCookie);
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(new { error = "登录已失效，请重新登录" }); return;
    }
    context.Items["CurrentUser"] = session.User;
    var role = session.User.Role;
    var shippingAllowed = role == "shipping" &&
        !path.StartsWith("/api/users", StringComparison.Ordinal) &&
        !path.StartsWith("/api/product-infos", StringComparison.Ordinal) &&
        !path.StartsWith("/api/inventory", StringComparison.Ordinal) &&
        !path.Contains("inventory-adjustment", StringComparison.Ordinal) &&
        !path.Contains("export/warehouse", StringComparison.Ordinal) &&
        !path.Contains("warehouse-locations", StringComparison.Ordinal);
    var warehouseShipmentAllowed = role == "warehouse" && path.StartsWith("/api/shipments", StringComparison.Ordinal) &&
        ((context.Request.Method == "GET" && (!path.Contains("/export", StringComparison.Ordinal) || path.Contains("export/warehouse", StringComparison.Ordinal) || path.Contains("inventory-adjustment", StringComparison.Ordinal))) ||
         context.Request.Method is "PATCH" or "DELETE" || (context.Request.Method == "POST" && path.Contains("warehouse-locations", StringComparison.Ordinal)));
    var allowed = role == "admin" || shippingAllowed || warehouseShipmentAllowed ||
        (role == "warehouse" && path.StartsWith("/api/inventory", StringComparison.Ordinal)) || path is "/api/auth/me" or "/api/auth/logout";
    if (!allowed) { context.Response.StatusCode = StatusCodes.Status403Forbidden; await context.Response.WriteAsJsonAsync(new { error = "当前账号无权使用此功能" }); return; }
    await next();
});

app.MapGet("/api/auth/setup-status", async (AppDbContext db, CancellationToken cancellationToken) =>
    Results.Ok(new { required = !await db.Users.AnyAsync(cancellationToken) }));

app.MapPost("/api/auth/setup", async (JsonObject payload, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (await db.Users.AnyAsync(cancellationToken)) return Results.Conflict(new { error = "系统已完成初始化" });
    var username = payload["username"]?.ToString().Trim().ToLowerInvariant() ?? "";
    var displayName = payload["displayName"]?.ToString().Trim() ?? "";
    var password = payload["password"]?.ToString() ?? "";
    var validation = ValidateUserInput(username, displayName, password, true);
    if (validation is not null) return Results.BadRequest(new { error = validation });
    var user = new AppUser { Username = username, DisplayName = displayName, Role = "admin", PasswordHash = PasswordService.Hash(password) };
    db.Users.Add(user); await db.SaveChangesAsync(cancellationToken);
    return Results.Created($"/api/users/{user.Id}", UserResponse(user));
});

app.MapPost("/api/auth/login", async (JsonObject payload, HttpContext context, AppDbContext db, CancellationToken cancellationToken) =>
{
    var username = payload["username"]?.ToString().Trim().ToLowerInvariant() ?? "";
    var password = payload["password"]?.ToString() ?? "";
    var user = await db.Users.FirstOrDefaultAsync(value => value.Username == username, cancellationToken);
    if (user is null || !user.IsActive || !PasswordService.Verify(password, user.PasswordHash))
        return Results.Json(new { error = "账号或密码不正确" }, statusCode: StatusCodes.Status401Unauthorized);
    var rawToken = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    db.UserSessions.Add(new UserSession { UserId = user.Id, TokenHash = PasswordService.TokenHash(rawToken), ExpiresAt = DateTime.UtcNow.AddHours(12) });
    user.LastLoginAt = DateTime.UtcNow; user.UpdatedAt = DateTime.UtcNow;
    await db.SaveChangesAsync(cancellationToken);
    context.Response.Cookies.Append(sessionCookie, rawToken, new CookieOptions { HttpOnly = true, SameSite = SameSiteMode.Strict, Secure = context.Request.IsHttps, MaxAge = TimeSpan.FromHours(12), Path = "/" });
    return Results.Ok(UserResponse(user));
});

app.MapGet("/api/auth/me", (HttpContext context) => Results.Ok(UserResponse((AppUser)context.Items["CurrentUser"]!)));
app.MapPost("/api/auth/logout", async (HttpContext context, AppDbContext db, CancellationToken cancellationToken) =>
{
    var token = context.Request.Cookies[sessionCookie];
    if (!string.IsNullOrWhiteSpace(token))
    {
        var hash = PasswordService.TokenHash(token);
        var session = await db.UserSessions.FirstOrDefaultAsync(value => value.TokenHash == hash, cancellationToken);
        if (session is not null) { db.UserSessions.Remove(session); await db.SaveChangesAsync(cancellationToken); }
    }
    context.Response.Cookies.Delete(sessionCookie, new CookieOptions { Path = "/" });
    return Results.NoContent();
});

app.MapGet("/api/users", async (AppDbContext db, CancellationToken cancellationToken) =>
    Results.Ok((await db.Users.AsNoTracking().OrderBy(value => value.Username).ToListAsync(cancellationToken)).Select(UserResponse)));

app.MapPost("/api/users", async (JsonObject payload, AppDbContext db, CancellationToken cancellationToken) =>
{
    var username = payload["username"]?.ToString().Trim().ToLowerInvariant() ?? "";
    var displayName = payload["displayName"]?.ToString().Trim() ?? "";
    var password = payload["password"]?.ToString() ?? "";
    var role = payload["role"]?.ToString() ?? "";
    var validation = ValidateUserInput(username, displayName, password, true);
    if (validation is not null) return Results.BadRequest(new { error = validation });
    if (!validRoles.Contains(role)) return Results.BadRequest(new { error = "用户角色无效" });
    if (await db.Users.AnyAsync(value => value.Username == username, cancellationToken)) return Results.Conflict(new { error = "账号已存在" });
    var user = new AppUser { Username = username, DisplayName = displayName, Role = role, PasswordHash = PasswordService.Hash(password) };
    db.Users.Add(user); await db.SaveChangesAsync(cancellationToken);
    return Results.Created($"/api/users/{user.Id}", UserResponse(user));
});

app.MapPut("/api/users/{id:long}", async (long id, JsonObject payload, HttpContext context, AppDbContext db, CancellationToken cancellationToken) =>
{
    var user = await db.Users.FindAsync([id], cancellationToken);
    if (user is null) return Results.NotFound(new { error = "用户不存在" });
    var displayName = payload["displayName"]?.ToString().Trim() ?? "";
    var role = payload["role"]?.ToString() ?? "";
    var isActive = payload["isActive"]?.GetValue<bool>() ?? user.IsActive;
    if (displayName.Length is < 1 or > 50) return Results.BadRequest(new { error = "姓名需为1至50个字符" });
    if (!validRoles.Contains(role)) return Results.BadRequest(new { error = "用户角色无效" });
    if ((user.Role == "admin" && role != "admin") || (user.IsActive && !isActive))
    {
        var activeAdmins = await db.Users.CountAsync(value => value.Role == "admin" && value.IsActive, cancellationToken);
        if (activeAdmins <= 1) return Results.BadRequest(new { error = "必须保留至少一个启用的管理员" });
    }
    var current = (AppUser)context.Items["CurrentUser"]!;
    if (current.Id == user.Id && !isActive) return Results.BadRequest(new { error = "不能停用当前登录账号" });
    user.DisplayName = displayName; user.Role = role; user.IsActive = isActive; user.UpdatedAt = DateTime.UtcNow;
    if (!isActive) await db.UserSessions.Where(value => value.UserId == id).ExecuteDeleteAsync(cancellationToken);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(UserResponse(user));
});

app.MapPost("/api/users/{id:long}/reset-password", async (long id, JsonObject payload, AppDbContext db, CancellationToken cancellationToken) =>
{
    var user = await db.Users.FindAsync([id], cancellationToken);
    if (user is null) return Results.NotFound(new { error = "用户不存在" });
    var password = payload["password"]?.ToString() ?? "";
    if (password.Length < 8 || password.Length > 128) return Results.BadRequest(new { error = "密码需为8至128个字符" });
    user.PasswordHash = PasswordService.Hash(password); user.UpdatedAt = DateTime.UtcNow;
    await db.UserSessions.Where(value => value.UserId == id).ExecuteDeleteAsync(cancellationToken);
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
});

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", service = "VoyagePlex.Api" }));
app.MapGet("/api/modules", () => Results.Ok(new[] {
    new { key = "information-import", status = "foundation" },
    new { key = "shipments", status = "foundation" },
    new { key = "inspection", status = "foundation" },
    new { key = "orders", status = "foundation" },
    new { key = "settings", status = "foundation" }
}));
app.MapPost("/api/imports/email", async (HttpRequest request, EmailParserClient parser, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!request.HasFormContentType)
        return Results.BadRequest(new { error = "请使用 multipart/form-data 上传 .eml 文件" });
    if (request.ContentLength > multipartRequestLimitBytes)
        return Results.Json(new { error = "所选邮件总大小超过 200MB，请分批上传" }, statusCode: StatusCodes.Status413PayloadTooLarge);

    var form = await request.ReadFormAsync(cancellationToken);
    var files = form.Files.GetFiles("files");
    if (files.Count == 0)
        return Results.BadRequest(new { error = "至少需要一个 files 字段" });
    if (files.Count > 50)
        return Results.BadRequest(new { error = "单批最多上传 50 封邮件" });
    if (files.Any(file => !file.FileName.EndsWith(".eml", StringComparison.OrdinalIgnoreCase)))
        return Results.BadRequest(new { error = "当前批量邮件接口只接受 .eml 文件" });
    if (files.Any(file => file.Length <= 0 || file.Length > maxEmailFileBytes))
        return Results.BadRequest(new { error = "每封邮件必须大于 0 且不超过 25MB" });
    if (files.Sum(file => file.Length) > maxEmailBatchBytes)
        return Results.Json(new { error = "所选邮件总大小超过 200MB，请分批上传" }, statusCode: StatusCodes.Status413PayloadTooLarge);

    var response = await parser.ParseBatchAsync(files, cancellationToken);
    if (response.StatusCode is < 200 or >= 300)
        return Results.Content(response.Body, response.ContentType, statusCode: response.StatusCode);

    var parsed = JsonNode.Parse(response.Body)?.AsObject();
    if (parsed is null)
        return Results.Problem("解析服务返回了无效结果");

    PopulatePreviewPlannedShipDates(parsed);
    await EnrichEmailProducts(parsed, db, false, cancellationToken);
    // 解析结果仅返回浏览器预览；用户确认前不创建任何数据库记录。
    return Results.Json(parsed);
}).DisableAntiforgery();

app.MapPost("/api/imports/email/confirm", async (JsonObject payload, AppDbContext db, CancellationToken cancellationToken) =>
{
    var submitted = payload["items"]?.AsArray();
    if (submitted is null || submitted.Count == 0)
        return Results.BadRequest(new { error = "没有可确认的邮件结果" });

    await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
    var batch = new ImportBatch
    {
        Kind = "Email",
        FileName = $"邮件批次 {DateTime.Now:yyyy-MM-dd HH:mm}",
        Status = "Confirmed",
        TotalCount = payload["total"]?.GetValue<int>() ?? submitted.Count,
        ParsedCount = payload["parsed"]?.GetValue<int>() ?? 0,
        FailedCount = payload["failed"]?.GetValue<int>() ?? 0,
        ParserVersion = payload["parser_version"]?.GetValue<string>() ?? string.Empty,
    };
    db.ImportBatches.Add(batch);
    await db.SaveChangesAsync(cancellationToken);

    var confirmed = new List<(ImportEmailItem Entity, JsonObject Result, bool Duplicate)>();
    foreach (var node in submitted)
    {
        if (node is not JsonObject reviewed) continue;
        var stored = JsonNode.Parse(reviewed.ToJsonString())?.AsObject() ?? new JsonObject();
        await EnrichEmailProducts(stored, db, true, cancellationToken);
        stored["reviewed_at"] = DateTime.UtcNow;
        var fingerprint = stored["fingerprint"]?.GetValue<string>() ?? string.Empty;
        var duplicate = string.IsNullOrEmpty(fingerprint) ? null : await db.ImportEmailItems.AsNoTracking()
            .Where(item => item.Fingerprint == fingerprint).OrderBy(item => item.Id).FirstOrDefaultAsync(cancellationToken);
        var failed = string.Equals(stored["status"]?.ToString(), "failed", StringComparison.OrdinalIgnoreCase);
        var entity = new ImportEmailItem
        {
            ImportBatchId = batch.Id,
            FileName = stored["filename"]?.GetValue<string>() ?? string.Empty,
            Fingerprint = fingerprint,
            Status = failed ? "failed" : duplicate is null ? "confirmed" : "duplicate_confirmed",
            DuplicateOfItemId = duplicate?.Id,
            ResultJson = stored.ToJsonString(),
            Error = stored["error"]?.GetValue<string>() ?? string.Empty,
        };
        db.ImportEmailItems.Add(entity);
        confirmed.Add((entity, stored, duplicate is not null));
    }
    await db.SaveChangesAsync(cancellationToken);

    var affectedTasks = new List<ShipmentTask>();
    foreach (var (entity, stored, isDuplicate) in confirmed.Where(value => value.Entity.Status != "failed"))
    {
        var sourceItemId = isDuplicate ? entity.DuplicateOfItemId ?? entity.Id : entity.Id;
        var incomingSo = ShipmentSoNumber(stored);
        var existingTask = await db.ShipmentTasks.FirstOrDefaultAsync(task =>
            task.SourceImportItemId == sourceItemId || (!string.IsNullOrEmpty(incomingSo) && task.SoNumber == incomingSo), cancellationToken);
        var shipmentTask = existingTask ?? new ShipmentTask { SourceImportItemId = sourceItemId };
        ApplyReviewedEmailToTask(shipmentTask, stored, existingTask is null);
        if (existingTask is null) db.ShipmentTasks.Add(shipmentTask);
        affectedTasks.Add(shipmentTask);
    }
    await db.SaveChangesAsync(cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return Results.Ok(new { batch_id = batch.Id, status = batch.Status, confirmed_at = DateTime.UtcNow, shipment_task_ids = affectedTasks.Select(task => task.Id).Distinct() });
});

app.MapPost("/api/imports/email/{batchId:long}/confirm", async (long batchId, JsonObject payload, AppDbContext db, CancellationToken cancellationToken) =>
{
    var batch = await db.ImportBatches.Include(value => value.EmailItems)
        .FirstOrDefaultAsync(value => value.Id == batchId && value.Kind == "Email", cancellationToken);
    if (batch is null) return Results.NotFound(new { error = "导入批次不存在" });
    if (batch.Status == "Confirmed") return Results.Conflict(new { error = "该批次已经确认" });

    var submitted = payload["items"]?.AsArray();
    if (submitted is null || submitted.Count == 0)
        return Results.BadRequest(new { error = "没有可确认的邮件结果" });

    var affectedTasks = new List<ShipmentTask>();
    foreach (var node in submitted)
    {
        var reviewed = node?.AsObject();
        if (reviewed is null) continue;
        var itemId = reviewed["import_item_id"]?.GetValue<long>() ?? 0;
        var entity = batch.EmailItems.FirstOrDefault(value => value.Id == itemId);
        if (entity is null) return Results.BadRequest(new { error = $"邮件结果 {itemId} 不属于该批次" });
        if (entity.Status == "failed") continue;

        var stored = JsonNode.Parse(entity.ResultJson)?.AsObject() ?? new JsonObject();
        stored["fields"] = reviewed["fields"]?.DeepClone();
        stored["warehouse_groups"] = reviewed["warehouse_groups"]?.DeepClone();
        stored["items"] = reviewed["items"]?.DeepClone();
        await EnrichEmailProducts(stored, db, true, cancellationToken);
        stored["reviewed_at"] = DateTime.UtcNow;
        entity.ResultJson = stored.ToJsonString();
        var isDuplicate = entity.Status == "duplicate";
        entity.Status = isDuplicate ? "duplicate_confirmed" : "confirmed";
        var sourceItemId = isDuplicate ? entity.DuplicateOfItemId ?? entity.Id : entity.Id;
        var incomingSo = ShipmentSoNumber(stored);
        var existingTask = await db.ShipmentTasks.FirstOrDefaultAsync(task =>
            task.SourceImportItemId == sourceItemId || (!string.IsNullOrEmpty(incomingSo) && task.SoNumber == incomingSo), cancellationToken);
        var shipmentTask = existingTask ?? new ShipmentTask { SourceImportItemId = sourceItemId };
        ApplyReviewedEmailToTask(shipmentTask, stored, existingTask is null);
        if (existingTask is null) db.ShipmentTasks.Add(shipmentTask);
        affectedTasks.Add(shipmentTask);
    }
    batch.Status = "Confirmed";
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { batch_id = batch.Id, status = batch.Status, confirmed_at = DateTime.UtcNow, shipment_task_ids = affectedTasks.Select(task => task.Id).Distinct() });
});

app.MapGet("/api/imports/email/{batchId:long}", async (long batchId, AppDbContext db, CancellationToken cancellationToken) =>
{
    var batch = await db.ImportBatches.AsNoTracking()
        .Include(value => value.EmailItems)
        .FirstOrDefaultAsync(value => value.Id == batchId && value.Kind == "Email", cancellationToken);
    return batch is null ? Results.NotFound() : Results.Ok(new
    {
        batch.Id, batch.Kind, batch.FileName, batch.Status, batch.TotalCount,
        batch.ParsedCount, batch.FailedCount, batch.ParserVersion, batch.CreatedAt,
        Items = batch.EmailItems.Select(item => new
        {
            item.Id, item.FileName, item.Fingerprint, item.Status,
            item.DuplicateOfItemId, item.ResultJson, item.Error, item.CreatedAt,
        })
    });
});
app.MapPost("/api/imports/spreadsheet", async (HttpRequest request, EmailParserClient parser, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!request.HasFormContentType)
        return Results.BadRequest(new { error = "请上传 Excel 或 CSV 表格" });
    var form = await request.ReadFormAsync(cancellationToken);
    var files = form.Files.GetFiles("files");
    if (files.Count == 0) return Results.BadRequest(new { error = "请选择至少一个表格" });
    if (files.Count > 20) return Results.BadRequest(new { error = "单批最多上传20个表格" });
    var allowed = new[] { ".xlsx", ".xlsm", ".xls", ".csv" };
    if (files.Any(file => !allowed.Contains(Path.GetExtension(file.FileName), StringComparer.OrdinalIgnoreCase)))
        return Results.BadRequest(new { error = "仅支持 xlsx、xls、csv 表格" });

    var response = await parser.ParseSpreadsheetBatchAsync(files, cancellationToken);
    if (response.StatusCode is < 200 or >= 300)
        return Results.Content(response.Body, response.ContentType, statusCode: response.StatusCode);
    var parsed = JsonNode.Parse(response.Body)?.AsObject();
    if (parsed is null) return Results.Problem("解析服务返回了无效结果");

    var batch = new ImportBatch {
        Kind = "Spreadsheet", FileName = $"表格批次 {DateTime.Now:yyyy-MM-dd HH:mm}",
        Status = (parsed["failed"]?.GetValue<int>() ?? 0) > 0 ? "NeedsAttention" : "PendingConfirmation",
        TotalCount = parsed["total"]?.GetValue<int>() ?? files.Count,
        ParsedCount = parsed["parsed"]?.GetValue<int>() ?? 0,
        FailedCount = parsed["failed"]?.GetValue<int>() ?? 0,
        ParserVersion = parsed["parser_version"]?.GetValue<string>() ?? string.Empty,
    };
    db.ImportBatches.Add(batch);
    await db.SaveChangesAsync(cancellationToken);
    foreach (var node in parsed["items"]?.AsArray() ?? []) {
        var result = node?.AsObject();
        if (result is null) continue;
        var entity = new ImportEmailItem {
            ImportBatchId = batch.Id, FileName = result["filename"]?.GetValue<string>() ?? string.Empty,
            Status = result["status"]?.GetValue<string>() ?? "failed", ResultJson = result.ToJsonString(),
            Error = result["error"]?.GetValue<string>() ?? string.Empty,
        };
        db.ImportEmailItems.Add(entity);
        await db.SaveChangesAsync(cancellationToken);
        result["import_item_id"] = entity.Id;
    }
    parsed["import_batch_id"] = batch.Id;
    return Results.Json(parsed);
}).DisableAntiforgery();

app.MapPost("/api/imports/spreadsheet/{batchId:long}/confirm", async (long batchId, AppDbContext db, CancellationToken cancellationToken) =>
{
    var batch = await db.ImportBatches.Include(value => value.EmailItems)
        .FirstOrDefaultAsync(value => value.Id == batchId && value.Kind == "Spreadsheet", cancellationToken);
    if (batch is null) return Results.NotFound(new { error = "表格导入批次不存在" });
    if (batch.Status == "Confirmed") return Results.Conflict(new { error = "该批次已经确认" });
    batch.Status = "Confirmed";
    foreach (var item in batch.EmailItems.Where(value => value.Status != "failed")) item.Status = "confirmed";
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { batch_id = batch.Id, status = batch.Status, confirmed_at = DateTime.UtcNow });
});

app.MapGet("/api/inspection-mappings", async (AppDbContext db, CancellationToken cancellationToken) =>
    Results.Ok(await db.InspectionMappings.AsNoTracking()
        .OrderBy(value => value.GroupName).ThenBy(value => value.Customer).ThenBy(value => value.ProductCode)
        .ToListAsync(cancellationToken)));

app.MapPost("/api/inspection-mappings/import", async (HttpRequest request, EmailParserClient parser, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!request.HasFormContentType) return Results.BadRequest(new { error = "请选择跟单负责货号Excel" });
    var form = await request.ReadFormAsync(cancellationToken);
    var file = form.Files.GetFile("file");
    if (file is null || file.Length == 0) return Results.BadRequest(new { error = "请选择跟单负责货号Excel" });
    if (!new[] { ".xlsx", ".xlsm" }.Contains(Path.GetExtension(file.FileName), StringComparer.OrdinalIgnoreCase))
        return Results.BadRequest(new { error = "目前只支持 xlsx、xlsm 文件" });
    var response = await parser.ParseInspectionMappingAsync(file, cancellationToken);
    if (response.StatusCode is < 200 or >= 300)
        return Results.Content(response.Body, response.ContentType, statusCode: response.StatusCode);
    var parsed = JsonNode.Parse(response.Body)?.AsObject();
    var rows = parsed?["rows"]?.AsArray();
    if (rows is null || rows.Count == 0) return Results.BadRequest(new { error = "表格中没有识别到验货映射" });

    await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
    await db.InspectionMappings.ExecuteDeleteAsync(cancellationToken);
    foreach (var node in rows)
    {
        var row = node?.AsObject();
        if (row is null) continue;
        db.InspectionMappings.Add(new InspectionMapping {
            GroupName = row["group_name"]?.GetValue<string>() ?? "",
            InspectionSource = row["inspection_source"]?.GetValue<string>() ?? "",
            IsExcluded = row["is_excluded"]?.GetValue<bool>() ?? false,
            Customer = row["customer"]?.GetValue<string>() ?? "",
            ProductCode = row["product_code"]?.GetValue<string>() ?? "",
            ProductName = row["product_name"]?.GetValue<string>() ?? "",
            Owner = row["owner"]?.GetValue<string>() ?? "",
            ProductionPlace = row["production_place"]?.GetValue<string>() ?? "",
            Note = row["note"]?.GetValue<string>() ?? "",
            UpdatedAt = DateTime.UtcNow,
        });
    }
    await db.SaveChangesAsync(cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return Results.Ok(new { total = rows.Count, filename = file.FileName });
}).DisableAntiforgery();

app.MapPost("/api/inspection-mappings", async (InspectionMapping value, AppDbContext db, CancellationToken cancellationToken) =>
{
    value.Id = 0; value.UpdatedAt = DateTime.UtcNow;
    db.InspectionMappings.Add(value);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Created($"/api/inspection-mappings/{value.Id}", value);
});

app.MapPut("/api/inspection-mappings/{id:long}", async (long id, InspectionMapping value, AppDbContext db, CancellationToken cancellationToken) =>
{
    var existing = await db.InspectionMappings.FindAsync([id], cancellationToken);
    if (existing is null) return Results.NotFound();
    existing.GroupName = value.GroupName; existing.InspectionSource = value.InspectionSource;
    existing.IsExcluded = value.IsExcluded; existing.Customer = value.Customer;
    existing.ProductCode = value.ProductCode; existing.ProductName = value.ProductName;
    existing.Owner = value.Owner; existing.ProductionPlace = value.ProductionPlace;
    existing.Note = value.Note; existing.UpdatedAt = DateTime.UtcNow;
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(existing);
});

app.MapDelete("/api/inspection-mappings/{id:long}", async (long id, AppDbContext db, CancellationToken cancellationToken) =>
{
    var existing = await db.InspectionMappings.FindAsync([id], cancellationToken);
    if (existing is null) return Results.NotFound();
    db.InspectionMappings.Remove(existing);
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
});

app.MapGet("/api/product-infos", async (string? query, string? customer, int? page, int? pageSize, AppDbContext db, CancellationToken cancellationToken) =>
{
    var products = db.ProductInfos.AsNoTracking().AsQueryable();
    if (!string.IsNullOrWhiteSpace(customer)) products = products.Where(value => value.Customer == customer.Trim());
    if (!string.IsNullOrWhiteSpace(query))
    {
        var term = query.Trim();
        products = products.Where(value => value.ProductCode.Contains(term) || value.ProductName.Contains(term) || value.Customer.Contains(term));
    }
    var currentPage = Math.Max(page ?? 1, 1);
    var size = Math.Clamp(pageSize ?? 50, 1, 200);
    var total = await products.CountAsync(cancellationToken);
    var items = await products.OrderBy(value => value.ProductCode).ThenBy(value => value.QuantityPerBox)
        .Skip((currentPage - 1) * size).Take(size).ToListAsync(cancellationToken);
    var customers = await db.ProductInfos.AsNoTracking().Where(value => value.Customer != "")
        .Select(value => value.Customer).Distinct().OrderBy(value => value).ToListAsync(cancellationToken);
    return Results.Ok(new { total, page = currentPage, pageSize = size, customers, items });
});

app.MapPost("/api/product-infos/import", async (HttpRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!request.HasFormContentType) return Results.BadRequest(new { error = "请选择旧系统导出的 CSV 文件" });
    var form = await request.ReadFormAsync(cancellationToken);
    var file = form.Files.GetFile("file");
    if (file is null || file.Length == 0) return Results.BadRequest(new { error = "请选择旧系统导出的 CSV 文件" });
    if (!file.FileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase)) return Results.BadRequest(new { error = "目前只支持 CSV 文件" });
    if (file.Length > 20 * 1024 * 1024) return Results.BadRequest(new { error = "CSV 文件不能超过 20MB" });
    List<ProductInfo> sourceRows;
    try { await using var stream = file.OpenReadStream(); sourceRows = ParseProductCsv(stream); }
    catch (InvalidDataException error) { return Results.BadRequest(new { error = error.Message }); }

    var selection = ProductImportRules.SelectLatest(sourceRows);

    await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
    await db.ProductInfos.ExecuteDeleteAsync(cancellationToken);
    db.ProductInfos.AddRange(selection.Items);
    await db.SaveChangesAsync(cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return Results.Ok(new {
        filename = file.FileName, sourceRows = sourceRows.Count, imported = selection.Items.Count,
        skippedCrossCustomerCodeCount = selection.SkippedCodes.Length, skippedCrossCustomerRows = selection.SkippedRows,
        supersededRows = selection.SupersededRows, skippedCodes = selection.SkippedCodes,
    });
}).DisableAntiforgery();

app.MapPost("/api/product-infos", async (ProductInfo value, AppDbContext db, CancellationToken cancellationToken) =>
{
    var error = ValidateProductInfo(value); if (error is not null) return Results.BadRequest(new { error });
    if (await ProductInfoExists(db, value.ProductCode, value.QuantityPerBox, null, cancellationToken)) return Results.Conflict(new { error = "相同货号和装箱规格已存在" });
    value.Id = 0; value.LegacyId = 0; value.ProductCode = value.ProductCode.Trim(); value.UpdatedAt = DateTime.UtcNow;
    db.ProductInfos.Add(value); await db.SaveChangesAsync(cancellationToken);
    return Results.Created($"/api/product-infos/{value.Id}", value);
});

app.MapPut("/api/product-infos/{id:long}", async (long id, ProductInfo value, AppDbContext db, CancellationToken cancellationToken) =>
{
    var existing = await db.ProductInfos.FindAsync([id], cancellationToken); if (existing is null) return Results.NotFound(new { error = "产品资料不存在" });
    var error = ValidateProductInfo(value); if (error is not null) return Results.BadRequest(new { error });
    if (await ProductInfoExists(db, value.ProductCode, value.QuantityPerBox, id, cancellationToken)) return Results.Conflict(new { error = "相同货号和装箱规格已存在" });
    existing.Customer=value.Customer.Trim(); existing.ProductCode=value.ProductCode.Trim(); existing.ProductName=value.ProductName.Trim(); existing.QuantityPerBox=value.QuantityPerBox;
    existing.ToyCategory=value.ToyCategory.Trim(); existing.FactoryRemark=value.FactoryRemark.Trim(); existing.GrossWeightPerBox=value.GrossWeightPerBox;
    existing.NetWeightPerBox=value.NetWeightPerBox; existing.Source=value.Source.Trim(); existing.UpdatedAt=DateTime.UtcNow;
    await db.SaveChangesAsync(cancellationToken); return Results.Ok(existing);
});

app.MapDelete("/api/product-infos/{id:long}", async (long id, AppDbContext db, CancellationToken cancellationToken) =>
{
    var existing = await db.ProductInfos.FindAsync([id], cancellationToken); if (existing is null) return Results.NotFound(new { error = "产品资料不存在" });
    db.ProductInfos.Remove(existing); await db.SaveChangesAsync(cancellationToken); return Results.NoContent();
});

app.MapGet("/api/shipments", async (string? status, string? customer, string? query, DateOnly? from, DateOnly? to, HttpContext context, AppDbContext db, CancellationToken cancellationToken) =>
{
    var tasks = db.ShipmentTasks.AsNoTracking().AsQueryable();
    var currentUser = (AppUser)context.Items["CurrentUser"]!;
    if (currentUser.Role == "warehouse") tasks = tasks.Where(task => task.Status == "PendingShipment" || task.Status == "Completed");
    if (!string.IsNullOrWhiteSpace(status)) tasks = tasks.Where(task => task.Status == status);
    if (!string.IsNullOrWhiteSpace(customer)) tasks = tasks.Where(task => task.Customer == customer);
    if (from.HasValue) tasks = tasks.Where(task => task.PlannedShipDate >= from);
    if (to.HasValue) tasks = tasks.Where(task => task.PlannedShipDate <= to);
    if (!string.IsNullOrWhiteSpace(query))
    {
        var term = query.Trim();
        tasks = tasks.Where(task => task.Customer.Contains(term) ||
            (task.SoNumber != null && task.SoNumber.Contains(term)) || task.ItemsJson.Contains(term));
    }
    var result = await tasks.OrderBy(task => task.PlannedShipDate == null)
        .ThenBy(task => task.PlannedShipDate).ThenBy(task => task.Id).ToListAsync(cancellationToken);
    return Results.Ok(result.Select(ToShipmentResponse));
});

app.MapGet("/api/inventory/local-scan", async (EmailParserClient parserClient, CancellationToken cancellationToken) =>
{
    var result = await parserClient.ScanLocalInventoryAsync(cancellationToken);
    return Results.Content(result.Body, result.ContentType, statusCode: result.StatusCode);
});

app.MapPost("/api/shipments", async (JsonObject payload, AppDbContext db, CancellationToken cancellationToken) =>
{
    var customer = payload["customer"]?.ToString().Trim() ?? "";
    if (string.IsNullOrWhiteSpace(customer)) return Results.BadRequest(new { error = "请填写客户/洋行" });
    DateOnly? plannedDate = null;
    var dateText = payload["plannedShipDate"]?.ToString();
    if (!string.IsNullOrWhiteSpace(dateText))
    {
        if (!DateOnly.TryParse(dateText, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedDate))
            return Results.BadRequest(new { error = "走货日期格式不正确" });
        plannedDate = parsedDate;
    }
    var task = new ShipmentTask
    {
        Customer = customer,
        SoNumber = payload["soNumber"]?.ToString().Trim(),
        ContainerType = payload["containerType"]?.ToString().Trim() ?? "",
        PlannedShipDate = plannedDate,
        Port = payload["port"]?.ToString().Trim() ?? "",
        DestinationCountry = payload["destinationCountry"]?.ToString().Trim() ?? "",
        TransportReference = payload["transportReference"]?.ToString().Trim() ?? "",
        Status = "PendingReview",
        WarehouseGroupsJson = "[]",
        ItemsJson = "[]",
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow
    };
    db.ShipmentTasks.Add(task);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Created($"/api/shipments/{task.Id}", ToShipmentResponse(task));
});

app.MapGet("/api/shipments/completed/monthly", async (int? year, int? month, AppDbContext db, CancellationToken cancellationToken) =>
{
    var target = new DateOnly(year ?? DateTime.Today.Year, month ?? DateTime.Today.Month, 1);
    var end = target.AddMonths(1);
    var tasks = await db.ShipmentTasks.AsNoTracking()
        .Where(task => task.Status == "Completed" && task.CompletedDate >= target && task.CompletedDate < end)
        .OrderBy(task => task.CompletedDate).ThenBy(task => task.Customer).ToListAsync(cancellationToken);
    return Results.Ok(new { year = target.Year, month = target.Month, tasks = tasks.Select(ToShipmentResponse) });
});

app.MapGet("/api/shipments/{id:long}", async (long id, HttpContext context, AppDbContext db, CancellationToken cancellationToken) =>
{
    var task = await db.ShipmentTasks.AsNoTracking().FirstOrDefaultAsync(value => value.Id == id, cancellationToken);
    if (task is null) return Results.NotFound(new { error = "走柜任务不存在" });
    var currentUser = (AppUser)context.Items["CurrentUser"]!;
    return currentUser.Role == "warehouse" && task.Status is not ("PendingShipment" or "Completed")
        ? Results.Json(new { error = "任务尚未移交仓务" }, statusCode: StatusCodes.Status403Forbidden)
        : Results.Ok(ToShipmentResponse(task));
});

app.MapDelete("/api/shipments/{id:long}", async (long id, AppDbContext db, CancellationToken cancellationToken) =>
{
    var task = await db.ShipmentTasks.FirstOrDefaultAsync(value => value.Id == id, cancellationToken);
    if (task is null) return Results.NotFound(new { error = "走柜任务不存在" });

    await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
    var imports = await db.ImportEmailItems.ToListAsync(cancellationToken);
    var sourceFingerprint = task.SourceImportItemId.HasValue
        ? imports.FirstOrDefault(value => value.Id == task.SourceImportItemId.Value)?.Fingerprint ?? string.Empty
        : string.Empty;
    var relatedImports = imports.Where(value => ShipmentDeletionRules.IsRelatedImport(task, value, sourceFingerprint)).ToList();
    var affectedBatchIds = relatedImports.Select(value => value.ImportBatchId).Distinct().ToList();

    db.ShipmentTasks.Remove(task);
    db.ImportEmailItems.RemoveRange(relatedImports);
    await db.SaveChangesAsync(cancellationToken);

    foreach (var batchId in affectedBatchIds)
    {
        var batch = await db.ImportBatches.FirstOrDefaultAsync(value => value.Id == batchId, cancellationToken);
        if (batch is null) continue;
        var remaining = await db.ImportEmailItems.Where(value => value.ImportBatchId == batchId).ToListAsync(cancellationToken);
        if (remaining.Count == 0) { db.ImportBatches.Remove(batch); continue; }
        batch.TotalCount = remaining.Count;
        batch.ParsedCount = remaining.Count(value => value.Status != "failed");
        batch.FailedCount = remaining.Count(value => value.Status == "failed");
    }
    await db.SaveChangesAsync(cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return Results.Ok(new { deleted_task_id = id, deleted_email_records = relatedImports.Count });
});

app.MapGet("/api/shipments/{id:long}/export", async (long id, AppDbContext db, EmailParserClient parserClient, CancellationToken cancellationToken) =>
{
    var task = await db.ShipmentTasks.AsNoTracking().FirstOrDefaultAsync(value => value.Id == id, cancellationToken);
    if (task is null) return Results.NotFound(new { error = "走柜任务不存在" });
    var relatedTasks = await db.ShipmentTasks.AsNoTracking().ToListAsync(cancellationToken);
    var payload = JsonNode.Parse(JsonSerializer.Serialize(
        ToShipmentResponse(task), new JsonSerializerOptions(JsonSerializerDefaults.Web)))!.AsObject();
    ShipmentOrderTotals.Apply(payload, relatedTasks);
    var exported = await parserClient.ExportShipmentAsync(payload, cancellationToken);
    if (exported.StatusCode < 200 || exported.StatusCode >= 300)
        return Results.Problem("走柜表生成失败", statusCode: exported.StatusCode);
    return Results.File(exported.Body, exported.ContentType, exported.FileName);
});

app.MapGet("/api/shipments/{id:long}/export/warehouse", async (long id, AppDbContext db, EmailParserClient parserClient, CancellationToken cancellationToken) =>
{
    var task = await db.ShipmentTasks.AsNoTracking().FirstOrDefaultAsync(value => value.Id == id, cancellationToken);
    if (task is null) return Results.NotFound(new { error = "走柜任务不存在" });
    if (task.Status is not ("PendingShipment" or "Completed"))
        return Results.BadRequest(new { error = "任务复核完成并进入待走货后，才能生成仓务走柜表" });
    var payload = JsonNode.Parse(JsonSerializer.Serialize(
        ToShipmentResponse(task),
        new JsonSerializerOptions(JsonSerializerDefaults.Web)))!.AsObject();
    payload["exportVariant"] = "warehouse";
    var relatedTasks = await db.ShipmentTasks.AsNoTracking().ToListAsync(cancellationToken);
    ShipmentOrderTotals.Apply(payload, relatedTasks);
    var exported = await parserClient.ExportShipmentAsync(payload, cancellationToken);
    if (exported.StatusCode < 200 || exported.StatusCode >= 300)
        return Results.Problem("仓务走柜表生成失败", statusCode: exported.StatusCode);
    return Results.File(exported.Body, exported.ContentType, exported.FileName);
});

app.MapPost("/api/shipments/{id:long}/warehouse-locations/refresh", async (long id, AppDbContext db, EmailParserClient parserClient, CancellationToken cancellationToken) =>
{
    var task = await db.ShipmentTasks.FirstOrDefaultAsync(value => value.Id == id, cancellationToken);
    if (task is null) return Results.NotFound(new { error = "走柜任务不存在" });
    if (task.Status is not ("PendingShipment" or "Completed"))
        return Results.BadRequest(new { error = "任务复核完成并进入待走货后，仓务才能查询放货区" });
    var items = JsonNode.Parse(string.IsNullOrWhiteSpace(task.ItemsJson) ? "[]" : task.ItemsJson)?.AsArray() ?? new JsonArray();
    var matchPayload = new { customer = task.Customer, items };
    var response = await parserClient.MatchLocalInventoryAsync(matchPayload, cancellationToken);
    if (response.StatusCode < 200 || response.StatusCode >= 300)
        return Results.Problem("本地库存表查询失败", statusCode: response.StatusCode);
    var matchResult = JsonNode.Parse(response.Body)?.AsObject();
    if (matchResult?["error"] is not null) return Results.BadRequest(new { error = matchResult["error"]!.ToString() });
    var matches = matchResult?["items"]?.AsArray() ?? new JsonArray();
    var matched = 0;
    for (var index = 0; index < items.Count; index++)
    {
        if (items[index] is not JsonObject item) continue;
        var result = matches.FirstOrDefault(node => node?["index"]?.GetValue<int>() == index)?.AsObject();
        var location = result?["location"]?.ToString() ?? "";
        item["warehouse_location"] = location;
        item["warehouse_match_status"] = result?["status"]?.ToString() ?? "未匹配";
        item["inventory_customer_name"] = result?["customer_name"]?.ToString() ?? "";
        item["inventory_country"] = result?["country"]?.ToString() ?? "";
        item["inventory_receipt_number"] = result?["receipt_number"]?.ToString() ?? "";
        item["inventory_source"] = result?["sources"]?.DeepClone();
        item["warehouse_location_refreshed_at"] = DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture);
        if (!string.IsNullOrWhiteSpace(location)) matched++;
    }
    task.ItemsJson = items.ToJsonString();
    task.UpdatedAt = DateTime.UtcNow;
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { task = ToShipmentResponse(task), matched, total = items.Count,
        message = $"已读取本地库存表：{items.Count} 条货品，找到 {matched} 条放货区" });
});

app.MapGet("/api/shipments/{id:long}/inventory-adjustment/export", async (long id, AppDbContext db, EmailParserClient parserClient, CancellationToken cancellationToken) =>
{
    var task = await db.ShipmentTasks.AsNoTracking().FirstOrDefaultAsync(value => value.Id == id, cancellationToken);
    if (task is null) return Results.NotFound(new { error = "走柜任务不存在" });
    if (task.Status != "Completed") return Results.BadRequest(new { error = "任务完成、车辆离厂后才能生成库存扣减写回表" });
    var exported = await parserClient.ExportInventoryAdjustmentAsync(ToShipmentResponse(task), cancellationToken);
    if (exported.StatusCode < 200 || exported.StatusCode >= 300)
        return Results.Problem("库存扣减写回表生成失败", statusCode: exported.StatusCode);
    return Results.File(exported.Body, exported.ContentType, exported.FileName);
});

app.MapGet("/api/shipments/completed/inventory-adjustment/export", async (DateOnly? from, DateOnly? to, AppDbContext db, EmailParserClient parserClient, CancellationToken cancellationToken) =>
{
    var start = from ?? new DateOnly(DateTime.Today.Year, DateTime.Today.Month, 1);
    var end = to ?? start.AddMonths(1).AddDays(-1);
    if (end < start) return Results.BadRequest(new { error = "结束日期不能早于开始日期" });
    var tasks = await db.ShipmentTasks.AsNoTracking().Where(task => task.Status == "Completed" && task.CompletedDate >= start && task.CompletedDate <= end)
        .OrderBy(task => task.CompletedDate).ThenBy(task => task.Id).ToListAsync(cancellationToken);
    if (tasks.Count == 0) return Results.BadRequest(new { error = "所选时间段没有已完成任务" });
    var payload = new
    {
        from = start.ToString("yyyy-MM-dd"),
        to = end.ToString("yyyy-MM-dd"),
        tasks = tasks.Select(task => ToShipmentResponse(task)).ToList()
    };
    var exported = await parserClient.ExportInventoryAdjustmentAsync(payload, cancellationToken);
    if (exported.StatusCode < 200 || exported.StatusCode >= 300) return Results.Problem("库存扣减写回表生成失败", statusCode: exported.StatusCode);
    return Results.File(exported.Body, exported.ContentType, exported.FileName);
});

app.MapGet("/api/shipments/completed/summary/export", async (DateOnly? from, DateOnly? to, AppDbContext db, EmailParserClient parserClient, CancellationToken cancellationToken) =>
{
    var start = from ?? new DateOnly(DateTime.Today.Year, DateTime.Today.Month, 1);
    var end = to ?? start.AddMonths(1).AddDays(-1);
    if (end < start) return Results.BadRequest(new { error = "结束日期不能早于开始日期" });
    var tasks = await db.ShipmentTasks.AsNoTracking().Where(task => task.Status == "Completed" && task.CompletedDate >= start && task.CompletedDate <= end)
        .OrderBy(task => task.CompletedDate).ThenBy(task => task.Id).ToListAsync(cancellationToken);
    if (tasks.Count == 0) return Results.BadRequest(new { error = "所选时间段没有已完成任务" });
    var payload = new { from = start.ToString("yyyy-MM-dd"), to = end.ToString("yyyy-MM-dd"), tasks = tasks.Select(ToShipmentResponse).ToList() };
    var exported = await parserClient.ExportCompletedShipmentSummaryAsync(payload, cancellationToken);
    if (exported.StatusCode < 200 || exported.StatusCode >= 300) return Results.Problem("走柜任务汇总生成失败", statusCode: exported.StatusCode);
    return Results.File(exported.Body, exported.ContentType, exported.FileName);
});

app.MapPatch("/api/shipments/{id:long}", async (long id, JsonObject payload, HttpContext context, AppDbContext db, CancellationToken cancellationToken) =>
{
    var task = await db.ShipmentTasks.FirstOrDefaultAsync(value => value.Id == id, cancellationToken);
    if (task is null) return Results.NotFound(new { error = "走柜任务不存在" });
    var currentUser = (AppUser)context.Items["CurrentUser"]!;
    if (currentUser.Role == "warehouse")
    {
        var allowedFields = new[] { "items", "status", "transportReference" };
        if (payload.Any(value => !allowedFields.Contains(value.Key))) return Results.Json(new { error = "仓库文员只能更新仓务明细和完成状态" }, statusCode: StatusCodes.Status403Forbidden);
        if (payload["status"] is JsonValue warehouseStatus && warehouseStatus.TryGetValue<string>(out var requestedStatus) && requestedStatus != "Completed")
            return Results.Json(new { error = "仓库文员只能将任务标记为已完成" }, statusCode: StatusCodes.Status403Forbidden);
        if (task.Status != "PendingShipment")
            return Results.Json(new { error = "只有待走货任务可以由仓务修改或完成" }, statusCode: StatusCodes.Status403Forbidden);
    }
    if (payload["plannedShipDate"] is JsonValue dateNode && dateNode.TryGetValue<string>(out var dateText))
        task.PlannedShipDate = string.IsNullOrWhiteSpace(dateText) ? null : DateOnly.Parse(dateText, CultureInfo.InvariantCulture);
    if (payload["customer"] is JsonValue customerNode && customerNode.TryGetValue<string>(out var customer)) task.Customer = customer.Trim();
    if (payload["soNumber"] is JsonValue soNode && soNode.TryGetValue<string>(out var soNumber)) task.SoNumber = soNumber.Trim();
    if (payload["containerType"] is JsonValue containerNode && containerNode.TryGetValue<string>(out var containerType)) task.ContainerType = containerType.Trim();
    if (payload["cutoffDate"] is JsonValue cutoffNode && cutoffNode.TryGetValue<string>(out var cutoffDate)) task.CutoffDate = cutoffDate.Trim();
    if (payload["siDeadline"] is JsonValue siNode && siNode.TryGetValue<string>(out var siDeadline)) task.SiDeadline = siDeadline.Trim();
    if (payload["port"] is JsonValue portNode && portNode.TryGetValue<string>(out var port)) task.Port = port.Trim();
    if (payload["destinationCountry"] is JsonValue destinationNode && destinationNode.TryGetValue<string>(out var destinationCountry)) task.DestinationCountry = destinationCountry.Trim();
    if (payload["transportReference"] is JsonValue transportNode && transportNode.TryGetValue<string>(out var transportReference)) task.TransportReference = transportReference.Trim();
    if (payload["specialRequirements"] is JsonValue requirementNode && requirementNode.TryGetValue<string>(out var requirements)) task.SpecialRequirements = requirements.Trim();
    if (payload["warehouseGroups"] is JsonArray warehouseGroups) task.WarehouseGroupsJson = warehouseGroups.ToJsonString();
    if (payload["items"] is JsonArray items) task.ItemsJson = SanitizeShipmentItems(items).ToJsonString();
    if (payload["status"] is JsonValue statusNode && statusNode.TryGetValue<string>(out var nextStatus))
    {
        var statuses = new[] { "PendingReview", "PendingShipment", "Completed", "Cancelled" };
        if (!statuses.Contains(nextStatus)) return Results.BadRequest(new { error = "任务状态无效" });
        if (nextStatus == "PendingShipment" && !ShipmentWorkflowRules.CanEnterPendingShipment(task.PlannedShipDate))
            return Results.BadRequest(new { error = "请先填写计划走货日期，再将任务转为待走货" });
        if (!ShipmentWorkflowRules.CanTransitionStatus(task.Status, nextStatus))
            return Results.BadRequest(new { error = "任务状态只能按“待复核 → 待走货 → 走货完成”推进，待复核或待走货时可以取消" });
        task.Status = nextStatus;
        task.CompletedDate = nextStatus == "Completed" ? DateOnly.FromDateTime(DateTime.Today) : null;
    }
    task.UpdatedAt = DateTime.UtcNow;
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(ToShipmentResponse(task));
});

app.Run();

static List<ProductInfo> ParseProductCsv(Stream stream)
{
    using var parser = new TextFieldParser(stream, System.Text.Encoding.UTF8, true) { TextFieldType = FieldType.Delimited, HasFieldsEnclosedInQuotes = true, TrimWhiteSpace = false };
    parser.SetDelimiters(",");
    var headers = parser.ReadFields()?.Select(value => value.Trim().TrimStart('\ufeff')).ToArray() ?? [];
    var index = headers.Select((name, position) => (name, position)).ToDictionary(value => value.name, value => value.position);
    foreach (var required in new[] { "记录ID", "客户", "货号", "货名", "每箱个数", "玩具类别", "备注(柜单)", "每箱毛重(kg)", "每箱净重(kg)", "来源" })
        if (!index.ContainsKey(required)) throw new InvalidDataException($"CSV 缺少“{required}”列，请让旧系统部署最新版导出功能后重新导出");
    var result = new List<ProductInfo>(); var line = 1;
    while (!parser.EndOfData)
    {
        line++; var fields = parser.ReadFields() ?? []; string Cell(string name) => index[name] < fields.Length ? fields[index[name]].Trim() : "";
        if (!long.TryParse(Cell("记录ID"), out var legacyId) || legacyId <= 0) throw new InvalidDataException($"第 {line} 行的记录ID无效");
        var productCode = Cell("货号"); if (productCode == "") throw new InvalidDataException($"第 {line} 行缺少货号");
        int? quantity = ParseNullableInt(Cell("每箱个数"), line, "每箱个数");
        decimal? gross = ParseNullableDecimal(Cell("每箱毛重(kg)"), line, "每箱毛重");
        decimal? net = ParseNullableDecimal(Cell("每箱净重(kg)"), line, "每箱净重");
        result.Add(new ProductInfo { LegacyId=legacyId, Customer=Cell("客户"), ProductCode=productCode, ProductName=Cell("货名"), QuantityPerBox=quantity, ToyCategory=Cell("玩具类别"), FactoryRemark=Cell("备注(柜单)"), GrossWeightPerBox=gross, NetWeightPerBox=net, Source=Cell("来源"), UpdatedAt=DateTime.UtcNow });
    }
    if (result.Count == 0) throw new InvalidDataException("CSV 中没有产品资料");
    return result;
}

static int? ParseNullableInt(string value, int line, string name)
{
    if (value == "") return null;
    if (!int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) || parsed <= 0) throw new InvalidDataException($"第 {line} 行的{name}无效");
    return parsed;
}

static decimal? ParseNullableDecimal(string value, int line, string name)
{
    if (value == "") return null;
    if (!decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed) || parsed <= 0) throw new InvalidDataException($"第 {line} 行的{name}无效");
    return parsed;
}

static string? ValidateProductInfo(ProductInfo value) => string.IsNullOrWhiteSpace(value.ProductCode) ? "货号不能为空" : value.QuantityPerBox is <= 0 ? "每箱个数必须大于0" : value.GrossWeightPerBox is <= 0 || value.NetWeightPerBox is <= 0 ? "毛重和净重必须大于0" : null;
static Task<bool> ProductInfoExists(AppDbContext db, string productCode, int? quantityPerBox, long? excludedId, CancellationToken cancellationToken)
{
    var normalized = productCode.Trim().ToUpper();
    return db.ProductInfos.AnyAsync(value => (!excludedId.HasValue || value.Id != excludedId.Value) && value.ProductCode.ToUpper() == normalized && value.QuantityPerBox == quantityPerBox, cancellationToken);
}

static object UserResponse(AppUser user) => new
{
    user.Id, user.Username, user.DisplayName, user.Role, user.IsActive,
    user.CreatedAt, user.UpdatedAt, user.LastLoginAt,
};

static string? ValidateUserInput(string username, string displayName, string password, bool requirePassword)
{
    if (!Regex.IsMatch(username, "^[a-z0-9][a-z0-9._-]{2,31}$")) return "账号需为3至32位小写字母、数字、点、横线或下划线";
    if (displayName.Length is < 1 or > 50) return "姓名需为1至50个字符";
    if (requirePassword && (password.Length < 8 || password.Length > 128)) return "密码需为8至128个字符";
    return null;
}

static object ToShipmentResponse(ShipmentTask task)
{
    static JsonNode ParseJson(string value, string fallback) => JsonNode.Parse(string.IsNullOrWhiteSpace(value) ? fallback : value) ?? JsonNode.Parse(fallback)!;
    return new
    {
        task.Id, task.Customer, task.EmailSubject, task.SoNumber, task.ContainerType, task.PlannedShipDate,
        task.CutoffDate, task.SiDeadline, task.Port, task.DestinationCountry, task.TransportReference, task.SpecialRequirements,
        task.Status, task.CompletedDate, task.SourceImportItemId,
        CreatedAt = UtcDateTime.Normalize(task.CreatedAt),
        UpdatedAt = UtcDateTime.Normalize(task.UpdatedAt),
        WarehouseGroups = ParseJson(task.WarehouseGroupsJson, "[]"),
        Items = ParseJson(task.ItemsJson, "[]"),
    };
}

static void ApplyReviewedEmailToTask(ShipmentTask task, JsonObject stored, bool initializeStatus = true)
{
    var fields = stored["fields"]?.AsObject() ?? new JsonObject();
    var message = stored["message"]?.AsObject() ?? new JsonObject();
    var sender = message["sender"]?.GetValue<string>() ?? string.Empty;
    var subject = message["subject"]?.GetValue<string>() ?? string.Empty;
    task.Customer = CustomerName(fields["customer"]?.ToString(), sender, subject);
    task.EmailSubject = subject.Trim();
    task.SoNumber = ShipmentSoNumber(stored);
    task.ContainerType = fields["container_type"]?.ToString() ?? string.Empty;
    task.CutoffDate = fields["cutoff_date"]?.ToString() ?? string.Empty;
    task.SiDeadline = fields["si_deadline"]?.ToString() ?? string.Empty;
    task.Port = fields["port"]?.ToString() ?? string.Empty;
    task.DestinationCountry = fields["destination_country"]?.ToString() ?? string.Empty;
    task.SpecialRequirements = fields["special_requirements"]?.ToString() ?? string.Empty;
    task.WarehouseGroupsJson = stored["warehouse_groups"]?.ToJsonString() ?? "[]";
    task.ItemsJson = SanitizeShipmentItems(stored["items"]?.AsArray() ?? new JsonArray()).ToJsonString();
    task.PlannedShipDate = ShipmentWorkflowRules.ResolvePlannedShipDate(
        fields["ship_date"]?.ToString() ?? string.Empty,
        task.CutoffDate,
        task.SiDeadline,
        message["received_at"]?.ToString());
    if (initializeStatus) task.Status = "PendingReview";
    task.UpdatedAt = DateTime.UtcNow;
}

static string ShipmentSoNumber(JsonObject stored)
{
    var fields = stored["fields"]?.AsObject() ?? new JsonObject();
    if (fields["so_number"]?.ToString() is { Length: > 0 } so) return so;
    var values = stored["so_numbers"]?.AsArray()
        .Select(value => value?.ToString() ?? string.Empty)
        .Where(value => !string.IsNullOrWhiteSpace(value)) ?? [];
    return string.Join(", ", values.Distinct());
}

static string CustomerName(string? parsedCustomer, string sender, string subject)
{
    if (!string.IsNullOrWhiteSpace(parsedCustomer)) return parsedCustomer.Trim();
    var known = new[] { "TMAX", "TIGERHEAD", "永恒", "ZURU", "Hanson", "兴信" };
    var matched = known.FirstOrDefault(value => sender.Contains(value, StringComparison.OrdinalIgnoreCase) || subject.Contains(value, StringComparison.OrdinalIgnoreCase));
    if (matched is not null) return matched;
    var displayName = Regex.Match(sender, @"^\s*([^<]+)").Groups[1].Value.Trim(' ', '\'', '"');
    return string.IsNullOrWhiteSpace(displayName) ? "待确认客户" : displayName;
}

static void PopulatePreviewPlannedShipDates(JsonObject parsed)
{
    foreach (var node in parsed["items"]?.AsArray() ?? [])
    {
        if (node is not JsonObject item || item["fields"] is not JsonObject fields) continue;
        if (!string.IsNullOrWhiteSpace(fields["ship_date"]?.ToString())) continue;
        var message = item["message"]?.AsObject();
        var resolved = ShipmentWorkflowRules.ResolvePlannedShipDate(
            string.Empty,
            fields["cutoff_date"]?.ToString() ?? string.Empty,
            fields["si_deadline"]?.ToString() ?? string.Empty,
            message?["received_at"]?.ToString());
        if (resolved.HasValue) fields["ship_date"] = resolved.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }
}

static async Task EnrichEmailProducts(JsonObject parsed, AppDbContext db, bool saveConfirmedMappings, CancellationToken cancellationToken)
{
    var products = saveConfirmedMappings
        ? await db.ProductInfos.AsNoTracking().ToListAsync(cancellationToken)
        : [];
    var mappings = saveConfirmedMappings
        ? await db.ProductNameMappings.AsNoTracking().ToListAsync(cancellationToken)
        : [];
    var pendingMappingKeys = db.ProductNameMappings.Local
        .Select(value => $"{value.ProductCodeKey}|{value.QuantityPerBox}|{value.EnglishNameKey}")
        .ToHashSet(StringComparer.Ordinal);

    static decimal? DecimalValue(JsonNode? node) => decimal.TryParse(
        node?.ToString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var value) ? value : null;

    void Enrich(JsonArray source)
    {
        foreach (var node in source)
        {
            if (node is not JsonObject item) continue;
            var displayedName = item["product_name"]?.ToString() ?? string.Empty;
            var sourceEnglishName = item["source_product_name"]?.ToString() ?? displayedName;
            var deferEmailName = ProductInfoMatching.ContainsLatin(sourceEnglishName);
            var manuallyConfirmedChineseName = ProductInfoMatching.ContainsChinese(displayedName) &&
                !ProductInfoMatching.ContainsLatin(displayedName);

            if (!saveConfirmedMappings)
            {
                if (deferEmailName)
                {
                    item["source_product_name"] = sourceEnglishName;
                    item["product_name"] = string.Empty;
                    item["product_name_status"] = "pending_product_info";
                }
                continue;
            }

            var productCode = item["product_code"]?.ToString() ?? string.Empty;
            var specification = DecimalValue(item["spec"]);
            var productCodeKey = ProductInfoMatching.NormalizeCode(productCode);
            if (productCodeKey.Length == 0 || specification is null || specification != decimal.Truncate(specification.Value)) continue;
            var quantityPerBox = decimal.ToInt32(specification.Value);
            var englishNameKey = ProductInfoMatching.NormalizeEnglishName(sourceEnglishName);
            var savedMapping = mappings.FirstOrDefault(value => value.ProductCodeKey == productCodeKey &&
                value.QuantityPerBox == quantityPerBox && value.EnglishNameKey == englishNameKey);
            var productMatch = ProductInfoMatching.FindExact(productCode, specification, products);

            if (deferEmailName && !manuallyConfirmedChineseName)
            {
                var chineseName = savedMapping?.ChineseName;
                if (!ProductInfoMatching.ContainsChinese(chineseName) &&
                    ProductInfoMatching.ContainsChinese(productMatch?.ChineseName))
                {
                    chineseName = productMatch!.ChineseName;
                }
                item["source_product_name"] = sourceEnglishName;
                displayedName = ProductInfoMatching.ContainsChinese(chineseName) ? chineseName! : string.Empty;
                item["product_name"] = displayedName;
                item["product_name_status"] = displayedName.Length > 0 ? "matched" : "pending_product_info";
            }

            if (productMatch is not null)
            {
                if (productMatch.Product.GrossWeightPerBox is > 0 && productMatch.Product.NetWeightPerBox is > 0)
                {
                    var grossPerBox = productMatch.Product.GrossWeightPerBox.Value;
                    var netPerBox = productMatch.Product.NetWeightPerBox.Value;
                    item["gross_weight_per_box"] = grossPerBox;
                    item["net_weight_per_box"] = netPerBox;
                    var pieces = DecimalValue(item["pieces"]);
                    if (pieces is not null)
                    {
                        item["gross_weight"] = ProductInfoMatching.TotalWeight(pieces.Value, grossPerBox);
                        item["net_weight"] = ProductInfoMatching.TotalWeight(pieces.Value, netPerBox);
                    }
                }
                item["product_info_match"] = "exact";
            }
            else if (savedMapping is not null)
            {
                item["product_info_match"] = "confirmed_name_mapping";
            }

            if (!deferEmailName || productMatch is null || englishNameKey.Length == 0 ||
                !ProductInfoMatching.ContainsChinese(productMatch.ChineseName) || displayedName != productMatch.ChineseName) continue;
            var mappingKey = $"{productCodeKey}|{quantityPerBox}|{englishNameKey}";
            if (savedMapping is not null || !pendingMappingKeys.Add(mappingKey)) continue;
            db.ProductNameMappings.Add(new ProductNameMapping
            {
                ProductCodeKey = productCodeKey, QuantityPerBox = quantityPerBox,
                EnglishName = sourceEnglishName.Trim(), EnglishNameKey = englishNameKey,
                ChineseName = productMatch.ChineseName, CreatedAt = DateTime.UtcNow,
            });
        }
    }

    Enrich(parsed["items"]?.AsArray() ?? new JsonArray());
    foreach (var groupNode in parsed["warehouse_groups"]?.AsArray() ?? [])
        if (groupNode is JsonObject group) Enrich(group["items"]?.AsArray() ?? new JsonArray());
}

static JsonArray SanitizeShipmentItems(JsonArray source) =>
    JsonNode.Parse(source.ToJsonString())?.AsArray() ?? new JsonArray();

static List<JsonObject> InventoryRows(IEnumerable<ImportEmailItem> imports)
{
    var result = new List<JsonObject>();
    foreach (var import in imports)
    {
        var parsed = JsonNode.Parse(import.ResultJson)?.AsObject();
        if (!string.Equals(parsed?["kind"]?.ToString(), "inventory", StringComparison.OrdinalIgnoreCase)) continue;
        foreach (var node in parsed?["rows"]?.AsArray() ?? [])
        {
            if (node is not JsonObject row) continue;
            var copy = JsonNode.Parse(row.ToJsonString())!.AsObject();
            copy["source_file"] = import.FileName;
            result.Add(copy);
        }
    }
    return result;
}

static (string Location, string Status, string CustomerName, string Country, string ReceiptNumber) FindWarehouseLocations(string customer, JsonObject item, IReadOnlyList<JsonObject> inventoryRows)
{
    var contract = NormalizeMatchText(item["contract_number"]?.ToString() ?? item["contractNumber"]?.ToString());
    var product = NormalizeMatchText(item["product_code"]?.ToString() ?? item["productCode"]?.ToString());
    var specification = NormalizeMatchText(item["product_name"]?.ToString() ?? item["spec"]?.ToString());
    if (string.IsNullOrEmpty(contract)) return ("", "缺少合同号", "", "", "");
    if (string.IsNullOrEmpty(product)) return ("", "缺少货号", "", "", "");
    if (string.IsNullOrEmpty(specification)) return ("", "缺少规格", "", "", "");
    var customerKey = NormalizeMatchText(customer);
    var matches = inventoryRows.Where(row =>
        CustomerMatches(customerKey, row) &&
        NormalizeMatchText(row["contract_number"]?.ToString()) == contract &&
        NormalizeMatchText(row["product_code"]?.ToString()) == product &&
        NormalizeMatchText(row["product_name"]?.ToString()) == specification).ToList();
    var locations = matches.Select(row => row["storage_location"]?.ToString()?.Trim() ?? "")
        .Where(value => !string.IsNullOrWhiteSpace(value)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    if (matches.Count == 0) return ("", "未匹配到对应批次", "", "", "");
    string Joined(string key) => string.Join("／", matches.Select(row => row[key]?.ToString()?.Trim() ?? "").Where(value => !string.IsNullOrWhiteSpace(value)).Distinct());
    var status = locations.Count == 0 ? "批次已匹配，放货区为空" : locations.Count > 1 ? "已匹配多个放货区" : "已匹配";
    return (string.Join("／", locations), status, Joined("customer"), Joined("country"), Joined("inbound_receipt_number"));
}

static bool CustomerMatches(string customerKey, JsonObject row)
{
    if (string.IsNullOrEmpty(customerKey)) return true;
    var rowCustomer = NormalizeMatchText(row["customer"]?.ToString());
    var sheet = NormalizeMatchText(row["source_sheet"]?.ToString());
    return rowCustomer == customerKey || sheet == customerKey ||
        (!string.IsNullOrEmpty(sheet) && (sheet.Contains(customerKey) || customerKey.Contains(sheet)));
}

static string NormalizeMatchText(string? value)
{
    var text = (value ?? "").Trim().ToUpperInvariant();
    if (text.EndsWith(".0", StringComparison.Ordinal) && decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out var number))
        text = decimal.Truncate(number).ToString(CultureInfo.InvariantCulture);
    return Regex.Replace(text, @"\s+", "");
}

static void EnsureShipmentTaskSchema(AppDbContext db)
{
    var columns = new Dictionary<string, string>
    {
        ["ContainerType"] = "TEXT NOT NULL DEFAULT ''", ["CutoffDate"] = "TEXT NOT NULL DEFAULT ''",
        ["EmailSubject"] = "TEXT NOT NULL DEFAULT ''",
        ["SiDeadline"] = "TEXT NOT NULL DEFAULT ''", ["Port"] = "TEXT NOT NULL DEFAULT ''",
        ["DestinationCountry"] = "TEXT NOT NULL DEFAULT ''",
        ["TransportReference"] = "TEXT NOT NULL DEFAULT ''",
        ["SpecialRequirements"] = "TEXT NOT NULL DEFAULT ''", ["WarehouseGroupsJson"] = "TEXT NOT NULL DEFAULT '[]'",
        ["ItemsJson"] = "TEXT NOT NULL DEFAULT '[]'", ["SourceImportItemId"] = "INTEGER NULL",
        ["CompletedDate"] = "TEXT NULL", ["UpdatedAt"] = "TEXT NOT NULL DEFAULT '0001-01-01 00:00:00'",
    };
    using var connection = db.Database.GetDbConnection();
    connection.Open();
    using var check = connection.CreateCommand();
    check.CommandText = "PRAGMA table_info('ShipmentTasks')";
    var existing = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    using (var reader = check.ExecuteReader()) while (reader.Read()) existing.Add(reader.GetString(1));
    foreach (var column in columns.Where(pair => !existing.Contains(pair.Key)))
    {
        using var alter = connection.CreateCommand();
        alter.CommandText = $"ALTER TABLE ShipmentTasks ADD COLUMN {column.Key} {column.Value}";
        alter.ExecuteNonQuery();
    }
    db.Database.ExecuteSqlRaw("CREATE UNIQUE INDEX IF NOT EXISTS IX_ShipmentTasks_SourceImportItemId ON ShipmentTasks (SourceImportItemId) WHERE SourceImportItemId IS NOT NULL");
}

static void BackfillShipmentEmailSubjects(AppDbContext db)
{
    var tasks = db.ShipmentTasks.Where(task => task.EmailSubject == "" && task.SourceImportItemId != null).ToList();
    if (tasks.Count == 0) return;
    var sourceIds = tasks.Select(task => task.SourceImportItemId!.Value).ToHashSet();
    var imports = db.ImportEmailItems.AsNoTracking().Where(item => sourceIds.Contains(item.Id)).ToList()
        .ToDictionary(item => item.Id);
    foreach (var task in tasks)
    {
        if (!imports.TryGetValue(task.SourceImportItemId!.Value, out var importItem)) continue;
        var subject = JsonNode.Parse(importItem.ResultJson)?["message"]?["subject"]?.ToString()?.Trim();
        if (!string.IsNullOrWhiteSpace(subject)) task.EmailSubject = subject;
    }
    db.SaveChanges();
}

static void BackfillDestinationCountries(AppDbContext db)
{
    var tasks = db.ShipmentTasks.Where(task => task.DestinationCountry == "").ToList();
    foreach (var task in tasks)
        task.DestinationCountry = DestinationCountryRules.Infer(task.EmailSubject, task.WarehouseGroupsJson);
    if (tasks.Any(task => task.DestinationCountry.Length > 0)) db.SaveChanges();
}

static void BackfillConfirmedShipmentTasks(AppDbContext db)
{
    var confirmedItems = db.ImportEmailItems.AsNoTracking()
        .Where(item => item.Status == "confirmed" || item.Status == "duplicate_confirmed")
        .OrderBy(item => item.Id).ToList();
    foreach (var item in confirmedItems)
    {
        var stored = JsonNode.Parse(item.ResultJson)?.AsObject();
        if (stored is null) continue;
        var sourceItemId = item.Status == "duplicate_confirmed" ? item.DuplicateOfItemId ?? item.Id : item.Id;
        var incomingSo = ShipmentSoNumber(stored);
        var exists = db.ShipmentTasks.Any(task => task.SourceImportItemId == sourceItemId ||
            (!string.IsNullOrEmpty(incomingSo) && task.SoNumber == incomingSo));
        if (exists) continue;
        var task = new ShipmentTask { SourceImportItemId = sourceItemId };
        ApplyReviewedEmailToTask(task, stored);
        db.ShipmentTasks.Add(task);
    }
    db.SaveChanges();
}

static void SeedSystemSettings(AppDbContext db, string contentRootPath)
{
    var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
    // seed JSON 来自旧系统导出，日期是空格分隔格式（2026-09-11 00:31:18.690457），需要宽松解析
    options.Converters.Add(new LenientDateTimeConverter());
    var seedDirectory = Path.Combine(contentRootPath, "seed");
    if (!db.ProductInfos.Any())
    {
        var path = Path.Combine(seedDirectory, "product-infos.json");
        if (File.Exists(path))
        {
            var rows = JsonSerializer.Deserialize<List<ProductInfo>>(File.ReadAllText(path), options) ?? [];
            foreach (var row in rows) row.Id = 0;
            db.ProductInfos.AddRange(rows);
        }
    }
    if (!db.ProductNameMappings.Any())
    {
        var path = Path.Combine(seedDirectory, "product-name-mappings.json");
        if (File.Exists(path))
        {
            var rows = JsonSerializer.Deserialize<List<ProductNameMapping>>(File.ReadAllText(path), options) ?? [];
            foreach (var row in rows) row.Id = 0;
            db.ProductNameMappings.AddRange(rows);
        }
    }
    db.SaveChanges();
}
