using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;

namespace SprayPlan.Api.Features.Basic;

// 拉别 production_lines —— 对应现有 /api/lines + /api/lines/[id]。
// 类级 [Authorize]=读操作要登录(requireLogin，viewer 也行)；写方法另加 clerk,admin(requireClerkOrAdmin)。
[ApiController]
[Route("api/lines")]
[Authorize]
public class LinesController(AppDbContext db) : ControllerBase
{
    // GET /api/lines —— 所有拉别 + 活跃机台(按机台号升序)。按拉别名升序 = A拉/B拉/C拉/UV拉（名字以字母开头，A<B<C<U）。
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var lines = await db.ProductionLines.OrderBy(l => l.Name)
            .Select(l => new LineWithMachines(l.Id, l.Name, l.Workshop, l.LeaderName, l.CraftType, l.IsActive, l.DailyCapacityLimit,
                l.Machines.Where(m => m.IsActive).OrderBy(m => m.MachineNo)
                    .Select(m => new MachineBrief(m.Id, m.MachineNo, m.LineId, m.MachineType, m.IsUV, m.IsActive))
                    .ToList()))
            .ToListAsync();
        return Ok(lines);
    }

    // GET /api/lines/{id} —— 单条 + 所有机台
    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var line = await db.ProductionLines.Where(l => l.Id == id)
            .Select(l => new LineWithMachines(l.Id, l.Name, l.Workshop, l.LeaderName, l.CraftType, l.IsActive, l.DailyCapacityLimit,
                l.Machines.OrderBy(m => m.Id)
                    .Select(m => new MachineBrief(m.Id, m.MachineNo, m.LineId, m.MachineType, m.IsUV, m.IsActive))
                    .ToList()))
            .FirstOrDefaultAsync();
        if (line is null) return NotFound(new { error = "拉别不存在" });
        return Ok(line);
    }

    // POST /api/lines —— 新建（文员或主管）。name+workshop 必填
    [HttpPost]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Create([FromBody] CreateLineRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Name) || string.IsNullOrWhiteSpace(req.Workshop))
            return BadRequest(new { error = "拉别名和车间必填" });

        // 工艺类型：传了就校验合法，没传默认「移印」
        var craft = string.IsNullOrWhiteSpace(req.CraftType) ? "移印" : req.CraftType;
        if (!CraftTypes.IsValid(craft))
            return BadRequest(new { error = "工艺类型无效（手喷/移印/自动喷/UV）" });

        var line = new ProductionLine
        {
            Name = req.Name,
            Workshop = req.Workshop,
            LeaderName = string.IsNullOrEmpty(req.LeaderName) ? null : req.LeaderName,
            CraftType = craft,
            IsActive = true,
            DailyCapacityLimit = req.DailyCapacityLimit ?? 0,   // 不传默认0=不卡产能
        };
        db.ProductionLines.Add(line);
        await db.SaveChangesAsync();
        return StatusCode(201, new LineCreated(line.Id, line.Name, line.Workshop, line.CraftType, line.DailyCapacityLimit));
    }

    // PATCH /api/lines/{id} —— 部分更新（文员或主管）
    [HttpPatch("{id:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateLineRequest req)
    {
        var line = await db.ProductionLines.FindAsync(id);
        if (line is null) return NotFound(new { error = "拉别不存在" });

        if (req.Name is not null) line.Name = req.Name;
        if (req.Workshop is not null) line.Workshop = req.Workshop;
        if (req.LeaderName is not null) line.LeaderName = string.IsNullOrEmpty(req.LeaderName) ? null : req.LeaderName;
        if (req.IsActive is not null) line.IsActive = req.IsActive.Value;
        if (req.DailyCapacityLimit is not null) line.DailyCapacityLimit = req.DailyCapacityLimit.Value;  // 每天产能上限（件）

        // 工艺类型改了：校验合法，并把该拉所有机台的机型/UV标记同步成新工艺（整条拉一种工艺）
        if (req.CraftType is not null)
        {
            if (!CraftTypes.IsValid(req.CraftType))
                return BadRequest(new { error = "工艺类型无效（手喷/移印/自动喷/UV）" });
            if (line.CraftType != req.CraftType)
            {
                line.CraftType = req.CraftType;
                var machines = await db.Machines.Where(m => m.LineId == line.Id).ToListAsync();
                foreach (var m in machines)
                {
                    m.MachineType = req.CraftType;
                    m.IsUV = req.CraftType == "UV";
                }
            }
        }

        await db.SaveChangesAsync();
        return Ok(new LineUpdated(line.Id, line.Name, line.Workshop, line.CraftType, line.IsActive, line.DailyCapacityLimit));
    }

    // DELETE /api/lines/{id} —— 软删（文员或主管），isActive=false
    [HttpDelete("{id:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var line = await db.ProductionLines.FindAsync(id);
        if (line is null) return NotFound(new { error = "拉别不存在" });
        line.IsActive = false;
        await db.SaveChangesAsync();
        return Ok(new IdActive(line.Id, line.IsActive));
    }
}
