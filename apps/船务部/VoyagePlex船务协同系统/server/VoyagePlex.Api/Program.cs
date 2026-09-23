using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Http.Features;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Security.Cryptography;
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
builder.Services.AddSingleton<MailboxSyncService>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<MailboxSyncService>());
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins("http://localhost:3000", "http://127.0.0.1:3000").AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();
using (var scope = app.Services.CreateScope())
{
    var database = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    database.Database.EnsureCreated();
    database.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS MailSyncStates (
            Id INTEGER NOT NULL CONSTRAINT PK_MailSyncStates PRIMARY KEY,
            Address TEXT NOT NULL, UidValidity INTEGER NOT NULL, LastUid INTEGER NOT NULL,
            LastSuccessAt TEXT NULL, LastError TEXT NOT NULL
        );
        """);
    var mailColumns = new HashSet<string>(StringComparer.Ordinal);
    using (var command = database.Database.GetDbConnection().CreateCommand())
    {
        command.CommandText = "PRAGMA table_info('ImportEmailItems')";
        database.Database.OpenConnection();
        using var reader = command.ExecuteReader();
        while (reader.Read()) mailColumns.Add(reader.GetString(1));
    }
    var mailColumnUpdates = new (string Name, string Sql)[]
    {
        ("MailboxKey", "ALTER TABLE ImportEmailItems ADD COLUMN MailboxKey TEXT NOT NULL DEFAULT ''"),
        ("MailSubject", "ALTER TABLE ImportEmailItems ADD COLUMN MailSubject TEXT NOT NULL DEFAULT ''"),
        ("MailSender", "ALTER TABLE ImportEmailItems ADD COLUMN MailSender TEXT NOT NULL DEFAULT ''"),
        ("MailReceivedAt", "ALTER TABLE ImportEmailItems ADD COLUMN MailReceivedAt TEXT NOT NULL DEFAULT ''"),
        ("MailReceivedDate", "ALTER TABLE ImportEmailItems ADD COLUMN MailReceivedDate TEXT NOT NULL DEFAULT ''"),
        ("WorkCategory", "ALTER TABLE ImportEmailItems ADD COLUMN WorkCategory TEXT NOT NULL DEFAULT 'Unclassified'"),
        ("ClassificationSource", "ALTER TABLE ImportEmailItems ADD COLUMN ClassificationSource TEXT NOT NULL DEFAULT 'Automatic'"),
        ("ClassificationConfidence", "ALTER TABLE ImportEmailItems ADD COLUMN ClassificationConfidence INTEGER NOT NULL DEFAULT 0"),
        ("NeedsClassificationReview", "ALTER TABLE ImportEmailItems ADD COLUMN NeedsClassificationReview INTEGER NOT NULL DEFAULT 1"),
        ("HandlingStatus", "ALTER TABLE ImportEmailItems ADD COLUMN HandlingStatus TEXT NOT NULL DEFAULT 'Pending'"),
        ("WorkNote", "ALTER TABLE ImportEmailItems ADD COLUMN WorkNote TEXT NOT NULL DEFAULT ''"),
        ("ReviewedAt", "ALTER TABLE ImportEmailItems ADD COLUMN ReviewedAt TEXT NULL"),
    };
    foreach (var column in mailColumnUpdates)
        if (!mailColumns.Contains(column.Name)) database.Database.ExecuteSqlRaw(column.Sql);
    database.Database.ExecuteSqlRaw("CREATE UNIQUE INDEX IF NOT EXISTS IX_ImportEmailItems_MailboxKey ON ImportEmailItems (MailboxKey) WHERE MailboxKey <> ''");
    database.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_ImportEmailItems_MailReceivedDate ON ImportEmailItems (MailReceivedDate)");
    database.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS MailContacts (
            Id INTEGER NOT NULL CONSTRAINT PK_MailContacts PRIMARY KEY AUTOINCREMENT,
            Email TEXT NOT NULL, DisplayName TEXT NOT NULL, ContactType TEXT NOT NULL,
            DefaultCategory TEXT NOT NULL, IsConfirmed INTEGER NOT NULL, MessageCount INTEGER NOT NULL,
            UpdatedAt TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS IX_MailContacts_Email ON MailContacts (Email);
        CREATE TABLE IF NOT EXISTS MailSystemSettings (
            Id INTEGER NOT NULL CONSTRAINT PK_MailSystemSettings PRIMARY KEY,
            SyncEnabled INTEGER NOT NULL, SyncIntervalMinutes INTEGER NOT NULL,
            RetentionDays INTEGER NOT NULL, UpdatedAt TEXT NOT NULL
        );
        INSERT OR IGNORE INTO MailSystemSettings (Id, SyncEnabled, SyncIntervalMinutes, RetentionDays, UpdatedAt)
        VALUES (1, 1, 5, 180, CURRENT_TIMESTAMP);
        """);
    var receivedDateColumnExists = false;
    using (var command = database.Database.GetDbConnection().CreateCommand())
    {
        command.CommandText = "PRAGMA table_info('ImportBatches')";
        using var reader = command.ExecuteReader();
        while (reader.Read()) if (reader.GetString(1) == "MailReceivedDate") receivedDateColumnExists = true;
    }
    if (!receivedDateColumnExists)
        database.Database.ExecuteSqlRaw("ALTER TABLE ImportBatches ADD COLUMN MailReceivedDate TEXT NOT NULL DEFAULT ''");
    var historicalMail = database.ImportEmailItems.Include(item => item.ImportBatch)
        .Where(item => item.MailboxKey != "" && (item.MailReceivedAt == "" || item.MailReceivedDate == "")).ToList();
    foreach (var item in historicalMail)
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
            // 历史异常邮件保留原记录，供人工核对。
        }
    }
    if (historicalMail.Count > 0) database.SaveChanges();
    var mailboxItems = database.ImportEmailItems.Where(item => item.MailboxKey != "").ToList();
    var existingContacts = database.MailContacts.ToDictionary(contact => contact.Email, StringComparer.OrdinalIgnoreCase);
    foreach (var senderGroup in mailboxItems.GroupBy(item => MailClassificationRules.NormalizeEmail(item.MailSender)).Where(group => group.Key != ""))
    {
        if (!existingContacts.TryGetValue(senderGroup.Key, out var contact))
        {
            contact = new MailContact { Email = senderGroup.Key, DisplayName = senderGroup.First().MailSender };
            database.MailContacts.Add(contact); existingContacts[senderGroup.Key] = contact;
        }
        contact.MessageCount = senderGroup.Count(); contact.UpdatedAt = DateTime.UtcNow;
        if (MailContactRules.IsInternal(contact.Email)) { contact.ContactType = "Internal"; contact.IsConfirmed = true; }
    }
    foreach (var item in mailboxItems.Where(item => item.ClassificationSource != "Manual"))
    {
        var classification = MailClassificationRules.Classify(item.MailSubject);
        item.WorkCategory = classification.Category; item.ClassificationConfidence = classification.Confidence;
        item.ClassificationSource = classification.Source; item.NeedsClassificationReview = classification.NeedsReview;
    }
    if (mailboxItems.Count > 0) database.SaveChanges();
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
}
app.UseCors();
if (app.Environment.IsDevelopment()) { app.UseSwagger(); app.UseSwaggerUI(); }

