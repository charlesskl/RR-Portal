-- 塑胶模块 P3d:塑胶盘点单 + 塑胶盘点明细单(盈亏±)。审核后由 PlasticInventoryService 按盈亏数量实时聚合。
-- 头含审核留痕列 审核人/审核日期。数量列 decimal(免物料侧 real 的 CAST)。颜色列保留(可空)对齐其它塑胶明细表。幂等。
IF OBJECT_ID(N'[塑胶盘点单]', N'U') IS NULL
CREATE TABLE [塑胶盘点单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL, [日期] datetime NULL, [仓库] nvarchar(30) NULL,
    [操作员] nvarchar(20) NULL, [审核] nvarchar(5) NULL, [审核人] nvarchar(20) NULL, [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[塑胶盘点明细单]', N'U') IS NULL
CREATE TABLE [塑胶盘点明细单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL, [日期] datetime NULL, [仓库] nvarchar(30) NULL,
    [物料编号] nvarchar(20) NULL, [物料名称] nvarchar(40) NULL, [规格] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL, [仓位号] nvarchar(30) NULL, [单位] nvarchar(20) NULL,
    [系统数量] decimal(18,4) NULL, [盘点数量] decimal(18,4) NULL, [盈亏数量] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
