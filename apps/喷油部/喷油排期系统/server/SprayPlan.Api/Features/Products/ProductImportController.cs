using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Features.Basic;
using SprayPlan.Api.Services;
using SprayPlan.Api.Services.Import;

namespace SprayPlan.Api.Features.Products;

// 核价表 Excel 导入：预览（解析不入库）+ 提交（建产品 draft + 回填工序对照表）。
// 写权限：文员/主管（与产品其它写操作一致）。
[ApiController]
[Route("api/products/import")]
[Authorize(Roles = "clerk,admin")]
public class ProductImportController(AppDbContext db) : ControllerBase
{
    static readonly string[] ImportFields = { "dailyCapacity", "stdMachineCount", "laborPrice", "unitCost", "paintCost", "quotedPrice", "remark", "craft", "craftDetail" };
    string CurrentUser() => User.FindFirst("username")?.Value ?? "unknown";

    static bool Same(double a, double b) => Math.Abs(a - b) < 0.000001;
    static string Key(string part, string detail) => $"{part.Trim()}\u001f{detail.Trim()}";

    static List<string> Changes(ParsedPart uploaded, ProductPart current)
    {
        var fields = new List<string>();
        if (uploaded.DailyCapacity != current.DailyCapacity) fields.Add("dailyCapacity");
        if (uploaded.StdMachineCount != current.StdMachineCount) fields.Add("stdMachineCount");
        if (!Same(uploaded.LaborPrice, current.LaborPrice)) fields.Add("laborPrice");
        if (!Same(uploaded.UnitCost, current.UnitCost)) fields.Add("unitCost");
        if (!Same(uploaded.PaintCost, current.PaintCost)) fields.Add("paintCost");
        if (!Same(uploaded.QuotedPrice, current.QuotedPrice)) fields.Add("quotedPrice");
        if (!string.Equals(uploaded.Remark ?? "", current.Remark ?? "", StringComparison.Ordinal)) fields.Add("remark");
        if (!string.Equals(uploaded.Category ?? "", current.Craft, StringComparison.Ordinal)) fields.Add("craft");
        if (!string.Equals(uploaded.CraftDetail, current.CraftDetail, StringComparison.Ordinal)) fields.Add("craftDetail");
        return fields;
    }

