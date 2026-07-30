using System.Text;
using Npgsql;

namespace IndoShipping.Api.Startup;

public sealed record DeploymentSecrets(string ConnectionString, string JwtKey, string? InitialAdminPassword)
{
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    public static bool TryApplyToConfiguration(IConfiguration configuration)
    {
        var dbPassword = Environment.GetEnvironmentVariable("DB_PASSWORD");
        var jwtKeyBase64 = Environment.GetEnvironmentVariable("INDO_SHIPPING_JWT_KEY_B64");
        if (dbPassword is null && jwtKeyBase64 is null)
            return false;

        var secrets = FromSecrets(
            Required(dbPassword, "DB_PASSWORD"),
            Required(jwtKeyBase64, "INDO_SHIPPING_JWT_KEY_B64"),
            Environment.GetEnvironmentVariable("DB_NAME"),
            Environment.GetEnvironmentVariable("DB_USER"),
            Environment.GetEnvironmentVariable("INDO_SHIPPING_ADMIN_PASSWORD_B64"));
        configuration["ConnectionStrings:Default"] = secrets.ConnectionString;
        configuration["Jwt:Key"] = secrets.JwtKey;
        if (secrets.InitialAdminPassword is not null)
            configuration["Bootstrap:InitialAdminPassword"] = secrets.InitialAdminPassword;
        return true;
    }

    public static DeploymentSecrets FromSecrets(
        string dbPassword,
        string jwtKeyBase64,
        string? dbName,
        string? dbUser,
        string? adminPasswordBase64)
    {
        var jwtKey = Decode(jwtKeyBase64, "INDO_SHIPPING_JWT_KEY_B64");
        var adminPassword = adminPasswordBase64 is { Length: > 0 }
            ? Decode(adminPasswordBase64, "INDO_SHIPPING_ADMIN_PASSWORD_B64")
            : null;
        var connection = new NpgsqlConnectionStringBuilder
        {
            Host = "db",
            Port = 5432,
            Database = string.IsNullOrWhiteSpace(dbName) ? "rrportal" : dbName,
            Username = string.IsNullOrWhiteSpace(dbUser) ? "rrportal" : dbUser,
            Password = dbPassword,
            SearchPath = "indo_shipping",
            PersistSecurityInfo = false
        };
        return new DeploymentSecrets(connection.ConnectionString, jwtKey, adminPassword);
    }

    private static string Decode(string encoded, string name)
    {
        try
        {
            var value = StrictUtf8.GetString(Convert.FromBase64String(encoded));
            return value.Length > 0
                ? value
                : throw new InvalidOperationException($"Decoded environment variable {name} is empty.");
        }
        catch (FormatException exception)
        {
            throw new InvalidOperationException($"Environment variable {name} is not valid base64.", exception);
        }
        catch (DecoderFallbackException exception)
        {
            throw new InvalidOperationException($"Environment variable {name} is not valid UTF-8.", exception);
        }
    }

    private static string Required(string? value, string name) =>
        value is { Length: > 0 }
            ? value
            : throw new InvalidOperationException($"Required environment variable {name} is missing.");
}
