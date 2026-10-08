-- 半成品出库单（自由选产品版）：半成品领料单 头加 6 列（审核日期已存在，不加）
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF COL_LENGTH(N'半成品领料单', N'拉长') IS NULL
    ALTER TABLE [半成品领料单] ADD [拉长] nvarchar(20) NULL;
IF COL_LENGTH(N'半成品领料单', N'收件人') IS NULL
    ALTER TABLE [半成品领料单] ADD [收件人] nvarchar(20) NULL;
IF COL_LENGTH(N'半成品领料单', N'领料备注') IS NULL
    ALTER TABLE [半成品领料单] ADD [领料备注] nvarchar(40) NULL;
IF COL_LENGTH(N'半成品领料单', N'件数') IS NULL
    ALTER TABLE [半成品领料单] ADD [件数] decimal(18,4) NULL;
IF COL_LENGTH(N'半成品领料单', N'卡板数') IS NULL
    ALTER TABLE [半成品领料单] ADD [卡板数] decimal(18,4) NULL;
IF COL_LENGTH(N'半成品领料单', N'制单人') IS NULL
    ALTER TABLE [半成品领料单] ADD [制单人] nvarchar(20) NULL;

COMMIT TRANSACTION;
