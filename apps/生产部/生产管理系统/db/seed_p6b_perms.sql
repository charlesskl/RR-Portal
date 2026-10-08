-- P6b 权限种子：admin 销售收款（全）+ 应收对账（打开/打印/金额/功能）
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'销售收款',N'应收对账');
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,N'销售收款',1,1,1,1,1,1,1,1,1),
       (@用户,N'应收对账',1,0,0,1,0,1,0,0,1);
