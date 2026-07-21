using System.Net.Http.Json;
using Xunit;

namespace SprayPlan.Api.Tests.Basic;

public class MachineKindTests : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private HttpClient _client = null!;
    public async Task InitializeAsync() { _factory = new ApiFactory(); _client = _factory.CreateClient(); await _factory.SeedAsync(); }
    public Task DisposeAsync() { _client.Dispose(); _factory.Dispose(); return Task.CompletedTask; }
    private async Task Login(string u, string p) => (await _client.PostAsJsonAsync("/api/auth/login", new { username = u, password = p })).EnsureSuccessStatusCode();

    [Fact]
    public async Task DefaultKind_Is普通_AndCanUpdateTo炒货机()
    {
        await Login("clerk", "clerk123");
        var list = await _client.GetFromJsonAsync<List<MachineLite>>("/api/machines");
        var m = list!.First();
        Assert.Equal("普通", m.EquipmentKind);

        var upd = await _client.PatchAsJsonAsync($"/api/machines/{m.Id}", new { equipmentKind = "炒货机" });
        upd.EnsureSuccessStatusCode();

        var list2 = await _client.GetFromJsonAsync<List<MachineLite>>("/api/machines");
        Assert.Equal("炒货机", list2!.First(x => x.Id == m.Id).EquipmentKind);
    }

    private record MachineLite(int Id, string MachineNo, string EquipmentKind);
}
