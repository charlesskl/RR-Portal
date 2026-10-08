-- 补料单加 PMC 负责人：新建必选（人事档案 职称='PMC' 人员），开单知会仓管+该 PMC，审核后知会该 PMC 安排采购。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[补料单]') AND name = N'PMC')
BEGIN
    ALTER TABLE [补料单] ADD [PMC] nvarchar(50) NULL;
END;
GO
