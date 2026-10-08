# P8 系统参数（系统配置表 CRUD）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 系统配置表 CRUD（键/值/是否加密/备注），加密值 AES-GCM 写时加密、读时脱敏不回显，明文仅服务端可取。零改表。P8/路线图收官。

**Architecture:** ConfigProtector(AES-GCM,密钥SHA256(ERP_CONFIG_KEY??ERP_JWT_KEY))+SysConfigService(CRUD,加密项读脱敏/空值保留旧密文/GetValueAsync服务端取明文)+控制器+新「系统管理」菜单。

**Tech Stack:** .NET 8 (AesGcm 内置) + Dapper；React + TS + AntD v6 + Vitest；xUnit。依据 `docs/superpowers/specs/2026-06-09-p8-sys-config-design.md`。样板：`Infrastructure/Security/BcryptPasswordHasher.cs`(安全服务+接口)、P7d 读写服务、P6 控制器。

---

## Task 1: 配置加密器 ConfigProtector + 单测

**Files:** Create `src/ErpApi/Infrastructure/Security/IConfigProtector.cs`、`ConfigProtector.cs`；Test `tests/ErpApi.Tests/ConfigProtectorTests.cs`.

- [ ] **Step 1: IConfigProtector.cs**
```csharp
namespace ErpApi.Infrastructure.Security;
public interface IConfigProtector
{
    string Encrypt(string plain);
    string? TryDecrypt(string stored);
}
```

- [ ] **Step 2: ConfigProtector.cs**（AES-GCM，无第三方依赖）：
```csharp
using System.Security.Cryptography;
using System.Text;
namespace ErpApi.Infrastructure.Security;

// 系统配置加密器：AES-GCM。密钥 = SHA256(ERP_CONFIG_KEY ?? ERP_JWT_KEY)。存 base64(nonce(12)+tag(16)+cipher)。
public sealed class ConfigProtector : IConfigProtector
{
    private readonly byte[] _key;
    private const int NonceLen = 12, TagLen = 16;

    public ConfigProtector()
    {
        var raw = Environment.GetEnvironmentVariable("ERP_CONFIG_KEY")
                  ?? Environment.GetEnvironmentVariable("ERP_JWT_KEY") ?? "";
        _key = SHA256.HashData(Encoding.UTF8.GetBytes(raw)); // 32 bytes
    }

    public string Encrypt(string plain)
    {
        var data = Encoding.UTF8.GetBytes(plain ?? "");
        var nonce = RandomNumberGenerator.GetBytes(NonceLen);
        var cipher = new byte[data.Length];
        var tag = new byte[TagLen];
        using var aes = new AesGcm(_key, TagLen);
        aes.Encrypt(nonce, data, cipher, tag);
        var outBuf = new byte[NonceLen + TagLen + cipher.Length];
        Buffer.BlockCopy(nonce, 0, outBuf, 0, NonceLen);
        Buffer.BlockCopy(tag, 0, outBuf, NonceLen, TagLen);
        Buffer.BlockCopy(cipher, 0, outBuf, NonceLen + TagLen, cipher.Length);
        return Convert.ToBase64String(outBuf);
    }

    public string? TryDecrypt(string stored)
    {
        try
        {
            var buf = Convert.FromBase64String(stored ?? "");
            if (buf.Length < NonceLen + TagLen) return null;
            var nonce = buf[..NonceLen];
            var tag = buf[NonceLen..(NonceLen + TagLen)];
            var cipher = buf[(NonceLen + TagLen)..];
            var plain = new byte[cipher.Length];
            using var aes = new AesGcm(_key, TagLen);
            aes.Decrypt(nonce, cipher, tag, plain);
            return Encoding.UTF8.GetString(plain);
        }
        catch { return null; }
    }
}
```

- [ ] **Step 3: 单测** `tests/ErpApi.Tests/ConfigProtectorTests.cs`（纯单测，无 DB；构造前设 ERP_JWT_KEY 确保有密钥）：
```csharp
using ErpApi.Infrastructure.Security;
using Xunit;

public class ConfigProtectorTests
{
    private static ConfigProtector P()
    {
        Environment.SetEnvironmentVariable("ERP_CONFIG_KEY", "test-config-key-0123456789");
        return new ConfigProtector();
    }

    [Fact] public void 往返() { var p = P(); var c = p.Encrypt("秘密ABC123"); Assert.Equal("秘密ABC123", p.TryDecrypt(c)); }
    [Fact] public void 随机nonce_两次密文不同() { var p = P(); Assert.NotEqual(p.Encrypt("x"), p.Encrypt("x")); }
    [Fact] public void 篡改返回null() { var p = P(); var c = p.Encrypt("y"); var bad = "A" + c[1..]; Assert.Null(p.TryDecrypt(bad)); }
    [Fact] public void 非base64返回null() { var p = P(); Assert.Null(p.TryDecrypt("!!!notbase64")); }
    [Fact] public void 空串往返() { var p = P(); Assert.Equal("", p.TryDecrypt(p.Encrypt(""))); }
}
```

