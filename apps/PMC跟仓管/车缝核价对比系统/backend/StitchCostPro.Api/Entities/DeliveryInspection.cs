using Microsoft.EntityFrameworkCore;

namespace StitchCostPro.Api.Entities;

/// <summary>抽检明细：一行 = 订单的一条款×工艺(line)。不良率=不良÷抽检、实际交货=送货−退货，均算不存。</summary>
public class DeliveryInspection
{
    public int InspectionId { get; set; }
    public int DeliveryNoteId { get; set; }                       // 所属回货批次
    public int LineId { get; set; }                               // 对应采购订单明细行(款×工艺)
    [Precision(14, 2)] public decimal? SendQty { get; set; }      // 送货数量
    [Precision(14, 2)] public decimal? InspectQty { get; set; }   // 抽检数(不良率分母)
    [Precision(14, 2)] public decimal? DefectQty { get; set; }    // 不良数
    [Precision(14, 2)] public decimal? ReturnQty { get; set; }    // 退货数量
    public string? Remark { get; set; }
}
