IF OBJECT_ID(N'[款号物料明细表]', N'U') IS NOT NULL
   AND COL_LENGTH(N'[款号物料明细表]', N'工模编号') IS NULL
BEGIN
  ALTER TABLE [款号物料明细表] ADD [工模编号] nvarchar(100) NULL;
END;

IF OBJECT_ID(N'[半成品共用物料设置]', N'U') IS NULL
BEGIN
  CREATE TABLE [半成品共用物料设置](
    [ID] bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [产品货号] nvarchar(100) NOT NULL,
    [产品装配名称] nvarchar(200) NULL,
    [配件编号] nvarchar(100) NULL,
    [共用物料编号] nvarchar(100) NULL,
    [装配方式] nvarchar(100) NULL,
    [类别] nvarchar(50) NULL,
    [库存单价HK] decimal(18,4) NULL,
    [其他成本HK] decimal(18,4) NULL,
    [需求用量] decimal(18,4) NULL,
    [单位] nvarchar(30) NULL,
    [半成品计算库存] bit NOT NULL CONSTRAINT [DF_半成品共用物料设置_计算库存] DEFAULT(0),
    [备注内容] nvarchar(500) NULL,
    [调整审核] bit NOT NULL CONSTRAINT [DF_半成品共用物料设置_审核] DEFAULT(0),
    [审核人] nvarchar(50) NULL,
    [审核时间] datetime2 NULL,
    [更新人] nvarchar(50) NULL,
    [更新时间] datetime2 NOT NULL CONSTRAINT [DF_半成品共用物料设置_更新时间] DEFAULT(SYSDATETIME())
  );
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'UX_半成品共用物料设置_产品货号' AND object_id = OBJECT_ID(N'[半成品共用物料设置]'))
  CREATE UNIQUE INDEX [UX_半成品共用物料设置_产品货号] ON [半成品共用物料设置]([产品货号]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_半成品共用物料设置_共用审核' AND object_id = OBJECT_ID(N'[半成品共用物料设置]'))
  CREATE INDEX [IX_半成品共用物料设置_共用审核] ON [半成品共用物料设置]([共用物料编号],[调整审核]);

IF OBJECT_ID(N'[装配物料报价]', N'U') IS NULL
BEGIN
  CREATE TABLE [装配物料报价](
    [ID] bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [产品货号] nvarchar(100) NOT NULL,
    [物料编号] nvarchar(100) NULL,
    [物料名称] nvarchar(200) NULL,
    [合作方类型] nvarchar(20) NOT NULL,
    [合作方编号] nvarchar(50) NULL,
    [合作方名称] nvarchar(200) NULL,
    [报价日期] date NULL,
    [货币] nvarchar(20) NULL,
    [单价] decimal(18,4) NULL,
    [港币价] decimal(18,4) NULL,
    [对比相差] decimal(18,4) NULL,
    [相差比例] decimal(18,4) NULL,
    [是否默认] bit NOT NULL CONSTRAINT [DF_装配物料报价_默认] DEFAULT(0),
    [顺序] int NOT NULL CONSTRAINT [DF_装配物料报价_顺序] DEFAULT(0),
    [备注] nvarchar(500) NULL
  );
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_装配物料报价_产品货号' AND object_id = OBJECT_ID(N'[装配物料报价]'))
  CREATE INDEX [IX_装配物料报价_产品货号] ON [装配物料报价]([产品货号],[顺序],[ID]);
