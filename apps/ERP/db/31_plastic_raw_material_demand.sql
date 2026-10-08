-- 原料生产需求表(原料仓库·生产领料需求计划)·头 + 明细。审核纯锁定不动库存。EF 不迁移·幂等。
IF OBJECT_ID(N'[原料生产需求表]', N'U') IS NULL
CREATE TABLE [原料生产需求表] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [啤机生产单号] nvarchar(50) NULL,
    [开单日期] datetime NULL,
    [制单人] nvarchar(30) NULL,
    [领料备注] nvarchar(30) NULL,
    [生产车间] nvarchar(40) NULL,
    [操作员] nvarchar(20) NULL,
    [数量KG] decimal(18,4) NULL,
    [数量包] decimal(18,4) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[原料生产需求明细单]', N'U') IS NULL
CREATE TABLE [原料生产需求明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [原料编号] nvarchar(40) NULL,
    [原料名称] nvarchar(80) NULL,
    [每包重量] decimal(18,4) NULL,
    [单位] nvarchar(20) NULL,
    [需求数量KG] decimal(18,4) NULL,
    [需求数量包] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
