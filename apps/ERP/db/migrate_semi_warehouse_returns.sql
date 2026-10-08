SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'[半成品退仓单]', N'U') IS NULL
BEGIN
    CREATE TABLE [半成品退仓单] (
        [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_半成品退仓单] PRIMARY KEY,
        [单号] nvarchar(40) NOT NULL CONSTRAINT [UQ_半成品退仓单_单号] UNIQUE,
        [入仓单号] nvarchar(40) NOT NULL,
        [日期] date NOT NULL,
        [供应商编号] nvarchar(80) NULL,
        [供应商名称] nvarchar(200) NULL,
        [仓库] nvarchar(80) NOT NULL,
        [数量] decimal(18,4) NOT NULL,
        [金额] decimal(18,4) NOT NULL,
        [操作员] nvarchar(80) NOT NULL,
        [审核] char(1) NOT NULL CONSTRAINT [DF_半成品退仓单_审核] DEFAULT ('0'),
        [审核人] nvarchar(80) NULL,
        [审核日期] datetime2 NULL,
        [备注] nvarchar(500) NULL,
        CONSTRAINT [CK_半成品退仓单_审核] CHECK ([审核] IN ('0','1'))
    );
END;

IF OBJECT_ID(N'[半成品退仓明细单]', N'U') IS NULL
BEGIN
    CREATE TABLE [半成品退仓明细单] (
        [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_半成品退仓明细单] PRIMARY KEY,
        [单号] nvarchar(40) NOT NULL,
        [入仓单号] nvarchar(40) NOT NULL,
        [入仓明细ID] bigint NULL,
        [日期] date NOT NULL,
        [供应商编号] nvarchar(80) NULL,
        [供应商名称] nvarchar(200) NULL,
        [仓库] nvarchar(80) NOT NULL,
        [订单单号] nvarchar(80) NULL,
        [客户] nvarchar(160) NULL,
        [生产单号] nvarchar(80) NULL,
        [货号] nvarchar(120) NULL,
        [名称] nvarchar(240) NULL,
        [物料编号] nvarchar(120) NULL,
        [物料名称] nvarchar(240) NULL,
        [规格] nvarchar(160) NULL,
        [颜色] nvarchar(80) NULL,
        [单位] nvarchar(40) NULL,
        [数量] decimal(18,4) NOT NULL,
        [单价] decimal(18,4) NOT NULL,
        [金额] decimal(18,4) NOT NULL,
        [备注] nvarchar(500) NULL,
        CONSTRAINT [FK_半成品退仓明细单_单号] FOREIGN KEY ([单号]) REFERENCES [半成品退仓单]([单号]) ON DELETE CASCADE,
        CONSTRAINT [UQ_半成品退仓明细单_物料] UNIQUE ([单号], [物料编号]),
        CONSTRAINT [CK_半成品退仓明细单_数量] CHECK ([数量] > 0)
    );
END;

-- 升级：旧结构（入仓明细ID NOT NULL + UQ_来源）迁到自由选产品结构
IF OBJECT_ID(N'[半成品退仓明细单]', N'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = N'UQ_半成品退仓明细单_来源')
        ALTER TABLE [半成品退仓明细单] DROP CONSTRAINT [UQ_半成品退仓明细单_来源];
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_半成品退仓明细单_入仓明细ID' AND object_id = OBJECT_ID(N'[半成品退仓明细单]'))
        DROP INDEX [IX_半成品退仓明细单_入仓明细ID] ON [半成品退仓明细单];
    IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[半成品退仓明细单]') AND name = N'入仓明细ID' AND is_nullable = 0)
        ALTER TABLE [半成品退仓明细单] ALTER COLUMN [入仓明细ID] bigint NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = N'UQ_半成品退仓明细单_物料')
        ALTER TABLE [半成品退仓明细单] ADD CONSTRAINT [UQ_半成品退仓明细单_物料] UNIQUE ([单号], [物料编号]);
END;

COMMIT TRANSACTION;
