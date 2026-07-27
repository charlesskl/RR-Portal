namespace StitchCostPro.Api.Entities;

/// <summary>采购订单头：一个加工厂一张单 + 一个交付日，下挂多行明细。★阶段三主干。</summary>
public class PurchaseOrder : AuditableEntity
{
    public int OrderId { get; set; }
    public string OrderNo { get; set; } = null!;          // 订单号(自动 PO日期-序号)
    public int SupplierId { get; set; }                   // 加工厂
    public DateOnly OrderDate { get; set; }               // 下单日
    public DateOnly? DeliveryDate { get; set; }           // 交付日
    public string Status { get; set; } = "已下单";        // 状态
    public int ProductionProgress { get; set; }           // 生产完成进度(%)
    public int DelayDays { get; set; }                    // 延期天数
    public string? DelayReason { get; set; }              // 主要延期原因
    public string? Remark { get; set; }
    public int DeptId { get; set; }

    public Supplier? Supplier { get; set; }
}
