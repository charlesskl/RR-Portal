namespace IndoShipping.Api.Auth;

/// <summary>
/// Legacy-compat mode: this is a no-op marker. Old HTML front-end has no JWT, so we skip auth.
/// To re-enable, change base back to AuthorizeAttribute(PermissionHandler.PolicyName(position)).
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true)]
public class RequirePermissionAttribute(int position) : Attribute
{
    public int Position { get; } = position;
}
