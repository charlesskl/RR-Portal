DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (N'班次管理',N'排班');
INSERT INTO [userbqrpower]([用户],[名称],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES (@用户,@用户,N'班次管理',1,1,1,1,0,0,0,0,1),
       (@用户,@用户,N'排班',1,1,1,1,0,0,0,0,1);
