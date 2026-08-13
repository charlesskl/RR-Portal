using System.Data;
using System.Text.Json;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace IndoShipping.Api.Features.Bootstrap;

/// <summary>
/// Applies one-time, idempotent corrections to existing production data.
/// Each migration records a marker in settings so user edits made afterwards
/// are not overwritten on every application restart.
/// </summary>
public static class DataMigrations
{
    private const string ReplaceHsDictionaryKey =
        "data_migration:2026-08-13-replace-hs-dictionary-v1";

    public static async Task ApplyAsync(AppDbContext db, ILogger logger)
    {
        var connection = db.Database.GetDbConnection();
        if (connection.State != ConnectionState.Open)
            await connection.OpenAsync();

        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.Serializable);

        await using var claim = connection.CreateCommand();
        claim.Transaction = transaction;
        claim.CommandText = $"""
            INSERT INTO settings ("key", value, updated_at)
            VALUES ('{ReplaceHsDictionaryKey}', 'running', now())
            ON CONFLICT ("key") DO NOTHING
            RETURNING 1;
            """;

        if (await claim.ExecuteScalarAsync() is null)
        {
            await transaction.RollbackAsync();
            return;
        }

        var entries = await LoadHsDictionaryAsync();
        if (entries.Count == 0)
            throw new InvalidOperationException("Bundled HS dictionary is empty; refusing to replace existing data.");
        if (entries.Any(entry => entry.HsId.Length != 8 || !entry.HsId.All(char.IsDigit)))
            throw new InvalidOperationException("Every Indonesian HS code must contain exactly eight digits.");
        if (entries.GroupBy(entry => entry.Keyword, StringComparer.OrdinalIgnoreCase).Any(group => group.Count() > 1))
            throw new InvalidOperationException("Bundled HS dictionary contains duplicate keywords.");

        await using var replace = connection.CreateCommand();
        replace.Transaction = transaction;
        replace.CommandText = "DELETE FROM dict_hs;";
        await replace.ExecuteNonQueryAsync();

        await using var insert = connection.CreateCommand();
        insert.Transaction = transaction;
        insert.CommandText = """
            INSERT INTO dict_hs (keyword, hs_cn, hs_id, priority)
            VALUES (@keyword, @hs_cn, @hs_id, @priority);
            """;
        var keyword = insert.CreateParameter(); keyword.ParameterName = "keyword"; insert.Parameters.Add(keyword);
        var hsCn = insert.CreateParameter(); hsCn.ParameterName = "hs_cn"; insert.Parameters.Add(hsCn);
        var hsId = insert.CreateParameter(); hsId.ParameterName = "hs_id"; insert.Parameters.Add(hsId);
        var priority = insert.CreateParameter(); priority.ParameterName = "priority"; insert.Parameters.Add(priority);

        foreach (var entry in entries)
        {
            keyword.Value = entry.Keyword;
            hsCn.Value = entry.HsCn;
            hsId.Value = entry.HsId;
            priority.Value = entry.Priority;
            await insert.ExecuteNonQueryAsync();
        }

        await using var complete = connection.CreateCommand();
        complete.Transaction = transaction;
        complete.CommandText = $"""
            UPDATE settings
            SET value = 'applied', updated_at = now()
            WHERE "key" = '{ReplaceHsDictionaryKey}';
            """;
        await complete.ExecuteNonQueryAsync();
        await transaction.CommitAsync();

        logger.LogInformation("Replaced HS dictionary with {Count} validated entries.", entries.Count);
    }

    private static async Task<IReadOnlyList<HsDictionaryEntry>> LoadHsDictionaryAsync()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "seed", "hs-dictionary.json");
        if (!File.Exists(path))
            throw new FileNotFoundException($"Bundled HS dictionary not found: {path}");

        await using var stream = File.OpenRead(path);
        return await JsonSerializer.DeserializeAsync<List<HsDictionaryEntry>>(
                   stream,
                   new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
               ?? [];
    }

    private sealed record HsDictionaryEntry(string Keyword, string HsCn, string HsId, int Priority);
}
