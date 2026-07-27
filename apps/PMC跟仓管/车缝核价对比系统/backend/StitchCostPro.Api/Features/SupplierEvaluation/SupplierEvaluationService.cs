using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.SupplierEvaluation;

public record EvaluationRow(int SupplierId, string SupplierName,
    decimal? QualityScore, decimal? PriceScore, decimal? DeliveryScore, decimal? TotalScore,
    string Grade, string Advice, bool IsNewThisMonth,
    int OrderCount, int PricedLineCount, int InspectionCount, int DeliveredCount, int DataCoverage,
    int OverPriceCount);

public record SupplierProfileDto(
    int SupplierId, string SupplierCode, string SupplierName, string DeptName,
    string? Contact, string? Phone, string? Address, string? Location, string? MainProcess,
    string? MonthlyCapacity, int? EquipmentCount, int? MachinesForUs, int? EmployeeCount,
    string? Qualification, string? Scope, string? Remark);

public record PricePerformanceDto(
    int OrderCount, int PricedLineCount, decimal InternalAmount, decimal OutsourceAmount,
    decimal SavingAmount, decimal? SavingRate, int OverPriceLineCount);

public record DeliveryPerformanceDto(
    int PendingPricingCount, int OrderedCount, int ProducingCount, int DeliveredCount,
    int OnTimeCount, int DelayedCount, decimal? OnTimeRate, decimal? AverageDelayDays);

public record QualityPerformanceDto(
    int InspectionCount, decimal ReceivedQty, decimal QcQty, decimal StockInQty,
    decimal DefectQty, decimal? DefectRate, string? MainDefect);

public record EvaluationDetailDto(
    SupplierProfileDto Profile, EvaluationRow Evaluation,
    PricePerformanceDto Price, DeliveryPerformanceDto Delivery, QualityPerformanceDto Quality);

public record EvaluationSettings(
    decimal TargetSaving, decimal QualityWeight, decimal PriceWeight, decimal DeliveryWeight,
    decimal GradeA, decimal GradeB, decimal GradeC)
{
    public static EvaluationSettings Default => new(0.10m, 0.4m, 0.4m, 0.2m, 85m, 75m, 60m);
}

/// <summary>加工厂综合评价：按全部历史业务累计，质量40% + 价格40% + 交付20% → A/B/C/D。
/// 全部启用加工厂均显示；从未产生订单或质检数据的加工厂显示为“未评级”。</summary>
public class SupplierEvaluationService(AppDbContext db)
{
    private const decimal GradeAMinimumComponent = 70m;
    private const decimal GradeBMinimumComponent = 60m;

    private static decimal Interpolate(decimal value, decimal from, decimal to, decimal scoreFrom, decimal scoreTo) =>
        scoreFrom + (value - from) / (to - from) * (scoreTo - scoreFrom);

    /// <summary>价格分锚点：刚低于核价50分，达到满分目标的30%/50%/80%/100%时为70/80/90/100分。</summary>
    private static decimal PriceScore(decimal savingRate, decimal fullScoreSavingRate)
    {
        if (savingRate <= 0) return 0m;
        var p30 = fullScoreSavingRate * 0.30m;
        var p50 = fullScoreSavingRate * 0.50m;
        var p80 = fullScoreSavingRate * 0.80m;
        if (savingRate < p30) return Math.Round(Interpolate(savingRate, 0, p30, 50, 70), 1);
        if (savingRate < p50) return Math.Round(Interpolate(savingRate, p30, p50, 70, 80), 1);
        if (savingRate < p80) return Math.Round(Interpolate(savingRate, p50, p80, 80, 90), 1);
        if (savingRate < fullScoreSavingRate) return Math.Round(Interpolate(savingRate, p80, fullScoreSavingRate, 90, 100), 1);
        return 100m;
    }

    /// <summary>交付分：延期1-2天不扣分；3-5/6-7/8-10/11-15/>15天分别为85/70/50/30/10分。</summary>
    private static decimal DeliveryScore(int delayDays) =>
        delayDays <= 2 ? 100m
        : delayDays <= 5 ? 85m
        : delayDays <= 7 ? 70m
        : delayDays <= 10 ? 50m
        : delayDays <= 15 ? 30m
        : 10m;

