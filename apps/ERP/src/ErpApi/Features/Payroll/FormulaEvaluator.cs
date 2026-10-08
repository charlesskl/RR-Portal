using System.Globalization;
namespace ErpApi.Features.Payroll;

public sealed class FormulaException(string message) : Exception(message);

// 简易工资公式求值器：+ - * / ( )、十进制字面量、变量(中文台头项目/内置)。无第三方依赖。
public static class FormulaEvaluator
{
    public static decimal Evaluate(string? formula, IReadOnlyDictionary<string, decimal> vars)
    {
        if (string.IsNullOrWhiteSpace(formula)) return 0m;
        var p = new Parser(formula!, vars);
        var v = p.ParseExpr();
        p.ExpectEnd();
        return v;
    }

    private sealed class Parser(string s, IReadOnlyDictionary<string, decimal> vars)
    {
        private int _i;
        private void SkipWs() { while (_i < s.Length && char.IsWhiteSpace(s[_i])) _i++; }
        private char Peek() { SkipWs(); return _i < s.Length ? s[_i] : '\0'; }

        public decimal ParseExpr()  // + -
        {
            var v = ParseTerm();
            while (true)
            {
                var c = Peek();
                if (c == '+') { _i++; v += ParseTerm(); }
                else if (c == '-') { _i++; v -= ParseTerm(); }
                else return v;
            }
        }
        private decimal ParseTerm()  // * /
        {
            var v = ParseFactor();
            while (true)
            {
                var c = Peek();
                if (c == '*') { _i++; v *= ParseFactor(); }
                else if (c == '/') { _i++; var d = ParseFactor(); if (d == 0m) throw new FormulaException("公式除以零"); v /= d; }
                else return v;
            }
        }
        private decimal ParseFactor()
        {
            var c = Peek();
            if (c == '-') { _i++; return -ParseFactor(); }
            if (c == '+') { _i++; return ParseFactor(); }
            if (c == '(')
            {
                _i++; var v = ParseExpr();
                if (Peek() != ')') throw new FormulaException("公式括号不匹配");
                _i++; return v;
            }
            if (char.IsDigit(c) || c == '.') return ParseNumber();
            return ParseIdentifier();
        }
        private decimal ParseNumber()
        {
            SkipWs(); var start = _i;
            while (_i < s.Length && (char.IsDigit(s[_i]) || s[_i] == '.')) _i++;
            var tok = s[start.._i];
            if (!decimal.TryParse(tok, NumberStyles.Number, CultureInfo.InvariantCulture, out var v))
                throw new FormulaException($"公式数字非法: {tok}");
            return v;
        }
        private decimal ParseIdentifier()
        {
            SkipWs(); var start = _i;
            while (_i < s.Length && !"+-*/()".Contains(s[_i]) && !char.IsWhiteSpace(s[_i])) _i++;
            var name = s[start.._i];
            if (name.Length == 0) throw new FormulaException($"公式无法解析: 位置 {_i}");
            if (!vars.TryGetValue(name, out var v)) throw new FormulaException($"公式未知变量: {name}");
            return v;
        }
        public void ExpectEnd() { if (Peek() != '\0') throw new FormulaException($"公式多余字符: 位置 {_i}"); }
    }
}
