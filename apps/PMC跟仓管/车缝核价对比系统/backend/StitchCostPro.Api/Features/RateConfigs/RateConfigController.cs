using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.RateConfigs;

[ApiController]
[Authorize]
[Route("api/rate-configs")]
public class RateConfigController(RateConfigService svc) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<RateConfigDto>>>> List(
        [FromQuery] string? rateType, [FromQuery] int? deptId)
        => Ok(ApiResponse<List<RateConfigDto>>.Ok(await svc.ListAsync(rateType, deptId)));

    [HttpGet("current")]
    public async Task<ActionResult<ApiResponse<RateConfigDto>>> Current(
        [FromQuery] string rateType, [FromQuery] int deptId)
    {
        var dto = await svc.GetCurrentAsync(rateType, deptId);
        return dto is null
            ? NotFound(ApiResponse<RateConfigDto>.Fail($"未找到 {rateType} 的当前生效配置"))
            : Ok(ApiResponse<RateConfigDto>.Ok(dto));
    }

    [HttpPost]
    [Authorize(Roles = "管理员")]
    public async Task<ActionResult<ApiResponse<RateConfigDto>>> Create(RateConfigCreate req)
    {
        var (dto, error) = await svc.CreateAsync(req);
        return error is null
            ? Ok(ApiResponse<RateConfigDto>.Ok(dto!, "创建成功"))
            : BadRequest(ApiResponse<RateConfigDto>.Fail(error));
    }
}
