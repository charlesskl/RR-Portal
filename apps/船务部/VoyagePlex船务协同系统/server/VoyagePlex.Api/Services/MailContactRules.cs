namespace VoyagePlex.Api.Services;

public static class MailContactRules
{
    private static readonly HashSet<string> InternalDomains = new(StringComparer.OrdinalIgnoreCase)
        { "hanson2.com", "royalregent.net" };

    public static bool IsInternal(string email)
    {
        var normalized = email ?? string.Empty;
        var at = normalized.LastIndexOf('@');
        return at >= 0 && at < normalized.Length - 1 && InternalDomains.Contains(normalized[(at + 1)..].Trim());
    }
}
