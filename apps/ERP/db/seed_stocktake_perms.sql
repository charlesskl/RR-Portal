-- 开发用：给某用户授予 盘点单 菜单的 9 位权限。
-- 用法：把 @用户 改成你的登录名，在目标库执行。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'盘点单');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'盘点单',1,1,1,1,1,1,1,1,1);
