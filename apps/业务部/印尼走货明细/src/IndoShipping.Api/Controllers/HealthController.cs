using Dapper;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;

namespace IndoShipping.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class HealthController(ISqlConnectionFactory connFactory) : ControllerBase
{
    [HttpGet]
    public IActionResult Get() => Ok(new { ok = true, time = DateTime.UtcNow });

    [HttpGet("db")]
    public async Task<IActionResult> Db()
    {
        try
        {
            using var conn = connFactory.Create();
            var now = await conn.ExecuteScalarAsync<DateTime>("SELECT SYSUTCDATETIME()");
            return Ok(new { ok = true, time = now });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { ok = false, error = ex.Message });
        }
    }
}
