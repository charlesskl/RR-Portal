-- P5 物料加权成本：结存快照表加金额列（物料口径填，成品/半成品留 NULL）。幂等。
SET XACT_ABORT ON;
IF COL_LENGTH(N'结存快照表', N'期初金额')  IS NULL ALTER TABLE [结存快照表] ADD [期初金额]  decimal(18,4) NULL;
IF COL_LENGTH(N'结存快照表', N'本期入金额') IS NULL ALTER TABLE [结存快照表] ADD [本期入金额] decimal(18,4) NULL;
IF COL_LENGTH(N'结存快照表', N'本期出金额') IS NULL ALTER TABLE [结存快照表] ADD [本期出金额] decimal(18,4) NULL;
IF COL_LENGTH(N'结存快照表', N'结存金额')  IS NULL ALTER TABLE [结存快照表] ADD [结存金额]  decimal(18,4) NULL;
IF COL_LENGTH(N'结存快照表', N'加权单价')  IS NULL ALTER TABLE [结存快照表] ADD [加权单价]  decimal(18,4) NULL;
