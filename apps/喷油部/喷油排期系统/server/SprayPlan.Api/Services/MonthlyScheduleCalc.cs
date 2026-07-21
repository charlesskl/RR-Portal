namespace SprayPlan.Api.Services;

// 月排正排算法（纯函数，无 DB/时钟依赖）：逐天正向流水线模拟，按「拉别」算产能（每条拉一天一个池）。详见 spec §5。
public static class MonthlyScheduleCalc
{
    public record PartInput(int SourcePartId, string ItemName, string PartName, int TotalDemand,
        int DailyCapacity, int StdMachineCount, string Craft, bool IsTumbler,
        int CraftPasses, List<string> CraftSet);
    public record OrderInput(int Id, string DeliveryDate, bool IsMA, List<PartInput> Parts);
    // 拉别：DailyCapacityLimit=0 视为不卡上限
    public record LineInput(int LineId, string Name, string CraftType, int DailyCapacityLimit);
    public record PlanRow(int OrderId, int SourcePartId, string ItemName, string PartName,
        string PlanDate, int PlannedQty, int LineId, string LineName,
        int StepNo, string Craft);
    public record OverloadDay(int LineId, string LineName, string Date, int Total);
    public record Calendar(HashSet<string> OffDays, HashSet<string> OnDays);
    // 订单完工预测：CompletionDate=完工日(排不完为 null)；Status∈red|yellow|green；LateWorkdays=迟几个工作日
    public record OrderForecast(int OrderId, string? CompletionDate, string Status, int LateWorkdays);
    public record Result(
        List<PlanRow> Rows, List<int> Overdue, List<OverloadDay> OverloadedDays,
        List<int> NoDeliveryDate, List<int> MaSkipped, List<int> NoLine,
        List<OrderForecast> Forecasts);

    static bool IsWorkday(DateTime d, Calendar cal)
    {
        var ymd = ScheduleCalc.Ymd(d);
        if (cal.OnDays.Contains(ymd)) return true;
        if (cal.OffDays.Contains(ymd)) return false;
        return d.DayOfWeek != DayOfWeek.Saturday && d.DayOfWeek != DayOfWeek.Sunday;
    }
    static DateTime NextWorkday(DateTime from, Calendar cal)
    {
        for (var d = from; ; d = d.AddDays(1)) if (IsWorkday(d, cal)) return d;
    }

    // 摊道工序优先级（D2，业务方 2026-06-29）：自动喷→手喷→移印→UV。「喷油」是分类不存库。
    public static int CraftPriority(string craft) => craft switch
    {
        "自动喷" => 0, "手喷" => 1, "移印" => 2, "UV" => 3, _ => 99,
    };

    public record Pass(int StepNo, string Craft);

    // 摊道：工序集合按优先级循环摊满 craftPasses 道。单工序→重复；道数>种类数→回头循环；
    // craftPasses<=0 → 单道(首工序)；空集 → 单道("")。
    public static List<Pass> ExpandPasses(List<string> craftSet, int craftPasses)
    {
        var ordered = (craftSet ?? new List<string>())
            .Where(c => !string.IsNullOrEmpty(c)).Distinct().OrderBy(CraftPriority).ToList();
        if (ordered.Count == 0) return new List<Pass> { new(1, "") };
        if (craftPasses <= 0) return new List<Pass> { new(1, ordered[0]) };
        var result = new List<Pass>();
        for (int i = 0; i < craftPasses; i++) result.Add(new Pass(i + 1, ordered[i % ordered.Count]));
        return result;
    }

