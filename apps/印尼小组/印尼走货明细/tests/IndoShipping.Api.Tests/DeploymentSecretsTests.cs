using System.Text;
using IndoShipping.Api.Startup;
using Npgsql;
using Xunit;

namespace IndoShipping.Api.Tests;

public sealed class DeploymentSecretsTests
{
    [Fact]
    public void Transport_preserves_special_characters_and_builds_safe_connection_string()
    {
        const string dbPassword = "  app $;\"'\\ edge  ";
        const string jwtKey = "  jwt-$;\"'\\-key-that-is-at-least-thirty-two-characters  ";
        const string dbUser = "indo_test_user";

        var secrets = DeploymentSecrets.FromSecrets(dbPassword, Encode(jwtKey), null, dbUser, null);
        var connection = new NpgsqlConnectionStringBuilder(secrets.ConnectionString);

        Assert.Equal("db", connection.Host);
        Assert.Equal(5432, connection.Port);
        Assert.Equal("indo_shipping", connection.SearchPath);
        Assert.Equal(dbUser, connection.Username);
        Assert.Equal(dbPassword, connection.Password);
        Assert.Equal(jwtKey, secrets.JwtKey);
        Assert.Null(secrets.InitialAdminPassword);
    }

    [Fact]
    public void Defaults_fall_back_to_shared_rrportal_database_and_user()
    {
        var secrets = DeploymentSecrets.FromSecrets("pw", Encode("k"), null, null, null);
        var connection = new NpgsqlConnectionStringBuilder(secrets.ConnectionString);

        Assert.Equal("rrportal", connection.Database);
        Assert.Equal("rrportal", connection.Username);
    }

    [Fact]
    public void Admin_password_is_decoded_when_present()
    {
        var secrets = DeploymentSecrets.FromSecrets("pw", Encode("k"), null, null, Encode("admin-pw-12345"));
        Assert.Equal("admin-pw-12345", secrets.InitialAdminPassword);
    }

    private static string Encode(string value) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(value));
}
