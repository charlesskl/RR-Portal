-- 塑胶采购订单二次加工：
-- 1) 塑胶采购订单加 加工类型（一次加工/二次加工，存量回填一次加工，默认一次加工）；
-- 2) 塑胶入仓明细单加 加工内容（入仓时从来源采购订单快照，作为「已加工工序」标记）。幂等。
-- 注意：新增列与引用该列的 UPDATE/约束必须分批（同批编译会报 207 Invalid column name）。
IF NOT EXISTS (SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[塑胶采购订单]') AND name = N'加工类型')
BEGIN
    ALTER TABLE [塑胶采购订单] ADD [加工类型] nvarchar(10) NULL;
END;
GO

UPDATE [塑胶采购订单] SET [加工类型] = N'一次加工' WHERE [加工类型] IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.default_constraints
    WHERE parent_object_id = OBJECT_ID(N'[塑胶采购订单]') AND name = N'DF_塑胶采购订单_加工类型')
BEGIN
    ALTER TABLE [塑胶采购订单] ADD CONSTRAINT [DF_塑胶采购订单_加工类型] DEFAULT N'一次加工' FOR [加工类型];
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[塑胶入仓明细单]') AND name = N'加工内容')
BEGIN
    ALTER TABLE [塑胶入仓明细单] ADD [加工内容] nvarchar(100) NULL;
END;
GO
