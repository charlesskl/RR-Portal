-- 塑胶采购订单(塑胶采购单)头+明细。新表·EF 不迁移。审核三件套:头含 审核/审核人/审核日期。
IF OBJECT_ID(N'[塑胶采购订单]', N'U') IS NULL
CREATE TABLE [塑胶采购订单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [日期] datetime NULL,
    [交货日期] datetime NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(60) NULL,
    [客户名称] nvarchar(60) NULL,
    [交货地点] nvarchar(60) NULL,
    [编号] nvarchar(40) NULL,
    [数量] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[塑胶采购订单明细]', N'U') IS NULL
CREATE TABLE [塑胶采购订单明细] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(40) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [模具编号] nvarchar(30) NULL,
    [用量] decimal(18,4) NULL,
    [套数] decimal(18,4) NULL,
    [数量] decimal(18,4) NULL,
    [颜色] nvarchar(20) NULL,
    [色粉号] nvarchar(30) NULL,
    [用料名称] nvarchar(40) NULL,
    [备注] nvarchar(200) NULL
);
