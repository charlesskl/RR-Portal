using ErpApi.Features.MasterData;
namespace ErpApi.Features.Plastics.PlasticMaterialMaster;

// 塑胶物料资料 Excel 导入:请求行(前端已按表头映射到真实列,后端只做兜底校验)。
public sealed class PlasticMaterialImportRow
{
    public int 行号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 客户 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 色粉号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 加工内容 { get; set; }
    public string? 二次加工 { get; set; }
    public string? 啤机机型 { get; set; }
    public string? 单位 { get; set; }
    // 数字列用 object 接收(JSON 数字或字符串),校验时兜底拒绝非数字
    public object? 单价 { get; set; }
    public object? 二次加工价 { get; set; }
    public object? 加工总单价 { get; set; }
    public object? 整啤毛重 { get; set; }
    public object? 整啤净重 { get; set; }
    public object? 原胶件单净重 { get; set; }
    public object? 整啤模腔数 { get; set; }
    public object? 套数 { get; set; }
    public object? 出模数 { get; set; }
    public object? 用量 { get; set; }
    public object? 水口比例 { get; set; }
    public object? 模具日产量 { get; set; }
    public object? 啤机价钱 { get; set; }
    public object? 胶件啤工价 { get; set; }
    public object? 原料单价 { get; set; }
    public object? 胶件料价 { get; set; }
    public object? 原胶料单价 { get; set; }
    public object? 其他成本 { get; set; }
    public string? 货币 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticMaterialImportRequest
{
    public List<PlasticMaterialImportRow> Rows { get; set; } = new();
}

// 校验通过的待插行(数字列已解析为 decimal)
public sealed class ValidPlasticMaterialImportRow
{
    public int 行号 { get; set; }
    public string 物料编号 { get; set; } = "";
    public string? 工模编号 { get; set; }
    public string? 客户 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 色粉号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 加工内容 { get; set; }
    public string? 二次加工 { get; set; }
    public string? 啤机机型 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 二次加工价 { get; set; }
    public decimal? 加工总单价 { get; set; }
    public decimal? 整啤毛重 { get; set; }
    public decimal? 整啤净重 { get; set; }
    public decimal? 原胶件单净重 { get; set; }
    public decimal? 整啤模腔数 { get; set; }
    public decimal? 套数 { get; set; }
    public decimal? 出模数 { get; set; }
    public decimal? 用量 { get; set; }
    public decimal? 水口比例 { get; set; }
    public decimal? 模具日产量 { get; set; }
    public decimal? 啤机价钱 { get; set; }
    public decimal? 胶件啤工价 { get; set; }
    public decimal? 原料单价 { get; set; }
    public decimal? 胶件料价 { get; set; }
    public decimal? 原胶料单价 { get; set; }
    public decimal? 其他成本 { get; set; }
    public string? 货币 { get; set; }
    public string? 备注 { get; set; }
}

// 请求行 → SQL 行的纯校验:必填/Trim/列宽(见 db/15、db/63)/数字兜底/批内去重。
public static class PlasticMaterialImportValidator
{
    public static (List<ValidPlasticMaterialImportRow> Valid, List<ImportFailure> Failures, int BatchDuplicates)
        Validate(IReadOnlyList<PlasticMaterialImportRow> rows)
    {
        var valid = new List<ValidPlasticMaterialImportRow>();
        var failures = new List<ImportFailure>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var batchDup = 0;
        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var 行号 = r.行号 > 0 ? r.行号 : i + 1;
            var code = MasterImportHelper.Clean(r.物料编号);
            string? error = null;
            if (code is null) error = "物料编号为空";
            error ??= MasterImportHelper.LengthError(code, "物料编号", 20);

            var 工模编号 = MasterImportHelper.Clean(r.工模编号);
            var 客户 = MasterImportHelper.Clean(r.客户);
            var 款号 = MasterImportHelper.Clean(r.款号);
            var 物料名称 = MasterImportHelper.Clean(r.物料名称);
            var 颜色 = MasterImportHelper.Clean(r.颜色);
            var 色粉号 = MasterImportHelper.Clean(r.色粉号);
            var 原料名称 = MasterImportHelper.Clean(r.原料名称);
            var 用料名称 = MasterImportHelper.Clean(r.用料名称);
            var 加工内容 = MasterImportHelper.Clean(r.加工内容);
            var 二次加工 = MasterImportHelper.Clean(r.二次加工);
            var 啤机机型 = MasterImportHelper.Clean(r.啤机机型);
            var 单位 = MasterImportHelper.Clean(r.单位);
            var 货币 = MasterImportHelper.Clean(r.货币);
            var 备注 = MasterImportHelper.Clean(r.备注);
            error ??= MasterImportHelper.LengthError(工模编号, "工模编号", 30);
            error ??= MasterImportHelper.LengthError(客户, "客户", 20);
            error ??= MasterImportHelper.LengthError(款号, "款号", 40);
            error ??= MasterImportHelper.LengthError(物料名称, "物料名称", 40);
            error ??= MasterImportHelper.LengthError(颜色, "颜色", 20);
            error ??= MasterImportHelper.LengthError(色粉号, "色粉号", 30);
            error ??= MasterImportHelper.LengthError(原料名称, "原料名称", 40);
            error ??= MasterImportHelper.LengthError(用料名称, "用料名称", 40);
            error ??= MasterImportHelper.LengthError(加工内容, "加工内容", 50);
            error ??= MasterImportHelper.LengthError(二次加工, "二次加工", 50);
            error ??= MasterImportHelper.LengthError(啤机机型, "啤机机型", 30);
            error ??= MasterImportHelper.LengthError(单位, "单位", 20);
            error ??= MasterImportHelper.LengthError(货币, "货币", 20);

            var (单价, e1) = MasterImportHelper.ParseDecimal(r.单价, "单价"); error ??= e1;
            var (二次加工价, e2) = MasterImportHelper.ParseDecimal(r.二次加工价, "二次加工价"); error ??= e2;
            var (加工总单价, e3) = MasterImportHelper.ParseDecimal(r.加工总单价, "加工总单价"); error ??= e3;
            var (整啤毛重, e4) = MasterImportHelper.ParseDecimal(r.整啤毛重, "整啤毛重"); error ??= e4;
            var (整啤净重, e5) = MasterImportHelper.ParseDecimal(r.整啤净重, "整啤净重"); error ??= e5;
            var (原胶件单净重, e6) = MasterImportHelper.ParseDecimal(r.原胶件单净重, "原胶件单净重"); error ??= e6;
            var (整啤模腔数, e7) = MasterImportHelper.ParseDecimal(r.整啤模腔数, "整啤模腔数"); error ??= e7;
            var (套数, e8) = MasterImportHelper.ParseDecimal(r.套数, "套数"); error ??= e8;
            var (出模数, e9) = MasterImportHelper.ParseDecimal(r.出模数, "出模数"); error ??= e9;
            var (用量, e10) = MasterImportHelper.ParseDecimal(r.用量, "用量"); error ??= e10;
            var (水口比例, e11) = MasterImportHelper.ParseDecimal(r.水口比例, "水口比例"); error ??= e11;
            var (模具日产量, e12) = MasterImportHelper.ParseDecimal(r.模具日产量, "模具日产量"); error ??= e12;
            var (啤机价钱, e13) = MasterImportHelper.ParseDecimal(r.啤机价钱, "啤机价钱"); error ??= e13;
            var (胶件啤工价, e14) = MasterImportHelper.ParseDecimal(r.胶件啤工价, "胶件啤工价"); error ??= e14;
            var (原料单价, e15) = MasterImportHelper.ParseDecimal(r.原料单价, "原料单价"); error ??= e15;
            var (胶件料价, e16) = MasterImportHelper.ParseDecimal(r.胶件料价, "胶件料价"); error ??= e16;
            var (原胶料单价, e17) = MasterImportHelper.ParseDecimal(r.原胶料单价, "原胶料单价"); error ??= e17;
            var (其他成本, e18) = MasterImportHelper.ParseDecimal(r.其他成本, "其他成本"); error ??= e18;

            if (error is not null)
            {
                failures.Add(new ImportFailure { 行号 = 行号, 物料编号 = code, 原因 = error });
                continue;
            }
            if (!seen.Add(code!))
            {
                batchDup++; // 本批前面已出现同编号 → 跳过(不计失败)
                continue;
            }
            valid.Add(new ValidPlasticMaterialImportRow
            {
                行号 = 行号, 物料编号 = code!, 工模编号 = 工模编号, 客户 = 客户, 款号 = 款号, 物料名称 = 物料名称,
                颜色 = 颜色, 色粉号 = 色粉号, 原料名称 = 原料名称, 用料名称 = 用料名称, 加工内容 = 加工内容,
                二次加工 = 二次加工, 啤机机型 = 啤机机型, 单位 = 单位, 单价 = 单价, 二次加工价 = 二次加工价,
                加工总单价 = 加工总单价, 整啤毛重 = 整啤毛重, 整啤净重 = 整啤净重, 原胶件单净重 = 原胶件单净重,
                整啤模腔数 = 整啤模腔数, 套数 = 套数, 出模数 = 出模数, 用量 = 用量, 水口比例 = 水口比例,
                模具日产量 = 模具日产量, 啤机价钱 = 啤机价钱, 胶件啤工价 = 胶件啤工价, 原料单价 = 原料单价,
                胶件料价 = 胶件料价, 原胶料单价 = 原胶料单价, 其他成本 = 其他成本, 货币 = 货币, 备注 = 备注,
            });
        }
        return (valid, failures, batchDup);
    }
}