- [ ] **Step 4: 测试（绿）** — `Get-Process ...|Stop-Process -Force`；`dotnet test tests/ErpApi.Tests --filter ConfigProtectorTests`（5 过,0 跳过）；全量(208)。
- [ ] **Step 5: Commit** — `git add src/ErpApi/Infrastructure/Security/IConfigProtector.cs src/ErpApi/Infrastructure/Security/ConfigProtector.cs tests/ErpApi.Tests/ConfigProtectorTests.cs && git commit -m "feat(P8): 配置加密器ConfigProtector(AES-GCM·密钥派生·篡改检测)+单测"`

---

## Task 2: SysConfigService + DTOs + Controller + DI + 权限种子 + DbTest + API 测试

**Files:** Create `src/ErpApi/Features/SystemConfig/SysConfigDtos.cs`、`SysConfigService.cs`、`SysConfigController.cs`；Modify `src/ErpApi/Program.cs`；Create `db/seed_p8_perms.sql`；Test `tests/ErpApi.Tests/SysConfigServiceDbTests.cs`、`tests/ErpApi.Tests/P8SysConfigApiIntegrationTests.cs`.

- [ ] **Step 1: SysConfigDtos.cs**
```csharp
namespace ErpApi.Features.SystemConfig;
public sealed class SysConfigDto
{ public string 键 { get; set; } = ""; public string? 值 { get; set; } public bool 是否加密 { get; set; } public string? 备注 { get; set; } }
public sealed class SysConfigRow
{ public string? 键 { get; set; } public string? 值 { get; set; } public bool 是否加密 { get; set; } public string? 备注 { get; set; } }
```

- [ ] **Step 2: SysConfigService.cs**
```csharp
using Dapper;
using ErpApi.Infrastructure.Db;
using ErpApi.Infrastructure.Security;
namespace ErpApi.Features.SystemConfig;

// 系统参数 CRUD。加密值写时 AES 加密、读时脱敏(值=null);明文仅 GetValueAsync 服务端可取。
public sealed class SysConfigService(ISqlConnectionFactory factory, IConfigProtector protector)
{
    public async Task<IReadOnlyList<SysConfigRow>> ListAsync(string? keyword)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var rows = (await c.QueryAsync<SysConfigRow>(@"
SELECT [键],[值],[是否加密],[备注] FROM [系统配置表]
WHERE @kw IS NULL OR [键] LIKE @kw OR [备注] LIKE @kw ORDER BY [键];", new { kw })).AsList();
        foreach (var r in rows) if (r.是否加密) r.值 = null;  // 脱敏
        return rows;
    }

    public async Task<SysConfigRow?> GetAsync(string 键)
    {
        using var c = factory.Create();
        var r = await c.QueryFirstOrDefaultAsync<SysConfigRow>(
            "SELECT [键],[值],[是否加密],[备注] FROM [系统配置表] WHERE [键]=@键", new { 键 });
        if (r is null) return null;
        if (r.是否加密) r.值 = null;
        return r;
    }

    public async Task UpsertAsync(SysConfigDto dto, string user)
    {
        if (string.IsNullOrWhiteSpace(dto.键)) throw new ArgumentException("键必填");
        using var c = factory.Create();
        string? 存值;
        if (dto.是否加密)
        {
            if (string.IsNullOrEmpty(dto.值))
                存值 = await c.ExecuteScalarAsync<string?>("SELECT [值] FROM [系统配置表] WHERE [键]=@键", new { dto.键 }); // 保留旧密文
            else
                存值 = protector.Encrypt(dto.值);
        }
        else 存值 = dto.值;

        await c.ExecuteAsync(@"
MERGE [系统配置表] AS t USING (SELECT @键 AS 键) AS s ON t.[键]=s.键
WHEN MATCHED THEN UPDATE SET [值]=@值,[是否加密]=@是否加密,[备注]=@备注
WHEN NOT MATCHED THEN INSERT([键],[值],[是否加密],[备注]) VALUES(@键,@值,@是否加密,@备注);",
            new { dto.键, 值 = 存值, 是否加密 = dto.是否加密, dto.备注 });
    }

    public async Task<bool> DeleteAsync(string 键)
    {
        using var c = factory.Create();
        return await c.ExecuteAsync("DELETE FROM [系统配置表] WHERE [键]=@键", new { 键 }) > 0;
    }

    // 服务端消费者取明文（不暴露 API）
    public async Task<string?> GetValueAsync(string 键)
    {
        using var c = factory.Create();
        var r = await c.QueryFirstOrDefaultAsync<SysConfigRow>(
            "SELECT [值],[是否加密] FROM [系统配置表] WHERE [键]=@键", new { 键 });
        if (r is null) return null;
        return r.是否加密 && r.值 is not null ? protector.TryDecrypt(r.值) : r.值;
    }
}
```

