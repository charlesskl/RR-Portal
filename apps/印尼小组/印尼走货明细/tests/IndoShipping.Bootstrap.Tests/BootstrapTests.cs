using IndoShipping.Bootstrap;
using Microsoft.Data.SqlClient;
using System.Text;
using System.Text.RegularExpressions;
using Xunit;

namespace IndoShipping.Bootstrap.Tests;

public class BootstrapTests
{
    [Fact]
    public void Base64_transport_preserves_special_characters_for_bootstrap_and_rotation()
    {
        const string saPassword = "  sa $;\"'\\ edge  ";
        const string appPassword = "  app $;\"'\\ edge  ";
        const string adminPassword = "  admin $;\"'\\ edge  ";
        const string rotatedSaPassword = "  rotated $;\"'\\ edge  ";

        var secrets = BootstrapSecrets.FromBase64(
            Encode(saPassword),
            Encode(appPassword),
            Encode(adminPassword));
        var connection = new SqlConnectionStringBuilder(secrets.SaConnection);

        Assert.Equal("indo-sqlserver,1433", connection.DataSource);
        Assert.Equal("master", connection.InitialCatalog);
        Assert.Equal("sa", connection.UserID);
        Assert.Equal(saPassword, connection.Password);
        Assert.Equal(appPassword, secrets.AppPassword);
        Assert.Equal(adminPassword, secrets.AdminPassword);

        using var sqlConnection = new SqlConnection(secrets.SaConnection);
        using var command = SaPasswordRotator.CreateCommand(sqlConnection, rotatedSaPassword);
        Assert.DoesNotContain(rotatedSaPassword, command.CommandText, StringComparison.Ordinal);
        Assert.Equal(rotatedSaPassword, command.Parameters["@newPassword"].Value);
    }

    [Fact]
    public void Split_Batches_Only_On_Go_Lines()
    {
        var batches = SqlBatchSplitter.Split("SELECT 'GO';\nGO\nSELECT 2;");

        Assert.Equal(2, batches.Count);
    }

    [Fact]
    public void Snapshot_Reports_Expected_Core_Counts()
    {
        var snapshot = SeedSnapshot.Load(TestPaths.SeedJson);

        Assert.Equal(2, snapshot.Count("customers"));
        Assert.Equal(1, snapshot.Count("products"));
        Assert.Equal(1, snapshot.Count("materials"));
        Assert.Equal(1, snapshot.Count("images"));
        Assert.Equal(1, snapshot.Count("purchase_orders"));
        Assert.Equal(1, snapshot.Count("po_items"));
    }

    [Fact]
    public void Snapshot_Retains_Image_Payloads_And_Passwordless_User_Metadata()
    {
        var snapshot = SeedSnapshot.Load(TestPaths.SeedJson);

        Assert.Single(snapshot.Images);
        Assert.StartsWith("data:", snapshot.Images[0].GetProperty("data_url").GetString());
        Assert.Equal(2, snapshot.Users.Count);
        Assert.All(snapshot.Users, user =>
        {
            Assert.False(user.TryGetProperty("passwordHash", out _));
            Assert.False(user.TryGetProperty("password_hash", out _));
        });
    }

    [Fact]
    public void Snapshot_And_Import_Mapping_Preserve_All_Historical_Fields()
    {
        var snapshot = SeedSnapshot.Load(TestPaths.SeedJson);
        var material = snapshot.Rows("materials").Single(row => row.GetProperty("id").GetInt32() == 127);
        var poItem = snapshot.Rows("po_items").Single(row => row.GetProperty("id").GetInt32() == 625);

        Assert.Equal(1m, material.GetProperty("usage_qty").GetDecimal());
        Assert.Equal("Synthetic fastener", poItem.GetProperty("material_name").GetString());
        Assert.Equal("Hardware", poItem.GetProperty("category").GetString());
        Assert.Equal("2.6x12", poItem.GetProperty("spec").GetString());
        Assert.Equal(1m, poItem.GetProperty("usage_qty").GetDecimal());
        Assert.Equal(240m, poItem.GetProperty("ordered_qty").GetDecimal());
        Assert.Equal(240m, poItem.GetProperty("material_qty").GetDecimal());
        Assert.Equal(0m, poItem.GetProperty("spoilage_qty").GetDecimal());
        Assert.Equal(240m, poItem.GetProperty("purchase_qty").GetDecimal());
        Assert.Equal("KGM", poItem.GetProperty("purchase_unit").GetString());

        Assert.Contains("usage_qty", BootstrapSql.ImportColumns("materials"));
        foreach (var column in new[]
                 {
                     "material_name", "category", "spec", "usage_qty", "ordered_qty",
                     "material_qty", "spoilage_qty", "purchase_qty", "purchase_unit"
                 })
        {
            Assert.Contains(column, BootstrapSql.ImportColumns("po_items"));
        }
    }

