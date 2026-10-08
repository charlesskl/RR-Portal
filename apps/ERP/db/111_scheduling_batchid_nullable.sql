-- 生产排期手工 CRUD 前置:批次ID 改可空(手工新增行不属于任何导入批次)。幂等(可重跑)。
-- 不改既有导入行(它们都有批次ID);Files 视图 INNER JOIN 批次,手工行不进文件视图,语义不变。
IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID(N'生产排期') AND name = N'批次ID' AND is_nullable = 0)
    ALTER TABLE [生产排期] ALTER COLUMN [批次ID] bigint NULL;
