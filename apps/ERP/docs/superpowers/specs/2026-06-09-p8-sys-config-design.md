# P8 系统参数（系统配置表 CRUD）设计

> 兴信B ERP 净室重建 · P8 配置(M12) · **路线图收官** · 2026-06-09

**目标**：系统参数管理——`系统配置表`（键/值/是否加密/备注）CRUD。加密值写时 AES 加密、读时**脱敏不回显明文**（明文仅服务端消费者可取）。替代硬编码全局参数。

**已确认决策（与用户）**：
- P8 只做**系统参数**；工票打印/表格设置/报表模板 niche，归类延后/丢弃，P8 收官。
- 加密值**脱敏不回显明文**：列表/详情对 是否加密=1 的值返回占位（不解密到 UI）；保存时空值=保留旧密文（只改备注不必重输）、非空=重新加密；明文仅服务端方法可取。
- 加密器 AES-GCM，密钥 SHA256(env `ERP_CONFIG_KEY` ?? `ERP_JWT_KEY`)。

---

## 1. 数据模型 — 零改表

- `系统配置表`（P0 `03_p0_additions.sql` 建）：`键 nvarchar(60) PK / 值 nvarchar(max) / 是否加密 bit DEFAULT 0 / 备注 nvarchar(200)`。
- **无新建/ALTER 脚本**。

## 2. 配置加密器（`src/ErpApi/Infrastructure/Security/ConfigProtector.cs`）

`IConfigProtector` + `ConfigProtector`（DI singleton）：
- 密钥：`SHA256(Environment.GetEnvironmentVariable("ERP_CONFIG_KEY") ?? ERP_JWT_KEY ?? "")` → 32 字节。构造时算一次。
- `string Encrypt(string plain)`：AES-GCM，随机 12 字节 nonce，16 字节 tag；返回 `Convert.ToBase64String(nonce ++ tag ++ cipher)`。
- `string? TryDecrypt(string stored)`：解析 base64→nonce/tag/cipher，AES-GCM 解密；失败(篡改/格式错)返回 null。
- 用 `System.Security.Cryptography.AesGcm`（.NET 8 内置，无第三方依赖）。
- 单测：encrypt→decrypt 往返、同明文两次密文不同(随机nonce)、篡改→TryDecrypt 返回 null。

## 3. 服务（`src/ErpApi/Features/SystemConfig/SysConfigService.cs`）

注入 `ISqlConnectionFactory factory, IConfigProtector protector`：
- `ListAsync(keyword?)`：`SELECT [键],[值],[是否加密],[备注] FROM [系统配置表] WHERE @kw IS NULL OR [键] LIKE @kw OR [备注] LIKE @kw ORDER BY [键]`；**是否加密=1 的行 值置 null**（脱敏）。
- `GetAsync(键)`：单条；加密则 值=null。
- `UpsertAsync(dto, user)`：校验 键非空；
  - 若 dto.是否加密：若 dto.值 为空 → 读现有行，存在则保留旧 [值]（不覆盖密文），不存在则存 null/空；非空 → `protector.Encrypt(dto.值)`。
  - 否则 值 = dto.值（明文）。
  - MERGE by 键（PK）：存在 UPDATE [值]/[是否加密]/[备注]，否则 INSERT。
- `DeleteAsync(键)`。
- `GetValueAsync(键)`（**服务端消费者用，不暴露 API**）：读行，是否加密=1 则 `TryDecrypt` 返回明文，否则原值。供将来模块取参数。

DTO：`SysConfigDto {键, 值?, 是否加密 bool, 备注?}`、`SysConfigRow {键, 值?(加密则null), 是否加密 bool, 备注?}`。

## 4. 控制器（`SysConfigController`，`api/sys-config`）

- `GET`(list, keyword) / `GET {键}` / `POST`(upsert) / `DELETE {键}`。
- Menu `系统配置`；9 位权限 打开/保存/删除；审计 保存/删除。
- 加密值脱敏在服务层（读返回 null）；前端对加密项显示占位「(已加密)」，输入即覆盖。
- DI：注册 `IConfigProtector`(singleton)、`SysConfigService`(scoped)。
- 权限种子 `db/seed_p8_perms.sql`：admin 系统配置(打开/保存/删除/打印/功能)。

## 5. 前端

- `web/src/api/sysConfig.ts`：`sysConfigApi`(list/get/upsert/remove) + 类型 `SysConfigRow {键,值,是否加密,备注}`。
- 页面 `web/src/pages/system/SysConfigPage.tsx`：列表(键/值[加密项显「(已加密)」]/是否加密/备注) + 新建/编辑抽屉(键 Input[编辑只读]/值 Input(加密项 placeholder「留空保留原值」)/是否加密 Switch/备注) + 删除。按 `can('系统配置',...)` 控权。
- 菜单：新独立顶级组 **「系统管理」**(key `sys`) → 系统参数；`App.tsx` 路由 `/sys-config`；Header 标题链补。
- `web/src/utils/sysConfig.ts`（可选）：`maskedDisplay(row)` 等小工具 + 单测（或并入现有测试）。

## 6. 测试

- 后端 `ConfigProtectorTests`（纯单测）：往返、随机nonce、篡改返回null。
- 后端 `SysConfigServiceDbTests`：Upsert 明文键 → Get 原值；Upsert 加密键(值="secret",是否加密=1) → Get 值=null(脱敏) 但库内 [值]≠"secret"(已加密) 且 GetValueAsync 解出"secret"；Upsert 同加密键 值=空+改备注 → 旧密文保留(GetValueAsync 仍"secret");Delete。清理删键。
- 后端 `P8SysConfigApiIntegrationTests`：无保存权限 upsert→403；明文/加密 upsert→get(加密值null)→delete 生命周期。
- 前端 util/页面测试。

## 7. 范围外（延后/丢弃）

工票打印设置/工票格式（打印版式+实际PDF打印）、表格设置（用户列偏好）、报表模板（无表）。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 明文泄露 | 加密值读取一律脱敏(值=null);明文仅 `GetValueAsync` 服务端取;AES-GCM 认证加密。 |
| 改备注误清密文 | Upsert 加密项空值=保留旧 [值];非空才重新加密。 |
| 密钥缺失 | ERP_CONFIG_KEY 缺省回退 ERP_JWT_KEY(已必设);SHA256 派生 32 字节,任意字符串可用。 |
| AesGcm 可用性 | .NET 8 内置 `System.Security.Cryptography.AesGcm`,无第三方依赖。 |
| 键 PK 冲突 | Upsert MERGE by 键(存在则更新)。 |
