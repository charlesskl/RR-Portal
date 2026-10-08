IF OBJECT_ID(N'[半成品标签明细]', N'V') IS NOT NULL DROP VIEW [半成品标签明细];
IF OBJECT_ID(N'[半成品标签明细]', N'U') IS NOT NULL DROP TABLE [半成品标签明细];
IF OBJECT_ID(N'[半成品标签单]', N'U') IS NOT NULL DROP TABLE [半成品标签单];

IF OBJECT_ID(N'[sysfileuser]', N'U') IS NULL
BEGIN
    CREATE TABLE [sysfileuser] ([用户] nvarchar(40) NULL);
END;

IF OBJECT_ID(N'[userbqrpower]', N'U') IS NULL
BEGIN
    CREATE TABLE [userbqrpower] (
        [用户] nvarchar(30) NOT NULL,
        [名称] nvarchar(40) NULL,
        [菜单] nvarchar(50) NOT NULL,
        [打开] bit NULL,
        [保存] bit NULL,
        [删除] bit NULL,
        [打印] bit NULL,
        [单价] bit NULL,
        [金额] bit NULL,
        [审核] bit NULL,
        [反审核] bit NULL,
        [功能] bit NULL,
        CONSTRAINT [UQ_verify_userbqrpower] UNIQUE ([用户], [菜单])
    );
END;

TRUNCATE TABLE [sysfileuser];
TRUNCATE TABLE [userbqrpower];

INSERT INTO [sysfileuser] ([用户])
VALUES (REPLICATE(N'V', 30)), (REPLICATE(N'X', 31));
