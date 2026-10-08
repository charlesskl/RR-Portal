-- 退仓→出仓 改名:userbqrpower 按菜单名授权,菜单键随代码改名同步迁移,否则旧授权失效。
-- 仅改权限菜单名;数据库表名([采购退仓单] 等)、DocType/单号、JSON 字段(退仓数量)均不动。幂等。
-- 辅料退仓单页面与采购退仓单共用「采购退仓单」键,只映射一次。
IF EXISTS (SELECT 1 FROM sys.tables WHERE name=N'userbqrpower')
BEGIN
    UPDATE [userbqrpower] SET [菜单]=N'采购出仓单'   WHERE [菜单]=N'采购退仓单';
    UPDATE [userbqrpower] SET [菜单]=N'采购出仓查询' WHERE [菜单]=N'采购退仓查询';
    UPDATE [userbqrpower] SET [菜单]=N'塑胶出仓单'   WHERE [菜单]=N'塑胶退仓单';
    UPDATE [userbqrpower] SET [菜单]=N'塑胶出仓查询' WHERE [菜单]=N'塑胶退仓查询';
    UPDATE [userbqrpower] SET [菜单]=N'原料出仓单'   WHERE [菜单]=N'原料退仓单';
    UPDATE [userbqrpower] SET [菜单]=N'原料出仓查询' WHERE [菜单]=N'原料退仓查询';
    UPDATE [userbqrpower] SET [菜单]=N'半成品出仓'   WHERE [菜单]=N'半成品退仓';
    UPDATE [userbqrpower] SET [菜单]=N'成品出仓单'   WHERE [菜单]=N'成品退仓';
    UPDATE [userbqrpower] SET [菜单]=N'辅料出仓查询' WHERE [菜单]=N'辅料退仓查询';
    -- 「塑胶订单制作」功能已删除,清掉旧授权
    DELETE FROM [userbqrpower] WHERE [菜单]=N'塑胶订单制作';
END
GO
