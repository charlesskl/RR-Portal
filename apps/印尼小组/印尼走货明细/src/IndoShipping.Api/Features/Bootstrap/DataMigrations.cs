using System.Data;
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
    private const string ConsolidateThreadAndScrewHsKey =
        "data_migration:2026-08-13-consolidate-thread-screw-hs-v1";

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
            VALUES ('{ConsolidateThreadAndScrewHsKey}', 'running', now())
            ON CONFLICT ("key") DO NOTHING
            RETURNING 1;
            """;

        if (await claim.ExecuteScalarAsync() is null)
        {
            await transaction.RollbackAsync();
            return;
        }

        await using var normalize = connection.CreateCommand();
        normalize.Transaction = transaction;
        normalize.CommandText = $"""
            DELETE FROM dict_hs
            WHERE keyword LIKE '%强力线%'
               OR keyword LIKE '%螺丝%';

            INSERT INTO dict_hs (keyword, hs_cn, hs_id, priority)
            VALUES
                ('强力线', '5401101000', '54023900', 1860),
                ('螺丝',   '7318159090', '74153310', 2110);

            UPDATE settings
            SET value = 'applied', updated_at = now()
            WHERE "key" = '{ConsolidateThreadAndScrewHsKey}';
            """;
        await normalize.ExecuteNonQueryAsync();
        await transaction.CommitAsync();

        logger.LogInformation(
            "Consolidated HS dictionary entries for 强力线 and 螺丝 to one canonical row each.");
    }
}
