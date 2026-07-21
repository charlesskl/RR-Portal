using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Basic;

public class HolidaysApiTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _factory = new ApiFactory();
        _client = _factory.CreateClient();
        await _factory.SeedAsync();
    }
    public Task DisposeAsync() { _client.Dispose(); _factory.Dispose(); return Task.CompletedTask; }

    private async Task Login(string u, string p)
        => (await _client.PostAsJsonAsync("/api/auth/login", new { username = u, password = p })).EnsureSuccessStatusCode();

    [Fact]
    public async Task List_Unauthenticated_401()
    {
        var r = await _client.GetAsync("/api/holidays");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Create_AsViewer_403()
    {
        await Login("viewer", "viewer123");
        var r = await _client.PostAsJsonAsync("/api/holidays", new { date = "2026-10-01", type = "holiday", remark = "国庆" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Create_Then_List_Then_Delete()
    {
        await Login("clerk", "clerk123");
        var c = await _client.PostAsJsonAsync("/api/holidays", new { date = "2026-10-01", type = "holiday", remark = "国庆" });
        Assert.Equal(HttpStatusCode.Created, c.StatusCode);

        var list = await _client.GetFromJsonAsync<List<HolidayLite>>("/api/holidays");
        Assert.Contains(list!, h => h.Date == "2026-10-01" && h.Type == "holiday");

        var id = list!.First(h => h.Date == "2026-10-01").Id;
        var d = await _client.DeleteAsync($"/api/holidays/{id}");
        d.EnsureSuccessStatusCode();
        var list2 = await _client.GetFromJsonAsync<List<HolidayLite>>("/api/holidays");
        Assert.DoesNotContain(list2!, h => h.Id == id);
    }

    [Fact]
    public async Task Create_InvalidType_400()
    {
        await Login("clerk", "clerk123");
        var r = await _client.PostAsJsonAsync("/api/holidays", new { date = "2026-10-02", type = "派对", remark = "" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    private record HolidayLite(int Id, string Date, string Type, string? Remark);
}
