using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.Users;

public record ResetPasswordRequest(string NewPassword);

/// <summary>用户管理（仅管理员）：列表 / 新建 / 改资料 / 重置密码。</summary>
[ApiController]
[Authorize(Roles = "管理员")]      // 后端硬校验：非管理员一律 403
[Route("api/users")]
public class UsersController(UserService svc) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<UserDto>>>> List()
        => Ok(ApiResponse<List<UserDto>>.Ok(await svc.ListAsync()));

    [HttpPost]
    public async Task<ActionResult<ApiResponse<UserDto>>> Create(UserCreate req)
    {
        var (dto, error) = await svc.CreateAsync(req);
        return error is null
            ? Ok(ApiResponse<UserDto>.Ok(dto!, "创建成功"))
            : BadRequest(ApiResponse<UserDto>.Fail(error));
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<ApiResponse<UserDto>>> Update(int id, UserUpdate req)
    {
        var (dto, error) = await svc.UpdateAsync(id, req);
        return error is null
            ? Ok(ApiResponse<UserDto>.Ok(dto!, "更新成功"))
            : BadRequest(ApiResponse<UserDto>.Fail(error));
    }

    [HttpPost("{id:int}/reset-password")]
    public async Task<ActionResult<ApiResponse<object>>> ResetPassword(int id, ResetPasswordRequest req)
    {
        var error = await svc.ResetPasswordAsync(id, req.NewPassword);
        return error is null
            ? Ok(ApiResponse<object>.Ok(new { }, "已重置"))
            : BadRequest(ApiResponse<object>.Fail(error));
    }
}
