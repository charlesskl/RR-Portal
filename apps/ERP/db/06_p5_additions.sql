-- P5 成品仓储：成品入仓单/出仓单/盘点单 缺 审核人/审核日期 留痕列，补齐(供审核过账引擎②)。
-- 三张单的 单号 列已是 nvarchar(20)，无需扩宽。幂等。
SET XACT_ABORT ON;

IF COL_LENGTH(N'成品入仓单', N'审核人') IS NULL
    ALTER TABLE [成品入仓单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'成品入仓单', N'审核日期') IS NULL
    ALTER TABLE [成品入仓单] ADD [审核日期] datetime2(0) NULL;
IF COL_LENGTH(N'成品出仓单', N'审核人') IS NULL
    ALTER TABLE [成品出仓单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'成品出仓单', N'审核日期') IS NULL
    ALTER TABLE [成品出仓单] ADD [审核日期] datetime2(0) NULL;
IF COL_LENGTH(N'成品盘点单', N'审核人') IS NULL
    ALTER TABLE [成品盘点单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'成品盘点单', N'审核日期') IS NULL
    ALTER TABLE [成品盘点单] ADD [审核日期] datetime2(0) NULL;
