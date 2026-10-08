-- 塑胶模块 P2:塑胶物料单(头)+ 塑胶物料明细单(明细)。按生产单货号从塑胶共用物料表带出的采购单据。
IF OBJECT_ID(N'[塑胶物料单]', N'U') IS NULL
CREATE TABLE [塑胶物料单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [日期] datetime NULL,
    [生产单号] nvarchar(50) NULL,
    [货号] nvarchar(40) NULL,
    [客户] nvarchar(50) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
-- 过账引擎(PostingEngine)审核时会写 [审核日期];已建表则补列。
IF COL_LENGTH(N'[塑胶物料单]', N'审核日期') IS NULL
    ALTER TABLE [塑胶物料单] ADD [审核日期] datetime NULL;
IF OBJECT_ID(N'[塑胶物料明细单]', N'U') IS NULL
CREATE TABLE [塑胶物料明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [生产单号] nvarchar(50) NULL,
    [货号] nvarchar(40) NULL,
    [工模编号] nvarchar(30) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [仓位号] nvarchar(30) NULL,
    [用料名称] nvarchar(40) NULL,
    [加工内容] nvarchar(50) NULL,
    [加工单价] decimal(18,4) NULL,
    [用量] decimal(18,4) NULL,
    [订购数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