const string sessionCookie = "voyageplex_session";
var sessionLifetime = TimeSpan.FromDays(7);
var sessionRenewalWindow = TimeSpan.FromDays(3);
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
    if (path == "/api/auth/me" && session.ExpiresAt - DateTime.UtcNow <= sessionRenewalWindow)
    {
        session.ExpiresAt = DateTime.UtcNow.Add(sessionLifetime);
        await db.SaveChangesAsync();
        context.Response.Cookies.Append(sessionCookie, token, new CookieOptions { HttpOnly = true, SameSite = SameSiteMode.Strict, Secure = context.Request.IsHttps, MaxAge = sessionLifetime, Path = "/" });
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
    db.UserSessions.Add(new UserSession { UserId = user.Id, TokenHash = PasswordService.TokenHash(rawToken), ExpiresAt = DateTime.UtcNow.Add(sessionLifetime) });
    user.LastLoginAt = DateTime.UtcNow; user.UpdatedAt = DateTime.UtcNow;
    await db.SaveChangesAsync(cancellationToken);
    context.Response.Cookies.Append(sessionCookie, rawToken, new CookieOptions { HttpOnly = true, SameSite = SameSiteMode.Strict, Secure = context.Request.IsHttps, MaxAge = sessionLifetime, Path = "/" });
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

app.MapGet("/api/imports/email/mailbox", async (AppDbContext db, CancellationToken cancellationToken) =>
{
    var state = await db.MailSyncStates.AsNoTracking().FirstOrDefaultAsync(cancellationToken);
    var batches = await db.ImportBatches.AsNoTracking()
        .Where(value => value.Kind == "Email" &&
            (value.Status == "PendingConfirmation" || (value.Status == "Confirmed" && value.FailedCount > 0)))
        .OrderByDescending(value => value.CreatedAt).Take(30)
        .Select(value => new { value.Id, value.FileName, value.MailReceivedDate, value.Status, value.TotalCount, value.ParsedCount,
            value.FailedCount, value.CreatedAt }).ToListAsync(cancellationToken);
    return Results.Ok(new { state?.Address, state?.LastSuccessAt, state?.LastError, batches });
});

app.MapGet("/api/mail/contacts", async (AppDbContext db, CancellationToken cancellationToken) =>
{
    var contacts = await db.MailContacts.AsNoTracking().OrderByDescending(contact => contact.MessageCount)
        .ThenBy(contact => contact.Email).ToListAsync(cancellationToken);
    return Results.Ok(contacts.Select(contact => new { contact.Id, contact.Email, contact.DisplayName,
        contact.ContactType, contact.DefaultCategory, contact.IsConfirmed, contact.MessageCount, contact.UpdatedAt }));
});

app.MapPatch("/api/mail/contacts/{contactId:long}", async (long contactId, JsonObject payload, AppDbContext db, CancellationToken cancellationToken) =>
{
    var contact = await db.MailContacts.FirstOrDefaultAsync(value => value.Id == contactId, cancellationToken);
    if (contact is null) return Results.NotFound(new { error = "联系人不存在" });
    var contactTypes = new[] { "Unknown", "Internal", "Customer", "Forwarder", "Trucker", "Other" };
    var contactType = payload["contactType"]?.ToString() ?? contact.ContactType;
    var displayName = payload["displayName"]?.ToString().Trim() ?? contact.DisplayName;
    var isConfirmed = payload["isConfirmed"]?.GetValue<bool>() ?? contact.IsConfirmed;
    if (!contactTypes.Contains(contactType)) return Results.BadRequest(new { error = "联系人类型无效" });
    if (displayName.Length > 100) return Results.BadRequest(new { error = "联系人名称不能超过100字" });
    contact.ContactType = MailContactRules.IsInternal(contact.Email) ? "Internal" : contactType;
    contact.DisplayName = displayName; contact.IsConfirmed = isConfirmed; contact.UpdatedAt = DateTime.UtcNow;
    if (MailContactRules.IsInternal(contact.Email)) contact.IsConfirmed = true;
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { contact.Id, contact.Email, contact.DisplayName, contact.ContactType,
        contact.DefaultCategory, contact.IsConfirmed, contact.MessageCount, contact.UpdatedAt });
});

