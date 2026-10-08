-- 成品入仓单 玩具模型化（自由选产品版）：给单头/明细补玩具列（配件编号/订单单号/客户/货号/名称/产品装配名称/箱数）。
-- 幂等：仅当列不存在时 ADD。保留原服装列（款号/款式/尺码/色号）以兼容旧数据。
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF COL_LENGTH(N'[成品入仓单]', N'订单单号') IS NULL ALTER TABLE [成品入仓单] ADD [订单单号] nvarchar(40) NULL;
IF COL_LENGTH(N'[成品入仓单]', N'入库单号') IS NULL ALTER TABLE [成品入仓单] ADD [入库单号] nvarchar(40) NULL;

IF COL_LENGTH(N'[成品入仓明细单]', N'订单单号') IS NULL ALTER TABLE [成品入仓明细单] ADD [订单单号] nvarchar(40) NULL;
IF COL_LENGTH(N'[成品入仓明细单]', N'配件编号') IS NULL ALTER TABLE [成品入仓明细单] ADD [配件编号] nvarchar(80) NULL;
IF COL_LENGTH(N'[成品入仓明细单]', N'客户') IS NULL ALTER TABLE [成品入仓明细单] ADD [客户] nvarchar(200) NULL;
IF COL_LENGTH(N'[成品入仓明细单]', N'货号') IS NULL ALTER TABLE [成品入仓明细单] ADD [货号] nvarchar(200) NULL;
IF COL_LENGTH(N'[成品入仓明细单]', N'名称') IS NULL ALTER TABLE [成品入仓明细单] ADD [名称] nvarchar(200) NULL;
IF COL_LENGTH(N'[成品入仓明细单]', N'产品装配名称') IS NULL ALTER TABLE [成品入仓明细单] ADD [产品装配名称] nvarchar(200) NULL;
IF COL_LENGTH(N'[成品入仓明细单]', N'箱数') IS NULL ALTER TABLE [成品入仓明细单] ADD [箱数] decimal(18,4) NULL;

COMMIT TRANSACTION;
