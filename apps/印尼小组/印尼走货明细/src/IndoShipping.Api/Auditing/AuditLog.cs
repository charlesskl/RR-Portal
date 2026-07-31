using System.Data;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc;

namespace IndoShipping.Api.Auditing;

public static class AuditLog
{
    public static Task WriteAsync(
        this ControllerBase controller,
        IDbConnection connection,
        IDbTransaction? transaction,
        string module,
        string action,
        string entityType,
        object? entityId,
        string summary,
        object? details = null)
    {
        var idText = controller.User.FindFirstValue(ClaimTypes.NameIdentifier)
                     ?? controller.User.FindFirstValue(JwtRegisteredClaimNames.Sub);
        int? userId = int.TryParse(idText, out var parsed) ? parsed : null;
        var username = controller.User.FindFirstValue(ClaimTypes.Name) ?? "";
        var ipAddress = controller.HttpContext.Connection.RemoteIpAddress?.ToString() ?? "";
        var detailJson = details is null ? null : JsonSerializer.Serialize(details);

        return connection.ExecuteAsync(@"
            INSERT INTO audit_logs(
                user_id, username, module, action, entity_type, entity_id, summary, details, ip_address)
            VALUES (
                @userId, @username, @module, @action, @entityType, @entityId, @summary,
                CAST(@detailJson AS jsonb), @ipAddress)",
            new
            {
                userId,
                username,
                module,
                action,
                entityType,
                entityId = entityId?.ToString() ?? "",
                summary,
                detailJson,
                ipAddress
            }, transaction);
    }
}
