-- 塑胶模块 P3c:塑胶退仓单(库存−,供应商头)+ 塑胶报废单(库存−,报废部门/人头),各 头+明细。
-- 审核后由 PlasticInventoryService 实时聚合(−)。头表含审核留痕列 审核人/审核日期(P2 教训)。幂等。
IF OBJECT_ID(N'[塑胶退仓单]', N'U') IS NULL
CREATE TABLE [塑胶退仓单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL, [日期] datetime NULL,
    [供应商编号] nvarchar(20) NULL, [供应商名称] nvarchar(60) NULL, [仓库] nvarchar(30) NULL,
    [数量] decimal(18,4) NULL, [金额] decimal(18,4) NULL, [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL, [审核人] nvarchar(20) NULL, [审核日期] datetime NULL, [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[塑胶退仓明细单]', N'U') IS NULL
CREATE TABLE [塑胶退仓明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL, [日期] datetime NULL, [仓库] nvarchar(30) NULL,
    [物料编号] nvarchar(20) NULL, [物料名称] nvarchar(40) NULL, [规格] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL, [仓位号] nvarchar(30) NULL, [单位] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL, [单价] decimal(18,4) NULL, [金额] decimal(18,4) NULL, [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[塑胶报废单]', N'U') IS NULL
CREATE TABLE [塑胶报废单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL, [日期] datetime NULL,
    [报废部门] nvarchar(30) NULL, [报废人] nvarchar(30) NULL, [仓库] nvarchar(30) NULL,
    [数量] decimal(18,4) NULL, [金额] decimal(18,4) NULL, [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL, [审核人] nvarchar(20) NULL, [审核日期] datetime NULL, [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[塑胶报废明细单]', N'U') IS NULL
CREATE TABLE [塑胶报废明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL, [日期] datetime NULL, [仓库] nvarchar(30) NULL,
    [物料编号] nvarchar(20) NULL, [物料名称] nvarchar(40) NULL, [规格] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL, [仓位号] nvarchar(30) NULL, [单位] nvarchar(20) NULL,
    [数量] decimal(18,4) NULL, [单价] decimal(18,4) NULL, [金额] decimal(18,4) NULL, [备注] nvarchar(200) NULL
);
