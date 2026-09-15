using System.Text.RegularExpressions;

namespace VoyagePlex.Api.Services;

public static class DestinationCountryRules
{
    private static readonly (string Token, string Country)[] Mappings =
    [
        ("UNITED STATES", "美国"), ("USA", "美国"), ("US", "美国"),
        ("DALLAS", "美国"), ("ELWOOD", "美国"), ("STATESBORO", "美国"), ("SAVANNAH", "美国"),
        ("UNITED KINGDOM", "英国"), ("UK", "英国"), ("英国", "英国"), ("FELIXSTOWE", "英国"),
        ("GERMANY", "德国"), ("DE", "德国"), ("德国", "德国"), ("HAMBURG", "德国"),
        ("JAPAN", "日本"), ("日本", "日本"), ("YOKOHAMA", "日本"),
        ("SOUTH KOREA", "韩国"), ("韩国", "韩国"), ("BUSAN", "韩国"),
    ];

    public static string Infer(string? subject, string? warehouseGroupsJson)
    {
        var fromSubject = Match(subject ?? string.Empty);
        return fromSubject.Length > 0 ? fromSubject : Match(warehouseGroupsJson ?? string.Empty);
    }

    private static string Match(string text)
    {
        foreach (var (token, country) in Mappings)
        {
            if (Regex.IsMatch(text, $@"(?<![A-Za-z]){Regex.Escape(token)}(?![A-Za-z])", RegexOptions.IgnoreCase))
                return country;
        }
        return string.Empty;
    }
}
