using System.Text;

// Compare the reviewed CHECK predicates while retaining AND/OR precedence.
// SQL Server adds redundant brackets/parentheses around identifiers/constants.
// Never flatten parentheses blindly across boolean operator boundaries.
internal static class BooleanSql
{
    internal static string Canonical(string expression) => Parse(expression).Render();

    private static Node Parse(string expression)
    {
        var text = expression.Trim();
        while (text.Length >= 2 && text[0] == '(' && ClosingParen(text, 0) == text.Length - 1)
            text = text[1..^1].Trim();
        foreach (var operation in new[] { "OR", "AND" })
        {
            var parts = Split(text, operation);
            if (parts.Count <= 1) continue;
            var children = parts.Select(Parse)
                .SelectMany(child => child.Operation == operation ? child.Children! : [child]).ToArray();
            return new(operation, null, children);
        }
        var atom = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < text.Length; i++)
        {
            var character = text[i];
            if (character == '\'')
            {
                atom.Append(character);
                if (quoted && i + 1 < text.Length && text[i + 1] == '\'') atom.Append(text[++i]);
                else quoted = !quoted;
            }
            else if (quoted) atom.Append(character);
            else if (!char.IsWhiteSpace(character) && character is not ('[' or ']' or '(' or ')'))
                atom.Append(char.ToUpperInvariant(character));
        }
        if (quoted || atom.Length == 0) throw new MigrationRejected("invalid_check_predicate");
        return new(null, atom.ToString(), null);
    }

    private static List<string> Split(string text, string operation)
    {
        var result = new List<string>();
        var depth = 0; var quoted = false; var start = 0;
        for (var i = 0; i < text.Length; i++)
        {
            if (text[i] == '\'')
            {
                if (quoted && i + 1 < text.Length && text[i + 1] == '\'') i++;
                else quoted = !quoted;
                continue;
            }
            if (quoted) continue;
            if (text[i] == '(') depth++;
            else if (text[i] == ')') depth--;
            if (depth < 0) throw new MigrationRejected("invalid_check_parentheses");
            if (depth != 0 || i + operation.Length > text.Length
                || !text.AsSpan(i, operation.Length).Equals(operation, StringComparison.OrdinalIgnoreCase)
                || (i > 0 && Identifier(text[i - 1]))
                || (i + operation.Length < text.Length && Identifier(text[i + operation.Length]))) continue;
            result.Add(text[start..i]);
            i += operation.Length - 1;
            start = i + 1;
        }
        if (quoted || depth != 0) throw new MigrationRejected("invalid_check_parentheses");
        result.Add(text[start..]);
        return result;
    }

    private static int ClosingParen(string text, int open)
    {
        var depth = 0; var quoted = false;
        for (var i = open; i < text.Length; i++)
        {
            if (text[i] == '\'')
            {
                if (quoted && i + 1 < text.Length && text[i + 1] == '\'') i++;
                else quoted = !quoted;
                continue;
            }
            if (quoted) continue;
            if (text[i] == '(') depth++;
            else if (text[i] == ')' && --depth == 0) return i;
        }
        throw new MigrationRejected("invalid_check_parentheses");
    }

    private static bool Identifier(char character) => char.IsLetterOrDigit(character) || character == '_';
    private sealed record Node(string? Operation, string? Atom, Node[]? Children)
    {
        internal string Render() => Operation is null ? Atom! : Operation + "(" + string.Join(",", Children!.Select(x => x.Render()).Order(StringComparer.Ordinal)) + ")";
    }
}
