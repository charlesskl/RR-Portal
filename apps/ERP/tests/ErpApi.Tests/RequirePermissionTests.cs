using System.Security.Claims;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public class RequirePermissionTests
{
    private sealed class FakePerm(bool allow) : IPermissionService
    {
        public Task<IReadOnlyDictionary<string, PermissionFlags>> GetByUserAsync(string u)
            => Task.FromResult<IReadOnlyDictionary<string, PermissionFlags>>(new Dictionary<string, PermissionFlags>());
        public Task<bool> HasAsync(string u, string m, PermissionAction a) => Task.FromResult(allow);
    }

    private static AuthorizationFilterContext Ctx(bool allow)
    {
        var services = new ServiceCollection();
        services.AddSingleton<IPermissionService>(new FakePerm(allow));
        var http = new DefaultHttpContext { RequestServices = services.BuildServiceProvider() };
        http.User = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, "u1") }, "test"));
        var ac = new ActionContext(http, new RouteData(), new ActionDescriptor());
        return new AuthorizationFilterContext(ac, new List<IFilterMetadata>());
    }

    [Fact]
    public async Task Denied_sets_403()
    {
        var ctx = Ctx(allow: false);
        await new RequirePermissionAttribute("成品入仓", PermissionAction.审核).OnAuthorizationAsync(ctx);
        Assert.IsType<ForbidResult>(ctx.Result);
    }

    [Fact]
    public async Task Allowed_passes_through()
    {
        var ctx = Ctx(allow: true);
        await new RequirePermissionAttribute("成品入仓", PermissionAction.审核).OnAuthorizationAsync(ctx);
        Assert.Null(ctx.Result);
    }
}
