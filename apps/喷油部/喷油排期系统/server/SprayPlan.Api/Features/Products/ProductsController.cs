using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;
using SprayPlan.Api.Features.Basic;   // 复用 CraftTypes（手喷/移印/自动喷/UV）

using System.Text.RegularExpressions;

namespace SprayPlan.Api.Features.Products;

// 产品信息库三层下钻 —— 对应现有 /api/products 及其 items/parts 子资源。
// 读=登录(requireLogin)、写=文员主管(requireClerkOrAdmin)。createdBy/lastUpdatedBy 取 JWT username。
[ApiController]
[Route("api/products")]
[Authorize]
public class ProductsController(AppDbContext db) : ControllerBase
{
    static readonly string[] ProductStatuses = ["draft", "active", "archived"];
    static readonly string[] ProductionModes = ["machine", "manual"];

    string CurrentUser() => User.FindFirst("username")?.Value ?? "unknown";

    // 工序/工艺：可留空（未设置），填了必须是 手喷/移印/自动喷/UV 之一
    static bool CraftOk(string? c) => string.IsNullOrEmpty(c) || CraftTypes.IsValid(c);
    static string CleanPartName(string? s) => (s ?? "").Trim();
    static string CleanCraft(string? s) => (s ?? "").Trim();
    static string PartNameKey(string? s)
    {
        var v = CleanPartName(s).Replace('（', '(').Replace('）', ')');
        return Regex.Replace(v, @"\s+", "").ToLowerInvariant();
    }

    record PartRuleDraft(int? Id, string PartName, string Craft, int CraftPasses);

    static string? ValidatePartRules(IEnumerable<PartRuleDraft> parts)
    {
        var rows = parts.Select(p => p with
        {
            PartName = CleanPartName(p.PartName),
            Craft = CleanCraft(p.Craft),
            CraftPasses = Math.Max(0, p.CraftPasses),
        }).ToList();

        foreach (var row in rows)
            if (string.IsNullOrWhiteSpace(row.PartName))
                return "每个部位都必须填写部位名";

        foreach (var g in rows.GroupBy(p => PartNameKey(p.PartName)))
        {
            var names = g.Select(p => p.PartName).Distinct(StringComparer.Ordinal).ToList();
            if (names.Count > 1)
                return $"发现疑似重复部位：{string.Join(" / ", names)}。请统一部位名称后再保存。";
        }

        foreach (var g in rows.GroupBy(p => p.PartName))
        {
            var passes = g.Select(p => p.CraftPasses).Where(v => v > 0).Distinct().OrderBy(v => v).ToList();
            if (passes.Count > 1)
                return $"{g.Key} 的工序道数不一致：{string.Join("、", passes)}。请统一后再保存。";

            var craftCount = g.Select(p => p.Craft).Where(c => !string.IsNullOrWhiteSpace(c)).Distinct().Count();
            var effectivePasses = passes.FirstOrDefault();
            if (effectivePasses > 0 && effectivePasses < craftCount)
                return $"{g.Key} 已有 {craftCount} 个工序，工序道数不能小于 {craftCount}。";
        }

        return null;
    }

    static Dictionary<string, int> EffectivePassesByPartName(IEnumerable<PartRuleDraft> parts) =>
        parts.GroupBy(p => CleanPartName(p.PartName))
            .ToDictionary(
                g => g.Key,
                g => g.Select(p => Math.Max(0, p.CraftPasses)).FirstOrDefault(v => v > 0),
                StringComparer.Ordinal);

