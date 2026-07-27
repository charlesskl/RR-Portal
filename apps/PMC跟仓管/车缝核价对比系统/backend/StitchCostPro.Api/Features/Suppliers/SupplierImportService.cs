using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.Suppliers;

public record SupplierImportRowInput(int RowNo, string? SupplierName, string? Contact, string? Phone,
    string? Address, int? EquipmentCount, int? MachinesForUs, int? EmployeeCount,
    string? MonthlyCapacity, string? MainProcess, string? Qualification, string? Scope);
public record SupplierImportPreviewReq(int DeptId, List<SupplierImportRowInput> Rows);
public record SupplierImportPreviewRow(int RowNo, string SupplierName, string? Contact, string? Phone,
    string? Address, int? EquipmentCount, int? MachinesForUs, int? EmployeeCount,
    string? MonthlyCapacity, string? MainProcess, string? Qualification, string? Scope,
    string Status, string? Reason, int? ExistingSupplierId);
public record SupplierImportPreviewResult(List<SupplierImportPreviewRow> Rows,
    int CreateCount, int ConflictCount, int DuplicateCount, int ErrorCount);
public record SupplierImportCommitRow(int RowNo, string? SupplierName, string? Contact, string? Phone,
    string? Address, int? EquipmentCount, int? MachinesForUs, int? EmployeeCount,
    string? MonthlyCapacity, string? MainProcess, string? Qualification, string? Scope, bool Overwrite);
public record SupplierImportCommitReq(int DeptId, List<SupplierImportCommitRow> Rows);
public record SupplierImportCommitResult(int Created, int Overwritten, int KeptOld, int Skipped);

public class SupplierImportService(AppDbContext db, ICurrentUser current)
{
    private static string Clean(string? value) => (value ?? "").Trim();
    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static string Key(string? value) => Clean(value).ToUpperInvariant();

    public async Task<SupplierImportPreviewResult> PreviewAsync(int deptId, List<SupplierImportRowInput>? rows)
    {
        deptId = deptId > 0 ? deptId : current.DeptId ?? 0;
        var existing = await db.Suppliers.AsNoTracking().Where(x => x.DeptId == deptId)
            .ToDictionaryAsync(x => Key(x.SupplierName), x => x.SupplierId);
        var source = rows ?? [];
        var lastRows = source.Where(x => Clean(x.SupplierName).Length > 0)
            .GroupBy(x => Key(x.SupplierName)).ToDictionary(g => g.Key, g => g.Max(x => x.RowNo));
        var duplicateKeys = source.Where(x => Clean(x.SupplierName).Length > 0)
            .GroupBy(x => Key(x.SupplierName)).Where(g => g.Count() > 1).Select(g => g.Key).ToHashSet();
        var output = new List<SupplierImportPreviewRow>();
        int create = 0, conflict = 0, duplicate = 0, error = 0;

        foreach (var row in source)
        {
            var name = Clean(row.SupplierName);
            string? reason = null;
            if (name.Length == 0) reason = "缺少加工厂名称";
            else if (row.EquipmentCount < 0 || row.MachinesForUs < 0 || row.EmployeeCount < 0)
                reason = "设备台数、生产机台和员工人数不能小于 0";

            string status;
            int? existingId = null;
            if (reason is not null) { status = "error"; error++; }
            else if (duplicateKeys.Contains(Key(name)) && lastRows[Key(name)] != row.RowNo)
            {
                status = "duplicate"; reason = "文件内加工厂名称重复，请保留其中一行"; duplicate++;
            }
            else if (existing.TryGetValue(Key(name), out var id))
            {
                status = "conflict"; reason = "系统已有同名加工厂，请选择跳过或覆盖"; existingId = id; conflict++;
            }
            else { status = "ok"; create++; }

            output.Add(new SupplierImportPreviewRow(row.RowNo, name, NullIfEmpty(row.Contact),
                NullIfEmpty(row.Phone), NullIfEmpty(row.Address), row.EquipmentCount, row.MachinesForUs,
                row.EmployeeCount, NullIfEmpty(row.MonthlyCapacity), NullIfEmpty(row.MainProcess),
                NullIfEmpty(row.Qualification), NullIfEmpty(row.Scope), status, reason, existingId));
        }
        return new SupplierImportPreviewResult(output, create, conflict, duplicate, error);
    }

    public async Task<SupplierImportCommitResult> CommitAsync(SupplierImportCommitReq req)
    {
        var deptId = req.DeptId > 0 ? req.DeptId : current.DeptId ?? 0;
        var existing = await db.Suppliers.Where(x => x.DeptId == deptId).ToListAsync();
        var map = existing.GroupBy(x => Key(x.SupplierName)).ToDictionary(g => g.Key, g => g.First());
        var valid = (req.Rows ?? []).Where(IsValid)
            .GroupBy(x => Key(x.SupplierName!)).Select(g => g.OrderByDescending(x => x.RowNo).First()).ToList();
        int created = 0, overwritten = 0, kept = 0;

        foreach (var row in valid)
        {
            var name = Clean(row.SupplierName);
            if (map.TryGetValue(Key(name), out var supplier))
            {
                if (!row.Overwrite) { kept++; continue; }
                overwritten++;
                supplier.UpdatedBy = current.UserId;
                supplier.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                supplier = new Supplier
                {
                    SupplierCode = name, SupplierName = name, DeptId = deptId, IsActive = true,
                    CreatedBy = current.UserId, CreatedAt = DateTime.UtcNow,
                };
                db.Suppliers.Add(supplier);
                map[Key(name)] = supplier;
                created++;
            }
            supplier.SupplierName = name;
            supplier.SupplierCode = name;
            supplier.Contact = NullIfEmpty(row.Contact);
            supplier.Phone = NullIfEmpty(row.Phone);
            supplier.Address = NullIfEmpty(row.Address);
            supplier.EquipmentCount = row.EquipmentCount;
            supplier.MachinesForUs = row.MachinesForUs;
            supplier.EmployeeCount = row.EmployeeCount;
            supplier.MonthlyCapacity = NullIfEmpty(row.MonthlyCapacity);
            supplier.MainProcess = NullIfEmpty(row.MainProcess);
            supplier.Qualification = NullIfEmpty(row.Qualification);
            supplier.Scope = NullIfEmpty(row.Scope);
        }
        await db.SaveChangesAsync();
        return new SupplierImportCommitResult(created, overwritten, kept, (req.Rows?.Count ?? 0) - valid.Count);
    }

    private static bool IsValid(SupplierImportCommitRow row) =>
        Clean(row.SupplierName).Length > 0 && row.EquipmentCount is null or >= 0 &&
        row.MachinesForUs is null or >= 0 && row.EmployeeCount is null or >= 0;
}
