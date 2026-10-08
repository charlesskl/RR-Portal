-- P5b 成品仓储：成品调拨单/退货单/退仓单 缺 审核人/审核日期 留痕列，补齐(供审核过账引擎②)。
-- 三张单的 单号 列已是 nvarchar(20)，无需扩宽。幂等。
SET XACT_ABORT ON;

IF COL_LENGTH(N'成品调拨单', N'审核人') IS NULL
    ALTER TABLE [成品调拨单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'成品调拨单', N'审核日期') IS NULL
    ALTER TABLE [成品调拨单] ADD [审核日期] datetime2(0) NULL;
IF COL_LENGTH(N'成品退货单', N'审核人') IS NULL
    ALTER TABLE [成品退货单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'成品退货单', N'审核日期') IS NULL
    ALTER TABLE [成品退货单] ADD [审核日期] datetime2(0) NULL;
IF COL_LENGTH(N'成品退仓单', N'审核人') IS NULL
    ALTER TABLE [成品退仓单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'成品退仓单', N'审核日期') IS NULL
    ALTER TABLE [成品退仓单] ADD [审核日期] datetime2(0) NULL;
