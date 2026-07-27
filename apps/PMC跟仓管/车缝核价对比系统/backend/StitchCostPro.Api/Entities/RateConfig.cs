using Microsoft.EntityFrameworkCore;

namespace StitchCostPro.Api.Entities;

/// <summary>汇率/税率配置：可配置 + 带生效日期。旧记录锁当时值不重算。</summary>
public class RateConfig : AuditableEntity
{
    public int ConfigId { get; set; }
    public string RateType { get; set; } = null!;            // exchange(港币→人民币) / tax(税率)
    [Precision(10, 4)] public decimal RateValue { get; set; }// 如 0.9000 / 0.1300
    public DateOnly EffectiveDate { get; set; }
    public bool IsCurrent { get; set; } = true;
    public int DeptId { get; set; }
    public string? Remark { get; set; }

    public Dept? Dept { get; set; }
}
