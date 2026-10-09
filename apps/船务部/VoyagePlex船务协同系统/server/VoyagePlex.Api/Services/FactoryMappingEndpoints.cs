using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using VoyagePlex.Api.Data;
using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

public static class FactoryMappingEndpoints
{
    public static void EnsureSchema(AppDbContext db) => db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS FactoryMappings (
            Id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            EnglishName TEXT NOT NULL, ChineseShortName TEXT NOT NULL, IsLocal INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS IX_FactoryMappings_EnglishName ON FactoryMappings (EnglishName);
        """);

    public static string? Validate(FactoryMapping row) =>
        string.IsNullOrWhiteSpace(row.EnglishName) || string.IsNullOrWhiteSpace(row.ChineseShortName)
            ? "英文名称和中文简称不能为空"
            : row.EnglishName.Length > 300 || row.ChineseShortName.Length > 50 ? "英文名称最多300字，中文简称最多50字" : null;

    public static void MapFactoryMappings(this WebApplication app)
    {
        app.MapPost("/api/factory-mappings/parse", async (HttpRequest request, EmailParserClient parser, CancellationToken token) =>
        {
            if (!request.HasFormContentType) return Results.BadRequest(new { error = "请选择Excel文件" });
            var form = await request.ReadFormAsync(token);
            var file = form.Files.GetFile("file");
            if (file is null || file.Length > 10 * 1024 * 1024) return Results.BadRequest(new { error = "请选择不超过10MB的Excel" });
            var result = await parser.ParseFactoryMappingAsync(file, token);
            return Results.Content(result.Body, result.ContentType, statusCode: result.StatusCode);
        });
        app.MapGet("/api/factory-mappings", async (AppDbContext db, CancellationToken token) =>
            Results.Ok(await db.FactoryMappings.AsNoTracking().OrderBy(row => row.ChineseShortName).ThenBy(row => row.EnglishName).ToListAsync(token)));
        app.MapPut("/api/factory-mappings", async (FactoryMapping input, AppDbContext db, CancellationToken token) =>
        {
            input.EnglishName = input.EnglishName?.Trim() ?? ""; input.ChineseShortName = input.ChineseShortName?.Trim() ?? "";
            if (input.Id < 0 || Validate(input) is not null) return Results.BadRequest(new { error = Validate(input) ?? "映射编号无效" });
            if (await db.FactoryMappings.AnyAsync(row => row.EnglishName == input.EnglishName && row.Id != input.Id, token))
                return Results.BadRequest(new { error = "该英文名称已存在，请编辑已有映射" });
            var entity = input.Id == 0 ? new FactoryMapping() : await db.FactoryMappings.FindAsync([input.Id], token);
            if (entity is null) return Results.NotFound(new { error = "映射不存在" });
            entity.EnglishName = input.EnglishName; entity.ChineseShortName = input.ChineseShortName; entity.IsLocal = input.IsLocal;
            if (input.Id == 0) db.FactoryMappings.Add(entity);
            await db.SaveChangesAsync(token);
            return Results.Ok(entity);
        });
        app.MapPost("/api/factory-mappings/import", async (FactoryImport input, AppDbContext db, CancellationToken token) =>
        {
            if (input.Rows is null || input.Rows.Any(row => row is null) || input.Rows.Length == 0 || input.Rows.Length > 10000) return Results.BadRequest(new { error = "请导入1至10000条映射" });
            foreach (var row in input.Rows) { row.EnglishName = row.EnglishName?.Trim() ?? ""; row.ChineseShortName = row.ChineseShortName?.Trim() ?? ""; }
            var errors = input.Rows.Select((row, index) => (Error: Validate(row), Row: index + 2)).Where(row => row.Error is not null).Select(row => $"第{row.Row}行：{row.Error}").ToList();
            if (input.Rows.GroupBy(row => row.EnglishName, StringComparer.Ordinal).Any(group => group.Count() > 1)) errors.Add("表格内英文名称重复，请先修正");
            if (errors.Count > 0) return Results.BadRequest(new { error = string.Join("；", errors.Take(20)) });
            await using var transaction = await db.Database.BeginTransactionAsync(token);
            var existing = await db.FactoryMappings.ToListAsync(token);
            var byName = existing.ToDictionary(row => row.EnglishName, StringComparer.Ordinal);
            var added = input.Rows.Count(row => !byName.ContainsKey(row.EnglishName));
            var updated = input.Rows.Length - added;
            if (!input.Preview)
            {
                foreach (var row in input.Rows)
                {
                    if (!byName.TryGetValue(row.EnglishName, out var entity)) { entity = new FactoryMapping { EnglishName = row.EnglishName }; db.FactoryMappings.Add(entity); }
                    entity.ChineseShortName = row.ChineseShortName; entity.IsLocal = row.IsLocal;
                }
                await db.SaveChangesAsync(token);
                await transaction.CommitAsync(token);
            }
            return Results.Ok(new { added, updated, total = input.Rows.Length, rows = input.Rows });
        });
    }
    public sealed record FactoryImport(FactoryMapping[] Rows, bool Preview);
}
