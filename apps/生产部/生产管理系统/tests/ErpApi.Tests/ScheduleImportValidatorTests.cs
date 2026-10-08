using System.Text.Json;
using ErpApi.Features.Scheduling;
using Xunit;

// 排期导入校验器(纯函数):状态白名单/自然键必填/列宽/日期与数字兜底
public class ScheduleImportValidatorTests
{
    private static ScheduleImportRow OkRow() => new()
    {
        行号 = 2,
        状态 = "在排",
        来源工作表 = "总排期",
        接单日期 = "2026-01-05",
        PO号 = "4500150146",
        客PO = "FB12137",
        货号 = "77625GQ1-S00",
        品名 = "迷你车仔",
        数量 = 8008m,
        总箱数 = "154",          // 字符串数字也要能过(前端 JSON 兜底)
        走货期 = "2026-03-01",
        验货期 = "2026-02-25",
    };

    [Fact]
    public void Valid_row_passes_with_parsed_types()
    {
        var (valid, failures) = ScheduleImportValidator.Validate(new[] { OkRow() });
        Assert.Empty(failures);
        var r = Assert.Single(valid);
        Assert.Equal("在排", r.状态);
        Assert.Equal(8008m, r.数量);
        Assert.Equal(154m, r.总箱数);
        Assert.Equal(new DateTime(2026, 3, 1), r.走货期);
    }

    [Fact]
    public void Missing_all_of_货号_PO号_客PO_fails()
    {
        var row = OkRow(); row.货号 = null; row.PO号 = "  "; row.客PO = null;
        var (valid, failures) = ScheduleImportValidator.Validate(new[] { row });
        Assert.Empty(valid);
        Assert.Contains(failures, f => f.原因.Contains("货号/PO号/客PO 不能都为空"));
    }

    [Fact]
    public void Invalid_status_fails()
    {
        var row = OkRow(); row.状态 = "生产中";
        var (valid, failures) = ScheduleImportValidator.Validate(new[] { row });
        Assert.Empty(valid);
        Assert.Contains(failures, f => f.原因.Contains("状态无效"));
    }

    [Fact]
    public void Blank_status_defaults_to_在排()
    {
        var row = OkRow(); row.状态 = null;
        var (valid, failures) = ScheduleImportValidator.Validate(new[] { row });
        Assert.Empty(failures);
        Assert.Equal("在排", Assert.Single(valid).状态);
    }

    [Fact]
    public void Bad_date_and_bad_number_fail()
    {
        var row = OkRow(); row.走货期 = "待定"; row.数量 = "若干";
        var (valid, failures) = ScheduleImportValidator.Validate(new[] { row });
        Assert.Empty(valid);
        var f = Assert.Single(failures);
        Assert.Contains("不是有效日期", f.原因);   // 走货期先于数量校验
    }

    [Fact]
    public void Overlong_品名_fails_length_check()
    {
        var row = OkRow(); row.品名 = new string('长', 201);
        var (valid, failures) = ScheduleImportValidator.Validate(new[] { row });
        Assert.Empty(valid);
        Assert.Contains(failures, f => f.原因.Contains("品名超过200字"));
    }

    [Fact]
    public void Huge_内箱_fails_instead_of_overflowing()
    {
        // 生产路径是 JsonElement(后端模型绑定);直接传 double 会走 ToString 兜底,行为不同
        var row = OkRow(); row.内箱 = JsonDocument.Parse("1e20").RootElement;
        var (valid, failures) = ScheduleImportValidator.Validate(new[] { row });
        Assert.Empty(valid);
        Assert.Contains(failures, f => f.原因.Contains("内箱超出整数范围"));
    }
}
