namespace ErpApi.Features.Payroll;

public sealed class PieceworkPayrollRow
{
    public string? 编号 { get; set; }
    public string? 姓名 { get; set; }
    public string? 部门编号 { get; set; }
    public string? 部门 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 计件工资 { get; set; }
}

// ---- 缺勤登记 ----
public sealed class AbsenceCreateDto
{
    public string 工号 { get; set; } = "";
    public string? 姓名 { get; set; }
    public string? 部门 { get; set; }
    public string? 登记类型 { get; set; }
    public string? 前后段 { get; set; }
    public decimal 计算出勤 { get; set; }
    public DateTime 日期 { get; set; }
    public string? 开始时间 { get; set; }
    public string? 结束时间 { get; set; }
    public string? 事由 { get; set; }
}
public sealed class AbsenceRow
{
    public long ID { get; set; }
    public string? 工号 { get; set; }
    public string? 姓名 { get; set; }
    public string? 部门 { get; set; }
    public string? 登记类型 { get; set; }
    public string? 前后段 { get; set; }
    public decimal? 计算出勤 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 事由 { get; set; }
}

// ---- 月度出勤汇总 ----
public sealed class AttendanceMonthlyRow
{
    public string? 工号 { get; set; }
    public string? 姓名 { get; set; }
    public string? 部门编号 { get; set; }
    public string? 部门 { get; set; }
    public decimal 应出勤天数 { get; set; }
    public decimal 缺勤天数 { get; set; }
    public decimal 实出勤天数 { get; set; }
    public decimal? 出勤工时 { get; set; }
    public decimal? 加班工时 { get; set; }
    public int? 迟到次数 { get; set; }
    public int? 早退次数 { get; set; }
}

// ---- 工资模板 ----
public sealed class WageTemplateItemDto
{ public int 序号 { get; set; } public string? 台头项目 { get; set; } public string? 类型 { get; set; } public string? 公式 { get; set; } }
public sealed class WageTemplateSaveDto
{ public string 模板编号 { get; set; } = ""; public string? 模板名称 { get; set; } public List<WageTemplateItemDto> 明细 { get; set; } = []; }
public sealed class WageTemplateHeaderDto
{ public string? 模板编号 { get; set; } public string? 模板名称 { get; set; } public int 项目数 { get; set; } }
public sealed class WageTemplateDetailDto
{ public string? 模板编号 { get; set; } public string? 模板名称 { get; set; } public List<WageTemplateItemDto> 明细 { get; set; } = []; }

// ---- 工资表生成/查询 ----
public sealed class PayrollGenerateDto
{ public string 月份 { get; set; } = ""; public string 部门编号 { get; set; } = ""; public string 模板编号 { get; set; } = ""; public decimal 应出勤天数 { get; set; } }
public sealed class PayrollSummaryRow
{ public string? 工资表编号 { get; set; } public string? 月份 { get; set; } public string? 部门编号 { get; set; } public string? 模板编号 { get; set; } public decimal? 基本工资 { get; set; } public decimal? 计件工资 { get; set; } public decimal? 应发合计 { get; set; } public decimal? 应扣合计 { get; set; } public decimal? 实发合计 { get; set; } }
public sealed class PayrollItemCol
{ public string? 列名 { get; set; } public string? 台头项目 { get; set; } public string? 类型 { get; set; } }
public sealed class PayrollDetailDto
{ public PayrollSummaryRow? 单头 { get; set; } public List<PayrollItemCol> 项目 { get; set; } = []; public List<Dictionary<string, object?>> 明细 { get; set; } = []; }

// ---- 考勤·班次 ----
public sealed class ShiftDto
{
    public string 识别 { get; set; } = ""; public string? 名称 { get; set; }
    public string? 上午上班 { get; set; } public string? 上午下班 { get; set; }   // "HH:mm"
    public string? 下午上班 { get; set; } public string? 下午下班 { get; set; }
    public decimal? 总小时 { get; set; } public decimal? 迟到分钟 { get; set; } public decimal? 早退分钟 { get; set; }
}
public sealed class ShiftRow
{
    public string? 识别 { get; set; } public string? 名称 { get; set; }
    public string? 上午上班 { get; set; } public string? 上午下班 { get; set; }
    public string? 下午上班 { get; set; } public string? 下午下班 { get; set; }
    public decimal? 总小时 { get; set; } public decimal? 迟到分钟 { get; set; } public decimal? 早退分钟 { get; set; }
}
// ---- 考勤·排班 ----
public sealed class RosterRow
{ public string? 工号 { get; set; } public string? 姓名 { get; set; } public DateTime? 日期 { get; set; } public string? 班次 { get; set; } }
public sealed class RosterAssignDto
{ public List<string> 工号集合 { get; set; } = []; public DateTime 开始日期 { get; set; } public DateTime 结束日期 { get; set; } public string 班次 { get; set; } = ""; }

// ---- 考勤·日报 ----
public sealed class DailySaveDto
{ public string 工号 { get; set; } = ""; public DateTime 日期 { get; set; } public List<string> 刷卡 { get; set; } = []; }  // 刷卡 "HH:mm"
public sealed class DailyRow
{
    public string? 工号 { get; set; } public string? 姓名 { get; set; } public string? 部门 { get; set; } public DateTime? 日期 { get; set; }
    public decimal? 上午 { get; set; } public decimal? 下午 { get; set; } public decimal? 合计时间 { get; set; } public decimal? 加班 { get; set; }
    public int? 迟到分 { get; set; } public int? 早退分 { get; set; } public int? 迟到次数 { get; set; } public int? 早退次数 { get; set; }
}
