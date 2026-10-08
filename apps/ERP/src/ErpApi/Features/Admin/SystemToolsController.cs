using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Features.SystemConfig;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Admin;

// 系统工具:版本信息(网上升级页) + 数据库备份(备份数据页)。与 AdminController 同前缀但路由不冲突。
[ApiController]
[Authorize]
[Route("api/admin")]
public sealed class SystemToolsController(
    ISqlConnectionFactory factory, IPermissionService perms, IAuditLogger audit,
    SysConfigService configs, IHostEnvironment env) : ControllerBase
{
    private const string BackupMenu = "备份数据";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private async Task AuditAsync(string table, string behavior, string record)
    { using var c = factory.Create(); await c.OpenAsync(); await audit.WriteAsync(table, behavior, CurrentUser, record, c); }

    // 网上升级页:当前系统版本(程序集版本 + 构建/运行信息)。任何登录用户可读。
    [HttpGet("version")]
    public IActionResult Version()
    {
        var asm = System.Reflection.Assembly.GetEntryAssembly() ?? System.Reflection.Assembly.GetExecutingAssembly();
        var info = asm.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        return Ok(new
        {
            版本 = asm.GetName().Version?.ToString() ?? "",
            信息版本 = info ?? "",
            框架 = RuntimeInformation.FrameworkDescription,
            环境 = env.EnvironmentName,
        });
    }

    // 备份数据:在 SQL Server 服务端执行 BACKUP DATABASE。目录取 系统配置表[备份.目录],缺省回落环境变量 ERP_BACKUP_DIR。
    [HttpPost("backup")]
    public async Task<IActionResult> Backup()
    {
        if (!await perms.HasAsync(CurrentUser, BackupMenu, PermissionAction.功能)) return Forbid();
        var dir = await configs.GetValueAsync(BackupPlan.目录配置键)
                  ?? Environment.GetEnvironmentVariable(BackupPlan.目录环境变量);
        var err = BackupPlan.校验目录(dir);
        if (err is not null) return BadRequest(new { 消息 = err });
        using var c = factory.Create();
        await c.OpenAsync();
        var file = Path.Combine(dir!.Trim(), BackupPlan.生成文件名(c.Database, DateTime.Now));
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = $"BACKUP DATABASE {BackupPlan.引用库名(c.Database)} TO DISK = @file";
            cmd.CommandTimeout = 600;
            cmd.Parameters.Add(new Microsoft.Data.SqlClient.SqlParameter("@file", file));
            await cmd.ExecuteNonQueryAsync();
        }
        await AuditAsync("备份数据", "备份数据库", $"库={c.Database},文件={file}");
        return Ok(new { 文件 = file, 消息 = "备份完成" });
    }
}

public static class BackupPlan
{
    public const string 目录配置键 = "备份.目录";
    public const string 目录环境变量 = "ERP_BACKUP_DIR";

    // 文件名只含库名 + 时间戳,路径由服务端拼接,前端不参与(防路径注入)
    public static string 生成文件名(string 库名, DateTime now) => $"{库名}_{now:yyyyMMdd_HHmmss}.bak";

    // 返回中文错误信息则拒绝,null=通过
    public static string? 校验目录(string? dir)
    {
        if (string.IsNullOrWhiteSpace(dir))
            return $"未配置备份目录:请在系统配置表设置键 [{目录配置键}],或设置环境变量 {目录环境变量}(目录为 SQL Server 服务端路径)";
        if (!Path.IsPathRooted(dir.Trim())) return "备份目录必须是绝对路径";
        return null;
    }

    // QUOTENAME 等价:库名来自连接串,仍按 ] 转义防注入
    public static string 引用库名(string 库名) => "[" + 库名.Replace("]", "]]") + "]";
}
