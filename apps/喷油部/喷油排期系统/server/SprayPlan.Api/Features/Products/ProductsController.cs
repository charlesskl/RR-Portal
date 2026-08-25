using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Features.Basic;
using SprayPlan.Api.Services;
using System.Text.RegularExpressions;

namespace SprayPlan.Api.Features.Products;

[ApiController]
[Route("api/products")]
[Authorize]
public class ProductsController(AppDbContext db) : ControllerBase
{
    static readonly string[] ProductStatuses = ["draft", "active", "archived"];
    static readonly string[] ProductionModes = ["machine", "manual"];

    string CurrentUser() => User.FindFirst("username")?.Value ?? "unknown";
    static bool CraftOk(string? craft) => string.IsNullOrEmpty(craft) || CraftTypes.IsValid(craft);
    static string CleanPartName(string? value) => (value ?? "").Trim();
    static string CleanCraft(string? value) => (value ?? "").Trim();
    static string PartNameKey(string? value) => Regex.Replace(CleanPartName(value).Replace('（', '(').Replace('）', ')'), @"\s+", "").ToLowerInvariant();

    record PartRuleDraft(int? Id, string PartName, string Craft, int CraftPasses);

    static string? ValidatePartRules(IEnumerable<PartRuleDraft> parts)
    {
        var rows = parts.Select(p => p with
        {
            PartName = CleanPartName(p.PartName),
            Craft = CleanCraft(p.Craft),
            CraftPasses = Math.Max(0, p.CraftPasses),
        }).ToList();

        if (rows.Any(row => string.IsNullOrWhiteSpace(row.PartName))) return "每个部位都必须填写部位名";
        foreach (var group in rows.GroupBy(row => PartNameKey(row.PartName)))
        {
            var names = group.Select(row => row.PartName).Distinct(StringComparer.Ordinal).ToList();
            if (names.Count > 1) return $"发现疑似重复部位：{string.Join(" / ", names)}。请统一部位名称后再保存。";
        }
        foreach (var group in rows.GroupBy(row => row.PartName))
        {
            var passes = group.Select(row => row.CraftPasses).Where(value => value > 0).Distinct().OrderBy(value => value).ToList();
            if (passes.Count > 1) return $"{group.Key} 的工序道数不一致：{string.Join("、", passes)}。请统一后再保存。";
            var craftCount = group.Select(row => row.Craft).Where(craft => !string.IsNullOrWhiteSpace(craft)).Distinct().Count();
            if (passes.FirstOrDefault() > 0 && passes[0] < craftCount) return $"{group.Key} 已有 {craftCount} 个工序，工序道数不能小于 {craftCount}。";
        }
        return null;
    }

    static Dictionary<string, int> EffectivePasses(IEnumerable<PartRuleDraft> parts) => parts
        .GroupBy(part => CleanPartName(part.PartName))
        .ToDictionary(group => group.Key, group => group.Select(part => Math.Max(0, part.CraftPasses)).FirstOrDefault(value => value > 0), StringComparer.Ordinal);

    static PartDto ToDto(ProductPart part) => new(part.Id, part.ProductId, part.PartName, part.PartOrder,
        part.UnitCost, part.LaborPrice, part.PaintCost, part.QuotedPrice, part.Craft, part.CraftDetail,
        part.DailyCapacity, part.ProductionMode, part.StdMachineCount, part.Remark, part.CraftPasses, part.PartGroupId);

    [HttpGet]
    public async Task<IActionResult> List()
    {
        var products = await db.Products.OrderByDescending(product => product.Id)
            .Select(product => new ProductListItem(product.Id, product.ProductNo, product.IterationNo, product.Status,
                product.EffectiveDate, product.Parts.Select(part => part.PartGroupId).Distinct().Count(),
                product.Parts.Sum(part => part.UnitCost), product.Parts.Sum(part => part.PaintCost),
                product.Parts.Sum(part => part.QuotedPrice), product.LastUpdatedBy, product.UpdatedAt))
            .ToListAsync();
        return Ok(products);
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var product = await db.Products.AsNoTracking()
            .Include(product => product.Parts)
            .FirstOrDefaultAsync(product => product.Id == id);
        if (product is null) return NotFound(new { error = "产品不存在" });

        return Ok(new ProductDetail(product.Id, product.ProductNo, product.IterationNo, product.Status,
            product.EffectiveDate, product.Remark, product.CreatedBy, product.CreatedAt, product.LastUpdatedBy,
            product.UpdatedAt, product.Parts.OrderBy(part => part.PartOrder).Select(ToDto).ToList()));
    }

