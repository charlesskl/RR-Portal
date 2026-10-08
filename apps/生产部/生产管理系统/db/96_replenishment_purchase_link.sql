-- 补料单转采购：审核通过后在采购订单页「从补料单带入」，保存成功后标 已采购='1' 防重复带入。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[补料单]') AND name = N'已采购')
BEGIN
    ALTER TABLE [补料单] ADD [已采购] nvarchar(1) NOT NULL CONSTRAINT [DF_补料单_已采购] DEFAULT (N'0');
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[补料单]') AND name = N'采购时间')
BEGIN
    ALTER TABLE [补料单] ADD [采购时间] datetime2 NULL;
END;
GO
