namespace ErpApi.Features.Production.Cutting;

public sealed class CuttingLineDto
{
    public long ID { get; set; }
    public int? 扎号 { get; set; }
    public string? 缸号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 计件数量 { get; set; }   // 该扎应计件数量；空则取数量
    public string? 备注 { get; set; }
}

public sealed class CuttingCreateDto
{
    public string 生产单号 { get; set; } = "";
    public string? 货号 { get; set; }   // 该裁床单裁的货号(一单多货号);空则不写(由 10_production_notice.sql 回填)
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public string? 客户款号 { get; set; }
    public string? 合同号 { get; set; }
    public string? 床号 { get; set; }
    public string? 布种 { get; set; }
    public string? 备注 { get; set; }
    public List<CuttingLineDto> 明细 { get; set; } = [];
}

public sealed class CuttingHeaderDto
{
    public long ID { get; set; }
    public string? 裁床单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 货号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 加工厂名称 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 床号 { get; set; }
    public decimal? 裁床数量 { get; set; }
    public string? 布种 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class CuttingDetailDto
{
    public CuttingHeaderDto? 单头 { get; set; }
    public List<CuttingLineDto> 明细 { get; set; } = [];
}
