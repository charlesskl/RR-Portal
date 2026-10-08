# 管理后台（账号 + 权限管理）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 超管后台——账号管理(注册/重置密码/锁定禁用/解锁/删除)+权限管理(用户×菜单×9位矩阵)。超管=拥有「账号管理」菜单权限。零改表、零改认证(禁用走锁定到期)。

**Architecture:** MenuCatalog(静态菜单目录)+AccountService(sysfileuser CRUD,bcrypt)+PermissionAdminService(userbqrpower 整组替换矩阵)+AdminController(统一「账号管理」门控+自我保护)+「管理后台」菜单。`src/ErpApi/Features/Admin/`。

**Tech Stack:** .NET 8 + Dapper；React + TS + AntD v6 + Vitest；xUnit。依据 `docs/superpowers/specs/2026-06-09-admin-console-design.md`。样板：`AuthService`(bcrypt/IPasswordHasher)、P7c WageTemplateService(整组替换)、P6 控制器。

---

## Task 1: MenuCatalog + AccountService + DbTest

**Files:** Create `src/ErpApi/Features/Admin/MenuCatalog.cs`、`AdminDtos.cs`、`AccountService.cs`；Test `tests/ErpApi.Tests/AccountServiceDbTests.cs`.

- [ ] **Step 1: MenuCatalog.cs**（静态全菜单目录，verbatim）：
```csharp
namespace ErpApi.Features.Admin;

public sealed record MenuEntry(string 组, string 菜单);

// 全部 9 位权限菜单的集中目录(对照控制器 Menu 常量 + MASTER_CONFIGS)。新增菜单须同步此目录。
public static class MenuCatalog
{
    public static readonly IReadOnlyList<MenuEntry> All =
    [
        new("基础资料","客户资料"), new("基础资料","客户类别"), new("基础资料","供应商资料"), new("基础资料","供应商类别"),
        new("基础资料","加工厂资料"), new("基础资料","加工厂类别"), new("基础资料","物料资料"), new("基础资料","物料类别"),
        new("基础资料","款号资料"), new("基础资料","部门信息"), new("基础资料","人事档案"), new("基础资料","报价资料"),
        new("基础资料","报价类别"), new("基础资料","调价"), new("基础资料","发外加工项目"),
        new("业务单据","成品客户订货单"), new("业务单据","生产制单"),
        new("物料管理","采购入仓单"), new("物料管理","领料单"), new("物料管理","退料单"), new("物料管理","物料库存"),
        new("生产车间","裁床单"), new("生产车间","计件"), new("生产车间","计件汇总"),
        new("发外加工","发外加工"), new("发外加工","发外回收"), new("发外加工","发外对数"),
        new("成品仓储","成品入仓"), new("成品仓储","成品出仓"), new("成品仓储","成品盘点"), new("成品仓储","成品库存"),
        new("成品仓储","成品调拨"), new("成品仓储","成品退货"), new("成品仓储","成品退仓"),
        new("半成品仓储","半成品入仓"), new("半成品仓储","半成品领料"), new("半成品仓储","半成品盘点"), new("半成品仓储","半成品库存"),
        new("月结管理","库存月结"),
        new("销售管理","销售出货"), new("销售管理","销售退货"), new("销售管理","销售收款"), new("销售管理","应收对账"),
        new("应付管理","采购付款"), new("应付管理","发外付款"), new("应付管理","应付对账"),
        new("工资管理","计件归集"), new("工资管理","缺勤登记"), new("工资管理","出勤汇总"), new("工资管理","工资模板"), new("工资管理","工资表"),
        new("系统管理","系统配置"),
        new("管理后台","账号管理"),
    ];
}
```

