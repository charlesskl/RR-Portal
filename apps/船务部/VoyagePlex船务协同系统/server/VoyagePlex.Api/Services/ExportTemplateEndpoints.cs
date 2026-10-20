using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using System.Text.Json.Nodes;
using VoyagePlex.Api.Data;
using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Services;

public static class ExportTemplateEndpoints
{
    public static void EnsureSchema(AppDbContext db)
    {
        db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS ExportTemplates (
            Id INTEGER NOT NULL CONSTRAINT PK_ExportTemplates PRIMARY KEY AUTOINCREMENT,
            Company TEXT NOT NULL, Name TEXT NOT NULL, ShipmentMode TEXT NOT NULL,
            Purpose TEXT NOT NULL, Version TEXT NOT NULL, Notes TEXT NOT NULL,
            IsEnabled INTEGER NOT NULL, IsDefault INTEGER NOT NULL, UpdatedAt TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS IX_ExportTemplates_Default
            ON ExportTemplates (Company, ShipmentMode, Purpose) WHERE IsDefault = 1;
        """);
        var columns = db.Database.SqlQueryRaw<string>("SELECT name AS Value FROM pragma_table_info('ExportTemplates')").ToList();
        if (!columns.Contains("WeightRule"))
            db.Database.ExecuteSqlRaw("ALTER TABLE ExportTemplates ADD COLUMN WeightRule TEXT NOT NULL DEFAULT 'Template'");
        if (!columns.Contains("LayoutKey"))
            db.Database.ExecuteSqlRaw("ALTER TABLE ExportTemplates ADD COLUMN LayoutKey TEXT NOT NULL DEFAULT 'Standard'");
        foreach (var company in new[] { "Xingxin", "Huadeng" })
        foreach (var mode in new[] { "Container", "Warehouse" })
        foreach (var purpose in new[] { "Shipping", "Warehouse" })
        {
            var name = $"{(company == "Huadeng" ? "华登" : "兴信")}{(mode == "Container" ? "柜" : "车（交仓）")}{(purpose == "Shipping" ? "船务" : "仓务")}表";
            db.Database.ExecuteSqlInterpolated($"""
                INSERT INTO ExportTemplates (Company, Name, ShipmentMode, Purpose, Version, Notes, WeightRule, LayoutKey, IsEnabled, IsDefault, UpdatedAt)
                SELECT {company}, {name}, {mode}, {purpose}, '1.0', '', 'Template', 'Standard', 1, 1, {DateTime.UtcNow}
                WHERE NOT EXISTS (SELECT 1 FROM ExportTemplates WHERE Company = {company} AND ShipmentMode = {mode} AND Purpose = {purpose})
                """);
        }
        db.Database.ExecuteSqlRaw("""
            UPDATE ExportTemplates SET WeightRule='DisplayInteger', Version='2.0',
                Name='华登普通' || CASE WHEN ShipmentMode='Container' THEN '做柜' ELSE '交仓' END || CASE WHEN Purpose='Shipping' THEN '船务表' ELSE '仓务表' END,
                Notes='RR版式；件数×每箱重量，显示整数、保留底层小数；红字品牌。'
            WHERE Company='Huadeng' AND IsEnabled=1 AND IsDefault=1 AND LayoutKey='Standard' AND WeightRule='Template' AND Version='1.0' AND Notes=''
                AND Name IN ('华登柜船务表','华登柜仓务表','华登车（交仓）船务表','华登车（交仓）仓务表');
            """);
        // Apply the catalog conversion once, atomically. Later restarts must preserve
        // operator edits, including a SKY default, names and enablement choices.
        db.Database.ExecuteSqlRaw("""
            CREATE TABLE IF NOT EXISTS VoyagePlexSchemaChanges (
                Name TEXT PRIMARY KEY NOT NULL, AppliedAt TEXT NOT NULL);
            """);
        using var catalogTransaction = db.Database.BeginTransaction();
        const string catalogChange = "HuadengThreeTemplateCatalogV1";
        var alreadyApplied = db.Database.SqlQueryRaw<string>(
            "SELECT Name AS Value FROM VoyagePlexSchemaChanges WHERE Name='HuadengThreeTemplateCatalogV1'").Any();
        if (alreadyApplied) { catalogTransaction.Commit(); return; }
        // 历史任务可能仅有人工作过的旧版本，仍需为每种用途补齐普通表。
        foreach (var mode in new[] { "Container", "Warehouse" })
        foreach (var purpose in new[] { "Shipping", "Warehouse" })
            db.Database.ExecuteSqlInterpolated($"""
                INSERT INTO ExportTemplates (Company, Name, ShipmentMode, Purpose, Version, Notes, WeightRule, LayoutKey, IsEnabled, IsDefault, UpdatedAt)
                SELECT 'Huadeng', '普通表', {mode}, {purpose}, '2.0', 'RR版式；红字品牌。', 'DisplayInteger', 'Standard', 1, 0, {DateTime.UtcNow}
                WHERE NOT EXISTS (SELECT 1 FROM ExportTemplates WHERE Company='Huadeng' AND ShipmentMode={mode} AND Purpose={purpose} AND LayoutKey='Standard' AND WeightRule='DisplayInteger')
                """);
        foreach (var purpose in new[] { "Shipping", "Warehouse" })
            db.Database.ExecuteSqlInterpolated($"""
                INSERT INTO ExportTemplates (Company, Name, ShipmentMode, Purpose, Version, Notes, WeightRule, LayoutKey, IsEnabled, IsDefault, UpdatedAt)
                SELECT 'Huadeng', '华登多柜特殊表', 'Container', {purpose}, '1.0', '', 'Template', 'SkyCastle', 1, 0, {DateTime.UtcNow}
                WHERE NOT EXISTS (SELECT 1 FROM ExportTemplates WHERE Company='Huadeng' AND LayoutKey='SkyCastle' AND Purpose={purpose})
                """);
        // 华登仅保留普通走柜、普通交仓和 SKY 分柜特殊表；旧配置停用，不删除历史记录。
        db.Database.ExecuteSqlRaw("""
            UPDATE ExportTemplates SET IsDefault=0 WHERE Company='Huadeng';
            UPDATE ExportTemplates SET IsEnabled=0, IsDefault=0
            WHERE Company='Huadeng' AND Id NOT IN (
                SELECT MIN(Id) FROM ExportTemplates WHERE Company='Huadeng' AND
                    ((LayoutKey='Standard' AND WeightRule='DisplayInteger') OR
                     (LayoutKey='SkyCastle' AND ShipmentMode='Container' AND WeightRule='Template'))
                GROUP BY ShipmentMode, Purpose, LayoutKey
            );
            UPDATE ExportTemplates SET IsEnabled=1, IsDefault=CASE WHEN LayoutKey='Standard' THEN 1 ELSE 0 END,
                Name=CASE WHEN LayoutKey='SkyCastle' THEN 'SKY分柜特殊表'
                          WHEN ShipmentMode='Container' THEN '普通走柜表' ELSE '普通交仓表' END
            WHERE Company='Huadeng' AND Id IN (
                SELECT MIN(Id) FROM ExportTemplates WHERE Company='Huadeng' AND
                    ((LayoutKey='Standard' AND WeightRule='DisplayInteger') OR
                     (LayoutKey='SkyCastle' AND ShipmentMode='Container' AND WeightRule='Template'))
                GROUP BY ShipmentMode, Purpose, LayoutKey
            );
            """);
        db.Database.ExecuteSqlInterpolated($"INSERT INTO VoyagePlexSchemaChanges (Name, AppliedAt) VALUES ({catalogChange}, {DateTime.UtcNow})");
        catalogTransaction.Commit();
    }

    public static async Task<string?> ApplyToExport(JsonObject payload, AppDbContext db, CancellationToken cancellationToken, long? templateId = null)
    {
        var mode = payload["exportDetails"]?["shipmentMode"]?.ToString();
        if (mode == "Delivery") return templateId.HasValue ? "送货任务不适用交仓或做柜模板" : null;
        if (mode is not ("Warehouse" or "Container"))
            mode = payload["warehouseGroups"] is JsonArray { Count: > 0 } ? "Warehouse" : "Container";
        var purpose = payload["exportVariant"]?.ToString() == "warehouse" ? "Warehouse" : "Shipping";
        var candidates = db.ExportTemplates.AsNoTracking().Where(value => value.Company == db.Company && value.Purpose == purpose && value.IsEnabled);
        var template = templateId.HasValue
            ? await candidates.SingleOrDefaultAsync(value => value.Id == templateId.Value, cancellationToken)
            : await candidates.SingleOrDefaultAsync(value => value.ShipmentMode == mode && value.IsDefault, cancellationToken);
        if (templateId.HasValue && template is null) return "所选模板不可用，请选择本厂区、对应用途的已启用模板";
        if (template is not null)
        {
            payload["exportTemplate"] = JsonSerializer.SerializeToNode(template, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            if (templateId.HasValue)
            {
                var details = payload["exportDetails"] as JsonObject ?? new JsonObject();
                if (payload["exportDetails"] is null) payload["exportDetails"] = details;
                details["shipmentMode"] = template.ShipmentMode;
                if (template.LayoutKey == "SkyCastle") details["templateKey"] = "sky-castle-multi";
                else details.Remove("templateKey");
            }
        }
        return null;
    }

    public static void MapExportTemplates(this WebApplication app)
    {
        app.MapGet("/api/export-templates/available", async (string purpose, HttpContext context, AppDbContext db, CancellationToken cancellationToken) =>
        {
            var role = ((AppUser)context.Items["CurrentUser"]!).Role;
            if (purpose is not ("Shipping" or "Warehouse")) return Results.BadRequest(new { error = "模板用途无效" });
            if ((role == "warehouse" && purpose != "Warehouse") || (role == "shipping" && purpose != "Shipping"))
                return Results.Json(new { error = "当前账号无权使用此用途模板" }, statusCode: 403);
            return Results.Ok(await db.ExportTemplates.AsNoTracking().Where(value => value.IsEnabled && value.Purpose == purpose)
                .OrderBy(value => value.ShipmentMode).ThenByDescending(value => value.IsDefault).ThenBy(value => value.Name).ToListAsync(cancellationToken));
        });
        app.MapGet("/api/export-templates", async (HttpContext context, AppDbContext db, CancellationToken cancellationToken) =>
        {
            if (!ExportTemplateRules.CanManage(((AppUser)context.Items["CurrentUser"]!).Role)) return Results.Json(new { error = "只有管理员、主管和船务员可以管理导出模板" }, statusCode: 403);
            return Results.Ok(await db.ExportTemplates.AsNoTracking().Where(value => value.Company != "Huadeng" || value.IsEnabled).OrderBy(value => value.ShipmentMode)
                .ThenBy(value => value.Purpose).ThenByDescending(value => value.IsDefault).ThenBy(value => value.Name).ToListAsync(cancellationToken));
        });
        app.MapPut("/api/export-templates", async (ExportTemplate input, HttpContext context, AppDbContext db, CancellationToken cancellationToken) =>
        {
            if (!ExportTemplateRules.CanManage(((AppUser)context.Items["CurrentUser"]!).Role)) return Results.Json(new { error = "只有管理员、主管和船务员可以管理导出模板" }, statusCode: 403);
            input.Name = input.Name?.Trim() ?? "";
            input.Version = input.Version?.Trim() ?? "";
            input.Notes = input.Notes?.Trim() ?? "";
            if (input.Id < 0) return Results.BadRequest(new { error = "模板编号无效" });
            input.Company = db.Company;
            if (db.Company == "Huadeng" && input.Id == 0) return Results.BadRequest(new { error = "华登使用固定的三种模板，请编辑已有配置" });
            if (ExportTemplateRules.Validate(input) is string error) return Results.BadRequest(new { error });
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            var entity = input.Id == 0 ? new ExportTemplate() : await db.ExportTemplates.SingleOrDefaultAsync(value => value.Id == input.Id, cancellationToken);
            if (entity is null) return Results.NotFound(new { error = "模板不存在或属于其他公司" });
            if (db.Company == "Huadeng" && (!entity.IsEnabled || input.LayoutKey != entity.LayoutKey || input.ShipmentMode != entity.ShipmentMode || input.Purpose != entity.Purpose || input.WeightRule != entity.WeightRule))
                return Results.BadRequest(new { error = "华登仅使用普通走柜、普通交仓、SKY分柜特殊表，不新增版式或公式版本" });
            // Clear the previous default before saving the new one; the unique index also
            // protects each company/mode/purpose combination from concurrent defaults.
            if (input.IsDefault)
                await db.ExportTemplates.Where(value => value.ShipmentMode == input.ShipmentMode && value.Purpose == input.Purpose && value.IsDefault && value.Id != input.Id)
                    .ExecuteUpdateAsync(setters => setters.SetProperty(value => value.IsDefault, false), cancellationToken);
            entity.Name = input.Name; entity.ShipmentMode = input.ShipmentMode; entity.Purpose = input.Purpose;
            entity.Version = input.Version; entity.Notes = input.Notes;
            entity.WeightRule = input.WeightRule;
            entity.LayoutKey = input.LayoutKey;
            entity.IsEnabled = input.IsEnabled; entity.IsDefault = input.IsDefault; entity.UpdatedAt = DateTime.UtcNow;
            if (input.Id == 0) db.ExportTemplates.Add(entity);
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Results.Ok(entity);
        });
    }
}
