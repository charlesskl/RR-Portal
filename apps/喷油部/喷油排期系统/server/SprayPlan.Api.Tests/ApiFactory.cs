using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Tests;

// 集成测试用的 App 工厂：把数据库换成一次性的临时 SQLite 文件库，
// EnsureCreated 按实体建表 + 种子 admin/clerk，完全隔离真实 dev.db。
// 每个测试方法 new 一个，互不干扰；Dispose 时删除临时库文件。
public class ApiFactory : WebApplicationFactory<Program>
{
    private readonly string _dbPath =
        Path.Combine(Path.GetTempPath(), $"sprayplan_test_{Guid.NewGuid():N}.db");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureServices(services =>
        {
            // 移除原 dev.db 的 DbContext 注册，替换成临时测试库
            var d = services.SingleOrDefault(s => s.ServiceType == typeof(DbContextOptions<AppDbContext>));
            if (d is not null) services.Remove(d);
            services.AddDbContext<AppDbContext>(o => o.UseSqlite($"Data Source={_dbPath}"));
        });
    }

    // 建表 + 种子。测试在 IAsyncLifetime.InitializeAsync 里调用一次。
    public async Task SeedAsync()
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.EnsureCreatedAsync();
        var now = DateTime.UtcNow;
        db.Users.AddRange(
            new User { Username = "admin", PasswordHash = PasswordService.Hash("admin123"), DisplayName = "主管管理员", Role = "admin", IsActive = true, CreatedAt = now, UpdatedAt = now },
            new User { Username = "clerk", PasswordHash = PasswordService.Hash("clerk123"), DisplayName = "文员", Role = "clerk", IsActive = true, CreatedAt = now, UpdatedAt = now },
            new User { Username = "viewer", PasswordHash = PasswordService.Hash("viewer123"), DisplayName = "统计组", Role = "viewer", IsActive = true, CreatedAt = now, UpdatedAt = now }
        );
        await db.SaveChangesAsync();

        // 种一个拉别 + 一台机台，供基础数据库集成测试用
        var line = new ProductionLine { Name = "胡旗拉", Workshop = "兴信A", LeaderName = "胡旗", IsActive = true };
        db.ProductionLines.Add(line);
        await db.SaveChangesAsync();
        db.Machines.Add(new Machine { MachineNo = "5#", LineId = line.Id, MachineType = "移印", IsUV = true, IsActive = true });
        await db.SaveChangesAsync();
    }

    // 供测试直接操作数据库（造特殊数据，如"待补产品订单 productId=null"）。
    public async Task WithDbAsync(Func<AppDbContext, Task> action)
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await action(db);
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        // host 已释放、连接已关闭，删除临时库文件（失败忽略，临时目录无害）
        if (disposing)
        {
            try { if (File.Exists(_dbPath)) File.Delete(_dbPath); } catch { }
        }
    }
}
