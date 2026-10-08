using ErpApi.Features.MasterData;
namespace ErpApi.Features.Materials.MaterialMaster;

// 物料资料 Excel 导入:请求行(前端已按表头映射/打包备注,后端只做兜底校验)。
public sealed class MaterialImportRow
{
    public int 行号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 货号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    // 数字列用 object 接收(JSON 数字或字符串),校验时兜底拒绝非数字
    public object? 单价 { get; set; }
    public string? 仓库位置 { get; set; }
    public string? 备注 { get; set; }
    public object? 最低库存 { get; set; }
    public string? 货币 { get; set; }
}

public sealed class MaterialImportRequest
{
    public List<MaterialImportRow> Rows { get; set; } = new();
}

// 校验通过的待插行(数字列已解析为 decimal)
public sealed class ValidMaterialImportRow
{
    public int 行号 { get; set; }
    public string 物料编号 { get; set; } = "";
    public string? 货号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 仓库位置 { get; set; }
    public string? 备注 { get; set; }
    public decimal? 最低库存 { get; set; }
    public string? 货币 { get; set; }
}

// 请求行 → SQL 行的纯校验:必填/Trim/列宽(对应表列 nvarchar 宽度)/数字兜底/批内去重。
public static class MaterialImportValidator
{
    public static (List<ValidMaterialImportRow> Valid, List<ImportFailure> Failures, int BatchDuplicates)
        Validate(IReadOnlyList<MaterialImportRow> rows)
    {
        var valid = new List<ValidMaterialImportRow>();
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

            var 货号 = MasterImportHelper.Clean(r.货号);
            var 物料名称 = MasterImportHelper.Clean(r.物料名称);
            var 规格 = MasterImportHelper.Clean(r.规格);
            var 颜色 = MasterImportHelper.Clean(r.颜色);
            var 单位 = MasterImportHelper.Clean(r.单位);
            var 仓库位置 = MasterImportHelper.Clean(r.仓库位置);
            var 货币 = MasterImportHelper.Clean(r.货币);
            var 备注 = MasterImportHelper.Clean(r.备注);
            error ??= MasterImportHelper.LengthError(货号, "货号", 40);
            error ??= MasterImportHelper.LengthError(物料名称, "物料名称", 40);
            error ??= MasterImportHelper.LengthError(规格, "规格", 40);
            error ??= MasterImportHelper.LengthError(颜色, "颜色", 20);
            error ??= MasterImportHelper.LengthError(单位, "单位", 20);
            error ??= MasterImportHelper.LengthError(仓库位置, "仓库位置", 30);
            error ??= MasterImportHelper.LengthError(货币, "货币", 20);

            var (单价, priceErr) = MasterImportHelper.ParseDecimal(r.单价, "单价");
            var (最低库存, stockErr) = MasterImportHelper.ParseDecimal(r.最低库存, "最低库存");
            error ??= priceErr ?? stockErr;

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
            valid.Add(new ValidMaterialImportRow
            {
                行号 = 行号, 物料编号 = code!, 货号 = 货号, 物料名称 = 物料名称, 规格 = 规格,
                颜色 = 颜色, 单位 = 单位, 单价 = 单价, 仓库位置 = 仓库位置, 备注 = 备注,
                最低库存 = 最低库存, 货币 = 货币,
            });
        }
        return (valid, failures, batchDup);
    }
}
