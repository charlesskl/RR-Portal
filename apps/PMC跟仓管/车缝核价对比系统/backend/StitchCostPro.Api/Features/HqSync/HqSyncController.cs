using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.HqSync;

public record HqSyncStatusDto(List<IntegrationSyncState> States, List<IntegrationSyncLog> Logs);

[ApiController]
[Authorize]
[Route("api/hq-sync")]
public class HqSyncController(HqSyncService svc, AppDbContext db) : ControllerBase
{
    /// <summary>手动触发一整轮同步（先加工厂后订单）。不与定时任务并发。</summary>
    [HttpPost("run")]
    [Authorize(Roles = "管理员")]
    public async Task<ActionResult<ApiResponse<HqSyncRunResult>>> Run()
    {
        // 不随请求取消：客户端断连也让本轮同步跑完
        var result = await svc.RunAsync();
        return result is null
            ? Conflict(ApiResponse<HqSyncRunResult>.Fail("已有同步任务正在运行"))
            : Ok(ApiResponse<HqSyncRunResult>.Ok(result));
    }

    /// <summary>同步状态：各资源游标 + 最近 20 条同步日志。</summary>
    [HttpGet("status")]
    public async Task<ActionResult<ApiResponse<HqSyncStatusDto>>> Status()
    {
        var states = await db.IntegrationSyncStates.AsNoTracking().OrderBy(x => x.ResourceType).ToListAsync();
        var logs = await db.IntegrationSyncLogs.AsNoTracking().OrderByDescending(x => x.Id).Take(20).ToListAsync();
        return Ok(ApiResponse<HqSyncStatusDto>.Ok(new HqSyncStatusDto(states, logs)));
    }
}
