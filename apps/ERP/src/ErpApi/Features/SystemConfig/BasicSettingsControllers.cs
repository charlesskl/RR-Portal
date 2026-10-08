using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.SystemConfig;

// 基本设置组的键值型设置页基座:固定键白名单 + 复用 SysConfigService(键存于系统配置表,不加密)。
[ApiController]
[Authorize]
public abstract class SysConfigSectionController(
    SysConfigService svc, IPermissionService perms, IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    protected abstract string Menu { get; }
    // (键, 标签, 默认值) —— 默认值仅用于读取时补全,不落库
    protected abstract IReadOnlyList<(string 键, string 标签, string 默认值)> Keys { get; }
    // 保存前按键校验;返回中文错误信息则 400,null=通过
    protected virtual string? 校验(string 键, string? 值) => null;

    protected SysConfigService Svc { get; } = svc;

    // 派生类可复用的按键读取(补默认值,不落库)
    protected async Task<List<SettingItem>> ReadAllAsync()
    {
        var items = new List<SettingItem>(Keys.Count);
        foreach (var (键, 标签, 默认值) in Keys)
        {
            var row = await Svc.GetAsync(键);
            items.Add(new SettingItem { 键 = 键, 标签 = 标签, 值 = row?.值 ?? 默认值 });
        }
        return items;
    }

    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    { using var c = factory.Create(); await c.OpenAsync(); await audit.WriteAsync("系统配置表", behavior, CurrentUser, record, c); }

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await ReadAllAsync());
    }

    [HttpPut]
    public async Task<IActionResult> Put([FromBody] SettingsSaveDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        var allowed = Keys.ToDictionary(k => k.键, k => k.标签);
        foreach (var (键, 值) in dto.值)
        {
            if (!allowed.TryGetValue(键, out var 标签))
                return BadRequest(new { 消息 = $"不支持的设置键:{键}" });
            var err = 校验(键, 值);
            if (err is not null) return BadRequest(new { 消息 = err });
            await Svc.UpsertAsync(new SysConfigDto { 键 = 键, 值 = 值, 是否加密 = false, 备注 = 标签 }, CurrentUser);
        }
        await AuditAsync("保存", $"菜单={Menu},键数={dto.值.Count}");
        return Ok(new { 消息 = "已保存" });
    }
}

public sealed class SettingItem { public string 键 { get; set; } = ""; public string 标签 { get; set; } = ""; public string? 值 { get; set; } }
public sealed class SettingsSaveDto { public Dictionary<string, string?> 值 { get; set; } = new(); }

// 基本资料(公司资料):公司名称/地址/电话/传真/备注
[Route("api/company-profile")]
public sealed class CompanyProfileController(
    SysConfigService svc, IPermissionService perms, IAuditLogger audit, ISqlConnectionFactory factory)
    : SysConfigSectionController(svc, perms, audit, factory)
{
    protected override string Menu => "基本资料";
    protected override IReadOnlyList<(string, string, string)> Keys { get; } =
    [
        ("公司.名称", "公司名称", ""),
        ("公司.地址", "地址", ""),
        ("公司.电话", "电话", ""),
        ("公司.传真", "传真", ""),
        ("公司.备注", "备注", ""),
    ];
}

// 功能设置:系统级开关/参数(代码内暂无已消费未提供 UI 的配置键,先做通用项)
[Route("api/feature-settings")]
public sealed class FeatureSettingsController(
    SysConfigService svc, IPermissionService perms, IAuditLogger audit, ISqlConnectionFactory factory)
    : SysConfigSectionController(svc, perms, audit, factory)
{
    protected override string Menu => "功能设置";
    protected override IReadOnlyList<(string, string, string)> Keys { get; } =
    [
        (FeatureSettingsRules.默认货币键, "默认货币", "HKD"),
        (FeatureSettingsRules.单价小数位键, "单价小数位", "4"),
        (FeatureSettingsRules.数量小数位键, "数量小数位", "2"),
    ];

    protected override string? 校验(string 键, string? 值) => FeatureSettingsRules.校验(键, 值);

    // 前端全局消费(默认货币/小数位): 任何登录用户可读, 不走"功能设置"菜单权限,
    // 否则普通录单员拿不到默认值。只读, 值非敏感。
    [HttpGet("public")]
    public async Task<IActionResult> Public() => Ok(await ReadAllAsync());
}

public static class FeatureSettingsRules
{
    public const string 默认货币键 = "系统.默认货币";
    public const string 单价小数位键 = "系统.单价小数位";
    public const string 数量小数位键 = "系统.数量小数位";
    public static readonly string[] 支持货币 = ["HKD", "RMB", "USD", "EUR"];

    // 返回中文错误信息则拒绝,null=通过
    public static string? 校验(string 键, string? 值)
    {
        switch (键)
        {
            case 默认货币键:
                if (string.IsNullOrWhiteSpace(值) || !支持货币.Contains(值.Trim().ToUpperInvariant()))
                    return $"默认货币仅支持:{string.Join("/", 支持货币)}";
                return null;
            case 单价小数位键:
            case 数量小数位键:
                if (!int.TryParse(值, out var d) || d < 0 || d > 6) return "小数位须为 0-6 的整数";
                return null;
            default:
                return $"未知的功能设置键:{键}";
        }
    }
}
