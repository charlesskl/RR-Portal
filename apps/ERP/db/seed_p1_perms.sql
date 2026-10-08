-- 开发用:给某用户授予所有 P1 主数据菜单的 打开/保存/删除/单价 等权限。
-- 用法:把 @用户 改成你的登录名,在目标库执行。
DECLARE @用户 nvarchar(30) = N'admin';
DECLARE @menus TABLE([菜单] nvarchar(40));
INSERT INTO @menus VALUES
 (N'客户类别'),(N'客户资料'),(N'供应商类别'),(N'供应商资料'),
 (N'加工厂类别'),(N'加工厂资料'),(N'物料类别'),(N'物料资料'),
 (N'部门信息'),(N'人事档案'),(N'报价类别'),(N'报价资料'),(N'调价');
DELETE FROM [userbqrpower] WHERE [用户]=@用户 AND [菜单] IN (SELECT [菜单] FROM @menus);
INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
SELECT @用户,[菜单],1,1,1,1,1,1,0,0,1 FROM @menus;
