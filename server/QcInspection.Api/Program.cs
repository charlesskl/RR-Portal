using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using QcInspection.Api.Data;
using QcInspection.Api.Entities;
using QcInspection.Api.Services;

var builder = WebApplication.CreateBuilder(args);
var jwtKey = builder.Configuration["QC_JWT_KEY"] ?? Environment.GetEnvironmentVariable("QC_JWT_KEY");
if (string.IsNullOrWhiteSpace(jwtKey) || jwtKey.Length < 32)
    throw new InvalidOperationException("请通过 QC_JWT_KEY 配置至少32位的登录签名密钥。");

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=qc-inspection.db"));
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
{
    options.MapInboundClaims = false;
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = "QcInspection.Api",
        ValidAudience = "QcInspection.Web",
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
        ClockSkew = TimeSpan.FromMinutes(1),
    };
    options.Events = new JwtBearerEvents
    {
        OnTokenValidated = async context =>
        {
            var id = context.Principal?.FindFirstValue(JwtRegisteredClaimNames.Sub);
            if (!long.TryParse(id, out var userId)) { context.Fail("账号无效"); return; }
            var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(value => value.Id == userId);
            if (user is null || !user.IsActive || user.Role != context.Principal?.FindFirstValue(ClaimTypes.Role) ||
                user.DataScope != context.Principal?.FindFirstValue("scope")) context.Fail("账号权限已变更，请重新登录");
        },
    };
});
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AdminOnly", policy => policy.RequireRole("管理员", "Admin"));
    options.AddPolicy("QcWrite", policy => policy.RequireRole("管理员", "Admin", "QC主管", "QC文员"));
    options.AddPolicy("QcRead", policy => policy.RequireRole("管理员", "Admin", "QC主管", "QC文员"));
    options.AddPolicy("ScheduleWrite", policy => policy.RequireRole("管理员", "Admin", "排期员"));
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
var webOrigins = (builder.Configuration["QC_WEB_ORIGINS"] ?? "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3100,http://127.0.0.1:3100")
    .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins(webOrigins).AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
    db.Database.ExecuteSqlRaw("CREATE TABLE IF NOT EXISTS WorkshopMappings (Id INTEGER NOT NULL CONSTRAINT PK_WorkshopMappings PRIMARY KEY AUTOINCREMENT, Workshop TEXT NOT NULL, Supervisor TEXT NOT NULL)");
    db.Database.ExecuteSqlRaw("CREATE UNIQUE INDEX IF NOT EXISTS IX_WorkshopMappings_Workshop ON WorkshopMappings (Workshop)");
    db.Database.ExecuteSqlRaw("CREATE TABLE IF NOT EXISTS SchemaChanges (Name TEXT NOT NULL PRIMARY KEY)");
    var mappingsRestored = db.Database.SqlQueryRaw<int>("SELECT COUNT(*) AS Value FROM SchemaChanges WHERE Name = 'restore-workshop-mappings'").Single() > 0;
    if (!mappingsRestored && !db.WorkshopMappings.Any())
    {
        // Preserve the defaults that were available before the mapping page became editable.
        db.WorkshopMappings.AddRange(
            new WorkshopMapping { Workshop = "A车间", Supervisor = "张安源" },
            new WorkshopMapping { Workshop = "B车间", Supervisor = "谭都" },
            new WorkshopMapping { Workshop = "华登车间", Supervisor = "余小兵" },
            new WorkshopMapping { Workshop = "新邵车间", Supervisor = "肖晔" },
            new WorkshopMapping { Workshop = "湖南车间", Supervisor = "关芬乐" });
        db.SaveChanges();
    }
    if (!mappingsRestored) db.Database.ExecuteSqlRaw("INSERT INTO SchemaChanges (Name) VALUES ('restore-workshop-mappings')");
    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS InspectionRecords (
            Id INTEGER NOT NULL CONSTRAINT PK_InspectionRecords PRIMARY KEY AUTOINCREMENT,
            Site TEXT NOT NULL, InspectionDate TEXT NULL, InspectionLocation TEXT NOT NULL,
            InspectionParty TEXT NOT NULL, ThirdPartyOrganization TEXT NOT NULL, Customer TEXT NOT NULL,
            ContractNumber TEXT NOT NULL, CustomerPo TEXT NOT NULL, ItemNumber TEXT NOT NULL,
            ProductName TEXT NOT NULL, Quantity TEXT NULL, Cartons TEXT NULL, InternalResult TEXT NOT NULL,
            ThirdPartyResult TEXT NOT NULL, HoldRejectReason TEXT NOT NULL, ProductionWorkshop TEXT NOT NULL,
            ProductionSupervisor TEXT NOT NULL, ResponsibleLineLeader TEXT NOT NULL DEFAULT '',
            ProblemSource TEXT NOT NULL DEFAULT '', HandlingResult TEXT NOT NULL DEFAULT '', TestScrap TEXT NOT NULL DEFAULT '',
            PackagingSpec TEXT NOT NULL DEFAULT '', PackingQuantity TEXT NULL, ThirdPartyInspectionLocation TEXT NOT NULL DEFAULT '',
            Note TEXT NOT NULL, WorkflowStatus TEXT NOT NULL DEFAULT '待验货', SourceFile TEXT NOT NULL,
            SourceSheet TEXT NOT NULL, SourceRow INTEGER NOT NULL, Fingerprint TEXT NOT NULL, ImportedAt TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS IX_InspectionRecords_Fingerprint ON InspectionRecords (Fingerprint);
        CREATE INDEX IF NOT EXISTS IX_InspectionRecords_Site_InspectionDate ON InspectionRecords (Site, InspectionDate);
        CREATE INDEX IF NOT EXISTS IX_InspectionRecords_ContractNumber_ItemNumber_Date ON InspectionRecords (ContractNumber, ItemNumber, InspectionDate DESC, Id DESC);
        CREATE INDEX IF NOT EXISTS IX_InspectionRecords_CustomerPo_ItemNumber_Date ON InspectionRecords (CustomerPo, ItemNumber, InspectionDate DESC, Id DESC);
        CREATE INDEX IF NOT EXISTS IX_InspectionRecords_ItemNumber_Date ON InspectionRecords (ItemNumber, InspectionDate DESC, Id DESC);
        CREATE TABLE IF NOT EXISTS ZuruScheduleRecords (
            Id INTEGER NOT NULL CONSTRAINT PK_ZuruScheduleRecords PRIMARY KEY AUTOINCREMENT,
            BusinessKey TEXT NOT NULL, Customer TEXT NOT NULL, Country TEXT NOT NULL, PoNumber TEXT NOT NULL,
            CustomerPo TEXT NOT NULL, Sku TEXT NOT NULL, ItemNumber TEXT NOT NULL, ProductName TEXT NOT NULL,
            Quantity TEXT NULL, Cartons TEXT NULL, PlannedShipDate TEXT NULL, PlannedInspectionDate TEXT NULL,
            ThirdPartyInspectionDate TEXT NULL, InspectionResult TEXT NOT NULL, SourceFile TEXT NOT NULL,
            SourceSheet TEXT NOT NULL, SourceRow INTEGER NOT NULL, CreatedAt TEXT NOT NULL, UpdatedAt TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS IX_ZuruScheduleRecords_BusinessKey ON ZuruScheduleRecords (BusinessKey);
        CREATE TABLE IF NOT EXISTS ScheduleImportBatches (
            Id INTEGER NOT NULL CONSTRAINT PK_ScheduleImportBatches PRIMARY KEY AUTOINCREMENT,
            Source TEXT NOT NULL, FileName TEXT NOT NULL, UploadedBy TEXT NOT NULL, UploadedAt TEXT NOT NULL,
            ConfirmedAt TEXT NULL, Status TEXT NOT NULL, ParsedCount INTEGER NOT NULL, NewCount INTEGER NOT NULL,
            ChangedCount INTEGER NOT NULL, UnchangedCount INTEGER NOT NULL, CompletedSkippedCount INTEGER NOT NULL,
            InvalidSkippedCount INTEGER NOT NULL, PendingReviewCount INTEGER NOT NULL DEFAULT 0, PreviewJson TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS InspectionResultApprovals (
            Id INTEGER NOT NULL CONSTRAINT PK_InspectionResultApprovals PRIMARY KEY AUTOINCREMENT,
            InspectionRecordId INTEGER NOT NULL, Site TEXT NOT NULL, PreviousInternalResult TEXT NOT NULL,
            PreviousThirdPartyResult TEXT NOT NULL, RequestedInternalResult TEXT NOT NULL, RequestedThirdPartyResult TEXT NOT NULL,
            RequestedHoldRejectReason TEXT NOT NULL, RequestedNote TEXT NOT NULL, Status TEXT NOT NULL,
            RequestedBy TEXT NOT NULL, RequestedAt TEXT NOT NULL, ReviewedBy TEXT NOT NULL, ReviewedAt TEXT NULL, ReviewComment TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS IX_InspectionResultApprovals_InspectionRecordId_Status ON InspectionResultApprovals (InspectionRecordId, Status);
        CREATE TABLE IF NOT EXISTS InspectionAlerts (
            Id INTEGER NOT NULL CONSTRAINT PK_InspectionAlerts PRIMARY KEY AUTOINCREMENT,
            InspectionRecordId INTEGER NOT NULL, Site TEXT NOT NULL, Type TEXT NOT NULL, Summary TEXT NOT NULL,
            BeforeJson TEXT NOT NULL, AfterJson TEXT NOT NULL, Status TEXT NOT NULL, CreatedAt TEXT NOT NULL,
            HandledBy TEXT NOT NULL, HandledAt TEXT NULL
        );
        CREATE INDEX IF NOT EXISTS IX_InspectionAlerts_Site_Status_Type ON InspectionAlerts (Site, Status, Type);
        """);
    var batchColumns = db.Database.SqlQueryRaw<string>("SELECT name AS Value FROM pragma_table_info('ScheduleImportBatches')").ToList();
    if (!batchColumns.Contains("PendingReviewCount")) db.Database.ExecuteSqlRaw("ALTER TABLE ScheduleImportBatches ADD COLUMN PendingReviewCount INTEGER NOT NULL DEFAULT 0");
    if (!batchColumns.Contains("ActualNewCount")) db.Database.ExecuteSqlRaw("ALTER TABLE ScheduleImportBatches ADD COLUMN ActualNewCount INTEGER NOT NULL DEFAULT 0");
    if (!batchColumns.Contains("ActualChangedCount")) db.Database.ExecuteSqlRaw("ALTER TABLE ScheduleImportBatches ADD COLUMN ActualChangedCount INTEGER NOT NULL DEFAULT 0");
    if (!batchColumns.Contains("ImportRange")) db.Database.ExecuteSqlRaw("ALTER TABLE ScheduleImportBatches ADD COLUMN ImportRange TEXT NOT NULL DEFAULT ''");
    var userColumns = db.Database.SqlQueryRaw<string>("SELECT name AS Value FROM pragma_table_info('Users')").ToList();
    if (!userColumns.Contains("DataScope")) db.Database.ExecuteSqlRaw("ALTER TABLE Users ADD COLUMN DataScope TEXT NOT NULL DEFAULT ''");
    var inspectionColumns = db.Database.SqlQueryRaw<string>("SELECT name AS Value FROM pragma_table_info('InspectionRecords')").ToList();
    if (!inspectionColumns.Contains("ResponsibleLineLeader")) db.Database.ExecuteSqlRaw("ALTER TABLE InspectionRecords ADD COLUMN ResponsibleLineLeader TEXT NOT NULL DEFAULT ''");
    if (!inspectionColumns.Contains("ProblemSource")) db.Database.ExecuteSqlRaw("ALTER TABLE InspectionRecords ADD COLUMN ProblemSource TEXT NOT NULL DEFAULT ''");
    if (!inspectionColumns.Contains("HandlingResult")) db.Database.ExecuteSqlRaw("ALTER TABLE InspectionRecords ADD COLUMN HandlingResult TEXT NOT NULL DEFAULT ''");
    if (!inspectionColumns.Contains("TestScrap")) db.Database.ExecuteSqlRaw("ALTER TABLE InspectionRecords ADD COLUMN TestScrap TEXT NOT NULL DEFAULT ''");
    if (!inspectionColumns.Contains("PackagingSpec")) db.Database.ExecuteSqlRaw("ALTER TABLE InspectionRecords ADD COLUMN PackagingSpec TEXT NOT NULL DEFAULT ''");
    if (!inspectionColumns.Contains("PackingQuantity")) db.Database.ExecuteSqlRaw("ALTER TABLE InspectionRecords ADD COLUMN PackingQuantity TEXT NULL");
    if (!inspectionColumns.Contains("ThirdPartyInspectionLocation")) db.Database.ExecuteSqlRaw("ALTER TABLE InspectionRecords ADD COLUMN ThirdPartyInspectionLocation TEXT NOT NULL DEFAULT ''");
    if (!inspectionColumns.Contains("WorkflowStatus")) db.Database.ExecuteSqlRaw("ALTER TABLE InspectionRecords ADD COLUMN WorkflowStatus TEXT NOT NULL DEFAULT '待验货'");
    if (!inspectionColumns.Contains("PlanId")) db.Database.ExecuteSqlRaw("ALTER TABLE InspectionRecords ADD COLUMN PlanId TEXT NOT NULL DEFAULT ''");
    if (!inspectionColumns.Contains("ScheduleKey")) db.Database.ExecuteSqlRaw("ALTER TABLE InspectionRecords ADD COLUMN ScheduleKey TEXT NOT NULL DEFAULT ''");
    if (!inspectionColumns.Contains("ScheduleSource")) db.Database.ExecuteSqlRaw("ALTER TABLE InspectionRecords ADD COLUMN ScheduleSource TEXT NOT NULL DEFAULT ''");
    if (!inspectionColumns.Contains("ScheduleCreatedBatchId")) db.Database.ExecuteSqlRaw("ALTER TABLE InspectionRecords ADD COLUMN ScheduleCreatedBatchId INTEGER NULL");
    db.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_InspectionRecords_ScheduleCreatedBatchId ON InspectionRecords (ScheduleCreatedBatchId)");
    if (!inspectionColumns.Contains("Country")) db.Database.ExecuteSqlRaw("ALTER TABLE InspectionRecords ADD COLUMN Country TEXT NOT NULL DEFAULT ''");
    if (!inspectionColumns.Contains("PlannedShipDate")) db.Database.ExecuteSqlRaw("ALTER TABLE InspectionRecords ADD COLUMN PlannedShipDate TEXT NULL");
    if (!inspectionColumns.Contains("ScheduleUpdatedAt")) db.Database.ExecuteSqlRaw("ALTER TABLE InspectionRecords ADD COLUMN ScheduleUpdatedAt TEXT NULL");
    db.Database.ExecuteSqlRaw("UPDATE InspectionRecords SET PlanId = 'PLAN-' || printf('%010d', Id) WHERE PlanId = ''");
    db.Database.ExecuteSqlRaw("CREATE UNIQUE INDEX IF NOT EXISTS IX_InspectionRecords_PlanId ON InspectionRecords (PlanId)");
    db.Database.ExecuteSqlRaw("CREATE UNIQUE INDEX IF NOT EXISTS IX_InspectionRecords_ScheduleKey ON InspectionRecords (ScheduleKey) WHERE ScheduleKey <> ''");
    db.Database.ExecuteSqlRaw("UPDATE InspectionRecords SET WorkflowStatus = CASE WHEN InternalResult = '不用验' OR ThirdPartyResult = '不用验' THEN '不用验' WHEN InternalResult = '待复检' OR ThirdPartyResult = '待复检' THEN '待复检' WHEN InternalResult = 'REJ' OR ThirdPartyResult = 'REJ' THEN 'REJ' WHEN InternalResult = 'HOLD' OR ThirdPartyResult = 'HOLD' THEN 'HOLD' WHEN InternalResult IN ('PASS', 'AOD', 'LG', 'AOD+LG') OR ThirdPartyResult IN ('PASS', 'AOD', 'LG', 'AOD+LG') THEN '已完成' ELSE '待验货' END WHERE WorkflowStatus = '待验货'");
    db.Database.ExecuteSqlRaw("UPDATE InspectionRecords SET WorkflowStatus = '待验货' WHERE WorkflowStatus = '已完成' AND TRIM(InternalResult) IN ('', 'Pending', '需要验货', '还需要验货', 'NA') AND TRIM(ThirdPartyResult) IN ('', 'Pending', '需要验货', '还需要验货', 'NA')");
    // Older completed batches did not store actual writes. Recover only records whose source and
    // last import timestamp match that batch's confirmation; never infer from a filename alone.
    foreach (var legacyBatch in db.ScheduleImportBatches.Where(value => value.Status == "已完成" && value.ImportRange == "").ToList())
    {
        if (legacyBatch.ConfirmedAt is null) continue;
        var previewKinds = (JsonSerializer.Deserialize<ZuruPreviewItem[]>(legacyBatch.PreviewJson) ?? [])
            .GroupBy(item => item.Row.BusinessKey).ToDictionary(group => group.Key, group => group.First().Kind);
        var lower = legacyBatch.ConfirmedAt.Value.AddSeconds(-2);
        var upper = legacyBatch.ConfirmedAt.Value.AddSeconds(2);
        var restored = db.InspectionRecords.Where(record => record.ScheduleSource == legacyBatch.Source &&
            record.SourceFile == legacyBatch.FileName && record.ImportedAt >= lower && record.ImportedAt <= upper).ToList();
        var actualNew = 0; var actualChanged = 0;
        var sites = new Dictionary<string, (int New, int Changed)>();
        foreach (var record in restored)
        {
            if (!previewKinds.TryGetValue(record.ScheduleKey, out var kind) || kind is not ("新增" or "变更")) continue;
            sites.TryGetValue(record.Site, out var counts);
            if (kind == "新增")
            {
                if (record.ScheduleCreatedBatchId is not null && record.ScheduleCreatedBatchId != legacyBatch.Id) continue;
                record.ScheduleCreatedBatchId = legacyBatch.Id;
                actualNew++; counts.New++;
            }
            else { actualChanged++; counts.Changed++; }
            sites[record.Site] = counts;
        }
        legacyBatch.ActualNewCount = actualNew;
        legacyBatch.ActualChangedCount = actualChanged;
        legacyBatch.ImportRange = sites.Count == 0 ? "历史批次无法可靠追溯实际写入范围" : string.Join("；", sites.OrderBy(entry => entry.Key)
            .Select(entry => $"{entry.Key}：新增{entry.Value.New}、变更{entry.Value.Changed}"));
    }
    db.SaveChanges();
    db.Database.ExecuteSqlRaw("UPDATE Users SET Role = '管理员', DataScope = '全部厂区及系统设置' WHERE Role = 'Admin'");
    var adminPassword = Environment.GetEnvironmentVariable("QC_ADMIN_PASSWORD");
    if (!string.IsNullOrWhiteSpace(adminPassword) && !db.Users.Any())
    {
        db.Users.Add(new User
        {
            Username = Environment.GetEnvironmentVariable("QC_ADMIN_USERNAME") ?? "admin",
            DisplayName = "系统管理员",
            Department = "QC部",
            Role = "管理员",
            DataScope = "全部厂区及系统设置",
            PasswordHash = PasswordService.Hash(adminPassword),
        });
        db.SaveChanges();
    }
}

app.UseCors();
if (app.Environment.IsDevelopment()) { app.UseSwagger(); app.UseSwaggerUI(); }
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", service = "QcInspection.Api" }));
// Server-to-server result lookup for the shipping system. The shared key is never sent to browsers.
app.MapGet("/api/integrations/shipping/results", async (HttpRequest request, string? contractNumber,
    string? customerPo, string? itemNumber, string? site, int? page, AppDbContext db, CancellationToken ct) =>
{
    var configuredKey = builder.Configuration["QC_SHIPPING_API_KEY"];
    var suppliedKey = request.Headers["X-QC-API-Key"].ToString();
    if (suppliedKey.Length == 0)
    {
        var authorization = request.Headers.Authorization.ToString();
        if (authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            suppliedKey = authorization[7..].Trim();
    }
    if (string.IsNullOrWhiteSpace(configuredKey) || configuredKey.Length < 32)
        return Results.Problem("船务查询接口尚未配置", statusCode: 503);
    if (suppliedKey.Length != configuredKey.Length ||
        !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(suppliedKey), Encoding.UTF8.GetBytes(configuredKey)))
        return Results.Unauthorized();
    contractNumber = contractNumber?.Trim(); customerPo = customerPo?.Trim(); itemNumber = itemNumber?.Trim();
    if (string.IsNullOrWhiteSpace(contractNumber) && string.IsNullOrWhiteSpace(customerPo) && string.IsNullOrWhiteSpace(itemNumber))
        return Results.BadRequest(new { error = "请提供合同号、客户PO或货号" });
    if (!string.IsNullOrWhiteSpace(site) && site is not ("兴信" or "湖南" or "华登" or "待分配"))
        return Results.BadRequest(new { error = "厂区无效" });
    request.HttpContext.Response.Headers.CacheControl = "no-store";
    var records = db.InspectionRecords.AsNoTracking().Where(value =>
        value.WorkflowStatus == "已完成" || value.WorkflowStatus == "HOLD" ||
        value.WorkflowStatus == "REJ" || value.WorkflowStatus == "待复检" || value.WorkflowStatus == "不用验");
    if (!string.IsNullOrWhiteSpace(contractNumber)) records = records.Where(value => value.ContractNumber == contractNumber);
    if (!string.IsNullOrWhiteSpace(customerPo)) records = records.Where(value => value.CustomerPo == customerPo);
    if (!string.IsNullOrWhiteSpace(itemNumber)) records = records.Where(value => value.ItemNumber == itemNumber);
    if (!string.IsNullOrWhiteSpace(site)) records = records.Where(value => value.Site == site);
    var total = await records.CountAsync(ct);
    var number = Math.Clamp(page ?? 1, 1, 100000);
    var items = await records.OrderByDescending(value => value.InspectionDate).ThenByDescending(value => value.Id)
        .Skip((number - 1) * 100).Take(100)
        .Select(value => new { value.PlanId, value.Site, value.InspectionDate, value.Customer,
            value.ContractNumber, value.CustomerPo, value.ItemNumber, value.ProductName,
            value.InternalResult, value.ThirdPartyResult, value.HoldRejectReason, value.WorkflowStatus })
        .ToListAsync(ct);
    return Results.Ok(new { total, page = number, pageSize = 100, totalPages = Math.Max(1, (total + 99) / 100), items });
});
// Resolve one shipping task with one HTTP request; the existing single-result endpoint remains available.
app.MapPost("/api/integrations/shipping/results/batch", async (HttpRequest request,
    ShippingBatchRequest payload, AppDbContext db, CancellationToken ct) =>
{
    const int maxShippingBatchItems = 500;
    const int maxLookupValueLength = 100;
    var configuredKey = builder.Configuration["QC_SHIPPING_API_KEY"];
    var suppliedKey = request.Headers["X-QC-API-Key"].ToString();
    if (suppliedKey.Length == 0)
    {
        var authorization = request.Headers.Authorization.ToString();
        if (authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            suppliedKey = authorization[7..].Trim();
    }
    if (string.IsNullOrWhiteSpace(configuredKey) || configuredKey.Length < 32)
        return Results.Problem("船务查询接口尚未配置", statusCode: 503);
    if (suppliedKey.Length != configuredKey.Length ||
        !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(suppliedKey), Encoding.UTF8.GetBytes(configuredKey)))
        return Results.Unauthorized();
    if (payload.Items is null || payload.Items.Length is < 1 or > maxShippingBatchItems)
        return Results.BadRequest(new { error = "货物明细数量须为 1 至 500 条" });
    if (payload.Items.Any(item => item is null ||
        (item.ContractNumber?.Length ?? 0) > maxLookupValueLength ||
        (item.CustomerPo?.Length ?? 0) > maxLookupValueLength ||
        (item.ItemNumber?.Length ?? 0) > maxLookupValueLength))
        return Results.BadRequest(new { error = "合同号、客户PO或货号格式无效" });

    request.HttpContext.Response.Headers.CacheControl = "no-store";
    var cache = new Dictionary<(string ContractNumber, string CustomerPo, string ItemNumber), (int Total, object? Latest)>();
    var results = new List<object>(payload.Items.Length);
    for (var index = 0; index < payload.Items.Length; index++)
    {
        var item = payload.Items[index]!;
        var contractNumber = item.ContractNumber?.Trim() ?? "";
        var customerPo = item.CustomerPo?.Trim() ?? "";
        var itemNumber = item.ItemNumber?.Trim() ?? "";
        var key = (contractNumber, customerPo, itemNumber);
        if (!cache.TryGetValue(key, out var match))
        {
            if (contractNumber.Length == 0 && customerPo.Length == 0 && itemNumber.Length == 0)
            {
                match = (0, null);
            }
            else
            {
                var records = db.InspectionRecords.AsNoTracking().Where(value =>
                    value.WorkflowStatus == "已完成" || value.WorkflowStatus == "HOLD" ||
                    value.WorkflowStatus == "REJ" || value.WorkflowStatus == "待复检" || value.WorkflowStatus == "不用验");
                if (contractNumber.Length > 0) records = records.Where(value => value.ContractNumber == contractNumber);
                if (customerPo.Length > 0) records = records.Where(value => value.CustomerPo == customerPo);
                if (itemNumber.Length > 0) records = records.Where(value => value.ItemNumber == itemNumber);
                var total = await records.CountAsync(ct);
                var latest = await records.OrderByDescending(value => value.InspectionDate).ThenByDescending(value => value.Id)
                    .Select(value => new { value.PlanId, value.Site, value.InspectionDate, value.Customer,
                        value.ContractNumber, value.CustomerPo, value.ItemNumber, value.ProductName,
                        value.InternalResult, value.ThirdPartyResult, value.HoldRejectReason, value.WorkflowStatus })
                    .FirstOrDefaultAsync(ct);
                match = (total, latest);
            }
            cache[key] = match;
        }
        results.Add(new { itemIndex = index, total = match.Total, latest = match.Latest });
    }
    return Results.Ok(new { results });
});
app.MapGet("/api/public/results", async (string? q, string? site, int? page, AppDbContext db, CancellationToken ct) =>
{
    var query = db.InspectionRecords.AsNoTracking().Where(record =>
        record.InternalResult != "" || record.ThirdPartyResult != "");
    if (site is "兴信" or "湖南" or "华登") query = query.Where(record => record.Site == site);
    if (!string.IsNullOrWhiteSpace(q))
    {
        var term = q.Trim();
        query = query.Where(record => record.ContractNumber.Contains(term) || record.CustomerPo.Contains(term) ||
            record.ItemNumber.Contains(term) || record.Customer.Contains(term));
    }
    var total = await query.CountAsync(ct);
    var number = Math.Clamp(page ?? 1, 1, 100000);
    var items = await query.OrderByDescending(record => record.InspectionDate).ThenByDescending(record => record.Id)
        .Skip((number - 1) * 100).Take(100)
        .Select(record => new { record.PlanId, record.Site, record.InspectionDate, record.Customer,
            record.ContractNumber, record.CustomerPo, record.ItemNumber, record.ProductName,
            record.InternalResult, record.ThirdPartyResult, record.HoldRejectReason, record.WorkflowStatus })
        .ToListAsync(ct);
    return Results.Ok(new { total, page = number, totalPages = Math.Max(1, (total + 99) / 100), items });
});
app.MapGet("/api/public/overview", async (AppDbContext db, CancellationToken ct) => Results.Ok(new
{
    totals = await db.InspectionRecords.AsNoTracking().GroupBy(record => record.Site)
        .Select(group => new { site = group.Key, count = group.Count() })
        .ToDictionaryAsync(value => value.site, value => value.count, ct),
}));
app.MapGet("/api/public/plans", async (string site, string? template, string? month, string? from, string? to,
    int? page, string? q, string? status, string? customer, string? location, AppDbContext db, CancellationToken ct) =>
{
    if (site is not ("兴信" or "湖南" or "华登" or "待分配")) return Results.BadRequest(new { error = "厂区无效" });
    var siteQuery = db.InspectionRecords.AsNoTracking().Where(record => record.Site == site);
    if (site == "华登" && template == "JAZ专用")
        siteQuery = siteQuery.Where(record => record.ScheduleSource == "JAZ/JWC" || EF.Functions.Like(record.Customer, "%JAZ%") || EF.Functions.Like(record.InspectionParty, "%JAZ%"));
    else if (site == "华登" && template == "普通验货")
        siteQuery = siteQuery.Where(record => record.ScheduleSource != "JAZ/JWC" && !EF.Functions.Like(record.Customer, "%JAZ%") && !EF.Functions.Like(record.InspectionParty, "%JAZ%"));
    var dates = await siteQuery.Where(record => record.InspectionDate != null).Select(record => record.InspectionDate!.Value).Distinct().ToListAsync(ct);
    var months = dates.Select(date => date.ToString("yyyy-MM")).Distinct().OrderByDescending(value => value).ToArray();
    if (!string.IsNullOrWhiteSpace(month))
    {
        if (!DateTime.TryParseExact(month, "yyyy-MM", null, System.Globalization.DateTimeStyles.None, out var start))
            return Results.BadRequest(new { error = "月份格式应为yyyy-MM" });
        siteQuery = siteQuery.Where(record => record.InspectionDate >= start && record.InspectionDate < start.AddMonths(1));
    }
    if (!string.IsNullOrWhiteSpace(from))
    {
        if (!DateTime.TryParseExact(from, "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out var start))
            return Results.BadRequest(new { error = "开始日期格式应为yyyy-MM-dd" });
        siteQuery = siteQuery.Where(record => record.InspectionDate >= start);
    }
    if (!string.IsNullOrWhiteSpace(to))
    {
        if (!DateTime.TryParseExact(to, "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out var end))
            return Results.BadRequest(new { error = "结束日期格式应为yyyy-MM-dd" });
        siteQuery = siteQuery.Where(record => record.InspectionDate < end.AddDays(1));
    }
    var customers = await siteQuery.Where(record => record.Customer != "").Select(record => record.Customer).Distinct().OrderBy(value => value).ToArrayAsync(ct);
    var locations = await siteQuery.Where(record => record.InspectionLocation != "").Select(record => record.InspectionLocation).Distinct().OrderBy(value => value).ToArrayAsync(ct);
    if (!string.IsNullOrWhiteSpace(status)) siteQuery = siteQuery.Where(record => record.WorkflowStatus == status);
    if (!string.IsNullOrWhiteSpace(customer)) siteQuery = siteQuery.Where(record => record.Customer == customer);
    if (!string.IsNullOrWhiteSpace(location)) siteQuery = siteQuery.Where(record => record.InspectionLocation == location);
    if (!string.IsNullOrWhiteSpace(q))
    {
        var term = q.Trim();
        siteQuery = siteQuery.Where(record => record.ContractNumber.Contains(term) || record.CustomerPo.Contains(term) ||
            record.ItemNumber.Contains(term) || record.Customer.Contains(term) || record.ProductName.Contains(term));
    }
    var total = await siteQuery.CountAsync(ct);
    var number = Math.Clamp(page ?? 1, 1, 100000);
    var items = await siteQuery.OrderByDescending(record => record.InspectionDate).ThenByDescending(record => record.Id)
        .Skip((number - 1) * 100).Take(100)
        .Select(record => new { record.Id, record.ScheduleSource, record.InspectionDate, record.InspectionLocation,
            record.InspectionParty, record.ThirdPartyOrganization, record.ThirdPartyInspectionLocation,
            record.Customer, record.ContractNumber, record.CustomerPo, record.ItemNumber, record.ProductName,
            record.Quantity, record.Cartons, record.PackingQuantity, record.PackagingSpec,
            record.InternalResult, record.ThirdPartyResult, record.HoldRejectReason,
            record.ProductionWorkshop, record.ProductionSupervisor, record.ResponsibleLineLeader,
            record.ProblemSource, record.HandlingResult, record.TestScrap, record.Note, record.WorkflowStatus })
        .ToListAsync(ct);
    return Results.Ok(new { site, month = month ?? "", months, customers, locations, page = number, pageSize = 100,
        total, totalPages = Math.Max(1, (total + 99) / 100), items });
});
app.MapGet("/api/workshop-mappings", async (AppDbContext db, CancellationToken ct) =>
    Results.Ok(await db.WorkshopMappings.AsNoTracking().OrderBy(value => value.Workshop).ToListAsync(ct))).RequireAuthorization("QcWrite");
app.MapPost("/api/workshop-mappings", async (WorkshopMappingRequest request, AppDbContext db, CancellationToken ct) =>
{
    var workshop = request.Workshop.Trim(); var supervisor = request.Supervisor.Trim();
    if (workshop == "" || supervisor == "") return Results.BadRequest(new { error = "请填写车间和主管" });
    if (await db.WorkshopMappings.AnyAsync(value => value.Workshop == workshop, ct)) return Results.Conflict(new { error = "该车间已存在" });
    db.WorkshopMappings.Add(new WorkshopMapping { Workshop = workshop, Supervisor = supervisor });
    await db.SaveChangesAsync(ct); return Results.NoContent();
}).RequireAuthorization("QcWrite");
app.MapPut("/api/workshop-mappings/{id:long}", async (long id, WorkshopMappingRequest request, AppDbContext db, CancellationToken ct) =>
{
    var mapping = await db.WorkshopMappings.FindAsync([id], ct);
    if (mapping is null) return Results.NotFound();
    var workshop = request.Workshop.Trim(); var supervisor = request.Supervisor.Trim();
    if (workshop == "" || supervisor == "") return Results.BadRequest(new { error = "请填写车间和主管" });
    if (await db.WorkshopMappings.AnyAsync(value => value.Id != id && value.Workshop == workshop, ct)) return Results.Conflict(new { error = "该车间已存在" });
    mapping.Workshop = workshop; mapping.Supervisor = supervisor;
    await db.SaveChangesAsync(ct); return Results.NoContent();
}).RequireAuthorization("QcWrite");
app.MapDelete("/api/workshop-mappings/{id:long}", async (long id, AppDbContext db, CancellationToken ct) =>
{
    var mapping = await db.WorkshopMappings.FindAsync([id], ct);
    if (mapping is null) return Results.NotFound();
    db.WorkshopMappings.Remove(mapping); await db.SaveChangesAsync(ct); return Results.NoContent();
}).RequireAuthorization("QcWrite");
app.MapPost("/api/schedule-imports/preview", async (HttpRequest request, string source, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    var allowedSources = new[] { "ZURU", "通用", "Sky Castle", "TOMY Indonesia", "TIGERHEAD", "Masterkidz", "JAZ/JWC", "CEPIA", "Toy Monster", "ZANZOON" };
    if (!allowedSources.Contains(source, StringComparer.OrdinalIgnoreCase)) return Results.BadRequest(new { error = "请选择正确的排期来源" });
    if (!request.HasFormContentType) return Results.BadRequest(new { error = "请上传排期Excel" });
    var form = await request.ReadFormAsync(cancellationToken); var file = form.Files.GetFile("file");
    if (file is null || file.Length == 0) return Results.BadRequest(new { error = "请选择排期文件" });
    if (file.Length > 30 * 1024 * 1024) return Results.BadRequest(new { error = "文件不能超过30MB" });
    if (Path.GetExtension(file.FileName).ToLowerInvariant() is not (".xlsx" or ".xls" or ".xlsm"))
        return Results.BadRequest(new { error = "仅支持xlsx、xls和xlsm文件" });
    ZuruParseResult parsed;
    try { await using var stream = file.OpenReadStream(); parsed = source is "ZURU" or "Sky Castle" ? InspectionArrangementParser.Parse(stream, source) : GenericScheduleParser.Parse(stream, source); }
    catch (Exception error) when (error is InvalidDataException or NotSupportedException or IOException)
    { return Results.BadRequest(new { error = $"无法解析文件：{error.Message}" }); }
    if (parsed.Rows.Count == 0) return Results.BadRequest(new { error = source switch
    {
        "ZURU" => "请上传 ZURU 每周验货总表（需含“下周验货申请-”Sheet），当前入口不再读取生产排期表",
        "Sky Castle" => "请上传 Sky Castle 验货安排表（需含“未来三周”Sheet）",
        _ => "没有识别到可导入的未完成产品订单",
    } });
    var importToday = DateTime.Today;
    var importWindowEnd = importToday.AddDays(21);
    var outsideImportWindow = parsed.Rows.Count(row => row.PlannedInspectionDate is not null &&
        !IsWithinScheduleImportWindow(row.PlannedInspectionDate, importToday));
    var importRows = parsed.Rows.Where(row => IsWithinScheduleImportWindow(row.PlannedInspectionDate, importToday)).ToArray();
    var candidates = await db.InspectionRecords.AsNoTracking().ToListAsync(cancellationToken);
    var existing = new Dictionary<string, InspectionRecord>();
    var ambiguous = new HashSet<string>();
    foreach (var row in importRows)
    {
        var current = MatchScheduleRecord(candidates, row, source, out var hasMultiple);
        if (hasMultiple) ambiguous.Add(row.BusinessKey);
        if (current is not null) existing[row.BusinessKey] = current;
    }
    var preview = importRows.Select(row =>
    {
        existing.TryGetValue(row.BusinessKey, out var current); var changes = current is null ? Array.Empty<string>() : ChangedFields(current, row);
        var issues = ambiguous.Contains(row.BusinessKey) ? row.Issues.Append("现有计划匹配不唯一，请人工核对").ToArray() : row.Issues;
        var cannotSelect = issues.Any(issue => issue.Contains("匹配不唯一") || issue.Contains("重复安排") || issue.Contains("无法核验字体颜色"));
        var kind = current is not null && HasInspectionResult(current) ? "已有结果跳过"
            : cannotSelect ? "规则跳过" : issues.Length > 0 ? "待判断" : current is null ? "新增" : changes.Length == 0 ? "无变化" : "变更";
        return new ZuruPreviewItem(row with { Issues = issues }, kind, changes);
    }).ToArray();
    var ruleSkipped = preview.Where(item => item.Kind == "规则跳过").ToArray();
    var importTips = new List<string>();
    var legacySkipped = ruleSkipped.Count(item => item.Row.Issues.Any(issue => issue.Contains("无法核验字体颜色")));
    if (legacySkipped > 0) importTips.Add($"本次旧版 .xls 文件有 {legacySkipped} 条记录无法核验字体颜色，已跳过；请另存为 .xlsx 后重新上传。");
    var duplicateSkipped = ruleSkipped.Count(item => item.Row.Issues.Any(issue => issue.Contains("重复安排")));
    if (duplicateSkipped > 0) importTips.Add($"文件内有 {duplicateSkipped} 条重复安排记录，已跳过，请核对订单和货号。");
    var ambiguousSkipped = ruleSkipped.Count(item => item.Row.Issues.Any(issue => issue.Contains("匹配不唯一")));
    if (ambiguousSkipped > 0) importTips.Add($"有 {ambiguousSkipped} 条记录与现有计划匹配不唯一，已跳过，请人工核对。");
    if (outsideImportWindow > 0) importTips.Add($"有 {outsideImportWindow} 条计划验货期不在 {importToday:yyyy-MM-dd} 至 {importWindowEnd:yyyy-MM-dd}（未来3周）范围内，已跳过。");
    if (parsed.InvalidSkipped > 0) importTips.Add($"另有 {parsed.InvalidSkipped} 条无法识别的记录未进入预览。");
    var batch = new ScheduleImportBatch
    {
        Source = source, FileName = Path.GetFileName(file.FileName), UploadedBy = principal.Identity?.Name ?? "未知用户",
        ParsedCount = preview.Length, NewCount = preview.Count(item => item.Kind == "新增"),
        ChangedCount = preview.Count(item => item.Kind == "变更"), UnchangedCount = preview.Count(item => item.Kind == "无变化"),
        PendingReviewCount = preview.Count(item => item.Kind == "待判断"),
        CompletedSkippedCount = parsed.CompletedSkipped + outsideImportWindow + preview.Count(item => item.Kind is "已有结果跳过" or "规则跳过"), InvalidSkippedCount = parsed.InvalidSkipped,
        PreviewJson = JsonSerializer.Serialize(preview),
    };
    db.ScheduleImportBatches.Add(batch); await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { batch.Id, batch.FileName, batch.ParsedCount, batch.NewCount, batch.ChangedCount, batch.UnchangedCount,
        batch.CompletedSkippedCount, batch.InvalidSkippedCount, batch.PendingReviewCount, parsed.ProductSheets, parsed.AuxiliarySheetsSkipped,
        importTips, items = preview.Where(item => item.Kind is "新增" or "变更" or "待判断")
            .OrderByDescending(item => item.Kind == "待判断")
            .Select(item => new { item.Row, item.Kind, item.Changes,
                targetSite = item.Row.Site == "待分配" && existing.TryGetValue(item.Row.BusinessKey, out var matched) ? matched.Site : item.Row.Site }) });
}).DisableAntiforgery().RequireAuthorization("ScheduleWrite");

app.MapPost("/api/schedule-imports/{id:long}/confirm", async (long id, ScheduleImportConfirmRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    var batch = await db.ScheduleImportBatches.FirstOrDefaultAsync(value => value.Id == id, cancellationToken);
    if (batch is null) return Results.NotFound(new { error = "导入预览不存在" });
    if (batch.Status != "待确认") return Results.Conflict(new { error = "该批次已经处理" });
    var items = JsonSerializer.Deserialize<ZuruPreviewItem[]>(batch.PreviewJson) ?? [];
    var candidates = await db.InspectionRecords.ToListAsync(cancellationToken);
    var existing = new Dictionary<string, InspectionRecord>();
    var newlyAmbiguous = new HashSet<string>();
    foreach (var item in items)
    {
        var current = MatchScheduleRecord(candidates, item.Row, batch.Source, out var hasMultiple);
        if (hasMultiple) newlyAmbiguous.Add(item.Row.BusinessKey);
        if (current is not null) existing[item.Row.BusinessKey] = current;
    }
    var selectableKeys = items.Where(item => item.Kind is "新增" or "变更" or "待判断")
        .Select(item => item.Row.BusinessKey).ToHashSet();
    var selected = request.SelectedKeys is null
        ? items.Where(item => item.Kind is "新增" or "变更").Select(item => item.Row.BusinessKey)
            .Concat(request.SelectedPendingKeys ?? []).Where(selectableKeys.Contains).ToHashSet()
        : request.SelectedKeys.Where(selectableKeys.Contains).ToHashSet();
    var inserted = 0; var updated = 0; var pendingImported = 0;
    var importedPlans = new List<object>();
    var siteCounts = new Dictionary<string, (int New, int Changed)>();
    foreach (var item in items.Where(item => selected.Contains(item.Row.BusinessKey)))
    {
        if (!IsWithinScheduleImportWindow(item.Row.PlannedInspectionDate, DateTime.Today)) continue;
        if (newlyAmbiguous.Contains(item.Row.BusinessKey)) continue;
        if (item.Row.Issues.Any(issue => issue.Contains("匹配不唯一") || issue.Contains("重复安排") || issue.Contains("无法核验字体颜色"))) continue;
        if (existing.TryGetValue(item.Row.BusinessKey, out var matched) && HasInspectionResult(matched)) continue;
        var isNew = !existing.TryGetValue(item.Row.BusinessKey, out var record);
        if (isNew)
        {
            record = new InspectionRecord
            {
                PlanId = $"PLAN-{Guid.NewGuid():N}", ScheduleKey = item.Row.BusinessKey, ScheduleSource = batch.Source,
                Site = "待分配", WorkflowStatus = "待验货", Fingerprint = $"SCHEDULE-{item.Row.BusinessKey}", ImportedAt = DateTime.UtcNow,
                ScheduleCreatedBatchId = batch.Id,
            };
            db.InspectionRecords.Add(record); existing[item.Row.BusinessKey] = record; inserted++;
        }
        else updated++;
        var importedRecord = record!;
        ApplySchedule(importedRecord, item.Row, batch.Source, batch.FileName);
        siteCounts.TryGetValue(importedRecord.Site, out var siteCount);
        siteCounts[importedRecord.Site] = isNew ? (siteCount.New + 1, siteCount.Changed) : (siteCount.New, siteCount.Changed + 1);
        importedPlans.Add(new { kind = isNew ? "新增" : "变更", importedRecord.PlanId, importedRecord.Site, importedRecord.Customer,
            importedRecord.ContractNumber, importedRecord.CustomerPo, importedRecord.ItemNumber, importedRecord.ProductName,
            inspectionDate = importedRecord.InspectionDate?.ToString("yyyy-MM-dd"), item.Row.Sheet, item.Row.Row });
        if (item.Kind == "待判断") pendingImported++;
    }
    batch.Status = "已完成"; batch.ConfirmedAt = DateTime.UtcNow;
    batch.ActualNewCount = inserted; batch.ActualChangedCount = updated;
    batch.ImportRange = siteCounts.Count == 0 ? "无实际写入" : string.Join("；", siteCounts.OrderBy(entry => entry.Key)
        .Select(entry => $"{entry.Key}：新增{entry.Value.New}、变更{entry.Value.Changed}"));
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { batch.Id, inserted, updated, unchanged = batch.UnchangedCount, pendingImported, importedPlans });
}).RequireAuthorization("ScheduleWrite");

app.MapGet("/api/schedule-imports", async (AppDbContext db, CancellationToken cancellationToken) => Results.Ok(
    await db.ScheduleImportBatches.AsNoTracking().Where(value => value.Status == "已完成")
        .OrderByDescending(value => value.Id).Take(100).Select(value => new
    {
        value.Id, value.UploadedAt, value.ConfirmedAt, value.Source, value.FileName, value.UploadedBy, value.NewCount,
        value.ChangedCount, value.ActualNewCount, value.ActualChangedCount, value.ImportRange,
        value.UnchangedCount, value.CompletedSkippedCount, value.InvalidSkippedCount, value.PendingReviewCount, value.Status,
    }).ToListAsync(cancellationToken))).RequireAuthorization("ScheduleWrite");
app.MapGet("/api/schedule-imports/latest-new", async (AppDbContext db, CancellationToken cancellationToken) =>
    Results.Ok(new { batchId = await db.ScheduleImportBatches.AsNoTracking()
        .Where(value => value.Status == "已完成" && value.ActualNewCount > 0)
        .OrderByDescending(value => value.Id).Select(value => (long?)value.Id).FirstOrDefaultAsync(cancellationToken) }))
    .RequireAuthorization("QcRead");
app.MapGet("/api/schedule-imports/{id:long}/new-plans", async (long id, int? page, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    var batch = await db.ScheduleImportBatches.AsNoTracking().FirstOrDefaultAsync(value => value.Id == id && value.Status == "已完成", cancellationToken);
    if (batch is null) return Results.NotFound(new { error = "已完成的导入批次不存在" });
    var accessibleSites = new[] { "兴信", "湖南", "华登", "待分配" }.Where(site => CanAccessSite(principal, site)).ToArray();
    var query = db.InspectionRecords.AsNoTracking().Where(record => record.ScheduleCreatedBatchId == id && accessibleSites.Contains(record.Site));
    var total = await query.CountAsync(cancellationToken);
    var pageNumber = Math.Max(page ?? 1, 1);
    var items = await query.OrderByDescending(record => record.InspectionDate).ThenByDescending(record => record.Id)
        .Skip((pageNumber - 1) * 100).Take(100).ToListAsync(cancellationToken);
    var sites = await query.GroupBy(record => record.Site).Select(group => new { site = group.Key, count = group.Count() }).ToArrayAsync(cancellationToken);
    return Results.Ok(new { batch.Id, batch.FileName, batch.Source, total, page = pageNumber,
        totalPages = Math.Max(1, (total + 99) / 100), sites, items });
}).RequireAuthorization("QcRead");
app.MapPost("/api/legacy-inspections/import", async (HttpRequest request, string site, string? template, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!CanAccessSite(principal, site)) return Results.Forbid();
    if (site is not ("兴信" or "湖南" or "华登")) return Results.BadRequest(new { error = "厂区必须是兴信、湖南或华登" });
    if (site == "华登" && template is not (null or "" or "普通验货" or "JAZ专用"))
        return Results.BadRequest(new { error = "华登表类型必须是普通验货或JAZ专用" });
    if (!request.HasFormContentType) return Results.BadRequest(new { error = "请上传Excel验货表" });
    var form = await request.ReadFormAsync(cancellationToken);
    var file = form.Files.GetFile("file");
    if (file is null || file.Length == 0) return Results.BadRequest(new { error = "请选择验货表文件" });
    if (file.Length > 80 * 1024 * 1024) return Results.BadRequest(new { error = "文件不能超过80MB" });
    var extension = Path.GetExtension(file.FileName);
    if (extension is not (".xlsx" or ".xls" or ".xlsm")) return Results.BadRequest(new { error = "仅支持xlsx、xls和xlsm文件" });

    IReadOnlyList<InspectionRecord> incoming;
    try
    {
        await using var stream = file.OpenReadStream();
        incoming = LegacyInspectionParser.Parse(stream, site, Path.GetFileName(file.FileName), template);
    }
    catch (Exception error) when (error is InvalidDataException or NotSupportedException)
    {
        return Results.BadRequest(new { error = error.Message });
    }

    // QC结果表允许认领由排期建立、尚未分配厂区的计划。
    var existingRecords = await db.InspectionRecords.ToListAsync(cancellationToken);
    var existing = existingRecords.GroupBy(InspectionOrderKey).ToDictionary(group => group.Key, group => group.OrderByDescending(value => value.Id).First());
    var inserted = 0;
    var updated = 0;
    foreach (var record in incoming.GroupBy(InspectionOrderKey).Select(group => group.Last()))
    {
        var key = InspectionOrderKey(record);
        if (!existing.TryGetValue(key, out var current))
        {
            var partialMatches = existingRecords.Where(value => value.ContractNumber.Trim().Equals(record.ContractNumber.Trim(), StringComparison.OrdinalIgnoreCase)
                && value.ItemNumber.Trim().Equals(record.ItemNumber.Trim(), StringComparison.OrdinalIgnoreCase)).ToArray();
            if (partialMatches.Length > 1)
                return Results.Conflict(new { error = $"{record.ContractNumber} / {record.ItemNumber} 对应多条计划，请先人工核对，未写入本次验货结果" });
            if (partialMatches.Length == 1) current = partialMatches[0];
        }
        if (current is null)
        {
            record.PlanId = $"PLAN-{Guid.NewGuid():N}";
            record.WorkflowStatus = ResultStatus(record.InternalResult, record.ThirdPartyResult);
            db.InspectionRecords.Add(record);
            existing[key] = record;
            inserted++;
            continue;
        }
        if (string.IsNullOrWhiteSpace(current.CustomerPo)) current.CustomerPo = record.CustomerPo;
        AddImportAlerts(db, current, record);
        ApplyImportedRecord(current, record);
        current.Site = site;
        updated++;
    }
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { site, fileName = file.FileName, parsed = incoming.Count, inserted, updated, total = existingRecords.Count + inserted });
}).DisableAntiforgery().RequireAuthorization("QcWrite");

app.MapGet("/api/legacy-inspections", async (string site, string? template, string? month, string? from, string? to, int? page, string? q, string? status, string? customer, string? location, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!CanAccessSite(principal, site)) return Results.Forbid();
    if (site is not ("兴信" or "湖南" or "华登" or "待分配")) return Results.BadRequest(new { error = "厂区必须是兴信、湖南、华登或待分配" });
    const int pageSize = 100;
    var pageNumber = Math.Max(page ?? 1, 1);
    var siteQuery = db.InspectionRecords.AsNoTracking().Where(record => record.Site == site);
    if (site == "华登" && template == "JAZ专用")
        siteQuery = siteQuery.Where(record => record.ScheduleSource == "JAZ/JWC" || EF.Functions.Like(record.Customer, "%JAZ%") || EF.Functions.Like(record.InspectionParty, "%JAZ%"));
    else if (site == "华登" && template == "普通验货")
        siteQuery = siteQuery.Where(record => record.ScheduleSource != "JAZ/JWC" && !EF.Functions.Like(record.Customer, "%JAZ%") && !EF.Functions.Like(record.InspectionParty, "%JAZ%"));
    var dates = await siteQuery.Where(record => record.InspectionDate != null)
        .Select(record => record.InspectionDate!.Value).Distinct().ToListAsync(cancellationToken);
    var months = dates.Select(date => date.ToString("yyyy-MM")).Distinct().OrderByDescending(value => value).ToArray();
    var selectedMonth = string.IsNullOrWhiteSpace(month) ? string.Empty : month;
    if (!string.IsNullOrWhiteSpace(selectedMonth) && !DateTime.TryParseExact(selectedMonth, "yyyy-MM", null,
            System.Globalization.DateTimeStyles.None, out _))
        return Results.BadRequest(new { error = "月份格式应为yyyy-MM" });

    var query = siteQuery;
    if (!string.IsNullOrWhiteSpace(selectedMonth))
    {
        var monthStart = DateTime.ParseExact(selectedMonth, "yyyy-MM", null);
        var monthEnd = monthStart.AddMonths(1);
        query = query.Where(record => record.InspectionDate >= monthStart && record.InspectionDate < monthEnd);
    }
    if (!string.IsNullOrWhiteSpace(from))
    {
        if (!DateTime.TryParseExact(from, "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out var fromDate))
            return Results.BadRequest(new { error = "开始日期格式应为yyyy-MM-dd" });
        query = query.Where(record => record.InspectionDate >= fromDate);
    }
    if (!string.IsNullOrWhiteSpace(to))
    {
        if (!DateTime.TryParseExact(to, "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out var toDate))
            return Results.BadRequest(new { error = "结束日期格式应为yyyy-MM-dd" });
        var toExclusive = toDate.AddDays(1);
        query = query.Where(record => record.InspectionDate < toExclusive);
    }
    var customers = await query.Where(record => record.Customer != "").Select(record => record.Customer)
        .Distinct().OrderBy(value => value).ToArrayAsync(cancellationToken);
    var locations = await query.Where(record => record.InspectionLocation != "").Select(record => record.InspectionLocation)
        .Distinct().OrderBy(value => value).ToArrayAsync(cancellationToken);
    if (!string.IsNullOrWhiteSpace(status)) query = query.Where(record => record.WorkflowStatus == status);
    if (!string.IsNullOrWhiteSpace(customer)) query = query.Where(record => record.Customer == customer);
    if (!string.IsNullOrWhiteSpace(location)) query = query.Where(record => record.InspectionLocation == location);
    if (!string.IsNullOrWhiteSpace(q))
    {
        var keyword = q.Trim();
        query = query.Where(record => record.ContractNumber.Contains(keyword) || record.CustomerPo.Contains(keyword) ||
            record.ItemNumber.Contains(keyword) || record.Customer.Contains(keyword) || record.ProductName.Contains(keyword));
    }
    var total = await query.CountAsync(cancellationToken);
    var records = await query
        .OrderByDescending(record => record.InspectionDate).ThenByDescending(record => record.Id)
        .Skip((pageNumber - 1) * pageSize).Take(pageSize).ToListAsync(cancellationToken);
    var totalPages = Math.Max((int)Math.Ceiling(total / (double)pageSize), 1);
    var latestScheduleBatchId = await db.ScheduleImportBatches.AsNoTracking()
        .Where(batch => batch.Status == "已完成" && batch.ActualNewCount > 0)
        .OrderByDescending(batch => batch.Id).Select(batch => (long?)batch.Id).FirstOrDefaultAsync(cancellationToken);
    return Results.Ok(new { site, month = selectedMonth, months, customers, locations, page = pageNumber, pageSize, total, totalPages, latestScheduleBatchId, items = records });
}).RequireAuthorization("QcRead");

app.MapGet("/api/legacy-inspections/export", async (string site, string? template, string? month, string? from,
    string? to, string? q, string? status, string? customer, string? location, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!CanAccessSite(principal, site)) return Results.Forbid();
    if (site is not ("兴信" or "湖南" or "华登")) return Results.BadRequest(new { error = "厂区必须是兴信、湖南或华登" });
    var selectedTemplate = site == "华登" && template == "JAZ专用" ? "JAZ专用" : "普通验货";
    var query = db.InspectionRecords.AsNoTracking().Where(record => record.Site == site);
    if (site == "华登" && selectedTemplate == "JAZ专用")
        query = query.Where(record => record.ScheduleSource == "JAZ/JWC" || EF.Functions.Like(record.Customer, "%JAZ%") || EF.Functions.Like(record.InspectionParty, "%JAZ%"));
    else if (site == "华登")
        query = query.Where(record => record.ScheduleSource != "JAZ/JWC" && !EF.Functions.Like(record.Customer, "%JAZ%") && !EF.Functions.Like(record.InspectionParty, "%JAZ%"));

    if (!string.IsNullOrWhiteSpace(month))
    {
        if (!DateTime.TryParseExact(month, "yyyy-MM", null, System.Globalization.DateTimeStyles.None, out var monthStart))
            return Results.BadRequest(new { error = "月份格式应为yyyy-MM" });
        var monthEnd = monthStart.AddMonths(1);
        query = query.Where(record => record.InspectionDate >= monthStart && record.InspectionDate < monthEnd);
    }
    if (!string.IsNullOrWhiteSpace(from))
    {
        if (!DateTime.TryParseExact(from, "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out var fromDate))
            return Results.BadRequest(new { error = "开始日期格式应为yyyy-MM-dd" });
        query = query.Where(record => record.InspectionDate >= fromDate);
    }
    if (!string.IsNullOrWhiteSpace(to))
    {
        if (!DateTime.TryParseExact(to, "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out var toDate))
            return Results.BadRequest(new { error = "结束日期格式应为yyyy-MM-dd" });
        var toExclusive = toDate.AddDays(1);
        query = query.Where(record => record.InspectionDate < toExclusive);
    }
    if (!string.IsNullOrWhiteSpace(status)) query = query.Where(record => record.WorkflowStatus == status);
    if (!string.IsNullOrWhiteSpace(customer)) query = query.Where(record => record.Customer == customer);
    if (!string.IsNullOrWhiteSpace(location)) query = query.Where(record => record.InspectionLocation == location);
    if (!string.IsNullOrWhiteSpace(q))
    {
        var keyword = q.Trim();
        query = query.Where(record => record.ContractNumber.Contains(keyword) || record.CustomerPo.Contains(keyword) ||
            record.ItemNumber.Contains(keyword) || record.Customer.Contains(keyword) || record.ProductName.Contains(keyword));
    }

    var records = await query.OrderBy(record => record.InspectionDate).ThenBy(record => record.Id).ToListAsync(cancellationToken);
    var bytes = InspectionExportService.Create(records, site, selectedTemplate);
    var range = string.IsNullOrWhiteSpace(month) ? "全部" : month;
    var kind = site == "华登" ? selectedTemplate : "验货总结";
    return Results.File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        $"{site}-{kind}-{range}-{DateTime.Now:yyyyMMddHHmm}.xlsx");
}).RequireAuthorization("QcRead");
app.MapPost("/api/inspections", async (InspectionWriteRequest request, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!CanAccessSite(principal, request.Site)) return Results.Forbid();
    if (request.Site is not ("兴信" or "湖南" or "华登")) return Results.BadRequest(new { error = "厂区必须是兴信、湖南或华登" });
    if (request.InspectionDate is null) return Results.BadRequest(new { error = "请选择验货日期" });
    if (string.IsNullOrWhiteSpace(request.ItemNumber) && string.IsNullOrWhiteSpace(request.ContractNumber) && string.IsNullOrWhiteSpace(request.CustomerPo))
        return Results.BadRequest(new { error = "货号、合同编号和客户PO至少填写一项" });
    var record = new InspectionRecord
    {
        PlanId = $"PLAN-{Guid.NewGuid():N}", Site = request.Site, Fingerprint = $"MANUAL-{Guid.NewGuid():N}", SourceFile = "系统新建", SourceSheet = "临时计划", SourceRow = 0,
    };
    ApplyInspectionWrite(record, request, db);
    record.WorkflowStatus = ResultStatus(record.InternalResult, record.ThirdPartyResult);
    db.InspectionRecords.Add(record);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Created($"/api/inspections/{record.Id}", record);
}).RequireAuthorization("QcWrite");

app.MapPut("/api/inspections/{id:long}", async (long id, InspectionWriteRequest request, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    var record = await db.InspectionRecords.FirstOrDefaultAsync(value => value.Id == id, cancellationToken);
    if (record is null) return Results.NotFound(new { error = "验货计划不存在" });
    if (!CanAccessSite(principal, record.Site) || !CanAccessSite(principal, request.Site)) return Results.Forbid();
    if (request.Site is not ("兴信" or "湖南" or "华登")) return Results.BadRequest(new { error = "厂区必须是兴信、湖南或华登" });
    if (request.InspectionDate is null) return Results.BadRequest(new { error = "请选择验货日期" });
    if (record.InternalResult != (request.InternalResult?.Trim() ?? "") || record.ThirdPartyResult != (request.ThirdPartyResult?.Trim() ?? "") ||
        record.HoldRejectReason != (request.HoldRejectReason?.Trim() ?? "") ||
        HasInspectionResult(record) && record.Note != (request.Note?.Trim() ?? ""))
        return Results.BadRequest(new { error = "验货结果请通过填写结果入口修改" });
    ApplyInspectionWrite(record, request, db);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(record);
}).RequireAuthorization("QcWrite");

app.MapPost("/api/inspections/bulk-update", async (InspectionBulkUpdateRequest request, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    var items = request.Items ?? [];
    if (items.Length == 0) return Results.BadRequest(new { error = "没有需要保存的修改" });
    if (items.Length > 100) return Results.BadRequest(new { error = "单次最多保存100条验货计划" });
    var ids = items.Select(item => item.Id).Distinct().ToArray();
    if (ids.Length != items.Length) return Results.BadRequest(new { error = "提交内容包含重复的验货计划" });
    var records = await db.InspectionRecords.Where(record => ids.Contains(record.Id)).ToDictionaryAsync(record => record.Id, cancellationToken);
    if (records.Count != ids.Length) return Results.NotFound(new { error = "部分验货计划不存在或已删除，请刷新后重试" });
    foreach (var item in items)
    {
        var record = records[item.Id]; var values = item.Values;
        if (!CanAccessSite(principal, record.Site) || !CanAccessSite(principal, values.Site)) return Results.Forbid();
        if (values.Site is not ("兴信" or "湖南" or "华登")) return Results.BadRequest(new { error = $"计划 {record.ItemNumber} 尚未选择有效厂区" });
        if (values.InspectionDate is null) return Results.BadRequest(new { error = $"计划 {record.ItemNumber} 未填写验货日期" });
        if (string.IsNullOrWhiteSpace(values.ItemNumber) && string.IsNullOrWhiteSpace(values.ContractNumber) && string.IsNullOrWhiteSpace(values.CustomerPo))
            return Results.BadRequest(new { error = $"计划 {record.Id} 的货号、合同编号和客户PO至少填写一项" });
        if (values.Quantity is < 0 || values.Cartons is < 0 || values.PackingQuantity is < 0)
            return Results.BadRequest(new { error = $"计划 {record.ItemNumber} 的数量和箱数不能为负数" });
        if (record.ImportedAt.ToUniversalTime() != item.ExpectedImportedAt.ToUniversalTime())
            return Results.Conflict(new { error = $"计划 {record.ItemNumber} 已被其他人修改，请刷新后重新编辑" });
        if (record.InternalResult != (values.InternalResult?.Trim() ?? "") || record.ThirdPartyResult != (values.ThirdPartyResult?.Trim() ?? "") ||
            record.HoldRejectReason != (values.HoldRejectReason?.Trim() ?? "") || HasInspectionResult(record) && record.Note != (values.Note?.Trim() ?? ""))
            return Results.BadRequest(new { error = $"计划 {record.ItemNumber} 的验货结果不能通过表格直接修改" });
    }
    foreach (var item in items) ApplyInspectionWrite(records[item.Id], item.Values, db);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { updated = items.Length });
}).RequireAuthorization("QcWrite");

app.MapPut("/api/inspections/{id:long}/result", async (long id, InspectionResultRequest request, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    var record = await db.InspectionRecords.FirstOrDefaultAsync(value => value.Id == id, cancellationToken);
    if (record is null) return Results.NotFound(new { error = "验货计划不存在" });
    if (!CanAccessSite(principal, record.Site)) return Results.Forbid();
    var requestedInternal = request.InternalResult?.Trim() ?? string.Empty;
    var requestedThirdParty = request.ThirdPartyResult?.Trim() ?? string.Empty;
    if (record.WorkflowStatus == "待审批") return Results.Conflict(new { error = "该记录已有待审批的结果修改" });
    var hasExistingResult = HasInspectionResult(record);
    var resultChanged = record.InternalResult != requestedInternal || record.ThirdPartyResult != requestedThirdParty ||
        record.HoldRejectReason != (request.HoldRejectReason?.Trim() ?? "") || record.Note != (request.Note?.Trim() ?? "");
    if (hasExistingResult && resultChanged)
    {
        var existingPending = await db.InspectionResultApprovals.FirstOrDefaultAsync(value => value.InspectionRecordId == id && value.Status == "待审批", cancellationToken);
        if (existingPending is not null) return Results.Conflict(new { error = "该记录已有待审批的结果修改" });
        db.InspectionResultApprovals.Add(new InspectionResultApproval
        {
            InspectionRecordId = id, Site = record.Site, PreviousInternalResult = record.InternalResult,
            PreviousThirdPartyResult = record.ThirdPartyResult, RequestedInternalResult = requestedInternal,
            RequestedThirdPartyResult = requestedThirdParty, RequestedHoldRejectReason = request.HoldRejectReason?.Trim() ?? string.Empty,
            RequestedNote = request.Note?.Trim() ?? string.Empty, RequestedBy = principal.Identity?.Name ?? "未知用户",
        });
        record.WorkflowStatus = "待审批";
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { pendingApproval = true, status = record.WorkflowStatus });
    }
    record.InternalResult = requestedInternal;
    record.ThirdPartyResult = requestedThirdParty;
    record.HoldRejectReason = request.HoldRejectReason?.Trim() ?? string.Empty;
    record.Note = request.Note?.Trim() ?? string.Empty;
    record.WorkflowStatus = ResultStatus(record.InternalResult, record.ThirdPartyResult);
    if (record.WorkflowStatus == "待复检") AddReinspectionAlert(db, record);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { pendingApproval = false, status = record.WorkflowStatus });
}).RequireAuthorization("QcWrite");

app.MapGet("/api/inspection-overview", async (string? site, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!string.IsNullOrWhiteSpace(site) && !CanAccessSite(principal, site)) return Results.Forbid();
    var allowedSites = new[] { "兴信", "湖南", "华登", "待分配" }.Where(value => CanAccessSite(principal, value)).ToArray();
    var totals = await db.InspectionRecords.AsNoTracking().Where(value => allowedSites.Contains(value.Site)).GroupBy(value => value.Site)
        .Select(group => new { site = group.Key, count = group.Count() }).ToDictionaryAsync(value => value.site, value => value.count, cancellationToken);
    var statusCounts = await db.InspectionRecords.AsNoTracking()
        .Where(value => allowedSites.Contains(value.Site) && (site == null || site == "" || value.Site == site))
        .GroupBy(value => value.WorkflowStatus).Select(group => new { status = group.Key, count = group.Count() })
        .ToDictionaryAsync(value => value.status, value => value.count, cancellationToken);
    var alertsQuery = db.InspectionAlerts.AsNoTracking().Where(value => value.Status == "待处理" && allowedSites.Contains(value.Site));
    if (!string.IsNullOrWhiteSpace(site)) alertsQuery = alertsQuery.Where(value => value.Site == site);
    var alerts = await alertsQuery.GroupBy(value => value.Type).Select(group => new { type = group.Key, count = group.Count() })
        .ToDictionaryAsync(value => value.type, value => value.count, cancellationToken);
    var pendingApprovals = await db.InspectionResultApprovals.AsNoTracking().CountAsync(value => value.Status == "待审批" && allowedSites.Contains(value.Site) && (site == null || site == "" || value.Site == site), cancellationToken);
    return Results.Ok(new { totals, statusCounts, alerts, pendingApprovals });
}).RequireAuthorization("QcRead");

app.MapGet("/api/inspection-alerts", async (string site, string? type, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!CanAccessSite(principal, site)) return Results.Forbid();
    var query = db.InspectionAlerts.AsNoTracking().Where(value => value.Site == site && value.Status == "待处理");
    if (!string.IsNullOrWhiteSpace(type)) query = query.Where(value => value.Type == type);
    return Results.Ok(await query.OrderByDescending(value => value.Id).Take(200).ToListAsync(cancellationToken));
}).RequireAuthorization("QcRead");

app.MapPost("/api/inspection-alerts/{id:long}/resolve", async (long id, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    var alert = await db.InspectionAlerts.FirstOrDefaultAsync(value => value.Id == id, cancellationToken);
    if (alert is null) return Results.NotFound(new { error = "提醒不存在" });
    if (!CanAccessSite(principal, alert.Site)) return Results.Forbid();
    alert.Status = "已处理"; alert.HandledBy = principal.Identity?.Name ?? "未知用户"; alert.HandledAt = DateTime.UtcNow;
    await db.SaveChangesAsync(cancellationToken); return Results.NoContent();
}).RequireAuthorization("QcWrite");

app.MapGet("/api/inspection-approvals", async (string? site, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!string.IsNullOrWhiteSpace(site) && !CanAccessSite(principal, site)) return Results.Forbid();
    var allowedSites = new[] { "兴信", "湖南", "华登", "待分配" }.Where(value => CanAccessSite(principal, value)).ToArray();
    var query = db.InspectionResultApprovals.AsNoTracking().Where(value => value.Status == "待审批" && allowedSites.Contains(value.Site));
    if (!string.IsNullOrWhiteSpace(site)) query = query.Where(value => value.Site == site);
    return Results.Ok(await query.OrderByDescending(value => value.Id).Take(200).ToListAsync(cancellationToken));
}).RequireAuthorization("QcRead");

app.MapPost("/api/inspection-approvals/{id:long}/review", async (long id, ApprovalReviewRequest request, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    var role = principal.FindFirstValue(ClaimTypes.Role);
    if (role is not ("管理员" or "QC主管")) return Results.Forbid();
    var approval = await db.InspectionResultApprovals.FirstOrDefaultAsync(value => value.Id == id && value.Status == "待审批", cancellationToken);
    if (approval is null) return Results.NotFound(new { error = "待审批记录不存在" });
    if (!CanAccessSite(principal, approval.Site)) return Results.Forbid();
    var record = await db.InspectionRecords.FirstOrDefaultAsync(value => value.Id == approval.InspectionRecordId, cancellationToken);
    if (record is null) return Results.NotFound(new { error = "验货计划不存在" });
    approval.Status = request.Approved ? "已通过" : "已驳回"; approval.ReviewedBy = principal.Identity?.Name ?? "未知用户";
    approval.ReviewedAt = DateTime.UtcNow; approval.ReviewComment = request.Comment?.Trim() ?? string.Empty;
    if (request.Approved)
    {
        record.InternalResult = approval.RequestedInternalResult; record.ThirdPartyResult = approval.RequestedThirdPartyResult;
        record.HoldRejectReason = approval.RequestedHoldRejectReason; record.Note = approval.RequestedNote;
        record.WorkflowStatus = ResultStatus(record.InternalResult, record.ThirdPartyResult);
        if (record.WorkflowStatus == "待复检") AddReinspectionAlert(db, record);
    }
    else record.WorkflowStatus = ResultStatus(record.InternalResult, record.ThirdPartyResult);
    await db.SaveChangesAsync(cancellationToken); return Results.NoContent();
}).RequireAuthorization("QcWrite");

app.MapDelete("/api/inspections/{id:long}", async (long id, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    var record = await db.InspectionRecords.FirstOrDefaultAsync(value => value.Id == id, cancellationToken);
    if (record is null) return Results.NotFound(new { error = "验货计划不存在或已删除" });
    if (!CanAccessSite(principal, record.Site)) return Results.Forbid();
    if (HasInspectionResult(record) && !principal.IsInRole("管理员") && !principal.IsInRole("Admin"))
        return Results.Forbid();
    if (await db.InspectionResultApprovals.AnyAsync(value => value.InspectionRecordId == id && value.Status == "待审批", cancellationToken))
        return Results.Conflict(new { error = "有待审批结果的计划不能删除" });
    db.InspectionRecords.Remove(record);
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
}).RequireAuthorization("QcWrite");
app.MapPost("/api/inspections/bulk-delete", async (InspectionBulkDeleteRequest request, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    var ids = (request.Ids ?? []).Distinct().ToArray();
    if (ids.Length == 0) return Results.BadRequest(new { error = "请至少选择一条验货计划" });
    if (ids.Length > 100) return Results.BadRequest(new { error = "单次最多删除100条验货计划" });
    var records = await db.InspectionRecords.Where(value => ids.Contains(value.Id)).ToListAsync(cancellationToken);
    if (records.Count != ids.Length) return Results.NotFound(new { error = "部分验货计划不存在或已被删除，请刷新后重试" });
    if (records.Any(record => !CanAccessSite(principal, record.Site))) return Results.Forbid();
    if (!principal.IsInRole("管理员") && !principal.IsInRole("Admin") && records.Any(HasInspectionResult))
        return Results.Forbid();
    if (await db.InspectionResultApprovals.AnyAsync(value => ids.Contains(value.InspectionRecordId) && value.Status == "待审批", cancellationToken))
        return Results.Conflict(new { error = "所选计划中存在待审批结果，不能批量删除" });
    db.InspectionRecords.RemoveRange(records);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { deleted = records.Count });
}).RequireAuthorization("QcWrite");
app.MapGet("/api/users", async (AppDbContext db, CancellationToken cancellationToken) =>
    Results.Ok(await db.Users.AsNoTracking().OrderBy(user => user.Id).Select(user => new
    {
        user.Id, user.Username, user.DisplayName, user.Department, user.Role, user.DataScope, user.IsActive, user.CreatedAt,
    }).ToListAsync(cancellationToken))).RequireAuthorization("AdminOnly");

app.MapPost("/api/users", async (UserCreateRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    var error = ValidateUser(request.Username, request.DisplayName, request.Role, request.Password);
    if (error is not null) return Results.BadRequest(new { error });
    error = ValidateUserScope(request.Role, request.DataScope);
    if (error is not null) return Results.BadRequest(new { error });
    var username = request.Username.Trim();
    if (await db.Users.AnyAsync(user => user.Username == username, cancellationToken))
        return Results.Conflict(new { error = "该账号已经存在" });
    var user = new User
    {
        Username = username,
        DisplayName = request.DisplayName.Trim(),
        Department = request.Department.Trim(),
        Role = request.Role,
        DataScope = request.DataScope.Trim(),
        IsActive = true,
        PasswordHash = PasswordService.Hash(request.Password),
    };
    db.Users.Add(user);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Created($"/api/users/{user.Id}", new { user.Id });
}).RequireAuthorization("AdminOnly");

app.MapPut("/api/users/{id:long}", async (long id, UserUpdateRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    var error = ValidateUser("unchanged", request.DisplayName, request.Role, "unchanged-password");
    if (error is not null) return Results.BadRequest(new { error });
    error = ValidateUserScope(request.Role, request.DataScope);
    if (error is not null) return Results.BadRequest(new { error });
    var user = await db.Users.FirstOrDefaultAsync(value => value.Id == id, cancellationToken);
    if (user is null) return Results.NotFound(new { error = "用户不存在" });
    user.DisplayName = request.DisplayName.Trim();
    user.Department = request.Department.Trim();
    user.Role = request.Role;
    user.DataScope = request.DataScope.Trim();
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
}).RequireAuthorization("AdminOnly");

app.MapPost("/api/users/{id:long}/status", async (long id, UserStatusRequest request, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    var user = await db.Users.FirstOrDefaultAsync(value => value.Id == id, cancellationToken);
    if (user is null) return Results.NotFound(new { error = "用户不存在" });
    if (principal.FindFirstValue(JwtRegisteredClaimNames.Sub) == id.ToString() && !request.IsActive)
        return Results.BadRequest(new { error = "不能停用当前登录账号" });
    user.IsActive = request.IsActive;
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
}).RequireAuthorization("AdminOnly");

app.MapPost("/api/users/{id:long}/reset-password", async (long id, PasswordResetRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.NewPassword) || request.NewPassword.Length < 8)
        return Results.BadRequest(new { error = "新密码至少需要8位" });
    var user = await db.Users.FirstOrDefaultAsync(value => value.Id == id, cancellationToken);
    if (user is null) return Results.NotFound(new { error = "用户不存在" });
    user.PasswordHash = PasswordService.Hash(request.NewPassword);
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
}).RequireAuthorization("AdminOnly");
app.MapPost("/api/auth/login", async (LoginRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
        return Results.BadRequest(new { error = "请输入账号和密码" });

    var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(
        value => value.Username == request.Username.Trim() && value.IsActive, cancellationToken);
    if (user is null || !PasswordService.Verify(request.Password, user.PasswordHash))
        return Results.Json(new { error = "账号或密码不正确" }, statusCode: StatusCodes.Status401Unauthorized);

    var claims = new[]
    {
        new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
        new Claim(JwtRegisteredClaimNames.UniqueName, user.Username),
        new Claim(ClaimTypes.Name, user.DisplayName),
        new Claim(ClaimTypes.Role, user.Role),
        new Claim("scope", user.DataScope),
    };
    var expiresAt = request.RememberMe ? DateTime.UtcNow.AddDays(30) : DateTime.UtcNow.AddHours(8);
    var token = new JwtSecurityToken("QcInspection.Api", "QcInspection.Web", claims,
        expires: expiresAt,
        signingCredentials: new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)), SecurityAlgorithms.HmacSha256));
    return Results.Ok(new
    {
        accessToken = new JwtSecurityTokenHandler().WriteToken(token),
        expiresAt,
        user = new { user.Id, user.Username, user.DisplayName, user.Department, user.Role, user.DataScope },
    });
});
app.MapGet("/api/auth/me", (ClaimsPrincipal principal) => Results.Ok(new
{
    username = principal.FindFirstValue(JwtRegisteredClaimNames.UniqueName),
    displayName = principal.FindFirstValue(ClaimTypes.Name),
    role = principal.FindFirstValue(ClaimTypes.Role),
    dataScope = principal.FindFirstValue("scope"),
})).RequireAuthorization();

app.Run();
static string InspectionOrderKey(InspectionRecord record)
{
    var stable = string.Join('|', record.ContractNumber.Trim(), record.CustomerPo.Trim(), record.ItemNumber.Trim());
    return stable.Replace(" ", string.Empty).ToUpperInvariant();
}

static string ScheduleOrderKey(ZuruScheduleRow row)
{
    var stable = string.Join('|', row.PoNumber.Trim(), row.CustomerPo.Trim(), row.ItemNumber.Trim());
    return stable.Replace(" ", string.Empty).ToUpperInvariant();
}

static bool HasInspectionResult(InspectionRecord record) =>
    IsFinalInspectionResult(record.InternalResult) || IsFinalInspectionResult(record.ThirdPartyResult);

static bool IsFinalInspectionResult(string? value)
{
    var result = value?.Trim().ToUpperInvariant() ?? "";
    return result is "PASS" or "HOLD" or "REJ" or "AOD" or "LG" or "AOD+LG" or "不用验" or "待复检";
}

static InspectionRecord? MatchScheduleRecord(IEnumerable<InspectionRecord> records, ZuruScheduleRow row,
    string source, out bool ambiguous)
{
    ambiguous = false;
    var scoped = records.Where(record => record.ScheduleSource == source ||
        record.ScheduleSource == "" && (row.Customer == "" ||
            string.Equals(record.Customer.Trim(), row.Customer.Trim(), StringComparison.OrdinalIgnoreCase))).ToArray();
    var exact = scoped.Where(record => record.ScheduleKey == row.BusinessKey).ToArray();
    if (exact.Length == 1) return exact[0];
    if (exact.Length > 1) { ambiguous = true; return null; }
    var order = scoped.Where(record => InspectionOrderKey(record) == ScheduleOrderKey(row)).ToArray();
    if (order.Length == 1) return order[0];
    if (order.Length > 1) { ambiguous = true; return null; }
    var po = row.PoNumber.Replace(" ", "").ToUpperInvariant();
    var item = row.ItemNumber.Replace(" ", "").ToUpperInvariant();
    if (po == "" || item == "") return null;
    var partial = scoped.Where(record => record.ContractNumber.Replace(" ", "").ToUpperInvariant() == po &&
        record.ItemNumber.Replace(" ", "").ToUpperInvariant() == item).ToArray();
    if (partial.Length == 1) return partial[0];
    ambiguous = partial.Length > 1;
    return null;
}

static void AddImportAlerts(AppDbContext db, InspectionRecord current, InspectionRecord incoming)
{
    if (current.InspectionDate?.Date != incoming.InspectionDate?.Date)
        db.InspectionAlerts.Add(new InspectionAlert
        {
            InspectionRecordId = current.Id, Site = current.Site, Type = "验货期变更",
            Summary = $"{current.ItemNumber}：{current.InspectionDate:yyyy-MM-dd} → {incoming.InspectionDate:yyyy-MM-dd}",
            BeforeJson = JsonSerializer.Serialize(new { current.InspectionDate }),
            AfterJson = JsonSerializer.Serialize(new { incoming.InspectionDate }),
        });
    var before = new { current.Customer, current.ProductName, current.Quantity, current.Cartons };
    var after = new { incoming.Customer, incoming.ProductName, incoming.Quantity, incoming.Cartons };
    if (!Equals(current.Customer, incoming.Customer) || !Equals(current.ProductName, incoming.ProductName) || current.Quantity != incoming.Quantity || current.Cartons != incoming.Cartons)
        db.InspectionAlerts.Add(new InspectionAlert
        {
            InspectionRecordId = current.Id, Site = current.Site, Type = "订单信息变更",
            Summary = $"{current.ItemNumber}：客户、产品、数量或箱数发生变化",
            BeforeJson = JsonSerializer.Serialize(before), AfterJson = JsonSerializer.Serialize(after),
        });
}

static string ResultStatus(string internalResult, string thirdPartyResult)
{
    var values = new[] { internalResult?.Trim() ?? string.Empty, thirdPartyResult?.Trim() ?? string.Empty };
    if (values.Contains("待复检")) return "待复检";
    if (values.Contains("REJ")) return "REJ";
    if (values.Contains("HOLD")) return "HOLD";
    if (values.Any(value => value == "不用验")) return "不用验";
    return values.Any(IsFinalInspectionResult) ? "已完成" : "待验货";
}

static bool CanAccessSite(ClaimsPrincipal principal, string site)
{
    if (principal.IsInRole("管理员") || principal.IsInRole("Admin")) return true;
    var scope = principal.FindFirstValue("scope") ?? "";
    return scope.Contains("全部厂区", StringComparison.Ordinal) ||
        site switch
        {
            "兴信" => scope.Contains("兴信", StringComparison.Ordinal),
            "湖南" => scope.Contains("湖南", StringComparison.Ordinal),
            "华登" => scope.Contains("华登", StringComparison.Ordinal),
            "待分配" => principal.IsInRole("QC主管"),
            _ => false,
        };
}

static void AddReinspectionAlert(AppDbContext db, InspectionRecord record)
{
    var exists = db.InspectionAlerts.Local.Any(value => value.InspectionRecordId == record.Id && value.Type == "待复检" && value.Status == "待处理")
        || db.InspectionAlerts.Any(value => value.InspectionRecordId == record.Id && value.Type == "待复检" && value.Status == "待处理");
    if (!exists) db.InspectionAlerts.Add(new InspectionAlert
    {
        InspectionRecordId = record.Id, Site = record.Site, Type = "待复检", Summary = $"{record.ItemNumber} 需要安排复检",
        BeforeJson = "{}", AfterJson = JsonSerializer.Serialize(new { record.InternalResult, record.ThirdPartyResult }),
    });
}

static void ApplyImportedRecord(InspectionRecord target, InspectionRecord source)
{
    // Order fields refresh; existing manually-entered QC values remain authoritative.
    target.InspectionDate = source.InspectionDate; target.Customer = source.Customer;
    target.ProductName = source.ProductName; target.Quantity = source.Quantity; target.Cartons = source.Cartons;
    if (string.IsNullOrWhiteSpace(target.InspectionLocation)) target.InspectionLocation = source.InspectionLocation;
    if (string.IsNullOrWhiteSpace(target.InspectionParty)) target.InspectionParty = source.InspectionParty;
    if (string.IsNullOrWhiteSpace(target.ThirdPartyOrganization)) target.ThirdPartyOrganization = source.ThirdPartyOrganization;
    if (string.IsNullOrWhiteSpace(target.InternalResult)) target.InternalResult = source.InternalResult;
    if (string.IsNullOrWhiteSpace(target.ThirdPartyResult)) target.ThirdPartyResult = source.ThirdPartyResult;
    if (string.IsNullOrWhiteSpace(target.HoldRejectReason)) target.HoldRejectReason = source.HoldRejectReason;
    if (string.IsNullOrWhiteSpace(target.Note)) target.Note = source.Note;
    if (target.WorkflowStatus != "待审批") target.WorkflowStatus = ResultStatus(target.InternalResult, target.ThirdPartyResult);
    target.SourceFile = source.SourceFile;
    target.SourceSheet = source.SourceSheet;
    target.SourceRow = source.SourceRow;
    target.ImportedAt = DateTime.UtcNow;
}

static void ApplyInspectionWrite(InspectionRecord target, InspectionWriteRequest source, AppDbContext db)
{
    target.Site = source.Site; target.InspectionDate = source.InspectionDate?.Date;
    target.InspectionLocation = source.InspectionLocation?.Trim() ?? string.Empty;
    target.InspectionParty = source.InspectionParty?.Trim() ?? string.Empty;
    target.ThirdPartyOrganization = source.ThirdPartyOrganization?.Trim() ?? string.Empty;
    target.Customer = source.Customer?.Trim() ?? string.Empty;
    target.ContractNumber = source.ContractNumber?.Trim() ?? string.Empty;
    target.CustomerPo = source.CustomerPo?.Trim() ?? string.Empty;
    target.ItemNumber = source.ItemNumber?.Trim() ?? string.Empty;
    target.ProductName = source.ProductName?.Trim() ?? string.Empty;
    target.Quantity = source.Quantity;
    target.Cartons = source.Quantity is not null && source.PackingQuantity is > 0
        ? Math.Ceiling(source.Quantity.Value / source.PackingQuantity.Value)
        : source.Cartons;
    target.InternalResult = source.InternalResult?.Trim() ?? string.Empty;
    target.ThirdPartyResult = source.ThirdPartyResult?.Trim() ?? string.Empty;
    target.HoldRejectReason = source.HoldRejectReason?.Trim() ?? string.Empty;
    target.ProductionWorkshop = source.ProductionWorkshop?.Trim() ?? string.Empty;
    target.ProductionSupervisor = ResolveProductionSupervisor(db, target.ProductionWorkshop, source.ProductionSupervisor);
    target.ResponsibleLineLeader = source.ResponsibleLineLeader?.Trim() ?? string.Empty;
    target.ProblemSource = source.ProblemSource?.Trim() ?? string.Empty;
    target.HandlingResult = source.HandlingResult?.Trim() ?? string.Empty;
    target.TestScrap = source.TestScrap?.Trim() ?? string.Empty;
    target.PackagingSpec = source.PackagingSpec?.Trim() ?? string.Empty;
    target.PackingQuantity = source.PackingQuantity;
    target.ThirdPartyInspectionLocation = source.ThirdPartyInspectionLocation?.Trim() ?? string.Empty;
    target.Note = source.Note?.Trim() ?? string.Empty;
    target.ImportedAt = DateTime.UtcNow;
}

static string ResolveProductionSupervisor(AppDbContext db, string workshop, string? supervisor)
{
    if (!string.IsNullOrWhiteSpace(supervisor)) return supervisor.Trim();
    return db.WorkshopMappings.AsNoTracking().Where(value => value.Workshop == workshop.Trim())
        .Select(value => value.Supervisor).FirstOrDefault() ?? string.Empty;
}

static bool IsWithinScheduleImportWindow(DateTime? inspectionDate, DateTime today)
{
    if (inspectionDate is null) return true;
    var date = inspectionDate.Value.Date;
    return date >= today.Date && date <= today.Date.AddDays(21);
}

static string[] ChangedFields(InspectionRecord current, ZuruScheduleRow row)
{
    var changes = new List<string>();
    void Check<T>(string name, T before, T after) { if (!EqualityComparer<T>.Default.Equals(before, after)) changes.Add(name); }
    Check("客户名称", current.Customer, row.Customer); Check("走货国家", current.Country, row.Country);
    if (row.Site != "待分配") Check("厂区", current.Site, row.Site);
    if (!string.IsNullOrWhiteSpace(row.ProductionWorkshop)) Check("生产车间", current.ProductionWorkshop, row.ProductionWorkshop);
    if (!string.IsNullOrWhiteSpace(row.ProductName)) Check("产品名称", current.ProductName, row.ProductName);
    Check("数量", current.Quantity, row.Quantity);
    if (row.Cartons is not null) Check("箱数", current.Cartons, row.Cartons);
    if (row.PlannedShipDate is not null) Check("计划出货期", current.PlannedShipDate, row.PlannedShipDate);
    Check("计划验货期", current.InspectionDate, row.PlannedInspectionDate);
    if (!string.IsNullOrWhiteSpace(row.InspectionLocation)) Check("验货地点", current.InspectionLocation, row.InspectionLocation);
    return changes.ToArray();
}

static void ApplySchedule(InspectionRecord target, ZuruScheduleRow source, string scheduleSource, string fileName)
{
    target.ScheduleKey = source.BusinessKey; target.ScheduleSource = scheduleSource;
    target.Customer = source.Customer; target.Country = source.Country; target.ContractNumber = source.PoNumber;
    target.CustomerPo = source.CustomerPo; target.ItemNumber = source.ItemNumber;
    if (source.Site != "待分配") target.Site = source.Site;
    if (!string.IsNullOrWhiteSpace(source.ProductionWorkshop)) target.ProductionWorkshop = source.ProductionWorkshop;
    if (!string.IsNullOrWhiteSpace(source.ProductName)) target.ProductName = source.ProductName;
    target.Quantity = source.Quantity; if (source.Cartons is not null) target.Cartons = source.Cartons;
    if (source.PlannedShipDate is not null) target.PlannedShipDate = source.PlannedShipDate;
    target.InspectionDate = source.PlannedInspectionDate;
    if (!string.IsNullOrWhiteSpace(source.InspectionLocation)) target.InspectionLocation = source.InspectionLocation;
    target.SourceFile = fileName; target.SourceSheet = source.Sheet; target.SourceRow = source.Row;
    target.ScheduleUpdatedAt = DateTime.UtcNow; target.ImportedAt = DateTime.UtcNow;
}

static string? ValidateUser(string username, string displayName, string role, string password)
{
    string[] roles = ["管理员", "QC主管", "QC文员", "排期员"];
    if (string.IsNullOrWhiteSpace(username) || username.Trim().Length < 3) return "账号至少需要3个字符";
    if (string.IsNullOrWhiteSpace(displayName)) return "请输入姓名";
    if (!roles.Contains(role)) return "用户角色无效";
    if (string.IsNullOrWhiteSpace(password) || password.Length < 8) return "密码至少需要8位";
    return null;
}

static string? ValidateUserScope(string role, string scope)
{
    if (role is "管理员" && scope != "全部厂区及系统设置") return "管理员应使用全部厂区及系统设置范围";
    if (role is "排期员" && scope != "排期导入与记录") return "排期员应使用排期导入与记录范围";
    if (role is "QC主管" or "QC文员" && scope is not ("兴信、湖南" or "华登" or "全部厂区及系统设置"))
        return "请选择QC可管理的厂区范围";
    return null;
}

public sealed record LoginRequest(string Username, string Password, bool RememberMe = false);
public sealed record UserCreateRequest(string Username, string DisplayName, string Department, string Role, string DataScope, string Password);
public sealed record UserUpdateRequest(string DisplayName, string Department, string Role, string DataScope);
public sealed record UserStatusRequest(bool IsActive);
public sealed record PasswordResetRequest(string NewPassword);
public sealed record ZuruPreviewItem(ZuruScheduleRow Row, string Kind, string[] Changes);
public sealed record ScheduleImportConfirmRequest(string[]? SelectedKeys, string[]? SelectedPendingKeys);
public sealed record InspectionResultRequest(string? InternalResult, string? ThirdPartyResult, string? HoldRejectReason, string? Note);
public sealed record InspectionBulkDeleteRequest(long[]? Ids);
public sealed record InspectionBulkUpdateItem(long Id, DateTime ExpectedImportedAt, InspectionWriteRequest Values);
public sealed record InspectionBulkUpdateRequest(InspectionBulkUpdateItem[]? Items);
public sealed record ApprovalReviewRequest(bool Approved, string? Comment);
public sealed record WorkshopMappingRequest(string Workshop, string Supervisor);
public sealed record ShippingBatchRequest(ShippingLookupItem?[]? Items);
public sealed record ShippingLookupItem(string? ContractNumber, string? CustomerPo, string? ItemNumber);
public sealed record InspectionWriteRequest(string Site, DateTime? InspectionDate, string? InspectionLocation,
    string? InspectionParty, string? ThirdPartyOrganization, string? Customer, string? ContractNumber,
    string? CustomerPo, string? ItemNumber, string? ProductName, decimal? Quantity, decimal? Cartons,
    string? InternalResult, string? ThirdPartyResult, string? HoldRejectReason, string? ProductionWorkshop,
    string? ProductionSupervisor, string? ResponsibleLineLeader, string? ProblemSource, string? HandlingResult,
    string? TestScrap, string? PackagingSpec, decimal? PackingQuantity, string? ThirdPartyInspectionLocation, string? Note);
