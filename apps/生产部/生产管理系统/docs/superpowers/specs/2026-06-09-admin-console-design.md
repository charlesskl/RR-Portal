# 管理后台（账号 + 权限管理）设计

> 兴信B ERP 净室重建 · 横切管理功能 · 2026-06-09

**目标**：超级管理员后台——**账号管理**（注册/重置密码/锁定禁用/解锁启用/删除）+ **权限管理**（用户 × 菜单 × 9 位权限矩阵编辑）。复用现有 9 位权限模型做超管门控，零改表、零改认证。

**已确认决策（与用户）**：
- 超管认定：**凭「账号管理」菜单权限**（9 位模型门控；admin 种子拥有即超管，超管可把该菜单授予他人）。零改表。
- 菜单清单：**后端 MenuCatalog 静态分组目录**（集中维护，覆盖现有 ~30 个 9 位菜单），服务给权限矩阵 UI。
- 范围：账号管理 + 权限矩阵 **一片**。
- 本期**只超管重置密码**（无用户自助改密）。
- （新）禁用账号 = 设 `锁定到期` 远期（复用 `AuthService` 已有 `锁定到期>now` 登录门控，**不改 AuthService**）；启用/解锁 = 清 `锁定到期`+`登录失败次数`。

---

## 1. 数据模型 — 零改表

- `sysfileuser`：用户(用户名)/密码(bcrypt)/登录状态(运行态'在线')/上次登录/日期/登录失败次数/锁定到期。账号主体。
- `userbqrpower`：用户/名称/菜单/打开/保存/删除/打印/单价/金额/审核/反审核/功能（9 位）。权限。
- 无新建/ALTER 脚本；不改 `AuthService`（禁用走 锁定到期）。

## 2. 菜单目录（`src/ErpApi/Features/Admin/MenuCatalog.cs`）

静态 `IReadOnlyList<(string 组, string 菜单)>`，集中列出**所有 9 位权限菜单**，分组对应前端菜单组。实现时按现有控制器 `Menu` 常量 + `web/src/pages/master/configs` (MASTER_CONFIGS) 枚举校准，至少含：
- **基础资料**：客户资料/供应商资料/加工厂资料/物料资料/款号资料/部门信息/人事档案/报价资料/调价/发外加工项目（以 MASTER_CONFIGS 实际菜单名为准）。
- **业务单据**：成品客户订货单、生产制单。
- **物料管理**：采购入仓单、领料单、退料单、物料库存。
- **生产车间**：裁床单、计件、计件汇总。
- **发外加工**：发外加工、发外回收、发外对数。
- **成品仓储**：成品入仓、成品出仓、成品盘点、成品库存、成品调拨、成品退货、成品退仓。
- **半成品仓储**：半成品入仓、半成品领料、半成品盘点、半成品库存。
- **月结管理**：库存月结。
- **销售管理**：销售出货、销售退货、销售收款、应收对账。
- **应付管理**：采购付款、发外付款、应付对账。
- **工资管理**：计件归集、缺勤登记、出勤汇总、工资模板、工资表。
- **系统管理**：系统配置。
- **管理后台**：账号管理。
- `GET api/admin/menus` 返回分组目录（9 位为统一列，超管按需勾选；某些菜单仅个别位有意义，由超管判断）。

## 3. 账号服务（`src/ErpApi/Features/Admin/AccountService.cs`）

注入 `ISqlConnectionFactory factory, IPasswordHasher hasher`：
- `ListAsync(keyword?)`：`SELECT [用户],[登录状态],[上次登录],[日期],[登录失败次数],[锁定到期] FROM [sysfileuser] WHERE @kw IS NULL OR [用户] LIKE @kw ORDER BY [用户]`——**绝不返回密码**；附 `已锁定 = 锁定到期>now`。
- `RegisterAsync(用户名, 初始密码, user)`：校验 用户名非空/唯一（存在→抛）；`INSERT [sysfileuser]([用户],[密码],[登录状态],[登录失败次数]) VALUES(@用户,@hash,N'',0)`，hash=`hasher.Hash(初始密码)`。
- `ResetPasswordAsync(用户名, 新密码)`：`UPDATE [密码]=@hash WHERE [用户]=@`。存在性校验。
- `LockAsync(用户名)`（禁用）：`UPDATE [锁定到期]='2999-12-31' WHERE [用户]=@`。
- `UnlockAsync(用户名)`（启用/解锁）：`UPDATE [锁定到期]=NULL,[登录失败次数]=0 WHERE [用户]=@`。
- `DeleteAsync(用户名)`：事务删 `userbqrpower WHERE 用户=@` + `sysfileuser WHERE 用户=@`。
- 不返回/记录明文密码；bcrypt 经 `IPasswordHasher`。

## 4. 权限管理服务（`src/ErpApi/Features/Admin/PermissionAdminService.cs`）