- [ ] **Step 2: AdminDtos.cs**
```csharp
namespace ErpApi.Features.Admin;

public sealed class AccountRow
{
    public string? 用户 { get; set; }
    public string? 登录状态 { get; set; }
    public string? 上次登录 { get; set; }
    public DateTime? 日期 { get; set; }
    public int? 登录失败次数 { get; set; }
    public DateTime? 锁定到期 { get; set; }
    public bool 已锁定 { get; set; }
}
public sealed class RegisterDto { public string 用户名 { get; set; } = ""; public string 初始密码 { get; set; } = ""; }
public sealed class ResetPwdDto { public string 新密码 { get; set; } = ""; }
public sealed class MenuPermRow
{
    public string? 组 { get; set; }
    public string 菜单 { get; set; } = "";
    public bool 打开 { get; set; } public bool 保存 { get; set; } public bool 删除 { get; set; } public bool 打印 { get; set; }
    public bool 单价 { get; set; } public bool 金额 { get; set; } public bool 审核 { get; set; } public bool 反审核 { get; set; } public bool 功能 { get; set; }
}
public sealed class SaveUserPermsDto { public string 用户名 { get; set; } = ""; public List<MenuPermRow> 明细 { get; set; } = []; }
```

- [ ] **Step 3: AccountService.cs**
```csharp
using Dapper;
using ErpApi.Infrastructure.Db;
using ErpApi.Infrastructure.Security;
namespace ErpApi.Features.Admin;

// 账号管理(sysfileuser)。bcrypt 经 IPasswordHasher。禁用=锁定到期远期(复用 AuthService 登录门控)。绝不返回密码。
public sealed class AccountService(ISqlConnectionFactory factory, IPasswordHasher hasher)
{
    public async Task<IReadOnlyList<AccountRow>> ListAsync(string? keyword)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var rows = (await c.QueryAsync<AccountRow>(@"
SELECT [用户],[登录状态],[上次登录],[日期],[登录失败次数],[锁定到期]
FROM [sysfileuser] WHERE @kw IS NULL OR [用户] LIKE @kw ORDER BY [用户];", new { kw })).AsList();
        foreach (var r in rows) r.已锁定 = r.锁定到期 is { } d && d > DateTime.Now;
        return rows;
    }

    public async Task RegisterAsync(string 用户名, string 初始密码, string operatorUser)
    {
        if (string.IsNullOrWhiteSpace(用户名)) throw new ArgumentException("用户名必填");
        if (string.IsNullOrEmpty(初始密码)) throw new ArgumentException("初始密码必填");
        using var c = factory.Create();
        await c.OpenAsync();
        var exists = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM [sysfileuser] WHERE [用户]=@用户名", new { 用户名 });
        if (exists > 0) throw new InvalidOperationException("用户名已存在");
        await c.ExecuteAsync(@"
INSERT INTO [sysfileuser]([用户],[密码],[登录状态],[登录失败次数]) VALUES(@用户名,@密码,N'',0)",
            new { 用户名, 密码 = hasher.Hash(初始密码) });
    }

    public async Task<bool> ResetPasswordAsync(string 用户名, string 新密码)
    {
        if (string.IsNullOrEmpty(新密码)) throw new ArgumentException("新密码必填");
        using var c = factory.Create();
        return await c.ExecuteAsync("UPDATE [sysfileuser] SET [密码]=@密码 WHERE [用户]=@用户名",
            new { 用户名, 密码 = hasher.Hash(新密码) }) > 0;
    }

    public async Task<bool> LockAsync(string 用户名)
    {
        using var c = factory.Create();
        return await c.ExecuteAsync("UPDATE [sysfileuser] SET [锁定到期]=@d WHERE [用户]=@用户名",
            new { 用户名, d = new DateTime(2999, 12, 31) }) > 0;
    }

    public async Task<bool> UnlockAsync(string 用户名)
    {
        using var c = factory.Create();
        return await c.ExecuteAsync("UPDATE [sysfileuser] SET [锁定到期]=NULL,[登录失败次数]=0 WHERE [用户]=@用户名",
            new { 用户名 }) > 0;
    }

    public async Task<bool> DeleteAsync(string 用户名)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        await c.ExecuteAsync("DELETE FROM [userbqrpower] WHERE [用户]=@用户名", new { 用户名 }, tx);
        var n = await c.ExecuteAsync("DELETE FROM [sysfileuser] WHERE [用户]=@用户名", new { 用户名 }, tx);
        tx.Commit();
        return n > 0;
    }
}
```

