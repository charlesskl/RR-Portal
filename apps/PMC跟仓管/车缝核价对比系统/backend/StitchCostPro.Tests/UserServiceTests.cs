using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Features.Users;
using StitchCostPro.Api.Shared;
using Xunit;

namespace StitchCostPro.Tests;

/// <summary>用户管理服务：建号写 bcrypt 不存明文、角色合法、用户名不重复。</summary>
public class UserServiceTests
{
    // 每个测试一套全新的内存库，互不干扰
    private static AppDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    [Fact]
    public async Task 建号后列表能查到_且密码已加密非明文()
    {
        using var db = NewDb();
        var svc = new UserService(db, new FakeCurrentUser());

        var (dto, err) = await svc.CreateAsync(new UserCreate("zhang", "pass123", "张三", "业务", 1));

        Assert.Null(err);
        Assert.Equal("业务", dto!.Role);

        var stored = await db.SysUsers.SingleAsync(u => u.Username == "zhang");
        Assert.NotEqual("pass123", stored.PasswordHash);                 // 不存明文
        Assert.True(BCrypt.Net.BCrypt.Verify("pass123", stored.PasswordHash));
    }

    [Fact]
    public async Task 用户名重复_返回错误()
    {
        using var db = NewDb();
        var svc = new UserService(db, new FakeCurrentUser());

        await svc.CreateAsync(new UserCreate("zhang", "p", "张三", "业务", 1));
        var (_, err) = await svc.CreateAsync(new UserCreate("zhang", "p2", "张三2", "外发", 1));

        Assert.NotNull(err);
    }

    [Fact]
    public async Task 非法角色_返回错误()
    {
        using var db = NewDb();
        var svc = new UserService(db, new FakeCurrentUser());

        var (_, err) = await svc.CreateAsync(new UserCreate("li", "p", "李四", "厂长", 1));

        Assert.NotNull(err);
    }

    // 假的当前用户：充当"管理员"在操作（只为提供 CreatedBy）
    private sealed class FakeCurrentUser : ICurrentUser
    {
        public int? UserId => 1;
        public int? DeptId => 1;
        public string? Username => "admin";
        public string? Userbqrpower => null;
        public string? Role => "管理员";
    }
}
