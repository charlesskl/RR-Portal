-- 原料入仓单(原料仓库·实物入库)·头 + 明细。v1 审核纯锁定不动库存(库存台账延后)。EF 不迁移·幂等。
IF OBJECT_ID(N'[原料入仓单]', N'U') IS NULL
CREATE TABLE [原料入仓单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [供应商编号] nvarchar(40) NULL,
    [供应商名称] nvarchar(80) NULL,
    [日期] datetime NULL,
    [电脑单号] nvarchar(40) NULL,
    [订单单号] nvarchar(20) NULL,
    [单价类型] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[原料入仓明细单]', N'U') IS NULL
CREATE TABLE [原料入仓明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [原料编号] nvarchar(40) NULL,
    [原料名称] nvarchar(80) NULL,
    [产地] nvarchar(60) NULL,
    [每包重量] decimal(18,4) NULL,
    [单价类型] nvarchar(20) NULL,
    [单位] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