app.MapPost("/api/mail/classify", async (AppDbContext db, CancellationToken cancellationToken) =>
{
    var items = await db.ImportEmailItems.Where(item => item.MailboxKey != "" && item.ClassificationSource != "Manual").ToListAsync(cancellationToken);
    foreach (var item in items)
    {
        var classification = MailClassificationRules.Classify(item.MailSubject);
        item.WorkCategory = classification.Category; item.ClassificationConfidence = classification.Confidence;
        item.ClassificationSource = classification.Source; item.NeedsClassificationReview = classification.NeedsReview;
    }
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { total = items.Count, automatic = items.Count(item => !item.NeedsClassificationReview),
        needsReview = items.Count(item => item.NeedsClassificationReview) });
});

app.MapGet("/api/mail/settings", async (HttpContext context, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (((AppUser)context.Items["CurrentUser"]!).Role != "admin") return Results.Json(new { error = "只有管理员可以查看邮箱设置" }, statusCode: 403);
    var setting = await db.MailSystemSettings.AsNoTracking().FirstAsync(value => value.Id == 1, cancellationToken);
    var state = await db.MailSyncStates.AsNoTracking().FirstOrDefaultAsync(cancellationToken);
    var mailCount = await db.ImportEmailItems.AsNoTracking().CountAsync(item => item.MailboxKey != "", cancellationToken);
    var failedCount = await db.ImportEmailItems.AsNoTracking().CountAsync(item => item.MailboxKey != "" && item.Error != "", cancellationToken);
    return Results.Ok(new { setting.SyncEnabled, setting.SyncIntervalMinutes, setting.RetentionDays, setting.UpdatedAt,
        address = state?.Address ?? "", state?.LastSuccessAt, lastError = state?.LastError ?? "", mailCount, failedCount });
});

app.MapPatch("/api/mail/settings", async (JsonObject payload, HttpContext context, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (((AppUser)context.Items["CurrentUser"]!).Role != "admin") return Results.Json(new { error = "只有管理员可以修改邮箱设置" }, statusCode: 403);
    var setting = await db.MailSystemSettings.FirstAsync(value => value.Id == 1, cancellationToken);
    var enabled = payload["syncEnabled"]?.GetValue<bool>() ?? setting.SyncEnabled;
    var interval = payload["syncIntervalMinutes"]?.GetValue<int>() ?? setting.SyncIntervalMinutes;
    var retention = payload["retentionDays"]?.GetValue<int>() ?? setting.RetentionDays;
    if (interval is < 1 or > 1440) return Results.BadRequest(new { error = "同步间隔需为1至1440分钟" });
    if (retention is < 30 or > 730) return Results.BadRequest(new { error = "在线保存期限需为30至730天" });
    setting.SyncEnabled = enabled; setting.SyncIntervalMinutes = interval; setting.RetentionDays = retention; setting.UpdatedAt = DateTime.UtcNow;
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { setting.SyncEnabled, setting.SyncIntervalMinutes, setting.RetentionDays, setting.UpdatedAt });
});

app.MapGet("/api/mail/candidates", async (AppDbContext db, CancellationToken cancellationToken) =>
{
    var items = await db.ImportEmailItems.AsNoTracking()
        .Where(item => item.MailboxKey != "" && item.Status != "failed" &&
            (item.WorkCategory == "Shipment" || item.WorkCategory == "Change"))
        .OrderByDescending(item => item.MailReceivedAt).ThenByDescending(item => item.Id).ToListAsync(cancellationToken);
    var sourceIds = items.Select(item => item.Id).ToHashSet();
    var tasks = await db.ShipmentTasks.AsNoTracking().Where(task => task.SourceImportItemId != null && sourceIds.Contains(task.SourceImportItemId.Value))
        .Select(task => new { task.Id, task.SourceImportItemId }).ToListAsync(cancellationToken);
    var taskIdsBySource = tasks.GroupBy(task => task.SourceImportItemId!.Value).ToDictionary(group => group.Key, group => group.Select(task => task.Id).ToArray());
    var parsedItems = items.Select(item =>
    {
        var parsed = JsonNode.Parse(item.ResultJson)?.AsObject() ?? new JsonObject();
        var soNumbers = parsed["so_numbers"]?.AsArray()?.Select(value => value?.ToString()).Where(value => !string.IsNullOrWhiteSpace(value)).ToArray() ?? [];
        return (Item: item, Parsed: parsed, SoNumbers: soNumbers!);
    }).ToList();
    var candidates = parsedItems.Select(current =>
    {
        var item = current.Item; var parsed = current.Parsed; var soNumbers = current.SoNumbers;
        var fields = parsed["fields"]?.AsObject() ?? new JsonObject();
        var itemCount = parsed["items"]?.AsArray()?.Count ?? 0;
        var warehouseCount = parsed["warehouse_groups"]?.AsArray()?.Count ?? 0;
        var cargoItems = parsed["items"]?.DeepClone() ?? new JsonArray();
        var warehouseGroups = parsed["warehouse_groups"]?.DeepClone() ?? new JsonArray();
        var related = parsedItems.Where(other => other.Item.Id != item.Id && soNumbers.Intersect(other.SoNumbers, StringComparer.OrdinalIgnoreCase).Any()).ToList();
        var previous = related.Where(other => string.Compare(other.Item.MailReceivedAt, item.MailReceivedAt, StringComparison.Ordinal) < 0)
            .OrderByDescending(other => other.Item.MailReceivedAt).ThenByDescending(other => other.Item.Id).FirstOrDefault();
        var changes = previous.Item is null ? new List<object>() : CandidateFieldChanges(previous.Parsed, parsed);
        taskIdsBySource.TryGetValue(item.Id, out var taskIds);
        return new { item.Id, item.MailSubject, item.MailSender, item.MailReceivedAt, item.WorkCategory,
            item.HandlingStatus, item.Status, soNumbers, itemCount, warehouseCount, fields,
            items = cargoItems, warehouseGroups,
            relatedEmailCount = related.Count + 1, relatedEmailIds = related.Select(other => other.Item.Id).Append(item.Id).Order().ToArray(), changes,
            canConfirm = soNumbers.Length > 0 || itemCount > 0, taskIds = taskIds ?? [] };
    });
    return Results.Ok(candidates);
});

