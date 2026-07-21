using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;

namespace SprayPlan.Api.Features.Basic;

// 机台 machines —— 对应现有 /api/machines + /api/machines/[id]。
[ApiController]
[Route("api/machines")]
[Authorize]
public class MachinesController(AppDbContext db) : ControllerBase
{
    // GET /api/machines —— 所有机台 + 所属拉别名/车间，按 id 升序
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var machines = await db.Machines.OrderBy(m => m.Id)
            .Select(m => new MachineWithLine(m.Id, m.MachineNo, m.LineId, m.MachineType, m.IsUV, m.IsActive, m.EquipmentKind,
                m.Line == null ? null : new LineBrief(m.Line.Name, m.Line.Workshop)))
            .ToListAsync();
        return Ok(machines);
    }

    // GET /api/machines/{id} —— 单台 + 所属拉别信息
    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var m = await db.Machines.Where(x => x.Id == id)
            .Select(x => new MachineWithLine(x.Id, x.MachineNo, x.LineId, x.MachineType, x.IsUV, x.IsActive, x.EquipmentKind,
                x.Line == null ? null : new LineBrief(x.Line.Name, x.Line.Workshop)))
            .FirstOrDefaultAsync();
        if (m is null) return NotFound(new { error = "机台不存在" });
        return Ok(m);
    }

    // POST /api/machines —— 新建（文员或主管）。校验：必填 → 拉别存在 → 同拉别内机台号不重复
    // 工艺/UV 标记继承所属拉别（整条拉一种工艺），不再由前端单独传
    [HttpPost]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Create([FromBody] CreateMachineRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.MachineNo) || req.LineId is null or 0)
            return BadRequest(new { error = "机台号和所属拉别必填" });

        var line = await db.ProductionLines.FindAsync(req.LineId.Value);
        if (line is null) return BadRequest(new { error = "所属拉别不存在" });

        if (await db.Machines.AnyAsync(m => m.LineId == req.LineId && m.MachineNo == req.MachineNo))
            return Conflict(new { error = "该拉别下机台号已存在" });

        var machine = new Machine
        {
            MachineNo = req.MachineNo.Trim(),
            LineId = req.LineId.Value,
            MachineType = line.CraftType,          // 继承拉别工艺
            IsUV = line.CraftType == "UV",         // UV 拉的机台标记 UV
            IsActive = true,
        };
        db.Machines.Add(machine);
        await db.SaveChangesAsync();
        return StatusCode(201, new MachineCreated(machine.Id, machine.MachineNo, machine.LineId, machine.IsUV));
    }

    // POST /api/machines/batch —— 批量录入（文员或主管）。一条拉一次贴一串机台号，
    // 工艺继承拉别；同拉别内已存在的号自动跳过（不报错），返回新建与跳过清单
    [HttpPost("batch")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> BatchCreate([FromBody] BatchCreateMachineRequest req)
    {
        if (req.LineId is null or 0) return BadRequest(new { error = "请先选择所属拉别" });
        var line = await db.ProductionLines.FindAsync(req.LineId.Value);
        if (line is null) return BadRequest(new { error = "所属拉别不存在" });
        if (string.IsNullOrWhiteSpace(req.Text)) return BadRequest(new { error = "请输入机台号" });

        // 按 逗号/中文逗号/顿号/分号/换行/制表 切分（不含空格——机台名本身可能带空格，如「1 号机（世通）」）
        // 去空、去重（保留首次出现顺序）
        var tokens = req.Text.Split(new[] { ',', '，', '、', ';', '；', '\n', '\r', '\t' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var wanted = new List<string>();
        var seen = new HashSet<string>();
        foreach (var t in tokens)
            if (seen.Add(t)) wanted.Add(t);
        if (wanted.Count == 0) return BadRequest(new { error = "没有识别到有效机台号" });

        // 该拉别已存在的号
        var existing = (await db.Machines.Where(m => m.LineId == req.LineId).Select(m => m.MachineNo).ToListAsync())
            .ToHashSet();

        var createdNos = new List<string>();
        var skipped = new List<string>();
        foreach (var no in wanted)
        {
            if (existing.Contains(no)) { skipped.Add(no); continue; }
            db.Machines.Add(new Machine
            {
                MachineNo = no,
                LineId = req.LineId.Value,
                MachineType = line.CraftType,
                IsUV = line.CraftType == "UV",
                IsActive = true,
            });
            createdNos.Add(no);
        }
        await db.SaveChangesAsync();
        return Ok(new BatchCreateResult(createdNos.Count, createdNos, skipped));
    }

    // PATCH /api/machines/{id} —— 部分更新（文员或主管）
    [HttpPatch("{id:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateMachineRequest req)
    {
        var m = await db.Machines.FindAsync(id);
        if (m is null) return NotFound(new { error = "机台不存在" });

        // 目标拉别（改了就用新的，否则用原拉别）—— 工艺/UV 跟着拉别走
        var targetLineId = req.LineId ?? m.LineId;
        var targetNo = string.IsNullOrWhiteSpace(req.MachineNo) ? m.MachineNo : req.MachineNo.Trim();

        // 改了拉别：校验存在
        if (req.LineId is not null && req.LineId != m.LineId
            && !await db.ProductionLines.AnyAsync(l => l.Id == req.LineId))
            return BadRequest(new { error = "所属拉别不存在" });

        // 机台号或拉别变了：同拉别内不能与其它机台重名
        if ((targetNo != m.MachineNo || targetLineId != m.LineId)
            && await db.Machines.AnyAsync(x => x.LineId == targetLineId && x.MachineNo == targetNo && x.Id != m.Id))
            return Conflict(new { error = "该拉别下机台号已存在" });

        m.MachineNo = targetNo;
        m.LineId = targetLineId;
        if (req.IsActive is not null) m.IsActive = req.IsActive.Value;
        if (req.EquipmentKind is not null) m.EquipmentKind = req.EquipmentKind;

        // 工艺/UV 标记始终同步成所属拉别的工艺（不由前端单独改）
        var line = await db.ProductionLines.FindAsync(targetLineId);
        if (line is not null) { m.MachineType = line.CraftType; m.IsUV = line.CraftType == "UV"; }

        await db.SaveChangesAsync();
        return Ok(new MachineUpdated(m.Id, m.MachineNo, m.MachineType, m.IsUV, m.IsActive, m.EquipmentKind));
    }

    // DELETE /api/machines/{id} —— 真删（文员或主管）。机台无外键被引用（排期里机台号是 JSON 文本快照），可硬删
    [HttpDelete("{id:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var m = await db.Machines.FindAsync(id);
        if (m is null) return NotFound(new { error = "机台不存在" });
        db.Machines.Remove(m);
        await db.SaveChangesAsync();
        return Ok(new { id });
    }
}
