using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Features.Basic;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Features.Orders;

// 订单 —— 对应现有 /api/orders + /api/orders/[id]。读=登录、写=文员主管。
// 明细仍 V2（PATCH 只改订单头/状态），创建走嵌套。
[ApiController]
[Route("api/orders")]
[Authorize]
public class OrdersController(AppDbContext db, PdfStorage pdf) : ControllerBase
{
    static readonly string[] OrderStatuses = ["draft", "received", "scheduled", "in_production", "completed", "archived"];
    const string PdfRemarkPrefix = "PDF导入:";   // 待补产品订单把 PDF token 存进 Remark，前缀固定
    string CurrentUser() => User.FindFirst("username")?.Value ?? "unknown";

    // GET /api/orders — 列表（聚合 整单总数），id 降序
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var list = await db.Orders.AsNoTracking().OrderByDescending(o => o.Id)
            .Select(o => new OrderListItem(
                o.Id, o.ExternalOrderNo, o.Product == null ? "" : o.Product.ProductNo,
                o.OrderDate, o.DeliveryDate, o.Status, o.IsMA, o.IsUrgent,
                o.PartQtys.Sum(q => q.Qty), o.PendingProduct))
            .ToListAsync();
        return Ok(list);
    }

    // GET /api/orders/overview —— 订单总览的轻量排期汇总。
    // 不加载产品库/子件/工艺属性，只读订单需求与有效计划。
    [HttpGet("overview")]
    public async Task<IActionResult> Overview()
    {
        var orders = await db.Orders
            .AsNoTracking()
            .AsSplitQuery()
            .Include(o => o.PartQtys)
            .Include(o => o.Plans.Where(p => p.DeletedAt == null))
            .OrderByDescending(o => o.Id)
            .ToListAsync();

        var result = orders.Select(o =>
        {
            var plans = o.Plans;
            var demand = o.PartQtys
                .GroupBy(q => q.PartName)
                .ToDictionary(g => g.Key, g => g.Sum(x => x.Qty));
            var recorded = plans.GroupBy(p => p.PartName)
                .ToDictionary(g => g.Key, g => g.Sum(p => p.GoodQty ?? 0));
            // 订单数量按部件级口径：同一订单各部件通常数量相同，不能再把所有部件相加。
            var demandQty = demand.Count == 0 ? 0 : demand.Values.Max();

            // 一个部件完成全部工序才算成品；每个部件取各工序累计实绩的最小值，
            // 整单成品数再取所有部件的最小值。
            var finishedByPart = demand.Select(x =>
            {
                var stepTotals = plans
                    .Where(p => p.PartName == x.Key)
                    .GroupBy(p => p.StepNo)
                    .Select(g => g.Sum(p => p.GoodQty ?? 0))
                    .ToList();
                return stepTotals.Count == 0 ? 0 : Math.Min(x.Value, stepTotals.Min());
            }).ToList();
            var recordedQty = finishedByPart.Count == 0 ? 0 : finishedByPart.Min();
            var progressPct = demandQty > 0 ? Math.Min(100, (int)Math.Round(recordedQty * 100.0 / demandQty)) : 0;

            string? finishDate = null;
            var covered = demand.Count > 0 && plans.Count > 0;
            foreach (var (key, required) in demand)
            {
                DateTime? partFinish = null;
                var partPlans = plans.Where(p => p.PartName == key).ToList();
                foreach (var step in partPlans.GroupBy(p => p.StepNo))
                {
                    var cumulative = 0;
                    DateTime? stepFinish = null;
                    foreach (var plan in step.OrderBy(p => p.PlanDate))
                    {
                        cumulative += plan.PlannedQty;
                        if (cumulative >= required) { stepFinish = plan.PlanDate; break; }
                    }
                    if (stepFinish is null) { covered = false; partFinish = null; break; }
                    if (partFinish is null || stepFinish > partFinish) partFinish = stepFinish;
                }
                if (partFinish is null) { covered = false; finishDate = null; break; }
                var ymd = ScheduleCalc.Ymd(partFinish.Value);
                if (finishDate is null || string.CompareOrdinal(ymd, finishDate) > 0) finishDate = ymd;
            }

            var productionDays = plans.Select(p => p.PlanDate.Date).Distinct().Count();
            return new OrderOverviewSummary(
                o.Id, plans.Count > 0,
                plans.Count == 0 ? null : ScheduleCalc.Ymd(plans.Min(p => p.PlanDate)),
                covered ? finishDate : null, covered,
                plans.Sum(p => p.PlannedQty), recordedQty, demandQty, progressPct,
                productionDays, recordedQty, Math.Max(0, demandQty - recordedQty));
        }).ToList();
        return Ok(result);
    }

    // GET /api/orders/{id} — 详情（含 lines→partQtys + 引用产品的部位基础价）
    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var order = await db.Orders.Where(o => o.Id == id).AsSplitQuery()
            .Select(o => new OrderDetail(
                o.Id, o.ExternalOrderNo, o.ProductId, o.OrderDate, o.DeliveryDate,
                o.Status, o.IsMA, o.IsUrgent, o.Remark, o.CreatedBy,
                o.Product == null ? null : new OrderProductDto(o.Product.Id, o.Product.ProductNo,
                    o.Product.Parts.OrderBy(p => p.PartOrder).Select(p => new OrderProductPartDto(p.Id, p.PartName, p.UnitCost, p.LaborPrice, p.PaintCost, p.QuotedPrice)).ToList()),
                o.PartQtys.OrderBy(q => q.PartOrder).Select(q => new OrderPartQtyDto(q.Id, q.PartName, q.SourcePartId, q.Qty, q.PartOrder)).ToList(),
                // 数量可改 = 已接单 且 无未删排期计划（与 PATCH 校验同口径）
                (o.Status == "draft" || o.Status == "received") && !o.Plans.Any(p => p.DeletedAt == null)))
            .FirstOrDefaultAsync();
        if (order is null) return NotFound(new { error = "订单不存在" });
        return Ok(order);
    }

    [HttpGet("{id:int}/actuals-summary")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> ActualsSummary(int id)
    {
        if (!await db.Orders.AnyAsync(o => o.Id == id))
            return NotFound(new { error = "订单不存在" });

        var rows = await db.ProductionPlans
            .Where(p => p.OrderId == id && p.DeletedAt == null &&
                (p.GoodQty != null || p.InboundQty != null))
            .AsNoTracking()
            .ToListAsync();
        var days = rows
            .GroupBy(p => p.PlanDate.Date)
            .OrderByDescending(g => g.Key)
            .Select(g => new ActualsDaySummary(
                ScheduleCalc.Ymd(g.Key),
                g.Sum(p => p.GoodQty ?? 0),
                g.Sum(p => p.InboundQty ?? 0)))
            .ToList();
        return Ok(new OrderActualsSummary(id, days.Sum(d => d.ProductionQty), days.Sum(d => d.InboundQty), days));
    }

    [HttpPost("{id:int}/revoke-actuals")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> RevokeActuals(int id, [FromBody] RevokeActualsRequest req)
    {
        var scope = (req.Scope ?? "").Trim().ToLowerInvariant();
        if (scope is not ("day" or "all"))
            return BadRequest(new { error = "撤销范围必须是当天或全部" });
        DateTime? selectedDate = null;
        if (scope == "day")
        {
            if (string.IsNullOrWhiteSpace(req.Date))
                return BadRequest(new { error = "请选择要撤销的实绩日期" });
            selectedDate = DateUtil.ParseUtc(req.Date).Date;
        }

        var order = await db.Orders.Include(o => o.PartQtys).FirstOrDefaultAsync(o => o.Id == id);
        if (order is null) return NotFound(new { error = "订单不存在" });
        var allPlans = await db.ProductionPlans
            .Where(p => p.OrderId == id && p.DeletedAt == null)
            .ToListAsync();
        var targets = allPlans
            .Where(p => (p.GoodQty != null || p.InboundQty != null) &&
                (selectedDate == null || p.PlanDate.Date == selectedDate.Value))
            .ToList();
        if (targets.Count == 0)
            return BadRequest(new { error = "所选范围内没有可撤销的实绩" });

        var productionQty = targets.Sum(p => p.GoodQty ?? 0);
        var inboundQty = targets.Sum(p => p.InboundQty ?? 0);
        var now = DateTime.UtcNow;
        var by = CurrentUser();
        foreach (var plan in targets)
        {
            var history = ParsePlanHistory(plan.ModificationHistory);
            history.Add(new
            {
                action = "revoke_actuals",
                scope,
                productionQty = plan.GoodQty ?? 0,
                inboundQty = plan.InboundQty ?? 0,
                by,
                at = now.ToString("o")
            });
            plan.ModificationHistory = System.Text.Json.JsonSerializer.Serialize(history);
            plan.GoodQty = null;
            plan.InboundQty = null;
            plan.ReportedQty = null;
            plan.DefectQty = 0;
            plan.ProductionValue = 0;
            plan.Status = "planned";
            plan.Remark = null;
            plan.LastModifiedBy = by;
            plan.LastModifiedAt = now;
        }

        var remainingActuals = allPlans.Any(p => p.GoodQty != null || p.InboundQty != null);
        if (!remainingActuals)
        {
            order.Status = allPlans.Count > 0 ? "scheduled" : "received";
        }
        else
        {
            var completedByPart = order.PartQtys.Select(part =>
            {
                var stepTotals = allPlans.Where(p => p.PartName == part.PartName)
                    .GroupBy(p => p.StepNo)
                    .Select(g => g.Sum(p => p.GoodQty ?? 0))
                    .ToList();
                return stepTotals.Count > 0 && stepTotals.Min() >= part.Qty;
            }).ToList();
            order.Status = completedByPart.Count > 0 && completedByPart.All(x => x)
                ? "completed"
                : "in_production";
        }
        order.LastUpdatedBy = by;
        order.UpdatedAt = now;

        // 库存是由实绩和库存流水共同派生的。撤销实绩时必须同时移除该订单产生/消耗的
        // 流水，否则实绩已经清空，库存页仍会因流水键残留而显示该货号。
        var inventoryMoves = await db.InventoryMoves
            .Where(move => move.OwnerOrderId == id || move.RefOrderId == id)
            .Where(move => selectedDate == null || move.CreatedAt.Date == selectedDate.Value)
            .ToListAsync();
        db.InventoryMoves.RemoveRange(inventoryMoves);

        await db.SaveChangesAsync();
        return Ok(new RevokeActualsResult(targets.Count, productionQty, inboundQty, order.Status));
    }

    static List<object> ParsePlanHistory(string value)
    {
        try
        {
            var rows = System.Text.Json.JsonSerializer.Deserialize<List<System.Text.Json.JsonElement>>(value);
            return rows is null ? new() : rows.Cast<object>().ToList();
        }
        catch { return new(); }
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
        var partQtys = req.PartQtys ?? new();
        var order = new Order
        {
            ExternalOrderNo = req.ExternalOrderNo, ProductId = req.ProductId.Value,
            OrderDate = string.IsNullOrEmpty(req.OrderDate) ? now : DateUtil.ParseUtc(req.OrderDate),
            DeliveryDate = string.IsNullOrEmpty(req.DeliveryDate) ? null : DateUtil.ParseUtc(req.DeliveryDate),
            Status = "draft", IsMA = req.IsMA ?? false, IsUrgent = req.IsUrgent ?? false, Remark = req.Remark,
            CreatedBy = CurrentUser(), CreatedAt = now, UpdatedAt = now,
            PartQtys = partQtys.Select((q, qi) => new OrderPartQty
            {
                PartName = q.PartName ?? "", SourcePartId = q.SourcePartId, Qty = q.Qty ?? 0, PartOrder = q.PartOrder ?? qi,
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
        if (req.PartQtys is not null && req.PartQtys.Count > 0)
        {
            if (o.Status is not ("draft" or "received"))
                return BadRequest(new { error = "订单已进入排期/生产，数量不可修改" });
            bool hasPlan = await db.ProductionPlans.AnyAsync(p => p.OrderId == id && p.DeletedAt == null);
            if (hasPlan)
                return BadRequest(new { error = "订单已有排期计划，数量不可修改" });

            // 按 partQty 主键 id 更新数量（只认属于本订单的明细，防越权改他单）
            var qtyMap = req.PartQtys.ToDictionary(q => q.Id, q => q.Qty);
            if (qtyMap.Count > 0)
            {
                var partQtys = await db.OrderPartQtys
                    .Where(q => q.OrderId == id && qtyMap.Keys.Contains(q.Id))
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

    // DELETE /api/orders/recycle-bin — 永久清空订单回收站（主管专属）
    [HttpDelete("recycle-bin")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> EmptyRecycleBin()
    {
        var orders = await db.Orders.Where(order => order.Status == "archived").ToListAsync();
        if (orders.Count == 0) return Ok(new { deleted = 0 });

        var ids = orders.Select(order => order.Id).ToList();
        var plans = await db.ProductionPlans.Where(plan => ids.Contains(plan.OrderId)).ToListAsync();
        var moves = await db.InventoryMoves
            .Where(move => (move.OwnerOrderId != null && ids.Contains(move.OwnerOrderId.Value)) ||
                           (move.RefOrderId != null && ids.Contains(move.RefOrderId.Value)))
            .ToListAsync();
        var partQtys = await db.OrderPartQtys.Where(part => ids.Contains(part.OrderId)).ToListAsync();

        await using var transaction = await db.Database.BeginTransactionAsync();
        db.InventoryMoves.RemoveRange(moves);
        db.ProductionPlans.RemoveRange(plans);
        db.OrderPartQtys.RemoveRange(partQtys);
        db.Orders.RemoveRange(orders);
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Ok(new { deleted = orders.Count });
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
        var product = await db.Products.Include(p => p.Parts)
            .FirstOrDefaultAsync(p => p.ProductNo == pm.ProductNo && p.Status != "archived");

        if (product is null)
        {
            var newLines = draftLines.Select(line => new ImportDraftLine(
                line.PdfItemName, line.TotalQty, line.MergedRows, line.NormalizedName,
                line.UnitPrice, ExistingUnitCost: null)).ToList();
            return Ok(new ImportDraft(head, ProductFound: false, ProductId: null, Lines: newLines, PdfToken: token, AvailableItems: new()));
        }

        // 命中 → 把草稿行与产品库子件名精确匹配（绿/红）。
        var availableParts = product.Parts.Select(p => p.PartName).Distinct().ToList();
        var matched = PdfImportParse.MatchItems(draftLines, availableParts);
        var lines = matched.Select(m => new ImportDraftLine(m.PdfItemName, m.TotalQty, m.MergedRows, m.MatchedItemName,
            m.UnitPrice, product.Parts.FirstOrDefault(part => part.PartName.Trim() == m.MatchedItemName?.Trim())?.UnitCost)).ToList();
        // 该货号下全部子件名，供前端红行下拉手工选。
        var availableItems = availableParts;
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
            Status = "draft",
            CreatedBy = CurrentUser(), CreatedAt = now, UpdatedAt = now,
            // 只有待补产品单才存 PDF token，正常单 Remark 留 null。
            // continue-parse 读 token 时只处理待补产品单，无副作用。
            Remark = req.AsPendingProduct ? PdfRemarkPrefix + req.PdfToken : null,
        };

        if (req.AsPendingProduct && !req.SavePricing)
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

            var product = await db.Products.Include(p => p.Parts)
                .FirstOrDefaultAsync(p => p.ProductNo == req.Head.ProductNo && p.Status != "archived");
            if (product is null)
            {
                if (!req.SavePricing) return BadRequest(new { error = "款号不存在，请选择保存订单核价" });
                product = new Product
                {
                    ProductNo = req.Head.ProductNo.Trim(), IterationNo = "V1", Status = "draft",
                    CreatedBy = CurrentUser(), CreatedAt = now, UpdatedAt = now,
                    Parts = req.Lines.Select((line, index) => new ProductPart
                    {
                        PartName = line.MatchedItemName.Trim(), PartOrder = index,
                        UnitCost = Math.Max(0, line.UnitPrice), PartGroupId = 0,
                    }).ToList(),
                };
                db.Products.Add(product);
                await db.SaveChangesAsync();
                PartProcessRules.AssignGroupIds(product.Parts);
            }
            else if (req.SavePricing)
            {
                foreach (var line in req.Lines)
                {
                    var part = product.Parts.FirstOrDefault(p => p.PartName.Trim() == line.MatchedItemName.Trim());
                    if (part is not null && line.UnitPrice >= 0) part.UnitCost = line.UnitPrice;
                }
            }

            order.ProductId = product.Id;
            order.PartQtys = BuildPartQtys(req.Lines, product);
            order.PendingProduct = false;
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
        var order = await db.Orders.Include(o => o.PartQtys).FirstOrDefaultAsync(o => o.Id == id);
        if (order is null) return NotFound(new { error = "订单不存在" });
        if (!order.PendingProduct) return BadRequest(new { error = "该订单不是待补产品订单" });

        // 从 Remark 取回原 PDF token（去掉前缀）。
        var token = (order.Remark ?? "").StartsWith(PdfRemarkPrefix)
            ? order.Remark!.Substring(PdfRemarkPrefix.Length)
            : "";
        if (string.IsNullOrEmpty(token) || !pdf.Exists(token))
            return BadRequest(new { error = "原PDF已丢失，请手工补明细" });

        var product = await db.Products.Include(p => p.Parts)
            .FirstOrDefaultAsync(p => p.Id == req.ProductId && p.Status != "archived");
        if (product is null) return BadRequest(new { error = "款号不存在或已归档" });

        // 重解析原 PDF → 草稿行 → 与新款号子件匹配。
        var words = PdfWordSource.Extract(pdf.Open(token));
        var draftLines = PdfImportParse.BuildDraftLines(PdfTableExtractor.ExtractRows(words));
        var matched = PdfImportParse.MatchItems(draftLines,
            product.Parts.Select(p => p.PartName).Distinct());

        // 命中行（MatchedItemName != null）建明细；用 ImportConfirmLine 复用 BuildLines。
        var confirmLines = matched
            .Where(m => m.MatchedItemName != null)
            .Select(m => new ImportConfirmLine(m.MatchedItemName!, m.TotalQty))
            .ToList();

        order.ProductId = product.Id;
        order.PendingProduct = false;
        // M4：补全后是正常单，清除存入 Remark 的 PDF token，不暴露给前端。
        order.Remark = null;
        order.PartQtys = BuildPartQtys(confirmLines, product);
        order.LastUpdatedBy = CurrentUser();
        order.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new { id = order.Id, partQtys = order.PartQtys.Count });
    }

    // 公共：按确认行与产品部位组装订单部位数量。
    private static List<OrderPartQty> BuildPartQtys(IEnumerable<ImportConfirmLine> confirmLines, Product product)
    {
        var partQtys = new List<OrderPartQty>();
        int partOrder = 0;
        foreach (var cl in confirmLines)
        {
            // 在产品部位中按已匹配名称查找对应记录（容错首尾空格）。
            var matchedPart = product.Parts.FirstOrDefault(p => p.PartName.Trim() == cl.MatchedItemName.Trim());
            if (matchedPart is null) continue;
            partQtys.Add(new OrderPartQty
            {
                PartName = matchedPart.PartName,
                SourcePartId = matchedPart.Id,
                Qty = cl.TotalQty,
                PartOrder = partOrder++,
            });
        }
        return partQtys;
    }

    [HttpPost("{id:int}/process-schedule")]
    [Authorize(Roles = "clerk,admin")]
    public async Task<IActionResult> CreateProcessSchedule(int id, [FromBody] CreateOrderProcessScheduleRequest req)
    {
        var rows = req.Rows ?? [];
        if (rows.Count == 0) return BadRequest(new { error = "请至少填写一道工序" });
        if (rows.Any(row => string.IsNullOrWhiteSpace(row.StartDate) || string.IsNullOrWhiteSpace(row.Craft) || row.DailyTarget is null or <= 0))
            return BadRequest(new { error = "开始日期、工序和每日目标数必须填写完整" });
        if (rows.Any(row => !CraftTypes.IsValid(row.Craft!.Trim())))
            return BadRequest(new { error = "工序无效（手喷/移印/自动喷/UV）" });

        var order = await db.Orders
            .Include(o => o.PartQtys)
            .Include(o => o.Product!).ThenInclude(product => product.Parts)
            .FirstOrDefaultAsync(o => o.Id == id);
        if (order is null) return NotFound(new { error = "订单不存在" });
        if (order.PendingProduct || order.Product is null)
            return BadRequest(new { error = "该订单尚未关联产品核价，请先补全产品" });
        if (order.Status is not ("draft" or "received")) return BadRequest(new { error = "只有草稿或已接单订单可以生成工序排期" });
        if (await db.ProductionPlans.AnyAsync(plan => plan.OrderId == id && plan.DeletedAt == null))
            return BadRequest(new { error = "该订单已有生产计划，请先撤销原排期后再重新生成" });
        if (order.PartQtys.Count == 0) return BadRequest(new { error = "订单没有部位数量，无法生成排期" });
        if (req.PartQtys is not null)
        {
            var qtyUpdates = req.PartQtys.ToDictionary(item => item.Id, item => item.Qty);
            if (qtyUpdates.Keys.Any(idValue => order.PartQtys.All(part => part.Id != idValue)))
                return BadRequest(new { error = "订单数量明细已变化，请刷新页面后重试" });
            foreach (var part in order.PartQtys)
                if (qtyUpdates.TryGetValue(part.Id, out var qty)) part.Qty = Math.Max(0, qty);
        }
        if (order.PartQtys.All(part => part.Qty <= 0)) return BadRequest(new { error = "订单至少需要一个数量大于 0 的部位" });
        var unknownPartQtyId = rows.FirstOrDefault(row => row.PartQtyId is not null && order.PartQtys.All(part => part.Id != row.PartQtyId));
        if (unknownPartQtyId is not null)
            return BadRequest(new { error = "排期中的部位不属于该订单，请刷新页面后重试" });

        var lines = await db.ProductionLines.Where(line => line.IsActive).OrderBy(line => line.Id).ToListAsync();
        var now = DateTime.UtcNow;
        var by = CurrentUser();
        var plans = new List<ProductionPlan>();

        // 排期备注同时沉淀为部位级核价规则：首道工序复用订单导入生成的空工序行，
        // 后续工序新增同一逻辑部位的规则行，价格字段保持为 0，避免重复累计订单核价。
        foreach (var orderedPart in order.PartQtys.Where(part => part.Qty > 0))
        {
            var partRows = rows.Where(row => row.PartQtyId is null || row.PartQtyId == orderedPart.Id).ToList();
            if (partRows.Count == 0) continue;
            var anchor = order.Product.Parts.FirstOrDefault(part => part.Id == orderedPart.SourcePartId)
                ?? order.Product.Parts.FirstOrDefault(part => PartProcessRules.NameKey(part.PartName) == PartProcessRules.NameKey(orderedPart.PartName));
            if (anchor is null)
                return BadRequest(new { error = $"核价表中找不到部位“{orderedPart.PartName}”，请先补全产品核价" });

            var siblings = PartProcessRules.SameLogicalPart(order.Product.Parts, anchor);
            var groupId = anchor.PartGroupId > 0 ? anchor.PartGroupId : anchor.Id;
            foreach (var row in partRows)
            {
                var craft = row.Craft!.Trim();
                var rule = siblings.FirstOrDefault(part => part.Craft.Trim() == craft);
                if (rule is null)
                {
                    rule = siblings.FirstOrDefault(part => string.IsNullOrWhiteSpace(part.Craft));
                    if (rule is null)
                    {
                        rule = new ProductPart
                        {
                            ProductId = order.Product.Id,
                            PartGroupId = groupId,
                            PartName = anchor.PartName,
                            PartOrder = order.Product.Parts.Select(part => part.PartOrder).DefaultIfEmpty(-1).Max() + 1,
                            ProductionMode = anchor.ProductionMode,
                            StdMachineCount = anchor.StdMachineCount,
                        };
                        order.Product.Parts.Add(rule);
                        siblings.Add(rule);
                    }
                }
                rule.Craft = craft;
                rule.DailyCapacity = row.DailyTarget!.Value;
            }

            var passCount = siblings.Select(part => part.Craft.Trim()).Where(craft => craft.Length > 0).Distinct().Count();
            foreach (var sibling in siblings) sibling.CraftPasses = passCount;
        }
        order.Product.LastUpdatedBy = by;
        order.Product.UpdatedAt = now;
        foreach (var (row, rowIndex) in rows.Select((value, index) => (value, index)))
        {
            var stepNo = rows.Take(rowIndex + 1).Count(previous => previous.PartQtyId == row.PartQtyId);
            var craft = row.Craft!.Trim();
            var line = lines.FirstOrDefault(candidate => candidate.CraftType == craft);
            if (line is null) return BadRequest(new { error = $"基础数据库中没有启用的“{craft}”拉别" });
            var start = DateUtil.ParseUtc(row.StartDate!);
            var dailyTarget = row.DailyTarget!.Value;
            var scheduledParts = order.PartQtys.Where(part => part.Qty > 0 && (row.PartQtyId is null || row.PartQtyId == part.Id));
            foreach (var part in scheduledParts)
            {
                var remaining = part.Qty;
                var day = start;
                while (remaining > 0)
                {
                    var qty = Math.Min(dailyTarget, remaining);
                    plans.Add(new ProductionPlan
                    {
                        PlanDate = day, PlanType = "daily", LineId = line.Id, OrderId = order.Id,
                        ItemName = "", PartName = part.PartName, SourcePartId = part.SourcePartId,
                        PlannedQty = qty, WorkerCount = 1, StepNo = stepNo, Craft = craft,
                        MachineNos = "[]", Status = "planned", CreatedBy = by, CreatedAt = now,
                        LastModifiedAt = now, ModificationHistory = "[]",
                    });
                    remaining -= qty;
                    day = day.AddDays(1);
                }
            }
        }

        db.ProductionPlans.AddRange(plans);
        order.Status = "scheduled";
        order.LastUpdatedBy = by;
        order.UpdatedAt = now;
        await db.SaveChangesAsync();
        return StatusCode(201, new CreateOrderProcessScheduleResult(plans.Count,
            plans.Count == 0 ? null : ScheduleCalc.Ymd(plans.Min(plan => plan.PlanDate)),
            plans.Count == 0 ? null : ScheduleCalc.Ymd(plans.Max(plan => plan.PlanDate))));
    }
}
