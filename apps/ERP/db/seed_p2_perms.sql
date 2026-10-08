-- 开发用:给某用户授予 P2 业务菜单(款号资料/成品客户订货单/生产制单)的全部权限。
-- 用法:把 @用户 改成你的登录名,在目标库执行。
DECLARE @用户 nvarchar(30) = N'admin';
DECLARE @menus TABLE([菜单] nvarchar(40));
INSERT INTO @menus VALUES (N'款号资料'),(N'成品客户订货单'),(N'生产制单');
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (SELECT [菜单] FROM @menus);
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
SELECT @用户,[菜单],1,1,1,1,1,1,1,1,1 FROM @menus;
