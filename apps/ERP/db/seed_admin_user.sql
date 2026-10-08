-- seed_admin_user.sql
-- 全新空库首个登录账号：仅当 sysfileuser 为空时插入 admin（幂等，绝不覆盖已有账号）。
-- 密码为 admin123 的 bcrypt(workFactor 10) 哈希（$2a$ 前缀，BCrypt.Net-Next 可校验）。
-- 各 seed_*_perms.sql 负责给 admin 授菜单权限；首次登录后请立即在「账号管理」改密。
IF NOT EXISTS (SELECT 1 FROM [sysfileuser])
BEGIN
  INSERT INTO [sysfileuser] ([用户],[密码],[登录状态])
  VALUES (N'admin', N'$2a$10$fnfegIYXygEq1MYOa5wruOUhhidGxM4/pcb58kpq8XBSpGRm4nk8y', N'');
  PRINT N'空库：已创建初始账号 admin';
END