- [ ] **Step 4: DbTest** `tests/ErpApi.Tests/AccountServiceDbTests.cs`：构造 `new AccountService(Factory(), new BcryptPasswordHasher())`。Register("ACCT_T1","pwd123","admin") → List 命中 ACCT_T1(无密码字段,AccountRow无密码属性) 且库内 `SELECT 密码` 经 `new BcryptPasswordHasher().Verify("pwd123",密码)` 为真;重复 Register 同名→抛 InvalidOperationException;ResetPassword("ACCT_T1","new456")→ Verify("new456")真、Verify("pwd123")假;Lock→锁定到期>now(List.已锁定 true);Unlock→锁定到期 null/失败次数0(已锁定 false);Delete→List 不含。清理删 ACCT_T1(sysfileuser+userbqrpower)。
- [ ] **Step 5: 测试（绿）** — `Get-Process ...|Stop-Process -Force`；`dotnet test tests/ErpApi.Tests --filter AccountServiceDbTests`；全量(213)。
- [ ] **Step 6: Commit** — `git add src/ErpApi/Features/Admin tests/ErpApi.Tests/AccountServiceDbTests.cs && git commit -m "feat(admin): 菜单目录MenuCatalog+账号服务(注册/重置密码/锁定解锁/删除·bcrypt·禁用走锁定到期)+DbTest"`

---

## Task 2: PermissionAdminService + DbTest

**Files:** Create `src/ErpApi/Features/Admin/PermissionAdminService.cs`；Test `tests/ErpApi.Tests/PermissionAdminServiceDbTests.cs`.

- [ ] **Step 1: PermissionAdminService.cs**
```csharp
using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Admin;

// 用户权限矩阵(userbqrpower)。整组替换:删该用户全部权限,再插至少一位为 true 的菜单行。
public sealed class PermissionAdminService(ISqlConnectionFactory factory)
{
    public async Task<IReadOnlyList<MenuPermRow>> GetUserPermsAsync(string 用户名)
    {
        using var c = factory.Create();
        var existing = (await c.QueryAsync(@"
SELECT [菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能]
FROM [userbqrpower] WHERE [用户]=@用户名", new { 用户名 }))
            .ToDictionary(r => (string)r.菜单, r => r);
        var list = new List<MenuPermRow>();
        foreach (var m in MenuCatalog.All)
        {
            var row = new MenuPermRow { 组 = m.组, 菜单 = m.菜单 };
            if (existing.TryGetValue(m.菜单, out var e))
            {
                row.打开 = (bool?)e.打开 ?? false; row.保存 = (bool?)e.保存 ?? false; row.删除 = (bool?)e.删除 ?? false;
                row.打印 = (bool?)e.打印 ?? false; row.单价 = (bool?)e.单价 ?? false; row.金额 = (bool?)e.金额 ?? false;
                row.审核 = (bool?)e.审核 ?? false; row.反审核 = (bool?)e.反审核 ?? false; row.功能 = (bool?)e.功能 ?? false;
            }
            list.Add(row);
        }
        return list;
    }

    public async Task SaveUserPermsAsync(string 用户名, IReadOnlyList<MenuPermRow> rows, string operatorUser)
    {
        if (string.IsNullOrWhiteSpace(用户名)) throw new ArgumentException("用户名必填");
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        await c.ExecuteAsync("DELETE FROM [userbqrpower] WHERE [用户]=@用户名", new { 用户名 }, tx);
        foreach (var r in rows)
        {
            if (string.IsNullOrWhiteSpace(r.菜单)) continue;
            bool any = r.打开 || r.保存 || r.删除 || r.打印 || r.单价 || r.金额 || r.审核 || r.反审核 || r.功能;
            if (!any) continue;
            await c.ExecuteAsync(@"
INSERT INTO [userbqrpower]([用户],[名称],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES(@用户名,@用户名,@菜单,@打开,@保存,@删除,@打印,@单价,@金额,@审核,@反审核,@功能)",
                new { 用户名, r.菜单, r.打开, r.保存, r.删除, r.打印, r.单价, r.金额, r.审核, r.反审核, r.功能 }, tx);
        }
        tx.Commit();
    }
}
```
（`QueryAsync` 动态行 → `(bool?)e.列` 转换；userbqrpower 9 位是 bit→bool?。`(string)r.菜单` 作字典键。）

