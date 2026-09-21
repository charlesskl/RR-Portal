using Dapper;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;

namespace IndoShipping.Api.Controllers;

// Legacy single-endpoint compat for old HTML: GET/PUT /api/dictionaries
[ApiController]
[Route("api/dictionaries")]
public class DictionariesController(ISqlConnectionFactory factory) : ControllerBase
{
    public class HsItem  { public string? keyword { get; set; } public string? hsCN { get; set; } public string? hsID { get; set; } }
    public class SupItem
    {
        public int? id { get; set; }
        public string? keyword { get; set; }
        public string? full { get; set; }
        public string? customs { get; set; }
        public string? nameEn { get; set; }
        public string? addressZh { get; set; }
        public string? addressEn { get; set; }
        public string? phone { get; set; }
        public string? email { get; set; }
        public string? contact { get; set; }
    }
    public class TranslationItem
    {
        public string? keyword { get; set; }
        public string? english { get; set; }
        public bool active { get; set; } = true;
        public string? source { get; set; }
    }
    public class Body
    {
        public List<HsItem>? hs { get; set; }
        public List<SupItem>? suppliers { get; set; }
        public List<TranslationItem>? translations { get; set; }
    }

    public class SupplierSyncItem
    {
        public string? supplier { get; set; }
        public string? customs { get; set; }
        public string? previousSupplier { get; set; }
        public string? previousCustoms { get; set; }
    }

    public class SupplierSyncBody
    {
        public List<SupplierSyncItem>? entries { get; set; }
        public bool confirmChanges { get; set; }
    }

