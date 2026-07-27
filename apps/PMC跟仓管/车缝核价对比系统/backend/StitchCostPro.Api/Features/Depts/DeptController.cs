using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.Depts;

[ApiController]
[Authorize]
[Route("api/depts")]
public class DeptController(DeptService svc) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<DeptDto>>>> List([FromQuery] bool includeInactive = false)
        => Ok(ApiResponse<List<DeptDto>>.Ok(await svc.ListAsync(includeInactive)));

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ApiResponse<DeptDto>>> Get(int id)
    {
        var dto = await svc.GetAsync(id);
        return dto is null ? NotFound(ApiResponse<DeptDto>.Fail("部门不存在")) : Ok(ApiResponse<DeptDto>.Ok(dto));
    }

    [HttpPost]
    public async Task<ActionResult<ApiResponse<DeptDto>>> Create(DeptUpsert req)
    {
        var (dto, error) = await svc.CreateAsync(req);
        return error is null ? Ok(ApiResponse<DeptDto>.Ok(dto!, "创建成功")) : BadRequest(ApiResponse<DeptDto>.Fail(error));
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<ApiResponse<DeptDto>>> Update(int id, DeptUpsert req)
    {
        var (dto, error) = await svc.UpdateAsync(id, req);
        return error is null ? Ok(ApiResponse<DeptDto>.Ok(dto!, "更新成功")) : BadRequest(ApiResponse<DeptDto>.Fail(error));
    }
}
