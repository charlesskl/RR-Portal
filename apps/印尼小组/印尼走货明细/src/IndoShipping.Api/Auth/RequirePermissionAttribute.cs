namespace IndoShipping.Api.Auth;

/// <summary>
/// Controller metadata marker. ApiPermissionMiddleware is the authoritative
/// permission boundary and re-reads the current database permissions per request.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true)]
public class RequirePermissionAttribute(int position) : Attribute
{
    public int Position { get; } = position;
}
