-- 塑胶退仓单保真重做:头补 出库单号/入仓单号/电脑单号;明细补 生产单号/款号/塑胶货号。幂等。
SET XACT_ABORT ON;
IF COL_LENGTH(N'塑胶退仓单', N'出库单号') IS NULL ALTER TABLE [塑胶退仓单] ADD [出库单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶退仓单', N'入仓单号') IS NULL ALTER TABLE [塑胶退仓单] ADD [入仓单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶退仓单', N'电脑单号') IS NULL ALTER TABLE [塑胶退仓单] ADD [电脑单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶退仓明细单', N'生产单号') IS NULL ALTER TABLE [塑胶退仓明细单] ADD [生产单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶退仓明细单', N'款号')     IS NULL ALTER TABLE [塑胶退仓明细单] ADD [款号] nvarchar(40) NULL;
IF COL_LENGTH(N'塑胶退仓明细单', N'塑胶货号') IS NULL ALTER TABLE [塑胶退仓明细单] ADD [塑胶货号] nvarchar(40) NULL;