- [ ] **Step 2: DbTest** `PermissionAdminServiceDbTests.cs`：SaveUserPerms("PERM_T1", [客户资料 打开+保存=true, 其余菜单全 false]) → GetUserPerms("PERM_T1") 中 客户资料 打开&保存 true/其它位 false、且别的菜单(如 工资表)全 false;`SELECT COUNT(*) FROM userbqrpower WHERE 用户='PERM_T1'`=1(只写了有true的一行);整组替换 SaveUserPerms("PERM_T1",[库存月结 打开=true]) → 客户资料 行没了、库存月结 打开 true、COUNT=1;清理删 PERM_T1。
  （GetUserPerms 返回全部 MenuCatalog 菜单行,断言时按 菜单 名找。）
- [ ] **Step 3: 测试（绿）+ Commit**
```bash
git add src/ErpApi/Features/Admin/PermissionAdminService.cs tests/ErpApi.Tests/PermissionAdminServiceDbTests.cs
git commit -m "feat(admin): 用户权限矩阵服务(整组替换·MenuCatalog全菜单读默认false)+DbTest"
```

---

## Task 3: AdminController + DI + 权限种子 + API 测试

**Files:** Create `src/ErpApi/Features/Admin/AdminController.cs`；Modify `src/ErpApi/Program.cs`；Create `db/seed_admin_console_perms.sql`；Test `tests/ErpApi.Tests/AdminApiIntegrationTests.cs`.

- [ ] **Step 1: AdminController.cs**（`api/admin`，统一「账号管理」门控 + 自我保护）：
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.Admin;

