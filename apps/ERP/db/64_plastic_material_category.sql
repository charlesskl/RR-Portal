-- 塑胶物料资料左树分类管理:塑胶物料类别主数据表(镜像 db/01 [物料类别] 结构;父级=类别列,指向父类别编号/名称)。幂等。
IF OBJECT_ID(N'[塑胶物料类别]', N'U') IS NULL
CREATE TABLE [塑胶物料类别] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [编号] nvarchar(20) NULL,
    [名称] nvarchar(40) NULL,
    [类别] nvarchar(30) NULL,
    [备注] nvarchar(max) NULL
);
