-- 「装配加工采购单」改名「委托加工单」(显示层改名;数据表名/单号流水 DocType 不动)。
-- 权限矩阵 userbqrpower 按 菜单 名称挂权限,随 MenuCatalog 改名迁移存量行:
-- ① 目标行已存在:按位合并(任一为 true 即 true,口径同 db/110);
-- ② 其余旧名行直接改名。
UPDATE p SET
    [打开]=CASE WHEN ISNULL(p.[打开],0)=1 OR ISNULL(o.[打开],0)=1 THEN 1 ELSE 0 END,
    [保存]=CASE WHEN ISNULL(p.[保存],0)=1 OR ISNULL(o.[保存],0)=1 THEN 1 ELSE 0 END,
    [删除]=CASE WHEN ISNULL(p.[删除],0)=1 OR ISNULL(o.[删除],0)=1 THEN 1 ELSE 0 END,
    [打印]=CASE WHEN ISNULL(p.[打印],0)=1 OR ISNULL(o.[打印],0)=1 THEN 1 ELSE 0 END,
    [单价]=CASE WHEN ISNULL(p.[单价],0)=1 OR ISNULL(o.[单价],0)=1 THEN 1 ELSE 0 END,
    [金额]=CASE WHEN ISNULL(p.[金额],0)=1 OR ISNULL(o.[金额],0)=1 THEN 1 ELSE 0 END,
    [审核]=CASE WHEN ISNULL(p.[审核],0)=1 OR ISNULL(o.[审核],0)=1 THEN 1 ELSE 0 END,
    [反审核]=CASE WHEN ISNULL(p.[反审核],0)=1 OR ISNULL(o.[反审核],0)=1 THEN 1 ELSE 0 END,
    [功能]=CASE WHEN ISNULL(p.[功能],0)=1 OR ISNULL(o.[功能],0)=1 THEN 1 ELSE 0 END
FROM [dbo].[userbqrpower] p
JOIN [dbo].[userbqrpower] o ON o.[用户]=p.[用户] AND o.[菜单]=N'装配加工采购单'
WHERE p.[菜单]=N'委托加工单';
GO
UPDATE [dbo].[userbqrpower] SET [菜单]=N'委托加工单' WHERE [菜单]=N'装配加工采购单';
GO
