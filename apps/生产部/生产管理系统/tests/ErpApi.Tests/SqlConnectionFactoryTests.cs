using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

public class SqlConnectionFactoryTests
{
    private static IConfiguration Cfg() => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_DB_TESTVAR" })
        .Build();

    [Fact]
    public void Missing_env_var_throws()
    {
        Environment.SetEnvironmentVariable("ERP_DB_TESTVAR", null);
        var f = new SqlConnectionFactory(Cfg());
        Assert.Throws<InvalidOperationException>(() => f.GetConnectionString());
    }

    [Fact]
    public void Reads_from_env_var()
    {
        Environment.SetEnvironmentVariable("ERP_DB_TESTVAR", "Server=x;Database=y;");
        var f = new SqlConnectionFactory(Cfg());
        Assert.Equal("Server=x;Database=y;", f.GetConnectionString());
    }
}
