-- 开发用:给某用户授予 工模表 菜单的 9 位权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'工模表');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'工模表',1,1,1,1,1,1,1,1,1);
