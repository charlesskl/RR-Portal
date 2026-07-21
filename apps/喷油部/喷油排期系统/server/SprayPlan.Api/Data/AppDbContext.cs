using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using SprayPlan.Api.Entities;

namespace SprayPlan.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<ProductionLine> ProductionLines => Set<ProductionLine>();
    public DbSet<Machine> Machines => Set<Machine>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<ProductItem> ProductItems => Set<ProductItem>();
    public DbSet<ProductPart> ProductParts => Set<ProductPart>();
    public DbSet<CraftAlias> CraftAliases => Set<CraftAlias>();
    public DbSet<EquipmentKind> EquipmentKinds => Set<EquipmentKind>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderLine> OrderLines => Set<OrderLine>();
    public DbSet<OrderPartQty> OrderPartQtys => Set<OrderPartQty>();
    public DbSet<ProductionPlan> ProductionPlans => Set<ProductionPlan>();
    public DbSet<Holiday> Holidays => Set<Holiday>();
    public DbSet<InventoryMove> InventoryMoves => Set<InventoryMove>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        var u = b.Entity<User>();
        u.ToTable("users");                       // 沿用 prisma @@map("users")
        u.HasIndex(x => x.Username).IsUnique();

        // Prisma 的 SQLite 列名是 camelCase（schema 无 @map），显式对齐避免歧义
        u.Property(x => x.Username).HasColumnName("username");
        u.Property(x => x.PasswordHash).HasColumnName("passwordHash");
        u.Property(x => x.DisplayName).HasColumnName("displayName");
        u.Property(x => x.Role).HasColumnName("role");
        u.Property(x => x.IsActive).HasColumnName("isActive");
        u.Property(x => x.CreatedAt).HasColumnName("createdAt").HasConversion(MsConverter);
        u.Property(x => x.UpdatedAt).HasColumnName("updatedAt").HasConversion(MsConverter);
        u.Property(x => x.LastLoginAt).HasColumnName("lastLoginAt").HasConversion(NullableMsConverter);

        // 拉别 production_lines（列名 camelCase 对齐 prisma）
        var l = b.Entity<ProductionLine>();
        l.ToTable("production_lines");
        l.Property(x => x.Name).HasColumnName("name");
        l.Property(x => x.Workshop).HasColumnName("workshop");
        l.Property(x => x.LeaderName).HasColumnName("leaderName");
        l.Property(x => x.CraftType).HasColumnName("craftType");
        l.Property(x => x.IsActive).HasColumnName("isActive");

        // 机台 machines（机台号按拉别唯一，对齐 prisma @@unique([lineId, machineNo])）
        var m = b.Entity<Machine>();
        m.ToTable("machines");
        m.HasIndex(x => new { x.LineId, x.MachineNo }).IsUnique();
        m.Property(x => x.MachineNo).HasColumnName("machineNo");
        m.Property(x => x.LineId).HasColumnName("lineId");
        m.Property(x => x.MachineType).HasColumnName("machineType");
        m.Property(x => x.IsUV).HasColumnName("isUV");
        m.Property(x => x.IsActive).HasColumnName("isActive");
        m.Property(x => x.EquipmentKind).HasColumnName("equipmentKind");
        m.HasOne(x => x.Line).WithMany(x => x.Machines).HasForeignKey(x => x.LineId);

        // 产品 products（货号唯一，日期毫秒转换器）
        var p = b.Entity<Product>();
        p.ToTable("products");
        p.HasIndex(x => x.ProductNo).IsUnique();
        p.Property(x => x.ProductNo).HasColumnName("productNo");
        p.Property(x => x.IterationNo).HasColumnName("iterationNo");
        p.Property(x => x.Status).HasColumnName("status");
        p.Property(x => x.EffectiveDate).HasColumnName("effectiveDate").HasConversion(NullableMsConverter);
        p.Property(x => x.Remark).HasColumnName("remark");
        p.Property(x => x.CreatedBy).HasColumnName("createdBy");
        p.Property(x => x.CreatedAt).HasColumnName("createdAt").HasConversion(MsConverter);
        p.Property(x => x.LastUpdatedBy).HasColumnName("lastUpdatedBy");
        p.Property(x => x.UpdatedAt).HasColumnName("updatedAt").HasConversion(MsConverter);

        // 子件 product_items
        var pi = b.Entity<ProductItem>();
        pi.ToTable("product_items");
        pi.Property(x => x.ProductId).HasColumnName("productId");
        pi.Property(x => x.ItemName).HasColumnName("itemName");
        pi.Property(x => x.ItemOrder).HasColumnName("itemOrder");
        pi.HasOne(x => x.Product).WithMany(x => x.Items).HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Cascade);

        // 部位 product_parts
        var pp = b.Entity<ProductPart>();
        pp.ToTable("product_parts");
        pp.Property(x => x.ItemId).HasColumnName("itemId");
        pp.Property(x => x.PartName).HasColumnName("partName");
        pp.Property(x => x.PartOrder).HasColumnName("partOrder");
        pp.Property(x => x.UnitCost).HasColumnName("unitCost");
        pp.Property(x => x.LaborPrice).HasColumnName("laborPrice");
        pp.Property(x => x.PaintCost).HasColumnName("paintCost");
        pp.Property(x => x.QuotedPrice).HasColumnName("quotedPrice");
        pp.Property(x => x.Craft).HasColumnName("craft");
        pp.Property(x => x.CraftDetail).HasColumnName("craftDetail");
        pp.Property(x => x.DailyCapacity).HasColumnName("dailyCapacity");
        pp.Property(x => x.ProductionMode).HasColumnName("productionMode");
        pp.Property(x => x.StdMachineCount).HasColumnName("stdMachineCount");
        pp.Property(x => x.CraftPasses).HasColumnName("craftPasses");
        pp.Property(x => x.Remark).HasColumnName("remark");
        pp.HasOne(x => x.Item).WithMany(x => x.Parts).HasForeignKey(x => x.ItemId).OnDelete(DeleteBehavior.Cascade);

        // ===== 订单 3 表 =====
        var o = b.Entity<Order>();
        o.ToTable("orders");
        o.HasIndex(x => x.ExternalOrderNo).IsUnique();
        o.Property(x => x.ExternalOrderNo).HasColumnName("externalOrderNo");
        o.Property(x => x.ProductId).HasColumnName("productId");
        o.Property(x => x.OrderDate).HasColumnName("orderDate").HasConversion(MsConverter);
        o.Property(x => x.DeliveryDate).HasColumnName("deliveryDate").HasConversion(NullableMsConverter);
        o.Property(x => x.Status).HasColumnName("status");
        o.Property(x => x.IsMA).HasColumnName("isMA");
        o.Property(x => x.IsUrgent).HasColumnName("isUrgent");
        o.Property(x => x.PendingProduct).HasColumnName("pendingProduct");
        o.Property(x => x.Remark).HasColumnName("remark");
        o.Property(x => x.CreatedBy).HasColumnName("createdBy");
        o.Property(x => x.CreatedAt).HasColumnName("createdAt").HasConversion(MsConverter);
        o.Property(x => x.LastUpdatedBy).HasColumnName("lastUpdatedBy");
        o.Property(x => x.UpdatedAt).HasColumnName("updatedAt").HasConversion(MsConverter);
        o.HasOne(x => x.Product).WithMany().HasForeignKey(x => x.ProductId);

        var ol = b.Entity<OrderLine>();
        ol.ToTable("order_lines");
        ol.Property(x => x.OrderId).HasColumnName("orderId");
        ol.Property(x => x.ItemName).HasColumnName("itemName");
        ol.Property(x => x.SourceItemId).HasColumnName("sourceItemId");
        ol.Property(x => x.LineOrder).HasColumnName("lineOrder");
        ol.HasOne(x => x.Order).WithMany(x => x.Lines).HasForeignKey(x => x.OrderId).OnDelete(DeleteBehavior.Cascade);

        var oq = b.Entity<OrderPartQty>();
        oq.ToTable("order_part_qtys");
        oq.Property(x => x.OrderLineId).HasColumnName("orderLineId");
        oq.Property(x => x.PartName).HasColumnName("partName");
        oq.Property(x => x.SourcePartId).HasColumnName("sourcePartId");
        oq.Property(x => x.Qty).HasColumnName("qty");
        oq.Property(x => x.PartOrder).HasColumnName("partOrder");
        oq.HasOne(x => x.Line).WithMany(x => x.PartQtys).HasForeignKey(x => x.OrderLineId).OnDelete(DeleteBehavior.Cascade);

        // ===== 排期 production_plans（系统心脏）=====
        var pl = b.Entity<ProductionPlan>();
        pl.ToTable("production_plans");
        pl.Property(x => x.PlanDate).HasColumnName("planDate").HasConversion(MsConverter);
        pl.Property(x => x.PlanType).HasColumnName("planType");
        pl.Property(x => x.LineId).HasColumnName("lineId");
        pl.Property(x => x.OrderId).HasColumnName("orderId");
        pl.Property(x => x.ItemName).HasColumnName("itemName");
        pl.Property(x => x.PartName).HasColumnName("partName");
        pl.Property(x => x.SourcePartId).HasColumnName("sourcePartId");
        pl.Property(x => x.MachineNos).HasColumnName("machineNos");
        pl.Property(x => x.PlannedQty).HasColumnName("plannedQty");
        pl.Property(x => x.WorkerCount).HasColumnName("workerCount");
        pl.Property(x => x.GroupNo).HasColumnName("groupNo");
        pl.Property(x => x.StepNo).HasColumnName("stepNo");
        pl.Property(x => x.Craft).HasColumnName("craft");
        pl.Property(x => x.GoodQty).HasColumnName("goodQty");
        pl.Property(x => x.ReportedQty).HasColumnName("reportedQty");
        pl.Property(x => x.DefectQty).HasColumnName("defectQty");
        pl.Property(x => x.WorkHours).HasColumnName("workHours");
        pl.Property(x => x.ProductionValue).HasColumnName("productionValue");
        pl.Property(x => x.Status).HasColumnName("status");
        pl.Property(x => x.Remark).HasColumnName("remark");
        pl.Property(x => x.CreatedBy).HasColumnName("createdBy");
        pl.Property(x => x.CreatedAt).HasColumnName("createdAt").HasConversion(MsConverter);
        pl.Property(x => x.LastModifiedBy).HasColumnName("lastModifiedBy");
        pl.Property(x => x.LastModifiedAt).HasColumnName("lastModifiedAt").HasConversion(MsConverter);
        pl.Property(x => x.ModificationHistory).HasColumnName("modificationHistory");
        pl.Property(x => x.DeletedAt).HasColumnName("deletedAt").HasConversion(NullableMsConverter);
        pl.Property(x => x.DeletedBy).HasColumnName("deletedBy");
        pl.HasOne(x => x.Line).WithMany().HasForeignKey(x => x.LineId);
        pl.HasOne(x => x.Order).WithMany(x => x.Plans).HasForeignKey(x => x.OrderId);

        // ===== 节假日 holidays =====
        var h = b.Entity<Holiday>();
        h.ToTable("holidays");
        h.Property(x => x.Date).HasColumnName("date").HasConversion(MsConverter);
        h.Property(x => x.Type).HasColumnName("type");
        h.Property(x => x.Remark).HasColumnName("remark");

        // ===== 工序对照表 craft_aliases =====
        var ca = b.Entity<CraftAlias>();
        ca.ToTable("craft_aliases");
        ca.HasIndex(x => x.Alias).IsUnique();
        ca.Property(x => x.Alias).HasColumnName("alias");
        ca.Property(x => x.Category).HasColumnName("category");
        ca.Property(x => x.CreatedBy).HasColumnName("createdBy");
        ca.Property(x => x.CreatedAt).HasColumnName("createdAt").HasConversion(MsConverter);

        // ===== 机台种类 equipment_kinds =====
        var ek = b.Entity<EquipmentKind>();
        ek.ToTable("equipment_kinds");
        ek.HasIndex(x => x.Name).IsUnique();
        ek.Property(x => x.Name).HasColumnName("name");
        ek.Property(x => x.CreatedAt).HasColumnName("createdAt").HasConversion(MsConverter);

        // ===== 库存流水 inventory_moves =====
        var im = b.Entity<InventoryMove>();
        im.ToTable("inventory_moves");
        im.HasIndex(x => new { x.ProductId, x.ItemName, x.PartName });
        im.HasIndex(x => x.OwnerOrderId);
        im.HasIndex(x => x.RefOrderId);
        im.Property(x => x.ProductId).HasColumnName("productId");
        im.Property(x => x.ItemName).HasColumnName("itemName");
        im.Property(x => x.PartName).HasColumnName("partName");
        im.Property(x => x.OwnerOrderId).HasColumnName("ownerOrderId");
        im.Property(x => x.Delta).HasColumnName("delta");
        im.Property(x => x.Reason).HasColumnName("reason");
        im.Property(x => x.RefOrderId).HasColumnName("refOrderId");
        im.Property(x => x.CreatedBy).HasColumnName("createdBy");
        im.Property(x => x.CreatedAt).HasColumnName("createdAt").HasConversion(MsConverter);
        im.Property(x => x.Remark).HasColumnName("remark");
    }

    // ⚠️ 关键兼容：Prisma 在 SQLite 把 DateTime 存为 Unix 毫秒整数，EF 默认存 TEXT。
    // 用转换器对齐，保证 .NET 读写与 Prisma 互通（前后端共用同一个 dev.db 的前提）。
    static readonly ValueConverter<DateTime, long> MsConverter = new(
        v => new DateTimeOffset(v.ToUniversalTime()).ToUnixTimeMilliseconds(),
        v => DateTimeOffset.FromUnixTimeMilliseconds(v).UtcDateTime);

    static readonly ValueConverter<DateTime?, long?> NullableMsConverter = new(
        v => v.HasValue ? new DateTimeOffset(v.Value.ToUniversalTime()).ToUnixTimeMilliseconds() : (long?)null,
        v => v.HasValue ? DateTimeOffset.FromUnixTimeMilliseconds(v.Value).UtcDateTime : (DateTime?)null);
}
