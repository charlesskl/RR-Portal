using Microsoft.EntityFrameworkCore;
using VoyagePlex.Api.Data;
using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

public static class ExportTemplateEndpoints
{
    public static void EnsureSchema(AppDbContext db) => db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS ExportTemplates (
            Id INTEGER NOT NULL CONSTRAINT PK_ExportTemplates PRIMARY KEY AUTOINCREMENT,
            Company TEXT NOT NULL, Name TEXT NOT NULL, ShipmentMode TEXT NOT NULL,
            Purpose TEXT NOT NULL, Version TEXT NOT NULL, Notes TEXT NOT NULL,
            IsEnabled INTEGER NOT NULL, IsDefault INTEGER NOT NULL, UpdatedAt TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS IX_ExportTemplates_Default
            ON ExportTemplates (Company, ShipmentMode, Purpose) WHERE IsDefault = 1;
        """);

    public static void MapExportTemplates(this WebApplication app)
    {
        app.MapGet("/api/export-templates", async (HttpContext context, AppDbContext db, CancellationToken cancellationToken) =>
        {
            if (!ExportTemplateRules.CanManage(((AppUser)context.Items["CurrentUser"]!).Role)) return Results.Json(new { error = "只有管理员和主管可以管理导出模板" }, statusCode: 403);
            return Results.Ok(await db.ExportTemplates.AsNoTracking().OrderBy(value => value.ShipmentMode)
                .ThenBy(value => value.Purpose).ThenByDescending(value => value.IsDefault).ThenBy(value => value.Name).ToListAsync(cancellationToken));
        });
        app.MapPut("/api/export-templates", async (ExportTemplate input, HttpContext context, AppDbContext db, CancellationToken cancellationToken) =>
        {
            if (!ExportTemplateRules.CanManage(((AppUser)context.Items["CurrentUser"]!).Role)) return Results.Json(new { error = "只有管理员和主管可以管理导出模板" }, statusCode: 403);
            input.Name = input.Name?.Trim() ?? "";
            input.Version = input.Version?.Trim() ?? "";
            input.Notes = input.Notes?.Trim() ?? "";
            if (input.Id < 0) return Results.BadRequest(new { error = "模板编号无效" });
            if (ExportTemplateRules.Validate(input) is string error) return Results.BadRequest(new { error });
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            var entity = input.Id == 0 ? new ExportTemplate() : await db.ExportTemplates.SingleOrDefaultAsync(value => value.Id == input.Id, cancellationToken);
            if (entity is null) return Results.NotFound(new { error = "模板不存在或属于其他公司" });
            // Clear the previous default before saving the new one; the unique index also
            // protects each company/mode/purpose combination from concurrent defaults.
            if (input.IsDefault)
                await db.ExportTemplates.Where(value => value.ShipmentMode == input.ShipmentMode && value.Purpose == input.Purpose && value.IsDefault && value.Id != input.Id)
                    .ExecuteUpdateAsync(setters => setters.SetProperty(value => value.IsDefault, false), cancellationToken);
            entity.Name = input.Name; entity.ShipmentMode = input.ShipmentMode; entity.Purpose = input.Purpose;
            entity.Version = input.Version; entity.Notes = input.Notes;
            entity.IsEnabled = input.IsEnabled; entity.IsDefault = input.IsDefault; entity.UpdatedAt = DateTime.UtcNow;
            if (input.Id == 0) db.ExportTemplates.Add(entity);
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Results.Ok(entity);
        });
    }
}
