using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Features.Orders;

// 订单 —— 对应现有 /api/orders + /api/orders/[id]。读=登录、写=文员主管。
// 明细仍 V2（PATCH 只改订单头/状态），创建走嵌套。
[ApiController]
[Route("api/orders")]
[Authorize]
public class OrdersController(AppDbContext db, PdfStorage pdf) : ControllerBase
{
    static readonly string[] OrderStatuses = ["received", "scheduled", "in_production", "completed", "archived"];
    const string PdfRemarkPrefix = "PDF导入:";   // 待补产品订单把 PDF token 存进 Remark，前缀固定
    string CurrentUser() => User.FindFirst("username")?.Value ?? "unknown";

    // GET /api/orders — 列表（聚合 整单总数），id 降序
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var list = await db.Orders.OrderByDescending(o => o.Id)
            .Select(o => new OrderListItem(
                o.Id, o.ExternalOrderNo, o.Product == null ? "" : o.Product.ProductNo,
                o.OrderDate, o.DeliveryDate, o.Status, o.IsMA, o.IsUrgent,
                o.Lines.SelectMany(l => l.PartQtys).Sum(q => q.Qty), o.PendingProduct))
            .ToListAsync();
        return Ok(list);
    }

    // GET /api/orders/{id} — 详情（含 lines→partQtys + 引用产品的部位基础价）
    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var order = await db.Orders.Where(o => o.Id == id)
            .Select(o => new OrderDetail(
                o.Id, o.ExternalOrderNo, o.ProductId, o.OrderDate, o.DeliveryDate,
                o.Status, o.IsMA, o.IsUrgent, o.Remark, o.CreatedBy,
                o.Product == null ? null : new OrderProductDto(o.Product.Id, o.Product.ProductNo,
                    o.Product.Items.Select(i => new OrderProductItemDto(i.Id, i.ItemName,
                        i.Parts.Select(p => new OrderProductPartDto(p.Id, p.PartName, p.UnitCost, p.LaborPrice, p.PaintCost, p.QuotedPrice)).ToList())).ToList()),
                o.Lines.OrderBy(l => l.LineOrder).Select(l => new OrderLineDetailDto(
                    l.Id, l.ItemName, l.SourceItemId, l.LineOrder,
                    l.PartQtys.OrderBy(q => q.PartOrder).Select(q => new OrderPartQtyDto(q.Id, q.PartName, q.SourcePartId, q.Qty, q.PartOrder)).ToList())).ToList(),
                // 数量可改 = 已接单 且 无未删排期计划（与 PATCH 校验同口径）
                o.Status == "received" && !o.Plans.Any(p => p.DeletedAt == null)))
            .FirstOrDefaultAsync();
        if (order is null) return NotFound(new { error = "订单不存在" });
        return Ok(order);
    }

    // POST /api/orders — 嵌套创建（订单→明细行(子件)→部位数量）
    [HttpPost]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Create([FromBody] CreateOrderRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.ExternalOrderNo) || req.ProductId is null or 0)
            return BadRequest(new { error = "外部订单号、款号必填" });

        if (!await db.Products.AnyAsync(p => p.Id == req.ProductId))
            return BadRequest(new { error = "引用的款号不存在" });

        if (await db.Orders.AnyAsync(o => o.ExternalOrderNo == req.ExternalOrderNo))
            return Conflict(new { error = "该外部订单号已存在" });

        var now = DateTime.UtcNow;
        var lines = req.Lines ?? new();
        var order = new Order
        {
            ExternalOrderNo = req.ExternalOrderNo, ProductId = req.ProductId.Value,
            OrderDate = string.IsNullOrEmpty(req.OrderDate) ? now : DateUtil.ParseUtc(req.OrderDate),
            DeliveryDate = string.IsNullOrEmpty(req.DeliveryDate) ? null : DateUtil.ParseUtc(req.DeliveryDate),
            Status = "received", IsMA = req.IsMA ?? false, IsUrgent = req.IsUrgent ?? false, Remark = req.Remark,
            CreatedBy = CurrentUser(), CreatedAt = now, UpdatedAt = now,
            Lines = lines.Select((ln, li) => new OrderLine
            {
                ItemName = ln.ItemName ?? "", SourceItemId = ln.SourceItemId, LineOrder = li,
                PartQtys = (ln.PartQtys ?? new()).Select((q, qi) => new OrderPartQty
                {
                    PartName = q.PartName ?? "", SourcePartId = q.SourcePartId, Qty = q.Qty ?? 0, PartOrder = q.PartOrder ?? qi,
                }).ToList(),
            }).ToList()
        };
        db.Orders.Add(order);
        await db.SaveChangesAsync();
        return StatusCode(201, new OrderCreated(order.Id, order.ExternalOrderNo, order.Status, order.IsMA, order.IsUrgent));
    }

    // PATCH /api/orders/{id} — 改头部/状态（明细 V2 不改）
    [HttpPatch("{id:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateOrderRequest req)
    {
        // 状态校验在查订单前（对齐旧逻辑：非法状态立即 400，不依赖订单是否存在）
        if (req.Status is not null && !OrderStatuses.Contains(req.Status))
            return BadRequest(new { error = "状态无效" });

        var o = await db.Orders.FindAsync(id);
        if (o is null) return NotFound(new { error = "订单不存在" });

        // 明细数量编辑（修正导入识别错误用）：仅「已接单 received 且无排期计划」可改。
        // 一旦进入排期/实绩，数量锁死，避免与已排产量/核价/实绩冲突。
        if (req.Lines is not null && req.Lines.Count > 0)
        {
            if (o.Status != "received")
                return BadRequest(new { error = "订单已进入排期/生产，数量不可修改" });
            bool hasPlan = await db.ProductionPlans.AnyAsync(p => p.OrderId == id && p.DeletedAt == null);
            if (hasPlan)
                return BadRequest(new { error = "订单已有排期计划，数量不可修改" });

            // 按 partQty 主键 id 更新数量（只认属于本订单的明细，防越权改他单）
            var qtyMap = req.Lines.SelectMany(l => l.PartQtys ?? new()).ToDictionary(q => q.Id, q => q.Qty);
            if (qtyMap.Count > 0)
            {
                var partQtys = await db.OrderPartQtys
                    .Where(q => q.Line != null && q.Line.OrderId == id && qtyMap.Keys.Contains(q.Id))
                    .ToListAsync();
                foreach (var pq in partQtys)
                    if (qtyMap.TryGetValue(pq.Id, out var newQty)) pq.Qty = newQty;
            }
        }

        if (req.Remark is not null) o.Remark = req.Remark;
        if (req.DeliveryDate is not null) o.DeliveryDate = string.IsNullOrEmpty(req.DeliveryDate) ? null : DateUtil.ParseUtc(req.DeliveryDate);
        if (req.IsMA is not null) o.IsMA = req.IsMA.Value;
        if (req.IsUrgent is not null) o.IsUrgent = req.IsUrgent.Value;
        if (req.OrderDate is not null) o.OrderDate = DateUtil.ParseUtc(req.OrderDate);
        // 状态只读：人工不可随意改，仅允许「作废→已接单」(回收站恢复)。
        // 其余流转(接单→排期→在产→完工)全由系统自动推进，保证状态准确。
        if (req.Status is not null)
        {
            if (o.Status == "archived" && req.Status == "received")
                o.Status = "received";   // 恢复作废订单
            else
                return BadRequest(new { error = "订单状态由系统自动流转，不可手动修改" });
        }
        o.LastUpdatedBy = CurrentUser();
        o.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new OrderHeadUpdated(o.Id, o.ExternalOrderNo, o.Status, o.IsMA, o.IsUrgent));
    }

    // DELETE /api/orders/{id} — 作废（status=archived 软删）
    [HttpDelete("{id:int}")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var o = await db.Orders.FindAsync(id);
        if (o is null) return NotFound(new { error = "订单不存在" });
        // 有排期计划的订单不许作废，须先撤销排期（避免作废后留下孤儿计划行）
        bool hasPlan = await db.ProductionPlans.AnyAsync(p => p.OrderId == id && p.DeletedAt == null);
        if (hasPlan)
            return BadRequest(new { error = "该订单已排期，请先撤销排期再作废" });
        o.Status = "archived";
        o.LastUpdatedBy = CurrentUser();
        await db.SaveChangesAsync();
        return Ok(new OrderIdStatus(o.Id, o.Status));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PDF 订单导入（集成层）：上传解析→预览草稿→确认入库→（待补产品后）补款号续解析。
    // 复用 Services 里的纯解析函数（PdfWordSource/PdfTableExtractor/PdfImportParse），本层只管入库。
    // ═══════════════════════════════════════════════════════════════════════

    // POST /api/orders/import-pdf — 上传 PDF，解析出抬头+明细草稿（不入库）。
    [HttpPost("import-pdf")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> ImportPdf(IFormFile? file)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { error = "未上传文件" });

        // M2：拒绝非 PDF，避免非 PDF 落盘后解析抛 500。
        var isPdf = file.ContentType == "application/pdf"
                    || file.FileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase);
        if (!isPdf)
            return BadRequest(new { error = "请上传 PDF 文件" });

        // 1) 落盘暂存，拿 token；之后所有解析都从该文件读，保证草稿/续解析一致。
        string token;
        using (var us = file.OpenReadStream())
            token = await pdf.SaveAsync(us);

        // 2) PDF → 带坐标词 → 几何还原出明细行/抬头/款号格。
        var words = PdfWordSource.Extract(pdf.Open(token));
        var rows = PdfTableExtractor.ExtractRows(words);
        var pdfHead = PdfTableExtractor.ExtractHead(words);
        var pnCell = PdfTableExtractor.ExtractProductNoCell(words);
        var pm = PdfImportParse.ParseProductNoAndMa(pnCell);
        var draftLines = PdfImportParse.BuildDraftLines(rows);

        // 3) 抬头 DTO（DateTime → yyyy-MM-dd 字符串）。款号/MA 来自款号格解析。
        var head = new ImportDraftHead(
            pdfHead.ExternalOrderNo,
            pdfHead.OrderDate.ToString("yyyy-MM-dd"),
            pdfHead.DeliveryDate?.ToString("yyyy-MM-dd"),
            pm.ProductNo, pm.IsMa);

        // 4) 查产品库（含子件，用于匹配子件名）。Status!=archived。
        var product = await db.Products.Include(p => p.Items)
            .FirstOrDefaultAsync(p => p.ProductNo == pm.ProductNo && p.Status != "archived");

        if (product is null)
            // 货号不在库 → 待补产品，明细留空交前端，token 带回供确认/续解析。
            return Ok(new ImportDraft(head, ProductFound: false, ProductId: null, Lines: new(), PdfToken: token, AvailableItems: new()));

        // 命中 → 把草稿行与产品库子件名精确匹配（绿/红）。
        var matched = PdfImportParse.MatchItems(draftLines, product.Items.Select(i => i.ItemName));
        var lines = matched.Select(m => new ImportDraftLine(m.PdfItemName, m.TotalQty, m.MergedRows, m.MatchedItemName)).ToList();
        // 该货号下全部子件名，供前端红行下拉手工选。
        var availableItems = product.Items.Select(i => i.ItemName).ToList();
        return Ok(new ImportDraft(head, ProductFound: true, ProductId: product.Id, Lines: lines, PdfToken: token, AvailableItems: availableItems));
    }

    // POST /api/orders/import-confirm — 确认草稿入库（建订单+明细，或建待补产品订单）。
    [HttpPost("import-confirm")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> ImportConfirm([FromBody] ImportConfirmRequest req)
    {
        if (await db.Orders.AnyAsync(o => o.ExternalOrderNo == req.Head.ExternalOrderNo))
            return Conflict(new { error = "该订单编号已存在" });

        var now = DateTime.UtcNow;
        var order = new Order
        {
            ExternalOrderNo = req.Head.ExternalOrderNo,
            OrderDate = string.IsNullOrEmpty(req.Head.OrderDate) ? now : DateUtil.ParseUtc(req.Head.OrderDate),
            DeliveryDate = string.IsNullOrEmpty(req.Head.DeliveryDate) ? null : DateUtil.ParseUtc(req.Head.DeliveryDate),
            IsMA = req.Head.IsMa,
            Status = "received",
            CreatedBy = CurrentUser(), CreatedAt = now, UpdatedAt = now,
            // 只有待补产品单才存 PDF token，正常单 Remark 留 null。
            // continue-parse 读 token 时只处理待补产品单，无副作用。
            Remark = req.AsPendingProduct ? PdfRemarkPrefix + req.PdfToken : null,
        };

        if (req.AsPendingProduct)
        {
            // 货号找不到：标记待补产品，不建明细，ProductId 留 null。
            order.PendingProduct = true;
        }
        else
        {
            // 防御：前端应只回传绿行（MatchedItemName 已匹配），若 null/空白则说明有未匹配行混入，
            // 降级为 400 而非让 BuildLines 里的 .Trim() 抛 NPE → 500。
            if (req.Lines.Any(l => string.IsNullOrWhiteSpace(l.MatchedItemName)))
                return BadRequest(new { error = "存在未匹配子件，请先处理后再入库" });

            var product = await db.Products.Include(p => p.Items).ThenInclude(i => i.Parts)
                .FirstOrDefaultAsync(p => p.ProductNo == req.Head.ProductNo && p.Status != "archived");
            if (product is null)
                return BadRequest(new { error = "款号不存在或已归档" });

            order.ProductId = product.Id;
            order.Lines = BuildLines(req.Lines, product);
        }

        db.Orders.Add(order);
        await db.SaveChangesAsync();
        // 详情 action 名为 Get（见上方 [HttpGet("{id:int}")] Get）。
        return CreatedAtAction(nameof(Get), new { id = order.Id }, new { id = order.Id });
    }

    // POST /api/orders/{id}/continue-parse — 待补产品订单补上款号后，重解析原 PDF 补明细。
    [HttpPost("{id:int}/continue-parse")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> ContinueParse(int id, [FromBody] ContinueParseRequest req)
    {
        var order = await db.Orders.Include(o => o.Lines).FirstOrDefaultAsync(o => o.Id == id);
        if (order is null) return NotFound(new { error = "订单不存在" });
        if (!order.PendingProduct) return BadRequest(new { error = "该订单不是待补产品订单" });

        // 从 Remark 取回原 PDF token（去掉前缀）。
        var token = (order.Remark ?? "").StartsWith(PdfRemarkPrefix)
            ? order.Remark!.Substring(PdfRemarkPrefix.Length)
            : "";
        if (string.IsNullOrEmpty(token) || !pdf.Exists(token))
            return BadRequest(new { error = "原PDF已丢失，请手工补明细" });

        var product = await db.Products.Include(p => p.Items).ThenInclude(i => i.Parts)
            .FirstOrDefaultAsync(p => p.Id == req.ProductId && p.Status != "archived");
        if (product is null) return BadRequest(new { error = "款号不存在或已归档" });

        // 重解析原 PDF → 草稿行 → 与新款号子件匹配。
        var words = PdfWordSource.Extract(pdf.Open(token));
        var draftLines = PdfImportParse.BuildDraftLines(PdfTableExtractor.ExtractRows(words));
        var matched = PdfImportParse.MatchItems(draftLines, product.Items.Select(i => i.ItemName));

        // 命中行（MatchedItemName != null）建明细；用 ImportConfirmLine 复用 BuildLines。
        var confirmLines = matched
            .Where(m => m.MatchedItemName != null)
            .Select(m => new ImportConfirmLine(m.MatchedItemName!, m.TotalQty))
            .ToList();

        order.ProductId = product.Id;
        order.PendingProduct = false;
        // M4：补全后是正常单，清除存入 Remark 的 PDF token，不暴露给前端。
        order.Remark = null;
        order.Lines = BuildLines(confirmLines, product);
        order.LastUpdatedBy = CurrentUser();
        order.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new { id = order.Id, lines = order.Lines.Count });
    }

    // 公共：按确认行 + 产品库结构组装 OrderLine→OrderPartQty（每部位 Qty = 该子件合计）。
    private static List<OrderLine> BuildLines(IEnumerable<ImportConfirmLine> confirmLines, Product product)
    {
        var lines = new List<OrderLine>();
        int lineOrder = 0;
        foreach (var cl in confirmLines)
        {
            // 在产品库子件里按已匹配名找对应 ProductItem（容错首尾空格）。
            var item = product.Items.FirstOrDefault(i => i.ItemName.Trim() == cl.MatchedItemName.Trim());
            if (item is null) continue;   // 理论不会发生（匹配过），稳妥跳过
            lines.Add(new OrderLine
            {
                ItemName = item.ItemName,
                SourceItemId = item.Id,
                LineOrder = lineOrder++,
                // 遍历该子件每个部位，各建一条数量 = 子件合计。
                PartQtys = item.Parts.OrderBy(p => p.PartOrder).Select((part, pi) => new OrderPartQty
                {
                    PartName = part.PartName,
                    SourcePartId = part.Id,
                    Qty = cl.TotalQty,
                    PartOrder = pi,
                }).ToList()
            });
        }
        return lines;
    }
}
