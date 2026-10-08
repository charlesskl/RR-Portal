using ErpApi.Engines.Bom;
using Xunit;

// 多层级半成品展开（纯内存，不依赖数据库）
public sealed class SemiBomExpanderTests
{
    private static Func<string, IReadOnlyList<SemiBomLine>> LinesOf(
        IReadOnlyDictionary<string, List<SemiBomLine>> boms)
        => 款号 => boms.TryGetValue(款号, out var lines) ? lines : [];

    private static Func<string, bool> Semi(params string[] codes)
        => new HashSet<string>(codes, StringComparer.OrdinalIgnoreCase).Contains;

    private static SemiBomLine L(string 编号, decimal 用量) => new(编号, 用量);

    [Fact]
    public void Expand_two_levels_replaces_semi_with_its_bom_and_multiplies_qty()
    {
        var boms = new Dictionary<string, List<SemiBomLine>>
        {
            ["FIN"] = [L("SEMI-A", 2), L("MAT-X", 1)],
            ["SEMI-A"] = [L("MAT-1", 3)],
        };

        var r = SemiBomExpander.Expand("FIN", LinesOf(boms), l => l.编号, l => l.用量, Semi("SEMI-A"));

        Assert.Empty(r.警告);
        Assert.Equal(2, r.物料.Count);
        // 半成品行被替换：MAT-1 = 2×3 = 6；直接物料 MAT-X = 1
        var mat1 = Assert.Single(r.物料, m => m.行.编号 == "MAT-1");
        Assert.Equal(6m, mat1.累计用量);
        Assert.Equal("SEMI-A", mat1.来源款号);
        var matX = Assert.Single(r.物料, m => m.行.编号 == "MAT-X");
        Assert.Equal(1m, matX.累计用量);
        // 半成品行本身不出现在展开结果中（不会按半成品再扣一次物料）
        Assert.DoesNotContain(r.物料, m => m.行.编号 == "SEMI-A");
    }

    [Fact]
    public void Expand_three_levels_recurses_and_multiplies_along_the_chain()
    {
        var boms = new Dictionary<string, List<SemiBomLine>>
        {
            ["FIN"] = [L("SEMI-A", 2)],
            ["SEMI-A"] = [L("SEMI-B", 3)],
            ["SEMI-B"] = [L("MAT-1", 4)],
        };

        var r = SemiBomExpander.Expand("FIN", LinesOf(boms), l => l.编号, l => l.用量,
            Semi("SEMI-A", "SEMI-B"));

        Assert.Empty(r.警告);
        var mat = Assert.Single(r.物料);
        Assert.Equal("MAT-1", mat.行.编号);
        Assert.Equal(24m, mat.累计用量);   // 2×3×4
        Assert.Equal("SEMI-B", mat.来源款号);
    }

    [Fact]
    public void Expand_cycle_stops_and_reports_warning()
    {
        var boms = new Dictionary<string, List<SemiBomLine>>
        {
            ["A"] = [L("B", 1)],
            ["B"] = [L("A", 1), L("MAT-1", 2)],
        };

        var r = SemiBomExpander.Expand("A", LinesOf(boms), l => l.编号, l => l.用量, Semi("A", "B"));

        var warning = Assert.Single(r.警告);
        Assert.Contains("循环引用", warning);
        Assert.Contains("A→B→A", warning);
        // 环之外的物料仍正常展开
        var mat = Assert.Single(r.物料);
        Assert.Equal("MAT-1", mat.行.编号);
        Assert.Equal(2m, mat.累计用量);
    }

    [Fact]
    public void Expand_self_reference_stops_immediately()
    {
        var boms = new Dictionary<string, List<SemiBomLine>> { ["A"] = [L("A", 1)] };

        var r = SemiBomExpander.Expand("A", LinesOf(boms), l => l.编号, l => l.用量, Semi("A"));

        Assert.Single(r.警告);
        Assert.Empty(r.物料);
    }

    [Fact]
    public void Expand_beyond_max_depth_stops_and_reports_warning()
    {
        // R→S1→…→S10→S11，S11 下挂 MAT-1；超过 MaxDepth=10 后不再向下
        var boms = new Dictionary<string, List<SemiBomLine>> { ["R"] = [L("S1", 1)] };
        var semi = new List<string>();
        for (var i = 1; i <= 11; i++)
        {
            semi.Add($"S{i}");
            boms[$"S{i}"] = i < 11 ? [L($"S{i + 1}", 1)] : [L("MAT-1", 5)];
        }

        var r = SemiBomExpander.Expand("R", LinesOf(boms), l => l.编号, l => l.用量, Semi(semi.ToArray()));

        Assert.Contains(r.警告, w => w.Contains("最大层级"));
        Assert.Empty(r.物料);   // 超层级被截断，深层物料不展开
    }

    [Fact]
    public void Duplicate_warning_when_bom_pulls_semi_and_its_component_material()
    {
        var boms = new Dictionary<string, List<SemiBomLine>> { ["SEMI-A"] = [L("MAT-1", 2)] };
        var 本Bom = new List<SemiBomLine> { L("SEMI-A", 1), L("MAT-1", 1) };

        var warnings = SemiBomExpander.FindDuplicateMaterialWarnings(本Bom, LinesOf(boms), Semi("SEMI-A"));

        var warning = Assert.Single(warnings);
        Assert.Contains("MAT-1", warning);
        Assert.Contains("SEMI-A", warning);
        Assert.Contains("重复扣料", warning);
    }

    [Fact]
    public void Duplicate_warning_also_catches_nested_semi_components()
    {
        var boms = new Dictionary<string, List<SemiBomLine>>
        {
            ["SEMI-A"] = [L("SEMI-B", 1)],
            ["SEMI-B"] = [L("MAT-1", 2)],
        };
        var 本Bom = new List<SemiBomLine> { L("SEMI-A", 1), L("MAT-1", 1) };

        var warnings = SemiBomExpander.FindDuplicateMaterialWarnings(
            本Bom, LinesOf(boms), Semi("SEMI-A", "SEMI-B"));

        Assert.Single(warnings);
        Assert.Contains("MAT-1", warnings[0]);
    }

    [Fact]
    public void No_duplicate_warning_when_materials_do_not_overlap()
    {
        var boms = new Dictionary<string, List<SemiBomLine>> { ["SEMI-A"] = [L("MAT-1", 2)] };
        var 本Bom = new List<SemiBomLine> { L("SEMI-A", 1), L("MAT-2", 1) };

        Assert.Empty(SemiBomExpander.FindDuplicateMaterialWarnings(本Bom, LinesOf(boms), Semi("SEMI-A")));
    }

    [Fact]
    public void Duplicate_check_surfaces_cycle_warnings_from_semi_expansion()
    {
        var boms = new Dictionary<string, List<SemiBomLine>>
        {
            ["SEMI-A"] = [L("SEMI-B", 1)],
            ["SEMI-B"] = [L("SEMI-A", 1)],
        };
        var 本Bom = new List<SemiBomLine> { L("SEMI-A", 1), L("MAT-9", 1) };

        var warnings = SemiBomExpander.FindDuplicateMaterialWarnings(
            本Bom, LinesOf(boms), Semi("SEMI-A", "SEMI-B"));

        Assert.Contains(warnings, w => w.Contains("循环引用"));
    }
}
