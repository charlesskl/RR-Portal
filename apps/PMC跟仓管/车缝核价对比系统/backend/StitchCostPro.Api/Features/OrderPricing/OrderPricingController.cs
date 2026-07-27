using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.OrderPricing;

[ApiController]
[Authorize(Roles = "业务,外发,管理层,管理员")]
[Route("api/order-pricing")]
public class OrderPricingController(OrderPricingService svc) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<OrderPricingDto>>>> List([FromQuery] string? keyword)
        => Ok(ApiResponse<List<OrderPricingDto>>.Ok(await svc.ListAsync(keyword)));

    [HttpPut("lines/{lineId:int}")]
    [Authorize(Roles = "外发,管理员")]
    public async Task<ActionResult<ApiResponse<bool>>> UpdateLine(int lineId, OrderPriceUpdateReq req)
    {
        var (ok, error) = await svc.UpdateLineAsync(lineId, req);
        return ok ? Ok(ApiResponse<bool>.Ok(true, "订单价格已保存")) : BadRequest(ApiResponse<bool>.Fail(error!));
    }

    [HttpGet("lines/{lineId:int}/history")]
    public async Task<ActionResult<ApiResponse<List<OrderPriceHistoryDto>>>> History(int lineId)
        => Ok(ApiResponse<List<OrderPriceHistoryDto>>.Ok(await svc.HistoryAsync(lineId)));
}
