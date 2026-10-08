-- 塑胶退料/报废/入仓 保真重做:统一退仓同款表头/明细。幂等(COL_LENGTH 判空再 ADD)。
-- 退料/报废 改用供应商头(旧 退料部门/退料人、报废部门/报废人 保留不动)。
SET XACT_ABORT ON;
-- 塑胶退料单(头)
IF COL_LENGTH(N'塑胶退料单', N'供应商编号') IS NULL ALTER TABLE [塑胶退料单] ADD [供应商编号] nvarchar(20) NULL;
IF COL_LENGTH(N'塑胶退料单', N'供应商名称') IS NULL ALTER TABLE [塑胶退料单] ADD [供应商名称] nvarchar(60) NULL;
IF COL_LENGTH(N'塑胶退料单', N'出库单号')   IS NULL ALTER TABLE [塑胶退料单] ADD [出库单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶退料单', N'入仓单号')   IS NULL ALTER TABLE [塑胶退料单] ADD [入仓单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶退料单', N'电脑单号')   IS NULL ALTER TABLE [塑胶退料单] ADD [电脑单号] nvarchar(30) NULL;
-- 塑胶报废单(头)
IF COL_LENGTH(N'塑胶报废单', N'供应商编号') IS NULL ALTER TABLE [塑胶报废单] ADD [供应商编号] nvarchar(20) NULL;
IF COL_LENGTH(N'塑胶报废单', N'供应商名称') IS NULL ALTER TABLE [塑胶报废单] ADD [供应商名称] nvarchar(60) NULL;
IF COL_LENGTH(N'塑胶报废单', N'出库单号')   IS NULL ALTER TABLE [塑胶报废单] ADD [出库单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶报废单', N'入仓单号')   IS NULL ALTER TABLE [塑胶报废单] ADD [入仓单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶报废单', N'电脑单号')   IS NULL ALTER TABLE [塑胶报废单] ADD [电脑单号] nvarchar(30) NULL;
-- 塑胶入仓单(头·供应商已有)
IF COL_LENGTH(N'塑胶入仓单', N'出库单号')   IS NULL ALTER TABLE [塑胶入仓单] ADD [出库单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶入仓单', N'入仓单号')   IS NULL ALTER TABLE [塑胶入仓单] ADD [入仓单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶入仓单', N'电脑单号')   IS NULL ALTER TABLE [塑胶入仓单] ADD [电脑单号] nvarchar(30) NULL;
-- 三明细表各补 生产单号/款号/塑胶货号
IF COL_LENGTH(N'塑胶退料明细单', N'生产单号') IS NULL ALTER TABLE [塑胶退料明细单] ADD [生产单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶退料明细单', N'款号')     IS NULL ALTER TABLE [塑胶退料明细单] ADD [款号] nvarchar(40) NULL;
IF COL_LENGTH(N'塑胶退料明细单', N'塑胶货号') IS NULL ALTER TABLE [塑胶退料明细单] ADD [塑胶货号] nvarchar(40) NULL;
IF COL_LENGTH(N'塑胶报废明细单', N'生产单号') IS NULL ALTER TABLE [塑胶报废明细单] ADD [生产单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶报废明细单', N'款号')     IS NULL ALTER TABLE [塑胶报废明细单] ADD [款号] nvarchar(40) NULL;
IF COL_LENGTH(N'塑胶报废明细单', N'塑胶货号') IS NULL ALTER TABLE [塑胶报废明细单] ADD [塑胶货号] nvarchar(40) NULL;
IF COL_LENGTH(N'塑胶入仓明细单', N'生产单号') IS NULL ALTER TABLE [塑胶入仓明细单] ADD [生产单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶入仓明细单', N'款号')     IS NULL ALTER TABLE [塑胶入仓明细单] ADD [款号] nvarchar(40) NULL;
IF COL_LENGTH(N'塑胶入仓明细单', N'塑胶货号') IS NULL ALTER TABLE [塑胶入仓明细单] ADD [塑胶货号] nvarchar(40) NULL;
