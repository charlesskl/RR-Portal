using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Payroll;

// 工资表生成（整合 P7a 计件归集 / P7b 出勤 / P7c 模板公式）：
// 按 月份+部门+模板 快照模板公式 → 工资表项目公式([ZGnn]列名) → 逐员工按序号求值各台头项目 →
// 写 工资明细表(动态 ZG 列) + 汇总 工资总表。可重算(按月份+部门删旧)，不做审核，零改表。
// FormulaException 不在此 catch（由控制器转 400）。
public sealed class PayrollService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    private sealed class TemplateItem
    {
        public int 序号 { get; set; }
        public string? 台头项目 { get; set; }
        public string? 类型 { get; set; }
        public string? 公式 { get; set; }
        public string 列名 { get; set; } = "";
    }

    public async Task<string> GenerateAsync(PayrollGenerateDto dto, string user)
    {
        // 1. 解析月份
        var 月份 = (dto.月份 ?? "").Trim();
        if (月份.Length != 6 || !int.TryParse(月份, out _))
            throw new ArgumentException("月份须为 6 位 yyyyMM。");
        var y = int.Parse(月份[..4]); var m = int.Parse(月份[4..]);
        if (m < 1 || m > 12) throw new ArgumentException("月份的月份段须在 01–12 之间。");
        var 部门编号 = (dto.部门编号 ?? "").Trim();
        var 模板编号 = (dto.模板编号 ?? "").Trim();
        if (string.IsNullOrEmpty(部门编号)) throw new ArgumentException("部门编号必填");
        if (string.IsNullOrEmpty(模板编号)) throw new ArgumentException("模板编号必填");
        var 月初 = new DateTime(y, m, 1);
        var 下月初 = 月初.AddMonths(1);
        var 月末 = 下月初.AddDays(-1);
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();

        // 2. 载入模板项目（公式取模板级 部门编号 IS NULL）
        var items = (await c.QueryAsync<TemplateItem>(@"
SELECT CAST(i.[序号] AS int) AS 序号, i.[台头项目], i.[类型], f.[公式]
FROM [工资模板项目] i
LEFT JOIN [工资模板公式] f ON f.[模板编号]=i.[模板编号] AND f.[台头项目]=i.[台头项目] AND f.[部门编号] IS NULL
WHERE i.[模板编号]=@模板编号 ORDER BY i.[序号];", new { 模板编号 })).AsList();
        if (items.Count == 0) throw new ArgumentException("模板不存在或无工资项");
        if (items.Count > 46) throw new ArgumentException("工资项超过46个上限");
        for (var idx = 0; idx < items.Count; idx++)
            items[idx].列名 = $"ZG{idx + 1:00}";

        using var tx = c.BeginTransaction();

        // 3. 可重算删旧
        await c.ExecuteAsync("DELETE FROM [工资明细表] WHERE [月份]=@月份 AND [部门编号]=@部门编号", new { 月份, 部门编号 }, tx);
        await c.ExecuteAsync("DELETE FROM [工资总表] WHERE [月份]=@月份 AND [部门编号]=@部门编号", new { 月份, 部门编号 }, tx);
        await c.ExecuteAsync("DELETE FROM [工资表项目公式] WHERE [月份]=@月份 AND [部门编号]=@部门编号", new { 月份, 部门编号 }, tx);

        // 4. 工资表编号
        var 工资表编号 = await docNo.NextAsync("工资总表", "GZ", now, c, tx);

        // 5. 快照模板公式
        foreach (var it in items)
            await c.ExecuteAsync(@"
INSERT INTO [工资表项目公式]([工资表编号],[月份],[部门编号],[台头项目],[类型],[公式],[列名])
VALUES(@工资表编号,@月份,@部门编号,@台头项目,@类型,@公式,@列名)",
                new { 工资表编号, 月份, 部门编号, it.台头项目, it.类型, it.公式, it.列名 }, tx);

        // 部门名（明细表 [部门] 列，查一次）
        var 部门 = await c.ExecuteScalarAsync<string?>(
            "SELECT [部门] FROM [部门信息] WHERE [编号]=@部门编号", new { 部门编号 }, tx);

        // 6. 在职员工
        var emps = (await c.QueryAsync(@"
SELECT [编号], [姓名], [职称], ISNULL([基本工资],0) AS 基本工资
FROM [人事档案] WHERE ISNULL([在职],'1')='1' AND [部门编号]=@部门编号", new { 部门编号 }, tx)).AsList();

        // 7. 计件工资字典
        var 计件 = (await c.QueryAsync(@"
SELECT [员工号], SUM(ISNULL([金额],0)) AS 计件
FROM [计件表]
WHERE ISNULL([审核],'0')='1' AND ISNULL([有效],'1')<>'0' AND [日期]>=@月初 AND [日期]<@下月初
GROUP BY [员工号]", new { 月初, 下月初 }, tx))
            .ToDictionary(r => (string)r.员工号, r => (decimal)r.计件);

        // 8. 缺勤天数字典
        var 缺勤 = (await c.QueryAsync(@"
SELECT [工号], ISNULL(SUM(TRY_CONVERT(decimal(18,4),[计算出勤])),0) AS 缺勤
FROM [b缺勤登记明细]
WHERE [日期]>=@月初 AND [日期]<@下月初
GROUP BY [工号]", new { 月初, 下月初 }, tx))
            .ToDictionary(r => (string)r.工号, r => (decimal)r.缺勤);

        // 8b. 日报(刷卡)月聚合字典:出勤工时/加班工时/迟到次数/早退次数
        // 注:迟到次数/早退次数为 int 列,SUM 经驱动可能呈现为 int 或 long,统一用 Convert.ToDecimal 防类型意外。
        var 日报 = (await c.QueryAsync(@"
SELECT [工号],
       ISNULL(SUM(CAST([合计时间] AS decimal(18,4))),0) AS 出勤工时,
       ISNULL(SUM(CAST([加班] AS decimal(18,4))),0)     AS 加班工时,
       ISNULL(SUM(ISNULL([迟到次数],0)),0)              AS 迟到次数,
       ISNULL(SUM(ISNULL([早退次数],0)),0)              AS 早退次数
FROM [日报表] WHERE [日期]>=@月初 AND [日期]<@下月初 GROUP BY [工号]", new { 月初, 下月初 }, tx))
            .ToDictionary(r => (string)r.工号, r => (
                出勤工时: (decimal)Convert.ToDecimal(r.出勤工时),
                加班工时: (decimal)Convert.ToDecimal(r.加班工时),
                迟到次数: (decimal)Convert.ToDecimal(r.迟到次数),
                早退次数: (decimal)Convert.ToDecimal(r.早退次数)));

        // 动态 INSERT 工资明细表 的列名片段（列名内部生成，安全）
        var zgCols = string.Concat(items.Select(it => $",[{it.列名}]"));
        var zgParams = string.Concat(items.Select(it => $",@{it.列名}"));
        var insertSql = $@"
INSERT INTO [工资明细表]([工资表编号],[月份],[编号],[姓名],[部门编号],[部门],[职称],[基本工资],[计件工资],[应发合计],[应扣合计],[实发合计]{zgCols})
VALUES(@工资表编号,@月份,@编号,@姓名,@部门编号,@部门,@职称,@基本工资,@计件工资,@应发合计,@应扣合计,@实发合计{zgParams})";

        decimal 总基本 = 0, 总计件 = 0, 总应发 = 0, 总应扣 = 0, 总实发 = 0;

        // 9. 逐员工求值
        foreach (var e in emps)
        {
            string 编号 = e.编号;
            decimal 基本工资 = e.基本工资;
            decimal 计件工资 = 计件.TryGetValue(编号, out var jv) ? jv : 0m;
            decimal 缺勤天数 = 缺勤.TryGetValue(编号, out var qv) ? qv : 0m;
            decimal 实出勤天数 = dto.应出勤天数 - 缺勤天数;

            var vars = new Dictionary<string, decimal>
            {
                ["基本工资"] = 基本工资,
                ["计件工资"] = 计件工资,
                ["应出勤天数"] = dto.应出勤天数,
                ["缺勤天数"] = 缺勤天数,
                ["实出勤天数"] = 实出勤天数,
            };

            var 日 = 日报.TryGetValue(编号, out var dv) ? dv : default;
            vars["加班工时"] = 日.加班工时;
            vars["出勤工时"] = 日.出勤工时;
            vars["迟到次数"] = 日.迟到次数;
            vars["早退次数"] = 日.早退次数;

            decimal 应发合计 = 0, 应扣合计 = 0;
            var p = new DynamicParameters();
            p.Add("工资表编号", 工资表编号);
            p.Add("月份", 月份);
            p.Add("编号", 编号);
            p.Add("姓名", (string?)e.姓名);
            p.Add("部门编号", 部门编号);
            p.Add("部门", 部门);
            p.Add("职称", (string?)e.职称);
            p.Add("基本工资", 基本工资);
            p.Add("计件工资", 计件工资);

            foreach (var it in items)
            {
                var 值 = FormulaEvaluator.Evaluate(it.公式, vars);
                if (it.台头项目 is { } name) vars[name] = 值;
                p.Add(it.列名, 值);
                if (it.类型 == "应发") 应发合计 += 值;
                else if (it.类型 == "应扣") 应扣合计 += 值;
            }
            var 实发合计 = 应发合计 - 应扣合计;
            p.Add("应发合计", 应发合计);
            p.Add("应扣合计", 应扣合计);
            p.Add("实发合计", 实发合计);

            await c.ExecuteAsync(insertSql, p, tx);

            总基本 += 基本工资; 总计件 += 计件工资;
            总应发 += 应发合计; 总应扣 += 应扣合计; 总实发 += 实发合计;
        }

        // 10. 工资总表
        await c.ExecuteAsync(@"
INSERT INTO [工资总表]([工资表编号],[月份],[部门编号],[模板编号],[开始日期],[结束日期],[审核],[操作员],[基本工资],[计件工资],[应发合计],[应扣合计],[实发合计])
VALUES(@工资表编号,@月份,@部门编号,@模板编号,@开始日期,@结束日期,'0',@操作员,@基本工资,@计件工资,@应发合计,@应扣合计,@实发合计)",
            new { 工资表编号, 月份, 部门编号, 模板编号, 开始日期 = 月初, 结束日期 = 月末, 操作员 = user, 基本工资 = 总基本, 计件工资 = 总计件, 应发合计 = 总应发, 应扣合计 = 总应扣, 实发合计 = 总实发 }, tx);

        tx.Commit();
        return 工资表编号;
    }

    // 反生成：删 工资明细表/工资总表/工资表项目公式。返回 工资总表 受影响行数(0=不存在)。
    public async Task<int> DeleteAsync(string 工资表编号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        await c.ExecuteAsync("DELETE FROM [工资明细表] WHERE [工资表编号]=@工资表编号", new { 工资表编号 }, tx);
        await c.ExecuteAsync("DELETE FROM [工资表项目公式] WHERE [工资表编号]=@工资表编号", new { 工资表编号 }, tx);
        var n = await c.ExecuteAsync("DELETE FROM [工资总表] WHERE [工资表编号]=@工资表编号", new { 工资表编号 }, tx);
        tx.Commit();
        return n;
    }
}
