using System.Text;
using System.Text.RegularExpressions;

namespace IndoShipping.Bootstrap;

public static partial class SqlBatchSplitter
{
    public static IReadOnlyList<string> Split(string sql)
    {
        ArgumentNullException.ThrowIfNull(sql);

        var batches = new List<string>();
        var current = new StringBuilder();

        using var reader = new StringReader(sql);
        while (reader.ReadLine() is { } line)
        {
            if (GoLine().IsMatch(line))
            {
                AddBatch(batches, current);
                continue;
            }

            current.AppendLine(line);
        }

        AddBatch(batches, current);
        return batches;
    }

    private static void AddBatch(List<string> batches, StringBuilder current)
    {
        var batch = current.ToString().Trim();
        current.Clear();

        if (batch.Length > 0)
            batches.Add(batch);
    }

    [GeneratedRegex(@"^\s*GO\s*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex GoLine();
}
