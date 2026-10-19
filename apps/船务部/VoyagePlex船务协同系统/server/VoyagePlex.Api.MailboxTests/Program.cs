using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using VoyagePlex.Api.Data;
using VoyagePlex.Api.Entities;
using VoyagePlex.Api.Services;

var passed = 0;
var filter = args.SingleOrDefault();
async Task Test(string name, Func<Task> action)
{
    if (filter is not null && !name.Contains(filter, StringComparison.OrdinalIgnoreCase)) return;
    await action();
    Console.WriteLine($"PASS {name}");
    passed++;
}
static void Require(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}
static JsonObject Item(long uid, string date = "2026-10-16T00:00:00Z", bool failed = false) => new()
{
    ["mailbox_uid"] = uid, ["mailbox_received_at"] = date,
    ["status"] = failed ? "failed" : "parsed", ["error"] = failed ? "邮件解析超过资源限制" : "",
    ["fingerprint"] = $"fixture-{uid}", ["filename"] = $"mail-{uid}.eml",
    ["message"] = new JsonObject { ["sender"] = "fixture@example.com", ["subject"] = "fixture" },
    ["items"] = new JsonArray()
};
static HttpResponseMessage Reply(JsonObject request, params JsonObject[] items) => new(HttpStatusCode.OK)
{
    Content = new StringContent(new JsonObject
    {
        ["configured"] = true, ["address"] = request["address"]!.GetValue<string>(),
        ["uid_validity"] = 7, ["items"] = new JsonArray(items.Cast<JsonNode?>().ToArray())
    }.ToJsonString(), Encoding.UTF8, "application/json")
};

await Test("failed message with real date is retained; owners and duplicate polling stay isolated", async () =>
{
    await using var f = await Fixture.Create((p, _) => Task.FromResult(
        Reply(p, p["after_uid"]!.GetValue<long>() == 0 ? [Item(11, failed: true), Item(12)] : [])));
    await f.Sync(2); await f.Sync(3); await f.Sync(2);
    await f.Read(async db =>
    {
        var records = await db.ImportEmailItems.IgnoreQueryFilters().ToListAsync();
        Require(records.Count == 4 && records.Count(x => x.Status == "failed") == 2, "Failed messages or owner records lost");
        Require(records.GroupBy(x => x.MailOwnerId).All(g => g.Count() == 2), "Owner isolation lost");
        Require(records.All(x => x.MailboxKey.StartsWith($"Huadeng:{x.MailOwnerId}:")), "Incorrect owner key");
        Require((await db.MailSyncStates.IgnoreQueryFilters().Where(x => x.Id == 1002 || x.Id == 1003).ToListAsync()).All(x => x.LastUid == 12), "Independent cursor not advanced");
    });
});

await Test("missing metadata commits only known prefix and retries the gap without inventing a date", async () =>
{
    var retry = false;
    await using var f = await Fixture.Create((p, _) => Task.FromResult(Reply(p,
        retry ? [Item(12), Item(13)] : [Item(11), Item(12, "", true), Item(13)])));
    var result = JsonSerializer.SerializeToNode(await f.Sync(2))!;
    Require(result["imported"]!.GetValue<int>() == 1 && result["blockedUid"]!.GetValue<long>() == 12, "Metadata gap not reported");
    await f.Read(async db =>
    {
        Require(await db.ImportEmailItems.IgnoreQueryFilters().CountAsync() == 1, "A UID beyond the metadata gap was persisted");
        var cursor = await db.MailSyncStates.IgnoreQueryFilters().SingleAsync(x => x.Id == 1002);
        Require(cursor.LastUid == 11 && cursor.LastError != "", "Cursor crossed unknown date");
    });
    retry = true;
    await f.Sync(2);
    await f.Read(async db =>
    {
        Require(await db.ImportEmailItems.IgnoreQueryFilters().CountAsync() == 3, "Retry did not fill gap");
        var cursor = await db.MailSyncStates.IgnoreQueryFilters().SingleAsync(x => x.Id == 1002);
        Require(cursor.LastUid == 13 && cursor.LastError == "", "Retry cursor/error incorrect");
    });
});

