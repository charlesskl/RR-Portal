-- P4 M7 发外：发外加工单/发外回收单 缺 审核人/审核日期 留痕列，补齐(供审核过账引擎②)。
-- 这两张单的 单号 列已是 nvarchar(20)(容得下 FW/FH+yyyyMMdd+3位=13字符)，无需扩宽。幂等。
SET XACT_ABORT ON;

IF COL_LENGTH(N'发外加工单', N'审核人') IS NULL
    ALTER TABLE [发外加工单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'发外加工单', N'审核日期') IS NULL
    ALTER TABLE [发外加工单] ADD [审核日期] datetime2(0) NULL;
IF COL_LENGTH(N'发外回收单', N'审核人') IS NULL
    ALTER TABLE [发外回收单] ADD [审核人] nvarchar(20) NULL;
IF COL_LENGTH(N'发外回收单', N'审核日期') IS NULL
    ALTER TABLE [发外回收单] ADD [审核日期] datetime2(0) NULL;
