# P7d 工资表生成（公式引擎）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 按 月份+部门+模板 生成工资表：手写公式引擎按序号求值各台头项目→写工资明细表(动态ZG列)+汇总工资总表。整合 P7a计件归集/P7b出勤/P7c模板。可重算,不做审核,零改表。P7 收官。

**Architecture:** FormulaEvaluator(纯函数递归下降)+PayrollService.GenerateAsync(快照模板→工资表项目公式[ZGnn列名]→逐员工求值→工资明细表/总表,可重算)+PayrollQueryService(list/detail+ZG映射)+控制器(generate/list/detail/delete,打开即看金额)。`src/ErpApi/Features/Payroll/` 续用。

**Tech Stack:** .NET 8 + Dapper；React + TS + AntD v6 + Vitest；xUnit。依据 `docs/superpowers/specs/2026-06-08-p7d-payroll-run-design.md`。样板：P7a PieceworkPayrollService、P7b AttendanceService、P7c WageTemplateService、P6 两层事务+docNo。

---

## Task 1: 公式引擎 FormulaEvaluator + 单测

**Files:** Create `src/ErpApi/Features/Payroll/FormulaEvaluator.cs`；Test `tests/ErpApi.Tests/FormulaEvaluatorTests.cs`.

- [ ] **Step 1: FormulaEvaluator.cs**（纯函数递归下降，无 DB，verbatim）：
```csharp
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
```

- [ ] **Step 2: 单测** `tests/ErpApi.Tests/FormulaEvaluatorTests.cs`（纯单测，无 `[Collection("db")]`，无需 DB）：
```csharp
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
```

- [ ] **Step 3: 测试（绿）** — `Get-Process ...|Stop-Process -Force`；`dotnet test tests/ErpApi.Tests --filter FormulaEvaluatorTests`（8 过，无跳过——纯单测不依赖DB）；全量。
- [ ] **Step 4: Commit** — `git add src/ErpApi/Features/Payroll/FormulaEvaluator.cs tests/ErpApi.Tests/FormulaEvaluatorTests.cs && git commit -m "feat(P7): 工资公式引擎FormulaEvaluator(递归下降·+-*/()·中文变量·错误抛异常)+单测"`

---

## Task 2: 工资表生成服务 PayrollService.GenerateAsync + DbTest

**Files:** Modify `src/ErpApi/Features/Payroll/PayrollDtos.cs`(加生成/查询 DTO)；Create `src/ErpApi/Features/Payroll/PayrollService.cs`；Test `tests/ErpApi.Tests/PayrollServiceDbTests.cs`.

- [ ] **Step 1: DTOs** 追加到 PayrollDtos.cs：
```csharp
// ---- 工资表生成/查询 ----
public sealed class PayrollGenerateDto
{ public string 月份 { get; set; } = ""; public string 部门编号 { get; set; } = ""; public string 模板编号 { get; set; } = ""; public decimal 应出勤天数 { get; set; } }
public sealed class PayrollSummaryRow
{ public string? 工资表编号 { get; set; } public string? 月份 { get; set; } public string? 部门编号 { get; set; } public string? 模板编号 { get; set; } public decimal? 基本工资 { get; set; } public decimal? 计件工资 { get; set; } public decimal? 应发合计 { get; set; } public decimal? 应扣合计 { get; set; } public decimal? 实发合计 { get; set; } }
public sealed class PayrollItemCol
{ public string? 列名 { get; set; } public string? 台头项目 { get; set; } public string? 类型 { get; set; } }
public sealed class PayrollDetailDto
{ public PayrollSummaryRow? 单头 { get; set; } public List<PayrollItemCol> 项目 { get; set; } = []; public List<Dictionary<string, object?>> 明细 { get; set; } = []; }
```
（明细行用 `Dictionary<string,object?>` 承载动态 ZGnn + 标准列，前端按 项目.列名 取值。）

