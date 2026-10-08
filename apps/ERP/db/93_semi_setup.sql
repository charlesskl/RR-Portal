-- BOM 物料设置「设置半成品/设置包装」：一个货号可定义多个命名半成品/包装，各自记录由哪些 BOM 物料组合而成。
-- 与现有 半成品共用物料设置/SemiBomExpander 是两套模型，互不影响。幂等。
IF OBJECT_ID(N'[半成品设置]', N'U') IS NULL
BEGIN
    CREATE TABLE [半成品设置] (
        [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_半成品设置] PRIMARY KEY,
        [货号] nvarchar(50) NOT NULL,
        [名称] nvarchar(100) NOT NULL,
        [类型] nvarchar(10) NOT NULL CONSTRAINT [DF_半成品设置_类型] DEFAULT (N'半成品'),
        [顺序] int NOT NULL CONSTRAINT [DF_半成品设置_顺序] DEFAULT (0),
        [操作员] nvarchar(50) NULL,
        [创建时间] datetime2 NOT NULL CONSTRAINT [DF_半成品设置_创建时间] DEFAULT (SYSDATETIME())
    );
END;
GO

IF OBJECT_ID(N'[半成品设置明细]', N'U') IS NULL
BEGIN
    CREATE TABLE [半成品设置明细] (
        [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_半成品设置明细] PRIMARY KEY,
        [头ID] bigint NOT NULL,
        [物料编号] nvarchar(50) NOT NULL,
        [物料名称] nvarchar(100) NULL,
        [规格] nvarchar(100) NULL,
        [颜色] nvarchar(50) NULL,
        [单位] nvarchar(20) NULL,
        [使用数量] decimal(18,4) NULL
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_半成品设置_货号类型' AND object_id = OBJECT_ID(N'[半成品设置]'))
    CREATE INDEX [IX_半成品设置_货号类型] ON [半成品设置] ([货号], [类型]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_半成品设置明细_头ID' AND object_id = OBJECT_ID(N'[半成品设置明细]'))
    CREATE INDEX [IX_半成品设置明细_头ID] ON [半成品设置明细] ([头ID]);
GO
