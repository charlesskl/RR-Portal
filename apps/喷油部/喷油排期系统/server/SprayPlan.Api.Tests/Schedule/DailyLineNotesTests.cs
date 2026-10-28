using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using DocumentFormat.OpenXml.Validation;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests.Schedule;

public class DailyLineNotesTests : IAsyncLifetime
{
    readonly ApiFactory factory = new();
    HttpClient client = null!;
    const string Day = "2026-10-28";
    public async Task InitializeAsync()
    {
        client = factory.CreateClient();
        await factory.SeedAsync();
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
    }
    public Task DisposeAsync() { client.Dispose(); factory.Dispose(); return Task.CompletedTask; }
    Task<HttpResponseMessage> Save(string text, int version = 0, string date = Day, int lineId = 1)
        => client.PutAsJsonAsync("/api/schedule/line-notes", new { date, lineId, text, version });
    async Task<JsonElement[]> Notes(string from = Day, string to = Day)
        => (await client.GetFromJsonAsync<JsonElement>($"/api/schedule/overview?from={from}&to={to}"))
            .GetProperty("lineNotes").EnumerateArray().ToArray();

    [Fact]
    public async Task NotesPersistIndependentlyByDateAndLine_AndCanBeCleared()
    {
        await factory.WithDbAsync(async db => {
            db.ProductionLines.Add(new ProductionLine { Name = "B拉：自动喷" });
            await db.SaveChangesAsync();
        });
        (await Save("  调机后开工\n注意色差  ")).EnsureSuccessStatusCode();
        (await Save("另一拉备注", lineId: 2)).EnsureSuccessStatusCode();
        (await Save("次日备注", date: "2026-10-29")).EnsureSuccessStatusCode();
        var notes = await Notes();
        Assert.Equal(2, notes.Length);
        Assert.Equal("调机后开工\n注意色差", notes.Single(n => n.GetProperty("lineId").GetInt32() == 1).GetProperty("text").GetString());
        (await Save("", version: 1)).EnsureSuccessStatusCode();
        Assert.Equal("", (await Notes()).Single(n => n.GetProperty("lineId").GetInt32() == 1).GetProperty("text").GetString());
        Assert.Equal("次日备注", Assert.Single(await Notes("2026-10-29", "2026-10-29")).GetProperty("text").GetString());
        await factory.WithDbAsync(async db => {
            Assert.Equal(3, await db.DailyLineNotes.CountAsync());
            Assert.Empty(await db.ProductionPlans.ToListAsync());
            Assert.Empty(await db.InventoryMoves.ToListAsync());
        });
    }

