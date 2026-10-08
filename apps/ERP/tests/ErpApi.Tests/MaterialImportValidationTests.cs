using System.Text.Json;
using ErpApi.Features.Materials.MaterialMaster;
using ErpApi.Features.Plastics.PlasticMaterialMaster;
using Xunit;

// Excel 导入"请求行 → SQL 行"纯校验的单测（不依赖 DB）:必填/Trim/列宽/数字兜底/批内去重
public class MaterialImportValidationTests
{
    private static JsonElement Je(string json) => JsonDocument.Parse(json).RootElement;

    [Fact]
    public void Valid_row_is_trimmed_and_blank_strings_become_null()
    {
        var (valid, failures, dup) = MaterialImportValidator.Validate(new[]
        {
            new MaterialImportRow { 行号 = 3, 物料编号 = " 01030008 ", 物料名称 = " PB螺丝 ", 货号 = "  ", 单位 = "PCS", 单价 = Je("0.0045") },
        });
        Assert.Empty(failures);
        Assert.Equal(0, dup);
        var r = Assert.Single(valid);
        Assert.Equal("01030008", r.物料编号);
        Assert.Equal("PB螺丝", r.物料名称);
        Assert.Null(r.货号);
        Assert.Equal(0.0045m, r.单价);
    }

    [Fact]
    public void Blank_code_fails_with_reason()
    {
        var (valid, failures, _) = MaterialImportValidator.Validate(new[]
        {
            new MaterialImportRow { 行号 = 291, 物料编号 = "  ", 备注 = "合 计" },
        });
        Assert.Empty(valid);
        var f = Assert.Single(failures);
        Assert.Equal(291, f.行号);
        Assert.Equal("物料编号为空", f.原因);
        Assert.Null(f.物料编号);
    }

    [Fact]
    public void Overlong_columns_fail_with_column_name()
    {
        var (valid, failures, _) = MaterialImportValidator.Validate(new[]
        {
            new MaterialImportRow { 行号 = 4, 物料编号 = new string('长', 21) },
            new MaterialImportRow { 行号 = 5, 物料编号 = "OK1", 物料名称 = new string('名', 41) },
            new MaterialImportRow { 行号 = 6, 物料编号 = "OK2", 货号 = new string('货', 41) },
            new MaterialImportRow { 行号 = 7, 物料编号 = "OK3", 仓库位置 = new string('位', 31) },
            new MaterialImportRow { 行号 = 8, 物料编号 = "OK4", 货币 = new string('币', 21) },
        });
        Assert.Empty(valid);
        Assert.Equal(5, failures.Count);
        Assert.Contains(failures, f => f.原因 == "物料编号超过20字");
        Assert.Contains(failures, f => f.原因 == "物料名称超过40字");
        Assert.Contains(failures, f => f.原因 == "货号超过40字");
        Assert.Contains(failures, f => f.原因 == "仓库位置超过30字");
        Assert.Contains(failures, f => f.原因 == "货币超过20字");
    }

    [Fact]
    public void Non_numeric_price_fails_but_numeric_string_passes()
    {
        var (valid, failures, _) = MaterialImportValidator.Validate(new[]
        {
            new MaterialImportRow { 行号 = 3, 物料编号 = "A1", 单价 = Je("\"abc\"") },
            new MaterialImportRow { 行号 = 4, 物料编号 = "A2", 单价 = Je("\" 0.0125 \""), 最低库存 = Je("10") },
            new MaterialImportRow { 行号 = 5, 物料编号 = "A3", 最低库存 = Je("\"x\"") },
        });
        var ok = Assert.Single(valid);
        Assert.Equal("A2", ok.物料编号);
        Assert.Equal(0.0125m, ok.单价);
        Assert.Equal(10m, ok.最低库存);
        Assert.Equal(2, failures.Count);
        Assert.Contains(failures, f => f.行号 == 3 && f.原因 == "单价不是数字");
        Assert.Contains(failures, f => f.行号 == 5 && f.原因 == "最低库存不是数字");
    }

    [Fact]
    public void Batch_duplicates_are_skipped_not_failed()
    {
        var (valid, failures, dup) = MaterialImportValidator.Validate(new[]
        {
            new MaterialImportRow { 行号 = 3, 物料编号 = "A1" },
            new MaterialImportRow { 行号 = 4, 物料编号 = "a1" }, // 忽略大小写
            new MaterialImportRow { 行号 = 5, 物料编号 = "A2" },
        });
        Assert.Empty(failures);
        Assert.Equal(1, dup);
        Assert.Equal(2, valid.Count);
    }

    [Fact]
    public void Plastic_valid_row_and_defaults_pass_through()
    {
        var (valid, failures, _) = PlasticMaterialImportValidator.Validate(new[]
        {
            new PlasticMaterialImportRow
            {
                行号 = 3, 物料编号 = "57001896", 工模编号 = "MNVN-05M-01", 客户 = "ZURU", 款号 = "77772",
                物料名称 = "唱盘CD", 颜色 = "黑色", 色粉号 = "7726", 原料名称 = "ABS", 用料名称 = "ABS GP22",
                啤机机型 = "10A", 单位 = "PCS", 单价 = Je("0.0687"), 套数 = Je("8"), 出模数 = Je("8"),
                用量 = Je("1"), 整啤净重 = Je("12.9"), 啤机价钱 = Je("1160"), 其他成本 = Je("0"), 货币 = "HKD",
            },
        });
        Assert.Empty(failures);
        var r = Assert.Single(valid);
        Assert.Equal("MNVN-05M-01", r.工模编号);
        Assert.Equal("ZURU", r.客户);
        Assert.Equal("77772", r.款号);
        Assert.Equal(0.0687m, r.单价);
        Assert.Equal(8m, r.套数);
        Assert.Equal(12.9m, r.整啤净重);
        Assert.Equal("HKD", r.货币);
    }

    [Fact]
    public void Plastic_blank_code_and_overlong_kuanhao_fail()
    {
        var (valid, failures, _) = PlasticMaterialImportValidator.Validate(new[]
        {
            new PlasticMaterialImportRow { 行号 = 3, 物料编号 = "" },
            new PlasticMaterialImportRow { 行号 = 4, 物料编号 = "P1", 款号 = new string('款', 41) },
            new PlasticMaterialImportRow { 行号 = 5, 物料编号 = "P2", 单价 = Je("\"贵\"") },
            new PlasticMaterialImportRow { 行号 = 6, 物料编号 = "P3", 工模编号 = new string('模', 31) },
            new PlasticMaterialImportRow { 行号 = 7, 物料编号 = "P4", 套数 = Je("\"多\"") },
            new PlasticMaterialImportRow { 行号 = 8, 物料编号 = "P5", 客户 = new string('客', 21) },
        });
        Assert.Empty(valid);
        Assert.Equal(6, failures.Count);
        Assert.Contains(failures, f => f.原因 == "物料编号为空");
        Assert.Contains(failures, f => f.原因 == "款号超过40字");
        Assert.Contains(failures, f => f.原因 == "单价不是数字");
        Assert.Contains(failures, f => f.原因 == "工模编号超过30字");
        Assert.Contains(failures, f => f.原因 == "套数不是数字");
        Assert.Contains(failures, f => f.原因 == "客户超过20字");
    }
}
