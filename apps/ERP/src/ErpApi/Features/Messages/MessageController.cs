using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Messages;

// 消息中心：任何登录用户可访问自己的消息（不走菜单权限——人人都要能收消息）。
[ApiController]
[Authorize]
[Route("api/messages")]
public sealed class MessageController(MessageService svc) : ControllerBase
{
    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List(bool onlyUnread = false, int page = 1, int size = 20)
        => Ok(await svc.ListAsync(CurrentUser, onlyUnread, page, size));

    [HttpGet("unread-count")]
    public async Task<IActionResult> UnreadCount()
        => Ok(new { count = await svc.UnreadCountAsync(CurrentUser) });

    [HttpPost("{id:long}/read")]
    public async Task<IActionResult> MarkRead(long id)
        => await svc.MarkReadAsync(id, CurrentUser) ? NoContent() : NotFound();
}