    [Fact]
    public async Task StaleWritesDoNotOverwriteSavedNotes()
    {
        (await Save("原备注")).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await Save("旧版本覆盖")).StatusCode);
        (await Save("新备注", 1)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await Save("再次覆盖", 1)).StatusCode);
        Assert.Equal("新备注", Assert.Single(await Notes()).GetProperty("text").GetString());
    }

    [Theory]
    [InlineData("2026-02-30", 0)]
    [InlineData("2026-10-28", -1)]
    public async Task InvalidDateOrVersionIsRejected(string date, int version)
        => Assert.Equal(HttpStatusCode.BadRequest, (await Save("备注", version, date)).StatusCode);

    [Fact]
    public async Task PermissionFactoryAndLengthAreEnforced()
    {
        await factory.WithDbAsync(async db => {
            db.ProductionLines.Add(new ProductionLine { Name = "华登拉", FactoryId = "HUADENG" });
            await db.SaveChangesAsync();
            db.DailyLineNotes.Add(new DailyLineNote { LineId = 2, FactoryId = "HUADENG", NoteDate = DateUtil.ParseUtc(Day), Text = "华登备注" });
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.NotFound, (await Save("跨厂区", lineId: 2)).StatusCode);
        Assert.Empty(await Notes());
        Assert.Equal(HttpStatusCode.BadRequest, (await Save(new string('字', 2001))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Save("备注", lineId: 999)).StatusCode);
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "viewer", password = "viewer123" })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await Save("越权")).StatusCode);
    }

    [Theory]
    [InlineData("plan", false)]
    [InlineData("actual", false)]
    [InlineData("plan", true)]
    [InlineData("actual", true)]
    public async Task ExportIncludesSavedNoteInMergedFooter_EvenWithoutPlans(string mode, bool withPlan)
    {
        if (withPlan) await factory.WithDbAsync(async db => {
            db.ProductionPlans.Add(new ProductionPlan {
                LineId = 1, PlanDate = DateUtil.ParseUtc(Day), PlannedQty = 100, WorkerCount = 2,
                Order = new Order { ExternalOrderNo = "NOTE-TEST", Product = new Product { ProductNo = "NOTE-PRODUCT" } },
            });
            await db.SaveChangesAsync();
        });
        (await Save("=注意调机<&>😀\n下午来料后开工")).EnsureSuccessStatusCode();
        (await Save("次日不得串入", date: "2026-10-29")).EnsureSuccessStatusCode();
        var response = await client.PostAsJsonAsync("/api/recording/export", new { date = Day, mode,
            lineNotes = new[] { new { lineId = 1, miscText = "杂工说明", miscCount = 3, headerText = "本拉说明" } } });
        response.EnsureSuccessStatusCode();
        using var stream = new MemoryStream(await response.Content.ReadAsByteArrayAsync());
        using var doc = SpreadsheetDocument.Open(stream, false);
        var ws = Assert.Single(doc.WorkbookPart!.WorksheetParts).Worksheet;
        var footer = ws.GetFirstChild<SheetData>()!.Elements<Row>().Last();
        var cell = footer.Elements<Cell>().Single(c => c.CellReference == $"C{footer.RowIndex}");
        Assert.Equal("=注意调机<&>😀\n下午来料后开工\n杂工说明", cell.InlineString!.InnerText);
        Assert.Null(cell.CellFormula);
        Assert.Contains(ws.Elements<MergeCells>().Single().Elements<MergeCell>(), m => m.Reference == $"C{footer.RowIndex}:L{footer.RowIndex}");
        Assert.Equal("3", footer.Elements<Cell>().Single(c => c.CellReference == $"B{footer.RowIndex}").CellValue!.Text);
        Assert.Empty(new OpenXmlValidator().Validate(doc));
    }

    [Fact]
    public async Task ExistingDatabaseReceivesAdditiveSchemaAndKeepsData()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        db.ProductionLines.Add(new ProductionLine { Name = "原拉别" });
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlRawAsync("DROP TABLE daily_line_notes");
        await DailyLineNoteSchema.Ensure(db);
        await DailyLineNoteSchema.Ensure(db);
        db.DailyLineNotes.Add(new DailyLineNote { LineId = 1, NoteDate = DateUtil.ParseUtc(Day), Text = "迁移后备注" });
        await db.SaveChangesAsync();
        Assert.Equal("原拉别", (await db.ProductionLines.SingleAsync()).Name);
        Assert.Equal("迁移后备注", (await db.DailyLineNotes.SingleAsync()).Text);
    }
    sealed class NoteWriteBarrier : SaveChangesInterceptor
    {
        public bool Enabled;
        int arrivals;
        readonly TaskCompletionSource ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData data,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (Enabled && data.Context!.ChangeTracker.Entries<DailyLineNote>()
                .Any(e => e.State is EntityState.Added or EntityState.Modified))
            {
                if (Interlocked.Increment(ref arrivals) == 2) ready.TrySetResult();
                await ready.Task.WaitAsync(TimeSpan.FromSeconds(10), cancellationToken);
            }
            return result;
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ConcurrentFirstAndExistingWrites_KeepOneWinner(bool alreadyExists)
    {
        var barrier = new NoteWriteBarrier();
        using var isolated = new ApiFactory(options => options.AddInterceptors(barrier));
        using var concurrent = isolated.CreateClient();
        await isolated.SeedAsync();
        (await concurrent.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
        Task<HttpResponseMessage> Put(string text, int version) => concurrent.PutAsJsonAsync("/api/schedule/line-notes", new { date = Day, lineId = 1, text, version });
        if (alreadyExists) (await Put("original", 0)).EnsureSuccessStatusCode();
        barrier.Enabled = true;
        var responses = await Task.WhenAll(Put("first", alreadyExists ? 1 : 0), Put("second", alreadyExists ? 1 : 0));
        Assert.Single(responses.Where(response => response.StatusCode == HttpStatusCode.OK));
        Assert.Single(responses.Where(response => response.StatusCode == HttpStatusCode.Conflict));
        await isolated.WithDbAsync(async db => {
            var note = await db.DailyLineNotes.SingleAsync();
            Assert.Contains(note.Text, new[] { "first", "second" });
            Assert.Equal(alreadyExists ? 2 : 1, note.Version);
            Assert.Empty(await db.ProductionPlans.ToListAsync());
            Assert.Empty(await db.InventoryMoves.ToListAsync());
        });
    }

    [Theory]
    [InlineData("\u0001")]
    [InlineData("\u0000")]
    public async Task XmlUnsafeNote_IsRejectedOrExportsValidWorkbook(string control)
    {
        var save = await Save("before" + control + "after");
        if (save.StatusCode == HttpStatusCode.BadRequest)
        {
            await factory.WithDbAsync(async db => Assert.Empty(await db.DailyLineNotes.ToListAsync()));
            return;
        }
        save.EnsureSuccessStatusCode();
        var exported = await client.PostAsJsonAsync("/api/recording/export", new { date = Day });
        exported.EnsureSuccessStatusCode();
        using var stream = new MemoryStream(await exported.Content.ReadAsByteArrayAsync());
        using var workbook = SpreadsheetDocument.Open(stream, false);
        Assert.Empty(new OpenXmlValidator().Validate(workbook));
    }

}
