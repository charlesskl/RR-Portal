-- 塑胶加工入仓单保真:塑胶入仓明细单补 工模编号/订单单号;塑胶入仓单头补 订单单号。幂等。
IF COL_LENGTH(N'[塑胶入仓明细单]', N'工模编号') IS NULL
    ALTER TABLE [塑胶入仓明细单] ADD [工模编号] nvarchar(30) NULL;
IF COL_LENGTH(N'[塑胶入仓明细单]', N'订单单号') IS NULL
    ALTER TABLE [塑胶入仓明细单] ADD [订单单号] nvarchar(40) NULL;
IF COL_LENGTH(N'[塑胶入仓单]', N'订单单号') IS NULL
    ALTER TABLE [塑胶入仓单] ADD [订单单号] nvarchar(40) NULL;
