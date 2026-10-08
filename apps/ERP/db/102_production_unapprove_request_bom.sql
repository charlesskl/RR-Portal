-- 生产制单反审核申请加「含BOM」方式位：申请时选定 单个(仅生产单)/整步(生产单+绑定BOM)，
-- 经理批准时按该位决定是否带出绑定BOM一并反审核。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[生产制单]') AND name = N'反审核申请含BOM')
BEGIN
    ALTER TABLE [生产制单] ADD [反审核申请含BOM] nvarchar(1) NULL;   -- '1'=整步(带出绑定BOM)
END;
GO
