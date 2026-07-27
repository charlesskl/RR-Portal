using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.Depts;

public record DeptDto(int DeptId, string DeptCode, string DeptName, bool IsActive, string? ExtMainId);
public record DeptUpsert(string DeptCode, string DeptName, bool IsActive, string? ExtMainId);

public class DeptService(AppDbContext db, ICurrentUser current)
{
    public async Task<List<DeptDto>> ListAsync(bool includeInactive)
    {
        var q = db.Depts.AsNoTracking();
        if (!includeInactive) q = q.Where(d => d.IsActive);
        return await q.OrderBy(d => d.DeptId)
            .Select(d => new DeptDto(d.DeptId, d.DeptCode, d.DeptName, d.IsActive, d.ExtMainId))
            .ToListAsync();
    }

    public async Task<DeptDto?> GetAsync(int id)
    {
        var d = await db.Depts.FindAsync(id);
        return d is null ? null : new DeptDto(d.DeptId, d.DeptCode, d.DeptName, d.IsActive, d.ExtMainId);
    }

    public async Task<(DeptDto? dto, string? error)> CreateAsync(DeptUpsert req)
    {
        if (await db.Depts.AnyAsync(d => d.DeptCode == req.DeptCode))
            return (null, $"部门编码 {req.DeptCode} 已存在");

        var d = new Dept
        {
            DeptCode = req.DeptCode,
            DeptName = req.DeptName,
            IsActive = req.IsActive,
            ExtMainId = req.ExtMainId,
            CreatedBy = current.UserId,
            CreatedAt = DateTime.UtcNow,
        };
        db.Depts.Add(d);
        await db.SaveChangesAsync();
        return (new DeptDto(d.DeptId, d.DeptCode, d.DeptName, d.IsActive, d.ExtMainId), null);
    }

    public async Task<(DeptDto? dto, string? error)> UpdateAsync(int id, DeptUpsert req)
    {
        var d = await db.Depts.FindAsync(id);
        if (d is null) return (null, "部门不存在");
        if (await db.Depts.AnyAsync(x => x.DeptCode == req.DeptCode && x.DeptId != id))
            return (null, $"部门编码 {req.DeptCode} 已被占用");

        d.DeptCode = req.DeptCode;
        d.DeptName = req.DeptName;
        d.IsActive = req.IsActive;
        d.ExtMainId = req.ExtMainId;
        d.UpdatedBy = current.UserId;
        d.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return (new DeptDto(d.DeptId, d.DeptCode, d.DeptName, d.IsActive, d.ExtMainId), null);
    }
}
