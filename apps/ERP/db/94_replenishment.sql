-- 补料区「补料单」：装配生产中物料损坏补料。流程=装配开单→仓库审核出库(审核才扣库存,同领料单模式)。
-- 仓库=来料仓/塑胶仓(单头选,冗余到明细行);库存由台账 UNION 实时聚合(见 MaterialInventoryService/PlasticInventoryService)。幂等。
IF OBJECT_ID(N'[补料单]', N'U') IS NULL
BEGIN
    CREATE TABLE [补料单] (
        [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_补料单] PRIMARY KEY,
        [单号] nvarchar(30) NOT NULL,
        [日期] datetime2(0) NULL,
        [部门] nvarchar(50) NULL,
        [生产单号] nvarchar(30) NULL,
        [款号] nvarchar(30) NULL,
        [仓库] nvarchar(20) NOT NULL,
        [数量] decimal(18,4) NULL,
        [操作员] nvarchar(50) NULL,
        [审核] nvarchar(1) NOT NULL CONSTRAINT [DF_补料单_审核] DEFAULT (N'0'),
        [审核人] nvarchar(50) NULL,
        [审核时间] datetime2 NULL,
        [备注] nvarchar(200) NULL,
        [创建时间] datetime2 NOT NULL CONSTRAINT [DF_补料单_创建时间] DEFAULT (SYSDATETIME())
    );
END;
GO

IF OBJECT_ID(N'[补料明细单]', N'U') IS NULL
BEGIN
    CREATE TABLE [补料明细单] (
        [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_补料明细单] PRIMARY KEY,
        [单号] nvarchar(30) NOT NULL,
        [物料编号] nvarchar(50) NOT NULL,
        [物料名称] nvarchar(100) NULL,
        [规格] nvarchar(100) NULL,
        [颜色] nvarchar(50) NULL,
        [单位] nvarchar(20) NULL,
        [数量] decimal(18,4) NOT NULL,
        [仓库] nvarchar(20) NOT NULL,
        [备注] nvarchar(200) NULL
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_补料单_单号' AND object_id = OBJECT_ID(N'[补料单]'))
    CREATE UNIQUE INDEX [UX_补料单_单号] ON [补料单] ([单号]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_补料明细单_单号' AND object_id = OBJECT_ID(N'[补料明细单]'))
    CREATE INDEX [IX_补料明细单_单号] ON [补料明细单] ([单号]);
GO