    [Fact]
    public void Schema_Defines_All_Historical_Columns()
    {
        var schema = File.ReadAllText(TestPaths.SchemaSql);

        Assert.Matches(new Regex(@"usage_qty\s+DECIMAL\(18,6\)", RegexOptions.IgnoreCase), schema);
        foreach (var column in new[]
                 {
                     "material_name", "category", "spec", "usage_qty", "ordered_qty",
                     "material_qty", "spoilage_qty", "purchase_qty", "purchase_unit"
                 })
        {
            Assert.Matches(new Regex($@"\b{column}\s+", RegexOptions.IgnoreCase), schema);
        }
    }

    [Fact]
    public void Safe_Schema_Batches_Exclude_Destructive_Statements()
    {
        const string sql = "DROP TABLE dbo.customers;\nGO\nCREATE TABLE dbo.customers (id int);\nGO\nDROP DATABASE IndoShipping;";

        var batches = BootstrapSql.SafeSchemaBatches(sql);

        var batch = Assert.Single(batches);
        Assert.StartsWith("CREATE TABLE", batch);
    }

    [Theory]
    [InlineData(true, 99, ExistingUsersState.ExistingData, SeedImportDecision.Skip)]
    [InlineData(false, 0, ExistingUsersState.None, SeedImportDecision.Import)]
    [InlineData(false, 0, ExistingUsersState.ExpectedPlaceholder, SeedImportDecision.Import)]
    public void Seed_Import_Decision_Is_Idempotent(
        bool markerExists,
        long businessRows,
        ExistingUsersState usersState,
        SeedImportDecision expected)
    {
        Assert.Equal(expected, BootstrapSql.DecideSeedImport(markerExists, businessRows, usersState));
    }

    [Fact]
    public void Seed_Import_Rejects_Unmarked_Business_Data()
    {
        var error = Assert.Throws<InvalidOperationException>(() =>
            BootstrapSql.DecideSeedImport(false, 1, ExistingUsersState.None));

        Assert.Contains("without seed marker", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Seed_Import_Rejects_Existing_Users_Without_Marker()
    {
        var error = Assert.Throws<InvalidOperationException>(() =>
            BootstrapSql.DecideSeedImport(false, 0, ExistingUsersState.ExistingData));

        Assert.Contains("Users", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Bootstrap_Docs_Do_Not_Advertise_A_Default_Password()
    {
        Assert.DoesNotContain("admin123", File.ReadAllText(TestPaths.Readme), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("admin123", File.ReadAllText(TestPaths.ApplySchema), StringComparison.OrdinalIgnoreCase);
    }

    private static string Encode(string value) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(value));
}

internal static class TestPaths
{
    public static string AppRoot { get; } = FindAppRoot();
    public static string SeedJson { get; } = FindSeedJson();
    public static string SchemaSql => Path.Combine(AppRoot, "db", "rebuild_schema.sql");
    public static string Readme => Path.Combine(AppRoot, "README.md");
    public static string ApplySchema => Path.Combine(AppRoot, "db", "apply-schema.ps1");

    private static string FindAppRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory);
             directory is not null;
             directory = directory.Parent)
        {
            var solution = Path.Combine(directory.FullName, "IndoShipping.sln");
            if (File.Exists(solution))
                return directory.FullName;
        }

        throw new FileNotFoundException("Could not locate IndoShipping.sln from the test output directory.");
    }

    private static string FindSeedJson() => Path.Combine(AppRoot, "seed", "example-data.json");
}