- [ ] **Step 2: PayrollService.cs**（生成，事务，可重算）。要点：注入 `ISqlConnectionFactory factory, IDocumentNumberGenerator docNo`；复用 `PieceworkPayrollService`/`AttendanceService` 或直接查。实现 `GenerateAsync(PayrollGenerateDto dto, string user)`：
  1. 解析 月份(yyyyMM→月初/月末/下月初)；校验 部门编号/模板编号 非空。
  2. 载入模板项目：`SELECT CAST(i.序号 AS int) 序号, i.台头项目, i.类型, f.公式 FROM 工资模板项目 i LEFT JOIN 工资模板公式 f ON f.模板编号=i.模板编号 AND f.台头项目=i.台头项目 AND f.部门编号 IS NULL WHERE i.模板编号=@模板编号 ORDER BY i.序号`；空→ArgumentException；count>46→ArgumentException("工资项超过46个")。列名[i]=`$"ZG{i+1:00}"`（i 从0）。
  3. 开事务。**可重算删旧**：`DELETE 工资明细表 WHERE 月份=@月份 AND 部门编号=@部门编号`、`DELETE 工资总表 WHERE 月份=@月份 AND 部门编号=@部门编号`、`DELETE 工资表项目公式 WHERE 月份=@月份 AND 部门编号=@部门编号`。
  4. 工资表编号 = `await docNo.NextAsync("工资总表","GZ",now,c,tx)`。
  5. 快照：逐项 INSERT 工资表项目公式(工资表编号/月份/部门编号/台头项目/类型/公式/列名)。
  6. 取在职员工：`SELECT 编号,姓名,部门编号,职称,ISNULL(基本工资,0) 基本工资 FROM 人事档案 WHERE ISNULL(在职,'1')='1' AND 部门编号=@部门编号`。
  7. 该部门当月 计件工资 字典：`SELECT a.员工号, SUM(ISNULL(a.金额,0)) 计件 FROM 计件表 a WHERE ISNULL(a.审核,'0')='1' AND ISNULL(a.有效,'1')<>'0' AND a.日期>=@月初 AND a.日期<@下月初 GROUP BY a.员工号` → Dictionary。
  8. 该部门当月 缺勤天数 字典：`SELECT q.工号, SUM(TRY_CONVERT(decimal(18,4),q.计算出勤)) 缺勤 FROM b缺勤登记明细 q WHERE q.日期>=@月初 AND q.日期<@下月初 GROUP BY q.工号` → Dictionary。
  9. 逐员工：vars={基本工资, 计件工资(字典,缺省0), 应出勤天数=dto.应出勤天数, 缺勤天数(字典,缺省0), 实出勤天数=应出勤−缺勤}；逐项(序号序) `值=FormulaEvaluator.Evaluate(公式,vars)`，`vars[台头项目]=值`，存 colValues[列名]=值；应发合计=Σ(类型=='应发'项值)、应扣合计=Σ(类型=='应扣')、实发合计=应发−应扣；动态拼 `INSERT 工资明细表([工资表编号],[月份],[编号],[姓名],[部门编号],[部门],[职称],[基本工资],[计件工资],[应发合计],[应扣合计],[实发合计], <各列名>) VALUES(@..., @ZG01,...)`（列名内部生成,安全；用 DynamicParameters）。累加总表Σ。
  10. INSERT 工资总表(工资表编号/月份/部门编号/模板编号/开始日期=月初/结束日期=月末/审核'0'/操作员=user/Σ基本工资/Σ计件工资/Σ应发合计/Σ应扣合计/Σ实发合计)。提交。返回 工资表编号。
  - FormulaException 不在此 catch（由控制器转 400）。
  - 部门名：`工资明细表.部门`/`工资总表` 无部门名列？工资总表无部门名(只有部门编号);工资明细表有[部门]→填 部门信息.部门(查一次)。

- [ ] **Step 3: DbTest** `tests/ErpApi.Tests/PayrollServiceDbTests.cs`：seed 部门信息(P7DD1) + 人事档案(P7DE1,部门P7DD1,基本工资1000,在职'1') + 计件表(P7DE1 当月审核有效 金额500) + 工资模板(P7DT1: 项[基本工资/应发/"基本工资", 计件工资/应发/"计件工资", 满勤奖/应发/"实出勤天数/应出勤天数*260", 社保/应扣/"100"])（直接 INSERT 工资模板项目+工资模板公式,或调 WageTemplateService.SaveAsync）。GenerateAsync(月份当月,部门P7DD1,模板P7DT1,应出勤26)。断言：工资明细表 P7DE1 行 基本工资=1000、计件工资=500、ZG(满勤奖)=26/26*260=260(无缺勤实出勤=26)、应发合计=1000+500+260=1760、应扣合计=100、实发合计=1660；工资总表Σ实发=1660；再 Generate 一次→不重复(仍1行)。清理删四表+人事+部门+计件+模板。
  （断言 ZGnn 值用 `SELECT [应发合计],[应扣合计],[实发合计],[基本工资],[计件工资] FROM 工资明细表 WHERE 工资表编号=@ AND 编号='P7DE1'`。）