    [HttpPost]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Create([FromBody] CreateProductRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.ProductNo)) return BadRequest(new { error = "货号必填" });
        if (await db.Products.AnyAsync(product => product.ProductNo == req.ProductNo)) return Conflict(new { error = "该货号的产品已存在" });
        var parts = req.Parts ?? [];
        var drafts = parts.Select(part => new PartRuleDraft(null, CleanPartName(part.PartName), CleanCraft(part.Craft), part.CraftPasses ?? 0)).ToList();
        var ruleError = ValidatePartRules(drafts);
        if (ruleError is not null) return BadRequest(new { error = ruleError });
        if (parts.Any(part => !CraftOk(part.Craft))) return BadRequest(new { error = "工序无效（手喷/移印/自动喷/UV）" });

        var now = DateTime.UtcNow;
        var passes = EffectivePasses(drafts);
        var product = new Product
        {
            ProductNo = req.ProductNo.Trim(), Remark = req.Remark, IterationNo = "V1", Status = "draft",
            CreatedBy = CurrentUser(), CreatedAt = now, UpdatedAt = now,
            Parts = parts.Select((part, index) => new ProductPart
            {
                PartName = CleanPartName(part.PartName), PartOrder = part.PartOrder ?? index,
                UnitCost = part.UnitCost ?? 0, LaborPrice = part.LaborPrice ?? 0, PaintCost = part.PaintCost ?? 0,
                QuotedPrice = part.QuotedPrice ?? 0, Craft = CleanCraft(part.Craft), Remark = part.Remark,
                DailyCapacity = part.DailyCapacity ?? 0, CraftPasses = passes.GetValueOrDefault(CleanPartName(part.PartName)),
            }).ToList(),
        };
        db.Products.Add(product);
        await db.SaveChangesAsync();
        PartProcessRules.AssignGroupIds(product.Parts);
        await db.SaveChangesAsync();
        return StatusCode(201, new ProductCreated(product.Id, product.ProductNo, product.Status));
    }

    [HttpPatch("{id:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateProductRequest req)
    {
        var product = await db.Products.FindAsync(id);
        if (product is null) return NotFound(new { error = "产品不存在" });
        if (req.IterationNo is not null) product.IterationNo = req.IterationNo;
        if (req.Remark is not null) product.Remark = req.Remark;
        if (req.EffectiveDate is not null) product.EffectiveDate = string.IsNullOrEmpty(req.EffectiveDate) ? null : DateUtil.ParseUtc(req.EffectiveDate);
        if (req.Status is not null)
        {
            if (!ProductStatuses.Contains(req.Status)) return BadRequest(new { error = "状态无效" });
            if (req.Status == "active" && !User.IsInRole("admin")) return StatusCode(403, new { error = "只有管理员能审核通过" });
            product.Status = req.Status;
        }
        product.LastUpdatedBy = CurrentUser();
        product.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new ProductHeadUpdated(product.Id, product.ProductNo, product.IterationNo, product.Status));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var product = await db.Products.FindAsync(id);
        if (product is null) return NotFound(new { error = "产品不存在" });
        product.Status = "archived";
        product.LastUpdatedBy = CurrentUser();
        await db.SaveChangesAsync();
        return Ok(new IdStatus(product.Id, product.Status));
    }

    // DELETE /api/products/recycle-bin — 永久清空核价回收站（主管专属）。
    // 已被订单引用的产品必须保留，避免破坏历史订单；其余产品连同库存流水一起清除。
    [HttpDelete("recycle-bin")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> EmptyRecycleBin()
    {
        var archived = await db.Products.Where(product => product.Status == "archived").ToListAsync();
        if (archived.Count == 0) return Ok(new { deleted = 0, skipped = 0 });

        var archivedIds = archived.Select(product => product.Id).ToList();
        var referencedIds = await db.Orders
            .Where(order => order.ProductId != null && archivedIds.Contains(order.ProductId.Value))
            .Select(order => order.ProductId!.Value)
            .Distinct()
            .ToListAsync();
        var deletable = archived.Where(product => !referencedIds.Contains(product.Id)).ToList();
        var deletableIds = deletable.Select(product => product.Id).ToList();
        var moves = await db.InventoryMoves.Where(move => deletableIds.Contains(move.ProductId)).ToListAsync();

        await using var transaction = await db.Database.BeginTransactionAsync();
        db.InventoryMoves.RemoveRange(moves);
        db.Products.RemoveRange(deletable);
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Ok(new { deleted = deletable.Count, skipped = referencedIds.Count });
    }

    [HttpPatch("{id:int}/parts")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> SavePricingTable(int id, [FromBody] SavePricingTableRequest req)
    {
        var product = await db.Products.Include(product => product.Parts).FirstOrDefaultAsync(product => product.Id == id);
        if (product is null) return NotFound(new { error = "产品不存在" });
        var updates = (req.Parts ?? []).ToDictionary(part => part.Id);
        if (updates.Keys.Any(partId => product.Parts.All(part => part.Id != partId))) return BadRequest(new { error = "核价表明细不属于该产品，请刷新后再保存" });
        if (updates.Values.Any(part => !CraftOk(part.Craft))) return BadRequest(new { error = "工序无效（手喷/移印/自动喷/UV）" });
        if (updates.Values.Any(part => part.ProductionMode is not null && !ProductionModes.Contains(part.ProductionMode))) return BadRequest(new { error = "生产方式无效" });

        var drafts = product.Parts.Select(part => updates.TryGetValue(part.Id, out var update)
            ? new PartRuleDraft(part.Id, CleanPartName(update.PartName), CleanCraft(update.Craft), update.CraftPasses ?? 0)
            : new PartRuleDraft(part.Id, part.PartName, part.Craft, part.CraftPasses)).ToList();
        var ruleError = ValidatePartRules(drafts);
        if (ruleError is not null) return BadRequest(new { error = ruleError });
        var passes = EffectivePasses(drafts);
        foreach (var part in product.Parts)
        {
            if (updates.TryGetValue(part.Id, out var update))
            {
                part.PartName = CleanPartName(update.PartName); part.UnitCost = update.UnitCost ?? 0;
                part.LaborPrice = update.LaborPrice ?? 0; part.PaintCost = update.PaintCost ?? 0;
                part.QuotedPrice = update.QuotedPrice ?? 0; part.Craft = CleanCraft(update.Craft);
                part.Remark = update.Remark; part.DailyCapacity = update.DailyCapacity ?? 0;
                part.ProductionMode = update.ProductionMode ?? part.ProductionMode;
                part.StdMachineCount = update.StdMachineCount ?? part.StdMachineCount;
            }
            part.CraftPasses = passes.GetValueOrDefault(CleanPartName(part.PartName));
        }
        PartProcessRules.AssignGroupIds(product.Parts);
        product.LastUpdatedBy = CurrentUser(); product.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new { ok = true });
    }

    [HttpPost("{id:int}/parts")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> AddPart(int id, [FromBody] AddPartRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.PartName)) return BadRequest(new { error = "部位名必填" });
        if (!CraftOk(req.Craft)) return BadRequest(new { error = "工序无效（手喷/移印/自动喷/UV）" });
        var product = await db.Products.Include(product => product.Parts).FirstOrDefaultAsync(product => product.Id == id);
        if (product is null) return NotFound(new { error = "产品不存在" });
        var drafts = product.Parts.Select(part => new PartRuleDraft(part.Id, part.PartName, part.Craft, part.CraftPasses))
            .Append(new PartRuleDraft(null, CleanPartName(req.PartName), CleanCraft(req.Craft), req.CraftPasses ?? 0)).ToList();
        var ruleError = ValidatePartRules(drafts);
        if (ruleError is not null) return BadRequest(new { error = ruleError });
        var passes = EffectivePasses(drafts);
        var part = new ProductPart
        {
            ProductId = id, PartName = CleanPartName(req.PartName), PartOrder = req.PartOrder ?? product.Parts.Count,
            UnitCost = req.UnitCost ?? 0, LaborPrice = req.LaborPrice ?? 0, PaintCost = req.PaintCost ?? 0,
            QuotedPrice = req.QuotedPrice ?? 0, Craft = CleanCraft(req.Craft), Remark = req.Remark,
            DailyCapacity = req.DailyCapacity ?? 0, CraftPasses = passes.GetValueOrDefault(CleanPartName(req.PartName)),
        };
        product.Parts.Add(part);
        await db.SaveChangesAsync();
        foreach (var sibling in product.Parts.Where(sibling => sibling.PartName == part.PartName)) sibling.CraftPasses = part.CraftPasses;
        PartProcessRules.AssignGroupIds(product.Parts);
        await db.SaveChangesAsync();
        return StatusCode(201, ToDto(part));
    }

    [HttpPatch("{id:int}/parts/{partId:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> UpdatePart(int id, int partId, [FromBody] UpdatePartRequest req)
    {
        var product = await db.Products.Include(product => product.Parts).FirstOrDefaultAsync(product => product.Id == id);
        var part = product?.Parts.FirstOrDefault(part => part.Id == partId);
        if (part is null) return NotFound(new { error = "部位不存在" });
        if (req.Craft is not null && !CraftOk(req.Craft)) return BadRequest(new { error = "工序无效（手喷/移印/自动喷/UV）" });
        if (req.ProductionMode is not null && !ProductionModes.Contains(req.ProductionMode)) return BadRequest(new { error = "生产方式无效" });
        var proposedName = req.PartName is null ? part.PartName : CleanPartName(req.PartName);
        var proposedCraft = req.Craft is null ? part.Craft : CleanCraft(req.Craft);
        var proposedPasses = req.CraftPasses ?? part.CraftPasses;
        var drafts = product!.Parts.Select(row => row.Id == part.Id
            ? new PartRuleDraft(row.Id, proposedName, proposedCraft, proposedPasses)
            : new PartRuleDraft(row.Id, row.PartName, row.Craft, row.CraftPasses)).ToList();
        var ruleError = ValidatePartRules(drafts);
        if (ruleError is not null) return BadRequest(new { error = ruleError });
        part.PartName = proposedName; part.Craft = proposedCraft; part.CraftPasses = proposedPasses;
        if (req.UnitCost is not null) part.UnitCost = req.UnitCost.Value;
        if (req.LaborPrice is not null) part.LaborPrice = req.LaborPrice.Value;
        if (req.PaintCost is not null) part.PaintCost = req.PaintCost.Value;
        if (req.QuotedPrice is not null) part.QuotedPrice = req.QuotedPrice.Value;
        if (req.Remark is not null) part.Remark = req.Remark;
        if (req.DailyCapacity is not null) part.DailyCapacity = req.DailyCapacity.Value;
        if (req.ProductionMode is not null) part.ProductionMode = req.ProductionMode;
        if (req.StdMachineCount is not null) part.StdMachineCount = req.StdMachineCount.Value;
        var passes = EffectivePasses(drafts);
        foreach (var sibling in product.Parts.Where(sibling => sibling.PartName == part.PartName)) sibling.CraftPasses = passes.GetValueOrDefault(part.PartName);
        PartProcessRules.AssignGroupIds(product.Parts);
        await db.SaveChangesAsync();
        return Ok(new PartUpdated(part.Id, part.PartName, part.UnitCost, part.LaborPrice, part.PaintCost, part.QuotedPrice, part.Craft, part.Remark, part.DailyCapacity, part.ProductionMode, part.StdMachineCount, part.CraftPasses, part.PartGroupId));
    }

    [HttpDelete("{id:int}/parts/{partId:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> DeletePart(int id, int partId)
    {
        var part = await db.ProductParts.FirstOrDefaultAsync(part => part.Id == partId && part.ProductId == id);
        if (part is null) return NotFound(new { error = "部位不存在" });
        db.ProductParts.Remove(part);
        await db.SaveChangesAsync();
        return Ok(new { ok = true });
    }
}
