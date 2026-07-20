using Dapper;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;

namespace IndoShipping.Api.Controllers;

[ApiController]
[Route("api/images")]
public class ImagesController(ISqlConnectionFactory factory) : ControllerBase
{
    public class UploadBody
    {
        public string? mime { get; set; }
        public string? data_url { get; set; }
        public string? id { get; set; }  // optional client-supplied id
    }

    [HttpPost]
    public async Task<IActionResult> Upload([FromBody] UploadBody body)
    {
        if (string.IsNullOrWhiteSpace(body?.data_url)) return BadRequest(new { error = "data_url required" });
        var id = string.IsNullOrWhiteSpace(body.id) ? "img_" + Guid.NewGuid().ToString("N")[..16] : body.id!;
        var mime = string.IsNullOrWhiteSpace(body.mime) ? "image/jpeg" : body.mime;
        using var c = factory.Create();
        await c.ExecuteAsync(@"
MERGE dbo.images AS t
USING (SELECT @id AS id) s ON t.id = s.id
WHEN MATCHED THEN UPDATE SET mime=@mime, data_url=@dataUrl
WHEN NOT MATCHED THEN INSERT (id, mime, data_url, created_at)
    VALUES (@id, @mime, @dataUrl, SYSUTCDATETIME());",
            new { id, mime, dataUrl = body.data_url });
        return Ok(new { ok = true, id });
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> Get(string id)
    {
        using var c = factory.Create();
        var row = await c.QueryFirstOrDefaultAsync<(string id, string? mime, string? data_url)?>(
            "SELECT id, mime, data_url FROM dbo.images WHERE id=@id", new { id });
        if (row == null) return NotFound();
        return Ok(new { id = row.Value.id, mime = row.Value.mime, data_url = row.Value.data_url });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        using var c = factory.Create();
        await c.ExecuteAsync("DELETE FROM dbo.images WHERE id=@id", new { id });
        return Ok(new { ok = true });
    }
}
