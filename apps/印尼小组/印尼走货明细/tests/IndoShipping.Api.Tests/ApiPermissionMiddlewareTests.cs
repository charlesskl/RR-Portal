using System.Security.Claims;
using IndoShipping.Api.Auth;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace IndoShipping.Api.Tests;

public class ApiPermissionMiddlewareTests
{
    [Theory]
    [InlineData("/api/future-module")]
    [InlineData("/api/authentication")]
    public async Task AuthenticatedUnknownApiRoutesAreDeniedByDefault(string path)
    {
        var nextCalled = false;
        var middleware = new ApiPermissionMiddleware(_ =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        });
        var context = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([], "test")),
        };
        context.Request.Path = path;

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlServer("Server=localhost;Database=not-used;Integrated Security=True;TrustServerCertificate=True")
            .Options;
        await using var db = new AppDbContext(options);

        await middleware.InvokeAsync(context, db);

        Assert.Equal(StatusCodes.Status403Forbidden, context.Response.StatusCode);
        Assert.False(nextCalled);
    }
}
