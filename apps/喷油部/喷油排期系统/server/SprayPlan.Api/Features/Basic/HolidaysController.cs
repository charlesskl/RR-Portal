using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Features.Basic;

[ApiController]
[Route("api/holidays")]
[Authorize]
public class HolidaysController(AppDbContext db) : ControllerBase
{
    private static readonly string[] Types = ["holiday", "workday"];

    // GET /api/holidays?year=2026 —— 不传 year 返回全部，按日期升序
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int? year)
    {
        var all = await db.Holidays.OrderBy(h => h.Date).ToListAsync();
        var filtered = year is null ? all : all.Where(h => h.Date.Year == year.Value).ToList();
        return Ok(filtered.Select(h => new HolidayDto(h.Id, ScheduleCalc.Ymd(h.Date), h.Type, h.Remark)));
    }

    [HttpPost]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Create([FromBody] CreateHolidayRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Date)) return BadRequest(new { error = "日期必填" });
        var type = string.IsNullOrWhiteSpace(req.Type) ? "holiday" : req.Type;
        if (!Types.Contains(type)) return BadRequest(new { error = "类型无效（holiday/workday）" });

        DateTime date;
        try { date = DateUtil.ParseUtc(req.Date); }
        catch { return BadRequest(new { error = "日期格式应为 YYYY-MM-DD" }); }

        if (await db.Holidays.AnyAsync(h => h.Date == date))
            return BadRequest(new { error = "该日期已存在" });

        var holiday = new Holiday { Date = date, Type = type, Remark = string.IsNullOrEmpty(req.Remark) ? null : req.Remark };
        db.Holidays.Add(holiday);
        await db.SaveChangesAsync();
        return StatusCode(201, new HolidayDto(holiday.Id, ScheduleCalc.Ymd(holiday.Date), holiday.Type, holiday.Remark));
    }

    // PATCH /api/holidays/{id} —— 编辑（文员或主管）：可改日期/类型/备注
    [HttpPatch("{id:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateHolidayRequest req)
    {
        var holiday = await db.Holidays.FindAsync(id);
        if (holiday is null) return NotFound(new { error = "记录不存在" });

        if (req.Type is not null)
        {
            if (!Types.Contains(req.Type)) return BadRequest(new { error = "类型无效（holiday/workday）" });
            holiday.Type = req.Type;
        }
        if (req.Remark is not null) holiday.Remark = string.IsNullOrEmpty(req.Remark) ? null : req.Remark;
        if (!string.IsNullOrWhiteSpace(req.Date))
        {
            DateTime date;
            try { date = DateUtil.ParseUtc(req.Date); }
            catch { return BadRequest(new { error = "日期格式应为 YYYY-MM-DD" }); }
            // 改到别的日期时，不能和已有记录撞日期
            if (date != holiday.Date && await db.Holidays.AnyAsync(h => h.Date == date && h.Id != id))
                return BadRequest(new { error = "该日期已存在" });
            holiday.Date = date;
        }

        await db.SaveChangesAsync();
        return Ok(new HolidayDto(holiday.Id, ScheduleCalc.Ymd(holiday.Date), holiday.Type, holiday.Remark));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var holiday = await db.Holidays.FindAsync(id);
        if (holiday is null) return NotFound(new { error = "记录不存在" });
        db.Holidays.Remove(holiday);   // 节假日是配置数据，真删
        await db.SaveChangesAsync();
        return Ok(new { id });
    }
}
