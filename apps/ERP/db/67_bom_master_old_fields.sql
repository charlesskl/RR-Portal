-- BOM 物料设置旧版表头字段:款号物料总表 加 默认单价/类型。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[款号物料总表]') AND name=N'默认单价') ALTER TABLE [款号物料总表] ADD [默认单价] nvarchar(20) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[款号物料总表]') AND name=N'类型') ALTER TABLE [款号物料总表] ADD [类型] nvarchar(10) NULL;
