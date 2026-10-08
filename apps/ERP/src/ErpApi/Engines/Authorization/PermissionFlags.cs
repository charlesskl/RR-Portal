namespace ErpApi.Engines.Authorization;

public enum PermissionAction { 打开, 保存, 删除, 打印, 单价, 金额, 审核, 反审核, 功能 }

public sealed class PermissionFlags
{
    public bool 打开 { get; init; }
    public bool 保存 { get; init; }
    public bool 删除 { get; init; }
    public bool 打印 { get; init; }
    public bool 单价 { get; init; }
    public bool 金额 { get; init; }
    public bool 审核 { get; init; }
    public bool 反审核 { get; init; }
    public bool 功能 { get; init; }

    public bool Has(PermissionAction a) => a switch
    {
        PermissionAction.打开 => 打开,
        PermissionAction.保存 => 保存,
        PermissionAction.删除 => 删除,
        PermissionAction.打印 => 打印,
        PermissionAction.单价 => 单价,
        PermissionAction.金额 => 金额,
        PermissionAction.审核 => 审核,
        PermissionAction.反审核 => 反审核,
        PermissionAction.功能 => 功能,
        _ => false
    };
}
