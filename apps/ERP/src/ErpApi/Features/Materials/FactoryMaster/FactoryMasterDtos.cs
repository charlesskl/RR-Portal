namespace ErpApi.Features.Materials.FactoryMaster;

// 左树节点：一个加工厂类别 + 该类加工厂数
public sealed class FactoryCategoryNode
{
    public string? 类别 { get; set; }
    public int 数量 { get; set; }
}

// 右网格行
public sealed class FactoryRow
{
    public long ID { get; set; }
    public string? 加工厂类别 { get; set; }
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public string? 联系人 { get; set; }
    public string? 手机 { get; set; }
    public string? 电话 { get; set; }
    public string? 传真 { get; set; }
    public string? 联系地址 { get; set; }
    public string? 付款方式 { get; set; }
    public string? 货币 { get; set; }
    public string? 备注 { get; set; }
}
