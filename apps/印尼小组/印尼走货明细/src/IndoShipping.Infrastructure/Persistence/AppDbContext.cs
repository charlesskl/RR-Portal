using IndoShipping.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace IndoShipping.Infrastructure.Persistence;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Material> Materials => Set<Material>();
    public DbSet<Shipment> Shipments => Set<Shipment>();
    public DbSet<ShipmentItem> ShipmentItems => Set<ShipmentItem>();
    public DbSet<PurchaseOrder> PurchaseOrders => Set<PurchaseOrder>();
    public DbSet<PoItem> PoItems => Set<PoItem>();
    public DbSet<Schedule> Schedules => Set<Schedule>();
    public DbSet<OutboundRecord> Outbounds => Set<OutboundRecord>();
    public DbSet<DictHs> DictHs => Set<DictHs>();
    public DbSet<DictSupplier> DictSuppliers => Set<DictSupplier>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<SettingEntry> Settings => Set<SettingEntry>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>(e =>
        {
            e.ToTable("Users");
            e.HasKey(x => x.Id);
            e.Property(x => x.Username).HasMaxLength(64).IsRequired();
            e.HasIndex(x => x.Username).IsUnique();
            e.Property(x => x.PasswordHash).HasMaxLength(255).IsRequired();
            e.Property(x => x.DisplayName).HasMaxLength(128);
            e.Property(x => x.Userbqrpower).HasMaxLength(9).IsRequired();
            e.Property(x => x.Usereditpower).HasMaxLength(9).IsRequired();
        });

        b.Entity<Product>(e =>
        {
            e.ToTable("products");
            e.HasKey(x => x.Code);
            e.Property(x => x.Code).HasColumnName("code").HasMaxLength(64);
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(256);
            e.Property(x => x.HsCn).HasColumnName("hs_cn").HasMaxLength(64);
            e.Property(x => x.HsId).HasColumnName("hs_id").HasMaxLength(64);
            e.Property(x => x.Customer).HasColumnName("customer").HasMaxLength(256);
            e.Property(x => x.Moldings).HasColumnName("moldings");
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");

            e.HasMany(x => x.Materials)
             .WithOne()
             .HasForeignKey(m => m.ProductCode)
             .HasPrincipalKey(p => p.Code)
             .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Material>(e =>
        {
            e.ToTable("materials");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.ProductCode).HasColumnName("product_code").HasMaxLength(64);
            e.Property(x => x.ItemNo).HasColumnName("item_no").HasMaxLength(64);
            e.Property(x => x.NameZh).HasColumnName("name_zh").HasMaxLength(256);
            e.Property(x => x.NameEn).HasColumnName("name_en").HasMaxLength(256);
            e.Property(x => x.Spec).HasColumnName("spec").HasMaxLength(256);
            e.Property(x => x.Category).HasColumnName("category").HasMaxLength(64);
            e.Property(x => x.MaterialCode).HasColumnName("material_code").HasMaxLength(64);
            e.Property(x => x.HsCn).HasColumnName("hs_cn").HasMaxLength(64);
            e.Property(x => x.HsId).HasColumnName("hs_id").HasMaxLength(64);
            e.Property(x => x.Supplier).HasColumnName("supplier").HasMaxLength(256);
            e.Property(x => x.CustomsCompany).HasColumnName("customs_company").HasMaxLength(256);
            e.Property(x => x.UnitKg).HasColumnName("unit_kg").HasMaxLength(16);
            e.Property(x => x.GrossPerPc).HasColumnName("gross_per_pc").HasColumnType("decimal(18,6)");
            e.Property(x => x.NetPerPc).HasColumnName("net_per_pc").HasColumnType("decimal(18,6)");
            e.Property(x => x.Length).HasColumnName("length").HasColumnType("decimal(18,4)");
            e.Property(x => x.Width).HasColumnName("width").HasColumnType("decimal(18,4)");
            e.Property(x => x.Height).HasColumnName("height").HasColumnType("decimal(18,4)");
            e.Property(x => x.QtyPerCarton).HasColumnName("qty_per_carton").HasColumnType("decimal(18,4)");
            e.Property(x => x.WeightPerCarton).HasColumnName("weight_per_carton").HasColumnType("decimal(18,4)");
            e.Property(x => x.ImageId).HasColumnName("image_id").HasMaxLength(64);
            e.Property(x => x.Active).HasColumnName("active");
            e.Property(x => x.SortOrder).HasColumnName("sort_order");
            e.Property(x => x.CreatedAt).HasColumnName("created_at");

            e.HasIndex(x => x.ProductCode);
            e.HasIndex(x => x.NameZh);
        });

        b.Entity<Shipment>(e =>
        {
            e.ToTable("shipments");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.Customer).HasColumnName("customer").HasMaxLength(256);
            e.Property(x => x.ContainerNo).HasColumnName("container_no").HasMaxLength(64);
            e.Property(x => x.ContainerCount).HasColumnName("container_count");
            e.Property(x => x.ShipDate).HasColumnName("ship_date");
            e.Property(x => x.BlNo).HasColumnName("bl_no").HasMaxLength(64);
            e.Property(x => x.Rate).HasColumnName("rate").HasColumnType("decimal(10,4)");
            e.Property(x => x.Status).HasColumnName("status").HasMaxLength(32);
            e.Property(x => x.CreatedAt).HasColumnName("created_at");

            e.HasMany(x => x.Items)
             .WithOne()
             .HasForeignKey(i => i.ShipmentId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ShipmentItem>(e =>
        {
            e.ToTable("shipment_items");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.ShipmentId).HasColumnName("shipment_id");
            e.Property(x => x.MaterialId).HasColumnName("material_id");
            e.Property(x => x.Seq).HasColumnName("seq");
            e.Property(x => x.Kg).HasColumnName("kg").HasColumnType("decimal(18,4)");
            e.Property(x => x.Qty).HasColumnName("qty").HasColumnType("decimal(18,4)");
            e.Property(x => x.Cartons).HasColumnName("cartons");
            e.Property(x => x.QtyPerCarton).HasColumnName("qty_per_carton").HasMaxLength(64);
            e.Property(x => x.Pallet).HasColumnName("pallet").HasMaxLength(64);
            e.Property(x => x.Price).HasColumnName("price").HasColumnType("decimal(18,4)");
            e.Property(x => x.Currency).HasColumnName("currency").HasMaxLength(8);
            e.Property(x => x.PoNo).HasColumnName("po_no").HasMaxLength(64);
            e.Property(x => x.PoDate).HasColumnName("po_date");
            e.Property(x => x.Supplier).HasColumnName("supplier").HasMaxLength(256);
            e.Property(x => x.CustomsCompany).HasColumnName("customs_company").HasMaxLength(256);
            e.Property(x => x.BlHead).HasColumnName("bl_head").HasMaxLength(256);
            e.Property(x => x.ContractNo).HasColumnName("contract_no").HasMaxLength(64);
            e.Property(x => x.ContractDate).HasColumnName("contract_date");
            e.Property(x => x.InvoiceNo).HasColumnName("invoice_no").HasMaxLength(64);
            e.Property(x => x.InvoiceDate).HasColumnName("invoice_date");
            e.Property(x => x.InvoicePrice).HasColumnName("invoice_price").HasColumnType("decimal(18,4)");
            e.Property(x => x.ProductUse).HasColumnName("product_use").HasMaxLength(256);
            e.Property(x => x.FormulaName).HasColumnName("formula_name").HasMaxLength(256);

            e.HasIndex(x => x.ShipmentId);
            e.HasIndex(x => x.PoNo);
        });

        b.Entity<PurchaseOrder>(e =>
        {
            e.ToTable("purchase_orders");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.PoNo).HasColumnName("po_no").HasMaxLength(64);
            e.Property(x => x.Supplier).HasColumnName("supplier").HasMaxLength(256);
            e.Property(x => x.Status).HasColumnName("status").HasMaxLength(32);
            e.Property(x => x.OrderDate).HasColumnName("order_date");
            e.Property(x => x.Notes).HasColumnName("notes");
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.HasIndex(x => x.PoNo).IsUnique();
            e.HasMany(x => x.Items)
             .WithOne()
             .HasForeignKey(i => i.PoId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<PoItem>(e =>
        {
            e.ToTable("po_items");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.PoId).HasColumnName("po_id");
            e.Property(x => x.ProductCode).HasColumnName("product_code").HasMaxLength(64);
            e.Property(x => x.MaterialId).HasColumnName("material_id");
            e.Property(x => x.Qty).HasColumnName("qty").HasColumnType("decimal(18,4)");
            e.Property(x => x.Price).HasColumnName("price").HasColumnType("decimal(18,4)");
            e.Property(x => x.Currency).HasColumnName("currency").HasMaxLength(8);
            e.Property(x => x.Notes).HasColumnName("notes");
            e.HasIndex(x => x.PoId);
        });

        b.Entity<Schedule>(e =>
        {
            e.ToTable("schedules");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.WeekLabel).HasColumnName("week_label").HasMaxLength(64);
            e.Property(x => x.UploadDate).HasColumnName("upload_date");
            e.Property(x => x.RawRows).HasColumnName("raw_rows");
            e.Property(x => x.DiffFromPrev).HasColumnName("diff_from_prev");
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.HasIndex(x => x.WeekLabel).IsUnique();
        });

        b.Entity<OutboundRecord>(e =>
        {
            e.ToTable("outbound");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.PoNo).HasColumnName("po_no").HasMaxLength(64);
            e.Property(x => x.MaterialId).HasColumnName("material_id");
            e.Property(x => x.Qty).HasColumnName("qty").HasColumnType("decimal(18,4)");
            e.Property(x => x.OutDate).HasColumnName("out_date");
            e.Property(x => x.Notes).HasColumnName("notes");
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.HasIndex(x => x.PoNo);
        });

        b.Entity<DictHs>(e =>
        {
            e.ToTable("dict_hs");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.Keyword).HasColumnName("keyword").HasMaxLength(128).IsRequired();
            e.Property(x => x.HsCn).HasColumnName("hs_cn").HasMaxLength(64);
            e.Property(x => x.HsId).HasColumnName("hs_id").HasMaxLength(64);
            e.Property(x => x.Priority).HasColumnName("priority");
            e.HasIndex(x => x.Keyword);
        });

        b.Entity<DictSupplier>(e =>
        {
            e.ToTable("dict_supplier");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.Keyword).HasColumnName("keyword").HasMaxLength(128).IsRequired();
            e.Property(x => x.FullName).HasColumnName("full_name").HasMaxLength(256);
            e.Property(x => x.CustomsCompany).HasColumnName("customs_company").HasMaxLength(256);
            e.Property(x => x.Priority).HasColumnName("priority");
            e.HasIndex(x => x.Keyword);
        });

        b.Entity<Customer>(e =>
        {
            e.ToTable("customers");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(256).IsRequired();
            e.Property(x => x.CreatedAt).HasColumnName("created_at");
            e.Property(x => x.Active).HasColumnName("active");
            e.HasIndex(x => x.Name).IsUnique();
        });

        b.Entity<SettingEntry>(e =>
        {
            e.ToTable("settings");
            e.HasKey(x => x.Key);
            e.Property(x => x.Key).HasColumnName("key").HasMaxLength(128);
            e.Property(x => x.Value).HasColumnName("value");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at");
        });
    }
}
