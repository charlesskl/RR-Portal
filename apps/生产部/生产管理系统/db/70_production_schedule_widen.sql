-- 客户排期第②片：排期明细列加宽(各客户排期表实际数据超长:客PO合并串、第三方验货备注等)。
-- 幂等(可重跑,ALTER COLUMN 本身幂等)。
SET XACT_ABORT ON;

ALTER TABLE [生产排期] ALTER COLUMN [客户名称] nvarchar(200) NULL;
ALTER TABLE [生产排期] ALTER COLUMN [国家] nvarchar(100) NULL;
ALTER TABLE [生产排期] ALTER COLUMN [PO号] nvarchar(200) NULL;
ALTER TABLE [生产排期] ALTER COLUMN [客PO] nvarchar(200) NULL;
ALTER TABLE [生产排期] ALTER COLUMN [SKU] nvarchar(200) NULL;
ALTER TABLE [生产排期] ALTER COLUMN [货号] nvarchar(200) NULL;
ALTER TABLE [生产排期] ALTER COLUMN [品名] nvarchar(200) NULL;
ALTER TABLE [生产排期] ALTER COLUMN [第三方验货] nvarchar(200) NULL;
ALTER TABLE [生产排期] ALTER COLUMN [车间] nvarchar(50) NULL;
ALTER TABLE [生产排期] ALTER COLUMN [来源工作表] nvarchar(100) NULL;
