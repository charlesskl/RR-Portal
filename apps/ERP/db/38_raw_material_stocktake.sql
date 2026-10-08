-- 原料盘点单(原料仓库·以实盘校准账面)·头 + 明细。审核时 UPDATE 塑胶原料资料.库存=盘点数量。EF 不迁移·幂等。
IF OBJECT_ID(N'[原料盘点单]', N'U') IS NULL
CREATE TABLE [原料盘点单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [日期] datetime NULL,
    [电脑单号] nvarchar(40) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[原料盘点明细单]', N'U') IS NULL
CREATE TABLE [原料盘点明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [原料编号] nvarchar(40) NULL,
    [原料名称] nvarchar(80) NULL,
    [产地] nvarchar(60) NULL,
    [每包重量] decimal(18,4) NULL,
    [单位] nvarchar(20) NULL,
    [系统数量] decimal(18,4) NULL,
    [盘点数量] decimal(18,4) NULL,
    [盈亏数量] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
