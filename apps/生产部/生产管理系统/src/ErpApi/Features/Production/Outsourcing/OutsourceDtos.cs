namespace ErpApi.Features.Production.Outsourcing;

// 一行派工明细（单价服务端按加工项目取，不收前端的）
public sealed class OutsourceLineDto
{
    public string 加工项目 { get; set; } = "";
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 数量 { get; set; }
}

// 派工录入（单头 + 明细）
public sealed class OutsourceCreateDto
{
    public string 加工厂编号 { get; set; } = "";
    public string? 加工厂名称 { get; set; }
    public string? 仓库 { get; set; }
    public string? 付款方式 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 床号 { get; set; }
    public string? 备注 { get; set; }
    public List<OutsourceLineDto> 明细 { get; set; } = [];
}

// 派工单头读出
public sealed class OutsourceHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public string? 仓库 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

// 派工明细读出
public sealed class OutsourceLineRowDto
{
    public long ID { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 加工项目 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}

public sealed class OutsourceDetailDto
{
    public OutsourceHeaderDto? 单头 { get; set; }
    public List<OutsourceLineRowDto> 明细 { get; set; } = [];
}

// 对数行（按 款号×加工项目 归集，发外/回收/相差/金额）
public sealed class OutsourceReconcileRow
{
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 加工项目 { get; set; }
    public decimal? 发外数量 { get; set; }
    public decimal? 回收数量 { get; set; }
    public decimal? 相差数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}

// 回收基准行（按发外单带出：发外数量/已回收/欠数；单价/款/项目/色码）
public sealed class OutsourceReturnBasisRow
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 加工项目 { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 发外数量 { get; set; }
    public decimal 已回收 { get; set; }
    public decimal 欠数 { get; set; }
    public decimal? 单价 { get; set; }
}

// 一行回收明细（前端按基准带出后填回收数量）
public sealed class OutsourceReturnLineDto
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string 加工项目 { get; set; } = "";
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 发外数量 { get; set; }
    public decimal 回收数量 { get; set; }
}

public sealed class OutsourceReturnCreateDto
{
    public string 发外单号 { get; set; } = "";
    public string 加工厂编号 { get; set; } = "";
    public string? 加工厂名称 { get; set; }
    public string? 仓库 { get; set; }
    public string? 备注 { get; set; }
    public List<OutsourceReturnLineDto> 明细 { get; set; } = [];
}

public sealed class OutsourceReturnHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public string? 发外单号 { get; set; }
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public DateTime? 日期 { get; set; }
    public decimal? 发外数量 { get; set; }
    public decimal? 回收数量 { get; set; }
    public decimal? 相差数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class OutsourceReturnLineRowDto
{
    public long ID { get; set; }
    public string? 款号 { get; set; }
    public string? 加工项目 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 发外数量 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 欠数 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}

public sealed class OutsourceReturnDetailDto
{
    public OutsourceReturnHeaderDto? 单头 { get; set; }
    public List<OutsourceReturnLineRowDto> 明细 { get; set; } = [];
}
