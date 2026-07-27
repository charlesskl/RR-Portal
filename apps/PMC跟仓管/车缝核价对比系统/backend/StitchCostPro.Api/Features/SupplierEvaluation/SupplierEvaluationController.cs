using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.SupplierEvaluation;

[ApiController]
[Authorize]
[Route("api/supplier-evaluation")]
public class SupplierEvaluationController(SupplierEvaluationService svc, ICurrentUser current) : ControllerBase
{
    /// <summary>全部启用加工厂的累计综合评价；无业务数据的加工厂返回“未评级”。</summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<EvaluationRow>>>> Get()
        => Ok(ApiResponse<List<EvaluationRow>>.Ok(await svc.EvaluateAsync()));

    [HttpGet("{supplierId:int}")]
    public async Task<ActionResult<ApiResponse<EvaluationDetailDto>>> Detail(int supplierId)
    {
        var detail = await svc.GetDetailAsync(supplierId);
        return detail is null
            ? NotFound(ApiResponse<EvaluationDetailDto>.Fail("加工厂不存在"))
            : Ok(ApiResponse<EvaluationDetailDto>.Ok(detail));
    }

    [HttpGet("settings")]
    public async Task<ActionResult<ApiResponse<EvaluationSettings>>> Settings([FromQuery] int deptId)
        => Ok(ApiResponse<EvaluationSettings>.Ok(await svc.GetSettingsAsync(deptId)));

    [HttpPut("settings")]
    [Authorize(Roles = "管理员")]
    public async Task<ActionResult<ApiResponse<EvaluationSettings>>> UpdateSettings(
        [FromQuery] int deptId, EvaluationSettings settings)
    {
        var error = await svc.SaveSettingsAsync(deptId, settings, current.UserId);
        return error is null
            ? Ok(ApiResponse<EvaluationSettings>.Ok(await svc.GetSettingsAsync(deptId), "评价参数已生效"))
            : BadRequest(ApiResponse<EvaluationSettings>.Fail(error));
    }
}
