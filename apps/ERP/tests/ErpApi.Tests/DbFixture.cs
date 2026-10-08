using Microsoft.Data.SqlClient;
using Xunit;

public sealed class DbFixture
{
    public string? ConnectionString { get; } = Environment.GetEnvironmentVariable("ERP_TEST_DB");
    public bool Available => !string.IsNullOrWhiteSpace(ConnectionString);

    public SqlConnection Open()
    {
        Skip.IfNot(Available, "未设置 ERP_TEST_DB，跳过数据库集成测试");
        var c = new SqlConnection(ConnectionString);
        c.Open();
        return c;
    }
}

[CollectionDefinition("db")]
public sealed class DbCollection : ICollectionFixture<DbFixture> { }
