using System.Data;
using Microsoft.Data.SqlClient;

namespace IndoShipping.Infrastructure.Persistence;

public interface ISqlConnectionFactory
{
    IDbConnection Create();
}

public class SqlConnectionFactory(string connectionString) : ISqlConnectionFactory
{
    public IDbConnection Create() => new SqlConnection(connectionString);
}
