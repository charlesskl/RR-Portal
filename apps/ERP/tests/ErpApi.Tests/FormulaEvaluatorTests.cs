using System.Linq;
using ErpApi.Features.Payroll;
using Xunit;

public class FormulaEvaluatorTests
{
    private static decimal Eval(string f, params (string, decimal)[] vars)
        => FormulaEvaluator.Evaluate(f, vars.ToDictionary(x => x.Item1, x => x.Item2));

    [Fact] public void 四则与优先级() { Assert.Equal(14m, Eval("2+3*4")); Assert.Equal(20m, Eval("(2+3)*4")); }
    [Fact] public void 减除一元负() { Assert.Equal(2m, Eval("10/5")); Assert.Equal(-3m, Eval("-3")); Assert.Equal(7m, Eval("10-3")); }
    [Fact] public void 中文变量() { Assert.Equal(1500m, Eval("基本工资+计件工资", ("基本工资",1000m), ("计件工资",500m))); }
    [Fact] public void 变量与运算() { Assert.Equal(200m, Eval("实出勤天数/应出勤天数*基本工资", ("实出勤天数",20m), ("应出勤天数",25m), ("基本工资",250m))); }
    [Fact] public void 空公式为0() { Assert.Equal(0m, Eval("")); Assert.Equal(0m, FormulaEvaluator.Evaluate(null, new Dictionary<string,decimal>())); }
    [Fact] public void 未知变量抛错() { Assert.Throws<FormulaException>(() => Eval("社保费", ("基本工资",1000m))); }
    [Fact] public void 除零抛错() { Assert.Throws<FormulaException>(() => Eval("基本工资/缺勤", ("基本工资",1000m), ("缺勤",0m))); }
    [Fact] public void 括号不匹配抛错() { Assert.Throws<FormulaException>(() => Eval("(2+3")); }
}
