-- 报废单（物料报废）：两层 报废单 + 报废明细单，镜像 退料单/退料明细单。
-- 含审核留痕列 审核人/审核日期。幂等：可在 ERP_TEST_DB / ERP_DB 重复执行。
SET XACT_ABORT ON;

IF OBJECT_ID(N'[报废单]', N'U') IS NULL
BEGIN
    CREATE TABLE [报废单] (
        [ID] bigint IDENTITY(1,1) PRIMARY KEY,
        [单号] nvarchar(20) NULL,
        [日期] datetime2(0) NULL,
        [生产单号] nvarchar(30) NULL,
        [报废部门] nvarchar(20) NULL,
        [报废人] nvarchar(10) NULL,
        [仓库] nvarchar(20) NULL,
        [数量] decimal(18,4) NULL,
        [金额] decimal(18,4) NULL,
        [操作员] nvarchar(10) NULL,
        [审核] nvarchar(2) NULL,
        [审核人] nvarchar(20) NULL,
        [审核日期] datetime2(0) NULL,
        [备注] nvarchar(150) NULL,
        [打印次数] int NULL,
        [已阅用户] nvarchar(100) NULL
    );
END

IF OBJECT_ID(N'[报废明细单]', N'U') IS NULL
BEGIN
    CREATE TABLE [报废明细单] (
        [ID] bigint IDENTITY(1,1) PRIMARY KEY,
        [单号] nvarchar(20) NULL,
        [日期] datetime2(0) NULL,
        [生产单号] nvarchar(30) NULL,
        [款号] nvarchar(40) NULL,
        [合同号] nvarchar(30) NULL,
        [客户款号] nvarchar(30) NULL,
        [报废部门] nvarchar(20) NULL,
        [报废人] nvarchar(10) NULL,
        [仓库] nvarchar(20) NULL,
        [物料类别] nvarchar(20) NULL,
        [条码号] nvarchar(20) NULL,
        [物料编号] nvarchar(20) NULL,
        [物料名称] nvarchar(40) NULL,
        [规格] nvarchar(20) NULL,
        [颜色] nvarchar(20) NULL,
        [单位] nvarchar(10) NULL,
        [数量] decimal(18,4) NULL,
        [库存单价] decimal(18,4) NULL,
        [库存金额] decimal(18,4) NULL,
        [单价] decimal(18,4) NULL,
        [金额] decimal(18,4) NULL,
        [备注] nvarchar(150) NULL,
        [预算数量] decimal(18,4) NULL,
        [预算单价] decimal(18,4) NULL,
        [打印次数] int NULL
    );
    CREATE INDEX IX_报废明细单_单号 ON [报废明细单]([单号]);
END