app.MapPatch("/api/mail/candidates/{itemId:long}", async (long itemId, JsonObject payload, AppDbContext db, CancellationToken cancellationToken) =>
{
    var entity = await db.ImportEmailItems.FirstOrDefaultAsync(item => item.Id == itemId && item.MailboxKey != "", cancellationToken);
    if (entity is null) return Results.NotFound(new { error = "候选邮件不存在" });
    if (entity.HandlingStatus != "Pending") return Results.Conflict(new { error = "只有待确认候选项可以修改" });
    if (payload["fields"] is not JsonObject fields || payload["items"] is not JsonArray cargoItems || payload["warehouseGroups"] is not JsonArray warehouseGroups)
        return Results.BadRequest(new { error = "候选资料格式无效" });
    if (cargoItems.Count > 5000 || warehouseGroups.Count > 200) return Results.BadRequest(new { error = "候选资料数量超出范围" });
    var stored = JsonNode.Parse(entity.ResultJson)?.AsObject() ?? new JsonObject();
    stored["fields"] = fields.DeepClone(); stored["items"] = cargoItems.DeepClone(); stored["warehouse_groups"] = warehouseGroups.DeepClone();
    var soNumber = fields["so_number"]?.ToString().Trim() ?? "";
    if (soNumber != "") stored["so_numbers"] = new JsonArray(soNumber.Split(',', '，').Select(value => value.Trim()).Where(value => value != "").Select(value => (JsonNode?)JsonValue.Create(value)).ToArray());
    entity.ResultJson = stored.ToJsonString(); entity.ReviewedAt = DateTime.UtcNow;
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { entity.Id, savedAt = entity.ReviewedAt });
});

app.MapPost("/api/mail/candidates/{itemId:long}/{action}", async (long itemId, string action, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (action is not ("confirm" or "ignore")) return Results.BadRequest(new { error = "候选任务操作无效" });
    var entity = await db.ImportEmailItems.Include(item => item.ImportBatch)
        .FirstOrDefaultAsync(item => item.Id == itemId && item.MailboxKey != "", cancellationToken);
    if (entity is null) return Results.NotFound(new { error = "候选邮件不存在" });
    if (entity.WorkCategory is not ("Shipment" or "Change")) return Results.BadRequest(new { error = "该邮件不是走柜候选资料" });
    if (action == "ignore")
    {
        entity.HandlingStatus = "Ignored"; entity.ReviewedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { entity.Id, entity.HandlingStatus, taskIds = Array.Empty<long>() });
    }
    try { var taskIds = await ConfirmMailboxCandidate(entity, db, cancellationToken); return Results.Ok(new { entity.Id, entity.HandlingStatus, taskIds }); }
    catch (InvalidOperationException error) { return Results.BadRequest(new { error = error.Message }); }
});

app.MapPost("/api/mail/candidates/batch/{action}", async (string action, JsonObject payload, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (action is not ("confirm" or "ignore")) return Results.BadRequest(new { error = "批量操作无效" });
    var ids = payload["ids"]?.AsArray()?.Select(value => value?.GetValue<long>() ?? 0).Where(value => value > 0).Distinct().ToArray() ?? [];
    if (ids.Length is < 1 or > 100) return Results.BadRequest(new { error = "请选择1至100个候选项" });
    var entities = await db.ImportEmailItems.Where(item => ids.Contains(item.Id) && item.MailboxKey != "" && item.HandlingStatus == "Pending" &&
        (item.WorkCategory == "Shipment" || item.WorkCategory == "Change")).ToListAsync(cancellationToken);
    if (entities.Count != ids.Length) return Results.BadRequest(new { error = "部分候选项不存在或已处理，请刷新后重试" });
    var taskIds = new List<long>();
    await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
    try
    {
        foreach (var entity in entities)
        {
            if (action == "ignore") { entity.HandlingStatus = "Ignored"; entity.ReviewedAt = DateTime.UtcNow; }
            else taskIds.AddRange(await ConfirmMailboxCandidate(entity, db, cancellationToken));
        }
        await db.SaveChangesAsync(cancellationToken); await transaction.CommitAsync(cancellationToken);
        return Results.Ok(new { processed = entities.Count, taskIds = taskIds.Distinct().ToArray() });
    }
    catch (InvalidOperationException error) { await transaction.RollbackAsync(cancellationToken); return Results.BadRequest(new { error = error.Message }); }
});