    // POST /api/products/import/preview —— 上传 xlsx，返回预览（不入库）
    [HttpPost("preview")]
    [RequestSizeLimit(20_000_000)]
    [RequestFormLimits(MultipartBodyLengthLimit = 20_000_000)]
    public async Task<IActionResult> Preview(IFormFile? file)
    {
        if (file is null || file.Length == 0) return BadRequest(new { error = "请上传 Excel 文件" });

        Dictionary<string, string?[][]> grids;
        try
        {
            using var stream = file.OpenReadStream();
            grids = XlsxReader.ToGrids(stream);
        }
        catch { return BadRequest(new { error = "文件无法解析，请确认是 .xlsx 格式" }); }

        // 工序对照表（小类→大类），覆盖启发式
        var aliasMap = await db.CraftAliases.ToDictionaryAsync(a => a.Alias, a => a.Category);

        var products = new List<PreviewProduct>();
        var unrecognized = new List<UnrecognizedSheet>();
        int normal = 0, pending = 0, dup = 0;

        foreach (var (sheetName, grid) in grids)
        {
            var parsed = PricingSheetParser.Parse(grid, sheetName);
            if (!parsed.Recognized)
            {
                unrecognized.Add(new UnrecognizedSheet(sheetName, parsed.UnrecognizedReason ?? "未识别"));
                continue;
            }

            // 重复货号不再直接跳过：读取现有明细，逐字段生成修改版预览。
            var existing = await db.Products.AsNoTracking()
                .Include(p => p.Parts)
                .AsSplitQuery()
                .FirstOrDefaultAsync(p => p.ProductNo == parsed.ProductNo);
            bool duplicate = existing is not null;
            if (duplicate) dup++; else normal++;

            var exact = existing?.Parts
                .GroupBy(part => Key(part.PartName, part.CraftDetail))
                .ToDictionary(g => g.Key, g => g.First());
            var parts = parsed.Parts.Select(p =>
            {
                // 优先查对照表，其次启发式
                string? cat = aliasMap.TryGetValue(p.CraftDetail, out var c) ? c : p.Category;
                if (cat is null) pending++;
                ProductPart? matched = null;
                if (exact is not null && exact.TryGetValue(Key(p.PartName, p.CraftDetail), out var hit)) matched = hit;
                // 子件名可能在系统中被人工整理过；精确匹配失败时，仅在“部位+工序细类”唯一时兜底。
                if (matched is null && existing is not null)
                {
                    var candidates = existing.Parts
                        .Where(pt => pt.PartName.Trim() == p.PartName.Trim() && pt.CraftDetail.Trim() == p.CraftDetail.Trim()).ToList();
                    if (candidates.Count == 1) matched = candidates[0];
                }
                var changed = matched is null ? new List<string>() : Changes(p with { Category = cat }, matched);
                var current = matched is null ? null : new CurrentPartValues("", matched.PartName,
                    matched.CraftDetail, matched.Craft, matched.DailyCapacity, matched.StdMachineCount,
                    matched.LaborPrice, matched.UnitCost, matched.PaintCost, matched.QuotedPrice, matched.Remark);
                return new PreviewPart(p.ItemName, p.PartName, p.CraftDetail, cat,
                    p.DailyCapacity, p.StdMachineCount, p.LaborPrice, p.UnitCost, p.PaintCost, p.QuotedPrice, p.Remark,
                    matched?.Id, matched is null ? "new" : changed.Count > 0 ? "changed" : "unchanged", changed, current);
            }).ToList();

            products.Add(new PreviewProduct(sheetName, parsed.ProductNo, parsed.SuggestedItemName, parsed.IsThreeLevel,
                duplicate, existing?.Id, parts.Any(p => p.ChangeType != "unchanged"), parts));
        }

        return Ok(new ImportPreviewResponse(products, unrecognized, normal, pending, dup));
    }