await Test("database insert failure rolls back mails, batches, contacts and cursor together", async () =>
{
    await using var f = await Fixture.Create((p, _) => Task.FromResult(Reply(p, Item(11))));
    await f.Read(db => db.Database.ExecuteSqlRawAsync("CREATE TRIGGER fixture_fail BEFORE INSERT ON ImportEmailItems BEGIN SELECT RAISE(ABORT, 'fixture'); END;"));
    await f.ExpectFailure(() => f.Sync(2));
    await f.Read(async db =>
    {
        Require(await db.ImportEmailItems.IgnoreQueryFilters().CountAsync() == 0 &&
                await db.ImportBatches.IgnoreQueryFilters().CountAsync() == 0 &&
                await db.MailContacts.IgnoreQueryFilters().CountAsync() == 0, "Partial import committed");
        var state = await db.MailSyncStates.IgnoreQueryFilters().SingleAsync(x => x.Id == 1002);
        Require(state.LastUid == 0 && state.LastError != "", "Failed import advanced cursor");
    });
});

await Test("invalid order or mailbox identity cannot advance cursor", async () =>
{
    foreach (var kind in new[] { "order", "duplicate", "address" })
    {
        await using var f = await Fixture.Create((p, _) =>
        {
            if (kind == "address") p["address"] = "other@example.com";
            return Task.FromResult(Reply(p, kind == "duplicate" ? [Item(11), Item(11)] : [Item(12), Item(11)]));
        });
        await f.ExpectFailure(() => f.Sync(2));
        await f.Read(async db => Require(await db.ImportEmailItems.IgnoreQueryFilters().CountAsync() == 0, "Invalid packet committed"));
    }
});

await Test("UIDVALIDITY reset rechecks second response identity before storing its items", async () =>
{
    var reset = false;
    await using var f = await Fixture.Create((p, _) =>
    {
        var reply = Reply(p, Item(11));
        if (reset)
        {
            var value = JsonNode.Parse(reply.Content!.ReadAsStringAsync().Result)!;
            value["uid_validity"] = p["after_uid"]!.GetValue<long>() == 0 ? 9 : 8;
            reply.Content = new StringContent(value.ToJsonString(), Encoding.UTF8, "application/json");
        }
        return Task.FromResult(reply);
    });
    await f.Sync(2); reset = true;
    await f.ExpectFailure(() => f.Sync(2));
    await f.Read(async db =>
    {
        var state = await db.MailSyncStates.IgnoreQueryFilters().SingleAsync(x => x.Id == 1002);
        Require(state.LastUid == 11 && state.UidValidity == 7, "Changing reset identity overwritten cursor");
        Require(await db.ImportEmailItems.IgnoreQueryFilters().CountAsync() == 1, "Changing reset packet imported");
    });
});

await Test("request timeout releases lock and does not stop background rotation to other mailboxes", async () =>
{
    var calls = new HashSet<string>();
    await using var f = await Fixture.Create((p, _) =>
    {
        var address = p["address"]!.GetValue<string>();
        lock (calls) calls.Add(address);
        return address == "owner2@example.com" ? Task.FromException<HttpResponseMessage>(new TaskCanceledException("fixture timeout")) : Task.FromResult(Reply(p, Item(11)));
    }, enabled: true);
    await f.Service.StartAsync(CancellationToken.None);
    var deadline = DateTime.UtcNow.AddSeconds(5);
    while (DateTime.UtcNow < deadline)
    {
        lock (calls) { if (calls.Count == 4) break; }
        await Task.Delay(10);
    }
    lock (calls) Require(calls.Count == 4, "Timeout prevented other owners from synchronizing");
    Require(f.Service.ExecuteTask is { IsCompleted: false }, "Timeout stopped hosted worker");
    await f.Service.StopAsync(new CancellationTokenSource(TimeSpan.FromSeconds(3)).Token);
    await f.Read(async db =>
    {
        Require((await db.MailSyncStates.IgnoreQueryFilters().SingleAsync(x => x.Id == 1002)).LastError != "", "Timeout error not persisted");
        Require(await db.ImportEmailItems.IgnoreQueryFilters().CountAsync() == 3, "Other owners not imported");
    });
});

await Test("inventory database failure does not escape hosted worker", async () =>
{
    await using var f = await Fixture.Create((p, _) => Task.FromResult(Reply(p)), enabled: true);
    await f.Read(db => db.Database.ExecuteSqlRawAsync("DROP TABLE Users"));
    await f.Service.StartAsync(CancellationToken.None);
    await Task.Delay(80);
    Require(f.Service.ExecuteTask is { IsCompleted: false }, "Inventory failure stopped hosted worker");
    await f.Service.StopAsync(new CancellationTokenSource(TimeSpan.FromSeconds(3)).Token);
});