    private static (string grade, string advice) GradeOf(
        decimal total, decimal quality, decimal price, decimal delivery, int overPriceCount, EvaluationSettings settings)
    {
        if (total < settings.GradeC) return ("D 预警", "暂停/淘汰评审");
        if (overPriceCount > 0) return ("C 观察", $"存在{overPriceCount}款价格异常");
        if (total >= settings.GradeA && quality >= GradeAMinimumComponent
            && price >= GradeAMinimumComponent && delivery >= GradeAMinimumComponent)
            return ("A 优先", "优先分单");
        if (total >= settings.GradeB && quality >= GradeBMinimumComponent
            && price >= GradeBMinimumComponent && delivery >= GradeBMinimumComponent)
            return ("B 正常", "正常分单");
        return ("C 观察", "存在短板，谨慎分单");
    }

    public async Task<EvaluationSettings> GetSettingsAsync(int deptId)
    {
        var values = await db.RateConfigs.AsNoTracking()
            .Where(x => x.DeptId == deptId && x.IsCurrent && x.RateType.StartsWith("evaluation_"))
            .ToDictionaryAsync(x => x.RateType, x => x.RateValue);
        var d = EvaluationSettings.Default;
        decimal V(string key, decimal fallback) => values.GetValueOrDefault(key, fallback);
        return new EvaluationSettings(
            V("evaluation_target_saving", d.TargetSaving),
            V("evaluation_weight_quality", d.QualityWeight),
            V("evaluation_weight_price", d.PriceWeight),
            V("evaluation_weight_delivery", d.DeliveryWeight),
            V("evaluation_grade_a", d.GradeA), V("evaluation_grade_b", d.GradeB), V("evaluation_grade_c", d.GradeC));
    }

    public async Task<string?> SaveSettingsAsync(int deptId, EvaluationSettings settings, int? userId)
    {
        if (settings.TargetSaving <= 0) return "目标节约率必须大于 0";
        if (Math.Abs(settings.QualityWeight + settings.PriceWeight + settings.DeliveryWeight - 1m) > 0.0001m)
            return "质量、价格、交付权重之和必须等于 100%";
        if (!(settings.GradeA > settings.GradeB && settings.GradeB > settings.GradeC && settings.GradeC >= 0))
            return "评级阈值必须满足 A > B > C ≥ 0";

        var entries = new Dictionary<string, decimal>
        {
            ["evaluation_target_saving"] = settings.TargetSaving,
            ["evaluation_weight_quality"] = settings.QualityWeight,
            ["evaluation_weight_price"] = settings.PriceWeight,
            ["evaluation_weight_delivery"] = settings.DeliveryWeight,
            ["evaluation_grade_a"] = settings.GradeA,
            ["evaluation_grade_b"] = settings.GradeB,
            ["evaluation_grade_c"] = settings.GradeC,
        };
        var types = entries.Keys.ToList();
        var old = await db.RateConfigs.Where(x => x.DeptId == deptId && x.IsCurrent && types.Contains(x.RateType)).ToListAsync();
        foreach (var row in old) row.IsCurrent = false;
        foreach (var (type, value) in entries)
            db.RateConfigs.Add(new RateConfig
            {
                RateType = type, RateValue = value, EffectiveDate = DateOnly.FromDateTime(DateTime.Today),
                IsCurrent = true, DeptId = deptId, Remark = "综合评价参数", CreatedBy = userId, CreatedAt = DateTime.UtcNow,
            });
        await db.SaveChangesAsync();
        return null;
    }

    public async Task<List<EvaluationRow>> EvaluateAsync()
    {
        var qis = await db.QualityInspections.AsNoTracking().ToListAsync();
        var orders = await db.PurchaseOrders.AsNoTracking().ToListAsync();
        var orderIds = orders.Select(o => o.OrderId).ToList();
        var lines = await db.PurchaseOrderLines.AsNoTracking().Where(l => orderIds.Contains(l.OrderId)).ToListAsync();
        var qiIds = qis.Select(x => x.InspectionId).ToList();
        var defects = await db.QualityDefects.AsNoTracking().Where(d => qiIds.Contains(d.InspectionId)).ToListAsync();

        var sups = await db.Suppliers.AsNoTracking().Where(s => s.IsActive)
            .OrderBy(s => s.SupplierName).ToListAsync();
        var settingsByDept = new Dictionary<int, EvaluationSettings>();
        var monthStartUtc = DateTime.SpecifyKind(new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1), DateTimeKind.Local)
            .ToUniversalTime();