- [ ] **Step 4: 测试（绿）+ Commit**
```bash
git add src/ErpApi/Features/Payroll/PayrollDtos.cs src/ErpApi/Features/Payroll/PayrollService.cs tests/ErpApi.Tests/PayrollServiceDbTests.cs
git commit -m "feat(P7): 工资表生成服务(快照模板·逐员工公式求值·类型驱动合计·动态ZG列·可重算)+DbTest"
```

---

## Task 3: 查询服务 + 控制器 + DI + 权限种子 + API 测试

**Files:** Create `src/ErpApi/Features/Payroll/PayrollQueryService.cs`、`PayrollController.cs`；Modify `src/ErpApi/Program.cs`；Create `db/seed_p7d_perms.sql`；Test `tests/ErpApi.Tests/P7dPayrollApiIntegrationTests.cs`.

- [ ] **Step 1: PayrollQueryService.cs**：
  - `ListAsync(月份?, 部门编号?)`：`SELECT 工资表编号/月份/部门编号/模板编号/基本工资/计件工资/应发合计/应扣合计/实发合计 FROM 工资总表 WHERE (@月份 IS NULL OR 月份=@月份) AND (@部门编号 IS NULL OR 部门编号=@部门编号) ORDER BY 工资表编号 DESC`。
  - `GetDetailAsync(工资表编号)`：单头(工资总表) + 项目(`SELECT 列名,台头项目,类型 FROM 工资表项目公式 WHERE 工资表编号=@ ORDER BY 列名`) + 明细(`SELECT * FROM 工资明细表 WHERE 工资表编号=@`,用 `QueryAsync`→`IEnumerable<dynamic>`→转 `List<Dictionary<string,object?>>`,只保留 标准列+本表 列名集合 的键)。null if 头不存在。
- [ ] **Step 2: PayrollController.cs**（`api/payroll/wages`）：
  - `POST` generate(功能权限)：try svc.GenerateAsync; catch ArgumentException→400; catch FormulaException→400(消息="公式错误: "+ex.Message)；审计"生成"；返回{工资表编号}。
  - `GET` list(打开)、`GET {工资表编号}` detail(打开,404)、`DELETE {工资表编号}` 反生成(删除权限：删 工资明细表/工资总表/工资表项目公式 WHERE 工资表编号=@；审计"反生成";204)。
  - Menu `工资表`；打开权限即看(无金额脱敏)。
- [ ] **Step 3: DI** 追加 `PayrollService`、`PayrollQueryService`（FormulaEvaluator 静态无需注册）。
- [ ] **Step 4: 权限种子** `db/seed_p7d_perms.sql`：
```sql
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单]=N'工资表';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'工资表',1,0,1,1,0,1,0,0,1);
```
- [ ] **Step 5: API 测试** `tests/ErpApi.Tests/P7dPayrollApiIntegrationTests.cs`：①无功能权限 generate→403；②全权限 seed(部门/人事/计件/模板) → generate→200 → list(命中) → detail(项目映射ZGnn+明细行有值) → delete→204；③公式错误模板(引用未知变量) generate→400。清理。
- [ ] **Step 6: 测试（绿）+ Commit**
```bash
git add src/ErpApi/Features/Payroll/PayrollQueryService.cs src/ErpApi/Features/Payroll/PayrollController.cs src/ErpApi/Program.cs db/seed_p7d_perms.sql tests/ErpApi.Tests/P7dPayrollApiIntegrationTests.cs
git commit -m "feat(P7): 工资表REST(生成/查询/详情ZG映射/反生成·公式错误400)+权限种子+API测试"
```

---

## Task 4: 前端 — 工资表生成 + 查询页

