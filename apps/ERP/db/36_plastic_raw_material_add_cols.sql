-- 给 塑胶原料资料 补 产地/每包重量 两列(原系统原料资料含此二列,重建时省略,现补)。幂等。
IF COL_LENGTH(N'塑胶原料资料', N'产地') IS NULL
    ALTER TABLE [塑胶原料资料] ADD [产地] nvarchar(60) NULL;
IF COL_LENGTH(N'塑胶原料资料', N'每包重量') IS NULL
    ALTER TABLE [塑胶原料资料] ADD [每包重量] decimal(18,4) NULL;
