-- 生产制单(生产通知单)备注 放宽 nvarchar(40)→nvarchar(500):排期下单自动备注(客户+PO+客PO+货号)常超 40 字,截断报错。幂等。
SET XACT_ABORT ON;

IF COL_LENGTH(N'生产制单', N'备注') IS NOT NULL
    AND COL_LENGTH(N'生产制单', N'备注') < 1000
    ALTER TABLE [生产制单] ALTER COLUMN [备注] nvarchar(500) NULL;
