using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using StitchCostPro.Api.Features.Auth;
using StitchCostPro.Api.Features.Depts;
using StitchCostPro.Api.Features.Products;
using StitchCostPro.Api.Features.PurchaseOrders;
using StitchCostPro.Api.Features.RateConfigs;
using StitchCostPro.Api.Features.Suppliers;
using StitchCostPro.Api.Shared;

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseWindowsService(options => options.ServiceName = "StitchCostPro");

// —— 数据访问：本地安装版继续使用 SQL Server；门户部署通过配置切换到 PostgreSQL。——
var databaseProvider = builder.Configuration["Database:Provider"] ?? "SqlServer";
var databaseConnectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("缺少连接串 ConnectionStrings:Default");
builder.Services.AddDbContext<AppDbContext>(opt =>
{
    if (databaseProvider.Equals("PostgreSQL", StringComparison.OrdinalIgnoreCase))
        opt.UseNpgsql(databaseConnectionString);
    else
        opt.UseSqlServer(databaseConnectionString);
});
builder.Services.AddSingleton<IDbConnectionFactory, DapperConnectionFactory>();

// —— 当前用户 / 审计 ——
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();

// —— 各模块服务（一模块一套 Controller/Service）——
builder.Services.AddSingleton<JwtTokenService>();
builder.Services.AddScoped<DeptService>();
builder.Services.AddScoped<StitchCostPro.Api.Features.Users.UserService>();
builder.Services.AddScoped<ProductService>();
builder.Services.AddScoped<ProductQuoteService>();
builder.Services.AddScoped<ProductImportService>();
builder.Services.AddScoped<PurchaseOrderService>();
builder.Services.AddScoped<PurchaseOrderImportService>();
builder.Services.AddScoped<StitchCostPro.Api.Features.OrderPricing.OrderPricingService>();
builder.Services.AddScoped<StitchCostPro.Api.Features.DeliveryNotes.DeliveryNoteService>();
builder.Services.AddScoped<StitchCostPro.Api.Features.QualityInspections.QualityInspectionService>();
builder.Services.AddScoped<StitchCostPro.Api.Features.SupplierEvaluation.SupplierEvaluationService>();
builder.Services.AddScoped<StitchCostPro.Api.Features.PriceBoard.PriceBoardService>();
builder.Services.AddScoped<SupplierService>();
builder.Services.AddScoped<SupplierImportService>();
builder.Services.AddScoped<RateConfigService>();

// —— 认证：JWT ——
var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>()
    ?? throw new InvalidOperationException("缺少 Jwt 配置");
if (!builder.Environment.IsDevelopment() && jwt.Secret.Contains("CHANGE_ME", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("生产环境必须通过 Jwt__Secret 配置独立强密钥，禁止使用开发占位密钥。");
if (Encoding.UTF8.GetByteCount(jwt.Secret) < 32)
    throw new InvalidOperationException("Jwt 密钥长度不能少于 32 字节。");
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opt =>
    {
        opt.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwt.Issuer,
            ValidAudience = jwt.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Secret)),
            ClockSkew = TimeSpan.FromMinutes(1),
        };
    });
builder.Services.AddAuthorization();

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "车缝核价对比系统 API", Version = "v1" });
    var scheme = new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" },
    };
    c.AddSecurityDefinition("Bearer", scheme);
    c.AddSecurityRequirement(new OpenApiSecurityRequirement { [scheme] = [] });
});

// —— CORS：前端开发服务器 ——
const string CorsPolicy = "frontend";
builder.Services.AddCors(o => o.AddPolicy(CorsPolicy, p => p
    .WithOrigins(builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? ["http://localhost:5173"])
    .AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

using (var compatibilityScope = app.Services.CreateScope())
    await DatabaseCompatibility.EnsureAsync(compatibilityScope.ServiceProvider.GetRequiredService<AppDbContext>());

// 正式部署把前端构建产物放在 wwwroot，由 API 同一端口提供。
app.UseDefaultFiles();
app.UseStaticFiles();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();

    // 开发期：幂等种子数据（仅空表插入，不覆盖已有数据）
    using var scope = app.Services.CreateScope();
    await DbSeeder.SeedAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>());
}
else
{
    using var scope = app.Services.CreateScope();
    await DbSeeder.SeedProductionAsync(
        scope.ServiceProvider.GetRequiredService<AppDbContext>(),
        builder.Configuration["Bootstrap:InitialAdminPassword"]);
}

app.UseCors(CorsPolicy);
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

// —— 健康检查（门户首页探活，匿名）——
app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "StitchCostPro.Api" }));
app.MapGet("/api/health", () => Results.Ok(new { status = "ok", service = "StitchCostPro.Api" }));
app.MapFallbackToFile("index.html");

app.Run();
