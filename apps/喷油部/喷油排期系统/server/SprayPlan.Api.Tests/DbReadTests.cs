using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using Xunit;

namespace SprayPlan.Api.Tests;

// 验证 .NET + EF Core 能从现有 prisma 维护的 dev.db 正确读出数据，
// 重点验证 AppDbContext 的 DateTime 毫秒转换器（Prisma↔EF 兼容）不报错。
public class DbReadTests
{
    // 从测试输出目录往上 5 级回到仓库根，定位 prisma/dev.db
    // bin/Debug/net8.0 → bin → SprayPlan.Api.Tests → server → 仓库根
    static string DevDbPath()
    {
        var repoRoot = Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
        return Path.Combine(repoRoot, "prisma", "dev.db");
    }

    static AppDbContext NewDb()
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite($"Data Source={DevDbPath()}").Options;
        return new AppDbContext(opts);
    }

    [Fact]
    public void DevDb_FileExists()
    {
        Assert.True(File.Exists(DevDbPath()), $"找不到 dev.db: {DevDbPath()}");
    }

    [Fact]
    public void CanReadSeededUsers()
    {
        using var db = NewDb();
        // ToList 会触发 DateTime 转换器；若转换器有误这里会抛异常
        var users = db.Users.AsNoTracking().ToList();
        // 验证能读出用户即可（admin 为稳定账号）。不再硬断言 clerk ——
        // 真实部署中业务方会自行增删账号（删默认 clerk/viewer、加真实员工号），
        // 断言具体 seed 用户名过脆、会被账号定制绊倒。
        Assert.NotEmpty(users);
        Assert.Contains(users, u => u.Username == "admin");
    }

    [Fact]
    public void DateTimeConverter_ReadsReasonableDate()
    {
        using var db = NewDb();
        var admin = db.Users.AsNoTracking().First(u => u.Username == "admin");
        // 转换器正确的话，createdAt 应是个合理的近年日期（非 1970、非乱码）
        Assert.True(admin.CreatedAt.Year >= 2024,
            $"createdAt 解析异常: {admin.CreatedAt:o}");
    }
}
