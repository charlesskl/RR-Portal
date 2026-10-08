-- 原料采购订单(原料仓库·采购计划)·头 + 明细。审核纯锁定不动库存。EF 不迁移·幂等。
IF OBJECT_ID(N'[原料采购订单]', N'U') IS NULL
CREATE TABLE [原料采购订单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [供应商编号] nvarchar(40) NULL,
    [供应商名称] nvarchar(80) NULL,
    [订购日期] datetime NULL,
    [交货日期] datetime NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[原料采购订单明细]', N'U') IS NULL
CREATE TABLE [原料采购订单明细] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [原料编号] nvarchar(40) NULL,
    [原料名称] nvarchar(80) NULL,
    [规格] nvarchar(60) NULL,
    [单位] nvarchar(20) NULL,
    [单价类型] nvarchar(20) NULL,
    [订货数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
