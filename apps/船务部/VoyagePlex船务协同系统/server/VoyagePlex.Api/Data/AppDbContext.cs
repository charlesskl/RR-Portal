using Microsoft.EntityFrameworkCore;
using VoyagePlex.Api.Entities;
using VoyagePlex.Api.Services;
using System.Text.Json.Nodes;

namespace VoyagePlex.Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public string Company { get; set; } = "Xingxin";
    public long? CurrentUserId { get; set; }
    public Dictionary<long,long> ConfirmedTaskOwners { get; } = [];
    public long? MailOwnerId { get; set; }
    public int CompanySettingId => Company == "Huadeng" ? (MailOwnerId > 0 ? checked(1000 + (int)MailOwnerId.Value) : 2) : 1;

    public DbSet<InventoryWriteback> InventoryWritebacks => Set<InventoryWriteback>();
    public DbSet<InventoryFileClaim> InventoryFileClaims => Set<InventoryFileClaim>();
    public DbSet<TaskEditAudit> TaskEditAudits => Set<TaskEditAudit>();
    public DbSet<FactoryMapping> FactoryMappings => Set<FactoryMapping>();
    public DbSet<ExportTemplate> ExportTemplates => Set<ExportTemplate>();
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

    private void AssignCompany()
    {
        foreach (var entry in ChangeTracker.Entries<ICompanyEntity>())
            if (entry.State == EntityState.Added)
            {
                entry.Entity.Company = Company;
                if (entry.Entity is ImportBatch batch) batch.MailOwnerId = MailOwnerId ?? 0;
                if (entry.Entity is ImportEmailItem item) item.MailOwnerId = MailOwnerId ?? 0;
                if (entry.Entity is MailContact contact) contact.MailOwnerId = MailOwnerId ?? 0;
            }
        foreach (var entry in ChangeTracker.Entries<MailSyncState>())
            if (entry.State == EntityState.Added) entry.Entity.Id = CompanySettingId;
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        AssignCompany();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        AssignCompany();
        return SaveWithTaskOwnership(acceptAllChangesOnSuccess, cancellationToken);
    }

    private async Task<int> SaveWithTaskOwnership(bool accept, CancellationToken ct)
    {
        var changed = ChangeTracker.Entries<ShipmentTask>().Where(entry => entry.State == EntityState.Modified).Select(entry => entry.Entity).ToArray();
        if (CurrentUserId > 0 && changed.Length > 0)
        {
            var actor = await Users.AsNoTracking().SingleAsync(value => value.Id == CurrentUserId, ct);
            foreach (var task in changed)
            {
                if (!InventoryWritebacks.Local.Any(row => row.TaskId == task.Id && row.State == "Completed") &&
                    await InventoryWritebacks.AnyAsync(row => row.TaskId == task.Id && row.State != "Completed", ct))
                    throw new InvalidOperationException("任务有未解决的库存回写记录，请先处理回写恢复");
                var confirmation = new JsonObject();
                if (ConfirmedTaskOwners.TryGetValue(task.Id, out var owner)) confirmation["confirmedOwnerId"] = owner;
                if (TaskSafetyRules.OwnerWarning(task, actor, confirmation) is object warning) throw new TaskOwnerConfirmationException(warning);
                if (!TaskEditAudits.Local.Any(value => value.TaskId == task.Id && value.ActorId == actor.Id))
                    InventoryWritebackEndpoints.RecordEdit(this, task, actor, "TaskSaved");
            }
        }
        return await base.SaveChangesAsync(accept, ct);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<InventoryWriteback>().HasQueryFilter(value => value.Company == Company);
        modelBuilder.Entity<InventoryWriteback>().HasIndex(value => new { value.Company, value.TaskId }).IsUnique();
        modelBuilder.Entity<InventoryFileClaim>().HasKey(value => value.Filename);
        modelBuilder.Entity<TaskEditAudit>().HasQueryFilter(value => value.Company == Company);
        modelBuilder.Entity<ExportTemplate>().HasQueryFilter(value => value.Company == Company);
        modelBuilder.Entity<ShipmentTask>().HasQueryFilter(value => value.Company == Company);
        modelBuilder.Entity<ImportBatch>().HasQueryFilter(value => value.Company == Company && (Company != "Huadeng" || MailOwnerId == null || value.MailOwnerId == MailOwnerId));
        modelBuilder.Entity<ImportEmailItem>().HasQueryFilter(value => value.Company == Company && (Company != "Huadeng" || MailOwnerId == null || value.MailOwnerId == MailOwnerId));
        modelBuilder.Entity<MailContact>().HasQueryFilter(value => value.Company == Company && (Company != "Huadeng" || MailOwnerId == null || value.MailOwnerId == MailOwnerId));
        modelBuilder.Entity<MailSyncState>().HasQueryFilter(value => value.Id == CompanySettingId);
        modelBuilder.Entity<MailSystemSetting>().HasQueryFilter(value => value.Id == CompanySettingId);
        modelBuilder.Entity<ShipmentTask>()
            .HasIndex(task => task.SoNumber);
        modelBuilder.Entity<ShipmentTask>()
            .HasIndex(task => new { task.SourceImportItemId, task.SourceGroupKey })
            .IsUnique();
        modelBuilder.Entity<ImportEmailItem>()
            .HasIndex(item => item.Fingerprint);
        modelBuilder.Entity<MailContact>()
            .HasIndex(contact => new { contact.Company, contact.MailOwnerId, contact.Email })
            .IsUnique();
        modelBuilder.Entity<ImportEmailItem>()
            .HasOne(item => item.ImportBatch)
            .WithMany(batch => batch.EmailItems)
            .HasForeignKey(item => item.ImportBatchId)
            .OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<FactoryMapping>().HasIndex(value => value.EnglishName).IsUnique();
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
