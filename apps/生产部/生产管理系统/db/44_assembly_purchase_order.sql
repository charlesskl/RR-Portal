-- 装配加工采购单·头 + BOM物料快照明细 + 生产明细。EF 不迁移·幂等。
-- 快照语义: 保存时把当时按款号BOM展开的辅料行原样落库,之后取单只读快照;
-- 修改半成品BOM不影响已保存的装配加工采购单,只对之后新开的单生效。

IF OBJECT_ID(N'[装配加工采购单]', N'U') IS NULL
CREATE TABLE [装配加工采购单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [日期] datetime NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(60) NULL,
    [客户编号] nvarchar(20) NULL,
    [客户名称] nvarchar(60) NULL,
    [收货仓库] nvarchar(30) NULL,
    [电脑单号] nvarchar(30) NULL,
    [装配方式] nvarchar(50) NULL,
    [开始交货日期] datetime NULL,
    [每天交货] decimal(18,4) NULL,
    [完成日期] datetime NULL,
    [收货人] nvarchar(30) NULL,
    [单价] decimal(18,4) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_装配加工采购单_单号' AND object_id = OBJECT_ID(N'[装配加工采购单]'))
CREATE UNIQUE INDEX [UX_装配加工采购单_单号] ON [装配加工采购单]([单号]);

-- BOM 物料快照明细: 保存时按当时款号BOM算出的辅料行原样落库,之后不再实时展开。
IF OBJECT_ID(N'[装配加工采购单明细]', N'U') IS NULL
CREATE TABLE [装配加工采购单明细] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [行号] int NULL,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(40) NULL,
    [物料编号] nvarchar(30) NULL,
    [物料名称] nvarchar(60) NULL,
    [单位] nvarchar(20) NULL,
    [用量] decimal(18,6) NULL,
    [需求数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_装配加工采购单明细_单号' AND object_id = OBJECT_ID(N'[装配加工采购单明细]'))
CREATE INDEX [IX_装配加工采购单明细_单号] ON [装配加工采购单明细]([单号]);

-- 生产明细(加工数量/单价/金额所在的行)。
IF OBJECT_ID(N'[装配加工采购单生产明细]', N'U') IS NULL
CREATE TABLE [装配加工采购单生产明细] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [行号] int NULL,
    [接单日期] nvarchar(20) NULL,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(40) NULL,
    [产品名称] nvarchar(60) NULL,
    [配件编号] nvarchar(40) NULL,
    [产品装配名称] nvarchar(60) NULL,
    [加工数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_装配加工采购单生产明细_单号' AND object_id = OBJECT_ID(N'[装配加工采购单生产明细]'))
CREATE INDEX [IX_装配加工采购单生产明细_单号] ON [装配加工采购单生产明细]([单号]);
