using ErpApi.Features.MasterData;
namespace ErpApi.Features.Scheduling;

// 客户排期 Excel 导入:请求行(前端已按表头别名映射/推定状态/格式化日期,后端只做兜底校验)。
public sealed class ScheduleImportRow
{
    public int 行号 { get; set; }
    public string? 状态 { get; set; }        // 在排/已走货/已取消,缺省按在排
    public string? 来源工作表 { get; set; }
    public string? 接单日期 { get; set; }    // yyyy-MM-dd(前端已格式化)
    public string? 客户名称 { get; set; }
    public string? 国家 { get; set; }
    public string? PO号 { get; set; }
    public string? 客PO { get; set; }
    public string? SKU { get; set; }
    public string? 货号 { get; set; }
    public string? 品名 { get; set; }
    // 数字列用 object 接收(JSON 数字或字符串),校验时兜底拒绝非数字
    public object? 数量 { get; set; }
    public object? 内箱 { get; set; }
    public object? 外箱 { get; set; }
    public object? 总箱数 { get; set; }
    public string? 走货期 { get; set; }
    public string? 验货期 { get; set; }
    public string? 第三方验货 { get; set; }
    public string? 车间 { get; set; }
    public string? 备注 { get; set; }
    // 整行原始 JSON(原表头→原值逐字保留,万全兜底,不参与校验)
    public string? 原始数据 { get; set; }
}

public sealed class ScheduleImportRequest
{
    public string 排期客户 { get; set; } = "";
    public string? 文件名 { get; set; }
    public List<ScheduleImportRow> Rows { get; set; } = new();
}

// 校验通过的待入库行(日期/数字已解析为强类型)
public sealed class ValidScheduleImportRow
{
    public int 行号 { get; set; }
    public string 状态 { get; set; } = "在排";
    public string? 来源工作表 { get; set; }
    public DateTime? 接单日期 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 国家 { get; set; }
    public string? PO号 { get; set; }
    public string? 客PO { get; set; }
    public string? SKU { get; set; }
    public string? 货号 { get; set; }
    public string? 品名 { get; set; }
    public decimal? 数量 { get; set; }
    public int? 内箱 { get; set; }
    public int? 外箱 { get; set; }
    public decimal? 总箱数 { get; set; }
    public DateTime? 走货期 { get; set; }
    public DateTime? 验货期 { get; set; }
    public string? 第三方验货 { get; set; }
    public string? 车间 { get; set; }
    public string? 备注 { get; set; }
    public string? 原始数据 { get; set; }
}

// 请求行 → SQL 行的纯校验:状态白名单/Trim/列宽(对应表列 nvarchar 宽度)/日期与数字兜底。
public static class ScheduleImportValidator
{
    private static readonly HashSet<string> 状态集 = new() { "在排", "已走货", "已取消" };

    public static (List<ValidScheduleImportRow> Valid, List<ImportFailure> Failures)
        Validate(IReadOnlyList<ScheduleImportRow> rows)
    {
        var valid = new List<ValidScheduleImportRow>();
        var failures = new List<ImportFailure>();
        foreach (var r in rows)
        {
            string? error = null;

            var 状态 = MasterImportHelper.Clean(r.状态) ?? "在排";
            if (!状态集.Contains(状态)) error ??= $"状态无效:{状态}";

            var 来源工作表 = MasterImportHelper.Clean(r.来源工作表);
            var 客户名称 = MasterImportHelper.Clean(r.客户名称);
            var 国家 = MasterImportHelper.Clean(r.国家);
            var PO号 = MasterImportHelper.Clean(r.PO号);
            var 客PO = MasterImportHelper.Clean(r.客PO);
            var SKU = MasterImportHelper.Clean(r.SKU);
            var 货号 = MasterImportHelper.Clean(r.货号);
            var 品名 = MasterImportHelper.Clean(r.品名);
            var 第三方验货 = MasterImportHelper.Clean(r.第三方验货);
            var 车间 = MasterImportHelper.Clean(r.车间);
            var 备注 = MasterImportHelper.Clean(r.备注);

            if (货号 is null && PO号 is null && 客PO is null) error ??= "货号/PO号/客PO 不能都为空";

            error ??= MasterImportHelper.LengthError(来源工作表, "来源工作表", 100);
            error ??= MasterImportHelper.LengthError(客户名称, "客户名称", 200);
            error ??= MasterImportHelper.LengthError(国家, "国家", 100);
            error ??= MasterImportHelper.LengthError(PO号, "PO号", 200);
            error ??= MasterImportHelper.LengthError(客PO, "客PO", 200);
            error ??= MasterImportHelper.LengthError(SKU, "SKU", 200);
            error ??= MasterImportHelper.LengthError(货号, "货号", 200);
            error ??= MasterImportHelper.LengthError(品名, "品名", 200);
            error ??= MasterImportHelper.LengthError(第三方验货, "第三方验货", 200);
            error ??= MasterImportHelper.LengthError(车间, "车间", 50);
            error ??= MasterImportHelper.LengthError(备注, "备注", 400);

            var (接单日期, e1) = ParseDate(r.接单日期, "接单日期"); error ??= e1;
            var (走货期, e2) = ParseDate(r.走货期, "走货期"); error ??= e2;
            var (验货期, e3) = ParseDate(r.验货期, "验货期"); error ??= e3;

            var (数量, e4) = MasterImportHelper.ParseDecimal(r.数量, "数量"); error ??= e4;
            var (内箱, e5) = ParseInt(r.内箱, "内箱"); error ??= e5;
            var (外箱, e6) = ParseInt(r.外箱, "外箱"); error ??= e6;
            var (总箱数, e7) = MasterImportHelper.ParseDecimal(r.总箱数, "总箱数"); error ??= e7;

            if (error is not null) failures.Add(new ImportFailure { 行号 = r.行号, 物料编号 = 货号 ?? PO号, 原因 = error });
            else valid.Add(new ValidScheduleImportRow
            {
                行号 = r.行号,
                状态 = 状态,
                来源工作表 = 来源工作表,
                接单日期 = 接单日期,
                客户名称 = 客户名称,
                国家 = 国家,
                PO号 = PO号,
                客PO = 客PO,
                SKU = SKU,
                货号 = 货号,
                品名 = 品名,
                数量 = 数量,
                内箱 = 内箱,
                外箱 = 外箱,
                总箱数 = 总箱数,
                走货期 = 走货期,
                验货期 = 验货期,
                第三方验货 = 第三方验货,
                车间 = 车间,
                备注 = 备注,
                原始数据 = string.IsNullOrWhiteSpace(r.原始数据) ? null : r.原始数据,
            });
        }
        return (valid, failures);
    }

    // 日期兜底:前端已格式化为 yyyy-MM-dd;宽松接受常见日期串,失败记错误行
    private static (DateTime? Value, string? Error) ParseDate(string? raw, string column)
    {
        var s = MasterImportHelper.Clean(raw);
        if (s is null) return (null, null);
        return DateTime.TryParse(s, out var d) ? (d.Date, null) : (null, $"{column}不是有效日期");
    }

    // int 列兜底:先按 decimal 解析,超出 int 范围记错误行而不是抛 OverflowException
    private static (int? Value, string? Error) ParseInt(object? raw, string column)
    {
        var (d, e) = MasterImportHelper.ParseDecimal(raw, column);
        if (d is null || e is not null) return (null, e);
        if (d > int.MaxValue || d < int.MinValue) return (null, $"{column}超出整数范围");
        return ((int)decimal.Round(d.Value), null);
    }
}
