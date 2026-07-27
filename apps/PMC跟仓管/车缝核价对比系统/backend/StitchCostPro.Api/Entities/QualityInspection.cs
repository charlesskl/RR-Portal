using Microsoft.EntityFrameworkCore;

namespace StitchCostPro.Api.Entities;

/// <summary>品质验货明细：一行 = 一次回货的一个款(关联采购订单 + 款 + 加工厂快照)。★品质管理模块。
/// 不良类型明细见子表 QualityDefect。抽检/全检、检验比例、占比、平均次品率、主要质量短板均算不存。</summary>
public class QualityInspection : AuditableEntity
{
    public int InspectionId { get; set; }
    public int OrderId { get; set; }                              // 采购订单
    public int? LineId { get; set; }                              // 精确关联订单产品明细；历史数据可空
    public int ProductId { get; set; }                            // 款(含货号 series_code), 手工表"品名/规格"
    public int SupplierId { get; set; }                           // 加工厂(从订单带出的快照, 汇总主维度)
    public DateOnly ReceivedDate { get; set; }                    // 收货日期
    public DateOnly? CheckDate { get; set; }                      // 查货/返工日期
    public string? MaNo { get; set; }                             // MA号(手填)
    public string? DeliveryNo { get; set; }                       // 送货单号
    [Precision(14, 2)] public decimal? ReceivedQty { get; set; }  // 收货数量
    [Precision(14, 2)] public decimal? QcQty { get; set; }        // 质检数量
    [Precision(14, 2)] public decimal? StockInQty { get; set; }   // 验货后实际入库数量（订单进度唯一来源）
    public string? AbGroup { get; set; }                          // A/B组
    public string? Inspector { get; set; }                        // 检验员
    public string? Rectification { get; set; }                    // 整改情况
    public string? Remark { get; set; }

    public Supplier? Supplier { get; set; }
    public Product? Product { get; set; }
}
