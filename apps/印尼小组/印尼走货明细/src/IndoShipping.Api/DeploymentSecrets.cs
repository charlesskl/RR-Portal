using System.Text;
using Microsoft.Data.SqlClient;

namespace IndoShipping.Api.Startup;

public sealed record DeploymentSecrets(string ConnectionString, string JwtKey)
{
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    public static bool TryApplyToConfiguration(IConfiguration configuration)
    {
        var appPasswordBase64 = Environment.GetEnvironmentVariable("INDO_SQL_APP_PASSWORD_B64");
        var jwtKeyBase64 = Environment.GetEnvironmentVariable("INDO_SHIPPING_JWT_KEY_B64");
        if (appPasswordBase64 is null && jwtKeyBase64 is null)
            return false;

        var secrets = FromBase64(
            Required(appPasswordBase64, "INDO_SQL_APP_PASSWORD_B64"),
            Required(jwtKeyBase64, "INDO_SHIPPING_JWT_KEY_B64"));
        configuration["ConnectionStrings:Default"] = secrets.ConnectionString;
        configuration["Jwt:Key"] = secrets.JwtKey;
        return true;
    }

    public static DeploymentSecrets FromBase64(string appPasswordBase64, string jwtKeyBase64)
    {
        var appPassword = Decode(appPasswordBase64, "INDO_SQL_APP_PASSWORD_B64");
        var jwtKey = Decode(jwtKeyBase64, "INDO_SHIPPING_JWT_KEY_B64");
        var connection = new SqlConnectionStringBuilder
        {
            DataSource = "indo-sqlserver,1433",
            InitialCatalog = "IndoShipping",
            UserID = "indoshipping_app",
            Password = appPassword,
            Encrypt = true,
            TrustServerCertificate = true,
            PersistSecurityInfo = false
        };
        return new DeploymentSecrets(connection.ConnectionString, jwtKey);
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