[ApiController]
[Authorize]
[Route("api/admin")]
public sealed class AdminController(
    AccountService accounts, PermissionAdminService permsvc, IPermissionService perms,
    IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "账号管理";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string table, string behavior, string record)
    { using var c = factory.Create(); await c.OpenAsync(); await audit.WriteAsync(table, behavior, CurrentUser, record, c); }

    [HttpGet("menus")]
    public async Task<IActionResult> Menus()
    { if (!await AllowAsync(PermissionAction.打开)) return Forbid(); return Ok(MenuCatalog.All); }

    [HttpGet("accounts")]
    public async Task<IActionResult> List(string? keyword = null)
    { if (!await AllowAsync(PermissionAction.打开)) return Forbid(); return Ok(await accounts.ListAsync(keyword)); }

    [HttpPost("accounts")]
    public async Task<IActionResult> Register([FromBody] RegisterDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await accounts.RegisterAsync(dto.用户名, dto.初始密码, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        await AuditAsync("sysfileuser", "注册账号", $"用户={dto.用户名}");
        return Ok(new { dto.用户名 });
    }

    [HttpPost("accounts/{用户}/reset-password")]
    public async Task<IActionResult> ResetPwd(string 用户, [FromBody] ResetPwdDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { if (!await accounts.ResetPasswordAsync(用户, dto.新密码)) return NotFound(); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        await AuditAsync("sysfileuser", "重置密码", $"用户={用户}");
        return NoContent();
    }

    [HttpPost("accounts/{用户}/lock")]
    public async Task<IActionResult> Lock(string 用户)
    {
        if (!await AllowAsync(PermissionAction.功能)) return Forbid();
        if (用户 == CurrentUser) return BadRequest(new { 消息 = "不能停用自己" });
        if (!await accounts.LockAsync(用户)) return NotFound();
        await AuditAsync("sysfileuser", "停用", $"用户={用户}");
        return NoContent();
    }

    [HttpPost("accounts/{用户}/unlock")]
    public async Task<IActionResult> Unlock(string 用户)
    {
        if (!await AllowAsync(PermissionAction.功能)) return Forbid();
        if (!await accounts.UnlockAsync(用户)) return NotFound();
        await AuditAsync("sysfileuser", "启用", $"用户={用户}");
        return NoContent();
    }

    [HttpDelete("accounts/{用户}")]
    public async Task<IActionResult> Delete(string 用户)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        if (用户 == CurrentUser) return BadRequest(new { 消息 = "不能删除自己" });
        if (!await accounts.DeleteAsync(用户)) return NotFound();
        await AuditAsync("sysfileuser", "删除账号", $"用户={用户}");
        return NoContent();
    }

    [HttpGet("accounts/{用户}/perms")]
    public async Task<IActionResult> GetPerms(string 用户)
    { if (!await AllowAsync(PermissionAction.打开)) return Forbid(); return Ok(await permsvc.GetUserPermsAsync(用户)); }

    [HttpPut("accounts/{用户}/perms")]
    public async Task<IActionResult> SavePerms(string 用户, [FromBody] SaveUserPermsDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        // 自我保护:保存自己权限时强制保留「账号管理·打开」,防自锁
        var rows = dto.明细;
        if (用户 == CurrentUser)
        {
            var self = rows.FirstOrDefault(r => r.菜单 == Menu);
            if (self is null) rows = [.. rows, new MenuPermRow { 组 = "管理后台", 菜单 = Menu, 打开 = true }];
            else self.打开 = true;
        }
        try { await permsvc.SaveUserPermsAsync(用户, rows, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        await AuditAsync("userbqrpower", "保存权限", $"用户={用户},菜单数={rows.Count(r => r.打开||r.保存||r.删除||r.打印||r.单价||r.金额||r.审核||r.反审核||r.功能)}");
        return NoContent();
    }
}
```

- [ ] **Step 2: DI** `Program.cs`：`builder.Services.AddScoped<ErpApi.Features.Admin.AccountService>();` + `builder.Services.AddScoped<ErpApi.Features.Admin.PermissionAdminService>();`
- [ ] **Step 3: 权限种子** `db/seed_admin_console_perms.sql`：
```sql
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单]=N'账号管理';
INSERT INTO [userbqrpower]([用户],[名称],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,@用户,N'账号管理',1,1,1,1,0,0,0,0,1);
```
- [ ] **Step 4: API 测试** `tests/ErpApi.Tests/AdminApiIntegrationTests.cs`：①无「账号管理」权限用户 → GET accounts / POST accounts / GET menus 全 403。②有权限(内联种 admin_t 账号管理全1)：POST accounts {用户名:"API_U1",初始密码:"p1"} → 200;GET accounts?keyword=API_U1 命中;PUT accounts/API_U1/perms {明细:[客户资料 打开=true]} → 204;GET accounts/API_U1/perms → 客户资料 打开 true;POST accounts/API_U1/lock → 204;unlock → 204;DELETE accounts/API_U1 → 204。③删除/停用自己 → 400。清理(删 API_U1、admin_t 及其权限)。
  注:测试用户名用 JWT Issue;门控用户 admin_t 需先在 userbqrpower 种「账号管理」权限(内联)。
- [ ] **Step 5: 测试（绿）+ Commit**
```bash
git add src/ErpApi/Features/Admin/AdminController.cs src/ErpApi/Program.cs db/seed_admin_console_perms.sql tests/ErpApi.Tests/AdminApiIntegrationTests.cs
git commit -m "feat(admin): 管理后台REST(账号注册/重置/锁定/删除+权限矩阵·账号管理门控+自我保护)+权限种子+API测试"
```

---

## Task 4: 前端 — 管理后台菜单 + 账号管理页 + 权限矩阵

**Files:** Create `web/src/api/admin.ts`、`web/src/pages/admin/AccountPage.tsx`、`web/src/utils/adminPerms.ts`、`web/src/__tests__/admin.test.ts`；Modify `web/src/App.tsx`、`web/src/pages/MainLayout.tsx`.

- [ ] **Step 1: api** `web/src/api/admin.ts`：`accountApi`(list(keyword?)/register({用户名,初始密码})/resetPassword(用户,{新密码})/lock(用户)/unlock(用户)/remove(用户))、`adminApi.menus()`、`userPermApi.get(用户)`/`save(用户,{用户名,明细})` + 类型 `AccountRow/MenuPermRow/MenuEntry`。
- [ ] **Step 2: util+单测** `web/src/utils/adminPerms.ts`：`groupByCategory(rows: MenuPermRow[])` → `[{组, 菜单行[]}]`(按组聚合,保序);`web/src/__tests__/admin.test.ts` 断言分组。
- [ ] **Step 3: 账号管理页** `AccountPage.tsx`：账号列表(用户/登录状态/上次登录/已锁定[Tag]) + 注册按钮(用户名+初始密码 弹窗) + 行操作(重置密码[弹窗输新密]/停用·启用[据已锁定切换]/删除 Popconfirm/**权限**[打开权限抽屉])。权限抽屉:`userPermApi.get(用户)` → 按 `groupByCategory` 渲染 折叠分组,每菜单一行 9 个 Checkbox(打开/保存/删除/打印/单价/金额/审核/反审核/功能),支持整行全选;整组保存 `userPermApi.save`。按 `can('账号管理',...)` 控权(注册/重置/保存权限=保存,删除=删除,停用启用=功能)。
- [ ] **Step 4: 菜单+路由** 新独立顶级组 **「管理后台」**(key `admin`,图标如 `SafetycertificateOutlined`/`TeamOutlined`,仅 `can('账号管理','打开')` 可见) → 账号管理;`App.tsx` 路由 `/admin/accounts`;Header 标题链补「账号管理」。图标按需 import。
- [ ] **Step 5: 构建+测试+Commit** — `npm --prefix web run build`;`npm --prefix web run test -- --run`;
```bash
git add web/src && git commit -m "feat(admin): 管理后台菜单+账号管理页(注册/重置/锁定/删除)+权限矩阵编辑+api+util测试"
```

---

## Task 5: 验证 + 收尾

- [ ] **Step 1: 全量回归** — 后端 `dotnet test tests/ErpApi.Tests`(全过)；前端 test+build(全过)。
- [ ] **Step 2: 终审** — diff 核对:账号绝不返回密码、bcrypt、禁用走锁定到期不改AuthService、整组替换权限、统一「账号管理」门控+自我保护(删/停自己400+保存自身保留账号管理打开)、零改表。
- [ ] **Step 3: 授权种子 + 冒烟** — `dotnet run --project tmp/dbquery -- $env:ERP_DB "@db/seed_admin_console_perms.sql"`;起后端用 admin 登录验证 GET /api/admin/accounts 返回账号、注册一个测试账号、给它授权、用它登录验证权限生效(可选)。
- [ ] **Step 4: 收尾** — finishing-a-development-branch：合并 master 本地→删分支→重启 5000/5173→更新记忆(新增「管理后台」条目:超管凭账号管理菜单、账号CRUD、9位权限矩阵、禁用走锁定到期、MenuCatalog集中维护[新增菜单须同步];MEMORY.md 同步)。

---

## Self-Review

- **Spec 覆盖**：MenuCatalog+账号服务+DbTest(T1)、权限矩阵服务+DbTest(T2)、控制器+DI+种子+API(T3)、前端(T4)、回归收尾(T5)。超管凭账号管理菜单门控、注册/重置/锁定解锁/删除、9位矩阵整组替换、禁用走锁定到期、自我保护、零改表零改认证——均落实。✓
- **占位符**：MenuCatalog/DTOs/AccountService/PermissionAdminService/AdminController/种子完整代码;DbTest给精确断言(bcrypt校验/锁定/整组替换);API测试与前端给明确结构。✓
- **类型/命名一致**：Menu 账号管理;路由 api/admin/(menus,accounts,accounts/{用户}/{reset-password,lock,unlock,perms});DTO AccountRow/RegisterDto/MenuPermRow/SaveUserPermsDto;门控 HasAsync("账号管理",动作)。✓
- **关键坑**：账号List/Get不含密码;bcrypt IPasswordHasher.Hash/Verify;禁用=锁定到期2999(复用登录门控);权限整组替换(全false不写);自我保护(删/停自己400,保存自身保留账号管理打开);删除连带userbqrpower;MenuCatalog新增菜单须同步;userbqrpower 9位bit→bool? dynamic转换;ErpApi占用先Stop-Process。✓
