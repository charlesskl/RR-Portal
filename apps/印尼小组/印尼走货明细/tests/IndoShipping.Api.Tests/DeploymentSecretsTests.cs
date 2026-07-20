using System.Text;
using IndoShipping.Api.Startup;
using Microsoft.Data.SqlClient;
using Xunit;

namespace IndoShipping.Api.Tests;

public sealed class DeploymentSecretsTests
{
    [Fact]
    public void Base64_transport_preserves_special_characters_and_builds_safe_connection_string()
    {
        const string appPassword = "  app $;\"'\\ edge  ";
        const string jwtKey = "  jwt-$;\"'\\-key-that-is-at-least-thirty-two-characters  ";

        var secrets = DeploymentSecrets.FromBase64(Encode(appPassword), Encode(jwtKey));
        var connection = new SqlConnectionStringBuilder(secrets.ConnectionString);

        Assert.Equal("indo-sqlserver,1433", connection.DataSource);
        Assert.Equal("IndoShipping", connection.InitialCatalog);
        Assert.Equal("indoshipping_app", connection.UserID);
        Assert.Equal(appPassword, connection.Password);
        Assert.True(connection.Encrypt);
        Assert.True(connection.TrustServerCertificate);
        Assert.Equal(jwtKey, secrets.JwtKey);
    }

    private static string Encode(string value) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(value));
}
