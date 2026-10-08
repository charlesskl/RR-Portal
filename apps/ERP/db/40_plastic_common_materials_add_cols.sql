-- 塑胶共用物料表补列(对照旧说明书塑胶物料资料缺字段;二次加工内容给批次3备用,本次只建列)。幂等。
IF COL_LENGTH(N'塑胶共用物料表', N'出模数') IS NULL
    ALTER TABLE [塑胶共用物料表] ADD [出模数] decimal(18,4) NULL;
IF COL_LENGTH(N'塑胶共用物料表', N'水口比例') IS NULL
    ALTER TABLE [塑胶共用物料表] ADD [水口比例] decimal(18,4) NULL;
IF COL_LENGTH(N'塑胶共用物料表', N'整啤毛重') IS NULL
    ALTER TABLE [塑胶共用物料表] ADD [整啤毛重] decimal(18,4) NULL;
IF COL_LENGTH(N'塑胶共用物料表', N'模具日产量') IS NULL
    ALTER TABLE [塑胶共用物料表] ADD [模具日产量] decimal(18,4) NULL;
IF COL_LENGTH(N'塑胶共用物料表', N'啤机机型') IS NULL
    ALTER TABLE [塑胶共用物料表] ADD [啤机机型] nvarchar(30) NULL;
IF COL_LENGTH(N'塑胶共用物料表', N'啤机价钱') IS NULL
    ALTER TABLE [塑胶共用物料表] ADD [啤机价钱] decimal(18,4) NULL;
IF COL_LENGTH(N'塑胶共用物料表', N'胶件啤工价') IS NULL
    ALTER TABLE [塑胶共用物料表] ADD [胶件啤工价] decimal(18,4) NULL;
IF COL_LENGTH(N'塑胶共用物料表', N'胶料单价') IS NULL
    ALTER TABLE [塑胶共用物料表] ADD [胶料单价] decimal(18,4) NULL;
IF COL_LENGTH(N'塑胶共用物料表', N'原胶料单价') IS NULL
    ALTER TABLE [塑胶共用物料表] ADD [原胶料单价] decimal(18,4) NULL;
IF COL_LENGTH(N'塑胶共用物料表', N'加工总单价') IS NULL
    ALTER TABLE [塑胶共用物料表] ADD [加工总单价] decimal(18,4) NULL;
IF COL_LENGTH(N'塑胶共用物料表', N'其它成本') IS NULL
    ALTER TABLE [塑胶共用物料表] ADD [其它成本] decimal(18,4) NULL;
IF COL_LENGTH(N'塑胶共用物料表', N'二次加工内容') IS NULL
    ALTER TABLE [塑胶共用物料表] ADD [二次加工内容] nvarchar(100) NULL;
