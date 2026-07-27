using Microsoft.EntityFrameworkCore;

namespace StitchCostPro.Api.Entities;

/// <summary>⑥ 供应商质量统计：按厂汇总良率/退货率（由质检台账聚合）。</summary>
public class SupplierQualityStat : AuditableEntity
{
    public int StatId { get; set; }
    public int SupplierId { get; set; }
    public string Period { get; set; } = null!;         // 统计周期（如 2026-06）

    [Precision(14, 2)]
    public decimal? TotalQty { get; set; }

    [Precision(7, 4)]
    public decimal? DefectRate { get; set; }

    [Precision(7, 4)]
    public decimal? ReturnRate { get; set; }

    [Precision(5, 2)]
    public decimal? AvgQcScore { get; set; }
    public int DeptId { get; set; }

    public Supplier? Supplier { get; set; }
    public Dept? Dept { get; set; }
}
