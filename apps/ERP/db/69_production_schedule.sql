-- 客户排期（各客户 Excel 排期表导入）第①片：排期批次 + 排期明细。幂等(可重跑)。
-- 不加 FK(应用层保证);不 drop/rename。
SET XACT_ABORT ON;

-- 1) 排期批次：一次 Excel 导入产生一个批次（排期客户=排期表所属客户，如 ZURU/TOMY）
IF OBJECT_ID(N'生产排期批次', N'U') IS NULL
    CREATE TABLE [生产排期批次](
        [ID] bigint IDENTITY(1,1) PRIMARY KEY,
        [排期客户] nvarchar(60) NOT NULL,
        [文件名] nvarchar(200) NULL,
        [导入日期] datetime NOT NULL,
        [操作员] nvarchar(30) NULL,
        [新增] int NOT NULL CONSTRAINT [DF_生产排期批次_新增] DEFAULT(0),
        [更新] int NOT NULL CONSTRAINT [DF_生产排期批次_更新] DEFAULT(0),
        [备注] nvarchar(200) NULL
    );

-- 2) 排期明细：一行 = 排期表一行（客户 PO 级）。状态:在排/已走货/已取消(由来源工作表推定)
IF OBJECT_ID(N'生产排期', N'U') IS NULL
    CREATE TABLE [生产排期](
        [ID] bigint IDENTITY(1,1) PRIMARY KEY,
        [批次ID] bigint NOT NULL,
        [排期客户] nvarchar(60) NOT NULL,
        [状态] nvarchar(10) NOT NULL CONSTRAINT [DF_生产排期_状态] DEFAULT(N'在排'),
        [接单日期] datetime NULL,
        [客户名称] nvarchar(60) NULL,
        [国家] nvarchar(40) NULL,
        [PO号] nvarchar(60) NULL,
        [客PO] nvarchar(60) NULL,
        [SKU] nvarchar(60) NULL,
        [货号] nvarchar(60) NULL,
        [品名] nvarchar(100) NULL,
        [数量] decimal(18,2) NULL,
        [内箱] int NULL,
        [外箱] int NULL,
        [总箱数] decimal(18,2) NULL,
        [走货期] datetime NULL,
        [验货期] datetime NULL,
        [第三方验货] nvarchar(10) NULL,
        [车间] nvarchar(20) NULL,
        [来源工作表] nvarchar(40) NULL,
        [Excel行号] int NULL,
        [备注] nvarchar(400) NULL,
        [创建日期] datetime NOT NULL CONSTRAINT [DF_生产排期_创建日期] DEFAULT(GETDATE()),
        [操作员] nvarchar(30) NULL
    );

-- 3) 索引（幂等）
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_生产排期_批次ID')
    CREATE INDEX [IX_生产排期_批次ID] ON [生产排期]([批次ID]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_生产排期_排期客户状态')
    CREATE INDEX [IX_生产排期_排期客户状态] ON [生产排期]([排期客户],[状态]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_生产排期_货号')
    CREATE INDEX [IX_生产排期_货号] ON [生产排期]([货号]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_生产排期_走货期')
    CREATE INDEX [IX_生产排期_走货期] ON [生产排期]([走货期]);
