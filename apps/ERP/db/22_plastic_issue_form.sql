-- 塑胶领料单保真重做:头/明细补原系统字段。幂等(COL_LENGTH 判空再 ADD)。
SET XACT_ABORT ON;
IF COL_LENGTH(N'塑胶领料单', N'胶箱数')   IS NULL ALTER TABLE [塑胶领料单] ADD [胶箱数] int NULL;
IF COL_LENGTH(N'塑胶领料单', N'纸箱数')   IS NULL ALTER TABLE [塑胶领料单] ADD [纸箱数] int NULL;
IF COL_LENGTH(N'塑胶领料单', N'钙塑箱数') IS NULL ALTER TABLE [塑胶领料单] ADD [钙塑箱数] int NULL;
IF COL_LENGTH(N'塑胶领料单', N'卡板数')   IS NULL ALTER TABLE [塑胶领料单] ADD [卡板数] int NULL;
IF COL_LENGTH(N'塑胶领料单', N'收件人')   IS NULL ALTER TABLE [塑胶领料单] ADD [收件人] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶领料单', N'电脑单号') IS NULL ALTER TABLE [塑胶领料单] ADD [电脑单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶领料单', N'领料备注') IS NULL ALTER TABLE [塑胶领料单] ADD [领料备注] nvarchar(40) NULL;

IF COL_LENGTH(N'塑胶领料明细单', N'生产单号') IS NULL ALTER TABLE [塑胶领料明细单] ADD [生产单号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶领料明细单', N'款号')     IS NULL ALTER TABLE [塑胶领料明细单] ADD [款号] nvarchar(40) NULL;
IF COL_LENGTH(N'塑胶领料明细单', N'模具编号') IS NULL ALTER TABLE [塑胶领料明细单] ADD [模具编号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶领料明细单', N'色粉号')   IS NULL ALTER TABLE [塑胶领料明细单] ADD [色粉号] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶领料明细单', N'用料名称') IS NULL ALTER TABLE [塑胶领料明细单] ADD [用料名称] nvarchar(40) NULL;
IF COL_LENGTH(N'塑胶领料明细单', N'装配采购') IS NULL ALTER TABLE [塑胶领料明细单] ADD [装配采购] nvarchar(10) NULL;
