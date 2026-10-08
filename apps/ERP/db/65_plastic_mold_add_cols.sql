-- 工模表按旧系统表头补列:客户/整啤套数(网格 11 列用;其余已有列保留在编辑表单)。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[工模表]') AND name=N'客户') ALTER TABLE [工模表] ADD [客户] nvarchar(20) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[工模表]') AND name=N'整啤套数') ALTER TABLE [工模表] ADD [整啤套数] decimal(18,4) NULL;
