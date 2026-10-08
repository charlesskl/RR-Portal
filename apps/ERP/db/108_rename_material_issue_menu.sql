-- 来料仓「领料单」菜单/权限键改名为「来料领料单」，与塑胶仓「塑胶领料单」对齐。
-- 仅改权限菜单名；表名([领料单])、DocType、单号前缀 LL 不动。半成品出仓单/来料出仓单/辅料领料等入口共用此键，一并平移。幂等。
IF EXISTS (SELECT 1 FROM sys.tables WHERE name=N'userbqrpower')
BEGIN
    UPDATE [userbqrpower] SET [菜单]=N'来料领料单'   WHERE [菜单]=N'领料单';
    UPDATE [userbqrpower] SET [菜单]=N'来料领料查询' WHERE [菜单]=N'领料单查询';
END
GO
