using System.Security.Claims;
using IndoShipping.Domain.Auth;
using IndoShipping.Infrastructure.Auth;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using System.IdentityModel.Tokens.Jwt;

namespace IndoShipping.Api.Auth;

public class ApiPermissionMiddleware(RequestDelegate next)
{
    private static readonly Dictionary<string, int> Modules = new(StringComparer.OrdinalIgnoreCase)
    {
        ["/api/products"] = PermissionPosition.Products,
        ["/api/images"] = PermissionPosition.Products,
        ["/api/dictionaries"] = PermissionPosition.Products,
        ["/api/materials"] = PermissionPosition.Materials,
        ["/api/customers"] = PermissionPosition.Customers,
        ["/api/schedules"] = PermissionPosition.Schedules,
        ["/api/purchase"] = PermissionPosition.Purchase,
        ["/api/quotes"] = PermissionPosition.Quotes,
        ["/api/molding-pos"] = PermissionPosition.MoldingPos,
        ["/api/outbound"] = PermissionPosition.Outbound,
        ["/api/shipments"] = PermissionPosition.Shipments,
    };

    public async Task InvokeAsync(HttpContext context, AppDbContext db)
    {
        var path = context.Request.Path;
        if (!StartsWithSegment(path, "/api") ||
            StartsWithSegment(path, "/api/auth") ||
            StartsWithSegment(path, "/api/health"))
        {
            await next(context);
            return;
        }

        if (context.User.Identity?.IsAuthenticated != true)
        {
            await Deny(context, StatusCodes.Status401Unauthorized, "请先登录");
            return;
        }

        var isCurrentUserEndpoint = StartsWithSegment(path, "/api/users/me");
        var isAdminEndpoint = StartsWithSegment(path, "/api/users") ||
                              StartsWithSegment(path, "/api/db");
        var match = Modules.FirstOrDefault(x => StartsWithSegment(path, x.Key));
        if (!isCurrentUserEndpoint && !isAdminEndpoint && match.Key is null)
        {
            await Deny(context, StatusCodes.Status403Forbidden, "接口未注册或未配置权限");
            return;
        }

        var idText = context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                     ?? context.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        if (!int.TryParse(idText, out var userId))
        {
            await Deny(context, StatusCodes.Status401Unauthorized, "登录已失效，请重新登录");
            return;
        }
        var currentUser = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == userId && x.IsActive);
        if (currentUser is null)
        {
            await Deny(context, StatusCodes.Status401Unauthorized, "账户已停用或删除");
            return;
        }
        var access = currentUser.Userbqrpower;
        var edit = currentUser.Usereditpower;

        if (isCurrentUserEndpoint)
        {
            await next(context);
            return;
        }

        // 账户与数据库管理只允许拥有全部访问和编辑权限的管理员。
        if (isAdminEndpoint)
        {
            if (access != "111111111" || edit != "111111111")
            {
                await Deny(context, StatusCodes.Status403Forbidden, "仅管理员可执行此操作");
                return;
            }
            await next(context);
            return;
        }

        if (match.Key is not null)
        {
            if (!Has(access, match.Value))
            {
                await Deny(context, StatusCodes.Status403Forbidden, "没有访问该模块的权限");
                return;
            }
            if (!IsReadOnlyMethod(context.Request.Method) && !Has(edit, match.Value))
            {
                await Deny(context, StatusCodes.Status403Forbidden, "该模块为只读权限，不能修改");
                return;
            }
        }

        await next(context);
    }

    private static bool StartsWithSegment(PathString path, string prefix) =>
        path.StartsWithSegments(new PathString(prefix), StringComparison.OrdinalIgnoreCase);

    private static bool Has(string value, int position) => value.Length > position && value[position] == '1';
    private static bool IsReadOnlyMethod(string method) =>
        HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method);

    private static async Task Deny(HttpContext context, int status, string error)
    {
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";
        await context.Response.WriteAsJsonAsync(new { error });
    }
}