        var rows = new List<EvaluationRow>();
        foreach (var supplier in sups)
        {
            var sid = supplier.SupplierId;
            if (!settingsByDept.TryGetValue(supplier.DeptId, out var settings))
            {
                settings = await GetSettingsAsync(supplier.DeptId);
                settingsByDept[supplier.DeptId] = settings;
            }
            var supplierOrders = orders.Where(o => o.SupplierId == sid).ToList();
            var supplierInspections = qis.Where(x => x.SupplierId == sid && x.QcQty > 0).ToList();
            var hasData = supplierOrders.Count > 0 || supplierInspections.Count > 0;
            var isNewThisMonth = supplier.CreatedAt >= monthStartUtc;
            if (!hasData)
            {
                rows.Add(new EvaluationRow(sid, supplier.SupplierName, null, null, null, null,
                    "未评级", "暂无业务数据", isNewThisMonth, 0, 0, 0, 0, 0, 0));
                continue;
            }

            var myOrderIds = supplierOrders.Select(o => o.OrderId).ToHashSet();
            var myLines = lines.Where(l => myOrderIds.Contains(l.OrderId)
                && l.Qty > 0 && l.InternalPriceExcl > 0 && l.OutsourcePriceExcl != null).ToList();
            var delivered = supplierOrders.Where(o => o.Status == "已交货").ToList();
            var overPriceCount = myLines.Count(l => l.OutsourcePriceExcl >= l.InternalPriceExcl);

            // 单次QC分=100-各非零不良类型平均占比(%)；工厂质量分再按当次质检数量加权。
            decimal? quality = null;
            if (supplierInspections.Count > 0)
            {
                var weightedScores = supplierInspections.Select(x =>
                {
                    var qcQty = x.QcQty!.Value;
                    var defectRates = defects.Where(d => d.InspectionId == x.InspectionId && d.Qty > 0)
                        .Select(d => d.Qty!.Value / qcQty).ToList();
                    var averageDefectRate = defectRates.Count == 0 ? 0m : defectRates.Average();
                    var rowScore = Math.Max(0m, 100m - averageDefectRate * 100m);
                    return (Score: rowScore, Qty: qcQty);
                }).ToList();
                quality = Math.Round(weightedScores.Sum(x => x.Score * x.Qty) / weightedScores.Sum(x => x.Qty), 1);
            }

            decimal? price = null;
            if (myLines.Count > 0)
            {
                var intlTotal = myLines.Sum(l => l.InternalPriceExcl!.Value * (l.Qty ?? 0));
                var saving = myLines.Sum(l => (l.InternalPriceExcl!.Value - l.OutsourcePriceExcl!.Value) * (l.Qty ?? 0));
                price = PriceScore(saving / intlTotal, settings.TargetSaving);
            }

            decimal? delivery = delivered.Count == 0 ? null
                : Math.Round(delivered.Average(o => DeliveryScore(o.DelayDays)), 1);

            var components = new (decimal? score, decimal weight)[] {
                (quality, settings.QualityWeight), (price, settings.PriceWeight), (delivery, settings.DeliveryWeight)
            };
            var available = components.Where(x => x.score is not null).ToList();
            var availableWeight = available.Sum(x => x.weight);
            decimal? total = availableWeight == 0 ? null
                : Math.Round(available.Sum(x => x.score!.Value * x.weight) / availableWeight, 1);
            var coverage = available.Count;
            var (grade, advice) = total is null ? ("未评级", "暂无可评分数据")
                : coverage < 3 ? ("观察中", $"仅有{coverage}/3项数据")
                : GradeOf(total.Value, quality!.Value, price!.Value, delivery!.Value, overPriceCount, settings);
            rows.Add(new EvaluationRow(sid, supplier.SupplierName, quality, price, delivery, total, grade, advice,
                isNewThisMonth, supplierOrders.Count, myLines.Count, supplierInspections.Count, delivered.Count,
                coverage, overPriceCount));
        }
        return rows.OrderBy(r => r.TotalScore is null).ThenByDescending(r => r.TotalScore).ThenBy(r => r.SupplierName).ToList();
    }

    public async Task<EvaluationDetailDto?> GetDetailAsync(int supplierId)
    {
        var supplier = await db.Suppliers.AsNoTracking().FirstOrDefaultAsync(s => s.SupplierId == supplierId);
        if (supplier is null) return null;

        var evaluation = (await EvaluateAsync()).FirstOrDefault(x => x.SupplierId == supplierId)
            ?? new EvaluationRow(supplierId, supplier.SupplierName, null, null, null, null,
                "未评级", "暂无业务数据", false, 0, 0, 0, 0, 0, 0);
        var deptName = await db.Depts.AsNoTracking().Where(d => d.DeptId == supplier.DeptId)
            .Select(d => d.DeptName).FirstOrDefaultAsync() ?? "";

        var orders = await db.PurchaseOrders.AsNoTracking().Where(o => o.SupplierId == supplierId).ToListAsync();
        var orderIds = orders.Select(o => o.OrderId).ToList();
        var lines = await db.PurchaseOrderLines.AsNoTracking().Where(l => orderIds.Contains(l.OrderId)).ToListAsync();
        var priced = lines.Where(l => l.InternalPriceExcl is > 0 && l.OutsourcePriceExcl is not null).ToList();
        var internalAmount = priced.Sum(l => l.InternalPriceExcl!.Value * (l.Qty ?? 0));
        var outsourceAmount = priced.Sum(l => l.OutsourcePriceExcl!.Value * (l.Qty ?? 0));
        var savingAmount = internalAmount - outsourceAmount;
        decimal? savingRate = internalAmount > 0 ? Math.Round(savingAmount / internalAmount, 4) : null;
        var price = new PricePerformanceDto(
            orders.Count, priced.Count, internalAmount, outsourceAmount, savingAmount, savingRate,
            priced.Count(l => l.OutsourcePriceExcl >= l.InternalPriceExcl));

        var delivered = orders.Where(o => o.Status == "已交货").ToList();
        var delayed = delivered.Where(o => o.DelayDays > 0).ToList();
        var delivery = new DeliveryPerformanceDto(
            orders.Count(o => o.Status == "待核价"),
            orders.Count(o => o.Status == "已下单"),
            orders.Count(o => o.Status == "生产中"),
            delivered.Count,
            delivered.Count(o => o.DelayDays <= 0),
            delayed.Count,
            delivered.Count > 0 ? Math.Round((decimal)delivered.Count(o => o.DelayDays <= 0) / delivered.Count, 4) : null,
            delayed.Count > 0 ? Math.Round((decimal)delayed.Average(o => o.DelayDays), 1) : null);

        var inspections = await db.QualityInspections.AsNoTracking()
            .Where(x => x.SupplierId == supplierId).ToListAsync();
        var inspectionIds = inspections.Select(x => x.InspectionId).ToList();
        var defects = await db.QualityDefects.AsNoTracking()
            .Where(d => inspectionIds.Contains(d.InspectionId)).ToListAsync();
        var qcQty = inspections.Sum(x => x.QcQty ?? 0);
        var defectQty = defects.Sum(d => d.Qty ?? 0);
        var quality = new QualityPerformanceDto(
            inspections.Count,
            inspections.Sum(x => x.ReceivedQty ?? 0),
            qcQty,
            inspections.Sum(x => x.StockInQty ?? 0),
            defectQty,
            qcQty > 0 ? Math.Round(defectQty / qcQty, 4) : null,
            defects.Where(d => (d.Qty ?? 0) > 0).GroupBy(d => d.DefectType)
                .OrderByDescending(g => g.Sum(d => d.Qty ?? 0)).Select(g => g.Key).FirstOrDefault());

        var profile = new SupplierProfileDto(
            supplier.SupplierId, supplier.SupplierCode, supplier.SupplierName, deptName,
            supplier.Contact, supplier.Phone, supplier.Address, supplier.Location, supplier.MainProcess,
            supplier.MonthlyCapacity, supplier.EquipmentCount, supplier.MachinesForUs, supplier.EmployeeCount,
            supplier.Qualification, supplier.Scope, supplier.Remark);
        return new EvaluationDetailDto(profile, evaluation, price, delivery, quality);
    }
}
