using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;

namespace SprayPlan.Api.Features.Schedule;

public record DailyLineNoteDto(int LineId, string Date, string Text, int Version);
public record SaveDailyLineNote(string? Date, int LineId, string? Text, int Version);

[ApiController]
[Route("api/schedule/line-notes")]
[Authorize(Roles = "clerk,manager,admin")]
public class DailyLineNotesController(AppDbContext db) : ControllerBase
{
    [HttpPut]
    public async Task<IActionResult> Save(SaveDailyLineNote request)
    {
        if (!DateTime.TryParseExact(request.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var day))
            return BadRequest(new { error = "日期格式应为 YYYY-MM-DD" });
        if ((request.Text?.Length ?? 0) > 2000 || request.Version < 0)
            return BadRequest(new { error = "备注最多 2000 字，版本号不能为负数" });
        if (!await db.ProductionLines.AnyAsync(l => l.Id == request.LineId && l.IsActive))
            return NotFound(new { error = "拉别不存在或未启用" });

        var note = await db.DailyLineNotes.SingleOrDefaultAsync(n => n.LineId == request.LineId && n.NoteDate == day);
        if ((note?.Version ?? 0) != request.Version) return ConflictResult();
        if (note is null)
        {
            note = new DailyLineNote { LineId = request.LineId, NoteDate = day, FactoryId = db.CurrentFactoryId };
            db.DailyLineNotes.Add(note);
        }
        note.Text = request.Text?.Trim() ?? "";
        note.Version++;
        note.UpdatedAt = DateTime.UtcNow;
        note.UpdatedBy = User.FindFirst("username")?.Value ?? "unknown";
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateConcurrencyException) { return ConflictResult(); }
        catch (DbUpdateException ex) when (ex.InnerException is SqliteException { SqliteErrorCode: 19 })
        { return ConflictResult(); }
        return Ok(new DailyLineNoteDto(note.LineId, request.Date!, note.Text, note.Version));
    }

    ConflictObjectResult ConflictResult() => Conflict(new { error = "备注已被其他人更新，请刷新后重新编辑" });
}
