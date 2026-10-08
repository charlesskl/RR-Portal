-- 塑胶物料资料关联工模表:加列(工模带出字段 + 手动补录字段)。EF 不迁移·幂等。
-- 说明书 2-2 口径:工模带出 颜色/色粉号/整啤模腔数/水口比例/模具日产量/整啤毛重/整啤净重/啤机机型/啤机价钱/胶件啤工价/用料名称/胶料单价(→原料单价)/原胶料单价;
-- 手动补:客户/加工内容/二次加工/原料名称/出模数/用量/套数(=出模数÷用量)/原胶件单净重/胶件料价/二次加工价/加工总单价/其他成本。
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'工模编号') ALTER TABLE [塑胶物料资料] ADD [工模编号] nvarchar(30) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'客户') ALTER TABLE [塑胶物料资料] ADD [客户] nvarchar(20) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'色粉号') ALTER TABLE [塑胶物料资料] ADD [色粉号] nvarchar(30) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'加工内容') ALTER TABLE [塑胶物料资料] ADD [加工内容] nvarchar(50) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'二次加工') ALTER TABLE [塑胶物料资料] ADD [二次加工] nvarchar(50) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'原料名称') ALTER TABLE [塑胶物料资料] ADD [原料名称] nvarchar(40) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'用料名称') ALTER TABLE [塑胶物料资料] ADD [用料名称] nvarchar(40) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'整啤毛重') ALTER TABLE [塑胶物料资料] ADD [整啤毛重] decimal(18,4) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'整啤净重') ALTER TABLE [塑胶物料资料] ADD [整啤净重] decimal(18,4) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'原胶件单净重') ALTER TABLE [塑胶物料资料] ADD [原胶件单净重] decimal(18,4) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'整啤模腔数') ALTER TABLE [塑胶物料资料] ADD [整啤模腔数] decimal(18,4) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'套数') ALTER TABLE [塑胶物料资料] ADD [套数] decimal(18,4) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'出模数') ALTER TABLE [塑胶物料资料] ADD [出模数] decimal(18,4) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'用量') ALTER TABLE [塑胶物料资料] ADD [用量] decimal(18,4) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'水口比例') ALTER TABLE [塑胶物料资料] ADD [水口比例] decimal(18,4) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'模具日产量') ALTER TABLE [塑胶物料资料] ADD [模具日产量] decimal(18,4) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'啤机价钱') ALTER TABLE [塑胶物料资料] ADD [啤机价钱] decimal(18,4) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'胶件啤工价') ALTER TABLE [塑胶物料资料] ADD [胶件啤工价] decimal(18,4) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'原料单价') ALTER TABLE [塑胶物料资料] ADD [原料单价] decimal(18,4) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'胶件料价') ALTER TABLE [塑胶物料资料] ADD [胶件料价] decimal(18,4) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'原胶料单价') ALTER TABLE [塑胶物料资料] ADD [原胶料单价] decimal(18,4) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'二次加工价') ALTER TABLE [塑胶物料资料] ADD [二次加工价] decimal(18,4) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'加工总单价') ALTER TABLE [塑胶物料资料] ADD [加工总单价] decimal(18,4) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'其他成本') ALTER TABLE [塑胶物料资料] ADD [其他成本] decimal(18,4) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[塑胶物料资料]') AND name=N'啤机机型') ALTER TABLE [塑胶物料资料] ADD [啤机机型] nvarchar(30) NULL;
