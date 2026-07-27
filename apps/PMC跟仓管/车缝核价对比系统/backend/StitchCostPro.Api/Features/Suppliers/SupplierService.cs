using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.Suppliers;

public record SupplierDto(int SupplierId, string SupplierCode, string SupplierName, string? Contact,
    string? MainProcess, int DeptId, bool IsActive, string? ExtMainId, string? Location, string? Remark,
    string? Phone, string? Address, int? EquipmentCount, int? MachinesForUs, int? EmployeeCount,
    string? MonthlyCapacity, string? Qualification, string? Scope);
public record SupplierUpsert(string? SupplierCode, string SupplierName, string? Contact,
    string? MainProcess, int DeptId, bool IsActive, string? ExtMainId, string? Location, string? Remark,
    string? Phone, string? Address, int? EquipmentCount, int? MachinesForUs, int? EmployeeCount,
    string? MonthlyCapacity, string? Qualification, string? Scope);

public class SupplierService(AppDbContext db, ICurrentUser current)
{
    public async Task<List<SupplierDto>> ListAsync(string? keyword, int? deptId, bool includeInactive)
    {
        var q = db.Suppliers.AsNoTracking();
        if (deptId is not null) q = q.Where(s => s.DeptId == deptId);
        if (!includeInactive) q = q.Where(s => s.IsActive);
        if (!string.IsNullOrWhiteSpace(keyword))
            q = q.Where(s => s.SupplierCode.Contains(keyword) || s.SupplierName.Contains(keyword));
        return await q.OrderBy(s => s.SupplierId)
            .Select(s => new SupplierDto(s.SupplierId, s.SupplierCode, s.SupplierName, s.Contact,
                s.MainProcess, s.DeptId, s.IsActive, s.ExtMainId, s.Location, s.Remark,
                s.Phone, s.Address, s.EquipmentCount, s.MachinesForUs, s.EmployeeCount,
                s.MonthlyCapacity, s.Qualification, s.Scope))
            .ToListAsync();
    }

    public async Task<SupplierDto?> GetAsync(int id)
    {
        var s = await db.Suppliers.FindAsync(id);
        return s is null ? null : new SupplierDto(s.SupplierId, s.SupplierCode, s.SupplierName, s.Contact,
            s.MainProcess, s.DeptId, s.IsActive, s.ExtMainId, s.Location, s.Remark,
            s.Phone, s.Address, s.EquipmentCount, s.MachinesForUs, s.EmployeeCount,
            s.MonthlyCapacity, s.Qualification, s.Scope);
    }

    public async Task<(SupplierDto? dto, string? error)> CreateAsync(SupplierUpsert req)
    {
        if (string.IsNullOrWhiteSpace(req.SupplierName))
            return (null, "加工厂名称不能为空");
        // 加工厂表无独立编码，编码留空时用名称当编码（UQ 是 编码+部门）。
        var code = string.IsNullOrWhiteSpace(req.SupplierCode) ? req.SupplierName.Trim() : req.SupplierCode.Trim();
        if (await db.Suppliers.AnyAsync(s => s.SupplierCode == code && s.DeptId == req.DeptId))
            return (null, $"该部门下已存在加工厂 {code}");

        var s = new Supplier
        {
            SupplierCode = code,
            SupplierName = req.SupplierName.Trim(),
            Contact = req.Contact,
            MainProcess = req.MainProcess,
            DeptId = req.DeptId,
            IsActive = req.IsActive,
            ExtMainId = req.ExtMainId,
            Location = req.Location,
            Remark = req.Remark,
            Phone = req.Phone,
            Address = req.Address,
            EquipmentCount = req.EquipmentCount,
            MachinesForUs = req.MachinesForUs,
            EmployeeCount = req.EmployeeCount,
            MonthlyCapacity = req.MonthlyCapacity,
            Qualification = req.Qualification,
            Scope = req.Scope,
            CreatedBy = current.UserId,
            CreatedAt = DateTime.UtcNow,
        };
        db.Suppliers.Add(s);
        await db.SaveChangesAsync();
        return (await GetAsync(s.SupplierId), null);
    }

    public async Task<(SupplierDto? dto, string? error)> UpdateAsync(int id, SupplierUpsert req)
    {
        var s = await db.Suppliers.FindAsync(id);
        if (s is null) return (null, "加工厂不存在");
        var code = string.IsNullOrWhiteSpace(req.SupplierCode) ? req.SupplierName.Trim() : req.SupplierCode.Trim();
        if (await db.Suppliers.AnyAsync(x => x.SupplierCode == code && x.DeptId == req.DeptId && x.SupplierId != id))
            return (null, $"该部门下已存在加工厂 {code}");

        s.SupplierCode = code;
        s.SupplierName = req.SupplierName.Trim();
        s.Contact = req.Contact;
        s.MainProcess = req.MainProcess;
        s.DeptId = req.DeptId;
        s.IsActive = req.IsActive;
        s.ExtMainId = req.ExtMainId;
        s.Location = req.Location;
        s.Remark = req.Remark;
        s.Phone = req.Phone;
        s.Address = req.Address;
        s.EquipmentCount = req.EquipmentCount;
        s.MachinesForUs = req.MachinesForUs;
        s.EmployeeCount = req.EmployeeCount;
        s.MonthlyCapacity = req.MonthlyCapacity;
        s.Qualification = req.Qualification;
        s.Scope = req.Scope;
        s.UpdatedBy = current.UserId;
        s.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return (await GetAsync(id), null);
    }

    public async Task<(bool ok, string? error)> DeleteAsync(int id)
    {
        var s = await db.Suppliers.FindAsync(id);
        if (s is null) return (false, "加工厂不存在");
        db.Suppliers.Remove(s);
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // 被核价/订单等记录引用（外键 Restrict），不能物理删除
            return (false, "该加工厂已被使用（已有核价/订单等记录），不能删除；可改为停用");
        }
        return (true, null);
    }
}
