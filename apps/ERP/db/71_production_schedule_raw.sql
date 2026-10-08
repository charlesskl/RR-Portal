-- 客户排期第③片：排期明细加 原始数据 列(整行原始 JSON,表头→原值逐字保留)。
-- 万全兜底:不管客户表头怎么写,标准字段映射之外,原始行永远不丢。幂等。
SET XACT_ABORT ON;

IF COL_LENGTH(N'生产排期', N'原始数据') IS NULL
    ALTER TABLE [生产排期] ADD [原始数据] nvarchar(max) NULL;
