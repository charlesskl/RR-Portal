using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.PriceBoard;

[ApiController]
[Authorize]
[Route("api/price-board")]
public class PriceBoardController(PriceBoardService svc) : ControllerBase
{
    /// <summary>核价对比看板（以采购订单为源，时间段 [from,to] 按下单日期）。</summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<PriceBoardDto>>> Get(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to)
        => Ok(ApiResponse<PriceBoardDto>.Ok(await svc.GetAsync(from, to)));
}