- [ ] **Step 3: SysConfigController.cs**（`api/sys-config`，Menu 系统配置）
```csharp
using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.SystemConfig;

[ApiController]
[Authorize]
[Route("api/sys-config")]
public sealed class SysConfigController(
    SysConfigService svc, IPermissionService perms, IAuditLogger audit, ISqlConnectionFactory factory) : ControllerBase
{
    private const string Menu = "系统配置";
    private const string Table = "系统配置表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";
    private Task<bool> AllowAsync(PermissionAction a) => perms.HasAsync(CurrentUser, Menu, a);
    private async Task AuditAsync(string behavior, string record)
    { using var c = factory.Create(); await c.OpenAsync(); await audit.WriteAsync(Table, behavior, CurrentUser, record, c); }

    [HttpGet]
    public async Task<IActionResult> List(string? keyword = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        return Ok(await svc.ListAsync(keyword));
    }

    [HttpGet("{键}")]
    public async Task<IActionResult> Get(string 键)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        var r = await svc.GetAsync(键);
        if (r is null) return NotFound();
        return Ok(r);
    }

    [HttpPost]
    public async Task<IActionResult> Upsert([FromBody] SysConfigDto dto)
    {
        if (!await AllowAsync(PermissionAction.保存)) return Forbid();
        try { await svc.UpsertAsync(dto, CurrentUser); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        await AuditAsync("保存", $"键={dto.键}");
        return Ok(new { dto.键 });
    }

    [HttpDelete("{键}")]
    public async Task<IActionResult> Delete(string 键)
    {
        if (!await AllowAsync(PermissionAction.删除)) return Forbid();
        if (!await svc.DeleteAsync(键)) return NotFound();
        await AuditAsync("删除", $"键={键}");
        return NoContent();
    }
}
```

- [ ] **Step 4: DI** `Program.cs`：`builder.Services.AddSingleton<ErpApi.Infrastructure.Security.IConfigProtector, ErpApi.Infrastructure.Security.ConfigProtector>();` + `builder.Services.AddScoped<ErpApi.Features.SystemConfig.SysConfigService>();`
- [ ] **Step 5: 权限种子** `db/seed_p8_perms.sql`：
```sql
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单]=N'系统配置';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'系统配置',1,1,1,1,0,0,0,0,1);
```
- [ ] **Step 6: DbTest** `tests/ErpApi.Tests/SysConfigServiceDbTests.cs`：构造 `new SysConfigService(Factory(), new ConfigProtector())`（先设 ERP_JWT_KEY/ERP_CONFIG_KEY）。Upsert 明文键 P8K1 值"hello" → GetAsync 值="hello"；Upsert 加密键 P8K2 值"secret" 是否加密=1 → GetAsync 值=null(脱敏)、库内 [值]≠"secret"(`SELECT 值 FROM 系统配置表 WHERE 键='P8K2'` 非"secret")、GetValueAsync("P8K2")="secret"；Upsert P8K2 值=空 备注="改备注" 是否加密=1 → GetValueAsync 仍="secret"(保留旧密文)；DeleteAsync。清理删 P8K1/P8K2。
- [ ] **Step 7: API 测试** `tests/ErpApi.Tests/P8SysConfigApiIntegrationTests.cs`（仿 P7 API 测试）：①无保存权限 upsert→403；②全权限 upsert明文→get(值=明文)→upsert加密→get(值=null)→delete→get 404。内联权限种子;清理。注意 WebApplicationFactory 需 ERP_JWT_KEY(已设)。
- [ ] **Step 8: 测试（绿）+ Commit**
```bash
git add src/ErpApi/Features/SystemConfig src/ErpApi/Program.cs db/seed_p8_perms.sql tests/ErpApi.Tests/SysConfigServiceDbTests.cs tests/ErpApi.Tests/P8SysConfigApiIntegrationTests.cs
git commit -m "feat(P8): 系统参数CRUD(加密值脱敏不回显·MERGE upsert·明文仅服务端)+REST+权限种子+DbTest+API测试"
```

