using Microsoft.EntityFrameworkCore;
using QcInspection.Api.Entities;

namespace QcInspection.Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<InspectionRecord> InspectionRecords => Set<InspectionRecord>();
    public DbSet<ZuruScheduleRecord> ZuruScheduleRecords => Set<ZuruScheduleRecord>();
    public DbSet<ScheduleImportBatch> ScheduleImportBatches => Set<ScheduleImportBatch>();
    public DbSet<InspectionResultApproval> InspectionResultApprovals => Set<InspectionResultApproval>();
    public DbSet<InspectionAlert> InspectionAlerts => Set<InspectionAlert>();
    public DbSet<WorkshopMapping> WorkshopMappings => Set<WorkshopMapping>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>().HasIndex(user => user.Username).IsUnique();
        modelBuilder.Entity<User>().Property(user => user.Username).HasMaxLength(80);
        modelBuilder.Entity<User>().Property(user => user.DisplayName).HasMaxLength(80);
        modelBuilder.Entity<InspectionRecord>().HasIndex(record => record.Fingerprint).IsUnique();
        modelBuilder.Entity<InspectionRecord>().HasIndex(record => record.PlanId).IsUnique();
        modelBuilder.Entity<ZuruScheduleRecord>().HasIndex(record => record.BusinessKey).IsUnique();
        modelBuilder.Entity<InspectionResultApproval>().HasIndex(record => new { record.InspectionRecordId, record.Status });
        modelBuilder.Entity<InspectionAlert>().HasIndex(record => new { record.Site, record.Status, record.Type });
        modelBuilder.Entity<WorkshopMapping>().HasIndex(record => record.Workshop).IsUnique();
    }
}
