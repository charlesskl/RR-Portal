-- 塑胶出仓→退仓 改名（回退 db/88 中塑胶两行）：userbqrpower 按菜单名授权，菜单键随代码改名同步迁移，否则旧授权失效。
-- 仅改塑胶两键；采购/原料/半成品/成品/辅料维持"出仓"不变。表名/DocType/单号均不动。幂等。
IF EXISTS (SELECT 1 FROM sys.tables WHERE name=N'userbqrpower')
BEGIN
    UPDATE [userbqrpower] SET [菜单]=N'塑胶退仓单'   WHERE [菜单]=N'塑胶出仓单';
    UPDATE [userbqrpower] SET [菜单]=N'塑胶退仓查询' WHERE [菜单]=N'塑胶出仓查询';
END
GO
