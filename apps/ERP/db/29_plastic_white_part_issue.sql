-- 白件领料单(发外加工·白件半成品发外)·头 + 明细。审核纯锁定不动库存。EF 不迁移。
IF OBJECT_ID(N'[白件领料单]', N'U') IS NULL
CREATE TABLE [白件领料单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [日期] datetime NULL,
    [领料部门] nvarchar(40) NULL,
    [领料人] nvarchar(30) NULL,
    [胶箱数] decimal(18,4) NULL,
    [卡板数] decimal(18,4) NULL,
    [领料备注] nvarchar(30) NULL,
    [数量] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [电脑单号] nvarchar(30) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[白件领料明细单]', N'U') IS NULL
CREATE TABLE [白件领料明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [发外采购] nvarchar(20) NULL,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(40) NULL,
    [物料编号] nvarchar(20) NULL,
    [模具编号] nvarchar(30) NULL,
    [物料名称] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [用料名称] nvarchar(40) NULL,
    [单位] nvarchar(10) NULL,
    [数量] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
