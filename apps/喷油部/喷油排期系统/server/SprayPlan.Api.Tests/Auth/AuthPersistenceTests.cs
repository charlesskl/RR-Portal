using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Auth;

public class AuthPersistenceTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateClient();
        await _factory.SeedAsync();
    }

    public Task DisposeAsync()
    {
        _client.Dispose();
        _factory.Dispose();
        return Task.CompletedTask;
    }

    [Fact]
    public async Task Login_SetsPersistentCookieAndThirtyDayToken()
    {
        var before = DateTime.UtcNow;
        var response = await _client.PostAsJsonAsync("/api/auth/login", new
        {
            username = "clerk",
            password = "clerk123",
        });

        response.EnsureSuccessStatusCode();
        var cookie = Assert.Single(response.Headers.GetValues("Set-Cookie"));
        Assert.Contains("sprayplan_session=", cookie);
        Assert.Contains("max-age=2592000", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("expires=", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", cookie, StringComparison.OrdinalIgnoreCase);

        var rawToken = cookie.Split(';')[0].Split('=', 2)[1];
        var token = new JwtSecurityTokenHandler().ReadJwtToken(rawToken);
        Assert.InRange(token.ValidTo, before.AddDays(30).AddMinutes(-1), before.AddDays(30).AddMinutes(1));
    }
}
