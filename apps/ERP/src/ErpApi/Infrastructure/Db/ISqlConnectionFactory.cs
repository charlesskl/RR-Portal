using Microsoft.Data.SqlClient;
namespace ErpApi.Infrastructure.Db;
public interface ISqlConnectionFactory
{
    string GetConnectionString();
    SqlConnection Create();
}
