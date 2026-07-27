using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.RateConfigs;

public record RateConfigDto(int ConfigId, string RateType, decimal RateValue,
    DateOnly EffectiveDate, bool IsCurrent, int DeptId, string? Remark);
public record RateConfigCreate(string RateType, decimal RateValue, DateOnly EffectiveDate, int DeptId, string? Remark);

public class RateConfigService(AppDbContext db, ICurrentUser current)
{
    private static readonly string[] ValidTypes = ["exchange", "tax"];

    public async Task<List<RateConfigDto>> ListAsync(string? rateType, int? deptId)
    {
        var q = db.RateConfigs.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(rateType)) q = q.Where(r => r.RateType == rateType);
        if (deptId is not null) q = q.Where(r => r.DeptId == deptId);
        return await q.OrderByDescending(r => r.EffectiveDate).ThenByDescending(r => r.ConfigId)
            .Select(r => new RateConfigDto(r.ConfigId, r.RateType, r.RateValue, r.EffectiveDate, r.IsCurrent, r.DeptId, r.Remark))
            .ToListAsync();
    }

    /// <summary>取某部门某类型「当前生效」的值(标记 IsCurrent 且生效日期最新的一条)。</summary>
    public async Task<RateConfigDto?> GetCurrentAsync(string rateType, int deptId)
    {
        var r = await db.RateConfigs.AsNoTracking()
            .Where(x => x.RateType == rateType && x.DeptId == deptId && x.IsCurrent)
            .OrderByDescending(x => x.EffectiveDate).ThenByDescending(x => x.ConfigId)
            .FirstOrDefaultAsync();
        return r is null ? null : new RateConfigDto(r.ConfigId, r.RateType, r.RateValue, r.EffectiveDate, r.IsCurrent, r.DeptId, r.Remark);
    }

    /// <summary>新增一条配置(价格只增不改)：把同部门同类型的旧记录 IsCurrent 置否，新记录置当前。</summary>
    public async Task<(RateConfigDto? dto, string? error)> CreateAsync(RateConfigCreate req)
    {
        if (!ValidTypes.Contains(req.RateType))
            return (null, $"rateType 只能是 exchange 或 tax，收到：{req.RateType}");
        if (req.RateValue <= 0)
            return (null, "汇率/税率必须大于 0");

        var olds = await db.RateConfigs
            .Where(x => x.RateType == req.RateType && x.DeptId == req.DeptId && x.IsCurrent)
            .ToListAsync();
        foreach (var o in olds) o.IsCurrent = false;

        var r = new RateConfig
        {
            RateType = req.RateType,
            RateValue = req.RateValue,
            EffectiveDate = req.EffectiveDate,
            IsCurrent = true,
            DeptId = req.DeptId,
            Remark = req.Remark,
            CreatedBy = current.UserId,
            CreatedAt = DateTime.UtcNow,
        };
        db.RateConfigs.Add(r);
        await db.SaveChangesAsync();
        return (new RateConfigDto(r.ConfigId, r.RateType, r.RateValue, r.EffectiveDate, r.IsCurrent, r.DeptId, r.Remark), null);
    }
}
