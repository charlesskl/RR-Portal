-- 塑胶加工采购单(发外加工)·头 + 明细。EF 不迁移。
IF OBJECT_ID(N'[塑胶加工采购单]', N'U') IS NULL
CREATE TABLE [塑胶加工采购单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [日期] datetime NULL,
    [交货日期] datetime NULL,
    [加工厂编号] nvarchar(20) NULL,
    [加工厂名称] nvarchar(60) NULL,
    [客户名称] nvarchar(60) NULL,
    [收货仓库] nvarchar(30) NULL,
    [收货人] nvarchar(30) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[塑胶加工采购单明细]', N'U') IS NULL
CREATE TABLE [塑胶加工采购单明细] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(40) NULL,
    [模具编号] nvarchar(30) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [用料名称] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [加工内容] nvarchar(50) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
