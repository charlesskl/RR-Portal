using System.Security.Claims;
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Assembly;

// 委托加工单 行级单价记忆的读取端点:选半成品/物料入行时按货号批量带出最近单价。
// 写入在 AssemblyPurchaseOrderService 保存(Create/Update)同事务 MERGE,不单开写端点。
[ApiController]
[Authorize]
[Route("api/processing-prices")]
public sealed class ProcessingPriceMemoryController(ISqlConnectionFactory factory, IPermissionService perms) : ControllerBase
{
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    // GET api/processing-prices?items=B1,B2 → { prices: { "B1": 1.5 } };只返回有记忆的货号
    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] string? items)
    {
        if (!await perms.HasAsync(CurrentUser, "委托加工单", PermissionAction.打开)) return Forbid();
        var keys = (items ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct().Take(200).ToArray();
        if (keys.Length == 0) return Ok(new { prices = new Dictionary<string, decimal>() });
        using var c = factory.Create();
        var rows = await c.QueryAsync<(string 货号, decimal 单价)>(
            "SELECT [货号],[单价] FROM [加工单价记忆] WHERE [货号] IN @keys", new { keys });
        return Ok(new { prices = rows.ToDictionary(r => r.货号, r => r.单价) });
    }
}
