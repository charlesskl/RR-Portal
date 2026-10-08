-- 采购出仓→退仓 改名（回退 db/88 中采购两行）：userbqrpower 按菜单名授权，菜单键随代码改名同步迁移，否则旧授权失效。
-- 来料仓退回供应商业务使用本单（表名 [采购退仓单]、前缀 CT 本就叫退仓，不动）。辅料出仓单页面共用「采购出仓单」键，一并平移。幂等。
IF EXISTS (SELECT 1 FROM sys.tables WHERE name=N'userbqrpower')
BEGIN
    UPDATE [userbqrpower] SET [菜单]=N'采购退仓单'   WHERE [菜单]=N'采购出仓单';
    UPDATE [userbqrpower] SET [菜单]=N'采购退仓查询' WHERE [菜单]=N'采购出仓查询';
END
GO
