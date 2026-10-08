# 用户自助修改密码

日期：2026-07-28
分支：codex/semi-finished-label-order

## 背景
旧 ERP「基本设置 → 用户修改密码」：登录用户输入原密码后改新密码。此前系统只有管理员重置密码
（`AdminController.reset-password`，不校验原密码），无任何自助改密入口，菜单「用户修改密码」为占位项。

## 实现
- **后端** `POST /api/auth/change-password`，请求体 `{ 原密码, 新密码 }`：
  - `[Authorize]`，当前用户取自 JWT（NameIdentifier/sub），**无 9 位权限要求**，任何登录用户可改自己的密码。
  - `AuthService.ChangePasswordAsync`：先做输入校验（原/新密码必填、新密码 ≥ 6 位、新旧不能相同，
    校验在触库前返回，可纯单元测试），再 bcrypt 比对原密码（错误返回「原密码错误」），
    通过后用 `BcryptPasswordHasher`（workFactor 10，适配 sysfileuser.密码 nvarchar(60)）哈希写回。
  - 失败一律 `400 { 消息 }`（中文）；成功 `200 { 消息 = "密码修改成功" }`。
  - 审计：沿用 Admin 模块惯例（`IAuditLogger`），写 `sysfileuser / 修改密码 / 用户={当前用户}`。
- **前端**：
  - `web/src/api/auth.ts` — `authApi.changePassword({ 原密码, 新密码 })`（参考 admin.ts 封装）。
  - `web/src/pages/ChangePasswordPage.tsx` — antd Form：原密码/新密码/确认新密码，
    必填 + 最小 6 位 + 两次新密码一致性 + 新旧不同校验；成功 message 提示并 `resetFields()`，
    失败显示后端返回的中文消息。
  - **未改** `App.tsx` / `nav/menuTree.tsx`（路由接线由主会话统一做）。

## 变更清单
**新增**
- `tests/ErpApi.Tests/ChangePasswordTests.cs` — 4 个纯单元校验测试（不依赖 DB）+ 3 个 DB 集成测试
  （`[Collection("db")]`，未设 `ERP_TEST_DB` 自动跳过）
- `web/src/api/auth.ts`
- `web/src/pages/ChangePasswordPage.tsx`

**修改**
- `src/ErpApi/Features/Auth/AuthDtos.cs` — 加 `ChangePasswordRequest` / `ChangePasswordResult`
- `src/ErpApi/Features/Auth/AuthService.cs` — 加 `ChangePasswordAsync`
- `src/ErpApi/Features/Auth/AuthController.cs` — 加 change-password 端点；注入 `IAuditLogger`/`ISqlConnectionFactory` 写审计
- `src/ErpApi/Features/Styles/StyleDtos.cs` — 顺带修复：他处在途改动误写入一行字面量 `\r`（两个字符），导致 CS1056 编译失败，删除该行（仅恢复可编译，不改其新增内容）

## 验证（macOS）
- `dotnet build src/ErpApi` — 通过（0 警告 0 错误）。dotnet 位于 `~/.dotnet/dotnet`。
- `dotnet test tests/ErpApi.Tests --filter FullyQualifiedName~ChangePassword` — 通过 4，跳过 3
  （DB 集成测试，未设置 `ERP_TEST_DB`，属预期）。
- `cd web && npx tsc -b --force` — 通过（node 位于 `~/erp-tools/node/bin`）。

## 待办
- 主会话接线路由：`/change-password` → `ChangePasswordPage`，菜单「用户修改密码」指向该路由。
- 设 `ERP_TEST_DB` 后可跑 3 个 DB 集成测试（错原密码拒绝 / 改密后新密码可登录 / 用户不存在）。
