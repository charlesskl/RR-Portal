/* =====================================================================
   用户管理 · sys_user 加「角色」列（业务/外发/跟单/品质/管理层/管理员）
   目标库 : StitchCostPro (SQL Server)
   跑法   : sqlcmd -S "localhost\SQLEXPRESS" -d StitchCostPro -E -C -f 65001 -i "db/2026-06-26_sysuser_role.sql"
   编制   : 2026-06-26  幂等
   ===================================================================== */
USE [StitchCostPro];
GO

IF COL_LENGTH(N'dbo.sys_user', N'role') IS NULL
BEGIN
    ALTER TABLE dbo.sys_user ADD role NVARCHAR(20) NULL;   -- 角色（中文）
END
GO

-- 已有 admin 回填为「管理员」（仅当前为空时）
UPDATE dbo.sys_user SET role = N'管理员' WHERE username = N'admin' AND (role IS NULL OR role = N'');
GO

PRINT N'====== sys_user.role 列已就绪 ======';
GO