    private sealed class HsSyncRow
    {
        public string keyword { get; set; } = "";
        public string hsCN { get; set; } = "";
        public string hsID { get; set; } = "";
    }

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        using var c = factory.Create();
        var hs  = (await c.QueryAsync("SELECT keyword, hs_cn AS \"hsCN\", hs_id AS \"hsID\" FROM dict_hs ORDER BY priority, id")).ToList();
        var sup = (await c.QueryAsync("SELECT id, keyword, full_name AS \"full\", customs_company AS customs, name_en AS \"nameEn\", address_zh AS \"addressZh\", address_en AS \"addressEn\", phone, email, contact FROM dict_supplier ORDER BY priority, id")).ToList();
        var translations = (await c.QueryAsync(@"
            SELECT keyword, english_name AS english, active, source
            FROM dict_translation ORDER BY active DESC, priority, id")).ToList();
        return Ok(new { hs, suppliers = sup, translations });
    }

    [HttpPut("suppliers/{id:int}/profile")]
    public async Task<IActionResult> UpdateSupplierProfile(int id, [FromBody] SupItem profile)
    {
        using var c = factory.Create();
        var updated = await c.ExecuteAsync(@"
            UPDATE dict_supplier SET full_name=@full, name_en=@nameEn,
                address_zh=@addressZh, address_en=@addressEn, phone=@phone,
                email=@email, contact=@contact WHERE id=@id",
            new { id, full = (profile.full ?? "").Trim(), nameEn = (profile.nameEn ?? "").Trim(),
                addressZh = (profile.addressZh ?? "").Trim(), addressEn = (profile.addressEn ?? "").Trim(),
                phone = (profile.phone ?? "").Trim(), email = (profile.email ?? "").Trim(),
                contact = (profile.contact ?? "").Trim() });
        return updated == 0 ? NotFound() : Ok(new { ok = true });
    }

    [HttpPost("suppliers")]
    public async Task<IActionResult> CreateSupplier([FromBody] SupItem item)
    {
        var keyword = (item.keyword ?? "").Trim();
        var full = (item.full ?? "").Trim();
        if (keyword.Length == 0 || full.Length == 0)
            return BadRequest(new { error = "供应商简称和公司中文名称不能为空" });
        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        if (await SupplierNameExists(c, tx, keyword, full))
            return Conflict(new { error = "供应商简称或公司中文名称已存在" });
        var id = await c.ExecuteScalarAsync<int>(@"
            INSERT INTO dict_supplier(keyword, full_name, name_en, address_zh,
                address_en, phone, email, contact, priority)
            VALUES (@keyword, @full, @nameEn, @addressZh, @addressEn, @phone, @email,
                @contact, (SELECT COALESCE(MAX(priority), 0) + 10 FROM dict_supplier)) RETURNING id",
            SupplierValues(item, keyword, full), tx);
        tx.Commit();
        return Ok(new { ok = true, id });
    }

    [HttpPut("suppliers/{id:int}")]
    public async Task<IActionResult> UpdateSupplier(int id, [FromBody] SupItem item)
    {
        var keyword = (item.keyword ?? "").Trim();
        var full = (item.full ?? "").Trim();
        if (keyword.Length == 0 || full.Length == 0)
            return BadRequest(new { error = "供应商简称和公司中文名称不能为空" });
        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        if (await SupplierNameExists(c, tx, keyword, full, id))
            return Conflict(new { error = "供应商简称或公司中文名称已存在" });
        var updated = await c.ExecuteAsync(@"
            UPDATE dict_supplier SET keyword=@keyword, full_name=@full,
                name_en=@nameEn, address_zh=@addressZh, address_en=@addressEn, phone=@phone,
                email=@email, contact=@contact WHERE id=@id",
            new { id, keyword, full,
                nameEn = (item.nameEn ?? "").Trim(), addressZh = (item.addressZh ?? "").Trim(),
                addressEn = (item.addressEn ?? "").Trim(), phone = (item.phone ?? "").Trim(),
                email = (item.email ?? "").Trim(), contact = (item.contact ?? "").Trim() }, tx);
        tx.Commit();
        return updated == 0 ? NotFound() : Ok(new { ok = true });
    }

    [HttpDelete("suppliers/{id:int}")]
    public async Task<IActionResult> DeleteSupplier(int id)
    {
        using var c = factory.Create();
        var supplier = await c.QuerySingleOrDefaultAsync<SupItem>(@"
            SELECT keyword, full_name AS full FROM dict_supplier WHERE id=@id", new { id });
        if (supplier is null) return NotFound();
        var referenced = await c.ExecuteScalarAsync<bool>(@"
            SELECT EXISTS (
                SELECT 1 FROM materials WHERE lower(trim(COALESCE(supplier, ''))) IN (lower(@keyword), lower(@full))
                UNION ALL SELECT 1 FROM shipment_items WHERE lower(trim(COALESCE(supplier, ''))) IN (lower(@keyword), lower(@full))
                UNION ALL SELECT 1 FROM purchase_orders WHERE lower(trim(COALESCE(supplier, ''))) IN (lower(@keyword), lower(@full))
            )", new { supplier.keyword, supplier.full });
        if (referenced) return Conflict(new { error = "该供应商已被物料或走货资料使用，不能删除" });
        await c.ExecuteAsync("DELETE FROM dict_supplier WHERE id=@id", new { id });
        return Ok(new { ok = true });
    }

    private static object SupplierValues(SupItem item, string keyword, string full) => new
    {
        keyword, full, nameEn = (item.nameEn ?? "").Trim(),
        addressZh = (item.addressZh ?? "").Trim(), addressEn = (item.addressEn ?? "").Trim(),
        phone = (item.phone ?? "").Trim(), email = (item.email ?? "").Trim(),
        contact = (item.contact ?? "").Trim(),
    };

    private static async Task<bool> SupplierNameExists(System.Data.IDbConnection c,
        System.Data.IDbTransaction tx, string keyword, string full, int? excludeId = null) =>
        await c.ExecuteScalarAsync<bool>(@"
            SELECT EXISTS (SELECT 1 FROM dict_supplier WHERE (@excludeId IS NULL OR id <> @excludeId)
                AND (lower(trim(keyword)) IN (lower(@keyword), lower(@full))
                  OR lower(trim(full_name)) IN (lower(@keyword), lower(@full))))",
            new { keyword, full, excludeId }, tx);

    // 将 HS 字典回填到物料主档。走货明细通过 material_id 读取物料 HS，
    // 因而已有走货资料重新打开后也会显示最新编码。仅补空白值，避免覆盖人工维护内容。
    [HttpPost("hs/sync")]
    public async Task<IActionResult> SyncHs()
    {
        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        try
        {
            var updated = await SyncHsToMaterials(c, tx);
            tx.Commit();
            return Ok(new { ok = true, updated });
        }
        catch
        {
            tx.Rollback();
            throw;
        }
    }

    // 货号库保存时同步供应商汇总：
    // - 新供应商直接加入；
    // - 已有供应商的全称不静默覆盖，第一次请求只返回差异，前端确认后再更新。
    // 报关公司属于物料/走货资料，不与供应商档案建立一对一关联。
    [HttpPost("suppliers/sync")]
    public async Task<IActionResult> SyncSuppliers([FromBody] SupplierSyncBody body)
    {
        var confirmChanges = body?.confirmChanges == true;
        var entries = (body?.entries ?? new())
            .Select(x => new
            {
                supplier = (x.supplier ?? "").Trim(),
                previousSupplier = (x.previousSupplier ?? "").Trim(),
            })
            .Where(x => x.supplier.Length > 0)
            .GroupBy(x => $"{x.previousSupplier.ToUpperInvariant()}|{x.supplier.ToUpperInvariant()}")
            .Select(g => g.First())
            .ToList();

        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        try
        {
            var added = 0;
            var updated = 0;
            var conflicts = new List<object>();

            foreach (var entry in entries)
            {
                dynamic? saved = null;
                if (entry.previousSupplier.Length > 0)
                {
                    saved = await c.QuerySingleOrDefaultAsync(@"
                        SELECT id, keyword, full_name AS ""full""
                        FROM dict_supplier
                        WHERE lower(trim(keyword))=lower(@name) OR lower(trim(COALESCE(full_name,'')))=lower(@name)
                        ORDER BY CASE WHEN lower(trim(COALESCE(full_name,'')))=lower(@name) THEN 0 ELSE 1 END, priority, id
                        LIMIT 1", new { name = entry.previousSupplier }, tx);
                }
                if (saved is null)
                {
                    saved = await c.QuerySingleOrDefaultAsync(@"
                        SELECT id, keyword, full_name AS ""full""
                        FROM dict_supplier
                        WHERE lower(trim(keyword))=lower(@name) OR lower(trim(COALESCE(full_name,'')))=lower(@name)
                        ORDER BY CASE WHEN lower(trim(COALESCE(full_name,'')))=lower(@name) THEN 0 ELSE 1 END, priority, id
                        LIMIT 1", new { name = entry.supplier }, tx);
                }

                if (saved is null)
                {
                    var nextPriority = await c.ExecuteScalarAsync<int>("SELECT COALESCE(MAX(priority), 0) + 10 FROM dict_supplier", transaction: tx);
                    added += await c.ExecuteAsync(@"
                        INSERT INTO dict_supplier(keyword, full_name, priority)
                        VALUES (@supplier, @supplier, @priority)",
                        new { entry.supplier, priority = nextPriority }, tx);
                    continue;
                }

                var savedFull = ((string?)saved.full ?? "").Trim();
                var supplierChanged = entry.previousSupplier.Length > 0
                    && !string.Equals(entry.previousSupplier, entry.supplier, StringComparison.OrdinalIgnoreCase);
                if (!supplierChanged) continue;

                conflicts.Add(new
                {
                    keyword = (string?)saved.keyword ?? "",
                    savedFull,
                    enteredFull = entry.supplier,
                });
                if (!confirmChanges) continue;

                updated += await c.ExecuteAsync(@"
                    UPDATE dict_supplier
                    SET full_name=@full
                    WHERE id=@id",
                    new
                    {
                        id = (int)saved.id,
                        full = entry.supplier,
                        }, tx);
            }

            tx.Commit();
            return Ok(new { ok = true, added, updated, conflicts });
        }
        catch
        {
            tx.Rollback();
            throw;
        }
    }

    [HttpPut]
    public async Task<IActionResult> Put([FromBody] Body body)
    {
        var translations = body?.translations;
        if (translations is not null)
        {
            var duplicate = translations
                .Where(r => !string.IsNullOrWhiteSpace(r.keyword))
                .GroupBy(r => r.keyword!.Trim(), StringComparer.OrdinalIgnoreCase)
                .FirstOrDefault(g => g.Count() > 1);
            if (duplicate is not null)
                return BadRequest(new { error = $"英文翻译字典中中文名重复：{duplicate.Key}" });
        }

        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        try
        {
            await c.ExecuteAsync("DELETE FROM dict_hs;", transaction: tx);
            var hs = body?.hs ?? new(); var sup = body?.suppliers;
            for (int i = 0; i < hs.Count; i++)
            {
                var r = hs[i];
                if (string.IsNullOrWhiteSpace(r.keyword)) continue;
                await c.ExecuteAsync(
                    "INSERT INTO dict_hs(keyword, hs_cn, hs_id, priority) VALUES (@k, @cn, @id, @p)",
                    new { k = r.keyword, cn = r.hsCN ?? "", id = r.hsID ?? "", p = i * 10 }, tx);
            }
            if (sup is not null)
            {
            var savedIds = (await c.QueryAsync<int>("SELECT id FROM dict_supplier", transaction: tx)).ToHashSet();
            var retainedIds = new HashSet<int>();
            for (int i = 0; i < sup.Count; i++)
            {
                var r = sup[i];
                if (string.IsNullOrWhiteSpace(r.keyword)) continue;
                var existingId = r.id is int validId && savedIds.Contains(validId)
                    ? validId
                    : await c.ExecuteScalarAsync<int?>(@"SELECT id FROM dict_supplier
                        WHERE lower(trim(keyword)) = lower(@keyword) ORDER BY priority, id LIMIT 1",
                        new { keyword = r.keyword.Trim() }, tx);
                if (existingId is int id)
                {
                    if (!retainedIds.Add(id)) throw new ArgumentException($"供应商重复：{r.keyword}");
                    await c.ExecuteAsync(@"UPDATE dict_supplier SET keyword=@k, full_name=@f, customs_company=@cc,
                        name_en=COALESCE(@nameEn, name_en), address_zh=COALESCE(@addressZh, address_zh),
                        address_en=COALESCE(@addressEn, address_en), phone=COALESCE(@phone, phone),
                        email=COALESCE(@email, email), contact=COALESCE(@contact, contact), priority=@p WHERE id=@id",
                        new { id, k = r.keyword.Trim(), f = r.full ?? "", cc = r.customs ?? "", r.nameEn,
                            r.addressZh, r.addressEn, r.phone, r.email, r.contact, p = i * 10 }, tx);
                }
                else
                {
                    await c.ExecuteAsync(@"INSERT INTO dict_supplier(keyword, full_name, customs_company, name_en,
                        address_zh, address_en, phone, email, contact, priority)
                        VALUES (@k, @f, @cc, @nameEn, @addressZh, @addressEn, @phone, @email, @contact, @p)",
                        new { k = r.keyword.Trim(), f = r.full ?? "", cc = r.customs ?? "", nameEn = r.nameEn ?? "",
                            addressZh = r.addressZh ?? "", addressEn = r.addressEn ?? "", phone = r.phone ?? "",
                            email = r.email ?? "", contact = r.contact ?? "", p = i * 10 }, tx);
                }
            }
            var deletedIds = savedIds.Except(retainedIds).ToArray();
            if (deletedIds.Length > 0)
                await c.ExecuteAsync("DELETE FROM dict_supplier WHERE id = ANY(@ids)", new { ids = deletedIds }, tx);
            }
            if (translations is not null)
            {
                await c.ExecuteAsync("DELETE FROM dict_translation", transaction: tx);
                for (int i = 0; i < translations.Count; i++)
                {
                    var r = translations[i];
                    if (string.IsNullOrWhiteSpace(r.keyword) || string.IsNullOrWhiteSpace(r.english)) continue;
                    await c.ExecuteAsync(@"
                        INSERT INTO dict_translation(keyword, english_name, active, source, priority, updated_at)
                        VALUES (@keyword, @english, @active, @source, @priority, now())",
                        new
                        {
                            keyword = r.keyword.Trim(),
                            english = r.english.Trim(),
                            r.active,
                            source = string.IsNullOrWhiteSpace(r.source) ? "dictionary" : r.source.Trim(),
                            priority = i * 10,
                        }, tx);
                }
            }
            var hsSynced = await SyncHsToMaterials(c, tx);
            tx.Commit();
            return Ok(new { ok = true, hs_count = hs.Count, sup_count = sup?.Count, translation_count = translations?.Count, hs_synced = hsSynced });
        }
        catch
        {
            tx.Rollback();
            throw;
        }
    }

    private static async Task<int> SyncHsToMaterials(System.Data.IDbConnection c, System.Data.IDbTransaction tx)
    {
        var dictionary = (await c.QueryAsync<HsSyncRow>(@"
            SELECT keyword, hs_cn AS ""hsCN"", hs_id AS ""hsID""
            FROM dict_hs
            WHERE trim(keyword) <> ''
            ORDER BY priority, id", transaction: tx)).ToList();

        var updatedMaterialIds = new HashSet<int>();
        foreach (var entry in dictionary)
        {
            var keyword = (entry.keyword ?? "").Trim();
            var hsCN = (entry.hsCN ?? "").Trim();
            var hsID = (entry.hsID ?? "").Trim();
            if (keyword.Length == 0 || (hsCN.Length == 0 && hsID.Length == 0)) continue;

            var ids = await c.QueryAsync<int>(@"
                UPDATE materials
                SET hs_cn = CASE
                        WHEN trim(COALESCE(hs_cn, '')) = '' AND @hsCN <> '' THEN @hsCN
                        ELSE hs_cn
                    END,
                    hs_id = CASE
                        WHEN trim(COALESCE(hs_id, '')) = '' AND @hsID <> '' THEN @hsID
                        ELSE hs_id
                    END
                WHERE strpos(COALESCE(name_zh, ''), @keyword) > 0
                  AND ((trim(COALESCE(hs_cn, '')) = '' AND @hsCN <> '')
                    OR (trim(COALESCE(hs_id, '')) = '' AND @hsID <> ''))
                RETURNING id", new { keyword, hsCN, hsID }, tx);

            foreach (var id in ids) updatedMaterialIds.Add(id);
        }

        return updatedMaterialIds.Count;
    }
}
