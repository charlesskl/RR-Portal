-- 塑胶采购订单单头加 加工内容：喷油供应商订单必选，选项来自 塑胶物料资料/塑胶共用物料表.加工内容 去重值。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[塑胶采购订单]') AND name = N'加工内容')
BEGIN
    ALTER TABLE [塑胶采购订单] ADD [加工内容] nvarchar(100) NULL;
END;
GO