app.MapGet("/api/imports/email/mailbox/items", async (string? date, string? q, string? category, string? handling, int? page,
    AppDbContext db, CancellationToken cancellationToken) =>
{
    const int pageSize = 50;
    var pageNumber = Math.Max(1, page ?? 1);
    if (pageNumber > 10000) return Results.BadRequest(new { error = "页码超出范围" });
    if (!string.IsNullOrWhiteSpace(date) &&
        !DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
        return Results.BadRequest(new { error = "日期格式应为 yyyy-MM-dd" });
    var query = db.ImportEmailItems.AsNoTracking().Where(item => item.MailboxKey != "");
    if (!string.IsNullOrWhiteSpace(date)) query = query.Where(item => item.MailReceivedDate == date);
    if (!string.IsNullOrWhiteSpace(category)) query = query.Where(item => item.WorkCategory == category);
    if (!string.IsNullOrWhiteSpace(handling)) query = query.Where(item => item.HandlingStatus == handling);
    var keyword = q?.Trim() ?? "";
    if (keyword.Length > 100) return Results.BadRequest(new { error = "搜索内容过长" });
    if (keyword != "")
    {
        var normalized = keyword.ToLowerInvariant();
        var number = long.TryParse(keyword.TrimStart('#'), out var id) ? id : 0;
        query = query.Where(item => item.Id == number ||
            item.MailSubject.ToLower().Contains(normalized) || item.MailSender.ToLower().Contains(normalized));
    }
    var total = await query.CountAsync(cancellationToken);
    var items = await query.OrderByDescending(item => item.MailReceivedAt).ThenByDescending(item => item.Id)
        .Skip((pageNumber - 1) * pageSize).Take(pageSize)
        .Select(item => new { item.Id, item.ImportBatchId, item.MailSubject, item.MailSender,
            item.MailReceivedAt, item.MailReceivedDate, item.Status, item.Error,
            item.WorkCategory, item.ClassificationSource, item.ClassificationConfidence, item.NeedsClassificationReview,
            item.HandlingStatus, item.ReviewedAt })
        .ToListAsync(cancellationToken);
    return Results.Ok(new { total, page = pageNumber, pageSize, items });
});

app.MapGet("/api/imports/email/mailbox/items/{itemId:long}", async (long itemId, AppDbContext db, CancellationToken cancellationToken) =>
{
    var item = await db.ImportEmailItems.AsNoTracking().FirstOrDefaultAsync(value => value.Id == itemId && value.MailboxKey != "", cancellationToken);
    if (item is null) return Results.NotFound(new { error = "邮件记录不存在" });
    JsonNode? parsed = null;
    try { parsed = JsonNode.Parse(item.ResultJson); } catch (JsonException) { }
    return Results.Ok(new { item.Id, item.ImportBatchId, item.MailSubject, item.MailSender,
        item.MailReceivedAt, item.MailReceivedDate, item.Status, item.Error, item.WorkCategory,
        item.ClassificationSource, item.ClassificationConfidence, item.NeedsClassificationReview,
        item.HandlingStatus, item.WorkNote, item.ReviewedAt, parsed });
});

app.MapPatch("/api/imports/email/mailbox/items/{itemId:long}", async (long itemId, JsonObject payload, AppDbContext db, CancellationToken cancellationToken) =>
{
    var item = await db.ImportEmailItems.FirstOrDefaultAsync(value => value.Id == itemId && value.MailboxKey != "", cancellationToken);
    if (item is null) return Results.NotFound(new { error = "邮件记录不存在" });
    var categories = new[] { "Unclassified", "Shipment", "Change", "FollowUp", "Other" };
    var handlingStatuses = new[] { "Pending", "Processed", "Ignored" };
    var category = payload["workCategory"]?.ToString() ?? item.WorkCategory;
    var handling = payload["handlingStatus"]?.ToString() ?? item.HandlingStatus;
    var note = payload["workNote"]?.ToString().Trim() ?? item.WorkNote;
    if (!categories.Contains(category)) return Results.BadRequest(new { error = "邮件分类无效" });
    if (!handlingStatuses.Contains(handling)) return Results.BadRequest(new { error = "处理状态无效" });
    if (note.Length > 500) return Results.BadRequest(new { error = "处理备注不能超过500字" });
    item.WorkCategory = category;
    item.ClassificationSource = "Manual";
    item.ClassificationConfidence = 100;
    item.NeedsClassificationReview = false;
    item.HandlingStatus = handling;
    item.WorkNote = note;
    item.ReviewedAt = DateTime.UtcNow;
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { item.Id, item.WorkCategory, item.HandlingStatus, item.WorkNote, item.ReviewedAt });
});

app.MapPost("/api/imports/email/mailbox/sync", async (MailboxSyncService sync, CancellationToken cancellationToken) =>
{
    try { return Results.Ok(await sync.SyncAsync(cancellationToken)); }
    catch (Exception error) when (error is not OperationCanceledException)
    { return Results.Json(new { error = error.Message }, statusCode: 502); }
});

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
        foreach (var (groupKey, taskPayload) in ShipmentTaskPayloads(stored))
        {
            var incomingSo = ShipmentSoNumber(taskPayload);
            var existingTask = await db.ShipmentTasks.FirstOrDefaultAsync(task =>
                (task.SourceImportItemId == sourceItemId && task.SourceGroupKey == groupKey) ||
                (string.IsNullOrEmpty(groupKey) && !string.IsNullOrEmpty(incomingSo) && task.SoNumber == incomingSo), cancellationToken);
            var shipmentTask = existingTask ?? new ShipmentTask { SourceImportItemId = sourceItemId, SourceGroupKey = groupKey };
            var previousPayload = existingTask is null ? null : await PreviousShipmentPayload(db, existingTask, groupKey, cancellationToken);
            ApplyReviewedEmailToTask(shipmentTask, taskPayload, existingTask is null, previousPayload);
            if (existingTask is null) db.ShipmentTasks.Add(shipmentTask);
            affectedTasks.Add(shipmentTask);
        }
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
        foreach (var (groupKey, taskPayload) in ShipmentTaskPayloads(stored))
        {
            var incomingSo = ShipmentSoNumber(taskPayload);
            var existingTask = await db.ShipmentTasks.FirstOrDefaultAsync(task =>
                (task.SourceImportItemId == sourceItemId && task.SourceGroupKey == groupKey) ||
                (string.IsNullOrEmpty(groupKey) && !string.IsNullOrEmpty(incomingSo) && task.SoNumber == incomingSo), cancellationToken);
            var shipmentTask = existingTask ?? new ShipmentTask { SourceImportItemId = sourceItemId, SourceGroupKey = groupKey };
            var previousPayload = existingTask is null ? null : await PreviousShipmentPayload(db, existingTask, groupKey, cancellationToken);
            ApplyReviewedEmailToTask(shipmentTask, taskPayload, existingTask is null, previousPayload);
            if (existingTask is null) db.ShipmentTasks.Add(shipmentTask);
            affectedTasks.Add(shipmentTask);
        }
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
        batch.Id, batch.Kind, batch.FileName, batch.MailReceivedDate, batch.Status, batch.TotalCount,
        batch.ParsedCount, batch.FailedCount, batch.ParserVersion, batch.CreatedAt,
        Items = batch.EmailItems.Select(item => new
        {
            item.Id, item.FileName, item.Fingerprint, item.Status,
            item.DuplicateOfItemId, item.ResultJson, item.Error, item.CreatedAt,
        })
    });
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