    public static Result Generate(
        IEnumerable<OrderInput> orders, IEnumerable<LineInput> lines, string today, int bufferDays, Calendar cal)
    {
        var todayD = DateUtil.ParseUtc(today);
        var lineList = lines.ToList();
        var rows = new List<PlanRow>();
        var noDue = new List<int>();
        var maSkipped = new List<int>();
        var noLine = new HashSet<int>();
        var overdue = new HashSet<int>();

        // 工艺 → 拉（每工艺取首条启用拉，沿用现状）
        var lineByCraft = new Dictionary<string, LineInput>();
        foreach (var l in lineList) if (!lineByCraft.ContainsKey(l.CraftType)) lineByCraft[l.CraftType] = l;
        lineByCraft.TryGetValue("手喷", out var handLine); // 炒货机归手喷拉

        // 拉别每天占用：(lineId, ymd) → qty（炒货机无限桶不计）
        var lineLoad = new Dictionary<(int, string), int>();
        int LoadOf(int lineId, string d) { lineLoad.TryGetValue((lineId, d), out var c); return c; }
        void AddLoad(int lineId, string d, int qty) { lineLoad.TryGetValue((lineId, d), out var c); lineLoad[(lineId, d)] = c + qty; }

        // 待排单元：每个 (订单,部位,道) 一个，可变 Done 累计产出
        var tasks = new List<PassTask>();
        var dueOf = new Dictionary<int, DateTime>();           // 订单 → 交货日
        var partLastStep = new Dictionary<(int, int), int>();  // (订单,部位) → 最大 stepNo

        foreach (var o in orders)
        {
            if (o.IsMA) { maSkipped.Add(o.Id); continue; }
            if (string.IsNullOrWhiteSpace(o.DeliveryDate)) { noDue.Add(o.Id); continue; }
            var due = DateUtil.ParseUtc(o.DeliveryDate);
            dueOf[o.Id] = due;

            foreach (var part in o.Parts)
            {
                var passes = ExpandPasses(part.CraftSet, part.CraftPasses);  // ExpandPasses 必返回≥1道
                partLastStep[(o.Id, part.SourcePartId)] = passes.Max(p => p.StepNo);

                int dailyCap = ScheduleCalc.PartDailyOutput(part.StdMachineCount, part.DailyCapacity);
                PassTask? prev = null;
                foreach (var pass in passes)
                {
                    LineInput? line; bool unlimited;
                    if (part.IsTumbler) { line = handLine; unlimited = true; }
                    else { lineByCraft.TryGetValue(pass.Craft, out line); unlimited = false; }
                    if (line is null) noLine.Add(o.Id);

                    var t = new PassTask
                    {
                        OrderId = o.Id, Due = due, SourcePartId = part.SourcePartId,
                        ItemName = part.ItemName, PartName = part.PartName,
                        StepNo = pass.StepNo, Craft = pass.Craft,
                        Line = line, Unlimited = unlimited,
                        DailyCap = dailyCap, Demand = part.TotalDemand, Done = 0, Upstream = prev,
                    };
                    tasks.Add(t);
                    prev = t;
                }
            }
        }

        // 逐天正排：从今天起按工作日推进，直到全部最后一道做满或撞安全上限
        bool AllLastDone() => tasks
            .Where(t => t.StepNo == partLastStep.GetValueOrDefault((t.OrderId, t.SourcePartId), 1))
            .All(t => t.Done >= t.Demand);

        var completion = new Dictionary<(int, int), string>(); // (订单,部位) → 完工 ymd
        var day = NextWorkday(todayD, cal);
        int safety = 0;
        const int SafetyMaxWorkdays = 600; // ≈ 2 年半工作日，防死循环

        // 调度顺序：交货日升序 → 订单号 → 部位 → stepNo升序（保证同部位上游先于下游，当天流转）。
        // 排序键均不可变（循环内只改 Done），故循环外排一次即可，避免每个工作日重排。
        var schedulable = tasks
            .Where(t => t.Line is not null)
            .OrderBy(t => t.Due).ThenBy(t => t.OrderId).ThenBy(t => t.SourcePartId).ThenBy(t => t.StepNo)
            .ToList();

        while (!AllLastDone() && safety++ < SafetyMaxWorkdays)
        {
            var ymd = ScheduleCalc.Ymd(day);
            foreach (var t in schedulable)
            {
                if (t.Done >= t.Demand) continue;
                int lineLimit = t.Line!.DailyCapacityLimit;
                int byPart = Math.Min(t.DailyCap, t.Demand - t.Done);
                if (byPart <= 0) continue;
                int byLine = (t.Unlimited || lineLimit <= 0) ? byPart : Math.Max(0, lineLimit - LoadOf(t.Line.LineId, ymd));
                int byUp = t.Upstream is null ? byPart : Math.Max(0, t.Upstream.Done - t.Done);
                int put = Math.Min(Math.Min(byPart, byLine), byUp);
                if (put <= 0) continue;

                rows.Add(new PlanRow(t.OrderId, t.SourcePartId, t.ItemName, t.PartName, ymd, put,
                    t.Line.LineId, t.Line.Name, t.StepNo, t.Craft));
                t.Done += put;
                if (!t.Unlimited) AddLoad(t.Line.LineId, ymd, put);

                // 记部位完工日（最后一道刚做满）
                if (t.StepNo == partLastStep.GetValueOrDefault((t.OrderId, t.SourcePartId), 1)
                    && t.Done >= t.Demand
                    && !completion.ContainsKey((t.OrderId, t.SourcePartId)))
                    completion[(t.OrderId, t.SourcePartId)] = ymd;
            }
            day = NextWorkday(day.AddDays(1), cal);
        }

        // 每订单：完工日 = 各部位完工日最晚；对照交货日判红黄绿
        var forecasts = new List<OrderForecast>();
        foreach (var kv in dueOf)
        {
            int oid = kv.Key; var due = kv.Value;
            var partKeys = partLastStep.Keys.Where(k => k.Item1 == oid).ToList();
            string? compYmd = null; bool incomplete = false;
            foreach (var pk in partKeys)
            {
                if (!completion.TryGetValue(pk, out var c)) { incomplete = true; continue; }
                if (compYmd is null || string.CompareOrdinal(c, compYmd) > 0) compYmd = c;
            }
            string status; int late = 0;
            if (incomplete || compYmd is null)
            {
                status = "red"; overdue.Add(oid);  // 有部位排不完 → 红，完工日留 null
            }
            else
            {
                var comp = DateUtil.ParseUtc(compYmd);
                if (comp > due) { status = "red"; late = WorkdaysBetween(due, comp, cal); overdue.Add(oid); }
                else
                {
                    // 缓冲：交货日往前数 bufferDays 个工作日，得"安全线"
                    var safe = MinusWorkdays(due, bufferDays, cal);
                    status = comp <= safe ? "green" : "yellow";
                }
            }
            forecasts.Add(new OrderForecast(oid, compYmd, status, late));
        }

        // 拉别超载：某拉某天 > 其上限（上限>0 才判）
        var meta = lineList.ToDictionary(l => l.LineId, l => l);
        var overload = lineLoad
            .Where(kv => meta.TryGetValue(kv.Key.Item1, out var li) && li.DailyCapacityLimit > 0 && kv.Value > li.DailyCapacityLimit)
            .Select(kv => new OverloadDay(kv.Key.Item1, meta[kv.Key.Item1].Name, kv.Key.Item2, kv.Value))
            .OrderBy(x => x.LineId).ThenBy(x => x.Date).ToList();

        return new Result(rows, overdue.OrderBy(x => x).ToList(), overload, noDue, maSkipped,
            noLine.OrderBy(x => x).ToList(), forecasts);
    }

    // 待排单元（可变 Done）。Generate 内部用。
    sealed class PassTask
    {
        public int OrderId; public DateTime Due; public int SourcePartId;
        public string ItemName = ""; public string PartName = "";
        public int StepNo; public string Craft = "";
        public LineInput? Line; public bool Unlimited;
        public int DailyCap; public int Demand; public int Done;
        public PassTask? Upstream;
    }

    // 两个工作日之间的工作日数（from 之后到 to，含 to 不含 from）。to<=from → 0。
    static int WorkdaysBetween(DateTime from, DateTime to, Calendar cal)
    {
        int n = 0;
        for (var d = from.AddDays(1); d <= to; d = d.AddDays(1)) if (IsWorkday(d, cal)) n++;
        return n;
    }

    // 从 due 往前数 n 个工作日的那一天（n<=0 → due 当天）
    static DateTime MinusWorkdays(DateTime due, int n, Calendar cal)
    {
        if (n <= 0) return due;
        var d = due; int counted = 0;
        while (counted < n) { d = d.AddDays(-1); if (IsWorkday(d, cal)) counted++; }
        return d;
    }
}
