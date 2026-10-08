-- 生产制单(生产通知单)单头加 接单数量 列:可手动输入(对齐老系统表头);空则后端回落为明细合计(计划数量)。幂等。
SET XACT_ABORT ON;

IF COL_LENGTH(N'生产制单', N'接单数量') IS NULL
    ALTER TABLE [生产制单] ADD [接单数量] decimal(18,2) NULL;
