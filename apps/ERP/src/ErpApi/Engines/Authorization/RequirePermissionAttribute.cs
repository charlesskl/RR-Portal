using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.DependencyInjection;
namespace ErpApi.Engines.Authorization;

[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = true)]
public sealed class RequirePermissionAttribute(string menu, PermissionAction action)
    : Attribute, IAsyncAuthorizationFilter
{
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var user = context.HttpContext.User;
        var name = user.FindFirstValue(ClaimTypes.NameIdentifier)
                   ?? user.FindFirstValue("sub");
        if (string.IsNullOrEmpty(name)) { context.Result = new UnauthorizedResult(); return; }

        var svc = context.HttpContext.RequestServices.GetRequiredService<IPermissionService>();
        if (!await svc.HasAsync(name, menu, action))
            context.Result = new ForbidResult();
    }
}
