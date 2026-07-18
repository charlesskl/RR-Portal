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
    public class Body    { public List<HsItem>? hs { get; set; } public List<SupItem>? suppliers { get; set; } }

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        using var c = factory.Create();
        var hs  = (await c.QueryAsync("SELECT keyword, hs_cn AS hsCN, hs_id AS hsID FROM dbo.dict_hs ORDER BY priority, id")).ToList();
        var sup = (await c.QueryAsync("SELECT keyword, full_name AS [full], customs_company AS customs FROM dbo.dict_supplier ORDER BY priority, id")).ToList();
        return Ok(new { hs, suppliers = sup });
    }

    [HttpPut]
    public async Task<IActionResult> Put([FromBody] Body body)
    {
        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        try
        {
            await c.ExecuteAsync("DELETE FROM dbo.dict_hs;       DELETE FROM dbo.dict_supplier;", transaction: tx);
            var hs = body?.hs ?? new(); var sup = body?.suppliers ?? new();
            for (int i = 0; i < hs.Count; i++)
            {
                var r = hs[i];
                if (string.IsNullOrWhiteSpace(r.keyword)) continue;
                await c.ExecuteAsync(
                    "INSERT INTO dbo.dict_hs(keyword, hs_cn, hs_id, priority) VALUES (@k, @cn, @id, @p)",
                    new { k = r.keyword, cn = r.hsCN ?? "", id = r.hsID ?? "", p = i * 10 }, tx);
            }
            for (int i = 0; i < sup.Count; i++)
            {
                var r = sup[i];
                if (string.IsNullOrWhiteSpace(r.keyword)) continue;
                await c.ExecuteAsync(
                    "INSERT INTO dbo.dict_supplier(keyword, full_name, customs_company, priority) VALUES (@k, @f, @cc, @p)",
                    new { k = r.keyword, f = r.full ?? "", cc = r.customs ?? "", p = i * 10 }, tx);
            }
            tx.Commit();
            return Ok(new { ok = true, hs_count = hs.Count, sup_count = sup.Count });
        }
        catch
        {
            tx.Rollback();
            throw;
        }
    }
}