app.MapPost("/api/product-infos/workbooks/preview", async (HttpRequest request, EmailParserClient parser, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!request.HasFormContentType) return Results.BadRequest(new { error = "请选择走柜表 Excel 文件" });
    var form = await request.ReadFormAsync(cancellationToken);
    var files = form.Files.GetFiles("files");
    if (files.Count == 0 || files.Count > 20) return Results.BadRequest(new { error = "请选择 1 至 20 份走柜表" });
    if (files.Any(file => file.Length == 0 || file.Length > 20 * 1024 * 1024 ||
        !file.FileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)))
        return Results.BadRequest(new { error = "仅支持不超过 20MB 的 xlsx 走柜表" });
    var response = await parser.ParseProductWorkbooksAsync(files, cancellationToken);
    if (response.StatusCode is < 200 or >= 300)
        return Results.Content(response.Body, response.ContentType, statusCode: response.StatusCode);
    var parsed = JsonSerializer.Deserialize<ProductWorkbookCommitRequest>(response.Body,
        new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
    var rows = parsed?.Rows ?? [];
    var existing = await db.ProductInfos.AsNoTracking().ToListAsync(cancellationToken);
    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    var batchCustomers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    foreach (var row in rows)
    {
        var key = $"{row.ProductCode.Trim()}\0{row.QuantityPerBox}";
        if (!seen.Add(key)) row.Warnings.Add("本批次相同货号及规格重复");
        if (!string.IsNullOrWhiteSpace(row.ProductCode) && !string.IsNullOrWhiteSpace(row.Customer))
        {
            var code = row.ProductCode.Trim();
            if (batchCustomers.TryGetValue(code, out var batchCustomer) && !batchCustomer.Equals(row.Customer.Trim(), StringComparison.OrdinalIgnoreCase))
                row.Warnings.Add($"本批次同一货号出现不同客户：{batchCustomer}");
            else batchCustomers[code] = row.Customer.Trim();
        }
        var match = existing.FirstOrDefault(value => value.ProductCode.Equals(row.ProductCode.Trim(), StringComparison.OrdinalIgnoreCase)
            && value.QuantityPerBox == row.QuantityPerBox);
        row.ExistingId = match?.Id;
        row.ExistingProduct = match;
        var otherCustomer = existing.FirstOrDefault(value => value.ProductCode.Equals(row.ProductCode.Trim(), StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrWhiteSpace(value.Customer) && !string.IsNullOrWhiteSpace(row.Customer)
            && !value.Customer.Equals(row.Customer.Trim(), StringComparison.OrdinalIgnoreCase));
        if (otherCustomer is not null) row.Warnings.Add($"客户与库中记录不一致：{otherCustomer.Customer}");
    }
    return Results.Ok(new { rows });
}).DisableAntiforgery();

