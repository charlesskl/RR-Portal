using System.Text;
using IndoShipping.Api.Auth;
using IndoShipping.Api.Features.Bootstrap;
using IndoShipping.Api.Startup;
using IndoShipping.Domain.Auth;
using IndoShipping.Infrastructure.Auth;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;

// 实体里的 DateTime 均为 timestamp without time zone，沿用旧 SQL Server datetime 语义。
AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

var builder = WebApplication.CreateBuilder(args);
DeploymentSecrets.TryApplyToConfiguration(builder.Configuration);

var connStr = builder.Configuration.GetConnectionString("Default")
              ?? throw new InvalidOperationException("Missing ConnectionStrings:Default");

var jwtOpts = builder.Configuration.GetSection("Jwt").Get<JwtOptions>()
              ?? throw new InvalidOperationException("Missing Jwt section");
if (string.IsNullOrWhiteSpace(jwtOpts.Key) || jwtOpts.Key.Length < 32)
    throw new InvalidOperationException("Jwt:Key must be at least 32 chars");

builder.Services.AddSingleton(jwtOpts);
builder.Services.AddSingleton<IJwtTokenService, JwtTokenService>();
builder.Services.AddSingleton<IPasswordHasher, BcryptPasswordHasher>();
builder.Services.AddSingleton<ISqlConnectionFactory>(_ => new SqlConnectionFactory(connStr));
builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(connStr));

builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.AllowAnyHeader().AllowAnyMethod().AllowAnyOrigin()));

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtOpts.Issuer,
            ValidAudience = jwtOpts.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOpts.Key))
        };
    });

builder.Services.AddSingleton<IAuthorizationHandler, PermissionHandler>();
builder.Services.AddAuthorizationBuilder()
    .AddPolicy(PermissionHandler.PolicyName(PermissionPosition.Products),    p => p.Requirements.Add(new PermissionRequirement(PermissionPosition.Products)))
    .AddPolicy(PermissionHandler.PolicyName(PermissionPosition.Materials),   p => p.Requirements.Add(new PermissionRequirement(PermissionPosition.Materials)))
    .AddPolicy(PermissionHandler.PolicyName(PermissionPosition.Customers),   p => p.Requirements.Add(new PermissionRequirement(PermissionPosition.Customers)))
    .AddPolicy(PermissionHandler.PolicyName(PermissionPosition.Schedules),   p => p.Requirements.Add(new PermissionRequirement(PermissionPosition.Schedules)))
    .AddPolicy(PermissionHandler.PolicyName(PermissionPosition.Purchase),    p => p.Requirements.Add(new PermissionRequirement(PermissionPosition.Purchase)))
    .AddPolicy(PermissionHandler.PolicyName(PermissionPosition.Quotes),      p => p.Requirements.Add(new PermissionRequirement(PermissionPosition.Quotes)))
    .AddPolicy(PermissionHandler.PolicyName(PermissionPosition.MoldingPos),  p => p.Requirements.Add(new PermissionRequirement(PermissionPosition.MoldingPos)))
    .AddPolicy(PermissionHandler.PolicyName(PermissionPosition.Outbound),    p => p.Requirements.Add(new PermissionRequirement(PermissionPosition.Outbound)))
    .AddPolicy(PermissionHandler.PolicyName(PermissionPosition.Shipments),   p => p.Requirements.Add(new PermissionRequirement(PermissionPosition.Shipments)));

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "IndoShipping API", Version = "v1" });
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header
    });
    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        [new OpenApiSecurityScheme
        {
            Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
        }] = Array.Empty<string>()
    });
});

var app = builder.Build();

// 首次启动建表（共享 PostgreSQL 不能用 EnsureCreated）+ 幂等种子导入。
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await DatabaseCompatibility.EnsureAsync(db);
    var passwordHasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher>();
    await ProductionSeeder.SeedAsync(db, app.Configuration, passwordHasher, app.Logger);
    await DataMigrations.ApplyAsync(db, app.Logger);
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();
app.UseAuthentication();
app.UseMiddleware<ApiPermissionMiddleware>();
app.UseAuthorization();
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapControllers();
app.MapFallbackToFile("index.html");

app.Run();
