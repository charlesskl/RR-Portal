namespace StitchCostPro.Api.Entities;

/// <summary>回货批次 / 送货单头：一张采购订单可分多批回货。★阶段四 回货 QC。</summary>
public class DeliveryNote : AuditableEntity
{
    public int DeliveryNoteId { get; set; }
    public int OrderId { get; set; }                   // 所属采购订单
    public string NoteNo { get; set; } = null!;        // 送货单号(手填, 非空)
    public DateOnly ReceivedDate { get; set; }         // 实际回货日(算交期用)
    public string? Remark { get; set; }
}
