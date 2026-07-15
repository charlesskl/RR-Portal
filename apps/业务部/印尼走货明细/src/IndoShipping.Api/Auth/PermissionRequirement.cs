using IndoShipping.Infrastructure.Auth;
using Microsoft.AspNetCore.Authorization;

namespace IndoShipping.Api.Auth;

public class PermissionRequirement(int position) : IAuthorizationRequirement
{
    public int Position { get; } = position;
}

public class PermissionHandler : AuthorizationHandler<PermissionRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext ctx, PermissionRequirement req)
    {
        // Legacy compatibility mode: skip permission check entirely so old HTML (no JWT) works.
        ctx.Succeed(req);
        return Task.CompletedTask;
    }

    public static string PolicyName(int position) => $"Permission:{position}";
}