await Test("caller cancellation propagates and releases synchronization lock", async () =>
{
    using var cancellation = new CancellationTokenSource();
    var cancel = true;
    await using var f = await Fixture.Create((p, _) =>
    {
        if (!cancel) return Task.FromResult(Reply(p, Item(11)));
        cancellation.Cancel();
        return Task.FromCanceled<HttpResponseMessage>(cancellation.Token);
    });
    try { await f.Sync(2, cancellation.Token); throw new InvalidOperationException("Cancellation swallowed"); }
    catch (OperationCanceledException) { }
    cancel = false;
    await f.Sync(3);
    await f.Read(async db => Require(await db.ImportEmailItems.IgnoreQueryFilters().CountAsync() == 1, "Cancellation retained lock"));
});

Console.WriteLine($"Mailbox service regression tests passed: {passed}");

sealed class StubHandler(Func<JsonObject, CancellationToken, Task<HttpResponseMessage>> handler) : HttpMessageHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.Method == HttpMethod.Get)
            return new(HttpStatusCode.OK) { Content = new StringContent("{\"configured\":false,\"items\":[]}") };
        var payload = JsonNode.Parse(await request.Content!.ReadAsStringAsync(cancellationToken))!.AsObject();
        return await handler(payload, cancellationToken);
    }
}

sealed class Fixture : IAsyncDisposable
{
    readonly string directory = Path.Combine(Path.GetTempPath(), "voyageplex-mailbox-service-" + Guid.NewGuid().ToString("N"));
    readonly ServiceProvider provider;
    public MailboxSyncService Service => provider.GetRequiredService<MailboxSyncService>();
    Fixture(Func<JsonObject, CancellationToken, Task<HttpResponseMessage>> handler)
    {
        Directory.CreateDirectory(directory);
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDbContext<AppDbContext>(o => o.UseSqlite("Data Source=" + Path.Combine(directory, "test.db")));
        services.AddScoped<EmailParserClient>(p => new(new HttpClient(new StubHandler(handler))
        { BaseAddress = new Uri("http://synthetic-parser.invalid") }, p.GetRequiredService<AppDbContext>()));
        services.AddSingleton<MailboxSyncService>();
        provider = services.BuildServiceProvider();
    }
    public static async Task<Fixture> Create(Func<JsonObject, CancellationToken, Task<HttpResponseMessage>> handler, bool enabled = false)
    {
        var fixture = new Fixture(handler);
        Environment.SetEnvironmentVariable(ServerMailboxConfiguration.EnvironmentVariable, JsonSerializer.Serialize(
            new[] { 2, 3, 5, 6 }.Select(id => new { username = $"owner{id}", address = $"owner{id}@example.com", authCode = "synthetic-only-auth", host = "imap.example.com", folder = "INBOX" })));
        await fixture.Read(async db =>
        {
            await db.Database.EnsureCreatedAsync();
            db.MailSystemSettings.Add(new() { Id = 1, SyncEnabled = false, StartDate = "2026-10-08" });
            foreach (var id in new[] { 2, 3, 5, 6 })
            {
                db.Users.Add(new() { Id = id, Username = $"owner{id}", MailboxAddress = $"owner{id}@example.com", CompanyAccess = "Huadeng", Role = "shipping" });
                db.MailSystemSettings.Add(new() { Id = 1000 + id, SyncEnabled = enabled, StartDate = "2026-10-08" });
            }
            await db.SaveChangesAsync();
        });
        return fixture;
    }
    public Task<object> Sync(long owner, CancellationToken cancellation = default) => Service.SyncAsync(cancellation, "Huadeng", owner);
    public async Task Read(Func<AppDbContext, Task> action)
    {
        using var scope = provider.CreateScope();
        await action(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }
    public async Task ExpectFailure(Func<Task<object>> action)
    {
        var failed = false;
        try { await action(); } catch (Exception) { failed = true; }
        if (!failed) throw new InvalidOperationException("Expected synchronization failure");
    }
    public async ValueTask DisposeAsync()
    {
        await provider.DisposeAsync();
        Directory.Delete(directory, true);
    }
}
