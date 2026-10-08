namespace ErpApi.Features.Admin;

public sealed class AccountRow
{
    public string? 用户 { get; set; }
    public string? 登录状态 { get; set; }
    public string? 上次登录 { get; set; }
    public DateTime? 日期 { get; set; }
    public int? 登录失败次数 { get; set; }
    public DateTime? 锁定到期 { get; set; }
    public bool 已锁定 { get; set; }
    public DateTime? 最后心跳时间 { get; set; }
    public DateTime? 最后活动时间 { get; set; }
    public string? 在线状态 { get; set; }
}
public sealed class RegisterDto { public string 用户名 { get; set; } = ""; public string 初始密码 { get; set; } = ""; }
public sealed class ResetPwdDto { public string 新密码 { get; set; } = ""; }
public sealed class MenuPermRow
{
    public string? 组 { get; set; }
    public string 菜单 { get; set; } = "";
    public bool 打开 { get; set; } public bool 保存 { get; set; } public bool 删除 { get; set; } public bool 打印 { get; set; }
    public bool 单价 { get; set; } public bool 金额 { get; set; } public bool 审核 { get; set; } public bool 反审核 { get; set; } public bool 功能 { get; set; }
}
public sealed class SaveUserPermsDto { public string 用户名 { get; set; } = ""; public List<MenuPermRow> 明细 { get; set; } = []; }