    // GET /api/products — 列表（聚合 子件数/总核价/总报价），id 降序
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var list = await db.Products.OrderByDescending(p => p.Id)
            .Select(p => new ProductListItem(
                p.Id, p.ProductNo, p.IterationNo, p.Status, p.EffectiveDate,
                p.Items.Count,
                p.Items.SelectMany(i => i.Parts).Sum(x => x.UnitCost),
                p.Items.SelectMany(i => i.Parts).Sum(x => x.PaintCost),
                p.Items.SelectMany(i => i.Parts).Sum(x => x.QuotedPrice),
                p.LastUpdatedBy, p.UpdatedAt))
            .ToListAsync();
        return Ok(list);
    }

    // GET /api/products/{id} — 详情（items→parts 各按 order 排序）
    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var product = await db.Products.Where(p => p.Id == id)
            .Select(p => new ProductDetail(
                p.Id, p.ProductNo, p.IterationNo, p.Status, p.EffectiveDate,
                p.Remark, p.CreatedBy, p.CreatedAt, p.LastUpdatedBy, p.UpdatedAt,
                p.Items.OrderBy(i => i.ItemOrder).Select(i => new ItemDto(
                    i.Id, i.ProductId, i.ItemName, i.ItemOrder,
                    i.Parts.OrderBy(pt => pt.PartOrder).Select(pt => new PartDto(pt.Id, pt.ItemId, pt.PartName, pt.PartOrder, pt.UnitCost, pt.LaborPrice, pt.PaintCost, pt.QuotedPrice, pt.Craft, pt.CraftDetail, pt.DailyCapacity, pt.ProductionMode, pt.StdMachineCount, pt.Remark, pt.CraftPasses)).ToList()
                )).ToList()))
            .FirstOrDefaultAsync();
        if (product is null) return NotFound(new { error = "产品不存在" });
        return Ok(product);
    }

    // POST /api/products — 嵌套创建（产品→子件→部位）
    [HttpPost]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Create([FromBody] CreateProductRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.ProductNo))
            return BadRequest(new { error = "货号必填" });

        var items = req.Items ?? new();
        foreach (var it in items)
        {
            var drafts = (it.Parts ?? new())
                .Select(pt => new PartRuleDraft(null, CleanPartName(pt.PartName), CleanCraft(pt.Craft), pt.CraftPasses ?? 0))
                .ToList();
            var ruleError = ValidatePartRules(drafts);
            if (ruleError is not null) return BadRequest(new { error = ruleError });
        }
        foreach (var it in items)
            foreach (var pt in (it.Parts ?? new()))
            {
                if (string.IsNullOrWhiteSpace(pt.PartName))
                    return BadRequest(new { error = "每个部位都必须填部位名" });
                if (!CraftOk(pt.Craft))
                    return BadRequest(new { error = "工序无效（手喷/移印/自动喷/UV）" });
            }

        if (await db.Products.AnyAsync(p => p.ProductNo == req.ProductNo))
            return Conflict(new { error = "该货号的产品已存在" });

        var now = DateTime.UtcNow;
        var product = new Product
        {
            ProductNo = req.ProductNo,
            IterationNo = "V1", Status = "draft", Remark = req.Remark,
            CreatedBy = CurrentUser(), CreatedAt = now, UpdatedAt = now,
            Items = items.Select((it, ii) => new ProductItem
            {
                ItemName = it.ItemName ?? "", ItemOrder = it.ItemOrder ?? ii,
                Parts = (it.Parts ?? new()).Select((pt, pix) => new ProductPart
                {
                    PartName = CleanPartName(pt.PartName), PartOrder = pt.PartOrder ?? pix,
                    UnitCost = pt.UnitCost ?? 0, LaborPrice = pt.LaborPrice ?? 0,
                    PaintCost = pt.PaintCost ?? 0, QuotedPrice = pt.QuotedPrice ?? 0, Remark = pt.Remark,
                    Craft = CleanCraft(pt.Craft), DailyCapacity = pt.DailyCapacity ?? 0,
                    CraftPasses = EffectivePassesByPartName((it.Parts ?? new()).Select(x => new PartRuleDraft(null, CleanPartName(x.PartName), CleanCraft(x.Craft), x.CraftPasses ?? 0))).GetValueOrDefault(CleanPartName(pt.PartName)),
                }).ToList()
            }).ToList()
        };
        db.Products.Add(product);
        await db.SaveChangesAsync();
        return StatusCode(201, new ProductCreated(product.Id, product.ProductNo, product.Status));
    }

    // PATCH /api/products/{id} — 改头部
    [HttpPatch("{id:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateProductRequest req)
    {
        var p = await db.Products.FindAsync(id);
        if (p is null) return NotFound(new { error = "产品不存在" });

        if (req.IterationNo is not null) p.IterationNo = req.IterationNo;
        if (req.Remark is not null) p.Remark = req.Remark;
        if (req.EffectiveDate is not null)
            p.EffectiveDate = string.IsNullOrEmpty(req.EffectiveDate) ? null : DateUtil.ParseUtc(req.EffectiveDate);
        if (req.Status is not null)
        {
            if (!ProductStatuses.Contains(req.Status)) return BadRequest(new { error = "状态无效" });
            // 审核：置为「已生效」(active) 只有管理员能做；文员只能录入/改/作废/退回待审核
            if (req.Status == "active" && !User.IsInRole("admin"))
                return StatusCode(403, new { error = "只有管理员能审核通过" });
            p.Status = req.Status;
        }
        p.LastUpdatedBy = CurrentUser();
        p.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new ProductHeadUpdated(p.Id, p.ProductNo, p.IterationNo, p.Status));
    }

    // DELETE /api/products/{id} — 作废（status=archived 软删）
    [HttpDelete("{id:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var p = await db.Products.FindAsync(id);
        if (p is null) return NotFound(new { error = "产品不存在" });
        p.Status = "archived";
        p.LastUpdatedBy = CurrentUser();
        await db.SaveChangesAsync();
        return Ok(new IdStatus(p.Id, p.Status));
    }

    // POST /api/products/{id}/items — 加子件（可带部位明细）
    [HttpPost("{id:int}/items")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> AddItem(int id, [FromBody] AddItemRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.ItemName))
            return BadRequest(new { error = "子件名必填" });
        var addItemDrafts = (req.Parts ?? new())
            .Select(pt => new PartRuleDraft(null, CleanPartName(pt.PartName), CleanCraft(pt.Craft), pt.CraftPasses ?? 0))
            .ToList();
        var addItemRuleError = ValidatePartRules(addItemDrafts);
        if (addItemRuleError is not null) return BadRequest(new { error = addItemRuleError });
        foreach (var pt in (req.Parts ?? new()))
        {
            if (string.IsNullOrWhiteSpace(pt.PartName))
                return BadRequest(new { error = "每个部位都必须填部位名" });
            if (!CraftOk(pt.Craft))
                return BadRequest(new { error = "工序无效（手喷/移印/自动喷/UV）" });
        }
        if (!await db.Products.AnyAsync(p => p.Id == id))
            return NotFound(new { error = "产品不存在" });

        var item = new ProductItem
        {
            ProductId = id, ItemName = req.ItemName, ItemOrder = req.ItemOrder ?? 0,
            Parts = (req.Parts ?? new()).Select((pt, pi) => new ProductPart
            {
                PartName = CleanPartName(pt.PartName), PartOrder = pi,
                UnitCost = pt.UnitCost ?? 0, LaborPrice = pt.LaborPrice ?? 0,
                PaintCost = pt.PaintCost ?? 0, QuotedPrice = pt.QuotedPrice ?? 0,
                Craft = CleanCraft(pt.Craft), DailyCapacity = pt.DailyCapacity ?? 0,
                CraftPasses = EffectivePassesByPartName(addItemDrafts).GetValueOrDefault(CleanPartName(pt.PartName)),
            }).ToList()
        };
        db.ProductItems.Add(item);
        await db.SaveChangesAsync();

        var dto = new ItemDto(item.Id, item.ProductId, item.ItemName, item.ItemOrder,
            item.Parts.Select(pt => new PartDto(pt.Id, pt.ItemId, pt.PartName, pt.PartOrder, pt.UnitCost, pt.LaborPrice, pt.PaintCost, pt.QuotedPrice, pt.Craft, pt.CraftDetail, pt.DailyCapacity, pt.ProductionMode, pt.StdMachineCount, pt.Remark, pt.CraftPasses)).ToList());
        return StatusCode(201, dto);
    }

    // PATCH /api/products/{id}/items/{itemId} — 改子件名
    [HttpPatch("{id:int}/items/{itemId:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> UpdateItem(int id, int itemId, [FromBody] UpdateItemRequest req)
    {
        var item = await db.ProductItems.FindAsync(itemId);
        if (item is null) return NotFound(new { error = "子件不存在" });

        if (req.ItemName is not null) item.ItemName = req.ItemName;
        await db.SaveChangesAsync();

        return Ok(new ItemWithParts(item.Id, item.ProductId, item.ItemName, item.ItemOrder));
    }

    // DELETE /api/products/{id}/items/{itemId} — 删子件（级联删部位）
    [HttpDelete("{id:int}/items/{itemId:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> DeleteItem(int id, int itemId)
    {
        var item = await db.ProductItems.FindAsync(itemId);
        if (item is null) return NotFound(new { error = "子件不存在" });
        db.ProductItems.Remove(item);
        await db.SaveChangesAsync();
        return Ok(new { ok = true });
    }

    // POST /api/products/{id}/parts — 给指定子件加部位（校验子件属于该产品）
    // PATCH /api/products/{id}/parts - 保存整张核价表明细
    [HttpPatch("{id:int}/parts")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> SavePricingTable(int id, [FromBody] SavePricingTableRequest req)
    {
        var product = await db.Products
            .Include(p => p.Items)
                .ThenInclude(i => i.Parts)
            .FirstOrDefaultAsync(p => p.Id == id);
        if (product is null) return NotFound(new { error = "产品不存在" });

        var updates = (req.Parts ?? new()).ToDictionary(p => p.Id);
        var allPartIds = product.Items.SelectMany(i => i.Parts).Select(p => p.Id).ToHashSet();
        var unknownIds = updates.Keys.Where(x => !allPartIds.Contains(x)).ToList();
        if (unknownIds.Count > 0) return BadRequest(new { error = "核价表明细不属于该产品，请刷新后再保存" });

        foreach (var u in updates.Values)
        {
            if (!CraftOk(u.Craft)) return BadRequest(new { error = "工序无效（手喷/移印/自动喷/UV）" });
            if ((u.CraftPasses ?? 0) < 0) return BadRequest(new { error = "工序道数不能为负" });
            if (u.ProductionMode is not null && !ProductionModes.Contains(u.ProductionMode))
                return BadRequest(new { error = "生产方式无效" });
        }

        foreach (var item in product.Items)
        {
            var drafts = item.Parts.Select(p =>
            {
                updates.TryGetValue(p.Id, out var u);
                return new PartRuleDraft(
                    p.Id,
                    u is not null ? CleanPartName(u.PartName) : p.PartName,
                    u is not null ? CleanCraft(u.Craft) : p.Craft,
                    u is not null ? u.CraftPasses ?? 0 : p.CraftPasses);
            }).ToList();
            var ruleError = ValidatePartRules(drafts);
            if (ruleError is not null) return BadRequest(new { error = ruleError });
        }

        foreach (var item in product.Items)
        {
            foreach (var part in item.Parts)
            {
                if (!updates.TryGetValue(part.Id, out var u)) continue;
                part.PartName = CleanPartName(u.PartName);
                part.UnitCost = u.UnitCost ?? 0;
                part.LaborPrice = u.LaborPrice ?? 0;
                part.PaintCost = u.PaintCost ?? 0;
                part.QuotedPrice = u.QuotedPrice ?? 0;
                part.Craft = CleanCraft(u.Craft);
                part.Remark = u.Remark;
                part.DailyCapacity = u.DailyCapacity ?? 0;
                part.ProductionMode = u.ProductionMode ?? part.ProductionMode;
                part.StdMachineCount = u.StdMachineCount ?? part.StdMachineCount;
                part.CraftPasses = u.CraftPasses ?? 0;
            }

            var passesByPart = EffectivePassesByPartName(item.Parts.Select(p => new PartRuleDraft(p.Id, p.PartName, p.Craft, p.CraftPasses)));
            foreach (var part in item.Parts)
                part.CraftPasses = passesByPart.GetValueOrDefault(CleanPartName(part.PartName));
        }

        product.LastUpdatedBy = CurrentUser();
        product.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new { ok = true });
    }

    [HttpPost("{id:int}/parts")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> AddPart(int id, [FromBody] AddPartRequest req)
    {
        if (req.ItemId is null or 0 || string.IsNullOrWhiteSpace(req.PartName))
            return BadRequest(new { error = "子件 ID 和部位名必填" });
        if (!CraftOk(req.Craft))
            return BadRequest(new { error = "工序无效（手喷/移印/自动喷/UV）" });
        // 工序道数：业务规则 craftPasses ≥ 该部位工序种类数（同名部位已有几种 craft）。
        // P1 阶段单部位单行录入，至少 ≥ 0；完整「≥ 工序种类数」校验在方式A录入期补。
        if (req.CraftPasses is < 0)
            return BadRequest(new { error = "工序道数不能为负" });

        var item = await db.ProductItems.Include(i => i.Parts).FirstOrDefaultAsync(i => i.Id == req.ItemId && i.ProductId == id);
        if (item is null) return NotFound(new { error = "子件不存在或不属于该产品" });

        var addPartDrafts = item.Parts.Select(p => new PartRuleDraft(p.Id, p.PartName, p.Craft, p.CraftPasses))
            .Append(new PartRuleDraft(null, CleanPartName(req.PartName), CleanCraft(req.Craft), req.CraftPasses ?? 0))
            .ToList();
        var addPartRuleError = ValidatePartRules(addPartDrafts);
        if (addPartRuleError is not null) return BadRequest(new { error = addPartRuleError });
        var addPartPassesByPart = EffectivePassesByPartName(addPartDrafts);
        var cleanPartName = CleanPartName(req.PartName);
        var effectivePasses = addPartPassesByPart.GetValueOrDefault(cleanPartName);
        foreach (var sibling in item.Parts.Where(p => CleanPartName(p.PartName) == cleanPartName))
            sibling.CraftPasses = effectivePasses;

        var part = new ProductPart
        {
            ItemId = req.ItemId.Value, PartName = cleanPartName, PartOrder = req.PartOrder ?? 0,
            UnitCost = req.UnitCost ?? 0, LaborPrice = req.LaborPrice ?? 0,
            PaintCost = req.PaintCost ?? 0, QuotedPrice = req.QuotedPrice ?? 0, Remark = req.Remark,
            Craft = CleanCraft(req.Craft), DailyCapacity = req.DailyCapacity ?? 0,
            CraftPasses = effectivePasses,
        };
        db.ProductParts.Add(part);
        await db.SaveChangesAsync();
        return StatusCode(201, new PartDto(part.Id, part.ItemId, part.PartName, part.PartOrder, part.UnitCost, part.LaborPrice, part.PaintCost, part.QuotedPrice, part.Craft, part.CraftDetail, part.DailyCapacity, part.ProductionMode, part.StdMachineCount, part.Remark, part.CraftPasses));
    }

    // PATCH /api/products/{id}/parts/{partId} — 改 4 价+部位名+备注+产能字段
    [HttpPatch("{id:int}/parts/{partId:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> UpdatePart(int id, int partId, [FromBody] UpdatePartRequest req)
    {
        var part = await db.ProductParts.Include(p => p.Item).FirstOrDefaultAsync(p => p.Id == partId && p.Item != null && p.Item.ProductId == id);
        if (part is null) return NotFound(new { error = "部位不存在" });

        var itemParts = await db.ProductParts.Where(p => p.ItemId == part.ItemId).ToListAsync();
        var proposedPartName = req.PartName is not null ? CleanPartName(req.PartName) : part.PartName;
        var proposedCraft = req.Craft is not null ? CleanCraft(req.Craft) : part.Craft;
        var proposedCraftPasses = req.CraftPasses is not null ? req.CraftPasses.Value : part.CraftPasses;
        if (proposedCraftPasses < 0) return BadRequest(new { error = "工序道数不能为负" });

        var updateDrafts = itemParts.Select(p => p.Id == part.Id
                ? new PartRuleDraft(p.Id, proposedPartName, proposedCraft, proposedCraftPasses)
                : new PartRuleDraft(p.Id, p.PartName, p.Craft, p.CraftPasses))
            .ToList();
        var updateRuleError = ValidatePartRules(updateDrafts);
        if (updateRuleError is not null) return BadRequest(new { error = updateRuleError });

        if (req.PartName is not null) part.PartName = proposedPartName;
        if (req.UnitCost is not null) part.UnitCost = req.UnitCost.Value;
        if (req.LaborPrice is not null) part.LaborPrice = req.LaborPrice.Value;
        if (req.PaintCost is not null) part.PaintCost = req.PaintCost.Value;
        if (req.QuotedPrice is not null) part.QuotedPrice = req.QuotedPrice.Value;
        if (req.Craft is not null)
        {
            if (!CraftOk(req.Craft)) return BadRequest(new { error = "工序无效（手喷/移印/自动喷/UV）" });
            part.Craft = proposedCraft;
        }
        if (req.Remark is not null) part.Remark = req.Remark;
        if (req.DailyCapacity is not null) part.DailyCapacity = req.DailyCapacity.Value;
        if (req.ProductionMode is not null)
        {
            if (!ProductionModes.Contains(req.ProductionMode)) return BadRequest(new { error = "生产方式无效" });
            part.ProductionMode = req.ProductionMode;
        }
        if (req.StdMachineCount is not null) part.StdMachineCount = req.StdMachineCount.Value;
        if (req.CraftPasses is not null)
        {
            if (req.CraftPasses.Value < 0) return BadRequest(new { error = "工序道数不能为负" });
            part.CraftPasses = proposedCraftPasses;
        }
        var updatePassesByPart = EffectivePassesByPartName(updateDrafts);
        var syncedPasses = updatePassesByPart.GetValueOrDefault(part.PartName);
        foreach (var sibling in itemParts.Where(p => CleanPartName(p.PartName) == part.PartName))
            sibling.CraftPasses = syncedPasses;
        await db.SaveChangesAsync();
        return Ok(new PartUpdated(part.Id, part.PartName, part.UnitCost, part.LaborPrice, part.PaintCost, part.QuotedPrice, part.Craft, part.Remark, part.DailyCapacity, part.ProductionMode, part.StdMachineCount, part.CraftPasses));
    }

    // DELETE /api/products/{id}/parts/{partId} — 真删部位
    [HttpDelete("{id:int}/parts/{partId:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> DeletePart(int id, int partId)
    {
        var part = await db.ProductParts.FindAsync(partId);
        if (part is null) return NotFound(new { error = "部位不存在" });
        db.ProductParts.Remove(part);
        await db.SaveChangesAsync();
        return Ok(new { ok = true });
    }
}
