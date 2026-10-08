namespace ErpApi.Features.Materials.MaterialMaster;

// 物料类别主数据行（树构建的输入；父级 = 主数据"类别"列，指向父类别的 编号 或 名称）
public sealed record MaterialCategoryMasterRow(string? 编号, string? 名称, string? 父级);

// 物料类别树的纯函数构建/查询，不依赖 DB，便于单元测试。
public static class MaterialCategoryTree
{
    // 由主数据行 + 各类别物料数构建扁平节点列表（带父级指针，前端组树，支持多层）。
    // 规则：
    // - 主数据行 → 节点；节点名（=物料资料.物料类别 过滤值）取 名称，空则取 编号；编号空时回填为名称。
    // - 父级（主数据"类别"列）匹配父行的 编号 或 名称；输出统一规范为父节点的 编号；指向不存在/自身 → 视为顶级。
    // - 物料行里存在但主数据表没有的类别 → 追加为顶级节点（编号/父级 = null）。
    public static IReadOnlyList<MaterialCategoryNode> Build(
        IEnumerable<MaterialCategoryMasterRow> masterRows,
        IReadOnlyDictionary<string, int> materialCounts)
    {
        var nodes = new List<MaterialCategoryNode>();
        var byKey = new Dictionary<string, MaterialCategoryNode>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in masterRows)
        {
            var name = !string.IsNullOrWhiteSpace(r.名称) ? r.名称!.Trim()
                     : !string.IsNullOrWhiteSpace(r.编号) ? r.编号!.Trim() : null;
            if (name is null) continue;
            var code = !string.IsNullOrWhiteSpace(r.编号) ? r.编号!.Trim() : name;
            if (byKey.ContainsKey(code) || byKey.ContainsKey(name)) continue; // 编号/名称重复的行去重
            var node = new MaterialCategoryNode
            {
                编号 = code,
                类别 = name,
                父级 = string.IsNullOrWhiteSpace(r.父级) ? null : r.父级!.Trim(),
            };
            if (materialCounts.TryGetValue(name, out var n) ||
                (!string.Equals(code, name, StringComparison.OrdinalIgnoreCase) && materialCounts.TryGetValue(code, out n)))
                node.数量 = n;
            byKey.TryAdd(code, node);
            byKey.TryAdd(name, node);
            nodes.Add(node);
        }
        // 父级规范化为父节点编号；悬空/自引用 → 顶级（防脏数据成环）
        foreach (var node in nodes)
        {
            if (node.父级 is null) continue;
            if (!byKey.TryGetValue(node.父级, out var parent) || ReferenceEquals(parent, node))
                node.父级 = null;
            else
                node.父级 = parent.编号 ?? parent.类别;
        }
        // 物料自带但主数据没有的类别 → 顶级附加节点
        foreach (var (name, count) in materialCounts)
        {
            var key = name.Trim();
            if (key.Length == 0 || byKey.ContainsKey(key)) continue;
            var node = new MaterialCategoryNode { 类别 = key, 数量 = count };
            byKey[key] = node;
            nodes.Add(node);
        }
        return nodes;
    }

    // 含子级过滤：从根类别（编号或名称）出发向下遍历，返回该类及所有后代可用于过滤物料的值（名称+编号）。
    // 逐层扫描代替递归，环安全（已访问行不重复展开）。
    public static HashSet<string> SubtreeKeys(IEnumerable<MaterialCategoryMasterRow> masterRows, string root)
    {
        var rows = masterRows
            .Select(r => new MaterialCategoryMasterRow(r.编号?.Trim(), r.名称?.Trim(), r.父级?.Trim()))
            .Where(r => !string.IsNullOrEmpty(r.编号) || !string.IsNullOrEmpty(r.名称))
            .ToList();
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { root.Trim() };
        var visited = new HashSet<MaterialCategoryMasterRow>();
        var changed = true;
        while (changed)
        {
            changed = false;
            foreach (var r in rows)
            {
                if (visited.Contains(r)) continue;
                var isRoot = string.Equals(r.编号, root.Trim(), StringComparison.OrdinalIgnoreCase)
                          || string.Equals(r.名称, root.Trim(), StringComparison.OrdinalIgnoreCase);
                var isChild = !string.IsNullOrEmpty(r.父级) && result.Contains(r.父级);
                if (!isRoot && !isChild) continue;
                visited.Add(r);
                if (!string.IsNullOrEmpty(r.编号)) result.Add(r.编号!);
                if (!string.IsNullOrEmpty(r.名称)) result.Add(r.名称!);
                changed = true;
            }
        }
        return result;
    }
}
