using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Features.Basic;
using SprayPlan.Api.Services.Import;

namespace SprayPlan.Api.Features.Products;

// 核价表 Excel 导入：预览（解析不入库）+ 提交（建产品 draft + 回填工序对照表）。
// 写权限：文员/主管（与产品其它写操作一致）。
[ApiController]
[Route("api/products/import")]
[Authorize(Roles = "clerk,admin")]
public class ProductImportController(AppDbContext db) : ControllerBase
{
    string CurrentUser() => User.FindFirst("username")?.Value ?? "unknown";

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

            // 按货号查重（一个货号一条产品）
            bool duplicate = await db.Products.AnyAsync(p => p.ProductNo == parsed.ProductNo);
            if (duplicate) dup++; else normal++;

            var parts = parsed.Parts.Select(p =>
            {
                // 优先查对照表，其次启发式
                string? cat = aliasMap.TryGetValue(p.CraftDetail, out var c) ? c : p.Category;
                if (cat is null) pending++;
                return new PreviewPart(p.ItemName, p.PartName, p.CraftDetail, cat,
                    p.DailyCapacity, p.StdMachineCount, p.LaborPrice, p.UnitCost, p.PaintCost, p.QuotedPrice, p.Remark);
            }).ToList();

            products.Add(new PreviewProduct(sheetName, parsed.ProductNo, parsed.SuggestedItemName, parsed.IsThreeLevel, duplicate, parts));
        }

        return Ok(new ImportPreviewResponse(products, unrecognized, normal, pending, dup));
    }

    // POST /api/products/import/commit —— 按用户处理结果建产品（draft）+ 回填工序对照表
    [HttpPost("commit")]
    public async Task<IActionResult> Commit([FromBody] ImportCommitRequest req)
    {
        var now = DateTime.UtcNow;
        var me = CurrentUser();
        int created = 0; var skipped = new List<string>();
        var existingAliases = await db.CraftAliases.ToDictionaryAsync(a => a.Alias, a => a);
        // 批内已用货号：防止同一请求内重复货号绕过 DB 查重撞唯一索引
        var batchKeys = new HashSet<string>();

        foreach (var cp in req.Products ?? new())
        {
            if (cp.Parts is null || cp.Parts.Count == 0) continue;

            bool exists = await db.Products.AnyAsync(p => p.ProductNo == cp.ProductNo);
            if (exists) { skipped.Add(cp.ProductNo); continue; }
            // 批内去重：DB 查重查不到本批未提交的实体，用 HashSet 兜底
            if (!batchKeys.Add(cp.ProductNo)) { skipped.Add(cp.ProductNo); continue; }

            // 按 ItemName 分组成子件（保持出现顺序）
            var groups = cp.Parts
                .Select((p, i) => (p, i))
                .GroupBy(x => x.p.ItemName)
                .Select(g => (Name: g.Key, Parts: g.OrderBy(x => x.i).Select(x => x.p).ToList()))
                .ToList();

            var product = new Product
            {
                ProductNo = cp.ProductNo,
                IterationNo = "V1", Status = "draft",
                CreatedBy = me, CreatedAt = now, UpdatedAt = now,
                Items = groups.Select((g, gi) => new ProductItem
                {
                    ItemName = g.Name, ItemOrder = gi,
                    Parts = g.Parts.Select((pt, pi) => new ProductPart
                    {
                        PartName = pt.PartName, PartOrder = pi,
                        Craft = pt.Craft, CraftDetail = pt.CraftDetail,
                        UnitCost = pt.UnitCost, LaborPrice = pt.LaborPrice, PaintCost = pt.PaintCost, QuotedPrice = pt.QuotedPrice,
                        DailyCapacity = pt.DailyCapacity, StdMachineCount = pt.StdMachineCount, Remark = pt.Remark,
                    }).ToList()
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
        return Ok(new ImportCommitResult(created, skipped.Count, skipped));
    }
}
