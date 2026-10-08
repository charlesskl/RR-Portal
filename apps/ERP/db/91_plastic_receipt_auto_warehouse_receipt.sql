-- db/91: 半成品入仓单/成品入仓单 补 来源单号 列。幂等。
-- 加工入仓单(塑胶入仓单)审核后,仓库=半成品仓/成品仓时自动生成对应目标仓入仓单(未审核),
-- 用 来源单号 记录来源加工入仓单号,用于判重(防重复生成)与反审核时查找/删除生成单。
IF COL_LENGTH(N'半成品入仓单', N'来源单号') IS NULL
    ALTER TABLE [半成品入仓单] ADD [来源单号] nvarchar(40) NULL;
IF COL_LENGTH(N'成品入仓单', N'来源单号') IS NULL
    ALTER TABLE [成品入仓单] ADD [来源单号] nvarchar(40) NULL;
