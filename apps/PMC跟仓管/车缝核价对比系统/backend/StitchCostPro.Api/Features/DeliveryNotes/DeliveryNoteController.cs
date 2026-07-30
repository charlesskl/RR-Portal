using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.DeliveryNotes;

[ApiController]
[Authorize]
[Route("api/delivery-notes")]
public class DeliveryNoteController(DeliveryNoteService svc) : ControllerBase
{
    /// <summary>查某采购订单的所有回货批次（带抽检明细、不良率、批次交期）。</summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<DeliveryNoteDto>>>> ListByOrder([FromQuery] int orderId)
        => Ok(ApiResponse<List<DeliveryNoteDto>>.Ok(await svc.ListByOrderAsync(orderId)));

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ApiResponse<DeliveryNoteDto>>> Get(int id)
    {
        var dto = await svc.GetAsync(id);
        return dto is null ? NotFound(ApiResponse<DeliveryNoteDto>.Fail("回货批次不存在")) : Ok(ApiResponse<DeliveryNoteDto>.Ok(dto));
    }

    [HttpPost]
    [Authorize(Roles = "管理员")]
    public async Task<ActionResult<ApiResponse<int>>> Create(DeliveryNoteUpsert req)
    {
        var (id, error) = await svc.CreateAsync(req);
        return error is null ? Ok(ApiResponse<int>.Ok(id, "已保存")) : BadRequest(ApiResponse<int>.Fail(error));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "业务,外发,跟单,管理员")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(int id)
    {
        var (ok, error) = await svc.DeleteAsync(id);
        return ok ? Ok(ApiResponse<bool>.Ok(true, "已删除")) : BadRequest(ApiResponse<bool>.Fail(error!));
    }
}