---

## Task 3: 前端 — 系统管理菜单 + 系统参数页

**Files:** Create `web/src/api/sysConfig.ts`、`web/src/pages/system/SysConfigPage.tsx`、`web/src/utils/sysConfig.ts`、`web/src/__tests__/sysConfig.test.ts`；Modify `web/src/App.tsx`、`web/src/pages/MainLayout.tsx`.

- [ ] **Step 1: api** `web/src/api/sysConfig.ts`：`sysConfigApi`(list(keyword?)/get(键)/upsert(body)/remove(键)) + 类型 `SysConfigRow {键,值?,是否加密,备注?}`。`import { api } from "./client"`。
- [ ] **Step 2: util+单测** `web/src/utils/sysConfig.ts`：`displayValue(row)` = 加密项→"(已加密)" 否则 值；`web/src/__tests__/sysConfig.test.ts` 断言。
- [ ] **Step 3: 页面** `SysConfigPage.tsx`：列表(键/值[加密项显「(已加密)」]/是否加密/备注) + 新建/编辑抽屉(键 Input[编辑只读]/是否加密 Switch/值 Input(加密项 placeholder「留空保留原值」)/备注) + 删除 Popconfirm。仿物料主数据/工资模板页。按 `can('系统配置',...)` 控权。
- [ ] **Step 4: 菜单+路由** 新独立顶级组 **「系统管理」**(key `sys`,图标如 `SettingOutlined`)→ 系统参数(`can('系统配置','打开')`,图标 `ControlOutlined`/`SettingOutlined`)；`App.tsx` 路由 `/sys-config`；Header 标题链补「系统参数」。图标按需 import。
- [ ] **Step 5: 构建+测试+Commit** — `npm --prefix web run build`;`npm --prefix web run test -- --run`;
```bash
git add web/src && git commit -m "feat(P8): 系统管理菜单+系统参数页(加密项脱敏显示)+api+util测试"
```

---

## Task 4: 验证 + 收尾（P8/路线图收官）

- [ ] **Step 1: 全量回归** — 后端 `dotnet test tests/ErpApi.Tests`(全过)；前端 test+build(全过)。
- [ ] **Step 2: 终审** — diff 核对：加密器 AES-GCM+单测、加密值读脱敏/空值保留旧密文、明文仅 GetValueAsync、零改表。
- [ ] **Step 3: 授权种子** — `dotnet run --project tmp/dbquery -- $env:ERP_DB "@db/seed_p8_perms.sql"`。
- [ ] **Step 4: 收尾** — finishing-a-development-branch：合并 master 本地→删分支→重启 5000/5173→更新记忆(erp-status 加 P8 条目并标注 **P0–P8 路线图全部完成**[12模块核心建成];剩余 工票打印/表格设置/装箱/多币种/工资审核等增强项延后;MEMORY.md 同步)。

---

## Self-Review

- **Spec 覆盖**：加密器+单测(T1)、服务/控制器/DI/权限种子/DbTest/API(T2)、前端(T3)、回归收尾(T4)。加密值脱敏不回显、空值保留旧密文、明文仅服务端、MERGE upsert、AES-GCM 密钥派生——均落实。✓
- **占位符**：加密器/接口/单测/DTOs/服务/控制器/权限种子完整代码;DbTest/API测试给明确断言;前端给结构+样板。✓
- **类型/命名一致**：Menu 系统配置;路由 api/sys-config;DTO SysConfigDto/Row;加密器 IConfigProtector;键 PK MERGE。✓
- **关键坑**：加密值读 值=null 脱敏;Upsert 加密项空值=保留旧密文(SELECT 旧值);GetValueAsync 仅服务端取明文;AesGcm .NET8内置;密钥 ERP_CONFIG_KEY??ERP_JWT_KEY SHA256;ConfigProtector 单测/DbTest 先设环境密钥;ErpApi占用先Stop-Process。✓
