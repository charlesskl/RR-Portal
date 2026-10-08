using ErpApi.Data.Entities;
using Microsoft.EntityFrameworkCore;
namespace ErpApi.Data;

public sealed class ErpDbContext(DbContextOptions<ErpDbContext> options) : DbContext(options)
{
    public DbSet<客户类别> 客户类别 => Set<客户类别>();
    public DbSet<客户资料> 客户资料 => Set<客户资料>();
    public DbSet<供应商类别> 供应商类别 => Set<供应商类别>();
    public DbSet<供应商资料> 供应商资料 => Set<供应商资料>();
    public DbSet<加工厂类别> 加工厂类别 => Set<加工厂类别>();
    public DbSet<加工厂资料> 加工厂资料 => Set<加工厂资料>();
    public DbSet<物料类别> 物料类别 => Set<物料类别>();
    public DbSet<物料资料> 物料资料 => Set<物料资料>();
    public DbSet<塑胶物料资料> 塑胶物料资料 => Set<塑胶物料资料>();
    public DbSet<塑胶物料类别> 塑胶物料类别 => Set<塑胶物料类别>();
    public DbSet<塑胶原料资料> 塑胶原料资料 => Set<塑胶原料资料>();
    public DbSet<塑胶共用物料表> 塑胶共用物料表 => Set<塑胶共用物料表>();
    public DbSet<工模表> 工模表 => Set<工模表>();
    public DbSet<部门信息> 部门信息 => Set<部门信息>();
    public DbSet<人事档案> 人事档案 => Set<人事档案>();
    public DbSet<报价类别> 报价类别 => Set<报价类别>();
    public DbSet<报价资料> 报价资料 => Set<报价资料>();
    public DbSet<调价表> 调价表 => Set<调价表>();
    public DbSet<调价明细> 调价明细 => Set<调价明细>();
    public DbSet<款号总表> 款号总表 => Set<款号总表>();
    public DbSet<款号明细表> 款号明细表 => Set<款号明细表>();
    public DbSet<款号物料明细表> 款号物料明细表 => Set<款号物料明细表>();
    public DbSet<发外加工项目> 发外加工项目 => Set<发外加工项目>();

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        // 全局小数精度:库列普遍为 decimal(18,4),EF 默认 (18,2) 会在写入时把 4 位小数截成 2 位
        // (实测:PUT 胶件啤工价 0.0427 → 库存 0.04)。统一按 (18,4) 映射,列本身精度更低的由 SQL Server 收尾。
        configurationBuilder.Properties<decimal>().HavePrecision(18, 4);
        configurationBuilder.Properties<decimal?>().HavePrecision(18, 4);
    }
}
