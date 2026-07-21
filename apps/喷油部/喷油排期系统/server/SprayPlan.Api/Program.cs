using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using SprayPlan.Api.Data;
using SprayPlan.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// --- 服务注册 ---
builder.Services.AddControllers();
builder.Services.AddScoped<JwtService>();
builder.Services.AddScoped<SprayPlan.Api.Features.Inventory.InventoryService>();
// PDF 暂存：单例，落盘目录默认 <ContentRoot>/storage/pdf
builder.Services.AddSingleton(new SprayPlan.Api.Services.PdfStorage(
    Path.Combine(builder.Environment.ContentRootPath, "storage", "pdf")));
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// 连现有 dev.db（前后端共用同一个 SQLite 文件）。
// 运行时把相对路径解析成绝对路径：server/SprayPlan.Api 上两级 → 仓库根 → prisma/dev.db
var dbPath = Environment.GetEnvironmentVariable("SPRAYPLAN_DB_PATH")
    ?? Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "..", "prisma", "dev.db"));
builder.Services.AddDbContext<AppDbContext>(opt => opt.UseSqlite($"Data Source={dbPath}"));

// JWT 认证：token 从 HttpOnly Cookie(sprayplan_session) 读取（体验等同现有 iron-session）
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Secret"]!)),
            ValidateAudience = false,
        };
        o.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                ctx.Token = ctx.Request.Cookies["sprayplan_session"];
                return Task.CompletedTask;
            }
        };
    });

// CORS：开发期前端 8400 → 后端 5080，允许带 Cookie
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins("http://localhost:8400").AllowCredentials().AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

// --- 中间件管道 ---
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// 开发期走 http，先不强制 https 跳转（避免 Cookie/CORS 复杂化）
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.Run();

// 供集成测试引用 Program 类型
public partial class Program { }