- `GetUserPermsAsync(用户名)`：对 MenuCatalog 每个菜单，取该用户 `userbqrpower` 对应行的 9 位（无行→全 false），返回 `[{组,菜单,打开,保存,删除,打印,单价,金额,审核,反审核,功能}]`。
- `SaveUserPermsAsync(用户名, rows[], operator)`（整组替换，事务）：`DELETE userbqrpower WHERE 用户=@`；对每个**至少一位为 true** 的菜单行 `INSERT userbqrpower([用户],[菜单],[打开]..[功能])`（全 false 的不写，减脏行）。`名称` 可填用户名。

DTO：`AccountRow {用户,登录状态,上次登录,日期,登录失败次数,锁定到期,已锁定}`、`RegisterDto {用户名,初始密码}`、`ResetPwdDto {新密码}`、`MenuPermRow {组?,菜单,打开,保存,删除,打印,单价,金额,审核,反审核,功能}`、`SaveUserPermsDto {用户名,明细:List<MenuPermRow>}`。

## 5. 控制器（`AdminController`，`api/admin`）+ 超管门控

所有端点用 `perms.HasAsync(CurrentUser, "账号管理", action)` 门控：
- `GET accounts`（list，打开）、`POST accounts`（register，保存）、`POST accounts/{用户}/reset-password`（保存）、`POST accounts/{用户}/lock`（功能）、`POST accounts/{用户}/unlock`（功能）、`DELETE accounts/{用户}`（删除）。
- `GET menus`（MenuCatalog，打开）。
- `GET accounts/{用户}/perms`（打开）、`PUT accounts/{用户}/perms`（保存）。
- **自我保护**：不能 删除/锁定 当前登录用户本人（`用户==CurrentUser`→400「不能停用/删除自己」）；保存自己权限时不能去掉自己的「账号管理·打开」（防自锁→400 或忽略该项保留）。
- 审计：register/reset/lock/unlock/delete/saveperms 写 AuditLog（表名 `sysfileuser`/`userbqrpower`）。
- DI 注册 `AccountService`、`PermissionAdminService`（`MenuCatalog` 静态）。
- 权限种子 `db/seed_admin_console_perms.sql`：admin 账号管理(打开/保存/删除/打印/功能=1)。

## 6. 前端

- `web/src/api/admin.ts`：`accountApi`(list/register/resetPassword/lock/unlock/remove)、`adminMenuApi.catalog()`、`userPermApi`(get/save) + 类型。
- 页面 `web/src/pages/admin/`：
  - `AccountPage.tsx`：账号列表（用户/登录状态/上次登录/已锁定）+ 注册(用户名+初始密码) + 行操作（重置密码/锁定·解锁/删除/编辑权限）。
  - `UserPermPage.tsx`（或抽屉）：选用户 → 按 MenuCatalog 分组的菜单 × 9 位 复选矩阵（行=菜单，列=9 位 Checkbox，组分隔），整组保存。可「全选某菜单/某列」便捷。
- 菜单：新独立顶级组 **「管理后台」**（key `admin`，仅 `can('账号管理','打开')` 可见）→ 账号管理；权限编辑从账号行进入（抽屉）或独立页。
- `App.tsx` 路由 `/admin/accounts`；Header 标题链补。

## 7. 测试

- 后端 `AccountServiceDbTests`：Register(用户名+密码) → List 命中且无密码字段泄露 → bcrypt 校验(`hasher.Verify(初始密码, 库内密码)` 真) → ResetPassword 后旧密码失败/新密码真 → Lock(锁定到期>now)/Unlock(清空) → Delete(连带 userbqrpower)。清理删测试用户。
- 后端 `PermissionAdminServiceDbTests`：SaveUserPerms(某用户 给 客户资料 打开/保存) → GetUserPerms 该菜单两位 true 其余菜单全 false → 整组替换(改为只 库存月结 打开) → 旧权限清掉。
- 后端 `AdminApiIntegrationTests`：无「账号管理」权限 → 所有 admin 端点 403；有权限 → register→list→saveperms→get→lock→unlock→delete 生命周期；删除/锁定自己 → 400。
- 前端 util/页面测试（权限矩阵行构建）。

## 8. 范围外（延后）

用户自助改密、角色/用户组（现为用户直授菜单）、登录审计明细查看、密码强度策略、双因子、菜单目录改为数据库表（现静态）。

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 密码泄露 | List/Get 绝不返回密码;bcrypt 经 IPasswordHasher;重置只写 hash。 |
| 超管自锁 | 不能删/锁自己;保存自身权限时保留「账号管理·打开」。 |
| 禁用不生效 | 禁用=锁定到期远期,复用 AuthService 已有 `锁定到期>now` 拒登,无需改认证。 |
| 菜单目录漂移 | MenuCatalog 集中维护;实现时对照控制器 Menu 常量+MASTER_CONFIGS 校准;后续新增菜单需同步目录(文档提示)。 |
| 删除连带权限 | DeleteAsync 事务删 userbqrpower+sysfileuser。 |
| 门控一致 | 所有 admin 端点统一 HasAsync("账号管理",...);admin 种子拥有。 |
