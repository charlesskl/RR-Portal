-- 开发用：给某用户授予 P6a 销售出货/退货 菜单权限。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'销售出货',N'销售退货');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'销售出货',1,1,1,1,1,1,1,1,1),
       (@用户,N'销售退货',1,1,1,1,1,1,1,1,1);