app.MapPost("/api/product-infos/workbooks/commit", async (ProductWorkbookCommitRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (request.Rows.Count == 0 || request.Rows.Count > 5000)
        return Results.BadRequest(new { error = "请选择 1 至 5000 条产品资料" });
    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    var batchCustomers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    foreach (var row in request.Rows)
    {
        var candidate = new ProductInfo { ProductCode = row.ProductCode, QuantityPerBox = row.QuantityPerBox,
            GrossWeightPerBox = row.GrossWeightPerBox, NetWeightPerBox = row.NetWeightPerBox };
        var error = ValidateProductInfo(candidate);
        if (error is not null) return Results.BadRequest(new { error = $"{row.Filename} 第 {row.RowNumber} 行：{error}" });
        var key = $"{row.ProductCode.Trim()}\0{row.QuantityPerBox}";
        if (!seen.Add(key)) return Results.BadRequest(new { error = "提交的产品中有重复货号和装箱规格" });
        if (!string.IsNullOrWhiteSpace(row.Customer))
        {
            var code = row.ProductCode.Trim();
            if (batchCustomers.TryGetValue(code, out var batchCustomer) && !batchCustomer.Equals(row.Customer.Trim(), StringComparison.OrdinalIgnoreCase))
                return Results.BadRequest(new { error = $"货号 {code} 在本批次中属于不同客户" });
            batchCustomers[code] = row.Customer.Trim();
        }
    }
    var added = 0; var updated = 0; var skipped = 0;
    await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
    foreach (var row in request.Rows)
    {
        var code = row.ProductCode.Trim();
        var normalized = code.ToUpper();
        var existing = await db.ProductInfos.FirstOrDefaultAsync(value => value.ProductCode.ToUpper() == normalized
            && value.QuantityPerBox == row.QuantityPerBox, cancellationToken);
        if (row.UpdateExisting && row.ExistingId != existing?.Id)
            return Results.Conflict(new { error = $"货号 {code} 的库中记录已变化，请重新预览后确认" });
        if (existing is not null && !row.UpdateExisting) { skipped++; continue; }
        if (!string.IsNullOrWhiteSpace(row.Customer) && await db.ProductInfos.AnyAsync(value => value.ProductCode.ToUpper() == normalized
            && value.Customer != "" && value.Customer.ToUpper() != row.Customer.Trim().ToUpper(), cancellationToken))
            return Results.Conflict(new { error = $"货号 {code} 的客户与产品库不一致，请先人工核对" });
        var product = existing ?? new ProductInfo { ProductCode = code, LegacyId = 0 };
        if (existing is null || !string.IsNullOrWhiteSpace(row.Customer)) product.Customer = row.Customer.Trim();
        if (existing is null || !string.IsNullOrWhiteSpace(row.ProductName)) product.ProductName = row.ProductName.Trim();
        product.QuantityPerBox = row.QuantityPerBox;
        if (existing is null || !string.IsNullOrWhiteSpace(row.ToyCategory)) product.ToyCategory = row.ToyCategory.Trim();
        if (existing is null || row.GrossWeightPerBox.HasValue) product.GrossWeightPerBox = row.GrossWeightPerBox;
        if (existing is null || row.NetWeightPerBox.HasValue) product.NetWeightPerBox = row.NetWeightPerBox;
        product.Source = $"走柜表:{Path.GetFileName(row.Filename)}"; product.UpdatedAt = DateTime.UtcNow;
        if (existing is null) { db.ProductInfos.Add(product); added++; } else updated++;
    }
    await db.SaveChangesAsync(cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return Results.Ok(new { added, updated, skipped });
});

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
    if (currentUser.Role == "warehouse" && task.Status is not ("PendingShipment" or "Completed"))
        return Results.Json(new { error = "任务尚未移交仓务" }, statusCode: StatusCodes.Status403Forbidden);
    var relatedTasks = await db.ShipmentTasks.AsNoTracking()
        .Where(value => value.Customer == task.Customer).ToListAsync(cancellationToken);
    var response = JsonNode.Parse(JsonSerializer.Serialize(
        ToShipmentResponse(task), new JsonSerializerOptions(JsonSerializerDefaults.Web)))!.AsObject();
    ShipmentOrderTotals.Apply(response, relatedTasks);
    var sourceEmails = new List<object>();
    var imports = await db.ImportEmailItems.AsNoTracking().Where(item => item.MailboxKey != "").OrderBy(item => item.MailReceivedAt).ToListAsync(cancellationToken);
    foreach (var import in imports)
    {
        var parsed = JsonNode.Parse(import.ResultJson)?.AsObject();
        var soNumbers = parsed?["so_numbers"]?.AsArray()?.Select(value => value?.ToString() ?? "").ToArray() ?? [];
        var fieldSo = parsed?["fields"]?["so_number"]?.ToString() ?? "";
        var isDirectSource = task.SourceImportItemId == import.Id;
        var sameSo = !string.IsNullOrWhiteSpace(task.SoNumber) && (soNumbers.Any(value => value.Equals(task.SoNumber, StringComparison.OrdinalIgnoreCase)) || fieldSo.Equals(task.SoNumber, StringComparison.OrdinalIgnoreCase));
        if (!isDirectSource && !sameSo) continue;
        sourceEmails.Add(new { import.Id, import.MailSubject, import.MailSender, import.MailReceivedAt,
            import.WorkCategory, relation = isDirectSource ? "创建来源" : "变更或补充" });
    }
    response["sourceEmails"] = JsonSerializer.SerializeToNode(sourceEmails, new JsonSerializerOptions(JsonSerializerDefaults.Web));
    return Results.Ok(response);
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

static List<object> CandidateFieldChanges(JsonObject previous, JsonObject current)
{
    var labels = new Dictionary<string, string>
    {
        ["so_number"]="SO号", ["container_type"]="柜型", ["ship_date"]="计划走货日期",
        ["cutoff_date"]="截数期", ["si_deadline"]="SI截止", ["port"]="装货港", ["destination_country"]="收货国家",
    };
    var before = previous["fields"]?.AsObject() ?? new JsonObject();
    var after = current["fields"]?.AsObject() ?? new JsonObject();
    var result = labels.Select(pair => new { field=pair.Key, label=pair.Value,
        previous=before[pair.Key]?.ToString() ?? "", current=after[pair.Key]?.ToString() ?? "" })
        .Where(value => value.previous != value.current && (value.previous != "" || value.current != ""))
        .Cast<object>().ToList();
    var previousItems = previous["items"]?.AsArray()?.Count ?? 0; var currentItems = current["items"]?.AsArray()?.Count ?? 0;
    if (previousItems != currentItems) result.Add(new { field="item_count", label="货物明细", previous=$"{previousItems}条", current=$"{currentItems}条" });
    var previousWarehouses = previous["warehouse_groups"]?.AsArray()?.Count ?? 0; var currentWarehouses = current["warehouse_groups"]?.AsArray()?.Count ?? 0;
    if (previousWarehouses != currentWarehouses) result.Add(new { field="warehouse_count", label="仓库分组", previous=$"{previousWarehouses}个", current=$"{currentWarehouses}个" });
    return result;
}

static async Task<long[]> ConfirmMailboxCandidate(ImportEmailItem entity, AppDbContext db, CancellationToken cancellationToken)
{
    var stored = JsonNode.Parse(entity.ResultJson)?.AsObject() ?? new JsonObject();
    if ((stored["so_numbers"]?.AsArray()?.Count ?? 0) == 0 && (stored["items"]?.AsArray()?.Count ?? 0) == 0)
        throw new InvalidOperationException($"邮件 #{entity.Id} 没有识别出SO号或货物明细");
    await EnrichEmailProducts(stored, db, true, cancellationToken);
    stored["reviewed_at"] = DateTime.UtcNow; entity.ResultJson = stored.ToJsonString();
    var isDuplicate = entity.Status is "duplicate" or "duplicate_confirmed";
    entity.Status = isDuplicate ? "duplicate_confirmed" : "confirmed"; entity.HandlingStatus = "Processed"; entity.ReviewedAt = DateTime.UtcNow;
    var sourceItemId = isDuplicate ? entity.DuplicateOfItemId ?? entity.Id : entity.Id;
    var affected = new List<ShipmentTask>();
    foreach (var (groupKey, taskPayload) in ShipmentTaskPayloads(stored))
    {
        var incomingSo = ShipmentSoNumber(taskPayload);
        var existing = await db.ShipmentTasks.FirstOrDefaultAsync(task =>
            (task.SourceImportItemId == sourceItemId && task.SourceGroupKey == groupKey) ||
            (string.IsNullOrEmpty(groupKey) && !string.IsNullOrEmpty(incomingSo) && task.SoNumber == incomingSo), cancellationToken);
        var task = existing ?? new ShipmentTask { SourceImportItemId = sourceItemId, SourceGroupKey = groupKey };
        var previous = existing is null ? null : await PreviousShipmentPayload(db, existing, groupKey, cancellationToken);
        ApplyReviewedEmailToTask(task, taskPayload, existing is null, previous);
        if (existing is null) db.ShipmentTasks.Add(task); affected.Add(task);
    }
    await db.SaveChangesAsync(cancellationToken);
    return affected.Select(task => task.Id).Distinct().ToArray();
}

static async Task<JsonObject?> PreviousShipmentPayload(AppDbContext db, ShipmentTask task, string groupKey, CancellationToken cancellationToken)
{
    if (task.SourceImportItemId is not long sourceId) return null;
    var previousJson = await db.ImportEmailItems.AsNoTracking()
        .Where(item => item.Id == sourceId).Select(item => item.ResultJson)
        .FirstOrDefaultAsync(cancellationToken);
    var previous = string.IsNullOrWhiteSpace(previousJson) ? null : JsonNode.Parse(previousJson)?.AsObject();
    return previous is null ? null : ShipmentTaskPayloads(previous)
        .FirstOrDefault(value => value.GroupKey == groupKey).Payload;
}

static void ApplyReviewedEmailToTask(ShipmentTask task, JsonObject stored, bool initializeStatus = true, JsonObject? previousImport = null)
{
    if (!initializeStatus)
    {
        // Re-imports add newly parsed cargo without replacing corrections made on the task.
        task.ItemsJson = ShipmentImportMerge.AppendNewItems(
            JsonNode.Parse(task.ItemsJson)?.AsArray() ?? new JsonArray(),
            stored["items"]?.AsArray() ?? new JsonArray(),
            previousImport?["items"]?.AsArray()).ToJsonString();
        task.WarehouseGroupsJson = ShipmentImportMerge.AppendNewGroups(
            JsonNode.Parse(task.WarehouseGroupsJson)?.AsArray() ?? new JsonArray(),
            stored["warehouse_groups"]?.AsArray() ?? new JsonArray(),
            previousImport?["warehouse_groups"]?.AsArray()).ToJsonString();
        task.UpdatedAt = DateTime.UtcNow;
        return;
    }
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

static List<(string GroupKey, JsonObject Payload)> ShipmentTaskPayloads(JsonObject stored)
{
    var groups = stored["shipment_groups"]?.AsArray();
    if (groups is null || groups.Count == 0) return [(string.Empty, stored)];
    var result = new List<(string, JsonObject)>();
    foreach (var node in groups)
    {
        if (node is not JsonObject group) continue;
        var groupKey = group["group_key"]?.ToString() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(groupKey)) continue;
        var payload = JsonNode.Parse(stored.ToJsonString())!.AsObject();
        var fields = payload["fields"]?.AsObject() ?? new JsonObject();
        fields["container_type"] = group["container_type"]?.DeepClone();
        payload["fields"] = fields;
        var reviewedItems = payload["items"]?.AsArray() ?? new JsonArray();
        payload["items"] = new JsonArray(reviewedItems
            .Where(item => item?["container_assignment"]?.ToString() == groupKey)
            .Select(item => item!.DeepClone()).ToArray());
        var matchingWarehouse = payload["warehouse_groups"]?.AsArray()
            .FirstOrDefault(value => value?["references"]?.AsArray().Any(reference => reference?.ToString() == groupKey) == true);
        payload["warehouse_groups"] = matchingWarehouse is null
            ? new JsonArray()
            : new JsonArray(matchingWarehouse.DeepClone());
        if (payload["message"] is JsonObject message)
        {
            var subject = message["subject"]?.ToString() ?? string.Empty;
            var factory = group["loading_factory"]?.ToString() ?? string.Empty;
            message["subject"] = $"{subject} · {groupKey}{(string.IsNullOrWhiteSpace(factory) ? "" : $" · {factory}做柜")}";
        }
        result.Add((groupKey, payload));
    }
    return result.Count == 0 ? [(string.Empty, stored)] : result;
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
        ["SourceGroupKey"] = "TEXT NOT NULL DEFAULT ''",
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
    db.Database.ExecuteSqlRaw("DROP INDEX IF EXISTS IX_ShipmentTasks_SourceImportItemId");
    db.Database.ExecuteSqlRaw("CREATE UNIQUE INDEX IF NOT EXISTS IX_ShipmentTasks_SourceImportItemId_SourceGroupKey ON ShipmentTasks (SourceImportItemId, SourceGroupKey) WHERE SourceImportItemId IS NOT NULL");
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
        foreach (var (groupKey, taskPayload) in ShipmentTaskPayloads(stored))
        {
            var incomingSo = ShipmentSoNumber(taskPayload);
            var exists = db.ShipmentTasks.Any(task =>
                (task.SourceImportItemId == sourceItemId && task.SourceGroupKey == groupKey) ||
                (string.IsNullOrEmpty(groupKey) && !string.IsNullOrEmpty(incomingSo) && task.SoNumber == incomingSo));
            if (exists) continue;
            var task = new ShipmentTask { SourceImportItemId = sourceItemId, SourceGroupKey = groupKey };
            ApplyReviewedEmailToTask(task, taskPayload);
            db.ShipmentTasks.Add(task);
        }
    }
    db.SaveChanges();
}
