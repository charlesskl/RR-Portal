-- 工程BOM(款号物料总表)反审核申请-审批流：与生产制单同一口径——已审核 BOM 发现有错 →
-- 操作员申请反审核(必填原因) → 经理在消息中心同意后一步到位回到未审核，可改后再审。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[款号物料总表]') AND name = N'反审核申请')
BEGIN
    ALTER TABLE [款号物料总表] ADD [反审核申请] nvarchar(1) NULL;      -- '1'=有待批申请
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[款号物料总表]') AND name = N'反审核申请人')
BEGIN
    ALTER TABLE [款号物料总表] ADD [反审核申请人] nvarchar(50) NULL;
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[款号物料总表]') AND name = N'反审核申请原因')
BEGIN
    ALTER TABLE [款号物料总表] ADD [反审核申请原因] nvarchar(200) NULL;
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[款号物料总表]') AND name = N'反审核申请时间')
BEGIN
    ALTER TABLE [款号物料总表] ADD [反审核申请时间] datetime NULL;
END;
GO
