using Microsoft.EntityFrameworkCore;
using VoyagePlex.Api.Entities;

namespace VoyagePlex.Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<ShipmentTask> ShipmentTasks => Set<ShipmentTask>();
    public DbSet<ImportBatch> ImportBatches => Set<ImportBatch>();
    public DbSet<ImportEmailItem> ImportEmailItems => Set<ImportEmailItem>();
    public DbSet<MailSyncState> MailSyncStates => Set<MailSyncState>();
    public DbSet<MailContact> MailContacts => Set<MailContact>();
    public DbSet<MailSystemSetting> MailSystemSettings => Set<MailSystemSetting>();
    public DbSet<InspectionMapping> InspectionMappings => Set<InspectionMapping>();
    public DbSet<ProductInfo> ProductInfos => Set<ProductInfo>();
    public DbSet<ProductNameMapping> ProductNameMappings => Set<ProductNameMapping>();
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<UserSession> UserSessions => Set<UserSession>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ShipmentTask>()
            .HasIndex(task => task.SoNumber);
        modelBuilder.Entity<ShipmentTask>()
            .HasIndex(task => new { task.SourceImportItemId, task.SourceGroupKey })
            .IsUnique();
        modelBuilder.Entity<ImportEmailItem>()
            .HasIndex(item => item.Fingerprint);
        modelBuilder.Entity<MailContact>()
            .HasIndex(contact => contact.Email)
            .IsUnique();
        modelBuilder.Entity<ImportEmailItem>()
            .HasOne(item => item.ImportBatch)
            .WithMany(batch => batch.EmailItems)
            .HasForeignKey(item => item.ImportBatchId)
            .OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<InspectionMapping>()
            .HasIndex(item => new { item.GroupName, item.ProductCode });
        modelBuilder.Entity<ProductNameMapping>()
            .HasIndex(item => new { item.ProductCodeKey, item.QuantityPerBox, item.EnglishNameKey })
            .IsUnique();
        modelBuilder.Entity<AppUser>()
            .HasIndex(user => user.Username)
            .IsUnique();
        modelBuilder.Entity<UserSession>()
            .HasIndex(session => session.TokenHash)
            .IsUnique();
        modelBuilder.Entity<UserSession>()
            .HasOne(session => session.User)
            .WithMany(user => user.Sessions)
            .HasForeignKey(session => session.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