**Files:** Modify `web/src/api/payroll.ts`、`web/src/App.tsx`、`web/src/pages/MainLayout.tsx`；Create `web/src/pages/payroll/PayrollRunPage.tsx`；Modify `web/src/__tests__/payroll.test.ts`.

- [ ] **Step 1: api** 追加 `payrollApi`：`generate(body)` POST /payroll/wages、`list(月份?,部门编号?)`、`detail(工资表编号)`、`remove(工资表编号)` + 类型(PayrollSummaryRow/PayrollDetail{单头,项目:[{列名,台头项目,类型}],明细:Record<string,unknown>[]})。
- [ ] **Step 2: 页面** `PayrollRunPage.tsx`：生成区(月份 month-picker + 部门编号 Input + 模板编号 Select[`wageTemplateApi.list`] + 应出勤天数 InputNumber默认26 + 生成按钮[功能权限,Popconfirm]) + 工资总表列表(工资表编号/月份/部门/实发合计,点开) + 详情 Table(列= 标准列[编号/姓名/部门/职称/基本工资/计件工资] + 按 detail.项目 动态列[title=台头项目,dataIndex=列名] + [应发合计/应扣合计/实发合计],dataSource=detail.明细) + 反生成按钮(删除权限)。错误 `e.response.data.消息`。
- [ ] **Step 3: util 测试** `payroll.test.ts` 加一条（如已有 `netAttendance` 够则加 `sumColumn` 或跳过新增——至少保证前端测试不减）。
- [ ] **Step 4: 菜单+路由** 「工资管理」组追加 工资表(`can('工资表','打开')`,图标如 `AccountBookOutlined`/`DollarOutlined`)；`App.tsx` 路由 `/payroll/wages`；Header 标题链补「工资表」。图标按需 import。
- [ ] **Step 5: 构建+测试+Commit**
```bash
npm --prefix web run build; npm --prefix web run test -- --run
git add web/src && git commit -m "feat(P7): 工资表生成+查询页(动态ZG列)+api+util测试"
```

---

## Task 5: 验证 + 收尾（P7 收官）

- [ ] **Step 1: 全量回归** — 后端 `dotnet test tests/ErpApi.Tests`(全过)；前端 test+build(全过)。
- [ ] **Step 2: 终审** — diff 核对：公式引擎单测充分、生成按序号求值+类型驱动合计+动态ZG列内部生成、可重算删旧、无审核零改表、打开即看金额。
- [ ] **Step 3: 授权种子** — `dotnet run --project tmp/dbquery -- $env:ERP_DB "@db/seed_p7d_perms.sql"`。
- [ ] **Step 4: 收尾** — finishing-a-development-branch：合并 master 本地→删分支→重启 5000/5173→更新记忆(erp-status 加 P7d 条目并标注 **P7 算薪收官**[计件归集+考勤+模板公式+工资表生成闭环],剩余 审核/分部门公式/工资条打印延后;MEMORY.md 同步,下一步 P8 配置 或 P6剩余)。

---

## Self-Review

- **Spec 覆盖**：公式引擎+单测(T1)、生成服务+DbTest(T2)、查询+控制器+权限+API(T3)、前端(T4)、回归收官(T5)。手写求值器、按序号求值、类型驱动合计、动态ZG列、可重算无审核、整合P7a/b/c——均落实。✓
- **占位符**：FormulaEvaluator+单测完整代码;DbTest给精确算术期望(基本1000/计件500/满勤260/应发1760/应扣100/实发1660);生成服务给详细步骤+关键SQL(动态INSERT说明);查询/控制器/前端给明确结构。✓
- **类型/命名一致**：Menu 工资表;路由 api/payroll/wages;DTO Payroll*;ZG列名 ZG{序号:00};内置变量 基本工资/计件工资/应出勤天数/实出勤天数/缺勤天数;合计类型驱动。✓
- **关键坑**：公式引擎未知变量/除零抛FormulaException→400;按序号求值只引用前项;ZG列名内部生成(非用户输入)拼INSERT安全+cap46;可重算按月份+部门删三表;计件/缺勤复用P7a/b口径(审核'1'/有效/在职/TRY_CONVERT计算出勤);docNo前缀GZ;工资总表无部门名列(明细部门取部门信息);ErpApi占用先Stop-Process。✓
