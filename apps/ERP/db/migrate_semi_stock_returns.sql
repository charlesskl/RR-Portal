-- 半成品退库单（自由选产品版）：净新两表。库存方向 + 在 union 分支处理。
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'[半成品退库单]', N'U') IS NULL
CREATE TABLE [半成品退库单] (
    [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_半成品退库单] PRIMARY KEY,
    [单号] nvarchar(40) NOT NULL CONSTRAINT [UQ_半成品退库单_单号] UNIQUE,
    [日期] date NOT NULL,
    [部门] nvarchar(80) NULL,
    [退料人] nvarchar(80) NULL,
    [仓库] nvarchar(80) NOT NULL,
    [数量] decimal(18,4) NOT NULL,
    [金额] decimal(18,4) NOT NULL,
    [操作员] nvarchar(80) NULL,
    [审核] char(1) NOT NULL CONSTRAINT [DF_半成品退库单_审核] DEFAULT ('0'),
    [审核人] nvarchar(80) NULL,
    [审核日期] datetime2 NULL,
    [备注] nvarchar(500) NULL,
    CONSTRAINT [CK_半成品退库单_审核] CHECK ([审核] IN ('0','1'))
);

IF OBJECT_ID(N'[半成品退库明细单]', N'U') IS NULL
CREATE TABLE [半成品退库明细单] (
    [ID] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_半成品退库明细单] PRIMARY KEY,
    [单号] nvarchar(40) NOT NULL,
    [日期] date NULL,
    [仓库] nvarchar(80) NULL,
    [订单单号] nvarchar(80) NULL,
    [客户] nvarchar(200) NULL,
    [生产单号] nvarchar(80) NULL,
    [货号] nvarchar(200) NULL,
    [名称] nvarchar(200) NULL,
    [物料编号] nvarchar(80) NOT NULL,
    [物料名称] nvarchar(200) NULL,
    [规格] nvarchar(200) NULL,
    [颜色] nvarchar(80) NULL,
    [单位] nvarchar(40) NULL,
    [数量] decimal(18,4) NOT NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(500) NULL,
    CONSTRAINT [UQ_半成品退库明细单_物料] UNIQUE ([单号],[物料编号])
);

COMMIT TRANSACTION;
