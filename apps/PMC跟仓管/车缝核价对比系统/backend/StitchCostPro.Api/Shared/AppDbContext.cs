using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using StitchCostPro.Api.Entities;

namespace StitchCostPro.Api.Shared;

/// <summary>
/// EF Core 上下文。映射到 rebuild_schema.sql 已建好的库（DB 是唯一真相源，EF 只映射、不 migrate 建表）。
/// 实体用 PascalCase POCO，这里统一做 snake_case 列名/表名映射。
/// </summary>
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Dept> Depts => Set<Dept>();
    public DbSet<SysUser> SysUsers => Set<SysUser>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Supplier> Suppliers => Set<Supplier>();
    public DbSet<QualityInspection> QualityInspections => Set<QualityInspection>();
    public DbSet<SupplierQualityStat> SupplierQualityStats => Set<SupplierQualityStat>();
    public DbSet<RateConfig> RateConfigs => Set<RateConfig>();
    public DbSet<ProductQuote> ProductQuotes => Set<ProductQuote>();
    public DbSet<PurchaseOrder> PurchaseOrders => Set<PurchaseOrder>();
    public DbSet<PurchaseOrderLine> PurchaseOrderLines => Set<PurchaseOrderLine>();
    public DbSet<DeliveryNote> DeliveryNotes => Set<DeliveryNote>();
    public DbSet<DeliveryInspection> DeliveryInspections => Set<DeliveryInspection>();
    public DbSet<QualityDefect> QualityDefects => Set<QualityDefect>();
    public DbSet<OrderPriceHistory> OrderPriceHistories => Set<OrderPriceHistory>();
    public DbSet<ProductImportAlias> ProductImportAliases => Set<ProductImportAlias>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        // 门户与其他系统共用 PostgreSQL 数据库，使用独立 schema 隔离数据表。
        if (Database.IsNpgsql())
            b.HasDefaultSchema("stitch_cost");

        // —— 显式声明非约定主键（EF 默认只认 Id / {Type}Id）——
        b.Entity<Dept>().HasKey(x => x.DeptId);
        b.Entity<SysUser>().HasKey(x => x.UserId);
        b.Entity<Product>().HasKey(x => x.ProductId);
        b.Entity<Supplier>().HasKey(x => x.SupplierId);
        b.Entity<QualityInspection>().HasKey(x => x.InspectionId);
        b.Entity<SupplierQualityStat>().HasKey(x => x.StatId);
        b.Entity<RateConfig>().HasKey(x => x.ConfigId);
        b.Entity<ProductQuote>().HasKey(x => x.QuoteId);
        b.Entity<PurchaseOrder>().HasKey(x => x.OrderId);
        b.Entity<PurchaseOrderLine>().HasKey(x => x.LineId);
        b.Entity<DeliveryNote>().HasKey(x => x.DeliveryNoteId);
        b.Entity<DeliveryInspection>().HasKey(x => x.InspectionId);
        b.Entity<QualityDefect>().HasKey(x => x.DefectId);
        b.Entity<OrderPriceHistory>().HasKey(x => x.HistoryId);
        b.Entity<ProductImportAlias>().HasKey(x => x.AliasId);
        b.Entity<ProductImportAlias>().HasIndex(x => new { x.ProductCode, x.ExternalName }).IsUnique();

        // —— 全局：表名取实体类名（单数，对应手写 DDL 的单数表名，而非 DbSet 的复数）——
        //    列名取属性名，统一转 snake_case；所有外键改为 Restrict（与 DDL 的 NO ACTION 一致）。
        foreach (var entity in b.Model.GetEntityTypes())
        {
            entity.SetTableName(ToSnake(entity.ClrType.Name));

            foreach (var prop in entity.GetProperties())
                prop.SetColumnName(ToSnake(prop.Name));

            foreach (var fk in entity.GetForeignKeys())
                fk.DeleteBehavior = DeleteBehavior.Restrict;
        }
    }

    /// <summary>PascalCase → snake_case（DeptId → dept_id, ExtMainId → ext_main_id, QcScore → qc_score）。</summary>
    private static string ToSnake(string name)
    {
        var sb = new StringBuilder(name.Length + 8);
        for (var i = 0; i < name.Length; i++)
        {
            var c = name[i];
            if (char.IsUpper(c) && i > 0)
                sb.Append('_');
            sb.Append(char.ToLowerInvariant(c));
        }
        return sb.ToString();
    }
}
