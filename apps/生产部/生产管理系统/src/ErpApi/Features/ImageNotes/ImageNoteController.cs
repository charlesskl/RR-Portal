using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.ImageNotes;

// 图片备注: 上传/列表/删除。文件落 wwwroot/uploads/<模块>/,由 UseStaticFiles 提供下载(Program.cs 已启用)。
// 权限照抄相邻业务端点: 对应菜单"打开"可读,"保存"可上传/删除。
[ApiController]
[Authorize]
[Route("api/image-notes")]
public sealed class ImageNoteController(
    ImageNoteService svc, IPermissionService perms, IWebHostEnvironment env) : ControllerBase
{
    // 模块 → 权限菜单名
    private static readonly IReadOnlyDictionary<string, string> ModuleMenus =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        { ["BOM"] = "款号资料", ["生产单"] = "生产制单" };

    private static readonly HashSet<string> AllowedExt =
        new(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp" };
    private const long MaxBytes = 10L * 1024 * 1024; // 10MB

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private string WebRoot =>
        env.WebRootPath ?? Path.Combine(AppContext.BaseDirectory, "wwwroot");

    // 模块名归一化为字典里的规范写法(大小写不敏感);未知模块返回 null
    private static string? NormalizeModule(string? module) =>
        ModuleMenus.Keys.FirstOrDefault(k => k.Equals(module?.Trim(), StringComparison.OrdinalIgnoreCase));

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string 模块, [FromQuery] string 单号)
    {
        var moduleName = NormalizeModule(模块);
        if (moduleName is null) return BadRequest(new { 消息 = "未知模块" });
        if (string.IsNullOrWhiteSpace(单号)) return BadRequest(new { 消息 = "单号不能为空" });
        if (!await perms.HasAsync(CurrentUser, ModuleMenus[moduleName], PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(moduleName, 单号.Trim()));
    }

    [HttpPost]
    [RequestSizeLimit(MaxBytes + 1024 * 1024)]
    public async Task<IActionResult> Upload(
        [FromForm] string 模块, [FromForm] string 单号, [FromForm] string? 备注, IFormFile? file)
    {
        var moduleName = NormalizeModule(模块);
        if (moduleName is null) return BadRequest(new { 消息 = "未知模块" });
        if (string.IsNullOrWhiteSpace(单号)) return BadRequest(new { 消息 = "单号不能为空" });
        if (file is null || file.Length == 0) return BadRequest(new { 消息 = "请选择图片文件" });
        if (file.Length > MaxBytes) return BadRequest(new { 消息 = "图片不能超过 10MB" });
        var ext = Path.GetExtension(file.FileName);
        if (!AllowedExt.Contains(ext)) return BadRequest(new { 消息 = "仅支持 jpg/png/gif/webp/bmp 图片" });
        if (!await perms.HasAsync(CurrentUser, ModuleMenus[moduleName], PermissionAction.保存)) return Forbid();

        var dir = Path.Combine(WebRoot, "uploads", moduleName);
        Directory.CreateDirectory(dir);
        var stored = $"{Guid.NewGuid():N}{ext.ToLowerInvariant()}";
        var full = Path.Combine(dir, stored);
        await using (var fs = System.IO.File.Create(full))
            await file.CopyToAsync(fs);

        var dto = new ImageNoteDto
        {
            模块 = moduleName,
            单号 = 单号.Trim(),
            文件名 = Path.GetFileName(file.FileName),
            存储路径 = $"uploads/{moduleName}/{stored}",
            备注 = string.IsNullOrWhiteSpace(备注) ? null : 备注.Trim(),
            上传人 = CurrentUser,
            上传时间 = DateTime.Now
        };
        try
        {
            return Ok(await svc.AddAsync(dto));
        }
        catch
        {
            // 入库失败时清理已落盘文件,避免孤儿文件
            try { System.IO.File.Delete(full); } catch (IOException) { }
            throw;
        }
    }

    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id)
    {
        var note = await svc.GetAsync(id);
        if (note is null) return NotFound();
        if (!ModuleMenus.TryGetValue(note.模块, out var menu)) return Forbid();
        if (!await perms.HasAsync(CurrentUser, menu, PermissionAction.保存)) return Forbid();

        // 存储路径来自 DB,防污染后目录穿越:拼成绝对路径必须仍落在 WebRoot/uploads 下,否则拒绝
        var uploadRoot = Path.GetFullPath(Path.Combine(WebRoot, "uploads"));
        var full = Path.GetFullPath(Path.Combine(WebRoot,
            (note.存储路径 ?? "").Replace('/', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(uploadRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            return Conflict(new { 消息 = "存储路径非法，已拒绝删除。" });

        var rel = await svc.DeleteAsync(id);
        if (rel is null) return NotFound();
        try { if (System.IO.File.Exists(full)) System.IO.File.Delete(full); }
        catch (IOException) { /* 文件清理失败不影响记录删除结果 */ }
        return NoContent();
    }
}
