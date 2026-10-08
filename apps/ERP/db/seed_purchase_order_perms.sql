-- 开发用：给 admin 授予 采购订单 菜单的全部 9 位权限(打开/保存/删除/打印/单价/金额/审核/反审核/功能)。
-- 用法：在目标库执行。幂等。
DECLARE @用户 nvarchar(30) = N'admin';
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单]=N'采购订单';
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES(@用户,N'采购订单',1,1,1,1,1,1,1,1,1);
