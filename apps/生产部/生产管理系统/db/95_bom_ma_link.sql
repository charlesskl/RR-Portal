-- BOM 物料设置 MA/实单 双版本：款号物料总表 记录实单 BOM 关联的模板 MA 货号（MA 版为 NULL）。
-- 实单 BOM 明细只允许从关联 MA 的物料/半成品定义/包装定义勾选而来，重新打开据此回填并放宽物料编号校验。幂等。
IF NOT EXISTS (SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[款号物料总表]') AND name = N'MA货号')
BEGIN
    ALTER TABLE [款号物料总表] ADD [MA货号] nvarchar(30) NULL;
END;
GO
