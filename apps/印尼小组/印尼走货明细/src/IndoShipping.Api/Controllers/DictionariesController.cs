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
    public class SupItem { public string? keyword { get; set; } public string? full { get; set; } public string? customs { get; set; } }
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

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        using var c = factory.Create();
        var hs  = (await c.QueryAsync("SELECT keyword, hs_cn AS \"hsCN\", hs_id AS \"hsID\" FROM dict_hs ORDER BY priority, id")).ToList();
        var sup = (await c.QueryAsync("SELECT keyword, full_name AS \"full\", customs_company AS customs FROM dict_supplier ORDER BY priority, id")).ToList();
        var translations = (await c.QueryAsync(@"
            SELECT keyword, english_name AS english, active, source
            FROM dict_translation ORDER BY active DESC, priority, id")).ToList();
        return Ok(new { hs, suppliers = sup, translations });
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
            await c.ExecuteAsync("DELETE FROM dict_hs;       DELETE FROM dict_supplier;", transaction: tx);
            var hs = body?.hs ?? new(); var sup = body?.suppliers ?? new();
            for (int i = 0; i < hs.Count; i++)
            {
                var r = hs[i];
                if (string.IsNullOrWhiteSpace(r.keyword)) continue;
                await c.ExecuteAsync(
                    "INSERT INTO dict_hs(keyword, hs_cn, hs_id, priority) VALUES (@k, @cn, @id, @p)",
                    new { k = r.keyword, cn = r.hsCN ?? "", id = r.hsID ?? "", p = i * 10 }, tx);
            }
            for (int i = 0; i < sup.Count; i++)
            {
                var r = sup[i];
                if (string.IsNullOrWhiteSpace(r.keyword)) continue;
                await c.ExecuteAsync(
                    "INSERT INTO dict_supplier(keyword, full_name, customs_company, priority) VALUES (@k, @f, @cc, @p)",
                    new { k = r.keyword, f = r.full ?? "", cc = r.customs ?? "", p = i * 10 }, tx);
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
            tx.Commit();
            return Ok(new { ok = true, hs_count = hs.Count, sup_count = sup.Count, translation_count = translations?.Count });
        }
        catch
        {
            tx.Rollback();
            throw;
        }
    }
}
