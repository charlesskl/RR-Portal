-- 半成品设置头加「用量」：做 1 个成品要用几个该半成品。
-- 与定义明细里「做 1 个半成品要多少该物料」的使用数量是两个层级，互不影响。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[半成品设置]') AND name = N'用量')
BEGIN
    ALTER TABLE [半成品设置] ADD [用量] decimal(18,4) NULL;
END;
GO
UPDATE [半成品设置] SET [用量] = 1 WHERE [用量] IS NULL;
GO
