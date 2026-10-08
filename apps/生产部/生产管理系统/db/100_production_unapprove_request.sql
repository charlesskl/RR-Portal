-- 生产制单反审核申请-审批流：已审核单发现有错 → 操作员申请反审核(必填原因) → 经理在消息中心同意后
-- 一步到位回到未审核(第一步)，可继续修改→保存→再审核。经理拒绝则退回申请。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[生产制单]') AND name = N'反审核申请')
BEGIN
    ALTER TABLE [生产制单] ADD [反审核申请] nvarchar(1) NULL;      -- '1'=有待批申请
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[生产制单]') AND name = N'反审核申请人')
BEGIN
    ALTER TABLE [生产制单] ADD [反审核申请人] nvarchar(50) NULL;
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[生产制单]') AND name = N'反审核申请原因')
BEGIN
    ALTER TABLE [生产制单] ADD [反审核申请原因] nvarchar(200) NULL;
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[生产制单]') AND name = N'反审核申请时间')
BEGIN
    ALTER TABLE [生产制单] ADD [反审核申请时间] datetime NULL;
END;
GO
