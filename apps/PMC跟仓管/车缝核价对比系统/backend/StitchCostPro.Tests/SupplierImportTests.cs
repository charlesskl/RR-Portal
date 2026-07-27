using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Features.Suppliers;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Tests;

public class SupplierImportTests
{
    [Fact]
    public async Task 可以新增加工厂并保存表格字段()
    {
        await using var db = CreateDb();
        var service = new SupplierImportService(db, new FakeCurrentUser());
        var row = new SupplierImportRowInput(2, "益沣", "黄慧卓", "13725669920",
            "广东省茂名市信宜市", 50, 30, 40, null, "车缝", "有效期内", "车缝部");

        var preview = await service.PreviewAsync(1, [row]);
        Assert.Equal("ok", Assert.Single(preview.Rows).Status);

        var result = await service.CommitAsync(new SupplierImportCommitReq(1,
            [new SupplierImportCommitRow(2, row.SupplierName, row.Contact, row.Phone, row.Address,
                row.EquipmentCount, row.MachinesForUs, row.EmployeeCount, row.MonthlyCapacity,
                row.MainProcess, row.Qualification, row.Scope, false)]));

        Assert.Equal(1, result.Created);
        var supplier = await db.Suppliers.SingleAsync();
        Assert.Equal("益沣", supplier.SupplierName);
        Assert.Equal("13725669920", supplier.Phone);
        Assert.Equal(30, supplier.MachinesForUs);
    }

    [Fact]
    public async Task 同名加工厂必须选择跳过或覆盖()
    {
        await using var db = CreateDb();
        db.Suppliers.Add(new Supplier
        {
            SupplierCode = "大竹东俊", SupplierName = "大竹东俊", DeptId = 1, IsActive = true,
            Phone = "旧电话", CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        var service = new SupplierImportService(db, new FakeCurrentUser());
        var row = new SupplierImportRowInput(6, "大竹东俊", "唐俊东", "18982816062",
            null, 100, 74, 106, null, "车缝", "有效期内", "车缝部");

        var preview = await service.PreviewAsync(1, [row]);
        Assert.Equal("conflict", Assert.Single(preview.Rows).Status);

        var kept = await service.CommitAsync(new SupplierImportCommitReq(1,
            [new SupplierImportCommitRow(6, row.SupplierName, row.Contact, row.Phone, row.Address,
                row.EquipmentCount, row.MachinesForUs, row.EmployeeCount, row.MonthlyCapacity,
                row.MainProcess, row.Qualification, row.Scope, false)]));
        Assert.Equal(1, kept.KeptOld);
        Assert.Equal("旧电话", (await db.Suppliers.SingleAsync()).Phone);

        var overwritten = await service.CommitAsync(new SupplierImportCommitReq(1,
            [new SupplierImportCommitRow(6, row.SupplierName, row.Contact, row.Phone, row.Address,
                row.EquipmentCount, row.MachinesForUs, row.EmployeeCount, row.MonthlyCapacity,
                row.MainProcess, row.Qualification, row.Scope, true)]));
        Assert.Equal(1, overwritten.Overwritten);
        Assert.Equal("18982816062", (await db.Suppliers.SingleAsync()).Phone);
    }

    private static AppDbContext CreateDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private sealed class FakeCurrentUser : ICurrentUser
    {
        public int? UserId => 1;
        public int? DeptId => 1;
        public string? Username => "admin";
        public string? Userbqrpower => null;
        public string? Role => "管理员";
    }
}
