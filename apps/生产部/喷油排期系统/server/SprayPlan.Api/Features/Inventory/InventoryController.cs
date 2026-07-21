using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace SprayPlan.Api.Features.Inventory;

// 库存查询（W1 只读）。任意登录可读（含 viewer 统计组）。
[ApiController]
[Route("api/inventory")]
[Authorize]
public class InventoryController(InventoryService svc) : ControllerBase
{
    // GET /api/inventory/query?productId&itemName&partName → 各部位成品在库 + 散件可用
    [HttpGet("query")]
    public async Task<IActionResult> Query([FromQuery] int? productId, [FromQuery] string? itemName, [FromQuery] string? partName)
    {
        var rows = await svc.Query(productId, itemName, partName);
        return Ok(rows);
    }
}
