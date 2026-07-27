using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.Suppliers;

[ApiController]
[Authorize]
[Route("api/suppliers")]
public class SupplierController(SupplierService svc, SupplierImportService importSvc) : ControllerBase
{
    [HttpPost("import/preview")]
    public async Task<ActionResult<ApiResponse<SupplierImportPreviewResult>>> ImportPreview(SupplierImportPreviewReq req)
        => Ok(ApiResponse<SupplierImportPreviewResult>.Ok(await importSvc.PreviewAsync(req.DeptId, req.Rows)));

    [HttpPost("import/commit")]
    public async Task<ActionResult<ApiResponse<SupplierImportCommitResult>>> ImportCommit(SupplierImportCommitReq req)
        => Ok(ApiResponse<SupplierImportCommitResult>.Ok(await importSvc.CommitAsync(req), "导入完成"));

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<SupplierDto>>>> List(
        [FromQuery] string? keyword, [FromQuery] int? deptId, [FromQuery] bool includeInactive = false)
        => Ok(ApiResponse<List<SupplierDto>>.Ok(await svc.ListAsync(keyword, deptId, includeInactive)));

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ApiResponse<SupplierDto>>> Get(int id)
    {
        var dto = await svc.GetAsync(id);
        return dto is null ? NotFound(ApiResponse<SupplierDto>.Fail("供应商不存在")) : Ok(ApiResponse<SupplierDto>.Ok(dto));
    }

    [HttpPost]
    public async Task<ActionResult<ApiResponse<SupplierDto>>> Create(SupplierUpsert req)
    {
        var (dto, error) = await svc.CreateAsync(req);
        return error is null ? Ok(ApiResponse<SupplierDto>.Ok(dto!, "创建成功")) : BadRequest(ApiResponse<SupplierDto>.Fail(error));
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<ApiResponse<SupplierDto>>> Update(int id, SupplierUpsert req)
    {
        var (dto, error) = await svc.UpdateAsync(id, req);
        return error is null ? Ok(ApiResponse<SupplierDto>.Ok(dto!, "更新成功")) : BadRequest(ApiResponse<SupplierDto>.Fail(error));
    }

    [HttpDelete("{id:int}")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(int id)
    {
        var (ok, error) = await svc.DeleteAsync(id);
        return ok ? Ok(ApiResponse<bool>.Ok(true, "已删除")) : BadRequest(ApiResponse<bool>.Fail(error!));
    }
}