    // POST /api/products/import/commit —— 按用户处理结果建产品（draft）+ 回填工序对照表
    [HttpPost("commit")]
    public async Task<IActionResult> Commit([FromBody] ImportCommitRequest req)
    {
        var now = DateTime.UtcNow;
        var me = CurrentUser();
        int created = 0, updated = 0, addedParts = 0, updatedFields = 0; var skipped = new List<string>();
        var existingAliases = await db.CraftAliases.ToDictionaryAsync(a => a.Alias, a => a);
        // 批内已用货号：防止同一请求内重复货号绕过 DB 查重撞唯一索引
        var batchKeys = new HashSet<string>();

        foreach (var cp in req.Products ?? new())
        {
            if (cp.Parts is null || cp.Parts.Count == 0) continue;

            var existing = await db.Products.Include(p => p.Parts)
                .FirstOrDefaultAsync(p => p.ProductNo == cp.ProductNo);
            if (existing is not null)
            {
                // 兼容旧版客户端：没有携带预览返回的产品 ID 时仍按原规则跳过，不允许盲目覆盖。
                if (cp.ExistingProductId is null) { skipped.Add(cp.ProductNo); continue; }
                if (cp.ExistingProductId != existing.Id) return Conflict(new { error = $"货号 {cp.ProductNo} 已变化，请重新预览" });
                // 同一批次可能为同一货号连续加入多条明细；SaveChanges 前这些新实体的临时 Id 都是 0。
                // 只有数据库中已有的正式 Id 才参与“可更新明细”索引，新明细继续走下方新增分支。
                var allowedIds = existing.Parts
                    .Where(p => p.Id > 0)
                    .ToDictionary(p => p.Id);
                bool productChanged = false;
                foreach (var pt in cp.Parts)
                {
                    if (pt.ExistingPartId is int partId)
                    {
                        if (!allowedIds.TryGetValue(partId, out var target)) return BadRequest(new { error = $"货号 {cp.ProductNo} 的明细已变化，请重新预览" });
                        var fields = (pt.UpdateFields ?? new()).Where(ImportFields.Contains).Distinct().ToList();
                        if (fields.Contains("craft") && !CraftTypes.IsValid(pt.Craft))
                            return BadRequest(new { error = $"货号 {cp.ProductNo} 的工序大类无效" });
                        foreach (var field in fields)
                        {
                            switch (field)
                            {
                                case "dailyCapacity": target.DailyCapacity = pt.DailyCapacity; break;
                                case "stdMachineCount": target.StdMachineCount = pt.StdMachineCount; break;
                                case "laborPrice": target.LaborPrice = pt.LaborPrice; break;
                                case "unitCost": target.UnitCost = pt.UnitCost; break;
                                case "paintCost": target.PaintCost = pt.PaintCost; break;
                                case "quotedPrice": target.QuotedPrice = pt.QuotedPrice; break;
                                case "remark": target.Remark = pt.Remark; break;
                                case "craft": target.Craft = pt.Craft; break;
                                case "craftDetail": target.CraftDetail = pt.CraftDetail; break;
                            }
                            updatedFields++;
                            productChanged = true;
                        }
                    }
                    else
                    {
                        if (!CraftTypes.IsValid(pt.Craft)) return BadRequest(new { error = $"货号 {cp.ProductNo} 的新增明细工序大类无效" });
                        existing.Parts.Add(new ProductPart { ProductId = existing.Id, PartName = pt.PartName, PartOrder = existing.Parts.Count,
                            Craft = pt.Craft, CraftDetail = pt.CraftDetail, DailyCapacity = pt.DailyCapacity,
                            StdMachineCount = pt.StdMachineCount, LaborPrice = pt.LaborPrice, UnitCost = pt.UnitCost,
                            PaintCost = pt.PaintCost, QuotedPrice = pt.QuotedPrice, Remark = pt.Remark });
                        addedParts++;
                        productChanged = true;
                    }
                }
                if (productChanged)
                {
                    existing.LastUpdatedBy = me;
                    existing.UpdatedAt = now;
                    updated++;
                }
                else skipped.Add(cp.ProductNo);
                continue;
            }
            // 批内去重：DB 查重查不到本批未提交的实体，用 HashSet 兜底
            if (!batchKeys.Add(cp.ProductNo)) { skipped.Add(cp.ProductNo); continue; }

            var product = new Product
            {
                ProductNo = cp.ProductNo,
                IterationNo = "V1", Status = "draft",
                CreatedBy = me, CreatedAt = now, UpdatedAt = now,
                Parts = cp.Parts.Select((pt, pi) => new ProductPart
                    {
                        PartName = pt.PartName, PartOrder = pi,
                        Craft = pt.Craft, CraftDetail = pt.CraftDetail,
                        UnitCost = pt.UnitCost, LaborPrice = pt.LaborPrice, PaintCost = pt.PaintCost, QuotedPrice = pt.QuotedPrice,
                        DailyCapacity = pt.DailyCapacity, StdMachineCount = pt.StdMachineCount, Remark = pt.Remark,
                    }).ToList()
            };
            db.Products.Add(product);
            created++;

            // 回填工序对照表：细类非空 + 大类合法，且尚无记录时新增
            foreach (var pt in cp.Parts)
            {
                if (string.IsNullOrWhiteSpace(pt.CraftDetail)) continue;
                if (!CraftTypes.IsValid(pt.Craft)) continue;
                if (existingAliases.ContainsKey(pt.CraftDetail)) continue;
                var alias = new CraftAlias { Alias = pt.CraftDetail, Category = pt.Craft, CreatedBy = me, CreatedAt = now };
                db.CraftAliases.Add(alias);
                existingAliases[pt.CraftDetail] = alias;
            }
        }

        await db.SaveChangesAsync();
        var importedParts = db.ChangeTracker.Entries<ProductPart>().Select(e => e.Entity).ToList();
        PartProcessRules.AssignGroupIds(importedParts);
        await db.SaveChangesAsync();
        return Ok(new ImportCommitResult(created, updated, addedParts, updatedFields, skipped.Count, skipped));
    }
}
