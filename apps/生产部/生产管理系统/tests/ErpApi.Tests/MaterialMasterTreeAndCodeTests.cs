using ErpApi.Features.Materials.MaterialMaster;
using Xunit;

// 物料类别树构建 + 物料编号生成的纯单元测试（不依赖 DB）
public class MaterialMasterTreeAndCodeTests
{
    private static MaterialCategoryMasterRow Row(string? 编号, string? 名称, string? 父级 = null)
        => new(编号, 名称, 父级);

    [Fact]
    public void Build_links_parent_by_code_and_normalizes_parent_to_code()
    {
        var nodes = MaterialCategoryTree.Build(
            new[] { Row("A", "面料"), Row("A1", "棉布", "A"), Row("A2", "麻布", "面料") }, // A2 父级按名称匹配
            new Dictionary<string, int> { ["面料"] = 1, ["棉布"] = 2 });

        var a = nodes.Single(x => x.编号 == "A");
        Assert.Null(a.父级);
        Assert.Equal(1, a.数量);
        Assert.Equal("A", nodes.Single(x => x.编号 == "A1").父级);
        Assert.Equal("A", nodes.Single(x => x.编号 == "A2").父级); // 名称匹配也规范化为父编号
        Assert.Equal(2, nodes.Single(x => x.编号 == "A1").数量);
    }

    [Fact]
    public void Build_dangling_or_self_parent_becomes_top_level()
    {
        var nodes = MaterialCategoryTree.Build(
            new[] { Row("B", "吊空", "不存在"), Row("C", "自引", "C") },
            new Dictionary<string, int>());
        Assert.All(nodes, x => Assert.Null(x.父级));
    }

    [Fact]
    public void Build_appends_material_only_categories_as_top_level()
    {
        var nodes = MaterialCategoryTree.Build(
            new[] { Row("A", "面料") },
            new Dictionary<string, int> { ["面料"] = 5, ["拉链"] = 3 });

        var extra = nodes.Single(x => x.类别 == "拉链");
        Assert.Null(extra.编号);
        Assert.Null(extra.父级);
        Assert.Equal(3, extra.数量);
        Assert.Equal(5, nodes.Single(x => x.编号 == "A").数量);
    }

    [Fact]
    public void Build_dedupes_master_rows_and_blank_names()
    {
        var nodes = MaterialCategoryTree.Build(
            new[] { Row("A", "面料"), Row("A", "面料"), Row(null, null), Row(null, "  ") },
            new Dictionary<string, int>());
        Assert.Single(nodes);
    }

    [Fact]
    public void SubtreeKeys_includes_all_descendants_by_code_and_name()
    {
        var rows = new[]
        {
            Row("A", "面料"),
            Row("A1", "棉布", "A"),
            Row("A1a", "精梳棉", "棉布"), // 父级按名称，隔代
            Row("B", "辅料"),
        };
        var keys = MaterialCategoryTree.SubtreeKeys(rows, "面料");
        Assert.Contains("面料", keys);
        Assert.Contains("A1", keys);
        Assert.Contains("棉布", keys);
        Assert.Contains("精梳棉", keys);
        Assert.DoesNotContain("辅料", keys);
    }

    [Fact]
    public void SubtreeKeys_is_cycle_safe_and_keeps_root()
    {
        var rows = new[] { Row("X", "甲", "Y"), Row("Y", "乙", "X") };
        var keys = MaterialCategoryTree.SubtreeKeys(rows, "无关");
        Assert.Single(keys);
        Assert.Contains("无关", keys);
    }

    [Fact]
    public void Next_increments_max_numeric_suffix()
        => Assert.Equal("MM004", MaterialCodeGenerator.Next("MM", new[] { "MM001", "MM003", "MM002" }));

    [Fact]
    public void Next_ignores_non_numeric_suffix_and_shorter_prefix_collision()
        => Assert.Equal("M001", MaterialCodeGenerator.Next("M", new[] { "MM005", "MABC", "M" }));

    [Fact]
    public void Next_keeps_width_and_grows_when_needed()
    {
        Assert.Equal("MM010", MaterialCodeGenerator.Next("MM", new[] { "MM009" }));
        Assert.Equal("X1000", MaterialCodeGenerator.Next("X", new[] { "X0999" }));
    }

    [Fact]
    public void Next_empty_starts_at_001()
        => Assert.Equal("面料001", MaterialCodeGenerator.Next("面料", Array.Empty<string>()));

    [Fact]
    public void Next_matches_prefix_case_insensitively()
        => Assert.Equal("mm008", MaterialCodeGenerator.Next("mm", new[] { "MM007" }));

    [Fact]
    public void NormalizePrefix_priority_code_then_name_then_default()
    {
        Assert.Equal("ML", MaterialCodeGenerator.NormalizePrefix("面料", "ML"));
        Assert.Equal("面料", MaterialCodeGenerator.NormalizePrefix("面料", null));
        Assert.Equal("面料", MaterialCodeGenerator.NormalizePrefix("面料", "  "));
        Assert.Equal("M", MaterialCodeGenerator.NormalizePrefix(null, null));
    }

    [Fact]
    public void NormalizePrefix_truncates_to_fit_column()
    {
        var p = MaterialCodeGenerator.NormalizePrefix(new string('长', 30), null);
        Assert.Equal(MaterialCodeGenerator.MaxPrefixLength, p.Length);
    }
}
