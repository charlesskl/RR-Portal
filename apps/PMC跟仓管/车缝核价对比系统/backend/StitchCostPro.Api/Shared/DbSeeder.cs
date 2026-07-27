using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;

namespace StitchCostPro.Api.Shared;

/// <summary>
/// 幂等种子数据：仅在对应表为空时插入，绝不覆盖已有数据。
/// 内置部门、admin 用户和基础联调数据。
/// </summary>
public static class DbSeeder
{
    public static async Task SeedProductionAsync(AppDbContext db, string? initialAdminPassword)
    {
        if (!await db.Depts.AnyAsync())
        {
            db.Depts.AddRange(
                new Dept { DeptCode = "HQ", DeptName = "本厂", IsActive = true, CreatedAt = DateTime.UtcNow },
                new Dept { DeptCode = "WD", DeptName = "外地车缝部", IsActive = true, CreatedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        }

        if (!await db.SysUsers.AnyAsync())
        {
            if (string.IsNullOrWhiteSpace(initialAdminPassword) || initialAdminPassword.Length < 12)
                throw new InvalidOperationException("Production initial administrator password must contain at least 12 characters.");

            var hq = await db.Depts.FirstAsync(d => d.DeptCode == "HQ");
            db.SysUsers.Add(new SysUser
            {
                Username = "admin",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(initialAdminPassword),
                DisplayName = "系统管理员",
                DeptId = hq.DeptId,
                Userbqrpower = "111111111",
                Role = "管理员",
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }
    }

    public static async Task SeedAsync(AppDbContext db)
    {
        // —— 部门 ——
        if (!await db.Depts.AnyAsync())
        {
            db.Depts.AddRange(
                new Dept { DeptCode = "HQ", DeptName = "本厂", IsActive = true, CreatedAt = DateTime.UtcNow },
                new Dept { DeptCode = "WD", DeptName = "外地车缝部", IsActive = true, CreatedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        }
        var hq = await db.Depts.FirstAsync(d => d.DeptCode == "HQ");

        // —— admin 用户（密码 admin123，bcrypt）——
        if (!await db.SysUsers.AnyAsync())
        {
            db.SysUsers.Add(new SysUser
            {
                Username = "admin",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("admin123"),
                DisplayName = "系统管理员",
                DeptId = hq.DeptId,
                Userbqrpower = "111111111",
                Role = "管理员",
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }


        // —— 测试货号 15783：第 1 款 开心鸡块（联调用）——
        if (!await db.Products.AnyAsync())
        {
            db.Products.Add(new Product
            {
                ProductCode = "15783",
                ProductName = "开心鸡块",
                SeriesCode = "15783",
                StyleNo = "#1",
                DeptId = hq.DeptId,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        // —— 第 2 款 悲伤鸡块（同系列 15783）——
        if (!await db.Products.AnyAsync(p => p.ProductCode == "15783#2"))
        {
            db.Products.Add(new Product
            {
                ProductCode = "15783#2",
                ProductName = "悲伤鸡块",
                SeriesCode = "15783",
                StyleNo = "#2",
                DeptId = hq.DeptId,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        // —— 外发供应商：顺邦（车缝外发用）——
        if (!await db.Suppliers.AnyAsync())
        {
            db.Suppliers.Add(new Supplier
            {
                SupplierCode = "SB02",
                SupplierName = "顺邦",
                Location = "东莞",
                MainProcess = "车缝",
                DeptId = hq.DeptId,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }
    }
}
