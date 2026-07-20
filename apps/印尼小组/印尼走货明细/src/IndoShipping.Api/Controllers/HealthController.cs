using Dapper;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace IndoShipping.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class HealthController : ControllerBase
{
    private readonly ISqlConnectionFactory _connFactory;
    private readonly ILogger<HealthController> _logger;

    public HealthController(ISqlConnectionFactory connFactory, ILogger<HealthController> logger)
    {
        _connFactory = connFactory;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        try
        {
            using var conn = _connFactory.Create();
            await conn.ExecuteScalarAsync<int>("SELECT 1");
            return Ok(new { ok = true, time = DateTime.UtcNow });
        }
        catch (Exception ex)
        {
            return ServiceUnavailable(ex);
        }
    }

    [HttpGet("db")]
    public async Task<IActionResult> Db()
    {
        try
        {
            using var conn = _connFactory.Create();
            var now = await conn.ExecuteScalarAsync<DateTime>("SELECT SYSUTCDATETIME()");
            return Ok(new { ok = true, time = now });
        }
        catch (Exception ex)
        {
            return ServiceUnavailable(ex);
        }
    }

    private ObjectResult ServiceUnavailable(Exception exception)
    {
        _logger.LogError(exception, "SQL Server health check failed.");
        return StatusCode(StatusCodes.Status503ServiceUnavailable, new { ok = false, error = "Service unavailable" });
    }
}
