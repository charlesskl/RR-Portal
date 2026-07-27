using Microsoft.EntityFrameworkCore;

namespace StitchCostPro.Api.Entities;

/// <summary>不良类型明细：一行 = 一种不良类型（爆口/线头/污染或其它自定义）× 数量。挂 QualityInspection。
/// 占比 = 数量 ÷ 质检数，算不存。</summary>
public class QualityDefect
{
    public int DefectId { get; set; }
    public int InspectionId { get; set; }                     // 所属品质验货明细
    public string DefectType { get; set; } = null!;           // 不良类型
    [Precision(14, 2)] public decimal? Qty { get; set; }      // 该类型不良数量
}
