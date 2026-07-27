using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.QualityInspections;

[ApiController]
[Authorize]
[Route("api/quality-inspections")]
public class QualityInspectionController(QualityInspectionService svc) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<QualityRow>>>> List(
        [FromQuery] int? supplierId, [FromQuery] string? keyword)
        => Ok(ApiResponse<List<QualityRow>>.Ok(await svc.ListAsync(supplierId, keyword)));

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ApiResponse<QualityRow>>> Get(int id)
    {
        var dto = await svc.GetAsync(id);
        return dto is null ? NotFound(ApiResponse<QualityRow>.Fail("记录不存在")) : Ok(ApiResponse<QualityRow>.Ok(dto));
    }

    /// <summary>选订单后列出该订单的款（货号→款式下拉）。</summary>
    [HttpGet("order-lines")]
    public async Task<ActionResult<ApiResponse<List<OrderLineOptionDto>>>> OrderLines([FromQuery] int orderId)
        => Ok(ApiResponse<List<OrderLineOptionDto>>.Ok(await svc.GetOrderLinesAsync(orderId)));

    /// <summary>加工厂品质汇总（本期 [from,to] + 上期对比）。</summary>
    [HttpGet("summary")]
    public async Task<ActionResult<ApiResponse<List<QualitySummaryRow>>>> Summary(
        [FromQuery] int? deptId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
        => Ok(ApiResponse<List<QualitySummaryRow>>.Ok(await svc.SummaryAsync(deptId, from, to)));

    [HttpPost]
    [Authorize(Roles = "跟单,品质,管理员")]
    public async Task<ActionResult<ApiResponse<int>>> Create(QualityUpsert req)
    {
        var (id, error) = await svc.CreateAsync(req);
        return error is null ? Ok(ApiResponse<int>.Ok(id, "已保存")) : BadRequest(ApiResponse<int>.Fail(error));
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "跟单,品质,管理员")]
    public async Task<ActionResult<ApiResponse<bool>>> Update(int id, QualityUpsert req)
    {
        var (ok, error) = await svc.UpdateAsync(id, req);
        return ok ? Ok(ApiResponse<bool>.Ok(true, "已保存")) : BadRequest(ApiResponse<bool>.Fail(error!));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "跟单,品质,管理员")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(int id)
    {
        var (ok, error) = await svc.DeleteAsync(id);
        return ok ? Ok(ApiResponse<bool>.Ok(true, "已删除")) : BadRequest(ApiResponse<bool>.Fail(error!));
    }
}
